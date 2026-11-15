import {
  adx,
  atrSeries,
  bollinger,
  channel,
  efficiency,
  ema,
  macdHist,
  percentRank,
  pivots,
  rsiSeries,
  volumeRatio,
  windowVwap,
} from "./indicators.ts";
import { MODE_PROFILES, type Action, type Candle, type Mode, type Plan, type Side } from "./types.ts";

export type Family = "trend" | "momentum" | "breakout" | "meanrev" | "structure";

export type Level = { p: number; n: number; i: number };
export type Zone = {
  side: Side;
  i: number;
  lo: number;
  hi: number;
  kind: "ob" | "fvg";
};
export type ModuleResult = {
  id: string;
  name: string;
  family: Family;
  verdict: "BUY" | "SELL" | "WAIT";
  score: number;
  why: string;
  plan: Plan | null;
};

export type StructureEvent = {
  kind: "BOS" | "CHoCH" | "sweep";
  side: Side;
  i: number;
  price: number;
  why: string;
};

const FIT: Record<string, Record<Family, number>> = {
  Trending: { trend: 1, momentum: 1, breakout: 0.9, meanrev: 0, structure: 0.8 },
  Ranging: { trend: 0.4, momentum: 0.4, breakout: 0.5, meanrev: 1, structure: 1 },
  Breakout: { trend: 0.9, momentum: 1, breakout: 1, meanrev: 0, structure: 0.7 },
  "High volatility": { trend: 0.7, momentum: 0.7, breakout: 0.7, meanrev: 0.3, structure: 0.7 },
  "Low volatility": { trend: 0.6, momentum: 0.6, breakout: 0.8, meanrev: 0.8, structure: 0.9 },
  Transitional: { trend: 0.7, momentum: 0.7, breakout: 0.7, meanrev: 0.5, structure: 0.8 },
  Abnormal: { trend: 0, momentum: 0, breakout: 0, meanrev: 0, structure: 0 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const last = <T,>(a: T[]) => a[a.length - 1]!;

export function makePlan(side: Side | "WAIT", price: number, atr: number | null, structStop: number | null, minRR: number): Plan | null {
  if (side === "WAIT" || !(atr && atr > 0) || !(price > 0)) return null;
  let dist = atr * 1.5;
  if (structStop != null) {
    const d = side === "BUY" ? price - structStop : structStop - price;
    if (d > 0) dist = clamp(d, atr * 0.8, atr * 3);
  }
  const rr = Math.max(1, minRR || 1.5);
  return side === "BUY"
    ? { entry: price, stop: price - dist, target: price + dist * rr, risk: dist, rr }
    : { entry: price, stop: price + dist, target: price - dist * rr, risk: dist, rr };
}

export type Snapshot = {
  candles: Candle[];
  closes: number[];
  price: number;
  atr: number | null;
  atrS: Array<number | null>;
  e9: number | null;
  e21: number | null;
  e50: number | null;
  e9s: Array<number | null>;
  e21s: Array<number | null>;
  e50s: Array<number | null>;
  rsi: number | null;
  rsiS: Array<number | null>;
  hist: Array<number | null>;
  adx: { adx: number; pdi: number; mdi: number } | null;
  piv: ReturnType<typeof pivots>;
  ch: { high: number; low: number } | null;
  bb: ReturnType<typeof bollinger>;
  vwap: Array<number | null>;
  eff: number | null;
  vol: number | null;
  regime: { name: string; why: string };
  levels: Level[];
  zones: Zone[];
  structure: StructureEvent[];
  minRR: number;
};

function clusterLevels(candles: Candle[], piv: ReturnType<typeof pivots>, atr: number): Level[] {
  const tol = Math.max(atr * 0.5, last(candles).c * 0.002);
  const out: Level[] = [];
  for (const p of [...piv.highs, ...piv.lows]) {
    const m = out.find((l) => Math.abs(l.p - p.p) <= tol);
    if (m) {
      m.p = (m.p * m.n + p.p) / (m.n + 1);
      m.n++;
      m.i = Math.max(m.i, p.i);
    } else out.push({ p: p.p, n: 1, i: p.i });
  }
  return out.sort((a, b) => a.p - b.p);
}

/**
 * Order block: last opposite-body candle immediately before a displacement of at least 1.6 ATR
 * within the next 3 closes. Fair value gap: candle i-2 and candle i do not overlap by at least 0.3 ATR.
 * A zone dies if a later close trades through it.
 */
function findZones(candles: Candle[], atr: number): Zone[] {
  const n = candles.length;
  const raw: Zone[] = [];
  const from = Math.max(2, n - 80);
  for (let i = from; i < n - 1; i++) {
    const c = candles[i]!;
    const end = Math.min(n - 1, i + 3);
    const move = candles[end]!.c - c.c;
    if (c.c < c.o && move >= atr * 1.6) raw.push({ side: "BUY", i, lo: c.l, hi: c.h, kind: "ob" });
    if (c.c > c.o && -move >= atr * 1.6) raw.push({ side: "SELL", i, lo: c.l, hi: c.h, kind: "ob" });
    if (i >= 2) {
      const a = candles[i - 2]!;
      const b = candles[i]!;
      if (a.h < b.l && b.l - a.h >= atr * 0.3) raw.push({ side: "BUY", i: i - 1, lo: a.h, hi: b.l, kind: "fvg" });
      if (a.l > b.h && a.l - b.h >= atr * 0.3) raw.push({ side: "SELL", i: i - 1, lo: b.h, hi: a.l, kind: "fvg" });
    }
  }
  const alive = raw.filter((z) => {
    for (let j = z.i + 2; j < n; j++) {
      if (z.side === "BUY" && candles[j]!.c < z.lo) return false;
      if (z.side === "SELL" && candles[j]!.c > z.hi) return false;
    }
    return true;
  });
  return alive.slice(-6);
}

/**
 * BOS: a close beyond the latest confirmed swing in the direction of the prior swing sequence.
 * CHoCH: that break goes against the sequence (HH+HL broken down, or LH+LL broken up).
 * Sweep: a wick takes a prior swing by ≥ 0.05 ATR and the close returns inside it.
 */
function structureOf(candles: Candle[], piv: ReturnType<typeof pivots>, atr: number | null): StructureEvent[] {
  const events: StructureEvent[] = [];
  const highs = piv.highs;
  const lows = piv.lows;
  if (highs.length >= 2 && lows.length >= 2 && atr) {
    const h0 = highs[highs.length - 2]!;
    const h1 = highs[highs.length - 1]!;
    const l0 = lows[lows.length - 2]!;
    const l1 = lows[lows.length - 1]!;
    const bull = h1.p > h0.p && l1.p > l0.p;
    const bear = h1.p < h0.p && l1.p < l0.p;
    const lc = last(candles);
    const i = candles.length - 1;
    if (lc.c > h1.p) {
      events.push({
        kind: bear ? "CHoCH" : "BOS",
        side: "BUY",
        i,
        price: h1.p,
        why: bear
          ? `Close above ${h1.p.toPrecision(6)} breaks a lower-high sequence (change of character).`
          : `Close above swing high ${h1.p.toPrecision(6)} (break of structure).`,
      });
    }
    if (lc.c < l1.p) {
      events.push({
        kind: bull ? "CHoCH" : "BOS",
        side: "SELL",
        i,
        price: l1.p,
        why: bull
          ? `Close below ${l1.p.toPrecision(6)} breaks a higher-low sequence (change of character).`
          : `Close below swing low ${l1.p.toPrecision(6)} (break of structure).`,
      });
    }
    if (lc.l < l1.p - atr * 0.05 && lc.c > l1.p) {
      events.push({
        kind: "sweep",
        side: "BUY",
        i,
        price: l1.p,
        why: `Wick took the swing low ${l1.p.toPrecision(6)} and closed back above it.`,
      });
    }
    if (lc.h > h1.p + atr * 0.05 && lc.c < h1.p) {
      events.push({
        kind: "sweep",
        side: "SELL",
        i,
        price: h1.p,
        why: `Wick took the swing high ${h1.p.toPrecision(6)} and closed back below it.`,
      });
    }
  }
  return events;
}

function regimeOf(x: {
  adx: Snapshot["adx"];
  atrRank: number | null;
  bbwRank: number | null;
  atr: number | null;
  candles: Candle[];
  vol: number | null;
  ch: Snapshot["ch"];
  price: number;
}) {
  const lc = last(x.candles);
  const range = lc.h - lc.l;
  const prev = x.candles[x.candles.length - 2];
  if (x.atr && prev && (range > x.atr * 4.5 || Math.abs(lc.c - prev.c) > x.atr * 4)) {
    return { name: "Abnormal", why: `Last candle range ${(range / x.atr).toFixed(1)}× ATR. No new entries.` };
  }
  if (x.ch && x.vol != null && x.vol >= 1.3 && (x.price > x.ch.high || x.price < x.ch.low) && x.bbwRank != null && x.bbwRank <= 0.6) {
    return { name: "Breakout", why: "Close outside the prior 20-candle range on rising volume." };
  }
  if (x.atrRank != null && x.atrRank >= 0.9) return { name: "High volatility", why: "ATR is near the top of its recent range." };
  if (x.adx && x.adx.adx >= 25) return { name: "Trending", why: `ADX ${x.adx.adx.toFixed(0)} shows a directional market.` };
  if (x.adx && x.adx.adx < 18 && x.atrRank != null && x.atrRank <= 0.25) {
    return { name: "Low volatility", why: `ADX ${x.adx.adx.toFixed(0)} and ATR near its lows.` };
  }
  if (x.adx && x.adx.adx < 20) return { name: "Ranging", why: `ADX ${x.adx.adx.toFixed(0)} — no persistent direction.` };
  return { name: "Transitional", why: x.adx ? `ADX ${x.adx.adx.toFixed(0)} sits between range and trend.` : "Not enough data for a regime." };
}

export function snapshot(candles: Candle[], minRR: number): Snapshot | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.c);
  const price = last(closes);
  const e9s = ema(closes, 9);
  const e21s = ema(closes, 21);
  const e50s = ema(closes, 50);
  const rsiS = rsiSeries(closes);
  const hist = macdHist(closes);
  const atrS = atrSeries(candles);
  const bb = bollinger(closes);
  const atr = last(atrS);
  const adxV = adx(candles);
  const piv = pivots(candles, 3);
  const ch = channel(candles, 20);
  const bbw = bb.mid.map((m, i) => (m ? (bb.up[i]! - bb.lo[i]!) / m : null));
  const partial = {
    adx: adxV,
    atrRank: percentRank(atrS.slice(-100)),
    bbwRank: percentRank(bbw.slice(-100)),
    atr,
    candles,
    vol: volumeRatio(candles),
    ch,
    price,
  };
  return {
    candles,
    closes,
    price,
    atr,
    atrS,
    e9: last(e9s),
    e21: last(e21s),
    e50: last(e50s),
    e9s,
    e21s,
    e50s,
    rsi: last(rsiS),
    rsiS,
    hist,
    adx: adxV,
    piv,
    ch,
    bb,
    vwap: windowVwap(candles),
    eff: efficiency(candles),
    vol: partial.vol,
    regime: regimeOf(partial),
    levels: atr ? clusterLevels(candles, piv, atr) : [],
    zones: atr ? findZones(candles, atr) : [],
    structure: structureOf(candles, piv, atr),
    minRR,
  };
}

