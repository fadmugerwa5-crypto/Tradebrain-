import type { Candle } from "./types";

export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** EMA. Entries before the first full window are null. Seed is the SMA of the first `period` values. */
export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period || period < 1) return out;
  const k = 2 / (period + 1);
  let prev = mean(values.slice(0, period));
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsiSeries(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const pack = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = pack();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = pack();
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  const s = rsiSeries(values, period);
  return s[s.length - 1] ?? null;
}

/** MACD histogram series (line − signal). Null until both EMAs and the signal exist. */
export function macdHist(values: number[]): Array<number | null> {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) =>
    fast[i] != null && slow[i] != null ? fast[i]! - slow[i]! : null,
  );
  const first = line.findIndex((v) => v != null);
  const hist: Array<number | null> = new Array(values.length).fill(null);
  if (first < 0) return hist;
  const sig = ema(
    line.slice(first).map((v) => v ?? 0),
    9,
  );
  // ema() on a compact array treats leading nulls as zeros if we map them — only pass defined values.
  const compact = line.slice(first).filter((v): v is number => v != null);
  const sigC = ema(compact, 9);
  // Map signal back: compact index aligns with line index from `first` only if no interior nulls.
  sigC.forEach((s, j) => {
    if (s != null) hist[first + j] = compact[j]! - s;
  });
  void sig;
  return hist;
}

export function macdLatest(values: number[]): { line: number; signal: number; hist: number } | null {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) =>
    fast[i] != null && slow[i] != null ? fast[i]! - slow[i]! : null,
  );
  const compact = line.filter((v): v is number => v != null);
  const sig = ema(compact, 9).filter((v): v is number => v != null);
  if (!sig.length) return null;
  const l = compact[compact.length - 1]!;
  const s = sig[sig.length - 1]!;
  return { line: l, signal: s, hist: l - s };
}

export function atrSeries(candles: Candle[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  const tr: Array<number | null> = [null];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  for (let i = period; i < candles.length; i++) {
    out[i] = mean(tr.slice(i - period + 1, i + 1).filter((x): x is number => x != null));
  }
  return out;
}

export function bollinger(values: number[], period = 20, k = 2) {
  const mid: Array<number | null> = [];
  const up: Array<number | null> = [];
  const lo: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      mid.push(null);
      up.push(null);
      lo.push(null);
      continue;
    }
    const w = values.slice(i - period + 1, i + 1);
    const m = mean(w);
    const sd = Math.sqrt(mean(w.map((x) => (x - m) ** 2)));
    mid.push(m);
    up.push(m + k * sd);
    lo.push(m - k * sd);
  }
  return { mid, up, lo };
}

/** Wilder ADX with the latest +DI / −DI. Needs about 2×period candles. */
export function adx(candles: Candle[], period = 14): { adx: number; pdi: number; mdi: number } | null {
  if (candles.length < period * 2 + 1) return null;
  const tr: number[] = [];
  const pdm: number[] = [];
  const mdm: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    const up = c.h - p.h;
    const dn = p.l - c.l;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const smooth = (a: number[]) => {
    let s = a.slice(0, period).reduce((x, y) => x + y, 0);
    const o = [s];
    for (let i = period; i < a.length; i++) {
      s = s - s / period + a[i]!;
      o.push(s);
    }
    return o;
  };
  const t = smooth(tr);
  const p = smooth(pdm);
  const m = smooth(mdm);
  const dx: number[] = [];
  let pdi = 0;
  let mdi = 0;
  for (let i = 0; i < t.length; i++) {
    pdi = t[i] ? (100 * p[i]!) / t[i]! : 0;
    mdi = t[i] ? (100 * m[i]!) / t[i]! : 0;
    dx.push(pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0);
  }
  if (dx.length < period) return null;
  let a = mean(dx.slice(0, period));
  for (let i = period; i < dx.length; i++) a = (a * (period - 1) + dx[i]!) / period;
  return { adx: a, pdi, mdi };
}

