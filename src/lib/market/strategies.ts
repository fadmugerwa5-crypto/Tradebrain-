import { atrSeries, bollinger, ema, macdHist, rsiSeries, windowVwap } from "./indicators.ts";
import type { Candle, Side } from "./types.ts";

/**
 * Scalping strategy library. Every strategy is a pure function of the candles up to bar i, so the same code is used
 * live (i = newest closed bar) and to measure how it did on the same market over its recent history.
 */
export type Ctx = {
  c: Candle[];
  close: number[];
  e9: Array<number | null>;
  e21: Array<number | null>;
  e50: Array<number | null>;
  rsi: Array<number | null>;
  rsi2: Array<number | null>;
  atr: Array<number | null>;
  bbUp: Array<number | null>;
  bbMid: Array<number | null>;
  bbw: Array<number | null>;
  hist: Array<number | null>;
  vwap: Array<number | null>;
  volR: Array<number | null>;
  adx: Array<number | null>;
};

export type Signal = { side: Side; stop: number; strength: number; why: string };

export type Strategy = {
  id: string;
  name: string;
  /** What the strategy is, in one line. */
  blurb: string;
  /** Runner target as a multiple of the stop distance. Kept at 1.5 or more so the risk engine's minimum reward:risk passes.
   *  The trade is normally banked earlier, at quickR. */
  rr: number;
  /** Where to bank a quick profit (in R) when scalping. */
  quickR: number;
  /** A trade that has not hit stop or target after this many bars is closed at the bar's close. */
  holdBars: number;
  signal: (x: Ctx, i: number) => Signal | null;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wilder ADX as a full series (the shared helper only returns the latest value). */
function adxSeries(c: Candle[], period = 14): Array<number | null> {
  const n = c.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (n < period * 2 + 1) return out;
  const tr: number[] = [0];
  const pdm: number[] = [0];
  const mdm: number[] = [0];
  for (let i = 1; i < n; i++) {
    const up = c[i]!.h - c[i - 1]!.h;
    const dn = c[i - 1]!.l - c[i]!.l;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c)));
  }
  let sTr = 0;
  let sP = 0;
  let sM = 0;
  for (let i = 1; i <= period; i++) {
    sTr += tr[i]!;
    sP += pdm[i]!;
    sM += mdm[i]!;
  }
  const dx: number[] = [];
  const dxAt = () => {
    const pdi = sTr > 0 ? (100 * sP) / sTr : 0;
    const mdi = sTr > 0 ? (100 * sM) / sTr : 0;
    return pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
  };
  dx.push(dxAt());
  let adxV: number | null = null;
  for (let i = period + 1; i < n; i++) {
    sTr = sTr - sTr / period + tr[i]!;
    sP = sP - sP / period + pdm[i]!;
    sM = sM - sM / period + mdm[i]!;
    const d = dxAt();
    dx.push(d);
    if (dx.length === period) adxV = dx.reduce((s, x) => s + x, 0) / period;
    else if (adxV != null) adxV = (adxV * (period - 1) + d) / period;
    if (adxV != null) out[i] = adxV;
  }
  return out;
}

export function buildCtx(candles: Candle[]): Ctx | null {
  if (candles.length < 60) return null;
  const close = candles.map((x) => x.c);
  const bb = bollinger(close);
  const vol = candles.map((x) => x.v);
  const volR = candles.map((_, i) => {
    if (i < 20) return null;
    let s = 0;
    for (let k = i - 20; k < i; k++) s += vol[k]!;
    const avg = s / 20;
    return avg > 0 ? vol[i]! / avg : null;
  });
  return {
    c: candles,
    close,
    e9: ema(close, 9),
    e21: ema(close, 21),
    e50: ema(close, 50),
    rsi: rsiSeries(close, 14),
    rsi2: rsiSeries(close, 2),
    atr: atrSeries(candles),
    bbUp: bb.up,
    bbMid: bb.mid,
    bbw: bb.mid.map((m, i) => (m ? (bb.up[i]! - bb.lo[i]!) / m : null)),
    hist: macdHist(close),
    vwap: windowVwap(candles),
    volR,
    adx: adxSeries(candles),
  };
}

/** Volume is optional: markets without volume (some Deriv feeds) pass the volume tests. */
const volAtLeast = (x: Ctx, i: number, min: number) => x.volR[i] == null || x.volR[i]! >= min;
const volBonus = (x: Ctx, i: number, per: number, cap: number) => (x.volR[i] == null ? 0 : clamp((x.volR[i]! - 1) * per, 0, cap));

