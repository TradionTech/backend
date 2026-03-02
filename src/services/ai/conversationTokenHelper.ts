import type { GroqMessage } from './groqCompoundClient';

/** Approximate chars per token (conservative for English/mixed content). */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a string using a simple heuristic.
 * Uses ~4 chars per token; no external tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
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
