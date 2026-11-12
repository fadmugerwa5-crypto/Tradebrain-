import type { AccountView, AgentId, AgentReply, Brief, Decision, RoundConfig, RoundResult, Style } from "./types.ts";
import { ANALYSTS, systemFor } from "./agents.ts";
import { briefText, shortlistText } from "./brief.ts";
import { parseReply } from "./parse.ts";
import { consensus, tally } from "./consensus.ts";
import { resolveLevels } from "./levels.ts";

export type AskResult = { ok: true; text: string } | { ok: false; error: string };
export type Ask = (agent: AgentId, system: string, user: string) => Promise<AskResult>;

export type RoundInput = {
  shortlist: Brief[];
  account: AccountView;
  config: RoundConfig;
  style: Style;
  /** Lessons from past trades that fit this market, shown to every agent. */
  lessons?: (symbol: string) => string[];
  weights: Partial<Record<AgentId, number>>;
  /** Does this agent have a working AI key? */
  has: (agent: AgentId) => boolean;
  now: () => number;
  /** Called after each agent answers, so the screen can show the colony thinking. */
  onStep?: (agent: AgentId, state: "thinking" | "done", reply?: AgentReply) => void;
};

const accountText = (a: AccountView) =>
  `Account (${a.venue}, demo): equity ${a.equity.toFixed(2)} ${a.currency}, cash ${a.cash.toFixed(2)}, open colony trades ${a.openPositions}${a.openSymbols.length ? ` (${a.openSymbols.join(", ")})` : ""}, today ${a.dayPnl >= 0 ? "+" : ""}${a.dayPnl.toFixed(2)}.${a.recent.length ? ` Recent results: ${a.recent.join("; ")}.` : ""}`;

const lessonsText = (l?: string[]) => (l && l.length ? `\n\nLessons from this colony's own past trades (apply them, do not repeat these mistakes):\n${l.map((x) => `- ${x}`).join("\n")}` : "");

async function callAgent(agent: AgentId, user: string, ask: Ask, input: RoundInput): Promise<AgentReply> {
  const t0 = input.now();
  input.onStep?.(agent, "thinking");
  let reply: AgentReply;
  try {
    const r = await ask(agent, systemFor(agent, input.style), user);
    const ms = input.now() - t0;
    reply = r.ok ? parseReply(agent, r.text, input.now(), ms) : { agent, ok: false, vote: "WAIT", confidence: 0, note: "", error: r.error, at: input.now(), ms };
  } catch (err) {
    reply = { agent, ok: false, vote: "WAIT", confidence: 0, note: "", error: err instanceof Error ? err.message : "The agent failed.", at: input.now(), ms: input.now() - t0 };
  }
  input.onStep?.(agent, "done", reply);
  return reply;
}

const line = (r: AgentReply) => (r.ok ? `${r.vote} ${r.confidence.toFixed(0)}${r.note ? `: ${r.note}` : ""}` : `no answer (${r.error ?? "error"})`);

function chatter(r: AgentReply): { agent: AgentId; text: string } {
  return { agent: r.agent, text: line(r) };
}

