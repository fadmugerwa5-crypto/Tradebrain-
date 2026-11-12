import { atrSeries, ema, quality, rsiSeries } from "../market/indicators.ts";
import type { Signal } from "../market/strategies.ts";
import { INTERVAL_MS, type Candle, type Interval, type Side } from "../market/types.ts";
import { FEE, SLIP, type BookPosition } from "./account.ts";
import { checkRisk, type RiskReport } from "./risk.ts";

/**
 * Swing trades: positions held for hours to days, with a stop and a target that rest at the exchange.
 * Not scalping. Every strategy is a pure function of the candles up to bar i (no look-ahead), so the same code
 * runs live on the newest closed bar and over the loaded history to measure how it did on that market.
 *
 * Several of these are ports of the session / range ideas in the Roboquant presets (ORB family, PDH/PDL sweep,
 * Sigma Breakout, anchored VWAP). The presets were built on index futures with a cash-session open. Here the "session"
 * is configurable (default: the UTC day, which is Binance's daily candle). Their showcase numbers do NOT carry over:
 * every strategy has to earn its place on each market's own history, after fees, before it may trade.
 */

export type SwingCtx = {
  c: Candle[];
  tfMs: number;
  /** Minutes after 00:00 UTC at which a trading session starts. */
  sessMin: number;
  /** Session number of every bar. */
  sess: number[];
  /** Index of the first bar of every bar's session. */
  start: number[];
  /** Position of every bar's session inside sessStarts. */
  sessIdx: number[];
  /** First-bar index of each session, in order. */
  sessStarts: number[];
  /** true when the bar's session begins exactly at the session boundary (not a partial first day). */
  aligned: boolean[];
  atr: Array<number | null>;
  e20: Array<number | null>;
  e50: Array<number | null>;
  e200: Array<number | null>;
  volR: Array<number | null>;
  /** VWAP anchored at the start of each session. */
  vwap: Array<number | null>;
  /** Previous full session's high and low (null for the first two sessions of the loaded history). */
  pdh: Array<number | null>;
  pdl: Array<number | null>;
  /** Previous full week's high and low (weeks start Monday 00:00 UTC; null for the first two weeks of history). */
  pwh: Array<number | null>;
  pwl: Array<number | null>;
  /** Index of the first bar of each bar's week. */
  wkStart: number[];
  rsi2: Array<number | null>;
  /**
   * Daily trend from completed sessions only: 1 up, -1 down, 0 mixed, null when there is not enough history (about 25 sessions).
   * Up = last daily close above the 10-day EMA and the 10-day EMA above the 20-day EMA.
   */
  htf: Array<1 | -1 | 0 | null>;
};

const DAY = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function buildSwingCtx(c: Candle[], tfMs: number, sessMin = 0): SwingCtx | null {
  if (c.length < 60) return null;
  const n = c.length;
  const close = c.map((b) => b.c);
  const sess = c.map((b) => Math.floor((b.t - sessMin * 60_000) / DAY));
  const start: number[] = new Array(n).fill(0);
  const sessIdx: number[] = new Array(n).fill(0);
  const sessStarts: number[] = [];
  const aligned: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || sess[i] !== sess[i - 1]) {
      sessStarts.push(i);
      start[i] = i;
    } else start[i] = start[i - 1]!;
    sessIdx[i] = sessStarts.length - 1;
  }
  for (let i = 0; i < n; i++) aligned.push(c[start[i]!]!.t === sess[i]! * DAY + sessMin * 60_000);
  // Session highs and lows, and the anchored VWAP.
  const sHigh: number[] = [];
  const sLow: number[] = [];
  for (let k = 0; k < sessStarts.length; k++) {
    const a = sessStarts[k]!;
    const z = k + 1 < sessStarts.length ? sessStarts[k + 1]! : n;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = a; j < z; j++) {
      hi = Math.max(hi, c[j]!.h);
      lo = Math.min(lo, c[j]!.l);
    }
    sHigh.push(hi);
    sLow.push(lo);
  }
  const pdh: Array<number | null> = new Array(n).fill(null);
  const pdl: Array<number | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const k = sessIdx[i]!;
    if (k >= 2) {
      pdh[i] = sHigh[k - 1]!;
      pdl[i] = sLow[k - 1]!;
    }
  }
  const vwap: Array<number | null> = new Array(n).fill(null);
  let pv = 0;
  let vv = 0;
  let sumTp = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (start[i] === i) {
      pv = 0;
      vv = 0;
      sumTp = 0;
      cnt = 0;
    }
    const b = c[i]!;
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v;
    vv += b.v;
    sumTp += tp;
    cnt++;
    vwap[i] = vv > 0 ? pv / vv : sumTp / cnt;
  }
  const vol = c.map((b) => b.v);
  const volR = c.map((_, i) => {
    if (i < 20) return null;
    let s = 0;
    for (let k = i - 20; k < i; k++) s += vol[k]!;
    const a = s / 20;
    return a > 0 ? vol[i]! / a : null;
  });
  // Weeks (Monday start): previous full week's high and low.
  const weekOf = (k: number) => Math.floor((sess[sessStarts[k]!]! + 3) / 7);
  const wkStart: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) wkStart[i] = i === 0 || Math.floor((sess[i]! + 3) / 7) !== Math.floor((sess[i - 1]! + 3) / 7) ? i : wkStart[i - 1]!;
  const wkIdx = new Map<number, { hi: number; lo: number }>();
  const wkOrder: number[] = [];
  for (let k = 0; k < sessStarts.length; k++) {
    const w = weekOf(k);
    const cur = wkIdx.get(w);
    if (cur) {
      cur.hi = Math.max(cur.hi, sHigh[k]!);
      cur.lo = Math.min(cur.lo, sLow[k]!);
    } else {
      wkIdx.set(w, { hi: sHigh[k]!, lo: sLow[k]! });
      wkOrder.push(w);
    }
  }
  const pwh: Array<number | null> = new Array(n).fill(null);
  const pwl: Array<number | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const w = Math.floor((sess[i]! + 3) / 7);
    const pos = wkOrder.indexOf(w);
    if (pos >= 2) {
      const prev = wkIdx.get(wkOrder[pos - 1]!)!;
      pwh[i] = prev.hi;
      pwl[i] = prev.lo;
    }
  }
  // Daily trend, from completed sessions only (a bar never sees its own session's close).
  const sessClose = sessStarts.map((a, k) => c[(k + 1 < sessStarts.length ? sessStarts[k + 1]! : n) - 1]!.c);
  const d10 = ema(sessClose, 10);
  const d20 = ema(sessClose, 20);
  const trendOfSession = sessStarts.map((_, k): 1 | -1 | 0 | null => {
    const j = k - 1;
    if (j < 21 || d10[j] == null || d20[j] == null) return null;
    const last = sessClose[j]!;
    if (last > d10[j]! && d10[j]! > d20[j]!) return 1;
    if (last < d10[j]! && d10[j]! < d20[j]!) return -1;
    return 0;
  });
  const htf = sessIdx.map((k) => trendOfSession[k]!);
  return { c, tfMs, sessMin, sess, start, sessIdx, sessStarts, aligned, atr: atrSeries(c), e20: ema(close, 20), e50: ema(close, 50), e200: ema(close, 200), volR, vwap, pdh, pdl, pwh, pwl, wkStart, rsi2: rsiSeries(close, 2), htf };
}

