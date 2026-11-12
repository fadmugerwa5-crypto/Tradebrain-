import type { Candle } from "../market/types.ts";
import { adx, atrSeries, bollinger, efficiency, ema, rsi, volumeRatio } from "../market/indicators.ts";
import type { Brief } from "./types.ts";

const last = <T,>(a: Array<T | null>): T | null => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i] as T;
  return null;
};

export type BriefInput = {
  symbol: string;
  label: string;
  group: string;
  candles: Candle[];
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  intervalMs: number;
  now: number;
  canShort: boolean;
};

/** Turns raw candles into the numbers the agents read. Returns null when there is not enough data to say anything. */
export function buildBrief(x: BriefInput): Brief | null {
  const c = x.candles;
  if (c.length < 30) return null;
  const closes = c.map((k) => k.c);
  const lastCandle = c[c.length - 1]!;
  const price = x.last != null && x.last > 0 ? x.last : lastCandle.c;
  if (!(price > 0)) return null;
  const atrNow = last(atrSeries(c, 14));
  if (atrNow == null || !(atrNow > 0)) return null;
  const e9 = last(ema(closes, 9));
  const e21 = last(ema(closes, 21));
  const e50 = c.length >= 55 ? last(ema(closes, 50)) : null;
  const a = adx(c, 14);
  const bb = bollinger(closes, 20, 2);
  const up = last(bb.up);
  const lo = last(bb.lo);
  const bbPos = up != null && lo != null && up > lo ? (price - lo) / (up - lo) : null;
  const eff = efficiency(c, 12);
  const back = c[Math.max(0, c.length - 11)]!.c;
  const changePct = back > 0 ? ((price - back) / back) * 100 : 0;
  const win = c.slice(-20);
  const rangeHigh = Math.max(...win.map((k) => k.h));
  const rangeLow = Math.min(...win.map((k) => k.l));
  const spreadPct = x.bid != null && x.ask != null && x.bid > 0 && x.ask > 0 ? ((x.ask - x.bid) / ((x.ask + x.bid) / 2)) * 100 : null;
  const vr = volumeRatio(c);
  const atrPct = (atrNow / price) * 100;
  const mom = Math.min(4, Math.abs(price - back) / atrNow) / 4;
  const volN = Math.min(vr ?? 1, 3) / 3;
  let rank = (eff ?? 0) + mom + volN;
  if (spreadPct != null && spreadPct > 0.1) rank -= 0.5;
  if (atrPct < 0.005) rank -= 1;
  return {
    symbol: x.symbol,
    label: x.label,
    group: x.group,
    price,
    spreadPct,
    atr: atrNow,
    atrPct,
    changePct,
    rsi: rsi(closes, 14),
    ema9: e9,
    ema21: e21,
    ema50: e50,
    adx: a?.adx ?? null,
    pdi: a?.pdi ?? null,
    mdi: a?.mdi ?? null,
    efficiency: eff,
    bbPos,
    volRatio: vr,
    rangeHigh,
    rangeLow,
    tail: c.slice(-8).map((k) => [k.o, k.h, k.l, k.c]),
    candles: c.length,
    ageSec: Math.max(0, Math.round((x.now - lastCandle.t) / 1000)),
    canShort: x.canShort,
    rank,
  };
}

/** A feed is stale when its newest candle opened more than three intervals ago. */
export function isStale(b: Brief, intervalMs: number): boolean {
  return b.ageSec * 1000 > intervalMs * 3 + 5000;
}

const f = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? "n/a" : Math.abs(n) >= 100 ? n.toFixed(Math.max(0, d - 1)) : Math.abs(n) >= 1 ? n.toFixed(d + 1) : n.toPrecision(5));

export function briefText(b: Brief): string {
  return [
    `${b.symbol} (${b.label}, ${b.group}) price ${f(b.price)}`,
    `spread ${b.spreadPct == null ? "n/a" : b.spreadPct.toFixed(3) + "%"}, ATR ${f(b.atr)} (${b.atrPct.toFixed(3)}% of price), change over 10 candles ${b.changePct >= 0 ? "+" : ""}${b.changePct.toFixed(3)}%`,
    `RSI ${f(b.rsi, 0)}, EMA9 ${f(b.ema9)}, EMA21 ${f(b.ema21)}, EMA50 ${f(b.ema50)}, ADX ${f(b.adx, 0)} (+DI ${f(b.pdi, 0)}, -DI ${f(b.mdi, 0)}), efficiency ${f(b.efficiency)}, Bollinger position ${f(b.bbPos)} (0 = lower band, 1 = upper), volume x${f(b.volRatio)} of normal`,
    `20-candle range ${f(b.rangeLow)} to ${f(b.rangeHigh)}, newest candle opened ${b.ageSec}s ago, shorting ${b.canShort ? "allowed" : "NOT possible here (long only)"}`,
    `last candles (open,high,low,close): ${b.tail.map((k) => k.map((v) => f(v)).join(",")).join(" | ")}`,
  ].join("\n");
}

export function shortlistText(list: Brief[]): string {
  return list
    .map(
      (b, i) =>
        `${i + 1}. ${b.symbol} price ${f(b.price)}, ATR ${b.atrPct.toFixed(3)}%, change10 ${b.changePct >= 0 ? "+" : ""}${b.changePct.toFixed(3)}%, RSI ${f(b.rsi, 0)}, ADX ${f(b.adx, 0)}, efficiency ${f(b.efficiency)}, volume x${f(b.volRatio)}, spread ${b.spreadPct == null ? "n/a" : b.spreadPct.toFixed(3) + "%"}, ${b.canShort ? "long/short" : "long only"}`,
    )
    .join("\n");
}

/** Best first. Stale or thin markets are left out. */
export function rankBriefs(list: Brief[], intervalMs: number, n: number): Brief[] {
  return list
    .filter((b) => !isStale(b, intervalMs))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(1, n));
}
