// Opportunity Watchtower.
//
// A promising market that is "not ready yet" is remembered with the exact level it is waiting for. The engine
// checks the saved opportunities on every heartbeat (see loop.ts), without any AI call. When a completed candle
// closes beyond the level, the opportunity becomes READY_FOR_MASTER_REVIEW and the colony reviews it again with fresh
// data. The Watchtower never opens a trade itself: the colony's vote, Risk Guard and the sizing checks decide.
import type { Candidate } from "./radar.ts";
import type { Candle } from "../market/types.ts";

export type OpportunityStatus =
  | "MONITORING"
  | "APPROACHING_TRIGGER"
  | "READY_FOR_MASTER_REVIEW"
  | "EXECUTED"
  | "REJECTED"
  | "INVALIDATED"
  | "EXPIRED"
  | "PAUSED_DATA";

export const TERMINAL: OpportunityStatus[] = ["EXECUTED", "REJECTED", "INVALIDATED", "EXPIRED"];
export const isTerminal = (s: OpportunityStatus) => TERMINAL.includes(s);

export type WatchOpportunity = {
  id: string; symbol: string; label: string; venue: string; direction: "BUY" | "SELL";
  strategy: string; timeframe: string; price: number;
  /** The level a completed candle must close beyond. Kept equal to `level` for older screens. */
  trigger: number; stop: number; target: number;
  quality: number; reason: string; missing: string[]; status: OpportunityStatus;
  firstSeen: number; updatedAt: number; lastPrice: number; checks: number; expiresAt: number;
  source: "RADAR" | "HIVE"; history: { at: number; status: OpportunityStatus; reason: string }[];
  /** Breakout level, invalidation level and ATR measured when the opportunity was saved. 0 means not supplied. */
  level: number; invalidation: number; atr: number;
  intervalMs: number;
  /** Only candles that open after this time can confirm the trigger. */
  confirmAfterT: number;
  /** Open time of the candle that confirmed the trigger, if one has. */
  confirmedT: number | null;
  lastReviewAt: number; reviews: number;
  positionId?: string;
};

const KEY = "tradebrain-v39-watchtower-v1";
const MAX = 250;
const INTERVALS: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
export const BARS_VALID = 48;
export const MAX_REVIEWS = 3;
export const REVIEW_GAP_MS = 60_000;
const LOOKBACK = 20;

function read(): WatchOpportunity[] {
  try { const raw = localStorage.getItem(KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function write(rows: WatchOpportunity[]) { try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX))); } catch { /* storage may be unavailable */ } }
function stableId(symbol: string, direction: string, strategy: string, trigger: number) {
  return `${symbol}|${direction}|${strategy}|${Math.round(trigger * 10000)}`;
}
const trim = <T,>(x: T[]) => x.slice(-20);

// ---- structure ----

