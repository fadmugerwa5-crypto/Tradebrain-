import type { BookPosition } from "./account.ts";
import { initialRisk } from "./account.ts";
import { ROUND_TRIP_COST, type ScalpConfig } from "./scalp.ts";

/** The AI picks from a small menu. The app checks every answer and clamps every number. */
export type AiEntryReply = { action: "TAKE" | "SKIP"; quickR: number; sizeMult: number; reason: string };
export type AiManageReply = { action: "HOLD" | "EXIT" | "TIGHTEN"; stop: number | null; reason: string };

export const QUICK_R_MIN = 0.4;
export const QUICK_R_MAX = 1.0;
export const SIZE_MULT_MIN = 0.25;

export const ENTRY_SYSTEM =
  "You are the execution brain of a crypto scalping bot. A rules engine proposed a trade that already passed every risk limit. " +
  "Decide whether to TAKE or SKIP it, and at what profit level (in R, where 1R is the stop distance) to bank it. " +
  "You cannot change the entry, stop or target, and you cannot raise the size. " +
  "SKIP when the setup chases a move that already ran, sits right under resistance or above support, comes in a stalled or choppy market, or when the quick profit barely clears fees. " +
  "Reply with ONLY one JSON object and nothing else: " +
  '{"action":"TAKE" or "SKIP","quickR":number from 0.4 to 1.0,"sizeMult":number from 0.25 to 1,"reason":"at most 15 words"}. ' +
  "Use only the numbers given. Do not invent prices or news.";

const ENTRY_TAIL =
  "You cannot change the entry, stop or target, and you cannot raise the size. " +
  "Reply with ONLY one JSON object and nothing else: " +
  '{"action":"TAKE" or "SKIP","quickR":number from 0.4 to 1.0,"sizeMult":number from 0.25 to 1,"reason":"at most 15 words"}. ' +
  "Use only the numbers given. Do not invent prices or news.";

/** The entry prompt for each strictness level. Relaxed is the default: the rules engine already checked the setup, so the AI only vetoes clear problems. */
export function entrySystemFor(level: ScalpConfig["aiStrict"] | undefined): string {
  if (level === "strict") return ENTRY_SYSTEM;
  if (level === "balanced")
    return (
      "You are the execution brain of a crypto scalping bot. A rules engine proposed a trade that already passed every risk limit. " +
      "Decide whether to TAKE or SKIP it, and at what profit level (in R, where 1R is the stop distance) to bank it. " +
      "TAKE when the setup is reasonable. SKIP only when it clearly chases a move that already ran, sits right against a wall, or the quick profit barely clears fees. " +
      ENTRY_TAIL
    );
  return (
    "You are the execution brain of a crypto scalping bot. A rules engine proposed a trade that already passed every risk limit and every strategy check. " +
    "Your job is to help it trade, not to block it. Default to TAKE. " +
    "SKIP only for a clear red flag: a very wide spread, a quick profit that cannot clear fees, or a setup that is obviously late (price already ran far past the entry). A little doubt is not a reason to SKIP. " +
    "Use sizeMult below 1 when you are unsure instead of skipping. " +
    ENTRY_TAIL
  );
}

export const MANAGE_SYSTEM =
  "You manage one open scalp trade for a trading bot. R is the stop distance at entry. " +
  "Choose HOLD, EXIT (close now at market) or TIGHTEN (move the stop closer to price; never beyond current price). " +
  "Bank profit early when momentum stalls, a reversal candle forms or price nears resistance or support. Hold while momentum continues. " +
  "Cut a trade early only when it clearly failed. " +
  "Reply with ONLY one JSON object and nothing else: " +
  '{"action":"HOLD" or "EXIT" or "TIGHTEN","stop":number or null,"reason":"at most 15 words"}. ' +
  "Use only the numbers given. Do not invent prices or news.";

