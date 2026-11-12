import { adx, atrSeries, bollinger, ema, efficiency, percentRank, pivots } from "../market/indicators.ts";
import type { Candle, Side } from "../market/types.ts";
import type { Align, Bias, ContextSnapshot, Regime, Session, Structure } from "./types.ts";

/** UTC trading sessions. Crude on purpose: they only label when a trade happened so results can be grouped. */
export function sessionOf(t: number): Session {
  const h = new Date(t).getUTCHours();
  return h < 7 ? "asia" : h < 12 ? "london" : h < 16 ? "overlap" : h < 21 ? "newyork" : "late";
}

/** Median spacing of the candles, in ms. */
export function tfOf(c: Candle[]): number {
  if (c.length < 3) return 0;
  const d: number[] = [];
  for (let i = Math.max(1, c.length - 40); i < c.length; i++) d.push(c[i]!.t - c[i - 1]!.t);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}

/** Joins `factor` candles into one, aligned to the clock. Only complete groups are returned, so a forming higher-timeframe bar never leaks in. */
export function resample(c: Candle[], tfMs: number, factor: number): Candle[] {
  if (factor <= 1 || tfMs <= 0) return c;
  const bucketMs = tfMs * factor;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let key = -1;
  let k = 0;
  const flush = () => {
    if (cur && k === factor) out.push(cur);
  };
  for (const b of c) {
    const bk = Math.floor(b.t / bucketMs);
    if (bk !== key) {
      flush();
      key = bk;
      cur = { t: bk * bucketMs, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      k = 1;
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      k++;
    }
  }
  flush();
  return out;
}

/** The higher-timeframe used for context: htfMin minutes, or four times the working timeframe when that is already as slow or slower. */
export function htfFactor(tfMs: number, htfMin: number): number {
  const f = Math.round((htfMin * 60_000) / tfMs);
  return f >= 2 ? f : 4;
}

export function htfBias(closed: Candle[], tfMs: number, htfMin: number): { bias: Bias; min: number; why: string } {
  const factor = htfFactor(tfMs, htfMin);
  const min = Math.round((tfMs * factor) / 60_000);
  const h = resample(closed, tfMs, factor);
  if (h.length < 25) return { bias: "unknown", min, why: `only ${h.length} complete ${min}m bars loaded` };
  const close = h.map((b) => b.c);
  const slowP = h.length >= 60 ? 50 : 21;
  const fastP = slowP === 50 ? 21 : 9;
  const f = ema(close, fastP);
  const s = ema(close, slowP);
  const i = h.length - 1;
  const fv = f[i];
  const sv = s[i];
  const fp = f[i - 3];
  if (fv == null || sv == null || fp == null) return { bias: "unknown", min, why: "averages not ready" };
  const px = close[i]!;
  const slopeUp = fv > fp;
  if (px > fv && fv > sv && slopeUp) return { bias: "up", min, why: `${min}m close above EMA${fastP} above EMA${slowP}, rising` };
  if (px < fv && fv < sv && !slopeUp) return { bias: "down", min, why: `${min}m close below EMA${fastP} below EMA${slowP}, falling` };
  return { bias: "flat", min, why: `${min}m averages mixed` };
}

export function alignOf(side: Side, bias: Bias): Align {
  if (bias === "unknown") return "unknown";
  if (bias === "flat") return "neutral";
  return (side === "BUY") === (bias === "up") ? "with" : "against";
}

export type RegimeRead = {
  regime: Regime;
  why: string;
  structure: Structure;
  adx: number | null;
  atrPct: number | null;
  atrRank: number | null;
  bbwRank: number | null;
  e21: number | null;
  atr: number | null;
};

/** Classifies the market from CLOSED candles only. Several inputs must agree; otherwise it says unclear. */
export function detectRegime(closed: Candle[]): RegimeRead {
  const none: RegimeRead = { regime: "unclear", why: "not enough candles", structure: "unknown", adx: null, atrPct: null, atrRank: null, bbwRank: null, e21: null, atr: null };
  if (closed.length < 60) return none;
  const c = closed.slice(-260);
  const i = c.length - 1;
  const close = c.map((b) => b.c);
  const atrS = atrSeries(c);
  const atr = atrS[i];
  if (!(atr && atr > 0)) return none;
  const px = close[i]!;
  // Volatility is judged as a share of price, so a steady climb in price alone never reads as expansion.
  const atrN = atrS.map((v, k) => (v == null ? null : v / close[k]!));
  const atrRank = percentRank(atrN.slice(-100));
  const bb = bollinger(close);
  const bbw = bb.mid.map((m, k) => (m ? (bb.up[k]! - bb.lo[k]!) / m : null));
  const bbwRank = percentRank(bbw.slice(-100));
  const a = adx(c);
  const e21s = ema(close, 21);
  const e21 = e21s[i] ?? null;
  const e21Prev = e21s[i - 5] ?? null;
  const slope = e21 != null && e21Prev != null ? (e21 - e21Prev) / atr : 0;
  const eff = efficiency(c, 12) ?? 0;
  const pv = pivots(c.slice(-120), 2);
  const h2 = pv.highs.slice(-2);
  const l2 = pv.lows.slice(-2);
  let structure: Structure = "unknown";
  if (h2.length === 2 && l2.length === 2) {
    const hh = h2[1]!.p > h2[0]!.p;
    const hl = l2[1]!.p > l2[0]!.p;
    structure = hh && hl ? "hh-hl" : !hh && !hl ? "lh-ll" : "mixed";
  }
  const atrNPrev = atrN[i - 20];
  const atrNNow = atrN[i];
  const lastRange = c[i]!.h - c[i]!.l;
  const base = { structure, adx: a?.adx ?? null, atrPct: (atr / px) * 100, atrRank, bbwRank, e21, atr };
  const adxV = a?.adx ?? 0;
  let regime: Regime = "unclear";
  let why = "signals conflict";
  if ((atrRank != null && atrRank >= 0.9 && lastRange > 1.8 * atr) || (atrNPrev && atrNNow != null && atrNNow / atrNPrev >= 1.5 && atrRank != null && atrRank >= 0.9)) {
    regime = "vol-expansion";
    why = `ATR expanding (${atrNPrev && atrNNow != null ? (atrNNow / atrNPrev).toFixed(1) : "?"}x its level 20 bars ago, as a share of price)`;
  } else if (bbwRank != null && bbwRank <= 0.15 && adxV < 20) {
    regime = "squeeze";
    why = `Bollinger width in its lowest ${(bbwRank * 100).toFixed(0)}% with ADX ${adxV.toFixed(0)}`;
  } else if (adxV >= 22 && a && a.pdi > a.mdi && e21 != null && px > e21 && slope > 0.15 && structure !== "lh-ll") {
    regime = "trend-up";
    why = `ADX ${adxV.toFixed(0)}, +DI over -DI, price above a rising EMA21${structure === "hh-hl" ? ", higher highs and lows" : ""}`;
  } else if (adxV >= 22 && a && a.mdi > a.pdi && e21 != null && px < e21 && slope < -0.15 && structure !== "hh-hl") {
    regime = "trend-down";
    why = `ADX ${adxV.toFixed(0)}, -DI over +DI, price below a falling EMA21${structure === "lh-ll" ? ", lower highs and lows" : ""}`;
  } else if (adxV < 20 && eff < 0.35) {
    regime = "range";
    why = `ADX ${adxV.toFixed(0)} and low directional efficiency (${eff.toFixed(2)})`;
  }
  return { regime, why, ...base };
}

const MEMO = new Map<string, { rg: RegimeRead; hb: { bias: Bias; min: number; why: string } }>();

/** Full signal-time snapshot. `candles` may include the forming candle: it is dropped, only closed candles are used. */
export function buildContext(input: { candles: Candle[]; now: number; side: Side; entry: number; stop: number | null; spreadPct: number | null; htfMin: number; tfMs?: number }): ContextSnapshot | null {
  const tfMs = input.tfMs || tfOf(input.candles);
  if (!(tfMs > 0) || input.candles.length < 60) return null;
  const last = input.candles[input.candles.length - 1]!;
  const closed = input.now - last.t < tfMs ? input.candles.slice(0, -1) : input.candles;
  if (closed.length < 60) return null;
  const lastC = closed[closed.length - 1]!;
  const mk = `${tfMs}|${input.htfMin}|${closed.length}|${closed[0]!.t}|${lastC.t}|${lastC.c}|${lastC.h}|${lastC.l}`;
  let hit = MEMO.get(mk);
  if (!hit) {
    hit = { rg: detectRegime(closed), hb: htfBias(closed, tfMs, input.htfMin) };
    if (MEMO.size > 800) MEMO.clear();
    MEMO.set(mk, hit);
  }
  const { rg, hb } = hit;
  const dir = input.side === "BUY" ? 1 : -1;
  const ext = rg.e21 != null && rg.atr ? (dir * (input.entry - rg.e21)) / rg.atr : null;
  const stopAtr = input.stop != null && rg.atr ? Math.abs(input.entry - input.stop) / rg.atr : null;
  return {
    regime: rg.regime,
    regimeWhy: rg.why,
    htfMin: hb.min,
    htfBias: hb.bias,
    htfWhy: hb.why,
    align: alignOf(input.side, hb.bias),
    structure: rg.structure,
    adx: rg.adx,
    atrPct: rg.atrPct,
    atrRank: rg.atrRank,
    bbwRank: rg.bbwRank,
    extensionAtr: ext,
    stopAtr,
    spreadPct: input.spreadPct,
    candleTime: closed[closed.length - 1]!.t,
    tfMin: Math.round(tfMs / 60_000),
  };
}
