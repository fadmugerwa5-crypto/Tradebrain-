import { STRATEGIES, buildCtx, simulate } from "../market/strategies.ts";
import { SWING_STRATEGIES, SWING_COST, buildSwingCtx, maxBarsFor, signalOf, simulateSwing } from "../trade/swing.ts";
import { ROUND_TRIP_COST } from "../trade/scalp.ts";
import type { Candle, Side } from "../market/types.ts";
import { alignOf, detectRegime, htfBias, sessionOf, tfOf } from "./regime.ts";
import { metricsOfR, type Metrics } from "./stats.ts";
import type { Align, Regime } from "./types.ts";

export type LabTrade = { i: number; t: number; strategy: string; side: Side; r: number; regime: Regime; align: Align; split: "train" | "validation" | "holdout" };
export type LabInput = { candles: Candle[]; kind: "scalp" | "swing"; costFrac?: number; htfMin: number; lockR?: number; sessMin?: number; dailyFilter?: boolean };
export type Row = { strategy: string; train: Metrics; validation: Metrics; holdout: Metrics; all: Metrics };
export type LabResult = {
  assumptions: string[];
  bars: number;
  bounds: { train: [number, number]; validation: [number, number]; holdout: [number, number] };
  trades: LabTrade[];
  rows: Row[];
  baseline: Row;
  /** The same trades, keeping only those with the higher-timeframe bias (or no known bias). */
  filtered: Row;
  byRegime: { regime: string; m: Metrics }[];
  noTradeR: 0;
};

const rowOf = (name: string, ts: LabTrade[]): Row => {
  const rs = (s: LabTrade["split"] | null) => ts.filter((t) => s == null || t.split === s).sort((a, b) => a.i - b.i).map((t) => t.r);
  return { strategy: name, train: metricsOfR(rs("train")), validation: metricsOfR(rs("validation")), holdout: metricsOfR(rs("holdout")), all: metricsOfR(rs(null)) };
};

/**
 * Chronological train / validation / holdout (50 / 25 / 25 of the bars, never shuffled). Each signal uses only candles up to its own bar.
 * Costs are charged on every trade. Results are for research on the loaded history, not a forecast.
 */
export function runLab(inp: LabInput): LabResult {
  const c = inp.candles;
  const tfMs = tfOf(c);
  const n = c.length;
  const cost = inp.costFrac ?? (inp.kind === "swing" ? SWING_COST : ROUND_TRIP_COST);
  const first = 60;
  const span = Math.max(1, n - 2 - first);
  const b1 = first + Math.floor(span * 0.5);
  const b2 = first + Math.floor(span * 0.75);
  const splitOf = (i: number): LabTrade["split"] => (i < b1 ? "train" : i < b2 ? "validation" : "holdout");
  const raw: { i: number; strategy: string; side: Side; r: number; bars: number }[] = [];
  if (inp.kind === "scalp") {
    const x = buildCtx(c);
    if (x) {
      for (const s of STRATEGIES) {
        let skip = -1;
        for (let i = first; i < n - 1; i++) {
          if (i < skip) continue;
          const sig = s.signal(x, i);
          if (!sig) continue;
          const g = simulate(c, i, sig.side, sig.stop, s.quickR, inp.lockR ?? 0.4, s.holdBars);
          if (g == null) continue;
          const entry = c[i]!.c;
          const dist = Math.abs(entry - sig.stop);
          raw.push({ i, strategy: s.id, side: sig.side, r: g - (cost * entry) / dist, bars: 3 });
          skip = i + 3;
        }
      }
    }
  } else {
    const x = buildSwingCtx(c, tfMs, inp.sessMin ?? 0);
    if (x) {
      for (const s of SWING_STRATEGIES) {
        let skip = -1;
        const maxBars = maxBarsFor(s, tfMs);
        for (let i = Math.max(first, 55); i < n - 1; i++) {
          if (i < skip) continue;
          const sig = signalOf(s, x, i, inp.dailyFilter ?? false);
          if (!sig) continue;
          const entry = c[i]!.c;
          const dist = Math.abs(entry - sig.stop);
          if (!(dist > 0)) continue;
          const target = sig.side === "BUY" ? entry + s.rr * dist : entry - s.rr * dist;
          const sim = simulateSwing(c, i, sig.side, sig.stop, target, maxBars);
          if (!sim) continue;
          raw.push({ i, strategy: s.id, side: sig.side, r: sim.r - (cost * entry) / dist, bars: sim.bars });
          skip = i + sim.bars + 1;
        }
      }
    }
  }
  const trades: LabTrade[] = raw.map((t) => {
    const win = c.slice(Math.max(0, t.i - 260), t.i + 1);
    const rg = detectRegime(win);
    const hb = htfBias(win, tfMs, inp.htfMin);
    return { i: t.i, t: c[t.i]!.t, strategy: t.strategy, side: t.side, r: t.r, regime: rg.regime, align: alignOf(t.side, hb.bias), split: splitOf(t.i) };
  });
  const ids = [...new Set(trades.map((t) => t.strategy))];
  const rows = ids.map((id) => rowOf(id, trades.filter((t) => t.strategy === id))).sort((a, b) => b.all.expectancy - a.all.expectancy);
  const regimes = [...new Set(trades.map((t) => t.regime))];
  return {
    assumptions: [
      `Candles loaded: ${n} at ${Math.round(tfMs / 60_000)}m. Split by time: train ${b1 - first} bars, validation ${b2 - b1}, holdout ${n - 2 - b2}.`,
      `Round-trip cost charged on every trade: ${(cost * 100).toFixed(3)}% of price (fees + slippage). Real spread, latency and fills can be worse.`,
      inp.kind === "scalp" ? `Scalp exits: quick profit per strategy, stop moves to breakeven at ${inp.lockR ?? 0.4}R, stop wins if one bar touches both.` : "Swing exits: stop or target, otherwise closed at the time limit; stop wins if one bar touches both.",
      "Each signal uses only candles up to its own bar. Higher-timeframe bias and regime are computed from data available at that bar.",
      "Not a forecast. A good holdout on one market and period is evidence, not a guarantee.",
    ],
    bars: n,
    bounds: { train: [first, b1], validation: [b1, b2], holdout: [b2, n - 2] },
    trades,
    rows,
    baseline: rowOf("All strategies (baseline)", trades),
    filtered: rowOf("Only with the higher-timeframe bias", trades.filter((t) => t.align !== "against")),
    byRegime: regimes.map((r) => ({ regime: r, m: metricsOfR(trades.filter((t) => t.regime === r).sort((a, b) => a.i - b.i).map((t) => t.r)) })).sort((a, b) => b.m.n - a.m.n),
    noTradeR: 0,
  };
}