/** Pulls the first JSON object out of a reply, even when the model wrapped it in a code fence or added words. */
export function extractJson(text: string): Record<string, unknown> | null {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(t.slice(a, b + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const say = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

/** Null means the answer was unusable, which the app treats as the AI being down. */
export function parseEntry(text: string, e: { entry: number; stop: number }, cfg: ScalpConfig): AiEntryReply | null {
  const j = extractJson(text);
  if (!j) return null;
  return shapeEntry(j, e, cfg);
}

/** Validates and clamps one entry verdict (TAKE/SKIP, profit level, size). Shared by the single-entry gate and the radar shortlist. */
export function shapeEntry(j: Record<string, unknown>, e: { entry: number; stop: number }, cfg: ScalpConfig): AiEntryReply | null {
  const action = String(j.action ?? "").trim().toUpperCase();
  if (action !== "TAKE" && action !== "SKIP") return null;
  const dist = Math.abs(e.entry - e.stop);
  // The AI may not pick a profit level that fees would eat.
  const need = dist > 0 ? (cfg.feeMult * ROUND_TRIP_COST * e.entry) / dist : QUICK_R_MAX;
  const wanted = num(j.quickR) ?? cfg.quickR;
  const quickR = clamp(Math.max(wanted, need), QUICK_R_MIN, QUICK_R_MAX);
  if (quickR + 1e-9 < need) return { action: "SKIP", quickR: cfg.quickR, sizeMult: 1, reason: "Fees would eat the profit at any allowed level" };
  const sizeMult = clamp(num(j.sizeMult) ?? 1, SIZE_MULT_MIN, 1);
  return { action, quickR, sizeMult, reason: say(j.reason) };
}

export function parseManage(text: string, pos: BookPosition, mark: number): AiManageReply | null {
  const j = extractJson(text);
  if (!j) return null;
  const action = String(j.action ?? "").trim().toUpperCase();
  if (action !== "HOLD" && action !== "EXIT" && action !== "TIGHTEN") return null;
  const reason = say(j.reason);
  if (action !== "TIGHTEN") return { action, stop: null, reason };
  const stop = num(j.stop);
  // A new stop must be tighter than the old one and still on the safe side of the current price.
  const ok = stop != null && (pos.side === "BUY" ? stop > pos.stop && stop < mark : stop < pos.stop && stop > mark);
  return ok ? { action: "TIGHTEN", stop, reason } : { action: "HOLD", stop: null, reason: `Ignored an invalid stop. ${reason}` };
}

export function favorableR(pos: BookPosition, mark: number): number {
  const r = initialRisk(pos);
  if (!(r > 0)) return 0;
  return (pos.side === "BUY" ? mark - pos.entry : pos.entry - mark) / r;
}

const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : "?");
const bars = (c: { o: number; h: number; l: number; c: number }[], n: number) => c.slice(-n).map((x) => `${fmt(x.o)}/${fmt(x.h)}/${fmt(x.l)}/${fmt(x.c)}`).join(" ");

export type BriefContext = {
  symbol: string;
  interval: string;
  candles: { o: number; h: number; l: number; c: number }[];
  dayPnl: number;
  dailyRemaining: number | null;
  recent: string[];
  consecLosses: number;
  openCount: number;
};

export function entryBrief(e: { side: string; entry: number; stop: number; target: number; quality: number; regime: string; strategy: string; reason: string }, mods: { name: string; verdict: string; score: number }[], spreadPct: number | null, cfg: ScalpConfig, c: BriefContext): string {
  const dist = Math.abs(e.entry - e.stop);
  const stopPct = (dist / e.entry) * 100;
  const rr = dist > 0 ? Math.abs(e.target - e.entry) / dist : 0;
  const quickGain = cfg.quickR * stopPct;
  return [
    `${c.symbol} ${c.interval}. Proposed ${e.side} @ ${fmt(e.entry)}, stop ${fmt(e.stop)}, target ${fmt(e.target)}.`,
    `Stop distance ${stopPct.toFixed(2)}%, reward:risk ${rr.toFixed(2)}, setup quality ${e.quality}/100, regime ${e.regime}, strategy ${e.strategy}.`,
    `Quick profit at ${cfg.quickR}R is ${quickGain.toFixed(2)}% of price; round-trip fees and slippage cost ${(ROUND_TRIP_COST * 100).toFixed(2)}%.`,
    `Spread ${spreadPct == null ? "unknown" : spreadPct.toFixed(3) + "%"}. Open trades ${c.openCount}. Losses in a row ${c.consecLosses}.`,
    `Today realized ${c.dayPnl >= 0 ? "+" : ""}${c.dayPnl.toFixed(2)}${c.dailyRemaining != null ? `, ${c.dailyRemaining.toFixed(2)} left to the daily goal` : ""}.`,
    c.recent.length ? `Last trades on this symbol: ${c.recent.join("; ")}.` : "No earlier trades on this symbol today.",
    `Rules engine says: ${e.reason.slice(0, 220)}`,
    `Modules: ${mods.map((m) => `${m.name} ${m.verdict} ${m.score}`).join("; ").slice(0, 500)}.`,
    `Last candles, oldest first, open/high/low/close: ${bars(c.candles, 10)}.`,
  ].join("\n");
}

export function manageBrief(pos: BookPosition, mark: number, now: number, c: BriefContext): string {
  const r = initialRisk(pos);
  const fav = favorableR(pos, mark);
  const held = Math.max(0, Math.round((now - pos.openedAt) / 60_000));
  const gross = (pos.side === "BUY" ? mark - pos.entry : pos.entry - mark) * pos.qty;
  const net = gross - pos.entry * pos.qty * ROUND_TRIP_COST;
  return [
    `${c.symbol} ${c.interval}. Open ${pos.side} from ${fmt(pos.entry)}, now ${fmt(mark)}, stop ${fmt(pos.stop)}, target ${fmt(pos.target)}.`,
    `1R = ${fmt(r)} price units. Profit now ${fav.toFixed(2)}R. Estimated result after fees ${net >= 0 ? "+" : ""}${net.toFixed(2)}. Held ${held} min.`,
    `Today realized ${c.dayPnl >= 0 ? "+" : ""}${c.dayPnl.toFixed(2)}${c.dailyRemaining != null ? `, ${c.dailyRemaining.toFixed(2)} left to the daily goal` : ""}.`,
    `Last candles, oldest first, open/high/low/close: ${bars(c.candles, 8)}.`,
  ].join("\n");
}
