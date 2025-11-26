import type { Request, Response } from 'express';
import { ChatSession } from '../db/models/ChatSession.js';
import { ChatMessage } from '../db/models/ChatMessage.js';
import { Usage } from '../services/usage/usage.js';
import { Limits } from '../services/plans/limits.js';
import { chatLLM } from '../services/ai/chatLLM.js';
import { marketData } from '../services/market/marketData.js';

export const chatController = {
  postChat: async (req: Request, res: Response) => {
    const userId = (req as any).auth.userId as string;
    const { session_id, message } = req.body;

    // Enforce usage limits for Free
    await Usage.ensureDailyRow(userId);
    const plan = await Usage.getPlan(userId);
    const { chatToday } = await Usage.getCounters(userId);
    if (plan === 'free' && chatToday >= Limits.free.maxChatPerDay) {
      return res.status(402).json({ error: 'Free plan daily chat limit reached. Upgrade to Pro.' });
    }

    // Ensure session
    const session = await ChatSession.findOrCreate({
      where: { id: session_id },
      defaults: { userId, context: null },
    }).then(([s]) => s);

    // Persist user message
    await ChatMessage.create({ sessionId: session.id, role: 'user', content: message });

    // Fetch market context (example: BTC price & SP500 change)
    // NOTE: Replace with your actual context needs
    const prices = await marketData.getPrices({ symbols: ['BTCUSDT'] }).catch(() => null);
    const btcPrice = Array.isArray(prices)
      ? prices.find((p) => p.symbol === 'BTCUSDT')?.price
      : (prices?.BTCUSDT?.price ?? prices?.price);
    const btcStr = btcPrice ? `BTC: $${btcPrice}` : 'BTC: N/A';

    const prompt = `You're an expert trading assistant. Use current market data.
User: ${message}
Context: [${btcStr}]`;

    const answer = await chatLLM.generate(prompt); // inject Groq/OpenAI in service

    // Persist assistant message
    await ChatMessage.create({ sessionId: session.id, role: 'assistant', content: answer.text });

    // Increment usage
    await Usage.inc(userId, 'chatToday');

    return res.json({
      response_id: answer.id,
      text: answer.text,
      sources: answer.sources,
    });
  },
};
