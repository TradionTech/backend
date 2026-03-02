import { ChatSession } from '../../db/models/ChatSession';
import { ChatMessage } from '../../db/models/ChatMessage';
import { logger } from '../../config/logger';
import type { GroqMessage } from './groqCompoundClient';

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
   * Get or create a conversation session for a user.
   * If conversationId is provided, retrieves existing session (must belong to user).
   * Otherwise, creates a new session.
   */
  async getOrCreateConversation(userId: string, conversationId?: string): Promise<ChatSession> {
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
        return this.createConversation(userId);
      }

      return session;
    }

    return this.createConversation(userId);
  }

  /**
   * Create a new conversation session.
   */
  private async createConversation(userId: string): Promise<ChatSession> {
    const session = await ChatSession.create({
      userId,
      context: null,
    });

    logger.debug('Created new conversation session', {
      sessionId: session.id,
      userId,
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

    return message;
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
