/** Pure, testable primitives for intrabar Jump Scalper analysis.
 * These functions do not place orders. A live tick feed and broker-specific
 * execution/risk integration are required before signals may be traded.
 */
export type Tick = { at: number; price: number; bid?: number; ask?: number };
export type JumpAssessment = {
  state: "dead" | "oscillating" | "trending" | "explosive" | "insufficient";
  score: number;
  amplitudePct: number;
  reversals: number;
  pathEfficiency: number;
  spreadPct: number;
  direction: "BUY" | "SELL" | "WAIT";
  reason: string;
};

export function assessJump(ticks: Tick[], opts: { minTicks?: number; minAmplitudePct?: number; maxSpreadPct?: number } = {}): JumpAssessment {
  const minTicks = opts.minTicks ?? 12;
  const minAmplitudePct = opts.minAmplitudePct ?? 0.025;
  const maxSpreadPct = opts.maxSpreadPct ?? 0.08;
  const valid = ticks.filter(t => Number.isFinite(t.price) && t.price > 0).slice(-80);
  const insufficient: JumpAssessment = { state: "insufficient", score: 0, amplitudePct: 0, reversals: 0, pathEfficiency: 1, spreadPct: 0, direction: "WAIT", reason: "Waiting for enough live ticks." };
  if (valid.length < minTicks) return insufficient;
  const prices = valid.map(t => t.price);
  const first = prices[0]!, last = prices.at(-1)!;
  const high = Math.max(...prices), low = Math.min(...prices), mid = (high + low) / 2;
  const amplitudePct = mid ? ((high - low) / mid) * 100 : 0;
  let path = 0, reversals = 0, previousSign = 0;
  for (let i = 1; i < prices.length; i++) {
    const delta = prices[i]! - prices[i - 1]!;
    path += Math.abs(delta);
    const sign = Math.sign(delta);
    if (sign && previousSign && sign !== previousSign) reversals++;
    if (sign) previousSign = sign;
  }
  const pathEfficiency = path > 0 ? Math.abs(last - first) / path : 1;
  const spreads = valid.filter(t => t.bid && t.ask && t.ask >= t.bid).map(t => ((t.ask! - t.bid!) / t.price) * 100);
  const spreadPct = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;
  const netMovePct = first ? ((last - first) / first) * 100 : 0;
  const explosive = amplitudePct > Math.max(minAmplitudePct * 8, 0.5);
  const oscillating = amplitudePct >= minAmplitudePct && reversals >= 3 && pathEfficiency < 0.62;
  const state = explosive ? "explosive" : oscillating ? "oscillating" : amplitudePct < minAmplitudePct / 2 ? "dead" : pathEfficiency > 0.78 ? "trending" : "dead";
  const recent = prices.slice(-5);
  const recentMove = recent.at(-1)! - recent[0]!;
  const direction = state === "oscillating" && spreadPct <= maxSpreadPct && Math.abs(recentMove) > 0
    ? (recentMove > 0 ? "BUY" : "SELL") : "WAIT";
  const score = Math.max(0, Math.min(100, Math.round((Math.min(reversals, 8) / 8) * 35 + Math.min(amplitudePct / (minAmplitudePct * 4), 1) * 35 + (1 - pathEfficiency) * 30 - (spreadPct > maxSpreadPct ? 40 : 0))));
  const reason = spreadPct > maxSpreadPct ? "Spread is too wide for micro-scalping." : state !== "oscillating" ? `Market state is ${state}; waiting for repeatable swings.` : direction === "WAIT" ? "No short-term directional turn confirmed." : `Oscillation detected; short-term movement currently favors ${direction}.`;
  return { state, score, amplitudePct, reversals, pathEfficiency, spreadPct, direction, reason };
}

export function netProfitAfterCosts(grossPnl: number, fees: number, slippage: number): number {
  return grossPnl - Math.max(0, fees) - Math.max(0, slippage);
}

export function shouldCollectProfit(netPnl: number, targetNetUsd: number): boolean {
  return Number.isFinite(netPnl) && targetNetUsd > 0 && netPnl >= targetNetUsd;
}

export function riskSizedQuantity(equity: number, riskPct: number, stopDistance: number, maxNotionalPct = 20): number {
  if (!(equity > 0 && riskPct > 0 && stopDistance > 0)) return 0;
  const riskBudget = equity * Math.min(riskPct, 1) / 100;
  const byStop = riskBudget / stopDistance;
  const byNotional = equity * Math.max(0, maxNotionalPct) / 100;
  return Math.max(0, Math.min(byStop, byNotional / Math.max(stopDistance, 1e-12)));
}