/** One colony round on one market: Scout picks, analysts vote, Risk Guard checks, Executor decides. */
export async function runRound(input: RoundInput, ask: Ask): Promise<RoundResult> {
  const cfg = input.config;
  const replies: AgentReply[] = [];
  const talk: { agent: AgentId; text: string }[] = [];
  const empty = { buy: 0, sell: 0, wait: 0, avgBuy: 0, avgSell: 0, used: 0 };
  const wait = (symbol: string | null, reason: string, t = empty): RoundResult => ({ symbol, replies, decision: { action: "WAIT", reason }, tally: t, chatter: talk });

  if (!input.shortlist.length) return wait(null, "No market has fresh data yet.");
  const keyedAnalysts = ANALYSTS.filter((a) => input.has(a));
  if (!keyedAnalysts.length) return wait(null, "Add at least one analyst key (Scout, Trend, Scalper, Regime or Pulse).");

  // 1. Scout picks the market.
  let pick: Brief = input.shortlist[0]!;
  let scoutReply: AgentReply | null = null;
  if (input.has("scout")) {
    scoutReply = await callAgent("scout", `Shortlist:\n${shortlistText(input.shortlist)}\n\n${accountText(input.account)}`, ask, input);
    replies.push(scoutReply);
    talk.push(chatter(scoutReply));
    if (scoutReply.ok) {
      if (scoutReply.pick === null) return wait(null, `Scout sees nothing worth scalping${scoutReply.note ? `: ${scoutReply.note}` : "."}`);
      const hit = input.shortlist.find((b) => b.symbol.toLowerCase() === String(scoutReply!.pick ?? "").toLowerCase());
      if (hit) pick = hit;
    }
  }

  // 2. The other analysts look at the chosen market at the same time.
  const base = `${briefText(pick)}\n\n${accountText(input.account)}${scoutReply?.ok && scoutReply.note ? `\nScout says: ${scoutReply.note}` : ""}${lessonsText(input.lessons?.(pick.symbol))}`;
  const others = (["trend", "scalper", "regime", "pulse"] as AgentId[]).filter((a) => input.has(a));
  const got = await Promise.all(others.map((a) => callAgent(a, base, ask, input)));
  for (const r of got) {
    replies.push(r);
    talk.push(chatter(r));
  }
  // The Scout's vote counts only when it picked the market that was analysed.
  const forTally = replies.filter((r) => r.agent !== "scout" || (r.ok && (r.pick == null || r.pick.toLowerCase() === pick.symbol.toLowerCase())));
  const weights = input.weights;
  const t = tally(forTally, weights);
  const c = consensus(t, cfg, keyedAnalysts.length);
  if (c.side === "WAIT") return wait(pick.symbol, c.reason, t);
  const side = c.side;
  if (side === "SELL" && !pick.canShort) return wait(pick.symbol, `${pick.symbol} is long-only on this account, so a SELL cannot be opened.`, t);

  // 3. Risk Guard.
  let sizeMult = 1;
  if (input.has("risk")) {
    const votes = forTally.filter((r) => r.ok && ANALYSTS.includes(r.agent)).map((r) => `${r.agent}: ${line(r)}`).join("\n");
    const rr = await callAgent("risk", `Review this proposal. The colony leans ${side} on ${pick.symbol}. ${c.reason}\nAnalyst answers:\n${votes}\n\nMarket briefing:\n${base}`, ask, input);
    replies.push(rr);
    talk.push({ agent: "risk", text: rr.ok ? `${rr.approve === false ? "VETO" : "OK"}${rr.sizeMult != null ? ` size x${rr.sizeMult.toFixed(2)}` : ""}${rr.note ? `: ${rr.note}` : ""}` : `no answer (${rr.error ?? "error"})` });
    if (rr.ok && rr.approve === false) return wait(pick.symbol, `Risk Guard vetoed: ${rr.note || "no reason given"}`, t);
    if (rr.ok && rr.sizeMult != null) sizeMult = rr.sizeMult;
  }

  // 4. Executor makes the final call.
  const scalper = replies.find((r) => r.agent === "scalper" && r.ok && r.vote === side);
  const proposals = [] as { stop?: number; target?: number }[];
  let confidence = side === "BUY" ? t.avgBuy : t.avgSell;
  if (input.has("executor")) {
    const all = replies.filter((r) => r.ok).map((r) => `${r.agent}: ${line(r)}${r.stop != null ? ` [stop ${r.stop}, target ${r.target ?? "n/a"}]` : ""}`).join("\n");
    const ex = await callAgent("executor", `Give the final call. Colony direction: ${side} on ${pick.symbol}. ${c.reason} Entry is the current market price ${pick.price}.\nEvery agent's answer:\n${all}\n\nMarket briefing:\n${base}`, ask, input);
    replies.push(ex);
    talk.push({ agent: "executor", text: line(ex) });
    if (ex.ok && ex.vote !== side) return wait(pick.symbol, ex.vote === "WAIT" ? `Executor said wait${ex.note ? `: ${ex.note}` : "."}` : "Executor chose the opposite direction.", t);
    if (ex.ok) {
      proposals.push({ stop: ex.stop, target: ex.target });
      confidence = (confidence + ex.confidence) / 2;
    }
  }
  if (scalper) proposals.push({ stop: scalper.stop, target: scalper.target });
  const lv = resolveLevels(side, pick.price, pick.atr, proposals, cfg.defaultRR, input.style);

  // Optional independent Master Intelligence review. It has its own key and can only veto;
  // it cannot change levels, enlarge size, or override deterministic risk controls.
  if (input.has("master")) {
    const all = replies.filter((r) => r.ok).map((r) => `${r.agent}: ${line(r)}`).join("\n");
    const master = await callAgent("master", `Audit task. Proposed trade: ${side} ${pick.symbol} at ${lv.entry}; stop ${lv.stop}; target ${lv.target}; planned reward/risk ${(Math.abs(lv.target - lv.entry) / Math.max(1e-12, Math.abs(lv.entry - lv.stop))).toFixed(2)}.\nApprove only if the evidence is coherent and the setup is not stale, contradictory or unsafe. If anything is unclear, veto.\n\nAgent evidence:\n${all}\n\nMarket briefing:\n${base}`, ask, input);
    replies.push(master);
    talk.push({ agent: "master", text: master.ok ? `${master.approve === false ? "VETO" : master.approve === true ? "APPROVED" : "UNCLEAR"}${master.note ? `: ${master.note}` : ""}` : `no answer (${master.error ?? "error"})` });
    if (!master.ok || master.approve !== true) return wait(pick.symbol, master.ok ? `Master Intelligence vetoed or did not explicitly approve${master.note ? `: ${master.note}` : "."}` : `Master Intelligence unavailable; fail-closed: ${master.error ?? "no answer"}.`, t);
  }

  const decision: Decision = {
    action: side,
    entry: lv.entry,
    stop: lv.stop,
    target: lv.target,
    confidence,
    sizeMult,
    reason: `${c.reason} Levels: ${lv.source}.`,
  };
  return { symbol: pick.symbol, replies, decision, tally: t, chatter: talk };
}
