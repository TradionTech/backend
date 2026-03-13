/**
 * Plan-based allowed chat models. Used by modelResolver to validate
 * user-requested model_id and to resolve the default model per plan.
 * Can be driven by env (CHAT_MODELS_FREE, CHAT_MODELS_PRO) or hardcoded.
 */

export type Plan = 'free' | 'pro';

const parseList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value || typeof value !== 'string') return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const defaultFree = ['groq/compound'];
const defaultPro = ['groq/compound'];

export const allowedModelsByPlan: Record<Plan, string[]> = {
  free: parseList(process.env.CHAT_MODELS_FREE, defaultFree),
  pro: parseList(process.env.CHAT_MODELS_PRO, defaultPro),
};

/** Default (first) model for each plan when user does not request one. */
export function getDefaultModelForPlan(plan: Plan): string {
  const list = allowedModelsByPlan[plan];
  if (!list || list.length === 0) return 'groq/compound';
  return list[0];
}

/** Whether the given model id is allowed for the plan. */
export function isModelAllowedForPlan(plan: Plan, modelId: string): boolean {
  const list = allowedModelsByPlan[plan];
  return list != null && list.includes(modelId);
}