/** Confirmed swings. A pivot needs `n` bars on both sides, so the last `n` candles never repaint. */
export function pivots(candles: Candle[], n = 3) {
  const highs: { i: number; p: number }[] = [];
  const lows: { i: number; p: number }[] = [];
  for (let i = n; i < candles.length - n; i++) {
    let hi = true;
    let lo = true;
    for (let j = 1; j <= n; j++) {
      if (!(candles[i]!.h > candles[i - j]!.h && candles[i]!.h >= candles[i + j]!.h)) hi = false;
      if (!(candles[i]!.l < candles[i - j]!.l && candles[i]!.l <= candles[i + j]!.l)) lo = false;
    }
    if (hi) highs.push({ i, p: candles[i]!.h });
    if (lo) lows.push({ i, p: candles[i]!.l });
  }
  return { highs, lows };
}

/** Directional efficiency: net move ÷ path. 1 is a straight line, 0 is chop. */
export function efficiency(candles: Candle[], period = 12): number | null {
  if (candles.length < period + 1) return null;
  const r = candles.slice(-period - 1);
  let path = 0;
  for (let i = 1; i < r.length; i++) path += Math.abs(r[i]!.c - r[i - 1]!.c);
  return path ? Math.abs(r[r.length - 1]!.c - r[0]!.c) / path : 0;
}

/** Highest high / lowest low of the `period` candles BEFORE the latest one. */
export function channel(candles: Candle[], period = 20): { high: number; low: number } | null {
  const w = candles.slice(-period - 1, -1);
  if (w.length < period) return null;
  return { high: Math.max(...w.map((c) => c.h)), low: Math.min(...w.map((c) => c.l)) };
}

export function volumeRatio(candles: Candle[]): number | null {
  const prev = candles.slice(-21, -1).map((c) => c.v);
  const avg = mean(prev);
  if (!(avg > 0)) return null;
  return candles[candles.length - 1]!.v / avg;
}

export function percentRank(arr: Array<number | null>): number | null {
  const v = arr.filter((x): x is number => x != null);
  if (v.length < 5) return null;
  const last = v[v.length - 1]!;
  return v.filter((x) => x <= last).length / v.length;
}

export function quality(candles: Candle[], tfMs: number, now = Date.now()) {
  let gaps = 0;
  let dupes = 0;
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i]!.t - candles[i - 1]!.t;
    if (d === 0) dupes++;
    else if (d > tfMs * 1.5) gaps++;
  }
  const ageMs = candles.length ? now - candles[candles.length - 1]!.t - tfMs : Infinity;
  return { gaps, dupes, ageMs, stale: ageMs > tfMs * 3, ok: gaps === 0 && dupes === 0 && ageMs <= tfMs * 3 };
}

/** Cumulative typical-price VWAP across the supplied window, not a broker session VWAP. */
export function windowVwap(candles: Candle[]): Array<number | null> {
  let pv = 0;
  let vv = 0;
  return candles.map((c) => {
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * c.v;
    vv += c.v;
    return vv > 0 ? pv / vv : null;
  });
}

/** MACD line, signal and histogram aligned to the input. Periods are configurable; defaults 12/26/9. */
export function macdSeries(values: number[], fastP = 12, slowP = 26, sigP = 9) {
  const fast = ema(values, fastP);
  const slow = ema(values, slowP);
  const line: Array<number | null> = values.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i]! - slow[i]! : null));
  const signal: Array<number | null> = new Array(values.length).fill(null);
  const hist: Array<number | null> = new Array(values.length).fill(null);
  const first = line.findIndex((v) => v != null);
  if (first < 0) return { line, signal, hist };
  const compact = line.slice(first).filter((v): v is number => v != null);
  ema(compact, sigP).forEach((sv, j) => {
    if (sv != null) {
      signal[first + j] = sv;
      hist[first + j] = compact[j]! - sv;
    }
  });
  return { line, signal, hist };
}
