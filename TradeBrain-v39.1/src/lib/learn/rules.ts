import type { Candle, Side } from "../market/types.ts";
import { buildContext, sessionOf } from "./regime.ts";
import { FILTERS0, type ConfigVersion, type ContextSnapshot, type Filters, type LearnSettings, type Rule, type SegmentSpec } from "./types.ts";

export type GateQuery = { symbol: string; candles: Candle[]; tfMs: number; strategy: string; side: Side; entry: number; stop: number | null; spreadPct: number | null; now: number };
export type GateResult = { allow: boolean; /** Added to the candidate's score (zero or negative). */ scoreAdj: number; note: string; ctx: ContextSnapshot | null };
export type GateFn = (q: GateQuery) => GateResult;

export const ALLOW: GateResult = { allow: true, scoreAdj: 0, note: "", ctx: null };

export function specLabel(s: SegmentSpec): string {
  const bits: string[] = [];
  if (s.strategy) bits.push(s.strategy);
  if (s.side) bits.push(s.side);
  if (s.symbol) bits.push(s.symbol);
  if (s.regime) bits.push(`${s.regime} market`);
  if (s.session) bits.push(`${s.session} session`);
  if (s.align) bits.push(s.align === "with" ? "with higher-timeframe bias" : s.align === "against" ? "against higher-timeframe bias" : `${s.align} bias`);
  return bits.join(" · ") || "all trades";
}
export const specKey = (s: SegmentSpec) => JSON.stringify(Object.entries(s).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)));

export type Facts = { strategy: string; symbol: string; side: Side; regime: string; session: string; align: string };
export function matchSpec(spec: SegmentSpec, f: Facts): boolean {
  return (spec.strategy == null || spec.strategy === f.strategy) && (spec.symbol == null || spec.symbol === f.symbol) && (spec.side == null || spec.side === f.side) && (spec.regime == null || spec.regime === f.regime) && (spec.session == null || spec.session === f.session) && (spec.align == null || spec.align === f.align);
}

export const RESTRICT_PENALTY = 10;

/** Pure decision: may this setup be entered, and does it lose rank? Only ever removes or lowers; it has no way to add risk. */
export function decide(cfg: { rules: Rule[]; filters: Filters }, paused: boolean, f: Facts, ctx: ContextSnapshot | null, spreadPct: number | null): GateResult {
  if (paused) return { allow: false, scoreAdj: 0, note: "New signals are paused (Learn tab).", ctx };
  const fl = cfg.filters;
  if (ctx) {
    if (fl.standAside && (ctx.regime === "unclear" || ctx.regime === "vol-expansion")) return { allow: false, scoreAdj: 0, note: `Standing aside: market is ${ctx.regime}.`, ctx };
    if (fl.htf === "block" && ctx.align === "against") return { allow: false, scoreAdj: 0, note: `Against the ${ctx.htfMin}m bias (${ctx.htfBias}).`, ctx };
  }
  if (fl.maxSpreadPct > 0 && spreadPct != null && spreadPct > fl.maxSpreadPct) return { allow: false, scoreAdj: 0, note: `Spread ${spreadPct.toFixed(3)}% is above your ${fl.maxSpreadPct}% limit.`, ctx };
  let adj = 0;
  for (const r of cfg.rules) {
    if (!matchSpec(r.spec, f)) continue;
    if (r.action === "disable") return { allow: false, scoreAdj: 0, note: `Rule: ${specLabel(r.spec)} is switched off${r.source === "learned" ? " (learned, approved)" : ""}.`, ctx };
    if (f.align !== "with") return { allow: false, scoreAdj: 0, note: `Rule: ${specLabel(r.spec)} is restricted to trades with the higher-timeframe bias.`, ctx };
    adj -= RESTRICT_PENALTY;
  }
  return { allow: true, scoreAdj: adj, note: adj ? `Restricted setup: score ${adj}.` : "", ctx };
}

/** Builds the gate the radar and the Trades tab call before an entry. `get` reads the live configuration; `seen` receives each evaluated context. */
export function makeGate(get: () => { cfg: { rules: Rule[]; filters: Filters }; settings: LearnSettings }, seen?: (q: GateQuery, ctx: ContextSnapshot | null) => void): GateFn {
  return (q) => {
    const { cfg, settings } = get();
    const ctx = buildContext({ candles: q.candles, now: q.now, side: q.side, entry: q.entry, stop: q.stop, spreadPct: q.spreadPct, htfMin: settings.htfMin, tfMs: q.tfMs });
    seen?.(q, ctx);
    const f: Facts = { strategy: q.strategy, symbol: q.symbol, side: q.side, regime: ctx?.regime ?? "unknown", session: sessionOf(q.now), align: ctx?.align ?? "unknown" };
    return decide(cfg, settings.pauseSignals, f, ctx, q.spreadPct);
  };
}

export const baselineVersion = (now = Date.now()): ConfigVersion => ({ id: "v0", createdAt: now, source: "baseline", note: "Baseline: v33 behaviour, no learned rules, all filters off.", parent: null, rules: [], filters: { ...FILTERS0 } });

export function nextVersion(versions: ConfigVersion[], activeId: string, p: { source: ConfigVersion["source"]; note: string; rules: Rule[]; filters: Filters }, now = Date.now()): ConfigVersion {
  const n = versions.reduce((m, v) => Math.max(m, Number(v.id.slice(1)) || 0), 0) + 1;
  return { id: `v${n}`, createdAt: now, source: p.source, note: p.note, parent: activeId, rules: p.rules, filters: p.filters };
}
