import { findPatterns } from "./learn.ts";
import { metricsOfR, withR, fmtR } from "./stats.ts";
import type { Candidate, ConfigVersion, Filters, TradeRecord } from "./types.ts";

/**
 * Self-reflection from facts. Every statement here is computed from recorded trades. It is a habit tracker the bot writes in the first person,
 * not awareness: it cannot feel, intend or notice anything outside its own records, and it says so when it has too little data.
 */
type Cond = { id: string; label: string; guard?: "htf" | "standAside" | "spread"; test: (r: TradeRecord) => boolean };
export const CONDITIONS: Cond[] = [
  { id: "against-bias", label: "I trade against the higher-timeframe bias", guard: "htf", test: (r) => r.ctx?.align === "against" },
  { id: "unclear-market", label: "I enter when the market is unclear or in a volatility spike", guard: "standAside", test: (r) => r.ctx?.regime === "unclear" || r.ctx?.regime === "vol-expansion" },
  { id: "chasing", label: "I chase entries that are stretched from the 21 EMA", test: (r) => (r.ctx?.extensionAtr ?? 0) > 1.5 },
  { id: "tight-stop", label: "I use a stop tighter than normal noise", test: (r) => r.ctx?.stopAtr != null && r.ctx.stopAtr < 0.8 },
  { id: "wide-spread", label: "I enter when the spread is wide", guard: "spread", test: (r) => (r.ctx?.spreadPct ?? 0) > 0.1 },
  { id: "cost-heavy", label: "I take trades where costs eat a big share of the risk", test: (r) => r.riskUnit > 0 && r.fees / r.riskUnit > 0.25 },
];

export type Mistake = { id: string; label: string; guard?: Cond["guard"]; cases: number; avgWith: number; avgWithout: number; delta: number; recent: number; repeating: boolean; confidence: "low" | "medium" | "high" };

/** A habit counts as a mistake only with 10+ cases, a clearly negative average with it, and at least 0.2R worse than without it. */
export function mistakeRegister(records: TradeRecord[]): { mistakes: Mistake[]; watching: Mistake[] } {
  const recs = withR(records).filter((r) => r.ctx != null);
  const last20 = recs.slice(-20);
  const mistakes: Mistake[] = [];
  const watching: Mistake[] = [];
  for (const c of CONDITIONS) {
    const w = recs.filter(c.test).map((r) => r.r as number);
    const wo = recs.filter((r) => !c.test(r)).map((r) => r.r as number);
    if (w.length < 3 || wo.length < 5) continue;
    const mw = metricsOfR(w);
    const mo = metricsOfR(wo);
    const m: Mistake = { id: c.id, label: c.label, guard: c.guard, cases: w.length, avgWith: mw.expectancy, avgWithout: mo.expectancy, delta: mw.expectancy - mo.expectancy, recent: last20.filter(c.test).length, repeating: last20.filter(c.test).length >= 3, confidence: w.length >= 100 ? "high" : w.length >= 30 ? "medium" : "low" };
    if (w.length >= 10 && mw.expectancy < 0 && m.delta <= -0.2) mistakes.push(m);
    else if (m.delta < -0.2) watching.push(m);
  }
  const by = (a: Mistake, b: Mistake) => a.delta - b.delta;
  return { mistakes: mistakes.sort(by), watching: watching.sort(by) };
}

export type Reflection = { lessons: string[]; status: string[] };

export function reflect(records: TradeRecord[], candidates: Candidate[], versions: ConfigVersion[], activeId: string, minSample = 30): Reflection {
  const recs = withR(records);
  const lessons: string[] = [];
  const status: string[] = [];
  const m = metricsOfR(recs.map((r) => r.r as number));
  const withCtx = recs.filter((r) => r.ctx != null).length;
  status.push(recs.length === 0 ? "I have no closed trades to learn from yet." : `I have ${recs.length} trades to learn from, ${withCtx} with full entry context. ${m.n < minSample ? `That is under ${minSample}, so I treat my own conclusions as weak.` : "That is enough to start forming habits, but not to be sure of them."}`);
  const { mistakes, watching } = mistakeRegister(records);
  for (const k of mistakes) {
    lessons.push(`${k.label}, and it costs me. Across ${k.cases} trades I averaged ${fmtR(k.avgWith)} when I did it versus ${fmtR(k.avgWithout)} when I did not.${k.repeating ? ` I did it ${k.recent} times in my last 20 trades, so I am still repeating it.` : " I have not done it much lately."}`);
  }
  for (const k of watching.slice(0, 3)) lessons.push(`I may have a bad habit: ${k.label.toLowerCase()}. It looks worse (${fmtR(k.avgWith)} over ${k.cases} trades vs ${fmtR(k.avgWithout)}), but the sample is too small to act on.`);
  const active = versions.find((v) => v.id === activeId);
  for (const r of active?.rules ?? []) {
    const label = Object.values(r.spec).join(" / ");
    lessons.push(r.action === "disable" ? `I stopped taking ${label}${r.source === "learned" ? " after it kept losing on trades it had not seen before" : ", as you asked"}.` : `I only take ${label} when the higher-timeframe bias agrees${r.source === "learned" ? ", because it lost otherwise" : ""}.`);
  }
  for (const p of findPatterns(records, minSample).filter((x) => x.kind === "strong" && x.m.n >= 15).slice(0, 2)) lessons.push(`I seem to do well in ${p.label}: ${fmtR(p.m.expectancy)} over ${p.m.n} independent trades (${p.m.confidence} confidence). I will not size up because of it.`);
  const pending = candidates.filter((c) => c.status === "shadow" || c.status === "ready").length;
  if (pending) status.push(`I am testing ${pending} idea${pending > 1 ? "s" : ""} on new trades before I change anything.`);
  if (m.maxLossStreak >= 4) status.push(`My longest losing run is ${m.maxLossStreak} trades in a row.`);
  if (lessons.length === 0) lessons.push(recs.length < 10 ? "Too few trades to know my habits yet. I am collecting, and I will not guess." : "I cannot find a repeated mistake in my records. That can mean none exists, or that I do not have enough trades to see it.");
  return { lessons, status };
}

/** One-line recap of the last 24 hours, from the records. */
export function diary(records: TradeRecord[], now = Date.now()): string {
  const day = withR(records).filter((r) => r.closedAt >= now - 86_400_000);
  if (!day.length) return "No trades closed in the last 24 hours.";
  const m = metricsOfR(day.map((r) => r.r as number));
  const worst = [...day].sort((a, b) => (a.r as number) - (b.r as number))[0]!;
  return `Last 24 hours: ${m.n} trades, ${m.wins} won, ${fmtR(m.netR)} net. Worst: ${worst.label} ${worst.side} (${fmtR(worst.r as number)}, ${worst.strategy}).`;
}

/** Filters that would switch a guard on, applied only when the user taps the button. */
export const guardPatch = (g: NonNullable<Cond["guard"]>, f: Filters): Partial<Filters> | null =>
  g === "htf" ? (f.htf === "block" ? null : { htf: "block" }) : g === "standAside" ? (f.standAside ? null : { standAside: true }) : f.maxSpreadPct > 0 ? null : { maxSpreadPct: 0.1 };
