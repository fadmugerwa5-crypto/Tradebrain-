import type { Style, Vote } from "./types.ts";

export type Proposal = { stop?: number; target?: number };
export type Levels = { entry: number; stop: number; target: number; source: string };

const BOUNDS: Record<Style, { stopLo: number; stopHi: number; tgtLo: number; tgtHi: number; floorPct: number; minRR: number }> = {
  scalp: { stopLo: 0.25, stopHi: 4, tgtLo: 0.3, tgtHi: 6, floorPct: 0.0003, minRR: 0.5 },
  trader: { stopLo: 0.5, stopHi: 6, tgtLo: 0.8, tgtHi: 15, floorPct: 0.001, minRR: 1.2 },
};

/**
 * Entry is always the current price (market order). A proposed stop or target is kept only if it is on the right side
 * of the price and a sensible distance away for the style (scalp: stop 0.25 to 4 ATR, trader: 0.5 to 6 ATR).
 * Otherwise ATR-based levels are used. This is a sanity check on typos and hallucinated prices, not a strategy rule.
 */
export function resolveLevels(side: Exclude<Vote, "WAIT">, price: number, atr: number, proposals: Proposal[], rr: number, style: Style = "scalp"): Levels {
  const b = BOUNDS[style];
  const dir = side === "BUY" ? 1 : -1;
  const minStop = Math.max(atr * b.stopLo, price * b.floorPct);
  const goodStop = (s: number | undefined) => {
    if (s == null || !Number.isFinite(s)) return false;
    const d = (price - s) * dir;
    return d >= minStop && d <= atr * b.stopHi;
  };
  const goodTarget = (t: number | undefined) => {
    if (t == null || !Number.isFinite(t)) return false;
    const d = (t - price) * dir;
    return d >= atr * b.tgtLo && d <= atr * b.tgtHi;
  };
  const sp = proposals.find((p) => goodStop(p.stop));
  const stopDist = sp ? (price - sp.stop!) * dir : Math.max(style === "trader" ? atr * 1.5 : atr, minStop);
  // A target that pays less than the style's minimum reward for the risk is replaced too.
  const tp = proposals.find((p) => goodTarget(p.target) && (p.target! - price) * dir >= stopDist * b.minRR);
  const target = tp ? tp.target! : price + dir * stopDist * Math.max(0.5, rr);
  const stop = price - dir * stopDist;
  return { entry: price, stop, target, source: `${sp ? "agent stop" : "ATR stop"}, ${tp ? "agent target" : `${rr}R target`}` };
}
