import type { IChatLLMClient } from './types';
import { groqCompoundClient } from '../groqCompoundClient';
import { env } from '../../../config/env';

/**
 * Provider prefix (first segment of model id, e.g. "groq" from "groq/compound").
 * Add entries here when plugging in new providers (openai, claude, etc.).
 */
export type ChatLLMProvider = 'groq';

const providerClients: Record<ChatLLMProvider, IChatLLMClient> = {
  groq: groqCompoundClient,
  // openai: openaiChatClient,   // add when implementing OpenAI
  // claude: claudeChatClient,   // add when implementing Claude
};

/**
 * Returns the provider prefix for a given model id.
 * Model ids use the form "provider/model" (e.g. groq/compound, openai/gpt-4o).
 * @throws if the provider is not supported (no client registered).
 */
export function getProviderFromModelId(modelId: string): ChatLLMProvider {
  const prefix = modelId.split('/')[0]?.toLowerCase();
  if (prefix === 'groq') return 'groq';
  // if (prefix === 'openai') return 'openai';
  // if (prefix === 'claude') return 'claude';
  throw new Error(`Unsupported chat provider for model: ${modelId}. Supported: groq.`);
}

/**
 * Returns the chat LLM client for the given provider/model.
 * Use this for provider selection: the resolved model_id (e.g. groq/compound)
 * determines which provider handles the request. Pass the same modelId into
 * completeChat/completeChatStream options so the client can use the correct model name.
 *
 * @param modelId - Full model id (e.g. "groq/compound"). When omitted, uses
 *   env.GROQ_MODEL or "groq/compound" so internal callers get the default Groq client.
 */
export function getChatLLM(modelId?: string): IChatLLMClient {
  const resolved =
    (modelId && modelId.trim()) || env.GROQ_MODEL || 'groq/compound';
  const provider = getProviderFromModelId(resolved);
  return providerClients[provider];
}