function mod(
  id: string,
  name: string,
  family: Family,
  verdict: ModuleResult["verdict"],
  score: number,
  why: string,
  plan: Plan | null,
): ModuleResult {
  return { id, name, family, verdict, score: Math.round(clamp(score, 0, 100)), why, plan: verdict === "WAIT" ? null : plan };
}

function scalper(x: Snapshot): ModuleResult {
  const { e9, e21, rsi, hist, vol } = x;
  let bull = 0;
  let bear = 0;
  const why: string[] = [];
  const h = last(hist);
  if (e9 != null && e21 != null) {
    if (e9 > e21) {
      bull++;
      why.push("EMA9 above EMA21");
    } else if (e9 < e21) {
      bear++;
      why.push("EMA9 below EMA21");
    }
  }
  if (rsi != null) {
    if (rsi >= 52 && rsi <= 72) {
      bull++;
      why.push(`RSI ${rsi.toFixed(0)} in the bullish zone`);
    } else if (rsi <= 48 && rsi >= 28) {
      bear++;
      why.push(`RSI ${rsi.toFixed(0)} in the bearish zone`);
    } else why.push(`RSI ${rsi.toFixed(0)} neutral or stretched`);
  }
  if (h != null) {
    if (h > 0) {
      bull++;
      why.push("MACD histogram positive");
    } else if (h < 0) {
      bear++;
      why.push("MACD histogram negative");
    }
  }
  const dir = Math.max(bull, bear);
  const side: ModuleResult["verdict"] = bull > bear ? "BUY" : bear > bull ? "SELL" : "WAIT";
  const volOk = vol == null || vol >= 1.05;
  let verdict: ModuleResult["verdict"] = "WAIT";
  let note = why.join(". ");
  if (dir >= 3 && side !== "WAIT") {
    if (!volOk) note += ". Volume below 1.05× average, so the scalper stands aside.";
    else verdict = side;
  }
  return mod("scalper", "Scalper", "trend", verdict, 25 * (dir + (volOk && dir ? 1 : 0)), note || "Not enough indicator agreement.", makePlan(side, x.price, x.atr, null, x.minRR));
}

