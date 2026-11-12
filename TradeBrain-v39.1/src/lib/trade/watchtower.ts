import type { Candidate } from "./radar.ts";

export type OpportunityStatus = "MONITORING" | "APPROACHING_TRIGGER" | "READY_FOR_MASTER_REVIEW" | "INVALIDATED" | "EXPIRED";
export type WatchOpportunity = {
  id: string; symbol: string; label: string; venue: string; direction: "BUY" | "SELL";
  strategy: string; timeframe: string; price: number; trigger: number; stop: number; target: number;
  quality: number; reason: string; missing: string[]; status: OpportunityStatus;
  firstSeen: number; updatedAt: number; lastPrice: number; checks: number; expiresAt: number;
  source: "RADAR" | "HIVE"; history: { at: number; status: OpportunityStatus; reason: string }[];
};
const KEY = "tradebrain-v39-watchtower-v1";
const MAX = 250;
function read(): WatchOpportunity[] {
  try { const raw = localStorage.getItem(KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function write(rows: WatchOpportunity[]) { try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX))); } catch { /* storage may be unavailable */ } }
function stableId(symbol: string, direction: string, strategy: string, trigger: number) {
  return `${symbol}|${direction}|${strategy}|${Math.round(trigger * 10000)}`;
}
export function saveRadarOpportunity(c: Candidate, timeframe: string, now = Date.now()) {
  if (!Number.isFinite(c.entry) || !Number.isFinite(c.stop) || !Number.isFinite(c.target) || c.score < 50) return;
  const id = stableId(c.symbol, c.side, c.strategy, c.signalTime);
  const rows = read(); const old = rows.find(x => x.id === id);
  const next: WatchOpportunity = {
    id, symbol: c.symbol, label: c.label, venue: c.group, direction: c.side,
    strategy: c.strategyName, timeframe, price: c.entry, trigger: c.entry, stop: c.stop, target: c.target,
    quality: c.score, reason: c.why || "Radar identified a qualifying strategy setup.",
    missing: c.ai?.action === "TAKE" ? ["Fresh Master Intelligence review", "Risk Guard validation"] : ["Fresh entry confirmation", "Master Intelligence review", "Risk Guard validation"],
    status: c.ai?.action === "TAKE" ? "READY_FOR_MASTER_REVIEW" : "MONITORING",
    firstSeen: old?.firstSeen ?? now, updatedAt: now, lastPrice: c.entry, checks: (old?.checks ?? 0) + 1,
    expiresAt: now + 24 * 60 * 60 * 1000, source: "RADAR",
    history: [...(old?.history ?? []), { at: now, status: c.ai?.action === "TAKE" ? "READY_FOR_MASTER_REVIEW" : "MONITORING", reason: "Radar refreshed this setup." }].slice(-20),
  };
  write([next, ...rows.filter(x => x.id !== id)]);
}
export function saveHiveWait(input: { symbol: string; label: string; direction?: "BUY" | "SELL"; price: number; stop?: number; target?: number; reason: string; timeframe: string; venue: string }, now = Date.now()) {
  if (!input.direction || !(input.price > 0)) return;
  const trigger = input.price;
  const id = stableId(input.symbol, input.direction, "HIVE-WAIT", 0);
  const rows = read(); const old = rows.find(x => x.id === id);
  const status: OpportunityStatus = "MONITORING";
  const next: WatchOpportunity = {
    id, symbol: input.symbol, label: input.label, venue: input.venue, direction: input.direction,
    strategy: "Hive multi-agent", timeframe: input.timeframe, price: input.price, trigger,
    stop: input.stop ?? 0, target: input.target ?? 0, quality: 0, reason: input.reason,
    missing: ["Named confirmation condition", "Fresh Master Intelligence review", "Risk Guard validation"],
    status, firstSeen: old?.firstSeen ?? now, updatedAt: now, lastPrice: input.price,
    checks: (old?.checks ?? 0) + 1, expiresAt: now + 12 * 60 * 60 * 1000, source: "HIVE",
    history: [...(old?.history ?? []), { at: now, status, reason: input.reason }].slice(-20),
  };
  write([next, ...rows.filter(x => x.id !== id)]);
}
export function listOpportunities() { return read(); }
export function updateOpportunityPrices(quotes: Record<string, { last: number }>, now = Date.now()) {
  const rows = read(); let changed = false;
  const next = rows.map(o => {
    if (["INVALIDATED", "EXPIRED"].includes(o.status)) return o;
    const q = quotes[o.symbol]?.last;
    if (now > o.expiresAt) { changed = true; return { ...o, status: "EXPIRED" as const, updatedAt: now, history: [...o.history, { at: now, status: "EXPIRED" as const, reason: "Opportunity validity period elapsed." }].slice(-20) }; }
    if (typeof q !== "number" || !(q > 0)) return o;
    const near = Math.abs(q - o.trigger) / Math.max(Math.abs(o.trigger), 1e-9) <= 0.002;
    const invalid = o.stop > 0 && (o.direction === "BUY" ? q <= o.stop : q >= o.stop);
    const status: OpportunityStatus = invalid ? "INVALIDATED" : near ? "APPROACHING_TRIGGER" : o.status === "READY_FOR_MASTER_REVIEW" ? o.status : "MONITORING";
    const reason = invalid ? "Price crossed the stored invalidation/stop level." : near ? "Price is within 0.2% of the stored trigger; a fresh review is required." : "Monitoring the saved trigger.";
    if (status !== o.status) changed = true;
    return { ...o, lastPrice: q, checks: o.checks + 1, updatedAt: now, status, reason: status !== o.status ? reason : o.reason,
      history: status !== o.status ? [...o.history, { at: now, status, reason }].slice(-20) : o.history };
  });
  if (changed || next.some((x, i) => x.lastPrice !== rows[i]?.lastPrice)) write(next);
}
export function clearArchivedOpportunities() { write(read().filter(x => !["INVALIDATED", "EXPIRED"].includes(x.status))); }