const volAtLeast = (x: SwingCtx, i: number, min: number) => x.volR[i] == null || x.volR[i]! >= min;
const volBonus = (x: SwingCtx, i: number, per: number, cap: number) => (x.volR[i] == null ? 0 : clamp((x.volR[i]! - 1) * per, 0, cap));
const lowest = (c: Candle[], from: number, to: number) => Math.min(...c.slice(Math.max(0, from), to + 1).map((b) => b.l));
const highest = (c: Candle[], from: number, to: number) => Math.max(...c.slice(Math.max(0, from), to + 1).map((b) => b.h));

/** Stop at a structure level, padded a little, and kept between minAtr and maxAtr so it is never absurdly tight or wide. */
function build(x: SwingCtx, i: number, side: Side, structure: number, strength: number, why: string, minAtr = 0.8, maxAtr = 3): Signal | null {
  const atr = x.atr[i];
  if (!(atr && atr > 0)) return null;
  const entry = x.c[i]!.c;
  const raw = side === "BUY" ? entry - structure : structure - entry;
  const dist = clamp((raw > 0 ? raw : atr * 1.5) + 0.1 * atr, minAtr * atr, maxAtr * atr);
  return { side, stop: side === "BUY" ? entry - dist : entry + dist, strength: Math.round(clamp(strength, 0, 100)), why };
}

export type SwingStrategy = {
  id: string;
  name: string;
  blurb: string;
  /** Where the idea comes from, so nobody mistakes it for a tested preset. */
  source: string;
  /** Target as a multiple of the stop distance. */
  rr: number;
  /** Longest the trade is held. After this the position is closed at market. */
  maxHours: number;
  /** Timeframes this strategy makes sense on. */
  tfs: Interval[];
  signal: (x: SwingCtx, i: number) => Signal | null;
};

/** Opening-range window in minutes: 30 min, or two bars on slower timeframes. */
const orMinutes = (tfMs: number) => Math.max(30, (2 * tfMs) / 60_000);

const orb: SwingStrategy = {
  id: "orb",
  name: "Opening range breakout",
  blurb: "The first 30 minutes of the session set a range. The first candle to CLOSE beyond it (a wick does nothing) is traded, one attempt per side per session, stop at the other side of the range.",
  source: "Port of the ORB family in the Roboquant presets (Crazy ORB, Giga ORB, NY Open Range Breakout, Flash Trigger).",
  rr: 2,
  maxHours: 12,
  tfs: ["15m", "30m", "1h"],
  signal(x, i) {
    if (!x.aligned[i]) return null;
    const win = orMinutes(x.tfMs) * 60_000;
    const s0 = x.start[i]!;
    const t0 = x.sess[i]! * DAY + x.sessMin * 60_000;
    const rangeEnd = t0 + win;
    const b = x.c[i]!;
    if (b.t < rangeEnd || b.t - t0 > 8 * 3_600_000) return null;
    let hi = -Infinity;
    let lo = Infinity;
    let n = 0;
    let first = -1;
    for (let j = s0; j < i; j++) {
      const t = x.c[j]!.t;
      if (t < rangeEnd) {
        hi = Math.max(hi, x.c[j]!.h);
        lo = Math.min(lo, x.c[j]!.l);
        n++;
      } else if (first < 0) first = j;
    }
    if (n < Math.round(win / x.tfMs)) return null;
    const atr = x.atr[i];
    if (!atr) return null;
    const height = hi - lo;
    if (!(height >= 0.8 * atr && height <= 8 * atr)) return null;
    const range = b.h - b.l;
    const body = range > 0 ? Math.abs(b.c - b.o) / range : 0;
    const from = first < 0 ? i : first;
    if (b.c > hi && b.c > b.o && volAtLeast(x, i, 1)) {
      for (let j = from; j < i; j++) if (x.c[j]!.c > hi) return null;
      return build(x, i, "BUY", lo, 55 + volBonus(x, i, 15, 15) + body * 10, "First close above the opening range.");
    }
    if (b.c < lo && b.c < b.o && volAtLeast(x, i, 1)) {
      for (let j = from; j < i; j++) if (x.c[j]!.c < lo) return null;
      return build(x, i, "SELL", hi, 55 + volBonus(x, i, 15, 15) + body * 10, "First close below the opening range.");
    }
    return null;
  },
};

const pdhlFade: SwingStrategy = {
  id: "pdhl-fade",
  name: "Previous-day high/low sweep fade",
  blurb: "Price spikes through yesterday's high (or low) to take the stops there, then CLOSES back inside with a long wick. Traded the other way, once per side per session.",
  source: "Port of PDH/PDL Sweep Fade and Previous Day Extreme.",
  rr: 2,
  maxHours: 24,
  tfs: ["15m", "30m", "1h", "4h"],
  signal(x, i) {
    const pdh = x.pdh[i];
    const pdl = x.pdl[i];
    if (pdh == null || pdl == null) return null;
    const b = x.c[i]!;
    const range = b.h - b.l;
    if (!(range > 0)) return null;
    const upWick = b.h - Math.max(b.o, b.c);
    const lowWick = Math.min(b.o, b.c) - b.l;
    const s0 = x.start[i]!;
    if (b.h > pdh && b.c < pdh && upWick >= 0.4 * range && b.c < b.o) {
      for (let j = s0; j < i; j++) if (x.c[j]!.h > pdh) return null;
      return build(x, i, "SELL", b.h, 55 + (upWick / range) * 20 + volBonus(x, i, 10, 10), "Swept yesterday's high and closed back below it.");
    }
    if (b.l < pdl && b.c > pdl && lowWick >= 0.4 * range && b.c > b.o) {
      for (let j = s0; j < i; j++) if (x.c[j]!.l < pdl) return null;
      return build(x, i, "BUY", b.l, 55 + (lowWick / range) * 20 + volBonus(x, i, 10, 10), "Swept yesterday's low and closed back above it.");
    }
    return null;
  },
};