function trend(x: Snapshot): ModuleResult {
  const { e21, e50, price, piv, adx: ax } = x;
  let up = 0;
  let dn = 0;
  const why: string[] = [];
  if (e21 != null && e50 != null) {
    if (e21 > e50) {
      up++;
      why.push("EMA21 above EMA50");
    } else if (e21 < e50) {
      dn++;
      why.push("EMA21 below EMA50");
    }
  }
  const e50a = x.e50s[x.e50s.length - 1];
  const e50b = x.e50s[x.e50s.length - 6];
  const slope = e50a != null && e50b != null ? e50a - e50b : 0;
  if (e50 != null && price > e50 && slope > 0) {
    up++;
    why.push("price above a rising EMA50");
  } else if (e50 != null && price < e50 && slope < 0) {
    dn++;
    why.push("price below a falling EMA50");
  }
  const h = piv.highs.slice(-2);
  const l = piv.lows.slice(-2);
  if (h.length === 2 && l.length === 2) {
    if (h[1]!.p > h[0]!.p && l[1]!.p > l[0]!.p) {
      up++;
      why.push("higher highs and higher lows");
    } else if (h[1]!.p < h[0]!.p && l[1]!.p < l[0]!.p) {
      dn++;
      why.push("lower highs and lower lows");
    } else why.push("swing structure is mixed");
  }
  const adxOk = !!ax && ax.adx >= 20;
  if (adxOk) {
    if (up >= dn) up++;
    else dn++;
    why.push(`ADX ${ax!.adx.toFixed(0)}`);
  } else why.push(`ADX ${ax ? ax.adx.toFixed(0) : "n/a"} is below 20`);
  const side: Side | "WAIT" = up > dn ? "BUY" : dn > up ? "SELL" : "WAIT";
  const pts = Math.max(up, dn);
  let struct: number | null = null;
  if (side === "BUY" && l.length === 2 && x.atr) struct = l[1]!.p - x.atr * 0.25;
  if (side === "SELL" && h.length === 2 && x.atr) struct = h[1]!.p + x.atr * 0.25;
  const verdict = pts >= 3 && adxOk && side !== "WAIT" ? side : "WAIT";
  return mod("trend", "Trend", "trend", verdict, 25 * pts, why.join(". "), makePlan(side, price, x.atr, struct, x.minRR));
}