/** Builds a signal with a stop at the structure level, padded a little and kept between 0.8 and 2.5 ATR. */
function make(x: Ctx, i: number, side: Side, structure: number, strength: number, why: string): Signal | null {
  const atr = x.atr[i];
  if (!(atr && atr > 0)) return null;
  const entry = x.c[i]!.c;
  const raw = side === "BUY" ? entry - structure : structure - entry;
  const dist = clamp((raw > 0 ? raw : atr * 1.2) + 0.1 * atr, 0.8 * atr, 2.5 * atr);
  return { side, stop: side === "BUY" ? entry - dist : entry + dist, strength: Math.round(clamp(strength, 0, 100)), why };
}

const lowest = (c: Candle[], from: number, to: number) => Math.min(...c.slice(Math.max(0, from), to + 1).map((b) => b.l));
const highest = (c: Candle[], from: number, to: number) => Math.max(...c.slice(Math.max(0, from), to + 1).map((b) => b.h));

const emaPullback: Strategy = {
  id: "ema-pullback",
  name: "EMA pullback",
  blurb: "Trend is stacked (EMA 9 over 21 over 50, or the reverse); price dips to the 21 EMA and turns back with the trend.",
  rr: 1.6,
  quickR: 0.7,
  holdBars: 14,
  signal(x, i) {
    const { c } = x;
    const e9 = x.e9[i], e21 = x.e21[i], e50 = x.e50[i], p21 = x.e21[i - 3], r = x.rsi[i], atr = x.atr[i];
    if (e9 == null || e21 == null || e50 == null || p21 == null || r == null || !atr) return null;
    const b = c[i]!;
    const adxOk = (x.adx[i] ?? 0) > 20 ? 8 : 0;
    if (e9 > e21 && e21 > e50 && e21 > p21 && Math.min(b.l, c[i - 1]!.l) <= e21 + 0.1 * atr && b.c > e9 && b.c > b.o && r >= 45 && r <= 70)
      return make(x, i, "BUY", lowest(c, i - 2, i), 55 + adxOk + volBonus(x, i, 15, 15) + (r >= 50 && r <= 62 ? 6 : 0), "Uptrend stack, dipped to the 21 EMA and closed back above the 9 EMA.");
    if (e9 < e21 && e21 < e50 && e21 < p21 && Math.max(b.h, c[i - 1]!.h) >= e21 - 0.1 * atr && b.c < e9 && b.c < b.o && r >= 30 && r <= 55)
      return make(x, i, "SELL", highest(c, i - 2, i), 55 + adxOk + volBonus(x, i, 15, 15) + (r >= 38 && r <= 50 ? 6 : 0), "Downtrend stack, popped to the 21 EMA and closed back below the 9 EMA.");
    return null;
  },
};

const vwapReclaim: Strategy = {
  id: "vwap-reclaim",
  name: "VWAP reclaim",
  blurb: "Price crosses back through VWAP on volume, in the direction of the 50 EMA.",
  rr: 1.6,
  quickR: 0.7,
  holdBars: 12,
  signal(x, i) {
    const { c } = x;
    const v = x.vwap[i], pv = x.vwap[i - 1], e50 = x.e50[i], e9 = x.e9[i], e21 = x.e21[i];
    if (v == null || pv == null || e50 == null || e9 == null || e21 == null) return null;
    const b = c[i]!;
    const prev = c[i - 1]!;
    if (prev.c < pv && b.c > v && b.c > b.o && b.c > e50 && volAtLeast(x, i, 1))
      return make(x, i, "BUY", lowest(c, i - 1, i), 52 + volBonus(x, i, 20, 20) + (e9 > e21 ? 10 : 0), "Closed back above VWAP after trading below it.");
    if (prev.c > pv && b.c < v && b.c < b.o && b.c < e50 && volAtLeast(x, i, 1))
      return make(x, i, "SELL", highest(c, i - 1, i), 52 + volBonus(x, i, 20, 20) + (e9 < e21 ? 10 : 0), "Closed back below VWAP after trading above it.");
    return null;
  },
};