const SIGMA_SESSIONS = 20;
const SIGMA_K = 1.3;

const sigmaBand: SwingStrategy = {
  id: "sigma-band",
  name: "Sigma breakout",
  blurb: "For each time of day it measures how far price usually travels from the session open (last 20 sessions). A close outside 1.3x that distance is a breakout and is traded with it. Self-adjusting to each market's volatility.",
  source: "Port of Sigma Breakout. The preset has no stop; this version always has one, because an exchange order needs it.",
  rr: 2,
  maxHours: 16,
  tfs: ["15m", "30m", "1h", "4h"],
  signal(x, i) {
    if (!x.aligned[i]) return null;
    const s0 = x.start[i]!;
    const k = i - s0;
    if (k < 2 || i < 1) return null;
    const open = x.c[s0]!.o;
    const si = x.sessIdx[i]!;
    const ex: number[] = [];
    for (let q = si - 1; q >= 0 && ex.length < SIGMA_SESSIONS; q--) {
      const a = x.sessStarts[q]!;
      const nxt = x.sessStarts[q + 1]!;
      if (!x.aligned[a] || nxt - a < k + 1) continue;
      ex.push(Math.abs(x.c[a + k]!.c - x.c[a]!.o));
    }
    if (ex.length < 8) return null;
    const atr = x.atr[i];
    if (!atr) return null;
    const band = SIGMA_K * avg(ex);
    if (band < 0.5 * atr) return null;
    const b = x.c[i]!;
    const dev = b.c - open;
    const prev = x.c[i - 1]!.c - open;
    if (dev > band && prev <= band && volAtLeast(x, i, 0.9)) return build(x, i, "BUY", open, 52 + clamp((dev / band - 1) * 25, 0, 15) + volBonus(x, i, 12, 12), "Closed above the typical range for this time of day.");
    if (dev < -band && prev >= -band && volAtLeast(x, i, 0.9)) return build(x, i, "SELL", open, 52 + clamp((-dev / band - 1) * 25, 0, 15) + volBonus(x, i, 12, 12), "Closed below the typical range for this time of day.");
    return null;
  },
};

const avwapTrend: SwingStrategy = {
  id: "avwap-trend",
  name: "Anchored VWAP trend",
  blurb: "VWAP restarts every session. When the fast EMA is above it (below it for shorts) and price closes back up through the EMA, trade with the session's value.",
  source: "Port of Daily Anchored VWAP Signal (entry side; exits here are the stop, target and time limit).",
  rr: 2,
  maxHours: 16,
  tfs: ["15m", "30m", "1h"],
  signal(x, i) {
    const s0 = x.start[i]!;
    if (i - s0 < 6 || i < 2) return null;
    const e = x.e20[i];
    const pe = x.e20[i - 1];
    const v = x.vwap[i];
    if (e == null || pe == null || v == null) return null;
    const b = x.c[i]!;
    const p = x.c[i - 1]!;
    if (e > v && p.c <= pe && b.c > e && b.c > b.o) return build(x, i, "BUY", lowest(x.c, i - 3, i), 52 + volBonus(x, i, 15, 15) + ((x.e50[i] ?? 0) < e ? 8 : 0), "EMA above session VWAP and price closed back up through it.");
    if (e < v && p.c >= pe && b.c < e && b.c < b.o) return build(x, i, "SELL", highest(x.c, i - 3, i), 52 + volBonus(x, i, 15, 15) + ((x.e50[i] ?? Infinity) > e ? 8 : 0), "EMA below session VWAP and price closed back down through it.");
    return null;
  },
};

const trendBreak: SwingStrategy = {
  id: "trend-break",
  name: "Trend breakout (multi-day)",
  blurb: "Close beyond the last 20 bars' high (or low), in the direction of the 200 EMA, with a strong body. A wide ATR stop and a 3R target so the trade can run for days.",
  source: "Classic Donchian-style trend following. NOT one of the Roboquant presets; included because multi-day holds need a multi-day strategy.",
  rr: 3,
  maxHours: 120,
  tfs: ["1h", "4h", "1d"],
  signal(x, i) {
    const e200 = x.e200[i];
    const e50 = x.e50[i];
    if (e200 == null || e50 == null || i < 25) return null;
    const b = x.c[i]!;
    const range = b.h - b.l;
    if (!(range > 0) || Math.abs(b.c - b.o) < 0.4 * range || !volAtLeast(x, i, 1)) return null;
    const hh = highest(x.c, i - 20, i - 1);
    const ll = lowest(x.c, i - 20, i - 1);
    const prevHh = highest(x.c, i - 21, i - 2);
    const prevLl = lowest(x.c, i - 21, i - 2);
    const bonus = volBonus(x, i, 15, 15);
    if (b.c > hh && b.c > e200 && e50 > e200 && x.c[i - 1]!.c <= prevHh) return build(x, i, "BUY", lowest(x.c, i - 10, i), 55 + bonus + 8, "Closed above the 20-bar high in an uptrend (above the 200 EMA).", 1.5, 3.5);
    if (b.c < ll && b.c < e200 && e50 < e200 && x.c[i - 1]!.c >= prevLl) return build(x, i, "SELL", highest(x.c, i - 10, i), 55 + bonus + 8, "Closed below the 20-bar low in a downtrend (below the 200 EMA).", 1.5, 3.5);
    return null;
  },
};


const trendPullback: SwingStrategy = {
  id: "trend-pullback",
  name: "Trend pullback",
  blurb: "In an established trend (50 EMA beyond the 200 EMA, rising), price dips to the 20 EMA and the next candle closes back with the trend. Tighter stop than a breakout, so the same trend costs less to be wrong about.",
  source: "Classic trend-following pullback entry. NOT one of the Roboquant presets.",
  rr: 2.5,
  maxHours: 96,
  tfs: ["1h", "4h", "1d"],
  signal(x, i) {
    const e20 = x.e20[i];
    const pe20 = x.e20[i - 1];
    const e50 = x.e50[i];
    const e200 = x.e200[i];
    const e50b = x.e50[i - 10];
    if (e20 == null || pe20 == null || e50 == null || e200 == null || e50b == null || i < 215) return null;
    const b = x.c[i]!;
    const p = x.c[i - 1]!;
    const atr = x.atr[i];
    if (!atr || !volAtLeast(x, i, 0.8)) return null;
    if (e50 > e200 && e50 > e50b && b.c > e200 && p.c <= pe20 && b.c > e20 && b.c > b.o && b.c - e50 < 2.5 * atr) {
      return build(x, i, "BUY", lowest(x.c, i - 5, i), 54 + volBonus(x, i, 12, 12) + (b.c - b.o > 0.5 * (b.h - b.l) ? 6 : 0), "Pulled back to the 20 EMA in an uptrend and closed back above it.", 1, 3);
    }
    if (e50 < e200 && e50 < e50b && b.c < e200 && p.c >= pe20 && b.c < e20 && b.c < b.o && e50 - b.c < 2.5 * atr) {
      return build(x, i, "SELL", highest(x.c, i - 5, i), 54 + volBonus(x, i, 12, 12) + (b.o - b.c > 0.5 * (b.h - b.l) ? 6 : 0), "Pulled back to the 20 EMA in a downtrend and closed back below it.", 1, 3);
    }
    return null;
  },
};

