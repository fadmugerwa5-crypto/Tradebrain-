import type { Candle } from "./types.ts";
import { atrSeries, ema, macdLatest, pivots, rsi } from "./indicators.ts";

export type Tone = "up" | "down" | "flat";
export type Reading = { key: string; label: string; doing: string; value: string; tone: Tone };

const fmtPx = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : Math.abs(n) >= 1 ? n.toFixed(4) : n.toPrecision(4));
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function sessionOf(hourUtc: number): string {
  if (hourUtc < 7) return "Asia";
  if (hourUtc < 12) return "London";
  if (hourUtc < 16) return "London + New York";
  if (hourUtc < 21) return "New York";
  return "Late / quiet";
}

/** Eight plain readings taken from the candles that are really loaded for this market. Nothing here is invented. */
export function takeReadings(candles: Candle[], interval: string, rsiPeriod: number): Reading[] {
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1]!;
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const a21 = e21[e21.length - 1];
  const a50 = e50[e50.length - 1];
  const b50 = e50[e50.length - 6];
  const trend: Reading = (() => {
    if (a21 == null || a50 == null) return { key: "trend", label: `Trend · ${interval}`, doing: "Reading the trend", value: "Not enough data", tone: "flat" as Tone };
    const slopeUp = b50 != null && a50 > b50;
    if (a21 > a50 && slopeUp) return { key: "trend", label: `Trend · ${interval}`, doing: "Reading the trend", value: "Up", tone: "up" as Tone };
    if (a21 < a50 && b50 != null && a50 < b50) return { key: "trend", label: `Trend · ${interval}`, doing: "Reading the trend", value: "Down", tone: "down" as Tone };
    return { key: "trend", label: `Trend · ${interval}`, doing: "Reading the trend", value: "Sideways", tone: "flat" as Tone };
  })();
  const pv = pivots(candles, 3);
  const below = pv.lows.filter((p) => p.p < last).sort((a, b) => b.p - a.p)[0];
  const above = pv.highs.filter((p) => p.p > last).sort((a, b) => a.p - b.p)[0];
  const support: Reading = below
    ? { key: "support", label: "Support", doing: "Mapping support", value: `${fmtPx(below.p)} · ${(((last - below.p) / last) * 100).toFixed(2)}% below`, tone: "up" }
    : { key: "support", label: "Support", doing: "Mapping support", value: "None nearby", tone: "flat" };
  const n = Math.min(5, closes.length - 1);
  const moveP = n > 0 ? ((last - closes[closes.length - 1 - n]!) / closes[closes.length - 1 - n]!) * 100 : 0;
  const move: Reading = { key: "move", label: `Move over ${n} candles`, doing: "Measuring the move", value: pct(moveP), tone: moveP > 0.001 ? "up" : moveP < -0.001 ? "down" : "flat" };
  const mac = macdLatest(closes);
  const momentum: Reading = mac
    ? { key: "momentum", label: "Momentum", doing: "Measuring momentum", value: mac.hist > 0 ? "Rising" : mac.hist < 0 ? "Falling" : "Flat", tone: mac.hist > 0 ? "up" : mac.hist < 0 ? "down" : "flat" }
    : { key: "momentum", label: "Momentum", doing: "Measuring momentum", value: "Not enough data", tone: "flat" };
  const lastT = candles[candles.length - 1]!.t;
  const hr = new Date(lastT > 1e12 ? lastT : lastT * 1000).getUTCHours();
  const session: Reading = { key: "session", label: "Session", doing: "Checking the session", value: sessionOf(hr), tone: "flat" };
  const v200 = e200[e200.length - 1];
  const emas: Reading =
    a50 == null
      ? { key: "ema", label: "EMA 50/200", doing: "Checking EMA 50/200", value: "Not enough data", tone: "flat" }
      : v200 == null
        ? { key: "ema", label: "EMA 50/200", doing: "Checking EMA 50/200", value: last > a50 ? "Above 50 (200 needs more candles)" : "Below 50 (200 needs more candles)", tone: last > a50 ? "up" : "down" }
        : last > a50 && last > v200
          ? { key: "ema", label: "EMA 50/200", doing: "Checking EMA 50/200", value: "Above both", tone: "up" }
          : last < a50 && last < v200
            ? { key: "ema", label: "EMA 50/200", doing: "Checking EMA 50/200", value: "Below both", tone: "down" }
            : { key: "ema", label: "EMA 50/200", doing: "Checking EMA 50/200", value: "Between them", tone: "flat" };
  const atr = atrSeries(candles, 14);
  const a = atr[atr.length - 1];
  const nearSup = below && a != null ? last - below.p <= a * 0.6 : false;
  const nearRes = above && a != null ? above.p - last <= a * 0.6 : false;
  const level: Reading = nearSup
    ? { key: "level", label: "Price at level", doing: "Checking price at level", value: "At support", tone: "up" }
    : nearRes
      ? { key: "level", label: "Price at level", doing: "Checking price at level", value: "At resistance", tone: "down" }
      : { key: "level", label: "Price at level", doing: "Checking price at level", value: "Between levels", tone: "flat" };
  const r = rsi(closes, rsiPeriod);
  const rs: Reading =
    r == null
      ? { key: "rsi", label: `RSI ${rsiPeriod}`, doing: "Reading RSI", value: "Not enough data", tone: "flat" }
      : { key: "rsi", label: `RSI ${rsiPeriod}`, doing: "Reading RSI", value: `${r.toFixed(0)}${r >= 70 ? " · overbought" : r <= 30 ? " · oversold" : ""}`, tone: r >= 70 ? "down" : r <= 30 ? "up" : "flat" };
  return [trend, support, move, momentum, session, emas, level, rs];
}

