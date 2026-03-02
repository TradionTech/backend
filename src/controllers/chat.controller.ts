import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { ChartUpload } from '../db/models/ChartUpload';
import { getStorageService } from '../services/storage';
import { Usage } from '../services/usage/usage';
import { Limits } from '../services/plans/limits';
import { chatOrchestrator } from '../services/ai/chatOrchestrator';
import { logger } from '../config/logger';

const DATA_URL_PREFIX = /^data:([^;]+);base64,/;
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

function parseImagePayload(
  str: string
): { buffer: Buffer; mimeType: string } | null {
  const trimmed = str.trim();
  const match = trimmed.match(DATA_URL_PREFIX);
  let base64: string;
  let mimeType = 'image/png';
  if (match) {
    mimeType = (match[1] || 'image/png').toLowerCase();
    if (!ALLOWED_MIMES.includes(mimeType)) mimeType = 'image/png';
    base64 = trimmed.slice(match[0].length);
  } else {
    base64 = trimmed;
  }
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) return null;
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export const chatController = {
  postChat: async (req: Request, res: Response) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      let { session_id, message, metadata, images } = req.body as {
        session_id?: string;
        message: string;
        metadata?: { instrument?: string; timeframe?: string; chartId?: string; [k: string]: unknown };
        images?: string[];
      };

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required and cannot be empty' });
      }

      // If request includes inline images (JSON base64 or data URLs), upload first and set metadata.chartId
      if (images?.length) {
        const parsed = parseImagePayload(images[0]);
        if (parsed) {
          const storageService = getStorageService();
          const symbolHint = metadata?.instrument ?? null;
          const timeframeHint = metadata?.timeframe ?? null;
          const uploadResult = await storageService.uploadChartImage({
            userId,
            buffer: parsed.buffer,
            mimeType: parsed.mimeType,
            filename: 'chart.png',
          });
          const chartUpload = await ChartUpload.create({
            userId,
            storageKey: uploadResult.key,
            originalFilename: 'chart.png',
            mimeType: parsed.mimeType,
            sizeBytes: parsed.buffer.length,
            symbolHint,
            timeframeHint,
          });
          metadata = { ...metadata, chartId: chartUpload.id };
          if (symbolHint) (metadata as Record<string, unknown>).instrument = symbolHint;
          if (timeframeHint) (metadata as Record<string, unknown>).timeframe = timeframeHint;
          logger.debug('Chat inline image uploaded for chart analysis', {
            chartId: chartUpload.id,
            userId,
            imageCount: images.length,
          });
        }
      }

      // Enforce usage limits for Free
      await Usage.ensureDailyRow(userId);
      const plan = await Usage.getPlan(userId);
      const { chatToday } = await Usage.getCounters(userId);
      if (plan === 'free' && chatToday >= Limits.free.maxChatPerDay) {
        return res.status(402).json({
          error: 'Free plan daily chat limit reached. Upgrade to Pro.',
        });
      }

      // Process message through orchestrator
      const response = await chatOrchestrator.processMessage({
        userId,
        conversationId: session_id,
        message: message.trim(),
        metadata,
      });

      // Increment usage
      await Usage.inc(userId, 'chatToday');

      // Return structured response
      return res.json({
        conversation_id: response.conversationId,
        response_id: response.response_id,
        message: response.message,
        sections: response.sections,
        intent: response.primaryIntent,
        user_level: response.user_level,
        low_confidence: response.low_confidence,
      });
    } catch (error) {
      logger.error('Chat controller error', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });

      return res.status(500).json({
        error: 'Failed to process chat message',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      });
    }
  },
};