export function atrOf(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const tail = trs.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

export type Structure = { level: number; invalidation: number; atr: number; lastT: number };

/**
 * The level a breakout has to clear. BUY waits for a close above the highest high of the last 20 completed candles,
 * SELL for a close below the lowest low. Invalidation is the opposite edge of the recent 10-candle range.
 * Only completed candles are used (the last candle is still forming). Returns null without enough data.
 */
export function structureLevels(candles: Candle[], side: "BUY" | "SELL"): Structure | null {
  const done = candles.slice(0, -1);
  if (done.length < LOOKBACK + 2) return null;
  const range = done.slice(-LOOKBACK);
  const recent = done.slice(-10);
  const atr = atrOf(done);
  if (!(atr > 0)) return null;
  const level = side === "BUY" ? Math.max(...range.map((c) => c.h)) : Math.min(...range.map((c) => c.l));
  const invalidation = side === "BUY" ? Math.min(...recent.map((c) => c.l)) : Math.max(...recent.map((c) => c.h));
  return { level, invalidation, atr, lastT: done[done.length - 1]!.t };
}

// ---- evaluation (pure) ----

export type Evaluation = { status: OpportunityStatus; reason: string; confirmedT: number | null; confirmAfterT: number };

/** Where does this saved opportunity stand against the latest candles and price? */
export function evaluateOpportunity(o: WatchOpportunity, candles: Candle[] | undefined, price: number | undefined, now: number): Evaluation {
  const same = (status: OpportunityStatus, reason: string): Evaluation => ({ status, reason, confirmedT: o.confirmedT, confirmAfterT: o.confirmAfterT });
  if (isTerminal(o.status)) return same(o.status, o.reason);
  if (now > o.expiresAt) return same("EXPIRED", "Opportunity validity period elapsed.");
  if (!(o.level > 0) || o.source !== "HIVE") return same(o.status, o.reason);
  const iv = o.intervalMs > 0 ? o.intervalMs : 60_000;
  if (!candles || candles.length < LOOKBACK + 2 || typeof price !== "number" || !(price > 0)) return same("PAUSED_DATA", "Waiting for fresh candles and a live price. No trigger can fire on missing data.");
  const lastOpen = candles[candles.length - 1]!.t;
  if (now - lastOpen > 3 * iv) return same("PAUSED_DATA", "Candle data is stale. No trigger can fire on stale data.");

  const dir = o.direction === "BUY" ? 1 : -1;
  const done = candles.slice(0, -1);
  const buffer = 0.1 * o.atr;
  // Invalidation: a completed candle closed through the far edge of the range, or price is well beyond it.
  const brokeClose = done.some((c) => c.t > o.confirmAfterT && o.invalidation > 0 && (dir === 1 ? c.c < o.invalidation : c.c > o.invalidation));
  const brokeLive = o.invalidation > 0 && (dir === 1 ? price < o.invalidation - 0.5 * o.atr : price > o.invalidation + 0.5 * o.atr);
  if (brokeClose || brokeLive) return same("INVALIDATED", `Price broke the invalidation level ${o.invalidation}. The setup is no longer valid.`);

  let confirmedT = o.confirmedT;
  if (confirmedT == null) {
    const hit = done.find((c) => c.t > o.confirmAfterT && (dir === 1 ? c.c > o.level + buffer : c.c < o.level - buffer));
    if (hit) confirmedT = hit.t;
  }
  if (confirmedT != null) {
    const beyond = dir === 1 ? price > o.level : price < o.level;
    if (!beyond) {
      // Closed beyond the level, then fell back: a false breakout. A new close is needed.
      return { status: "MONITORING", reason: "Breakout closed beyond the level but price fell back inside it. Waiting for a fresh close.", confirmedT: null, confirmAfterT: done[done.length - 1]!.t };
    }
    const extension = Math.abs(price - o.level);
    if (extension > 1.5 * o.atr) return { status: "MONITORING", reason: "Breakout confirmed but price is already extended. Not chasing; waiting for a pullback toward the level.", confirmedT, confirmAfterT: o.confirmAfterT };
    return { status: "READY_FOR_MASTER_REVIEW", reason: `A completed candle closed beyond ${o.level}. Fresh colony review is due.`, confirmedT, confirmAfterT: o.confirmAfterT };
  }
  const gap = dir === 1 ? o.level - price : price - o.level;
  const near = gap >= 0 && gap <= Math.max(0.25 * o.atr, o.level * 0.001);
  return near
    ? same("APPROACHING_TRIGGER", `Price is close to ${o.level}. Waiting for a completed candle to close beyond it.`)
    : same("MONITORING", `Waiting for a completed candle to close ${dir === 1 ? "above" : "below"} ${o.level}.`);
}

// ---- storage ----

function dedupeSave(next: WatchOpportunity, rows: WatchOpportunity[]) { write([next, ...rows.filter((x) => x.id !== next.id)]); }

export function saveRadarOpportunity(c: Candidate, timeframe: string, now = Date.now()) {
  if (!Number.isFinite(c.entry) || !Number.isFinite(c.stop) || !Number.isFinite(c.target) || c.score < 50) return;
  const id = stableId(c.symbol, c.side, c.strategy, c.signalTime);
  const rows = read(); const old = rows.find((x) => x.id === id);
  const iv = INTERVALS[timeframe] ?? 60_000;
  const status: OpportunityStatus = c.ai?.action === "TAKE" ? "READY_FOR_MASTER_REVIEW" : "MONITORING";
  const next: WatchOpportunity = {
    id, symbol: c.symbol, label: c.label, venue: c.group, direction: c.side,
    strategy: c.strategyName, timeframe, price: c.entry, trigger: c.entry, stop: c.stop, target: c.target,
    quality: c.score, reason: c.why || "Radar identified a qualifying strategy setup.",
    missing: c.ai?.action === "TAKE" ? ["Fresh Master Intelligence review", "Risk Guard validation"] : ["Fresh entry confirmation", "Master Intelligence review", "Risk Guard validation"],
    status, firstSeen: old?.firstSeen ?? now, updatedAt: now, lastPrice: c.entry, checks: (old?.checks ?? 0) + 1,
    expiresAt: now + BARS_VALID * iv, source: "RADAR",
    history: trim([...(old?.history ?? []), { at: now, status, reason: "Radar refreshed this setup." }]),
    // Radar setups are traded by the Radar's own engine. They are listed here for visibility only.
    level: 0, invalidation: 0, atr: 0, intervalMs: iv, confirmAfterT: 0, confirmedT: null, lastReviewAt: 0, reviews: 0,
  };
  dedupeSave(next, rows);
}

export type HiveWaitInput = {
  symbol: string; label: string; direction?: "BUY" | "SELL"; price: number; stop?: number; target?: number;
  reason: string; timeframe: string; venue: string;
  candles?: Candle[]; intervalMs?: number;
  /** How many analysts leaned this way. A lone voice is not a setup. */
  agreeing?: number;
};

/** Reasons that are about the account or an AI failure, not about the market. They are never saved as opportunities. */
const NOT_A_SETUP = /risk guard vetoed|long-only|no analyst has an ai key|no market has fresh|no answer/i;

/**
 * Save a colony WAIT that is worth remembering. Returns the saved record, or null with the reason it was not saved.
 * Needs a direction, at least two analysts leaning that way, and measurable structure from real completed candles.
 */
export function saveHiveWait(input: HiveWaitInput, now = Date.now()): WatchOpportunity | null {
  if (!input.direction || !(input.price > 0)) return null;
  if ((input.agreeing ?? 2) < 2) return null;
  if (NOT_A_SETUP.test(input.reason)) return null;
  const st = input.candles ? structureLevels(input.candles, input.direction) : null;
  if (!st) return null;
  const id = stableId(input.symbol, input.direction, "HIVE-WAIT", 0);
  const rows = read(); const old = rows.find((x) => x.id === id);
  const iv = input.intervalMs ?? INTERVALS[input.timeframe] ?? 60_000;
  // An active record keeps the level it was first saved with; only the evidence is refreshed.
  if (old && !isTerminal(old.status)) {
    const refreshed: WatchOpportunity = {
      ...old, price: input.price, reason: input.reason, updatedAt: now, checks: old.checks + 1,
      stop: input.stop ?? old.stop, target: input.target ?? old.target,
      history: trim([...old.history, { at: now, status: old.status, reason: `Colony waited again: ${input.reason}` }]),
    };
    dedupeSave(refreshed, rows);
    return refreshed;
  }
  const dir = input.direction === "BUY" ? "above" : "below";
  const next: WatchOpportunity = {
    id, symbol: input.symbol, label: input.label, venue: input.venue, direction: input.direction,
    strategy: "Hive multi-agent", timeframe: input.timeframe, price: input.price, trigger: st.level,
    stop: input.stop ?? st.invalidation, target: input.target ?? 0, quality: 0, reason: input.reason,
    missing: [`A completed ${input.timeframe} candle closing ${dir} ${st.level}`, "Fresh colony review", "Risk Guard validation"],
    status: "MONITORING", firstSeen: now, updatedAt: now, lastPrice: input.price,
    checks: 1, expiresAt: now + BARS_VALID * iv, source: "HIVE",
    history: [{ at: now, status: "MONITORING", reason: input.reason }],
    level: st.level, invalidation: st.invalidation, atr: st.atr, intervalMs: iv,
    confirmAfterT: st.lastT, confirmedT: null, lastReviewAt: 0, reviews: 0,
  };
  dedupeSave(next, rows);
  return next;
}

export function listOpportunities() { return read(); }

/** Re-evaluate every active opportunity. `feed` supplies candles, price and the desk's candle length, or null when unavailable. */
export function refreshOpportunities(feed: (o: WatchOpportunity) => { candles?: Candle[]; price?: number } | null, now = Date.now()) {
  const rows = read(); let changed = false;
  const next = rows.map((o) => {
    if (isTerminal(o.status)) return o;
    const f = feed(o);
    const e = evaluateOpportunity(o, f?.candles, f?.price, now);
    const price = f?.price && f.price > 0 ? f.price : o.lastPrice;
    const moved = e.status !== o.status || e.confirmedT !== o.confirmedT || e.confirmAfterT !== o.confirmAfterT;
    if (!moved && price === o.lastPrice) return o;
    changed = true;
    return {
      ...o, lastPrice: price, status: e.status, confirmedT: e.confirmedT, confirmAfterT: e.confirmAfterT,
      checks: o.checks + 1, updatedAt: moved ? now : o.updatedAt, reason: moved ? e.reason : o.reason,
      history: e.status !== o.status ? trim([...o.history, { at: now, status: e.status, reason: e.reason }]) : o.history,
    };
  });
  if (changed) write(next);
}

/** The next opportunity on this desk that is confirmed and due for a fresh colony review, if any. */
export function nextReady(venue: string, now = Date.now(), skip: (o: WatchOpportunity) => boolean = () => false): WatchOpportunity | undefined {
  return read()
    .filter((o) => o.source === "HIVE" && o.venue === venue && o.status === "READY_FOR_MASTER_REVIEW" && o.reviews < MAX_REVIEWS && now - o.lastReviewAt >= REVIEW_GAP_MS && !skip(o))
    .sort((a, b) => (a.confirmedT ?? 0) - (b.confirmedT ?? 0))[0];
}

export function markReviewStart(id: string, now = Date.now()) {
  write(read().map((o) => (o.id === id ? { ...o, lastReviewAt: now } : o)));
}

export type ReviewOutcome = { kind: "EXECUTED"; positionId: string } | { kind: "WAIT"; note: string };

/** Record what the fresh colony review decided. A WAIT needs a newer confirming candle before the next review. */
export function recordReview(id: string, outcome: ReviewOutcome, now = Date.now()) {
  write(read().map((o) => {
    if (o.id !== id) return o;
    if (outcome.kind === "EXECUTED") {
      return { ...o, status: "EXECUTED" as const, positionId: outcome.positionId, updatedAt: now, reviews: o.reviews + 1, reason: "Fresh colony review approved this setup and an order was sent.", history: trim([...o.history, { at: now, status: "EXECUTED" as const, reason: "Trade opened after a fresh colony review." }]) };
    }
    const reviews = o.reviews + 1;
    const spent = reviews >= MAX_REVIEWS;
    const status: OpportunityStatus = spent ? "REJECTED" : "MONITORING";
    const reason = spent ? `The colony reviewed ${reviews} confirmed triggers and did not approve any: ${outcome.note}` : `Reviewed after a confirmed trigger: ${outcome.note}`;
    return { ...o, status, reviews, updatedAt: now, reason, confirmAfterT: o.confirmedT ?? o.confirmAfterT, confirmedT: null, history: trim([...o.history, { at: now, status, reason }]) };
  }));
}

export function clearArchivedOpportunities() { write(read().filter((x) => !isTerminal(x.status))); }