const squeezeBreak: Strategy = {
  id: "squeeze-break",
  name: "Squeeze breakout",
  blurb: "Bollinger bands were squeezed tight, then price closes outside a band on above-average volume.",
  rr: 1.8,
  quickR: 0.8,
  holdBars: 16,
  signal(x, i) {
    if (i < 110) return null;
    const w = x.bbw[i];
    const up = x.bbUp[i], mid = x.bbMid[i];
    if (w == null || up == null || mid == null) return null;
    const past = x.bbw.slice(i - 100, i).filter((v): v is number => v != null);
    if (past.length < 60) return null;
    const recentMin = Math.min(...x.bbw.slice(i - 6, i).filter((v): v is number => v != null));
    const rank = past.filter((v) => v <= recentMin).length / past.length;
    if (rank > 0.25) return null;
    const b = x.c[i]!;
    const lo = mid - (up - mid);
    if (b.c > up && volAtLeast(x, i, 1.3)) return make(x, i, "BUY", mid, 58 + volBonus(x, i, 15, 20) + (1 - rank) * 10, "Broke above the upper band right after a squeeze.");
    if (b.c < lo && volAtLeast(x, i, 1.3)) return make(x, i, "SELL", mid, 58 + volBonus(x, i, 15, 20) + (1 - rank) * 10, "Broke below the lower band right after a squeeze.");
    return null;
  },
};

const rsi2Revert: Strategy = {
  id: "rsi2-revert",
  name: "RSI(2) snap-back",
  blurb: "Very short RSI is stretched against the 50 EMA trend; the snap back to the fast average is scalped.",
  rr: 1.5,
  quickR: 0.6,
  holdBars: 8,
  signal(x, i) {
    const r2 = x.rsi2[i], e50 = x.e50[i], e9 = x.e9[i];
    if (r2 == null || e50 == null || e9 == null) return null;
    const b = x.c[i]!;
    if (r2 < 10 && b.c > e50 && b.c < e9) return make(x, i, "BUY", lowest(x.c, i - 1, i), 52 + (10 - r2) * 2.5, `RSI(2) is ${r2.toFixed(0)} inside an uptrend, stretched under the 9 EMA.`);
    if (r2 > 90 && b.c < e50 && b.c > e9) return make(x, i, "SELL", highest(x.c, i - 1, i), 52 + (r2 - 90) * 2.5, `RSI(2) is ${r2.toFixed(0)} inside a downtrend, stretched over the 9 EMA.`);
    return null;
  },
};

const rangeBreak: Strategy = {
  id: "range-break",
  name: "Range breakout momentum",
  blurb: "Close beyond the last 20 bars' high or low, with a strong body, trend strength (ADX) and volume.",
  rr: 1.8,
  quickR: 0.8,
  holdBars: 14,
  signal(x, i) {
    const { c } = x;
    const e21 = x.e21[i], a = x.adx[i];
    if (e21 == null || a == null || a < 20) return null;
    const b = c[i]!;
    const range = b.h - b.l;
    if (!(range > 0) || Math.abs(b.c - b.o) < 0.5 * range || !volAtLeast(x, i, 1.2)) return null;
    const hh = highest(c, i - 20, i - 1);
    const ll = lowest(c, i - 20, i - 1);
    const bonus = clamp((a - 20) * 1.2, 0, 15) + volBonus(x, i, 15, 15);
    if (b.c > hh && b.c > e21) return make(x, i, "BUY", lowest(c, i - 3, i), 55 + bonus, "Closed above the 20-bar high with a strong body.");
    if (b.c < ll && b.c < e21) return make(x, i, "SELL", highest(c, i - 3, i), 55 + bonus, "Closed below the 20-bar low with a strong body.");
    return null;
  },
};

const sweepReversal: Strategy = {
  id: "sweep-reversal",
  name: "Liquidity sweep reversal",
  blurb: "Price spikes through the last 20 bars' low or high to grab stops, then closes back inside with a long wick.",
  rr: 1.8,
  quickR: 0.8,
  holdBars: 12,
  signal(x, i) {
    const { c } = x;
    const b = c[i]!;
    const range = b.h - b.l;
    if (!(range > 0)) return null;
    const pl = lowest(c, i - 20, i - 1);
    const ph = highest(c, i - 20, i - 1);
    const lowWick = Math.min(b.o, b.c) - b.l;
    const upWick = b.h - Math.max(b.o, b.c);
    if (b.l < pl && b.c > pl && lowWick >= 0.45 * range && b.c > b.o) return make(x, i, "BUY", b.l, 58 + (lowWick / range) * 20 + volBonus(x, i, 10, 10), "Swept the 20-bar low and closed back above it.");
    if (b.h > ph && b.c < ph && upWick >= 0.45 * range && b.c < b.o) return make(x, i, "SELL", b.h, 58 + (upWick / range) * 20 + volBonus(x, i, 10, 10), "Swept the 20-bar high and closed back below it.");
    return null;
  },
};