function momentum(x: Snapshot): ModuleResult {
  const n = x.closes.length;
  const rsi = x.rsi;
  const h0 = x.hist[n - 1];
  const h1 = x.hist[n - 2];
  const h2 = x.hist[n - 3];
  if (rsi == null || h0 == null || h1 == null || h2 == null || n < 12) {
    return mod("momentum", "Momentum", "momentum", "WAIT", 0, "Not enough data.", null);
  }
  const roc = ((x.price - x.closes[n - 11]!) / x.closes[n - 11]!) * 100;
  const rsiSlope = rsi - (x.rsiS[n - 4] ?? rsi);
  const why: string[] = [];
  let up = 0;
  let dn = 0;
  if (rsi >= 50 && rsiSlope > 0) {
    up++;
    why.push(`RSI ${rsi.toFixed(0)} rising`);
  } else if (rsi <= 50 && rsiSlope < 0) {
    dn++;
    why.push(`RSI ${rsi.toFixed(0)} falling`);
  }
  if (h0 > 0 && h0 > h1 && h1 >= h2) {
    up++;
    why.push("MACD histogram expanding up");
  } else if (h0 < 0 && h0 < h1 && h1 <= h2) {
    dn++;
    why.push("MACD histogram expanding down");
  }
  if (roc > 0.15) {
    up++;
    why.push(`10-candle ROC +${roc.toFixed(2)}%`);
  } else if (roc < -0.15) {
    dn++;
    why.push(`10-candle ROC ${roc.toFixed(2)}%`);
  }
  const exhausted = rsi > 75 || rsi < 25;
  const weakening = (h0 > 0 && h0 < h1) || (h0 < 0 && h0 > h1);
  const side: Side | "WAIT" = up > dn ? "BUY" : dn > up ? "SELL" : "WAIT";
  const pts = Math.max(up, dn);
  let verdict: ModuleResult["verdict"] = pts >= 3 && side !== "WAIT" ? side : "WAIT";
  let note = why.join(". ");
  if (exhausted) {
    verdict = "WAIT";
    note += ". Exhausted: RSI beyond 75/25.";
  } else if (weakening && verdict !== "WAIT") {
    verdict = "WAIT";
    note += ". Momentum is weakening.";
  }
  return mod("momentum", "Momentum", "momentum", verdict, 25 * pts - (exhausted ? 20 : 0), note, makePlan(side, x.price, x.atr, null, x.minRR));
}

