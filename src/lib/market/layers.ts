import type { Candle } from "./types.ts";

export type LayerLine = { price: number; label: string; why: string; kind: "pdh" | "pdl" | "eqh" | "eql" };

/**
 * Previous UTC day high/low. Derived only from candles actually loaded; if the loaded window
 * does not contain a full previous day, nothing is returned rather than guessing.
 */
export function previousDayLevels(candles: Candle[]): { high: number; low: number; day: string } | null {
  if (candles.length < 2) return null;
  const dayOf = (t: number) => Math.floor(t / 86_400_000);
  const today = dayOf(candles[candles.length - 1]!.t);
  const prevDay = today - 1;
  const rows = candles.filter((c) => dayOf(c.t) === prevDay);
  if (!rows.length) return null;
  // The window must reach back to the start of that day to count as complete.
  if (dayOf(candles[0]!.t) === prevDay && candles[0]!.t % 86_400_000 !== 0) return null;
  return {
    high: Math.max(...rows.map((c) => c.h)),
    low: Math.min(...rows.map((c) => c.l)),
    day: new Date(prevDay * 86_400_000).toISOString().slice(0, 10),
  };
}

/** Equal highs / equal lows: two or more swing points within `tol` of each other. These are common liquidity pools. */
export function equalLevels(
  piv: { highs: { p: number; i: number }[]; lows: { p: number; i: number }[] },
  tol: number,
): { highs: { price: number; n: number }[]; lows: { price: number; n: number }[] } {
  const group = (pts: { p: number; i: number }[]) => {
    const out: { price: number; n: number }[] = [];
    for (const pt of pts) {
      const m = out.find((g) => Math.abs(g.price - pt.p) <= tol);
      if (m) {
        m.price = (m.price * m.n + pt.p) / (m.n + 1);
        m.n++;
      } else out.push({ price: pt.p, n: 1 });
    }
    return out.filter((g) => g.n >= 2);
  };
  return { highs: group(piv.highs), lows: group(piv.lows) };
}

export type Pivot = { i: number; p: number };

/** HH / LH for swing highs and HL / LL for swing lows, each compared with the previous swing of the same kind. */
export function swingLabels(piv: { highs: Pivot[]; lows: Pivot[] }): { i: number; p: number; label: "HH" | "LH" | "HL" | "LL"; high: boolean }[] {
  const out: { i: number; p: number; label: "HH" | "LH" | "HL" | "LL"; high: boolean }[] = [];
  piv.highs.forEach((h, k) => {
    if (k > 0) out.push({ i: h.i, p: h.p, label: h.p > piv.highs[k - 1]!.p ? "HH" : "LH", high: true });
  });
  piv.lows.forEach((l, k) => {
    if (k > 0) out.push({ i: l.i, p: l.p, label: l.p > piv.lows[k - 1]!.p ? "HL" : "LL", high: false });
  });
  return out.sort((a, b) => a.i - b.i);
}

export type Trendline = { kind: "support" | "resistance"; a: Pivot; b: Pivot; why: string };

/**
 * Trendlines from the two most recent confirmed swings of one kind.
 * Support: last two swing lows, rising. Resistance: last two swing highs, falling.
 * Anything else yields no line, so a flat or ambiguous market draws nothing.
 */
export function trendlines(piv: { highs: Pivot[]; lows: Pivot[] }): Trendline[] {
  const out: Trendline[] = [];
  const [l1, l2] = piv.lows.slice(-2);
  if (l1 && l2 && l2.p > l1.p) out.push({ kind: "support", a: l1, b: l2, why: "Rising line through the last two swing lows." });
  const [h1, h2] = piv.highs.slice(-2);
  if (h1 && h2 && h2.p < h1.p) out.push({ kind: "resistance", a: h1, b: h2, why: "Falling line through the last two swing highs." });
  return out;
}

/** Price on a trendline at candle index i. */
export function lineAt(t: Trendline, i: number): number {
  const slope = (t.b.p - t.a.p) / (t.b.i - t.a.i);
  return t.a.p + slope * (i - t.a.i);
}
