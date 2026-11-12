import type { AgentId, AgentReply, Vote } from "./types.ts";

/** Pulls the first balanced {...} object out of whatever the model said (code fences, chatter, thinking tags). */
export function extractJson(text: string): Record<string, unknown> | null {
  const s = String(text ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  let start = s.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const v = JSON.parse(s.slice(start, i + 1));
            if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
          } catch {
            /* try the next brace */
          }
          break;
        }
      }
    }
    start = s.indexOf("{", start + 1);
  }
  return null;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function asVote(v: unknown): Vote {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "BUY" || s === "LONG" || s === "UP" || s === "CALL") return "BUY";
  if (s === "SELL" || s === "SHORT" || s === "DOWN" || s === "PUT") return "SELL";
  return "WAIT";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clean = (v: unknown, max = 220) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Turns one agent's raw text into a checked reply. Never throws. Garbage becomes an error reply that counts for nothing. */
export function parseReply(agent: AgentId, text: string, at: number, ms: number): AgentReply {
  const j = extractJson(text);
  const base: AgentReply = { agent, ok: false, vote: "WAIT", confidence: 0, note: "", at, ms };
  if (!j) return { ...base, error: "The answer was not valid JSON." };
  const conf = num(j.confidence);
  const out: AgentReply = {
    ...base,
    ok: true,
    // Executor answers with "action", everyone else with "vote".
    vote: asVote(j.vote ?? j.action),
    confidence: conf == null ? 50 : clamp(conf <= 1 && conf > 0 ? conf * 100 : conf, 0, 100),
    note: clean(j.note ?? j.reason ?? j.why),
  };
  const pick = j.pick;
  if (pick !== undefined) out.pick = pick == null || String(pick).toLowerCase() === "null" || String(pick).trim() === "" ? null : String(pick).trim();
  const e = num(j.entry);
  const s = num(j.stop ?? j.stop_loss ?? j.sl);
  const t = num(j.target ?? j.take_profit ?? j.tp);
  if (e != null) out.entry = e;
  if (s != null) out.stop = s;
  if (t != null) out.target = t;
  if (typeof j.approve === "boolean") out.approve = j.approve;
  else if (typeof j.approve === "string") out.approve = /^(true|yes|approve)/i.test(j.approve);
  const m = num(j.sizeMult ?? j.size_mult ?? j.size);
  if (m != null) out.sizeMult = clamp(m, 0.1, 1);
  return out;
}

/** Coach answer: weights per agent, kept inside 0.5 to 1.5. */
export function parseWeights(text: string): { note: string; weights: Partial<Record<AgentId, number>> } | null {
  const j = extractJson(text);
  if (!j) return null;
  const w: Partial<Record<AgentId, number>> = {};
  const raw = (j.weights ?? {}) as Record<string, unknown>;
  for (const id of ["scout", "trend", "scalper", "regime", "pulse"] as AgentId[]) {
    const n = num(raw[id]);
    if (n != null) w[id] = clamp(n, 0.5, 1.5);
  }
  return { note: clean(j.note, 300), weights: w };
}

/** Executor's answer about an open trade: HOLD or CLOSE. Anything unclear is HOLD, so a garbled answer never closes a trade. */
export function parseManage(text: string): { close: boolean; note: string } {
  const j = extractJson(text);
  if (!j) return { close: false, note: "" };
  const a = String(j.action ?? j.decision ?? "").trim().toUpperCase();
  return { close: a === "CLOSE" || a === "EXIT" || a === "SELL_NOW", note: clean(j.note ?? j.reason) };
}