const rsi2Revert: SwingStrategy = {
  id: "rsi2-revert",
  name: "RSI(2) mean reversion",
  blurb: "In an uptrend (above the 200 EMA) buy a sharp 2-period RSI drop below 10; in a downtrend sell a spike above 90. A small, quick move back toward the average. Suits markets that range more than crypto: forex, gold, indices.",
  source: "Classic short-term mean reversion (Connors RSI(2)). Related to the T-Mean Reversion and Williams %R presets, with a trend filter and a stop.",
  rr: 1.5,
  maxHours: 24,
  tfs: ["15m", "30m", "1h", "4h"],
  signal(x, i) {
    const r = x.rsi2[i];
    const e200 = x.e200[i];
    const e50 = x.e50[i];
    if (r == null || e200 == null || e50 == null || i < 215) return null;
    const b = x.c[i]!;
    if (r < 10 && b.c > e200 && e50 > e200) return build(x, i, "BUY", lowest(x.c, i - 3, i), 52 + clamp((10 - r) * 2, 0, 15), "Sharp short-term drop inside an uptrend (RSI(2) under 10).", 0.8, 2.5);
    if (r > 90 && b.c < e200 && e50 < e200) return build(x, i, "SELL", highest(x.c, i - 3, i), 52 + clamp((r - 90) * 2, 0, 15), "Sharp short-term spike inside a downtrend (RSI(2) over 90).", 0.8, 2.5);
    return null;
  },
};

const narrowRange: SwingStrategy = {
  id: "narrow-range",
  name: "Narrow-range breakout",
  blurb: "One candle has the smallest range of the last 7 (a pause in the move). The next candle that closes beyond its high or low, with a solid body, is traded with a stop on the far side of the narrow candle.",
  source: "Classic NR7 volatility-contraction pattern, in the spirit of the Roboquant Initial Volatility Breakout preset. NOT a preset itself.",
  rr: 2,
  maxHours: 48,
  tfs: ["1h", "4h", "1d"],
  signal(x, i) {
    if (i < 10) return null;
    const nr = x.c[i - 1]!;
    const nrRange = nr.h - nr.l;
    if (!(nrRange > 0)) return null;
    for (let j = i - 7; j < i - 1; j++) if (x.c[j]!.h - x.c[j]!.l <= nrRange) return null;
    const b = x.c[i]!;
    const range = b.h - b.l;
    if (!(range > 0) || Math.abs(b.c - b.o) < 0.5 * range || !volAtLeast(x, i, 1)) return null;
    const bonus = volBonus(x, i, 15, 15);
    if (b.c > nr.h && b.c > b.o) return build(x, i, "BUY", nr.l, 54 + bonus, "Closed above the narrowest candle of the last 7.", 0.8, 2.5);
    if (b.c < nr.l && b.c < b.o) return build(x, i, "SELL", nr.h, 54 + bonus, "Closed below the narrowest candle of the last 7.", 0.8, 2.5);
    return null;
  },
};

const weeklySweep: SwingStrategy = {
  id: "weekly-sweep",
  name: "Previous-week high/low sweep",
  blurb: "Price spikes through LAST WEEK's high or low, then closes back inside with a long wick. The same idea as the daily sweep one level up: rarer, and the levels matter more.",
  source: "Port of PDH/PDL Sweep Fade to the weekly level. NOT a preset itself.",
  rr: 2.5,
  maxHours: 72,
  tfs: ["1h", "4h"],
  signal(x, i) {
    const hi = x.pwh[i];
    const lo = x.pwl[i];
    if (hi == null || lo == null) return null;
    const b = x.c[i]!;
    const range = b.h - b.l;
    if (!(range > 0)) return null;
    const upWick = b.h - Math.max(b.o, b.c);
    const lowWick = Math.min(b.o, b.c) - b.l;
    const w0 = x.wkStart[i]!;
    if (b.h > hi && b.c < hi && upWick >= 0.4 * range && b.c < b.o) {
      for (let j = w0; j < i; j++) if (x.c[j]!.h > hi) return null;
      return build(x, i, "SELL", b.h, 56 + (upWick / range) * 20 + volBonus(x, i, 10, 10), "Swept last week's high and closed back below it.", 0.8, 3);
    }
    if (b.l < lo && b.c > lo && lowWick >= 0.4 * range && b.c > b.o) {
      for (let j = w0; j < i; j++) if (x.c[j]!.l < lo) return null;
      return build(x, i, "BUY", b.l, 56 + (lowWick / range) * 20 + volBonus(x, i, 10, 10), "Swept last week's low and closed back above it.", 0.8, 3);
    }
    return null;
  },
};

export const SWING_STRATEGIES: SwingStrategy[] = [orb, pdhlFade, sigmaBand, avwapTrend, trendBreak, trendPullback, rsi2Revert, narrowRange, weeklySweep];

/** A strategy's signal, with the daily-trend filter applied when asked: trade only in the direction of the daily trend. */
export function signalOf(s: SwingStrategy, x: SwingCtx, i: number, dailyFilter: boolean): Signal | null {
  const sig = s.signal(x, i);
  if (!sig || !dailyFilter) return sig;
  const t = x.htf[i];
  if (t == null) return sig; // not enough history to know the daily trend: the filter cannot judge, so it does not block
  return t === (sig.side === "BUY" ? 1 : -1) ? sig : null;
}

export function swingStrategyById(id: string): SwingStrategy | undefined {
  return SWING_STRATEGIES.find((s) => s.id === id);
}

export const maxBarsFor = (s: SwingStrategy, tfMs: number) => Math.max(4, Math.round((s.maxHours * 3_600_000) / tfMs));

/** Round-trip cost as a fraction of price (fees and slippage, both ways). */
export const SWING_COST = 2 * (FEE + SLIP);

