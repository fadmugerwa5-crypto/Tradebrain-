import { assessJump, netProfitAfterCosts, shouldCollectProfit, type Tick, type JumpAssessment } from './jump-scalper.ts';

export type JumpSide = 'BUY' | 'SELL';
export type JumpConfig = {
  enabled: boolean;
  minScore: number;
  maxSpreadPct: number;
  targetNetUsd: number;
  riskPct: number;
  maxOpenPositions: number;
  maxPerMarket: number;
  maxDailyLossPct: number;
  maxHoldMs: number;
  cooldownMs: number;
  minStopPct: number;
  maxNotionalPct: number;
};
export const JUMP_DEFAULTS: JumpConfig = {
  enabled: false, minScore: 72, maxSpreadPct: 0.06, targetNetUsd: 0.5,
  riskPct: 0.25, maxOpenPositions: 4, maxPerMarket: 1,
  maxDailyLossPct: 2, maxHoldMs: 90_000, cooldownMs: 45_000,
  minStopPct: 0.08, maxNotionalPct: 10,
};
export type JumpOpportunity = { venue: 'binance'|'deriv'; symbol: string; assessment: JumpAssessment; updatedAt: number; rank: number };
export type JumpMemoryRecord = { id: string; venue: 'binance'|'deriv'; symbol: string; side: JumpSide; score: number; state: string; spreadPct: number; entry: number; exit?: number; netPnl?: number; openedAt: number; closedAt?: number; outcome?: 'win'|'loss'|'flat'; exitReason?: string };
export type JumpPositionView = { id: string; venue: 'binance'|'deriv'; symbol: string; side: JumpSide; qty: number; entry: number; stop: number; openedAt: number; feesEstimate: number; slippageEstimate: number };
export type JumpRiskContext = { equity: number; dayStartEquity: number; openPositions: JumpPositionView[]; now: number; feedFresh: boolean; armed: boolean; liveUnlocked: boolean; isLive: boolean; venueConnected: boolean };
export type JumpEntryDecision = { ok: boolean; side?: JumpSide; qty?: number; stop?: number; targetNetUsd?: number; reason: string };

export function rankOpportunity(a: JumpAssessment, winRate: number, sampleSize: number): number {
  const confidence = sampleSize >= 8 ? Math.max(-12, Math.min(12, (winRate - 0.5) * 24)) : 0;
  return Math.max(0, Math.min(100, a.score + confidence - (a.state === 'explosive' ? 35 : 0)));
}

export function decideJumpEntry(input: { venue:'binance'|'deriv'; symbol:string; ticks:Tick[]; config:JumpConfig; risk:JumpRiskContext; marketCooldownUntil:number; feeRate?:number; slippageRate?:number }): JumpEntryDecision {
  const { config, risk } = input;
  if (!config.enabled) return { ok:false, reason:'Jump Scalper is disabled.' };
  if (!risk.armed) return { ok:false, reason:'Auto trading is disarmed.' };
  if (!risk.venueConnected) return { ok:false, reason:'Broker is not connected.' };
  if (!risk.feedFresh || !input.ticks.length || risk.now - input.ticks.at(-1)!.at > 5_000) return { ok:false, reason:'Live tick feed is stale.' };
  if (risk.equity <= 0 || risk.dayStartEquity <= 0) return { ok:false, reason:'Account equity is unavailable.' };
  if (risk.dayStartEquity - risk.equity >= risk.dayStartEquity * config.maxDailyLossPct / 100) return { ok:false, reason:'Daily loss limit reached.' };
  if (risk.openPositions.length >= config.maxOpenPositions) return { ok:false, reason:'Maximum simultaneous positions reached.' };
  if (risk.openPositions.filter(p => p.symbol === input.symbol).length >= config.maxPerMarket) return { ok:false, reason:'Maximum positions for this market reached.' };
  if (risk.now < input.marketCooldownUntil) return { ok:false, reason:'Market is cooling down after its previous trade.' };
  if (risk.isLive && !risk.liveUnlocked) return { ok:false, reason:'Real-money trading is locked. Explicitly unlock live trading first.' };
  const a = assessJump(input.ticks, { maxSpreadPct: config.maxSpreadPct });
  if (a.state !== 'oscillating' || a.direction === 'WAIT' || a.score < config.minScore) return { ok:false, reason:`No qualified jump setup: ${a.reason}` };
  const last = input.ticks.at(-1)!.price;
  const stopDistance = last * config.minStopPct / 100;
  const riskBudget = risk.equity * Math.min(config.riskPct, 1) / 100;
  const byStop = riskBudget / stopDistance;
  const maxNotional = risk.equity * Math.max(0, config.maxNotionalPct) / 100;
  const qty = Math.max(0, Math.min(byStop, maxNotional / last));
  if (!(qty > 0)) return { ok:false, reason:'Calculated position size is below a valid minimum.' };
  const feeRate = Math.max(0, input.feeRate ?? 0.001);
  const slippageRate = Math.max(0, input.slippageRate ?? 0.0002);
  const estimatedRoundTripCost = last * qty * (feeRate * 2 + slippageRate * 2);
  const estimatedMove = last * (a.amplitudePct / 100) * qty * 0.25;
  if (estimatedMove - estimatedRoundTripCost < config.targetNetUsd) return { ok:false, reason:'Expected movement does not cover costs and the configured net-profit target.' };
  return { ok:true, side:a.direction, qty, stop:a.direction === 'BUY' ? last-stopDistance : last+stopDistance, targetNetUsd:config.targetNetUsd, reason:`Qualified oscillation score ${a.score}; ${a.reversals} reversals; spread ${a.spreadPct.toFixed(4)}%.` };
}

export function decideJumpExit(input: { position:JumpPositionView; mark:number; now:number; grossPnl:number; fees:number; slippage:number; config:JumpConfig }): { close:boolean; netPnl:number; reason:string } {
  const netPnl = netProfitAfterCosts(input.grossPnl, input.fees, input.slippage);
  if (shouldCollectProfit(netPnl, input.config.targetNetUsd)) return { close:true, netPnl, reason:`Net profit target reached (${netPnl.toFixed(2)}).` };
  const stopped = input.position.side === 'BUY' ? input.mark <= input.position.stop : input.mark >= input.position.stop;
  if (stopped) return { close:true, netPnl, reason:'Protective stop reached.' };
  if (input.config.maxHoldMs > 0 && input.now - input.position.openedAt >= input.config.maxHoldMs) return { close:true, netPnl, reason:'Maximum holding time reached.' };
  return { close:false, netPnl, reason:'Continue managing position.' };
}

export function summarizeMemory(records:JumpMemoryRecord[]) {
  const closed = records.filter(r => r.outcome);
  const wins = closed.filter(r => r.outcome === 'win').length;
  const net = closed.reduce((s,r) => s + (r.netPnl ?? 0), 0);
  const winsPnl = closed.filter(r => (r.netPnl ?? 0) > 0).reduce((s,r) => s + (r.netPnl ?? 0), 0);
  const lossesPnl = Math.abs(closed.filter(r => (r.netPnl ?? 0) < 0).reduce((s,r) => s + (r.netPnl ?? 0), 0));
  return { trades:closed.length, wins, losses:closed.length-wins, winRate:closed.length ? wins/closed.length : 0, netPnl:net, profitFactor:lossesPnl ? winsPnl/lossesPnl : winsPnl ? Infinity : 0 };
}
