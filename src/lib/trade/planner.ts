import { decide, type Decision } from "../market/analyze.ts";
import { quality } from "../market/indicators.ts";
import { INTERVAL_MS, MODE_PROFILES, isDerivSymbol, marketInfo, type Candle, type Interval, type Mode, type Side } from "../market/types.ts";
import type { BookPosition } from "./account.ts";
import { protectiveIntent } from "./account.ts";
import { checkRisk, type RiskReport } from "./risk.ts";
import { feeGate, lossCooldown, strategyBlocked, wonSince, type ScalpConfig } from "./scalp.ts";

export type ScanRow = {
  symbol: string;
  candles: Candle[];
  spreadPct: number | null;
  tradable: boolean;
  longOnly: boolean;
  step?: number;
  minNotional?: number;
  note?: string;
};

export type EntryIntent = {
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
  /** Set when the AI approved this entry in scalp mode. */
  ai?: { quickR: number; note: string; sizeMult?: number };
  /** Where the radar's strategy banks a quick profit (in R) when no AI chose a level. */
  quickR?: number;
};

/** A market the scalp radar picked: its decision, and the AI's verdict when the AI judged it. */
export type RadarPick = { decision: Decision; quickR?: number; ai?: { quickR: number; note: string; sizeMult: number } };

export type ExitIntent =
  | { type: "close"; id: string; price: number; reason: string }
  | { type: "reduce"; id: string; price: number; qty: number; reason: string }
  | { type: "tighten"; id: string; stop: number };

