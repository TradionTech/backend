import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { ChartUpload } from '../db/models/ChartUpload';
import { getStorageService } from '../services/storage';
import { Usage } from '../services/usage/usage';
import { Limits } from '../services/plans/limits';
import { chatOrchestrator } from '../services/ai/chatOrchestrator';
import { resolveModelId, InvalidModelForPlanError } from '../services/ai/llm/modelResolver';
import { conversationStore } from '../services/ai/conversationStore';
import { logger } from '../config/logger';
import { env } from '../config/env';

const DATA_URL_PREFIX = /^data:([^;]+);base64,/;
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

function sendSSE(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

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
  getConversations: async (req: Request, res: Response) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        });
      }

      const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
      const conversations = await conversationStore.listConversations(userId, limit, offset);
      return res.json({
        conversations,
        limit,
        offset,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Get conversations error', { error: err.message, stack: err.stack });
      return res.status(500).json({
        error: { code: 'PROVIDER_ERROR', message: 'Failed to fetch conversations' },
      });
    }
  },

  getConversationHistory: async (req: Request, res: Response) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        });
      }
      const conversationId = String(req.params.conversationId || '');
      if (!conversationId) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'conversationId is required' },
        });
      }

      const history = await conversationStore.getConversationHistory(userId, conversationId);
      if (!history) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }
      return res.json(history);
    } catch (error) {
      const err = error as Error;
      logger.error('Get conversation history error', { error: err.message, stack: err.stack });
      return res.status(500).json({
        error: { code: 'PROVIDER_ERROR', message: 'Failed to fetch conversation history' },
      });
    }
  },

  postChat: async (req: Request, res: Response) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        });
      }
      let { session_id, message, metadata, images, model_id } = req.body as {
        session_id?: string;
        message: string;
        metadata?: { instrument?: string; timeframe?: string; chartId?: string; [k: string]: unknown };
        images?: string[];
        model_id?: string;
      };

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Message is required and cannot be empty' },
        });
      }

      // If request includes inline images
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
          error: { code: 'RATE_LIMIT', message: 'Free plan daily chat limit reached. Upgrade to Pro.' },
        });
      }

      let modelId: string;
      try {
        modelId = await resolveModelId(userId, model_id);
      } catch (e) {
        if (e instanceof InvalidModelForPlanError) {
          return res.status(400).json({
            error: { code: 'INVALID_MODEL', message: e.message },
          });
        }
        throw e;
      }

      // Process message through orchestrator (with overall request timeout)
      const timeoutMs = env.CHAT_REQUEST_TIMEOUT_MS ?? 55000;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const response = await Promise.race([
        chatOrchestrator.processMessage(
          {
            userId,
            conversationId: session_id,
            message: message.trim(),
            metadata,
            modelId,
          },
          {
            onProgress: (stage) => sendSSE(res, { type: 'progress', stage }),
            onChunk: (text) => sendSSE(res, { type: 'content', content: text }),
          }
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('CHAT_REQUEST_TIMEOUT')), timeoutMs)
        ),
      ]);

      await Usage.inc(userId, 'chatToday');

      sendSSE(res, {
        type: 'done',
        conversation_id: response.conversationId,
        response_id: response.response_id,
        message: response.message,
        sections: response.sections,
        intent: response.primaryIntent,
        user_level: response.user_level,
        low_confidence: response.low_confidence,
        safety_fallback: response.safety_fallback ?? false,
      });
      return res.end();
    } catch (error) {
      const err = error as Error & { message?: string; statusCode?: number };
      if (err instanceof InvalidModelForPlanError) {
        return res.status(400).json({
          error: { code: 'INVALID_MODEL', message: err.message },
        });
      }
      if (err.message === 'CHAT_REQUEST_TIMEOUT') {
        logger.warn('Chat request timeout', { userId: getAuth(req)?.userId });
        return res.status(504).json({
          error: { code: 'TIMEOUT', message: 'The request took too long. Please try again or shorten your message.' },
        });
      }
      const is413 =
        err.statusCode === 413 ||
        (err.message && (err.message.includes('413') || err.message.includes('Entity Too Large')));
      if (is413) {
        return res.status(413).json({
          error: {
            code: 'CONTEXT_TOO_LONG',
            message: 'This conversation or message is too long. Please start a new chat or shorten your message.',
          },
        });
      }
      logger.error('Chat controller error', {
        error: err.message,
        stack: err.stack,
      });

      return res.status(500).json({
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Failed to process chat message',
          ...(process.env.NODE_ENV === 'development' && { details: err.message }),
        },
      });
    }
  },

  /** Non-streaming: POST /api/chat/no-stream — same body, returns full JSON when done. */
  postChatNoStream: async (req: Request, res: Response) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        });
      }
      let { session_id, message, metadata, images, model_id } = req.body as {
        session_id?: string;
        message: string;
        metadata?: { instrument?: string; timeframe?: string; chartId?: string; [k: string]: unknown };
        images?: string[];
        model_id?: string;
      };

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Message is required and cannot be empty' },
        });
      }

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

      await Usage.ensureDailyRow(userId);
      const plan = await Usage.getPlan(userId);
      const { chatToday } = await Usage.getCounters(userId);
      if (plan === 'free' && chatToday >= Limits.free.maxChatPerDay) {
        return res.status(402).json({
          error: { code: 'RATE_LIMIT', message: 'Free plan daily chat limit reached. Upgrade to Pro.' },
        });
      }

      let modelId: string;
      try {
        modelId = await resolveModelId(userId, model_id);
      } catch (e) {
        if (e instanceof InvalidModelForPlanError) {
          return res.status(400).json({
            error: { code: 'INVALID_MODEL', message: e.message },
          });
        }
        throw e;
      }

      const timeoutMs = env.CHAT_REQUEST_TIMEOUT_MS ?? 55000;
      const response = await Promise.race([
        chatOrchestrator.processMessage({
          userId,
          conversationId: session_id,
          message: message.trim(),
          metadata,
          modelId,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('CHAT_REQUEST_TIMEOUT')), timeoutMs)
        ),
      ]);

      await Usage.inc(userId, 'chatToday');

      return res.json({
        conversation_id: response.conversationId,
        response_id: response.response_id,
        message: response.message,
        sections: response.sections,
        intent: response.primaryIntent,
        user_level: response.user_level,
        low_confidence: response.low_confidence,
        safety_fallback: response.safety_fallback ?? false,
      });
    } catch (error) {
      const err = error as Error & { message?: string; statusCode?: number };
      if (err instanceof InvalidModelForPlanError) {
        return res.status(400).json({
          error: { code: 'INVALID_MODEL', message: err.message },
        });
      }
      if (err.message === 'CHAT_REQUEST_TIMEOUT') {
        logger.warn('Chat request timeout', { userId: getAuth(req)?.userId });
        return res.status(504).json({
          error: { code: 'TIMEOUT', message: 'The request took too long. Please try again or shorten your message.' },
        });
      }
      const is413 =
        err.statusCode === 413 ||
        (err.message && (err.message.includes('413') || err.message.includes('Entity Too Large')));
      if (is413) {
        return res.status(413).json({
          error: {
            code: 'CONTEXT_TOO_LONG',
            message: 'This conversation or message is too long. Please start a new chat or shorten your message.',
          },
        });
      }
      logger.error('Chat controller error', {
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Failed to process chat message',
          ...(process.env.NODE_ENV === 'development' && { details: err.message }),
        },
      });
    }
  },
};
