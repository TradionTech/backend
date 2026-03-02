import { estimateTokens, trimHistoryToTokenBudget } from '../conversationTokenHelper';
import type { GroqMessage } from '../groqCompoundClient';

describe('conversationTokenHelper', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('uses ~4 chars per token', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcdefgh')).toBe(2);
      expect(estimateTokens('a'.repeat(400))).toBe(100);
    });
  });

  describe('trimHistoryToTokenBudget', () => {
    const msg = (role: 'user' | 'assistant', content: string): GroqMessage => ({
      role,
      content,
    });

    it('returns empty array when messages is empty', () => {
      expect(trimHistoryToTokenBudget([], 1000)).toEqual([]);
    });

    it('returns empty array when maxTokens is 0', () => {
      expect(
        trimHistoryToTokenBudget(
          [msg('user', 'Hello'), msg('assistant', 'Hi')],
          0
        )
      ).toEqual([]);
    });

    it('excludes system messages from count and result', () => {
      const messages: GroqMessage[] = [
        { role: 'system', content: 'You are a bot' },
        msg('user', 'Hi'),
        msg('assistant', 'Hello'),
      ];
      const result = trimHistoryToTokenBudget(messages, 100);
      expect(result).toHaveLength(2);
      expect(result.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
    });

    it('keeps most recent messages when over budget', () => {
      // Each message ~25 chars -> ~7 tokens. Budget 20 tokens -> keep last 2 full messages
      const messages = [
        msg('user', 'First user message here'),
        msg('assistant', 'First assistant reply here'),
        msg('user', 'Second user message here'),
        msg('assistant', 'Second assistant reply'),
      ];
      const result = trimHistoryToTokenBudget(messages, 20);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Second user message here');
      expect(result[1].content).toBe('Second assistant reply');
    });

    it('returns all messages when under budget', () => {
      const messages = [msg('user', 'Hi'), msg('assistant', 'Hello')];
      const result = trimHistoryToTokenBudget(messages, 100);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Hi');
      expect(result[1].content).toBe('Hello');
    });

    it('preserves chronological order', () => {
      const messages = [
        msg('user', 'A'),
        msg('assistant', 'B'),
        msg('user', 'C'),
        msg('assistant', 'D'),
      ];
      const result = trimHistoryToTokenBudget(messages, 10);
      expect(result.map((m) => m.content)).toEqual(['C', 'D']);
    });
  });
});
