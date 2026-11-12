import type { TradeRecord } from "./types.ts";

export type Confidence = "insufficient" | "low" | "medium" | "high";
export type Metrics = {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Winning share with a 95% Wilson interval. */
  winCI: [number, number];
  /** Average net result per trade in R (expectancy). */
  expectancy: number;
  /** 95% interval around the expectancy (normal approximation). Wide when n is small. */
  expCI: [number, number];
  avgWinR: number;
  avgLossR: number;
  profitFactor: number | null;
  netR: number;
  maxDrawdownR: number;
  maxLossStreak: number;
  confidence: Confidence;
};

/** Practical sample gates from the blueprint: under 30 is low confidence, 30-99 medium, 100+ high. */
export function confidenceOf(n: number): Confidence {
  return n < 10 ? "insufficient" : n < 30 ? "low" : n < 100 ? "medium" : "high";
}

function wilson(w: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = w / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

/** Metrics from a list of R results in time order. */
export function metricsOfR(rs: number[]): Metrics {
  const n = rs.length;
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const sum = rs.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const varr = n > 1 ? rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const se = n > 1 ? Math.sqrt(varr / n) : Infinity;
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let streak = 0;
  let maxStreak = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    if (r < 0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : 0,
    winCI: wilson(wins.length, n),
    expectancy: mean,
    expCI: Number.isFinite(se) ? [mean - 1.96 * se, mean + 1.96 * se] : [-Infinity, Infinity],
    avgWinR: wins.length ? gw / wins.length : 0,
    avgLossR: losses.length ? -gl / losses.length : 0,
    profitFactor: gl > 0 ? gw / gl : null,
    netR: sum,
    maxDrawdownR: dd,
    maxLossStreak: maxStreak,
    confidence: confidenceOf(n),
  };
}

/** Records with a known R, oldest first. Trades whose risk unit is unknown are left out of R statistics (never guessed). */
export const withR = (rs: TradeRecord[]) => rs.filter((r) => r.r != null).sort((a, b) => a.openedAt - b.openedAt);

export function metricsOf(rs: TradeRecord[]): Metrics {
  return metricsOfR(withR(rs).map((r) => r.r as number));
}

/**
 * Trades opened on the same market and side close together in time are not independent evidence (one idea, entered several times).
 * They are merged into one observation (average R) so a cluster of near-identical entries counts once.
 */
export function clusterR(rs: TradeRecord[], windowMs = 30 * 60_000): { t: number; r: number; rec: TradeRecord }[] {
  const out: { t: number; r: number; rec: TradeRecord; sum: number; k: number; key: string }[] = [];
  const last = new Map<string, number>();
  for (const rec of withR(rs)) {
    const key = `${rec.symbol}|${rec.side}`;
    const li = last.get(key);
    const cur = li != null ? out[li] : undefined;
    if (cur && rec.openedAt - cur.t <= windowMs) {
      cur.sum += rec.r as number;
      cur.k++;
      cur.r = cur.sum / cur.k;
      cur.t = rec.openedAt;
    } else {
      out.push({ t: rec.openedAt, r: rec.r as number, rec, sum: rec.r as number, k: 1, key });
      last.set(key, out.length - 1);
    }
  }
  return out.map(({ t, r, rec }) => ({ t, r, rec }));
}

export function metricsIndependent(rs: TradeRecord[]): Metrics {
  return metricsOfR(clusterR(rs).map((x) => x.r));
}

export const attr = (r: TradeRecord, dim: string): string => {
  switch (dim) {
    case "strategy": return r.strategy;
    case "symbol": return r.symbol;
    case "venue": return r.venue;
    case "side": return r.side;
    case "session": return r.session;
    case "book": return r.book;
    case "regime": return r.ctx?.regime ?? "unknown";
    case "align": return r.ctx?.align ?? "unknown";
    case "htf": return r.ctx?.htfBias ?? "unknown";
    default: return "unknown";
  }
};

/** Group trades by one or more attributes, e.g. segment(records, ["strategy","regime"]). */
export function segment(rs: TradeRecord[], dims: string[]): { key: string; label: string; recs: TradeRecord[]; m: Metrics }[] {
  const by = new Map<string, TradeRecord[]>();
  for (const r of rs) {
    const key = dims.map((d) => attr(r, d)).join(" | ");
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  return [...by.entries()]
    .map(([key, recs]) => ({ key, label: key, recs, m: metricsOf(recs) }))
    .sort((a, b) => b.m.n - a.m.n);
}

export const fmtR = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`;

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** One row per trade, plain facts only, for a spreadsheet. */
export function recordsToCsv(rs: TradeRecord[]): string {
  const head = ["id", "opened_utc", "closed_utc", "symbol", "venue", "mode", "book", "side", "strategy", "regime", "htf_bias", "align", "session", "entry", "stop", "target", "exit", "fees", "pnl", "risk", "r", "exit_kind", "exit_reason", "ai", "config"];
  const rows = rs.map((r) => [r.id, new Date(r.openedAt).toISOString(), new Date(r.closedAt).toISOString(), r.symbol, r.venue, r.mode, r.book, r.side, r.strategy, r.ctx?.regime ?? "", r.ctx?.htfBias ?? "", r.ctx?.align ?? "", r.session, r.entry, r.stop, r.target, r.exit, r.fees, r.pnl, r.riskUnit, r.r, r.exitKind, r.exitReason, r.ai, r.configVersion].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n");
}
