/**
 * Provider-agnostic types and interface for chat LLM clients.
 * Used to abstract the model implementation and support easy switching.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  modelId?: string;
  allowedTools?: string[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: {
    type: 'json_object' | 'json_schema';
    json_schema?: unknown;
  };
}

export interface ChatCompletionResult {
  id: string;
  content: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ChatStreamCallbacks {
  onChunk?: (text: string) => void;
}

/**
 * Abstract chat LLM client. Implementations (e.g. Groq, OpenAI) provide
 * completions and streaming; modelId is passed per request for switching.
 */
export interface IChatLLMClient {
  completeChat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  completeChatStream(
    options: ChatCompletionOptions,
    callbacks: ChatStreamCallbacks
  ): Promise<ChatCompletionResult>;
}