function breakout(x: Snapshot): ModuleResult {
  const { ch, price, atr, vol } = x;
  const lc = last(x.candles);
  if (!ch || !atr) return mod("breakout", "Breakout", "breakout", "WAIT", 0, "Not enough candles for a 20-bar range.", null);
  const range = lc.h - lc.l || 1e-12;
  const body = Math.abs(lc.c - lc.o);
  const dirUp = price > ch.high;
  const dirDn = price < ch.low;
  const side: Side | "WAIT" = dirUp ? "BUY" : dirDn ? "SELL" : "WAIT";
  if (side === "WAIT") {
    return mod("breakout", "Breakout", "breakout", "WAIT", 20, "No close beyond the prior 20-candle range.", null);
  }
  const dist = side === "BUY" ? price - ch.high : ch.low - price;
  const volOk = vol == null || vol >= 1.2;
  const wick = side === "BUY" ? (lc.h - lc.c) / range : (lc.c - lc.l) / range;
  const strong = wick <= 0.4 && body / range >= 0.4;
  const notExtended = dist <= atr * 1.5;
  const why = [`Closed ${side === "BUY" ? "above" : "below"} the range by ${(dist / atr).toFixed(2)} ATR`];
  let pts = 1;
  if (volOk) {
    pts++;
    why.push(vol ? `volume ${vol.toFixed(2)}×` : "volume not available, not treated as a failure");
  } else why.push("volume is weak");
  if (strong) {
    pts++;
    why.push("close is strong");
  } else why.push("long wick, false-break risk");
  if (notExtended) {
    pts++;
    why.push("not extended beyond 1.5 ATR");
  } else why.push("already extended");
  const struct = side === "BUY" ? ch.high - atr * 0.5 : ch.low + atr * 0.5;
  const verdict = pts >= 4 && volOk && strong ? side : "WAIT";
  return mod("breakout", "Breakout", "breakout", verdict, pts * 20, why.join(". "), makePlan(side, price, atr, struct, x.minRR));
}

