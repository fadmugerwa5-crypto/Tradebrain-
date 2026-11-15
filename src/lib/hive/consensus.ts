import type { AgentId, AgentReply, RoundConfig, Vote } from "./types.ts";
import { ANALYSTS } from "./agents.ts";

export type Tally = { buy: number; sell: number; wait: number; avgBuy: number; avgSell: number; used: number };

/** Counts the analysts' votes. Weighted average confidence; the Coach's weights only move the average, never the head count. */
export function tally(replies: AgentReply[], weights: Partial<Record<AgentId, number>> = {}): Tally {
  const t: Tally = { buy: 0, sell: 0, wait: 0, avgBuy: 0, avgSell: 0, used: 0 };
  let wb = 0;
  let ws = 0;
  for (const r of replies) {
    if (!r.ok || !ANALYSTS.includes(r.agent)) continue;
    t.used++;
    const w = weights[r.agent] ?? 1;
    if (r.vote === "BUY") {
      t.buy++;
      t.avgBuy += r.confidence * w;
      wb += w;
    } else if (r.vote === "SELL") {
      t.sell++;
      t.avgSell += r.confidence * w;
      ws += w;
    } else t.wait++;
  }
  t.avgBuy = wb ? t.avgBuy / wb : 0;
  t.avgSell = ws ? t.avgSell / ws : 0;
  return t;
}

/**
 * The colony's direction. `configured` is how many analysts have a key: if you only gave keys to two analysts,
 * two must agree, not three. A tie between BUY and SELL is always WAIT.
 */
export function consensus(t: Tally, cfg: Pick<RoundConfig, "minAgree" | "minConfidence">, configured: number): { side: Vote; reason: string } {
  if (configured < 1) return { side: "WAIT", reason: "No analyst has an AI key yet." };
  const need = Math.max(1, Math.min(cfg.minAgree, configured));
  const okBuy = t.buy >= need && t.avgBuy >= cfg.minConfidence;
  const okSell = t.sell >= need && t.avgSell >= cfg.minConfidence;
  if (okBuy && okSell) return { side: "WAIT", reason: "The colony is split between BUY and SELL." };
  if (okBuy) return { side: "BUY", reason: `${t.buy} of ${t.used} analysts agree on BUY (average confidence ${t.avgBuy.toFixed(0)}).` };
  if (okSell) return { side: "SELL", reason: `${t.sell} of ${t.used} analysts agree on SELL (average confidence ${t.avgSell.toFixed(0)}).` };
  const lead = t.buy >= t.sell ? { n: t.buy, s: "BUY", c: t.avgBuy } : { n: t.sell, s: "SELL", c: t.avgSell };
  if (lead.n >= need) return { side: "WAIT", reason: `${lead.n} agree on ${lead.s} but confidence ${lead.c.toFixed(0)} is under ${cfg.minConfidence}.` };
  return { side: "WAIT", reason: `Only ${lead.n} of ${need} needed analysts agree.` };
}
