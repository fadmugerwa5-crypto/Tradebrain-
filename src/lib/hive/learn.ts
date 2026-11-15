// How the colony learns. Everything here is plain arithmetic on what really happened to the price, not an AI's opinion.
// The AI only writes the sentence; the numbers and the tags come from here.
import { ANALYSTS } from "./agents.ts";
import type { AgentId, DeskVenue, Lesson, Style, Vote } from "./types.ts";

export type TradeFacts = {
  side: "BUY" | "SELL";
  entry: number;
  stop: number;
  target: number;
  exit: number;
  pnl: number;
  /** The amount at risk when the trade was opened (money). */
  risk: number;
  /** Best and worst price seen while the trade was open. */
  high: number;
  low: number;
  /** Price a while after the exit, when known. */
  after?: number;
};

export type Analysis = { r: number; outcome: "win" | "loss" | "flat"; mfeR: number; maeR: number; afterR: number | null; tags: string[]; facts: string };

const n2 = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));

/** Turns one finished trade into numbers (in multiples of the stop distance) and plain tags. */
export function analyzeTrade(t: TradeFacts): Analysis {
  const dir = t.side === "BUY" ? 1 : -1;
  const dist = Math.abs(t.entry - t.stop);
  const r = t.risk > 0 ? t.pnl / t.risk : 0;
  const outcome: Analysis["outcome"] = r > 0.1 ? "win" : r < -0.1 ? "loss" : "flat";
  if (!(dist > 0)) return { r, outcome, mfeR: 0, maeR: 0, afterR: null, tags: [], facts: `Result ${n2(r)}R.` };
  const fav = (dir === 1 ? t.high - t.entry : t.entry - t.low) / dist;
  const adv = (dir === 1 ? t.entry - t.low : t.high - t.entry) / dist;
  const mfeR = Math.max(0, fav);
  const maeR = Math.max(0, adv);
  const tgtR = Math.abs(t.target - t.entry) / dist;
  const afterR = t.after != null ? ((t.after - t.exit) * dir) / dist : null;
  const tags: string[] = [];
  if (outcome === "loss") {
    if (mfeR >= 0.8) tags.push("was-winning-then-reversed");
    if (afterR != null && afterR >= 1) tags.push("stopped-out-then-reversed");
    if (maeR >= 0.9 && mfeR < 0.3) tags.push("wrong-from-the-start");
    if (tgtR > 0 && mfeR >= tgtR * 0.7 && mfeR < tgtR) tags.push("target-too-far");
  } else if (outcome === "win") {
    if (afterR != null && afterR >= 1) tags.push("exited-early");
    if (mfeR >= Math.max(1.5, r * 1.8)) tags.push("gave-back-profit");
    tags.push("clean-win");
  } else {
    if (mfeR >= 0.8) tags.push("was-winning-then-reversed");
    tags.push("went-nowhere");
  }
  const parts = [`Result ${r >= 0 ? "+" : ""}${n2(r)}R.`, `Price went ${n2(mfeR)}R in favour and ${n2(maeR)}R against.`];
  if (afterR != null) parts.push(`After the exit it moved ${n2(afterR)}R ${afterR >= 0 ? "further the same way" : "back the other way"}.`);
  return { r, outcome, mfeR, maeR, afterR, tags, facts: parts.join(" ") };
}

/** Plain-words advice for each tag. Used as the lesson when no Journal key is set, and as a hint to the Journal. */
export const TAG_ADVICE: Record<string, string> = {
  "was-winning-then-reversed": "The trade was in profit and turned into a loss: take part profit or move the stop up sooner.",
  "stopped-out-then-reversed": "The stop was hit and then price went the original way: the stop was too tight for this market's noise.",
  "wrong-from-the-start": "Price went against the trade almost at once: the entry was wrong or the signal was weak. Wait for a clearer setup.",
  "target-too-far": "Price got close to the target and fell back: aim for a nearer target in this market.",
  "exited-early": "Price kept running after the exit: let winners run longer.",
  "gave-back-profit": "A big open profit was given back: bank more of it earlier.",
  "clean-win": "The setup worked as planned.",
  "went-nowhere": "The trade went nowhere: skip quiet markets.",
};

