import type { Request, Response } from 'express';
import { RiskCalculation } from '../db/models/RiskCalculation';

function calcLotSize(balance: number, riskPercent: number, entry: number, sl: number) {
  const riskAmount = balance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entry - sl);
  if (riskPerUnit <= 0) throw Object.assign(new Error('Invalid SL vs Entry'), { status: 422 });
  return riskAmount / riskPerUnit;
}

export const riskController = {
  calculate: async (req: Request, res: Response) => {
    const userId = (req as any).auth.userId as string;
    const { account_balance, risk_percent, entry, stop_loss, take_profit, symbol } = req.body;

    if (
      (entry > stop_loss && take_profit && take_profit <= entry) ||
      (entry < stop_loss && take_profit && take_profit >= entry)
    ) {
      return res.status(422).json({ error: 'Illogical SL/TP relative to entry' });
    }

    const lot_size = calcLotSize(account_balance, risk_percent, entry, stop_loss);
    const pip_risk = Math.abs(entry - stop_loss);
    const monetary_risk = account_balance * (risk_percent / 100);
    const risk_reward_ratio = take_profit
      ? Math.abs((take_profit - entry) / (entry - stop_loss))
      : null;

    const monetary_gain = take_profit ? Math.abs(take_profit - entry) * lot_size : null;
    const new_balance_sl = account_balance - monetary_risk;
    const new_balance_tp = monetary_gain ? account_balance + monetary_gain : null;

    const result = {
      lot_size: Number(lot_size.toFixed(2)),
      monetary_risk: Number(monetary_risk.toFixed(2)),
      risk_reward_ratio: risk_reward_ratio ? Number(risk_reward_ratio.toFixed(2)) : null,
      pip_risk: Number(pip_risk.toFixed(5)),
      monetary_gain: monetary_gain ? Number(monetary_gain.toFixed(2)) : null,
      new_balance_sl: Number(new_balance_sl.toFixed(2)),
      new_balance_tp: new_balance_tp ? Number(new_balance_tp.toFixed(2)) : null,
    };

    await RiskCalculation.create({
      userId,
      params: { account_balance, risk_percent, entry, stop_loss, take_profit, symbol },
      result,
    });

    return res.json(result);
  },
};
