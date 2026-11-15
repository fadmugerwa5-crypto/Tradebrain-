import { useBrain } from "@/stores/brain";
import type { BookPosition } from "@/lib/trade/account";
import { marketInfo } from "@/lib/market/types";
import { buildContext, sessionOf } from "./regime";
import { gateSeen, useLearn } from "./store";
import { STRATEGY_VERSION, type AccountMode, type AiReview, type ExitKind, type TradeRecord } from "./types";

/** Learning only READS the trading store. It never writes to it, so it cannot change risk, size or orders. */

export const exitKindOf = (reason: string): ExitKind => {
  const r = reason.toLowerCase();
  if (/stop/.test(r)) return "stop";
  if (/target|take.?profit|quick|bank/.test(r)) return "target";
  if (/time|hold|expired|settled|sold/.test(r)) return "time";
  if (/manual|emergency|force|close(d)? (all|now)|you /.test(r)) return "manual";
  if (/broker|exchange|binance|deriv|outside/.test(r)) return "broker";
  return "other";
};

function modeOf(p: BookPosition): AccountMode {
  const b = useBrain.getState();
  if (p.venue === "paper") return "paper";
  if (p.venue === "binance") return /live/.test(b.settings.binanceEnv) ? "live" : "demo";
  return b.derivStatus.virtual === false ? "live" : "demo";
}

function aiOf(p: BookPosition): AiReview {
  if (p.aiNote) return "reviewed";
  const b = useBrain.getState();
  const anyReady = Object.values(b.ai).some((a) => a.status === "ready");
  return b.settings.scalp?.aiEntry && !anyReady && p.book !== "swing" ? "ai-unavailable" : "rules-only";
}

export function riskUnitOf(p: BookPosition): number {
  if (p.riskAtStop && p.riskAtStop > 0) return p.riskAtStop;
  if (p.venue === "deriv") return p.plannedRisk > 0 ? p.plannedRisk : 0;
  const d = Math.abs(p.entry - p.stop) * p.qty;
  return d > 0 ? d : p.plannedRisk > 0 ? p.plannedRisk : 0;
}

function snapshotFor(p: BookPosition) {
  const st = useBrain.getState();
  const settings = useLearn.getState().settings;
  const seen = gateSeen.get(`${p.symbol}|${p.side}`);
  let ctx = seen && Math.abs(p.openedAt - seen.t) < 20 * 60_000 ? seen.ctx : null;
  if (!ctx) {
    const candles = st.candles[p.symbol];
    const q = st.quotes[p.symbol];
    const spread = q?.bid && q.ask ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : null;
    if (candles) ctx = buildContext({ candles, now: p.openedAt, side: p.side, entry: p.entry, stop: p.stop, spreadPct: spread, htfMin: settings.htfMin });
  }
  return { ctx, configVersion: useLearn.getState().activeId, mode: modeOf(p), ai: aiOf(p), openedAt: p.openedAt };
}

function recordOf(p: BookPosition): TradeRecord {
  const L = useLearn.getState();
  const snap = L.open[p.id];
  const riskUnit = riskUnitOf(p);
  const pnl = p.pnl ?? 0;
  const closedAt = p.closedAt ?? Date.now();
  const reason = p.exitReason ?? "";
  return {
    id: p.id,
    openedAt: p.openedAt,
    closedAt,
    symbol: p.symbol,
    label: marketInfo(p.symbol)?.label ?? p.symbol,
    venue: p.venue,
    mode: snap?.mode ?? modeOf(p),
    book: p.book === "swing" ? "swing" : "scalp",
    side: p.side,
    strategy: p.strategy || "unknown",
    strategyVersion: STRATEGY_VERSION,
    entry: p.entry,
    stop: p.stop,
    target: p.target,
    exit: p.exit ?? null,
    qty: p.qty,
    fees: p.fees,
    pnl,
    riskUnit,
    r: riskUnit > 0 ? pnl / riskUnit : null,
    exitReason: reason,
    exitKind: exitKindOf(reason),
    session: sessionOf(p.openedAt),
    holdMin: Math.max(0, Math.round((closedAt - p.openedAt) / 60_000)),
    ai: snap?.ai ?? aiOf(p),
    aiNote: p.aiNote ?? "",
    configVersion: snap?.configVersion ?? "v0",
    ctx: snap?.ctx ?? null,
    backfilled: !snap,
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
const schedule = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => useLearn.getState().run(), 800);
};

function scan(positions: BookPosition[]) {
  const L = useLearn.getState();
  const known = new Set(L.records.map((r) => r.id));
  let added = 0;
  for (const p of positions) {
    if (p.status === "open" && !L.open[p.id] && Date.now() - p.openedAt < 3_600_000) L.setOpen(p.id, snapshotFor(p));
    if (p.status === "closed" && p.pnl != null && !known.has(p.id)) {
      L.addRecord(recordOf(p));
      L.dropOpen(p.id);
      known.add(p.id);
      added++;
    }
  }
  if (added) schedule();
}

let started = false;
export function startLearning() {
  if (started) return;
  started = true;
  scan(useBrain.getState().positions);
  useBrain.subscribe((s, prev) => {
    if (s.positions !== prev.positions) scan(s.positions);
  });
  schedule();
}