export type SimResult = { r: number; bars: number; exit: "stop" | "target" | "time" };

/**
 * Walks forward from bar i. The stop wins when one bar touches both the stop and the target (the cautious reading).
 * Returns R before costs, or null when the data ends before the trade resolves.
 */
export function simulateSwing(c: Candle[], i: number, side: Side, stop: number, target: number, maxBars: number): SimResult | null {
  const entry = c[i]!.c;
  const dist = Math.abs(entry - stop);
  if (!(dist > 0)) return null;
  const dir = side === "BUY" ? 1 : -1;
  for (let j = i + 1; j <= i + maxBars; j++) {
    const b = c[j];
    if (!b) return null;
    const stopHit = dir === 1 ? b.l <= stop : b.h >= stop;
    const tgtHit = dir === 1 ? b.h >= target : b.l <= target;
    if (stopHit) return { r: -1, bars: j - i, exit: "stop" };
    if (tgtHit) return { r: Math.abs(target - entry) / dist, bars: j - i, exit: "target" };
    if (j === i + maxBars) return { r: (dir * (b.c - entry)) / dist, bars: j - i, exit: "time" };
  }
  return null;
}

export type SwingEdge = {
  trades: number;
  wins: number;
  winRate: number;
  /** Average result per trade in R after costs, pulled toward zero when there are few trades. */
  expectancy: number;
  /** Same, not pulled. */
  avgR: number;
  profitFactor: number;
  totalR: number;
  worstStreak: number;
  /** Average R of the earlier half and the later half of its trades (in time order). null when there are too few trades to split. */
  firstHalf: number | null;
  secondHalf: number | null;
  /** The record holds in both halves: not one lucky stretch. */
  stable: boolean;
};

