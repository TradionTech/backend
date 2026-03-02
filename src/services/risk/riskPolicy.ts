import type {
  UserContext,
  RiskMetrics,
  PolicyFlag,
  PolicyFlagCode,
  PolicyFlagSeverity,
  RiskProfile,
} from './riskTypes';

export interface RiskPolicyConfig {
  maxRiskPerTradePct: Record<RiskProfile, number>;
  maxTotalOpenRiskPct: number;
  maxLeverage: number;
  minRrRatio: number;
  maxRiskVsTypicalFactor: number;
  maxSizeVsTypicalFactor: number;
}

export const defaultRiskPolicyConfig: RiskPolicyConfig = {
  maxRiskPerTradePct: {
    conservative: 0.5,
    moderate: 1.0,
    aggressive: 2.0,
  },
  maxTotalOpenRiskPct: 5.0,
  maxLeverage: 3.0,
  minRrRatio: 2.0,
  maxRiskVsTypicalFactor: 2.0,
  maxSizeVsTypicalFactor: 2.0,
};

function createFlag(
  code: PolicyFlagCode,
  severity: PolicyFlagSeverity,
  message: string
): PolicyFlag {
  return { code, severity, message };
}

export function evaluateRiskPolicy(
  userContext: UserContext,
  metrics: RiskMetrics,
  cfg: RiskPolicyConfig = defaultRiskPolicyConfig
): PolicyFlag[] {
  const flags: PolicyFlag[] = [];

  // Check: RISK_PER_TRADE_TOO_HIGH
  const maxRiskForProfile = cfg.maxRiskPerTradePct[userContext.riskProfile];
  if (metrics.riskPerTradePct > maxRiskForProfile) {
    const excess = metrics.riskPerTradePct - maxRiskForProfile;
    const severity: PolicyFlagSeverity =
      excess > maxRiskForProfile * 0.5 ? 'high' : excess > maxRiskForProfile * 0.25 ? 'warning' : 'info';
    flags.push(
      createFlag(
        'RISK_PER_TRADE_TOO_HIGH',
        severity,
        `Risk per trade (${metrics.riskPerTradePct.toFixed(2)}%) exceeds ${userContext.riskProfile} profile limit (${maxRiskForProfile}%)`
      )
    );
  }

  // Check: TOTAL_RISK_TOO_HIGH
  if (metrics.totalRiskPct > cfg.maxTotalOpenRiskPct) {
    const excess = metrics.totalRiskPct - cfg.maxTotalOpenRiskPct;
    const severity: PolicyFlagSeverity =
      excess > cfg.maxTotalOpenRiskPct * 0.5 ? 'high' : excess > cfg.maxTotalOpenRiskPct * 0.25 ? 'warning' : 'info';
    flags.push(
      createFlag(
        'TOTAL_RISK_TOO_HIGH',
        severity,
        `Total open risk (${metrics.totalRiskPct.toFixed(2)}%) exceeds maximum allowed (${cfg.maxTotalOpenRiskPct}%)`
      )
    );
  }

  // Check: LEVERAGE_TOO_HIGH
  if (metrics.effectiveLeverage > cfg.maxLeverage) {
    const excess = metrics.effectiveLeverage - cfg.maxLeverage;
    const severity: PolicyFlagSeverity =
      excess > cfg.maxLeverage * 0.5 ? 'high' : excess > cfg.maxLeverage * 0.25 ? 'warning' : 'info';
    flags.push(
      createFlag(
        'LEVERAGE_TOO_HIGH',
        severity,
        `Effective leverage (${metrics.effectiveLeverage.toFixed(2)}x) exceeds maximum allowed (${cfg.maxLeverage}x)`
      )
    );
  }

  // Check: RR_TOO_LOW
  if (metrics.rrRatio !== null && metrics.rrRatio < cfg.minRrRatio) {
    const shortfall = cfg.minRrRatio - metrics.rrRatio;
    const severity: PolicyFlagSeverity =
      shortfall > cfg.minRrRatio * 0.5 ? 'high' : shortfall > cfg.minRrRatio * 0.25 ? 'warning' : 'info';
    flags.push(
      createFlag(
        'RR_TOO_LOW',
        severity,
        `Risk-reward ratio (${metrics.rrRatio.toFixed(2)}) is below minimum recommended (${cfg.minRrRatio})`
      )
    );
  }

  // Check: ABOVE_TYPICAL_RISK
  if (metrics.riskVsTypicalFactor > cfg.maxRiskVsTypicalFactor) {
    const excess = metrics.riskVsTypicalFactor - cfg.maxRiskVsTypicalFactor;
    const severity: PolicyFlagSeverity = excess > cfg.maxRiskVsTypicalFactor * 0.5 ? 'high' : excess > cfg.maxRiskVsTypicalFactor * 0.25 ? 'warning' : 'info';
    flags.push(
      createFlag(
        'ABOVE_TYPICAL_RISK',
        severity,
        `Risk per trade (${metrics.riskVsTypicalFactor.toFixed(2)}x typical) significantly exceeds your typical risk level`
      )
    );
  }

  // Check: ABOVE_TYPICAL_SIZE
  if (metrics.sizeVsTypicalFactor > cfg.maxSizeVsTypicalFactor) {
    const excess = metrics.sizeVsTypicalFactor - cfg.maxSizeVsTypicalFactor;
    const severity: PolicyFlagSeverity = excess > cfg.maxSizeVsTypicalFactor * 0.5 ? 'high' : excess > cfg.maxSizeVsTypicalFactor * 0.25 ? 'warning' : 'info';
    flags.push(
      createFlag(
        'ABOVE_TYPICAL_SIZE',
        severity,
        `Position size (${metrics.sizeVsTypicalFactor.toFixed(2)}x typical) significantly exceeds your typical position size`
      )
    );
  }

  return flags;
}