const macdBurst: Strategy = {
  id: "macd-burst",
  name: "MACD momentum burst",
  blurb: "MACD histogram flips through zero with price on the right side of the 21 EMA and RSI in the momentum zone.",
  rr: 1.6,
  quickR: 0.7,
  holdBars: 12,
  signal(x, i) {
    const h = x.hist[i], hp = x.hist[i - 1], e21 = x.e21[i], e50 = x.e50[i], r = x.rsi[i];
    if (h == null || hp == null || e21 == null || e50 == null || r == null) return null;
    const b = x.c[i]!;
    if (hp <= 0 && h > 0 && b.c > e21 && e21 > e50 && r >= 50 && r <= 72 && volAtLeast(x, i, 1.1)) return make(x, i, "BUY", lowest(x.c, i - 2, i), 54 + volBonus(x, i, 15, 15) + clamp((x.adx[i] ?? 0) - 18, 0, 10), "MACD histogram turned positive above the 21 EMA.");
    if (hp >= 0 && h < 0 && b.c < e21 && e21 < e50 && r <= 50 && r >= 28 && volAtLeast(x, i, 1.1)) return make(x, i, "SELL", highest(x.c, i - 2, i), 54 + volBonus(x, i, 15, 15) + clamp((x.adx[i] ?? 0) - 18, 0, 10), "MACD histogram turned negative below the 21 EMA.");
    return null;
  },
};

/**
 * Failed-breakout return, a rolling-window version of the DTR Range Breakout Return preset: price closes outside the last
 * 20-bar range, then the very next bar closes back inside with a rejecting body. The failure is traded, stop beyond the extreme.
 * (The preset uses a fixed 08:12-09:12 ET range on index futures; there is no such session on these markets.)
 */
const failedBreak: Strategy = {
  id: "failed-break",
  name: "Failed breakout return",
  blurb: "Price closes outside the last 20-bar range, then the next bar closes back inside with a rejecting body. The failed break is traded the other way.",
  rr: 1.8,
  quickR: 0.7,
  holdBars: 10,
  signal(x, i) {
    const { c } = x;
    if (i < 30) return null;
    const hi = highest(c, i - 26, i - 7);
    const lo = lowest(c, i - 26, i - 7);
    const b = c[i]!;
    const p = c[i - 1]!;
    if (!volAtLeast(x, i, 0.8)) return null;
    if (p.c > hi && b.c < hi && b.c < b.o) {
      // the bar before was outside; it must be the first close outside in the last 6 bars
      for (let j = i - 6; j < i - 1; j++) if (c[j]!.c > hi) return null;
      return make(x, i, "SELL", highest(c, i - 3, i), 54 + volBonus(x, i, 10, 10), "Broke above the 20-bar range, closed back inside next bar.");
    }
    if (p.c < lo && b.c > lo && b.c > b.o) {
      for (let j = i - 6; j < i - 1; j++) if (c[j]!.c < lo) return null;
      return make(x, i, "BUY", lowest(c, i - 3, i), 54 + volBonus(x, i, 10, 10), "Broke below the 20-bar range, closed back inside next bar.");
    }
    return null;
  },
};

/** Previous UTC day's high and low, only when that whole day is in the loaded candles. */
function priorDay(c: Candle[], i: number): { hi: number; lo: number; start: number } | null {
  const D = 86_400_000;
  const day = Math.floor(c[i]!.t / D);
  let s0 = i;
  while (s0 > 0 && Math.floor(c[s0 - 1]!.t / D) === day) s0--;
  if (s0 < 2) return null;
  const prev = day - 1;
  let p0 = s0 - 1;
  if (Math.floor(c[p0]!.t / D) !== prev) return null;
  while (p0 > 0 && Math.floor(c[p0 - 1]!.t / D) === prev) p0--;
  const step = c[1]!.t - c[0]!.t;
  // the previous day must be complete: it has to start within one bar of its midnight
  if (c[p0]!.t - prev * D > Math.max(step, 1)) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = p0; j < s0; j++) {
    hi = Math.max(hi, c[j]!.h);
    lo = Math.min(lo, c[j]!.l);
  }
  return { hi, lo, start: s0 };
}