export function adviceFor(tags: string[]): string {
  const key = tags.find((t) => t !== "clean-win" && t !== "went-nowhere") ?? tags[0];
  return (key && TAG_ADVICE[key]) || "No clear lesson.";
}

export type VoteRec = { agent: AgentId; vote: Vote; confidence: number };

/**
 * Who was right? An analyst that voted with the trade was right if it won. One that voted WAIT or against was right if it lost.
 * Flat trades grade nobody.
 */
export function gradeAgents(votes: VoteRec[], side: "BUY" | "SELL", outcome: Analysis["outcome"]): { right: AgentId[]; wrong: AgentId[] } {
  const right: AgentId[] = [];
  const wrong: AgentId[] = [];
  if (outcome === "flat") return { right, wrong };
  for (const v of votes) {
    if (v.agent === "master") {
      // Master only approves a trade that was actually opened. Its approval is right on a win and wrong on a loss.
      (outcome === "win" ? right : wrong).push(v.agent);
      continue;
    }
    if (!ANALYSTS.includes(v.agent)) continue;
    const with_ = v.vote === side;
    const good = with_ ? outcome === "win" : outcome === "loss";
    (good ? right : wrong).push(v.agent);
  }
  return { right, wrong };
}

export type Score = { n: number; right: number };
export type Scorecards = Partial<Record<AgentId, Score>>;

export function scorecards(lessons: Pick<Lesson, "right" | "wrong">[]): Scorecards {
  const out: Scorecards = {};
  for (const l of lessons) {
    for (const a of l.right) {
      const s = (out[a] ??= { n: 0, right: 0 });
      s.n++;
      s.right++;
    }
    for (const a of l.wrong) {
      const s = (out[a] ??= { n: 0, right: 0 });
      s.n++;
    }
  }
  return out;
}

/** An agent's vote counts for between half and one and a half. Until it has been graded on enough trades it counts for one. */
export function weightsFrom(cards: Scorecards, minTrades = 10): Partial<Record<AgentId, number>> {
  const w: Partial<Record<AgentId, number>> = {};
  for (const id of ANALYSTS) {
    const c = cards[id];
    if (!c || c.n < minTrades) continue;
    w[id] = Math.min(1.5, Math.max(0.5, 0.5 + c.right / c.n));
  }
  return w;
}

export type LessonCtx = { symbol: string; style: Style; desk: DeskVenue; side?: "BUY" | "SELL" };

/** The few lessons most useful for this market now: same market first, then same style and desk, losses and recent ones first. */
export function relevantLessons(lessons: Lesson[], ctx: LessonCtx, limit = 4): Lesson[] {
  const now = Math.max(0, ...lessons.map((l) => l.t));
  return lessons
    .map((l) => {
      let s = 0;
      if (l.symbol === ctx.symbol) s += 4;
      if (l.style === ctx.style) s += 2;
      if (l.desk === ctx.desk) s += 1;
      if (ctx.side && l.side === ctx.side) s += 1;
      if (l.r < 0) s += 1.5;
      if (l.tags.includes("clean-win")) s -= 1;
      s += now > 0 ? (l.t / now) * 0.5 : 0;
      return { l, s };
    })
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.l);
}

export const lessonLine = (l: Lesson) => `${l.symbol} ${l.side} (${l.style}) ${l.r >= 0 ? "+" : ""}${l.r.toFixed(1)}R: ${l.text}`;

/** How long after an exit the price is checked again, per style. */
export const AFTER_MS: Record<Style, number> = { scalp: 3 * 60_000, trader: 60 * 60_000 };
