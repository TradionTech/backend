import axios, { AxiosError } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqChatOptions {
  messages: GroqMessage[];
  allowedTools?: string[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: {
    type: 'json_object' | 'json_schema';
    json_schema?: any;
  };
}

export interface GroqChatResponse {
  id: string;
  content: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GroqIntentResponse {
  intents: Array<{
    intent:
      | 'education'
      | 'analysis'
      | 'clarification'
      | 'validation'
      | 'risk_evaluation'
      | 'position_sizing'
      | 'risk_policy_explanation'
      | 'chart_analysis'
      | 'journal_coaching'
      | 'journal_overview'
      | 'journal_recent'
      | 'journal_pattern_detection'
      | 'sentiment_snapshot';
    confidence: number; // 0-1
  }>;
  primaryIntent:
    | 'education'
    | 'analysis'
    | 'clarification'
    | 'validation'
    | 'risk_evaluation'
    | 'position_sizing'
    | 'risk_policy_explanation'
    | 'chart_analysis'
    | 'journal_coaching'
    | 'journal_overview'
    | 'journal_recent'
    | 'journal_pattern_detection'
    | 'sentiment_snapshot'; // For backward compatibility
  user_level: 'novice' | 'intermediate' | 'advanced';
}

/**
 * Internal type for Groq API response structure (snake_case from API).
 */
interface GroqChatAPIChoice {
  message: { content: string };
  finish_reason: string;
  // Compound model may include additional fields:
  // message.executed_tools, message.reasoning, etc.
}

interface GroqChatAPIResponse {
  id: string;
  choices: GroqChatAPIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Client for interacting with Groq's Compound model via OpenAI-compatible API.
 * Supports chat completions and intent detection.
 */
export class GroqCompoundClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.groq.com/openai/v1';
  private readonly model = 'groq/compound';
  private readonly defaultTimeout: number;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;

  constructor() {
    this.apiKey = env.GROQ_API_KEY;
    if (!this.apiKey) {
      logger.warn('GROQ_API_KEY not set - Groq client will fail on API calls');
    }
    // Use defaults from env or fallback to safe defaults
    this.defaultTimeout = env.GROQ_TIMEOUT || 30000;
    this.defaultTemperature = env.GROQ_TEMPERATURE || 0.7;
    this.defaultMaxTokens = env.GROQ_MAX_TOKENS || 2000;
  }

  /**
   * Complete a chat conversation using Groq Compound model.
   * Supports built-in tool selection for web_search, code_interpreter, browser_automation, wolfram_alpha.
   * Uses compound_custom.tools.enabled_tools for built-in Compound tools (not OpenAI-style function tools).
   */
  async completeChat(options: GroqChatOptions): Promise<GroqChatResponse> {
    const {
      messages,
      allowedTools = [],
      maxTokens = this.defaultMaxTokens,
      temperature = this.defaultTemperature,
      responseFormat,
    } = options;

    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    // Build compound_custom for built-in tools (web_search, code_interpreter, etc.)
    // Note: This is different from OpenAI-style function tools
    const compound_custom =
      allowedTools.length > 0 ? { tools: { enabled_tools: allowedTools } } : undefined;

    const requestBody: any = {
      model: this.model,
      messages,
      max_completion_tokens: maxTokens, // Use max_completion_tokens instead of deprecated max_tokens
      temperature,
    };

    // Add compound_custom if tools are enabled
    if (compound_custom) {
      requestBody.compound_custom = compound_custom;
    }

    // Add response_format if specified (for JSON mode)
    if (responseFormat) {
      requestBody.response_format = responseFormat;
    }

    // NOTE: metadata is not supported in Groq chat completions API
    // If you need metadata, use the Responses API (/v1/responses) instead

    try {
      logger.debug('Calling Groq API', {
        model: this.model,
        messageCount: messages.length,
        hasTools: !!compound_custom,
        enabledTools: allowedTools,
        maxTokens,
        temperature,
        hasResponseFormat: !!responseFormat,
      });

      const { data } = await axios.post<GroqChatAPIResponse>(
        `${this.baseUrl}/chat/completions`,
        requestBody,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.defaultTimeout,
        }
      );

      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('No response choice returned from Groq API');
      }

      const content = choice.message?.content || '';
      const finishReason = choice.finish_reason || 'stop';

      // Map usage from snake_case (API) to camelCase (interface)
      const rawUsage = data.usage;
      const usage = rawUsage
        ? {
            promptTokens: rawUsage.prompt_tokens,
            completionTokens: rawUsage.completion_tokens,
            totalTokens: rawUsage.total_tokens,
          }
        : undefined;

      logger.debug('Groq API response received', {
        finishReason,
        contentLength: content.length,
        usage,
      });

      return {
        id: data.id || `groq_${Date.now()}`,
        content,
        finishReason,
        usage,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorData = axiosError.response.data as any;
        const message =
          errorData?.error?.message || axiosError.message;
        logger.error('Groq API error', {
          status,
          error: message,
          type: errorData?.error?.type,
        });
        const err = new Error(
          `Groq API error (${status}): ${message}`
        ) as Error & { statusCode?: number };
        err.statusCode = status;
        throw err;
      } else if (axiosError.request) {
        logger.error('Groq API network error', { message: axiosError.message });
        throw new Error(`Groq API network error: ${axiosError.message}`);
      } else {
        logger.error('Groq API request setup error', { message: axiosError.message });
        throw new Error(`Groq API error: ${axiosError.message}`);
      }
    }
  }

  /**
   * Detect user intent and experience level using a lightweight Groq call.
   * Returns structured JSON with intent classification and user level assessment.
   * Uses JSON mode for guaranteed valid JSON parsing.
   */
  async detectIntent(
    message: string,
    conversationHistory: GroqMessage[] = []
  ): Promise<GroqIntentResponse> {
    const systemPrompt = `You are an intent classifier for a trading education platform. Analyze the user's message and conversation context to determine:

1. ALL Intents detected in the message (array of intents with confidence scores):
   - education: User wants to learn about trading concepts, strategies, or markets
   - analysis: User wants analysis of a specific market, instrument, or situation
   - clarification: User is asking for clarification on a previous response
   - validation: User wants validation or feedback on their trading idea/strategy
    - risk_evaluation: User is asking "Is this trade too risky?" or wants risk assessment of a specific trade
    - position_sizing: User is asking "How big should my position be?" or questions about position sizing
    - risk_policy_explanation: User is asking "Why is my risk limit X?" or questions about risk policy/limits
    - chart_analysis: User wants to analyze a trading chart image, asking about patterns, trends, or price action
    - journal_coaching: User wants coaching/feedback on their trading performance, asking "how am I doing", "review my trades", "coach me"
    - journal_overview: User wants an overview of their trading performance over a period
    - journal_recent: User wants analysis of their recent trading performance
    - journal_pattern_detection: User wants to identify patterns in their trading history
    - sentiment_snapshot: User is asking about market sentiment, mood, or asking "What's the sentiment on X?", "How does sentiment look on X?", "Is sentiment bullish or bearish on X?"

   A single message may contain multiple intents. For example, "Explain what a stop loss is and also confirm if my EURUSD trade is too risky" contains both "education" and "risk_evaluation" intents.

2. Primary Intent: The most prominent or highest confidence intent (for backward compatibility)

3. User level (one of: novice, intermediate, advanced):
   - novice: Beginner asking basic questions, needs step-by-step explanations
   - intermediate: Has some knowledge, asks more specific questions
   - advanced: Experienced trader asking sophisticated questions about strategies, risk, etc.

Respond with valid JSON in this exact format:
{
  "intents": [
    {"intent": "education", "confidence": 0.9},
    {"intent": "risk_evaluation", "confidence": 0.85}
  ],
  "primaryIntent": "education",
  "user_level": "novice"
}

If only one intent is detected, return an array with a single element. The primaryIntent should be the intent with the highest confidence.`;

    const historyContext =
      conversationHistory.length > 0
        ? `\n\nConversation history (last ${conversationHistory.length} messages):\n${conversationHistory
            .slice(-5)
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n')}`
        : '';

    const userMessage = `User message: ${message}${historyContext}\n\nClassify the intent and user level.`;

    try {
      const response = await this.completeChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        maxTokens: 200,
        temperature: 0.3, // Lower temperature for more consistent classification
        responseFormat: { type: 'json_object' }, // Use JSON mode for guaranteed valid JSON
      });

      // Parse JSON response (with JSON mode, content should be valid JSON)
      const content = response.content.trim();
      let parsed: any;

      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        // Fallback: try to extract JSON from text if model added extra text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          logger.warn('Failed to parse intent detection JSON', { content });
          // Fallback to single intent format
          return {
            intents: [{ intent: 'education', confidence: 1.0 }],
            primaryIntent: 'education',
            user_level: 'intermediate',
          };
        }
      }

      // Handle backward compatibility: if old format (single intent), convert to new format
      if (parsed.intent && !parsed.intents) {
        parsed.intents = [{ intent: parsed.intent, confidence: parsed.confidence || 1.0 }];
        parsed.primaryIntent = parsed.intent;
      }

      // Validate and normalize intents array
      const validIntents = [
        'education',
        'analysis',
        'clarification',
        'validation',
        'risk_evaluation',
        'position_sizing',
        'risk_policy_explanation',
        'chart_analysis',
        'journal_coaching',
        'journal_overview',
        'journal_recent',
        'journal_pattern_detection',
        'sentiment_snapshot',
      ];
      const validLevels = ['novice', 'intermediate', 'advanced'];

      const intents = (parsed.intents || []).map((item: any) => ({
        intent: validIntents.includes(item.intent) ? item.intent : 'education',
        confidence:
          typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 1.0,
      }));

      // If no intents, fallback to education
      if (intents.length === 0) {
        intents.push({ intent: 'education', confidence: 1.0 });
      }

      // Determine primary intent (highest confidence, or first if equal)
      const primaryIntent =
        parsed.primaryIntent && validIntents.includes(parsed.primaryIntent)
          ? parsed.primaryIntent
          : intents.reduce(
              (prev: any, curr: any) => (curr.confidence > prev.confidence ? curr : prev),
              intents[0]
            ).intent;

      const user_level = validLevels.includes(parsed.user_level)
        ? parsed.user_level
        : 'intermediate';

      return {
        intents,
        primaryIntent,
        user_level,
      };
    } catch (error) {
      logger.error('Intent detection failed', { error: (error as Error).message });
      // Fallback to safe defaults
      return {
        intents: [{ intent: 'education', confidence: 1.0 }],
        primaryIntent: 'education',
        user_level: 'intermediate',
      };
    }
  }
}

// Export singleton instance
export const groqCompoundClient = new GroqCompoundClient();