/** How a strategy did on this market's loaded history: same signals, real exits, fees and slippage included. Not a forecast. */
export function measureSwingEdge(x: SwingCtx, s: SwingStrategy, costFrac: number, from: number, upTo: number, dailyFilter = false): SwingEdge {
  const rs: number[] = [];
  const maxBars = maxBarsFor(s, x.tfMs);
  let skipUntil = -1;
  for (let i = Math.max(55, from); i <= upTo; i++) {
    if (i < skipUntil) continue;
    const sig = signalOf(s, x, i, dailyFilter);
    if (!sig) continue;
    const entry = x.c[i]!.c;
    const dist = Math.abs(entry - sig.stop);
    if (!(dist > 0)) continue;
    const target = sig.side === "BUY" ? entry + s.rr * dist : entry - s.rr * dist;
    const sim = simulateSwing(x.c, i, sig.side, sig.stop, target, maxBars);
    if (!sim) continue;
    rs.push(sim.r - (costFrac * entry) / dist);
    skipUntil = i + sim.bars + 1;
  }
  const n = rs.length;
  const sum = rs.reduce((a, b) => a + b, 0);
  const gw = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const gl = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  let streak = 0;
  let worst = 0;
  for (const r of rs) {
    streak = r <= 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const wins = rs.filter((r) => r > 0).length;
  const half = Math.floor(n / 2);
  const firstHalf = n >= 6 ? avg(rs.slice(0, half)) : null;
  const secondHalf = n >= 6 ? avg(rs.slice(half)) : null;
  const stable = firstHalf != null && secondHalf != null && firstHalf > 0 && secondHalf > 0;
  return { trades: n, wins, winRate: n ? wins / n : 0, expectancy: sum / (n + 4), avgR: n ? sum / n : 0, profitFactor: gl > 0 ? gw / gl : gw > 0 ? 9.99 : 0, totalR: sum, worstStreak: worst, firstHalf, secondHalf, stable };
}

// ---------------------------------------------------------------- settings

export type SwingTf = "15m" | "30m" | "1h" | "4h" | "1d";
export const SWING_TFS: SwingTf[] = ["15m", "30m", "1h", "4h", "1d"];

export type SwingConfig = {
  tf: SwingTf;
  /** Strategy ids that may trade. */
  strategies: string[];
  /** Risk per trade, % of equity. */
  riskPct: number;
  maxOpen: number;
  /** Combined risk of all open swing trades, % of equity. */
  maxTotalRiskPct: number;
  minRR: number;
  /** A strategy needs at least this many past trades on the market before it counts. */
  minTrades: number;
  /** Minimum average result per trade (R, after costs) on that market's history. */
  minEdge: number;
  /** Which brokers' markets are scanned. */
  markets: "both" | "binance" | "deriv";
  /** How many of the top Binance markets by volume are scanned (gold, silver and other TradFi perpetuals are always added). */
  topN: number;
  /** How many open Deriv markets are scanned (forex, metals, indices, synthetics...). */
  derivMax: number;
  /** Session start, minutes after 00:00 UTC. */
  sessionMin: number;
  /** Stop new swing entries after this many losing swing trades in a row. */
  pauseAfter: number;
  /** Trade only in the direction of the daily trend (when there is enough history to know it). */
  dailyTrendFilter: boolean;
  /** Require the strategy's record to be positive in BOTH halves of its past trades, not just overall. */
  requireStable: boolean;
};

export const SWING_DEFAULTS: SwingConfig = {
  tf: "1h",
  strategies: SWING_STRATEGIES.map((s) => s.id),
  riskPct: 0.5,
  maxOpen: 3,
  maxTotalRiskPct: 1.5,
  minRR: 1.8,
  // 15 past trades and +0.15R: on random data this approved about 1 market/strategy pair in 540. At 10 and +0.10R it was about 9 in 540.
  minTrades: 15,
  minEdge: 0.15,
  markets: "both",
  topN: 20,
  derivMax: 30,
  sessionMin: 0,
  pauseAfter: 3,
  dailyTrendFilter: true,
  requireStable: true,
};

/** Candles requested per market. Enough for the 200 EMA and a few weeks of trades to measure. */
export const SWING_HISTORY = 1000;

export const swingTfMs = (tf: SwingTf) => INTERVAL_MS[tf];

export type Venue = "paper" | "binance" | "deriv";

// ---------------------------------------------------------------- Deriv multiplier sizing

export type MultSize = { ok: true; multiplier: number; stake: number; stopLoss: number; takeProfit: number; risk: number } | { ok: false; why: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A Deriv multiplier contract gains or loses stake x multiplier x (price change %). To lose `risk` when price reaches the stop,
 * stake = risk / (multiplier x stop distance %). The largest multiplier whose stop stays well inside Deriv's stop-out
 * (loss of 60% of the stake or less) is used, so the stake is as small as it can be. Never sized up to reach a minimum stake.
 */
export function sizeMultiplier(x: { equity: number; cash: number; riskPct: number; entry: number; stop: number; target: number; options: number[]; minStake?: number; maxStakePct?: number }): MultSize {
  const s = Math.abs(x.entry - x.stop) / x.entry;
  const t = Math.abs(x.target - x.entry) / x.entry;
  if (!(x.equity > 0) || !(x.entry > 0) || !(s > 0) || !(t > 0)) return { ok: false, why: "No valid equity, stop or target to size from." };
  if (!x.options.length) return { ok: false, why: "Deriv listed no multipliers for this market." };
  const risk = (x.equity * x.riskPct) / 100;
  const minStake = x.minStake ?? 1;
  const maxStake = Math.min(x.cash, (x.equity * (x.maxStakePct ?? 50)) / 100);
  let sawFit = false;
  for (const m of [...x.options].sort((a, b) => b - a)) {
    if (m * s > 0.6) continue;
    sawFit = true;
    const stake = round2(risk / (m * s));
    if (stake > maxStake) return { ok: false, why: `The stake needed (${stake.toFixed(2)}) is more than the allowed share of the account (${maxStake.toFixed(2)}).` };
    if (stake < minStake) continue;
    return { ok: true, multiplier: m, stake, stopLoss: round2(stake * m * s), takeProfit: round2(stake * m * t), risk };
  }
  return { ok: false, why: sawFit ? `The risk budget (${risk.toFixed(2)}) is below the smallest stake Deriv takes (${minStake}). Size was not raised.` : "The stop is too wide for any multiplier this market offers." };
}

// ---------------------------------------------------------------- planning

export type SwingRowIn = {
  symbol: string;
  label: string;
  group: string;
  kind: "binance" | "deriv";
  candles: Candle[];
  spreadPct: number | null;
  tradable: boolean;
  longOnly: boolean;
  step?: number;
  minNotional?: number;
  /** Deriv only: multipliers on offer. null = none offered, undefined = not checked yet. */
  derivMult?: number[] | null;
};

export type SwingSignal = {
  key: string;
  symbol: string;
  label: string;
  group: string;
  strategy: string;
  strategyName: string;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  stopPct: number;
  maxHours: number;
  strength: number;
  edge: SwingEdge;
  score: number;
  why: string;
  signalTime: number;
  tf: SwingTf;
  /** ready: entering now. blocked: held back for a reason. signal: a valid signal this app is not trading (orders go elsewhere, or it is switched off). */
  status: "ready" | "blocked" | "signal";
  /** Why it is not being traded. Empty when ready. */
  blocked: string;
  qty?: number;
  notional?: number;
  lossAtStop?: number;
  deriv?: { multiplier: number; stake: number; stopLoss: number; takeProfit: number };
  howTo: string[];
};

export type SwingEntry = {
  symbol: string;
  side: Side;
  qty: number;
  notional: number;
  lossAtStop: number;
  entry: number;
  stop: number;
  target: number;
  reason: string;
  quality: number;
  strategy: string;
  key: string;
  candleTime: number;
  regime: string;
  holdUntil: number;
  venue: Venue;
  deriv?: { multiplier: number; stake: number; stopLoss: number; takeProfit: number };
};

export type SwingPlan = {
  signals: SwingSignal[];
  entries: SwingEntry[];
  scanned: number;
  withData: number;
  /** One line a person can read: what the scan found. */
  note: string;
};

/** How long a run of losses pauses new swing entries. */
export const PAUSE_MS = 24 * 3_600_000;

const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : "?");

/**
 * A signal as plain text, to paste into any other broker or chat. Only what is needed to place the order by hand.
 */
export function signalText(s: SwingSignal, riskPct = SWING_DEFAULTS.riskPct): string {
  const dir = s.side === "BUY" ? "BUY / LONG" : "SELL / SHORT";
  const when = new Date(s.signalTime + swingTfMs(s.tf)).toISOString().replace("T", " ").slice(0, 16);
  return [
    `SIGNAL: ${s.label} (${s.symbol})`,
    `${dir} at market, price about ${fmt(s.entry)}`,
    `Stop loss: ${fmt(s.stop)} (${s.stopPct.toFixed(2)}% away)`,
    `Take profit: ${fmt(s.target)} (${s.rr}R)`,
    `Close at market after ${s.maxHours} h if neither is hit.`,
    `Suggested risk: ${riskPct}% of the account. Position size = (account x ${riskPct}%) / (entry - stop).`,
    `Why: ${s.strategyName}. ${s.why}`,
    `Record on this market (${s.tf}, after fees): ${s.edge.trades} trades, ${(s.edge.winRate * 100).toFixed(0)}% won, ${s.edge.avgR >= 0 ? "+" : ""}${s.edge.avgR.toFixed(2)}R average, worst run ${s.edge.worstStreak} losses.`,
    `Candle closed ${when} UTC. Check the live price at your broker first: if it is past the stop or far from the entry, skip it.`,
    `TradeBrain signal, not financial advice. Past results do not predict future ones.`,
  ].join("\n");
}

const edgeCache = new Map<string, { sigs: { s: SwingStrategy; sig: Signal; edge: SwingEdge }[]; atr: number; close: number; t: number }>();
export function clearSwingCache() {
  edgeCache.clear();
}

function scanClosed(symbol: string, closed: Candle[], cfg: SwingConfig, costFrac: number) {
  const tfMs = swingTfMs(cfg.tf);
  const key = `${symbol}|${cfg.tf}|${cfg.sessionMin}|${cfg.dailyTrendFilter}|${cfg.strategies.join(",")}|${closed.length}|${closed[closed.length - 1]!.t}|${costFrac}`;
  const hit = edgeCache.get(key);
  if (hit) return hit;
  const x = buildSwingCtx(closed, tfMs, cfg.sessionMin);
  if (!x) return null;
  const i = closed.length - 1;
  const atr = x.atr[i];
  if (!(atr && atr > 0)) return null;
  const sigs: { s: SwingStrategy; sig: Signal; edge: SwingEdge }[] = [];
  for (const s of SWING_STRATEGIES) {
    if (!cfg.strategies.includes(s.id) || !s.tfs.includes(cfg.tf)) continue;
    const sig = signalOf(s, x, i, cfg.dailyTrendFilter);
    if (!sig) continue;
    sigs.push({ s, sig, edge: measureSwingEdge(x, s, costFrac, 55, i - 1, cfg.dailyTrendFilter) });
  }
  const out = { sigs, atr, close: closed[i]!.c, t: closed[i]!.t };
  if (edgeCache.size > 600) edgeCache.clear();
  edgeCache.set(key, out);
  return out;
}

export type SwingPlanInput = {
  /** Learning Brain gate: can only block a setup or lower its rank. */
  gate?: import("../learn/rules.ts").GateFn;
  now: number;
  cfg: SwingConfig;
  armed: boolean;
  /** Where orders go: the "Order execution" choice on the Connect tab. */
  venue: Venue;
  rows: SwingRowIn[];
  /** Every position in the book (any venue, any strategy). Used so a symbol is never opened twice. */
  positions: BookPosition[];
  equity: number;
  cash: number;
  dayPnl: number;
  dayStartEquity: number;
  dailyLossPct: number;
  seen: string[];
  /** Hard stop reason (drawdown, unknown balance...). Blocks every new entry. */
  halted: string | null;
};

const riskOf = (p: BookPosition) => p.riskAtStop ?? p.plannedRisk;

/** Where a market's orders would go, or why they cannot go anywhere right now. */
function routeFor(venue: Venue, kind: "binance" | "deriv"): { route: Venue | null; why: string } {
  if (venue === "paper") return { route: "paper", why: "" };
  if (venue === kind) return { route: venue, why: "" };
  return { route: null, why: `Orders are set to ${venue === "binance" ? "Binance" : "Deriv"}, and this market is on ${kind === "binance" ? "Binance" : "Deriv"}. Shown as a signal only.` };
}

export function planSwing(input: SwingPlanInput): SwingPlan {
  const { cfg, now } = input;
  const tfMs = swingTfMs(cfg.tf);
  const signals: SwingSignal[] = [];
  let withData = 0;
  const seen = new Set(input.seen);
  const swingOpen = input.positions.filter((p) => p.status === "open" && p.book === "swing");
  let openRisk = swingOpen.reduce((s, p) => s + riskOf(p), 0);
  let openCount = swingOpen.length;
  const planned = new Set<string>();
  const closedSwing = input.positions.filter((p) => p.status === "closed" && p.book === "swing");
  // Losses in a row count only while they are recent: the pause lifts by itself 24 h after the last swing trade closed.
  // Without this the pause could never end, because a paused strategy cannot win its way out.
  let consec = 0;
  for (let k = closedSwing.length - 1; k >= 0; k--) {
    if ((closedSwing[k]!.pnl ?? 0) < 0 && (closedSwing[k]!.closedAt ?? 0) > now - PAUSE_MS) consec++;
    else break;
  }
  const hourAgo = now - 3_600_000;
  const recentSwing = input.positions.filter((p) => p.book === "swing" && p.openedAt >= hourAgo).length;
  const costFrac = SWING_COST;

  const raw: SwingSignal[] = [];
  for (const row of input.rows) {
    if (!row.tradable || row.candles.length < 220) continue;
    withData++;
    const live = row.candles[row.candles.length - 1]!;
    const forming = now - live.t < tfMs;
    const closed = forming ? row.candles.slice(0, -1) : row.candles;
    const scan = scanClosed(row.symbol, closed, cfg, costFrac);
    if (!scan) continue;
    for (const { s, sig, edge } of scan.sigs) {
      const entry = live.c;
      const dist = Math.abs(entry - sig.stop);
      const rightSide = sig.side === "BUY" ? entry > sig.stop : entry < sig.stop;
      const target = sig.side === "BUY" ? entry + s.rr * dist : entry - s.rr * dist;
      const edgeScore = clamp(50 + 100 * edge.expectancy, 0, 100);
      let score = Math.round(0.5 * edgeScore + 0.5 * sig.strength);
      const stopPct = entry > 0 ? (dist / entry) * 100 : 0;
      let blocked = "";
      if (!rightSide || !(dist > 0)) blocked = "Price is already through the stop.";
      else if (Math.abs(entry - scan.close) > 0.5 * scan.atr) blocked = "Price has already moved too far from the signal candle.";
      else if (edge.trades < cfg.minTrades) blocked = `Only ${edge.trades} past trades on this market (needs ${cfg.minTrades}), so there is no record to trust yet.`;
      else if (edge.expectancy < cfg.minEdge) blocked = `Its recent record here after costs is ${edge.expectancy.toFixed(2)}R per trade (needs ${cfg.minEdge}R).`;
      else if (cfg.requireStable && !edge.stable) blocked = `Its record is not steady: ${edge.firstHalf == null ? "too few trades to split" : `${edge.firstHalf.toFixed(2)}R in the earlier half of its trades, ${edge.secondHalf!.toFixed(2)}R in the later half (both must be above 0)`}.`;
      if (!blocked && input.gate) {
        const g = input.gate({ symbol: row.symbol, candles: row.candles, tfMs, strategy: s.id, side: sig.side, entry, stop: sig.stop, spreadPct: row.spreadPct, now });
        if (!g.allow) blocked = g.note;
        else score = Math.max(0, score + g.scoreAdj);
      }
      raw.push({
        key: `swing|${row.symbol}|${s.id}|${sig.side}|${scan.t}`,
        symbol: row.symbol,
        label: row.label,
        group: row.group,
        strategy: s.id,
        strategyName: s.name,
        side: sig.side,
        entry,
        stop: sig.stop,
        target,
        rr: s.rr,
        stopPct,
        maxHours: s.maxHours,
        strength: sig.strength,
        edge,
        score,
        why: sig.why,
        signalTime: scan.t,
        tf: cfg.tf,
        status: blocked ? "blocked" : "ready",
        blocked,
        howTo: [
          `${sig.side === "BUY" ? "Buy" : "Sell short"} ${row.label} at about ${fmt(entry)}.`,
          `Stop ${fmt(sig.stop)} (${stopPct.toFixed(2)}% away). Target ${fmt(target)} (${s.rr}R).`,
          `If neither is hit, close at market after ${s.maxHours} hours. Its record on this market: ${edge.trades} trades, ${(edge.winRate * 100).toFixed(0)}% won, ${edge.avgR.toFixed(2)}R average after costs.`,
        ],
      });
    }
  }
  // Best first, so the limits are spent on the strongest setups.
  raw.sort((a, b) => (a.status === b.status ? 0 : a.status === "ready" ? -1 : 1) || b.score - a.score);

  const entries: SwingEntry[] = [];
  for (const sg of raw) {
    if (sg.status !== "ready") {
      signals.push(sg);
      continue;
    }
    const row = input.rows.find((r) => r.symbol === sg.symbol)!;
    const { route, why } = routeFor(input.venue, row.kind);
    if (!route) {
      signals.push({ ...sg, status: "signal", blocked: why });
      continue;
    }
    const isContract = route === "deriv";
    // Deriv contracts need to know which multipliers the market offers.
    let mult: MultSize | null = null;
    if (isContract) {
      if (row.derivMult === undefined) {
        signals.push({ ...sg, status: "blocked", blocked: "Still checking which multiplier contracts Deriv offers on this market." });
        continue;
      }
      if (row.derivMult === null) {
        signals.push({ ...sg, status: "signal", blocked: "Deriv offers no multiplier contract on this market, so it cannot be traded here. Shown as a signal only." });
        continue;
      }
    }
    const sameSymbol = input.positions.filter((p) => p.status === "open" && p.symbol === sg.symbol).length + (planned.has(sg.symbol) ? 1 : 0);
    const q = quality(row.candles, tfMs, now);
    const risk: RiskReport = checkRisk({
      side: sg.side,
      price: sg.entry,
      plan: { entry: sg.entry, stop: sg.stop, target: sg.target, risk: Math.abs(sg.entry - sg.stop), rr: sg.rr },
      equity: input.equity,
      cash: input.cash,
      dayPnl: input.dayPnl,
      startEquity: input.dayStartEquity,
      riskPct: cfg.riskPct,
      maxOpenRiskPct: cfg.maxTotalRiskPct,
      dailyLossPct: input.dailyLossPct,
      maxPositions: cfg.maxOpen,
      maxPerSymbol: 1,
      openPositions: openCount,
      sameSymbol,
      openRisk,
      halted: input.halted,
      longOnly: route === "binance" ? row.longOnly : false,
      spreadPct: row.spreadPct,
      maxSpreadPct: 0.15,
      seen: seen.has(sg.key),
      cooldownMsLeft: 0,
      entriesThisHour: recentSwing + entries.length,
      maxEntriesHour: 4,
      minRR: cfg.minRR,
      consecLosses: consec,
      consecLimit: cfg.pauseAfter,
      lossPause: true,
      goalReached: false,
      goalBlocks: false,
      ageMs: q.ageMs,
      tfMs,
      regime: "Normal",
      step: row.step,
      minNotional: row.minNotional,
      duplicateSetup: false,
      skipSize: isContract,
    });
    let lossAtStop = 0;
    let qty = 0;
    let notional = 0;
    let derivOrder: SwingEntry["deriv"];
    let failure = risk.ok ? "" : (risk.reasons[0] ?? "Risk check failed.");
    if (!failure && isContract) {
      mult = sizeMultiplier({ equity: input.equity, cash: input.cash, riskPct: cfg.riskPct, entry: sg.entry, stop: sg.stop, target: sg.target, options: row.derivMult ?? [] });
      if (!mult.ok) failure = mult.why;
      else {
        const cap = (input.equity * cfg.maxTotalRiskPct) / 100;
        lossAtStop = mult.stopLoss;
        qty = 1;
        notional = mult.stake;
        derivOrder = { multiplier: mult.multiplier, stake: mult.stake, stopLoss: mult.stopLoss, takeProfit: mult.takeProfit };
        if (openRisk + lossAtStop > cap + 1e-9) failure = `Combined open risk: ${(openRisk + lossAtStop).toFixed(2)} vs cap ${cap.toFixed(2)}`;
      }
    } else if (!failure && risk.size && risk.size.ok) {
      lossAtStop = risk.size.lossAtStop;
      qty = risk.size.qty;
      notional = risk.size.notional;
    } else if (!failure) failure = "Risk check failed.";
    if (failure) {
      signals.push({ ...sg, status: "blocked", blocked: failure });
      continue;
    }
    const withSize: SwingSignal = { ...sg, qty, notional, lossAtStop, deriv: derivOrder };
    if (!input.armed) {
      signals.push({ ...withSize, status: "signal", blocked: "Swing trading is not armed, so nothing is sent. This is the trade it would take." });
      continue;
    }
    signals.push(withSize);
    entries.push({
      symbol: sg.symbol,
      side: sg.side,
      qty,
      notional,
      lossAtStop,
      entry: sg.entry,
      stop: sg.stop,
      target: sg.target,
      reason: `${sg.strategyName}: ${sg.why}`,
      quality: sg.score,
      strategy: `swing:${sg.strategy}`,
      key: sg.key,
      candleTime: sg.signalTime,
      regime: "swing",
      holdUntil: now + sg.maxHours * 3_600_000,
      venue: route,
      deriv: derivOrder,
    });
    seen.add(sg.key);
    openRisk += lossAtStop;
    openCount += 1;
    planned.add(sg.symbol);
  }
  const ready = signals.filter((s) => s.status === "ready").length;
  const sigOnly = signals.filter((s) => s.status === "signal").length;
  const note =
    withData === 0
      ? "Loading candle history for the markets. Swing needs about 1000 candles per market, so the first scan takes a minute or two."
      : `${withData} markets scanned on ${cfg.tf} candles. ${signals.length} signals on the last closed candle: ${ready} entered now, ${sigOnly} signal-only, ${signals.length - ready - sigOnly} held back.`;
  return { signals, entries, scanned: input.rows.length, withData, note };
}

// ---------------------------------------------------------------- managing open swing trades

/**
 * Local management of an open swing position. When the broker holds the stop and target (Binance after it confirms them, or a
 * Deriv multiplier contract) the broker does the work and only the time limit acts here. Otherwise (simulated, or Binance
 * protection that could not be confirmed) the stop and target are checked against the candles that opened after the trade,
 * and the live price. The stop wins if both were touched.
 */
export function swingExit(pos: BookPosition, candles: Candle[], mark: number | null, now: number): { price: number; reason: string } | null {
  if (pos.status !== "open") return null;
  const brokerHolds = pos.protection === "broker-confirmed" || pos.protection === "contract-stake";
  if (!brokerHolds) {
    let lo = mark ?? pos.entry;
    let hi = mark ?? pos.entry;
    for (const b of candles) {
      if (b.t < pos.openedAt) continue;
      lo = Math.min(lo, b.l);
      hi = Math.max(hi, b.h);
    }
    const stopHit = pos.side === "BUY" ? lo <= pos.stop : hi >= pos.stop;
    const tgtHit = pos.side === "BUY" ? hi >= pos.target : lo <= pos.target;
    if (stopHit) return { price: pos.stop, reason: "Stop hit (watched by this app, not a resting order)" };
    if (tgtHit) return { price: pos.target, reason: "Target hit (watched by this app, not a resting order)" };
  }
  if (pos.holdUntil && now >= pos.holdUntil) return { price: mark ?? pos.entry, reason: "Time limit reached" };
  return null;
}
