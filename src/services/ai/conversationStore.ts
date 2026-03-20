import { ChatSession } from '../../db/models/ChatSession';
import { ChatMessage } from '../../db/models/ChatMessage';
import { logger } from '../../config/logger';
import type { GroqMessage } from './groqCompoundClient';
import { getChatLLM } from './llm/chatLLM';
import { env } from '../../config/env';

export interface SessionMetadata {
  user_level?: 'novice' | 'intermediate' | 'advanced';
  last_intent?: string;
  market_context?: Record<string, unknown>;
}

/**
 * Service for managing conversation sessions and message history.
 * Handles conversation continuity by retrieving recent messages for context.
 */
export class ConversationStore {
  /**
   * Deterministic fallback title when LLM title generation fails.
   */
  private generateFallbackTitle(message: string): string {
    const cleaned = message
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s'.,!?-]/g, '')
      .trim();
    if (!cleaned) return 'New conversation';
    const max = 64;
    if (cleaned.length <= max) return cleaned;
    const sliced = cleaned.slice(0, max).trim();
    const lastSpace = sliced.lastIndexOf(' ');
    return `${(lastSpace > 24 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
  }

  /**
   * Generate a short, human-like conversation title with the chat model.
   * Falls back to deterministic truncation on any error.
   */
  private async generateConversationTitle(message: string): Promise<string> {
    const fallback = this.generateFallbackTitle(message);
    try {
      const chatClient = getChatLLM(env.GROQ_MODEL ?? 'groq/compound');
      const titleResponse = await chatClient.completeChat({
        messages: [
          {
            role: 'system',
            content:
              'Generate a concise chat title (max 12 words) from the user message. Return only the title text with no quotes or punctuation decoration.',
          },
          { role: 'user', content: message.trim() },
        ],
        modelId: env.GROQ_MODEL ?? 'groq/compound',
        maxTokens: 24,
        temperature: 0.2,
      });
      const title = (titleResponse.content || '')
        .replace(/\s+/g, ' ')
        .replace(/^["'\s]+|["'\s]+$/g, '')
        .trim();

      if (!title) return fallback;
      if (title.length <= 128) return title;
      return `${title.slice(0, 125).trim()}...`;
    } catch (error) {
      logger.debug('Conversation title generation fallback', {
        error: (error as Error).message,
      });
      return fallback;
    }
  }

  /**
   * Get or create a conversation session for a user.
   * If conversationId is provided, retrieves existing session (must belong to user).
   * Otherwise, creates a new session.
   * For new sessions, pass `firstMessage` so the title is generated and stored on create.
   */
  async getOrCreateConversation(
    userId: string,
    conversationId?: string,
    options?: { firstMessage?: string }
  ): Promise<ChatSession> {
    if (conversationId) {
      const session = await ChatSession.findOne({
        where: { id: conversationId, userId },
      });

      if (!session) {
        logger.warn('Conversation not found or access denied', {
          conversationId,
          userId,
        });
        // Create new session if provided ID doesn't exist or doesn't belong to user
        return this.createConversation(userId, options?.firstMessage);
      }

      return session;
    }

    return this.createConversation(userId, options?.firstMessage);
  }

  /**
   * Create a new conversation session. When `firstMessage` is provided, generates the title
   * before insert so the row is created with its final title.
   */
  private async createConversation(userId: string, firstMessage?: string): Promise<ChatSession> {
    let title: string | null = null;
    const trimmed = firstMessage?.trim();
    if (trimmed) {
      title = await this.generateConversationTitle(trimmed);
    }

    const session = await ChatSession.create({
      userId,
      title,
      context: null,
    });

    logger.debug('Created new conversation session', {
      sessionId: session.id,
      userId,
      hasTitle: !!title,
    });

    return session;
  }

  /**
   * Retrieve the last N messages from a conversation for context.
   * Returns messages in chronological order (oldest of the window first), formatted for LLM consumption.
   * Default limit is 10 messages (approximately 4-6 conversation turns).
   */
  async getRecentMessages(conversationId: string, limit: number = 10): Promise<GroqMessage[]> {
    const messages = await ChatMessage.findAll({
      where: { sessionId: conversationId },
      order: [['createdAt', 'DESC']],
      limit,
    });

    // Reverse so chronological order (oldest of the recent window first)
    const chronological = [...messages].reverse();

    return chronological.map((msg) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));
  }

  /**
   * Save a message to the conversation.
   */
  async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<ChatMessage> {
    const message = await ChatMessage.create({
      sessionId: conversationId,
      role,
      content,
    });

    logger.debug('Saved message', {
      messageId: message.id,
      conversationId,
      role,
      contentLength: content.length,
    });

    // Touch session so list ordering reflects latest activity.
    await ChatSession.update({}, { where: { id: conversationId } });

    return message;
  }

  /**
   * List conversation sessions for a user, newest activity first.
   */
  async listConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<
    Array<{
      id: string;
      title: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const sessions = await ChatSession.findAll({
      where: { userId },
      order: [['updatedAt', 'DESC']],
      limit,
      offset,
    });
    return sessions.map((s) => {
      return {
        id: s.id,
        title: s.title || 'New conversation',
        createdAt: (s as any).createdAt as Date,
        updatedAt: (s as any).updatedAt as Date,
      };
    });
  }

  /**
   * Get full chat history for one conversation owned by the user.
   */
  async getConversationHistory(
    userId: string,
    conversationId: string
  ): Promise<{
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: Date;
    }>;
  } | null> {
    const session = await ChatSession.findOne({ where: { id: conversationId, userId } });
    if (!session) return null;

    const messages = await ChatMessage.findAll({
      where: { sessionId: conversationId },
      order: [['createdAt', 'ASC']],
    });
    return {
      id: session.id,
      title: session.title || 'New conversation',
      createdAt: (session as any).createdAt as Date,
      updatedAt: (session as any).updatedAt as Date,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        createdAt: (m as any).createdAt as Date,
      })),
    };
  }

  /**
   * Update session metadata (user_level, last_intent, market_context, etc.).
   * Merges with existing metadata to preserve other fields.
   */
  async updateSessionMetadata(
    conversationId: string,
    metadata: Partial<SessionMetadata>
  ): Promise<void> {
    const session = await ChatSession.findByPk(conversationId);
    if (!session) {
      throw new Error(`Session ${conversationId} not found`);
    }

    const existingMetadata = (session.context as SessionMetadata) || {};
    const updatedMetadata: SessionMetadata = {
      ...existingMetadata,
      ...metadata,
    };

    await session.update({ context: updatedMetadata });

    logger.debug('Updated session metadata', {
      conversationId,
      metadata: updatedMetadata,
    });
  }

  /**
   * Get session metadata.
   */
  async getSessionMetadata(conversationId: string): Promise<SessionMetadata | null> {
    const session = await ChatSession.findByPk(conversationId);
    if (!session) {
      return null;
    }

    return (session.context as SessionMetadata) || null;
  }
}

// Export singleton instance
export const conversationStore = new ConversationStore();
