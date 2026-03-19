import type { GroqMessage } from './groqCompoundClient';
import { env } from '../../config/env';

/** Lazy-loaded tokenizer (gpt-tokenizer). Used for accurate token counts; falls back to char estimate if unavailable. */
let tokenizerModule: { encode: (text: string) => number[] } | undefined | null = null;

function getTokenizer(): { encode: (text: string) => number[] } | undefined {
  if (tokenizerModule === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      tokenizerModule = require('gpt-tokenizer') as { encode: (text: string) => number[] };
    } catch {
      tokenizerModule = undefined;
    }
  }
  return tokenizerModule ?? undefined;
}

/**
 * Estimate token count for a string.
 * Uses gpt-tokenizer when available (OpenAI-style BPE); otherwise falls back to char-based heuristic
 * using CONVERSATION_CHARS_PER_TOKEN (default 4).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  const t = getTokenizer();
  if (t) {
    try {
      return t.encode(text).length;
    } catch {
      // Fall through to char-based
    }
  }
  const charsPerToken = env.CONVERSATION_CHARS_PER_TOKEN ?? 4;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Trim conversation history to fit within a token budget.
 * Keeps the most recent messages (drops oldest from the start until under budget).
 * Only user and assistant messages are counted and returned; system messages are excluded.
 *
 * @param messages - Chronological list of messages (oldest first)
 * @param maxTokens - Maximum total tokens for the returned history
 * @returns Subset of messages in chronological order that fits within maxTokens
 */
export function trimHistoryToTokenBudget(
  messages: GroqMessage[],
  maxTokens: number
): GroqMessage[] {
  const eligible = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  ) as GroqMessage[];

  if (eligible.length === 0 || maxTokens <= 0) return [];

  let total = 0;
  let startIndex = 0;

  // Count tokens from the end (most recent) backward
  for (let i = eligible.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(eligible[i].content);
    if (total + tokens > maxTokens && i < eligible.length - 1) {
      // Keep messages from (i+1) to end
      startIndex = i + 1;
      break;
    }
    total += tokens;
    if (i === 0) startIndex = 0;
  }

  return eligible.slice(startIndex);
}
