import { Usage } from '../../usage/usage';
import {
  getDefaultModelForPlan,
  isModelAllowedForPlan,
  type Plan,
} from './allowedModels';

export class InvalidModelForPlanError extends Error {
  constructor(
    message: string,
    public readonly requestedModelId: string,
    public readonly plan: Plan
  ) {
    super(message);
    this.name = 'InvalidModelForPlanError';
  }
}

/**
 * Resolves the model id to use for a chat request.
 * - If requestedModelId is provided and allowed for the user's plan, returns it.
 * - If not provided or invalid, returns the default model for the plan.
 * - Throws InvalidModelForPlanError when a requested model is not on the plan's allowlist.
 */
export async function resolveModelId(
  userId: string,
  requestedModelId?: string | null
): Promise<string> {
  const plan = await Usage.getPlan(userId);
  const defaultModel = getDefaultModelForPlan(plan);

  if (!requestedModelId || requestedModelId.trim() === '') {
    return defaultModel;
  }

  const trimmed = requestedModelId.trim();
  if (!isModelAllowedForPlan(plan, trimmed)) {
    throw new InvalidModelForPlanError(
      `Model "${trimmed}" is not available on your plan.`,
      trimmed,
      plan
    );
  }

  return trimmed;
}
