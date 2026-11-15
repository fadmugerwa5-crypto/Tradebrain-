import type { BookPosition } from "./account.ts";

export type Stats = { n: number; wins: number; winRate: number; avgWin: number; avgLoss: number; net: number; profitFactor: number | null; expectancy: number };

/** Closed trades only, using the result the app recorded for each. */
export function summarize(positions: BookPosition[], pick: (p: BookPosition) => boolean = () => true): Stats {
  const done = positions.filter((p) => p.status === "closed" && p.pnl != null && pick(p));
  const w = done.filter((p) => (p.pnl ?? 0) > 0);
  const l = done.filter((p) => (p.pnl ?? 0) < 0);
  const gw = w.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const gl = l.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const n = done.length;
  return {
    n,
    wins: w.length,
    winRate: n ? w.length / n : 0,
    avgWin: w.length ? gw / w.length : 0,
    avgLoss: l.length ? gl / l.length : 0,
    net: gw + gl,
    profitFactor: gl < 0 ? gw / Math.abs(gl) : null,
    expectancy: n ? (gw + gl) / n : 0,
  };
}
