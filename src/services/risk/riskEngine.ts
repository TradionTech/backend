import type {
  RiskEvaluationRequest,
  RiskMetrics,
  RiskEvaluationResult,
} from './riskTypes';
import { evaluateRiskPolicy, type RiskPolicyConfig } from './riskPolicy';

const EPSILON = 1e-6;

export function computeRiskMetrics(input: RiskEvaluationRequest): RiskMetrics {
  const { tradeIntent, accountState } = input;
  const { entryPrice, stopPrice, targetPrice, quantity } = tradeIntent;
  const { equityUsd, openRiskUsd } = accountState;
  const { typicalRiskPerTradePct, typicalPositionSizeUsd } = input.userContext;

  // Calculate risk per trade in USD
  const riskPerTradeUsd = Math.abs(entryPrice - stopPrice) * quantity;

  // Calculate risk per trade as percentage of equity
  const riskPerTradePct = equityUsd > EPSILON
    ? (riskPerTradeUsd / equityUsd) * 100
    : 0;

  // Calculate reward in USD (if target price is provided)
  const rewardUsd = targetPrice != null
    ? Math.abs(targetPrice - entryPrice) * quantity
    : null;

  // Calculate risk-reward ratio
  const rrRatio = rewardUsd !== null && riskPerTradeUsd > EPSILON
    ? rewardUsd / riskPerTradeUsd
    : null;

  // Calculate total risk (existing + new trade)
  const totalRiskUsd = openRiskUsd + riskPerTradeUsd;

  // Calculate total risk as percentage of equity
  const totalRiskPct = equityUsd > EPSILON
    ? (totalRiskUsd / equityUsd) * 100
    : 0;

  // Calculate effective leverage
  const positionValue = entryPrice * quantity;
  const effectiveLeverage = equityUsd > EPSILON
    ? positionValue / equityUsd
    : 0;

  // Calculate risk vs typical factor
  const typicalRiskPct = Math.max(typicalRiskPerTradePct, EPSILON);
  const riskVsTypicalFactor = riskPerTradePct / typicalRiskPct;

  // Calculate size vs typical factor
  const typicalSize = Math.max(typicalPositionSizeUsd, EPSILON);
  const sizeVsTypicalFactor = positionValue / typicalSize;

  return {
    riskPerTradeUsd,
    riskPerTradePct,
    rewardUsd,
    rrRatio,
    totalRiskUsd,
    totalRiskPct,
    effectiveLeverage,
    riskVsTypicalFactor,
    sizeVsTypicalFactor,
  };
}

export function evaluateTradeRisk(
  input: RiskEvaluationRequest,
  cfg?: RiskPolicyConfig
): RiskEvaluationResult {
  const riskMetrics = computeRiskMetrics(input);
  const policyFlags = evaluateRiskPolicy(input.userContext, riskMetrics, cfg);

  return {
    riskMetrics,
    policyFlags,
    engineVersion: '2026-02-02',
  };
}