export function planCycle(input: {
  now: number;
  mode: Mode;
  interval: Interval;
  armed: boolean;
  rows: ScanRow[];
  positions: BookPosition[];
  marks: Record<string, number>;
  equity: number;
  cash: number;
  dayPnl: number;
  startEquity: number;
  riskPct: number;
  maxOpenRiskPct: number;
  dailyLossPct: number;
  maxPositions: number;
  maxPerSymbol: number;
  consecLosses: number;
  consecLimit: number;
  lossPause: boolean;
  goalReached: boolean;
  /** Hard stop reason (drawdown, session over). Blocks every new entry. */
  halted?: string | null;
  seen: string[];
  recent: { t: number; symbol: string; price: number; strategy: string }[];
  trail: boolean;
  /** Scalp-and-compound rules. Null unless aggressive mode has them switched on. */
  scalp?: ScalpConfig | null;
  /** When set, only these radar picks are traded (one per market). Without it every market is judged by the built-in decision engine. */
  radar?: Record<string, RadarPick> | null;
}): { entries: EntryIntent[]; exits: ExitIntent[]; decisions: { symbol: string; decision: Decision; risk: RiskReport | null; blocked?: string }[] } {
  const exits: ExitIntent[] = [];
  const profile = MODE_PROFILES[input.mode];
  for (const pos of input.positions.filter((p) => p.status === "open")) {
    const row = input.rows.find((r) => r.symbol === pos.symbol);
    const candle = row?.candles[row.candles.length - 1];
    const mark = input.marks[pos.symbol] ?? candle?.c ?? pos.entry;
    const intent = protectiveIntent(pos, mark, candle ? { h: candle.h, l: candle.l } : null, {
      trail: input.trail,
      now: input.now,
      maxHoldMin: profile.maxHoldMin,
      // The AI can pick a trade's profit level, and while it is actively watching the trade it gets room to run past it.
      // If the AI goes quiet, its lease runs out and the plain level applies again.
      scalp: input.scalp ? { quickR: (pos.aiQuickR ?? input.scalp.quickR) * ((pos.aiUntil ?? 0) > input.now ? 1.5 : 1), lockR: input.scalp.lockR } : undefined,
    });
    if (!intent) continue;
    if (intent.type === "tighten") exits.push({ type: "tighten", id: pos.id, stop: intent.stop });
    else if (intent.type === "reduce") exits.push({ type: "reduce", id: pos.id, price: intent.price, qty: intent.qty, reason: intent.reason });
    else exits.push({ type: "close", id: pos.id, price: intent.price, reason: intent.reason });
  }

  const decisions: { symbol: string; decision: Decision; risk: RiskReport | null; blocked?: string }[] = [];
  const entries: EntryIntent[] = [];
  const radar = input.radar ?? null;
  // In radar mode the radar decides which markets are worth a scalp; the risk engine below still has the last word.
  const decideFor = (row: ScanRow): Decision | null => (radar ? (radar[row.symbol]?.decision ?? null) : decide(row.candles, input.mode));
  if (!input.armed) {
    for (const row of input.rows) {
      if (!row.tradable || row.candles.length < 80) continue;
      const decision = decideFor(row);
      if (decision) decisions.push({ symbol: row.symbol, decision, risk: null, blocked: "New entries are off." });
    }
    return { entries, exits, decisions };
  }

  let openRisk = input.positions.filter((p) => p.status === "open").reduce((s, p) => s + p.plannedRisk, 0);
  let openCount = input.positions.filter((p) => p.status === "open").length;
  const seen = new Set(input.seen);
  const plannedSymbols = new Map<string, number>();

  // Rank the setups before spending the limits (positions, risk, entries per hour). In list order the first group in Deriv's list
  // (Volatility indices) always used everything up. Best quality first, and each extra pick from the same market group costs 8 points,
  // so forex, indices, commodities and crypto get their turn.
  const scored = input.rows
    .filter((r) => r.tradable)
    .map((row) => ({ row, decision: decideFor(row) }))
    .filter((x): x is { row: (typeof input.rows)[number]; decision: Decision } => x.decision != null);
  const picked: Record<string, number> = {};
  const ordered: typeof scored = [];
  const pool = [...scored];
  const grp = (sym: string) => marketInfo(sym)?.group ?? "other";
  while (pool.length) {
    let bi = 0;
    let bs = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const x = pool[i]!;
      const act = x.decision.action === "BUY" || x.decision.action === "SELL";
      const sc = (act ? 1000 : 0) + x.decision.quality - 8 * (picked[grp(x.row.symbol)] ?? 0);
      if (sc > bs) {
        bs = sc;
        bi = i;
      }
    }
    const [x] = pool.splice(bi, 1);
    if (x.decision.action === "BUY" || x.decision.action === "SELL") picked[grp(x.row.symbol)] = (picked[grp(x.row.symbol)] ?? 0) + 1;
    ordered.push(x);
  }
  for (const { row, decision } of ordered) {
    if (decision.action !== "BUY" && decision.action !== "SELL") {
      decisions.push({ symbol: row.symbol, decision, risk: null });
      continue;
    }
    const q = quality(row.candles, INTERVAL_MS[input.interval], input.now);
    const key = `${row.symbol}|${input.interval}|${decision.action}|${decision.candleTime}`;
    const lastSame = [...input.recent].reverse().find((r) => r.symbol === row.symbol);
    const duplicateSetup =
      !!lastSame &&
      !!decision.atr &&
      lastSame.strategy === (decision.lead ?? "") &&
      Math.abs(decision.price - lastSame.price) < decision.atr * 0.35 &&
      input.now - lastSame.t < profile.cooldownSec * 1000 * 4;
    let cooldownMsLeft = lastSame ? Math.max(0, lastSame.t + profile.cooldownSec * 1000 - input.now) : 0;
    // Scalp: after a win on this symbol the normal cooldown is skipped so the next setup can be taken at once.
    if (input.scalp && lastSame && wonSince(input.positions, row.symbol, lastSame.t)) cooldownMsLeft = 0;
    if (input.scalp && decision.plan) {
      const scalpBlock =
        lossCooldown(input.positions, row.symbol, input.now, input.scalp) ??
        (isDerivSymbol(row.symbol) ? null : feeGate(decision.plan.entry, decision.plan.stop, input.scalp)) ??
        strategyBlocked(input.positions, decision.lead ?? "pipeline", input.scalp);
      if (scalpBlock) {
        decisions.push({ symbol: row.symbol, decision, risk: null, blocked: scalpBlock });
        continue;
      }
    }
    const hourAgo = input.now - 3_600_000;
    const sameSymbol = input.positions.filter((p) => p.status === "open" && p.symbol === row.symbol).length + (plannedSymbols.get(row.symbol) ?? 0);
    const risk = checkRisk({
      side: decision.action,
      price: decision.price,
      plan: decision.plan,
      equity: input.equity,
      cash: input.cash,
      dayPnl: input.dayPnl,
      startEquity: input.startEquity,
      riskPct: input.riskPct,
      maxOpenRiskPct: input.maxOpenRiskPct,
      dailyLossPct: input.dailyLossPct,
      maxPositions: input.maxPositions,
      maxPerSymbol: Math.min(profile.maxPerSymbol, input.maxPerSymbol),
      openPositions: openCount,
      sameSymbol,
      openRisk,
      halted: input.halted ?? null,
      longOnly: row.longOnly,
      spreadPct: row.spreadPct,
      maxSpreadPct: 0.15,
      seen: seen.has(key),
      cooldownMsLeft,
      entriesThisHour: input.recent.filter((r) => r.t >= hourAgo).length + entries.length,
      maxEntriesHour: input.scalp ? Math.max(profile.maxEntriesHour, input.scalp.maxEntriesHour) : profile.maxEntriesHour,
      minRR: profile.minRR,
      consecLosses: input.consecLosses,
      consecLimit: input.consecLimit,
      lossPause: input.lossPause,
      goalReached: input.goalReached,
      goalBlocks: true,
      ageMs: q.ageMs,
      tfMs: INTERVAL_MS[input.interval],
      regime: decision.regime,
      step: row.step,
      minNotional: row.minNotional,
      duplicateSetup,
    });
    decisions.push({ symbol: row.symbol, decision, risk, blocked: risk.ok ? undefined : risk.reasons[0] });
    if (!risk.ok || !risk.size || !risk.size.ok || !decision.plan) continue;
    entries.push({
      symbol: row.symbol,
      side: decision.action,
      qty: risk.size.qty,
      notional: risk.size.notional,
      lossAtStop: risk.size.lossAtStop,
      entry: decision.plan.entry,
      stop: decision.plan.stop,
      target: decision.plan.target,
      reason: decision.reason,
      quality: decision.quality,
      strategy: decision.lead ?? "pipeline",
      key,
      candleTime: decision.candleTime,
      regime: decision.regime,
      ...(radar?.[row.symbol]?.ai ? { ai: radar[row.symbol]!.ai } : {}),
      ...(radar?.[row.symbol]?.quickR ? { quickR: radar[row.symbol]!.quickR } : {}),
    });
    seen.add(key);
    openRisk += risk.size.lossAtStop;
    openCount += 1;
    plannedSymbols.set(row.symbol, (plannedSymbols.get(row.symbol) ?? 0) + 1);
  }
  return { entries, exits, decisions };
}