function meanrev(x: Snapshot): ModuleResult {
  const n = x.closes.length;
  const m = x.bb.mid[n - 1];
  const u = x.bb.up[n - 1];
  const l = x.bb.lo[n - 1];
  const { rsi, atr, regime, price } = x;
  if (m == null || u == null || l == null || rsi == null || !atr) {
    return mod("meanrev", "Mean reversion", "meanrev", "WAIT", 0, "Not enough data.", null);
  }
  const suited = ["Ranging", "Low volatility", "Transitional"].includes(regime.name) && (x.adx ? x.adx.adx < 25 : true);
  if (!suited) {
    return mod("meanrev", "Mean reversion", "meanrev", "WAIT", 5, `Off in a ${regime.name.toLowerCase()} regime.`, null);
  }
  const lc = last(x.candles);
  let side: Side | "WAIT" = "WAIT";
  let why = `Inside the bands. RSI ${rsi.toFixed(0)}.`;
  if (lc.l <= l && price > l && rsi < 35) {
    side = "BUY";
    why = `Pierced the lower band and closed back inside. RSI ${rsi.toFixed(0)}.`;
  } else if (price < l && rsi < 30) {
    side = "BUY";
    why = `Closed below the lower band. RSI ${rsi.toFixed(0)}.`;
  } else if (lc.h >= u && price < u && rsi > 65) {
    side = "SELL";
    why = `Pierced the upper band and closed back inside. RSI ${rsi.toFixed(0)}.`;
  } else if (price > u && rsi > 70) {
    side = "SELL";
    why = `Closed above the upper band. RSI ${rsi.toFixed(0)}.`;
  }
  const p = makePlan(side, price, atr, side === "BUY" ? Math.min(lc.l, l) - atr * 0.3 : side === "SELL" ? Math.max(lc.h, u) + atr * 0.3 : null, x.minRR);
  if (p) {
    const toMid = Math.abs(m - price);
    if (toMid > p.risk * 0.8) {
      p.target = m;
      p.rr = toMid / p.risk;
    }
    if (p.rr < 1) return mod("meanrev", "Mean reversion", "meanrev", "WAIT", 30, why + " The mean is too close.", null);
  }
  return mod("meanrev", "Mean reversion", "meanrev", side, side === "WAIT" ? 25 : 70, why, p);
}

function priceAction(x: Snapshot): ModuleResult {
  const { candles, price, atr, levels, zones } = x;
  if (!atr) return mod("price", "Price action", "structure", "WAIT", 0, "Not enough data.", null);
  const lc = last(candles);
  const pc = candles[candles.length - 2]!;
  const bullClose = lc.c > lc.o && lc.c > pc.c;
  const bearClose = lc.c < lc.o && lc.c < pc.c;
  for (const side of ["BUY", "SELL"] as const) {
    const hit = zones.filter((q) => q.side === side && lc.l <= q.hi + atr * 0.15 && lc.h >= q.lo - atr * 0.15);
    if (!hit.length || !(side === "BUY" ? bullClose : bearClose)) continue;
    const edge = side === "BUY" ? Math.min(...hit.map((q) => q.lo)) - atr * 0.25 : Math.max(...hit.map((q) => q.hi)) + atr * 0.25;
    const kinds = [...new Set(hit.map((q) => (q.kind === "ob" ? "order block" : "fair value gap")))];
    const near = levels.some((lv) => Math.abs(lv.p - price) <= atr * 1.2 && (side === "BUY" ? lv.p <= price : lv.p >= price));
    return mod(
      "price",
      "Price action",
      "structure",
      side,
      55 + (near ? 20 : 0) + (kinds.length > 1 ? 10 : 0),
      `${side === "BUY" ? "Bullish" : "Bearish"} close inside a ${kinds.join(" and ")}.`,
      makePlan(side, price, atr, edge, x.minRR),
    );
  }
  const structs = x.structure.filter((s) => s.kind === "sweep" || s.kind === "CHoCH");
  if (structs[0]) {
    const s = structs[0];
    return mod("price", "Price action", "structure", s.side, s.kind === "sweep" ? 62 : 58, s.why, makePlan(s.side, price, atr, null, x.minRR));
  }
  return mod(
    "price",
    "Price action",
    "structure",
    "WAIT",
    20,
    `${zones.length} unmitigated zone(s). Price is not reacting inside one.`,
    null,
  );
}

export type Decision = {
  action: Action;
  reason: string;
  quality: number;
  regime: string;
  plan: Plan | null;
  modules: ModuleResult[];
  lead: string | null;
  net: number;
  agreeFamilies: number;
  opposeFamilies: number;
  candleTime: number;
  price: number;
  atr: number | null;
  spreadNote: string;
};