/** Port of PDH/PDL Sweep Fade. Needs a whole previous day in view, so it only fires on timeframes where 300 candles reach back that far. */
const priorDaySweep: Strategy = {
  id: "prior-day-sweep",
  name: "Previous-day high/low sweep",
  blurb: "Price spikes through yesterday's high or low, then closes back inside with a long wick. Traded against the sweep, once per side per day.",
  rr: 1.8,
  quickR: 0.8,
  holdBars: 12,
  signal(x, i) {
    const d = priorDay(x.c, i);
    if (!d) return null;
    const b = x.c[i]!;
    const range = b.h - b.l;
    if (!(range > 0)) return null;
    const upWick = b.h - Math.max(b.o, b.c);
    const lowWick = Math.min(b.o, b.c) - b.l;
    if (b.h > d.hi && b.c < d.hi && upWick >= 0.4 * range && b.c < b.o) {
      for (let j = d.start; j < i; j++) if (x.c[j]!.h > d.hi) return null;
      return make(x, i, "SELL", b.h, 56 + (upWick / range) * 20 + volBonus(x, i, 10, 10), "Swept yesterday's high and closed back below it.");
    }
    if (b.l < d.lo && b.c > d.lo && lowWick >= 0.4 * range && b.c > b.o) {
      for (let j = d.start; j < i; j++) if (x.c[j]!.l < d.lo) return null;
      return make(x, i, "BUY", b.l, 56 + (lowWick / range) * 20 + volBonus(x, i, 10, 10), "Swept yesterday's low and closed back above it.");
    }
    return null;
  },
};

export const STRATEGIES: Strategy[] = [emaPullback, vwapReclaim, squeezeBreak, rsi2Revert, rangeBreak, sweepReversal, macdBurst, failedBreak, priorDaySweep];

export function strategyById(id: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

/**
 * Walks forward from bar i and trades it the way the scalp rules do: stop at 1R, stop moved to breakeven once price is lockR in
 * profit, profit banked at quickR, otherwise closed at the bar's close after holdBars. The stop wins when one bar touches both
 * the stop and the profit level (the cautious reading). Returns R before costs, or null when the data ends before the trade resolves.
 */
export function simulate(c: Candle[], i: number, side: Side, stop: number, quickR: number, lockR: number, holdBars: number): number | null {
  const entry = c[i]!.c;
  const dist = Math.abs(entry - stop);
  if (!(dist > 0)) return null;
  const dir = side === "BUY" ? 1 : -1;
  const useLock = lockR > 0 && lockR < quickR;
  let locked = false;
  const end = i + holdBars;
  for (let j = i + 1; j <= end; j++) {
    const b = c[j];
    if (!b) return null;
    const stopP = locked ? entry : stop;
    if (dir === 1 ? b.l <= stopP : b.h >= stopP) return locked ? 0 : -1;
    const fav = (dir * ((dir === 1 ? b.h : b.l) - entry)) / dist;
    if (fav >= quickR) return quickR;
    if (useLock && !locked && fav >= lockR) {
      locked = true;
      if (dir === 1 ? b.l <= entry : b.h >= entry) return 0;
    }
    if (j === end) return (dir * (b.c - entry)) / dist;
  }
  return null;
}

export type Edge = {
  trades: number;
  wins: number;
  winRate: number;
  /** Average result per trade in R, after costs, pulled toward zero when there are few trades. */
  expectancy: number;
  /** Average result per trade in R, after costs, not pulled. */
  avgR: number;
  profitFactor: number;
};

/** How this strategy did on this market's loaded history. Same signals, traded with the scalp exit rules, fees and slippage included. */
export function measureEdge(x: Ctx, s: Strategy, costFrac: number, lookback = 220, upTo = x.c.length - 2, lockR = 0.4): Edge {
  const from = Math.max(55, upTo - lookback);
  const rs: number[] = [];
  let skipUntil = -1;
  for (let i = from; i <= upTo; i++) {
    if (i < skipUntil) continue;
    const sig = s.signal(x, i);
    if (!sig) continue;
    const gross = simulate(x.c, i, sig.side, sig.stop, s.quickR, lockR, s.holdBars);
    if (gross == null) continue;
    const entry = x.c[i]!.c;
    const dist = Math.abs(entry - sig.stop);
    rs.push(gross - (costFrac * entry) / dist);
    skipUntil = i + 3;
  }
  const n = rs.length;
  const sum = rs.reduce((a, b) => a + b, 0);
  const win = rs.filter((r) => r > 0).length;
  const gw = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const gl = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  return { trades: n, wins: win, winRate: n ? win / n : 0, expectancy: sum / (n + 4), avgR: n ? sum / n : 0, profitFactor: gl > 0 ? gw / gl : gw > 0 ? 9.99 : 0 };
}