/** Single fast decision. Modules are inputs, not a voting council. No AI call. */
export function decide(candles: Candle[], mode: Mode): Decision | null {
  const profile = MODE_PROFILES[mode];
  const snap = snapshot(candles, profile.minRR);
  if (!snap) return null;
  const modules = [scalper(snap), trend(snap), momentum(snap), breakout(snap), meanrev(snap), priceAction(snap)];
  const fit = FIT[snap.regime.name] ?? FIT.Transitional!;
  if (snap.regime.name === "Abnormal") {
    return {
      action: "WAIT",
      reason: snap.regime.why,
      quality: 0,
      regime: snap.regime.name,
      plan: null,
      modules,
      lead: null,
      net: 0,
      agreeFamilies: 0,
      opposeFamilies: 0,
      candleTime: last(candles).t,
      price: snap.price,
      atr: snap.atr,
      spreadNote: "Spread is checked separately by the risk engine.",
    };
  }
  const best = new Map<Family, { m: ModuleResult; w: number }>();
  for (const m of modules) {
    if (m.verdict === "WAIT") continue;
    const f = fit[m.family] ?? 0;
    if (f <= 0) continue;
    const w = (m.score / 100) * f;
    const prev = best.get(m.family);
    if (!prev || w > prev.w) best.set(m.family, { m, w });
  }
  let buy = 0;
  let sell = 0;
  let buyN = 0;
  let sellN = 0;
  for (const { m, w } of best.values()) {
    if (m.verdict === "BUY") {
      buy += w;
      buyN++;
    } else {
      sell += w;
      sellN++;
    }
  }
  const net = buy + sell === 0 ? 0 : (buy - sell) / (buy + sell);
  const side: Side | "WAIT" = buy > sell ? "BUY" : sell > buy ? "SELL" : "WAIT";
  const agree = side === "BUY" ? buyN : side === "SELL" ? sellN : 0;
  const oppose = side === "BUY" ? sellN : side === "SELL" ? buyN : 0;
  const lead = [...best.values()]
    .map((x) => x.m)
    .filter((m) => m.verdict === side)
    .sort((a, b) => b.score - a.score)[0];
  const quality =
    side === "WAIT" ? Math.round(30 * Math.abs(net)) : Math.round(Math.min(100, 55 * Math.abs(net) + 0.45 * (lead?.score ?? 0)));
  const bits: string[] = [];
  let action: Action = "WAIT";
  if (side !== "WAIT" && agree >= profile.minFamilies && Math.abs(net) >= profile.minNet && quality >= profile.minScore && oppose <= profile.maxOppose && lead?.plan) {
    action = side;
    bits.push(`${side} · quality ${quality}. ${agree} module famil${agree === 1 ? "y" : "ies"} (${lead.name} leads).`);
    bits.push(lead.why);
  } else if (side === "WAIT") bits.push("Modules do not agree on a direction.");
  else {
    if (agree < profile.minFamilies) bits.push(`${agree} agreeing famil${agree === 1 ? "y" : "ies"}, needs ${profile.minFamilies}.`);
    if (quality < profile.minScore) bits.push(`Quality ${quality} is below ${profile.minScore} for ${mode}.`);
    if (Math.abs(net) < profile.minNet) bits.push(`Conviction ${Math.abs(net).toFixed(2)} is below ${profile.minNet}.`);
    if (oppose > profile.maxOppose) bits.push(`${oppose} opposing famil${oppose === 1 ? "y" : "ies"}.`);
    if (!lead?.plan) bits.push("No priced plan.");
  }
  bits.push(`${snap.regime.name}: ${snap.regime.why}`);
  return {
    action,
    reason: bits.join(" "),
    quality,
    regime: snap.regime.name,
    plan: action === "BUY" || action === "SELL" ? lead!.plan : null,
    modules,
    lead: lead?.id ?? null,
    net,
    agreeFamilies: agree,
    opposeFamilies: oppose,
    candleTime: last(candles).t,
    price: snap.price,
    atr: snap.atr,
    spreadNote: "Spread is checked separately by the risk engine.",
  };
}

export function analyze(candles: Candle[], mode: Mode) {
  const profile = MODE_PROFILES[mode];
  const snap = snapshot(candles, profile.minRR);
  const decision = decide(candles, mode);
  return { snap, decision };
}
