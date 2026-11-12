import { metricsIndependent } from "./stats.ts";
import type { Analysis, Cause, TradeRecord } from "./types.ts";

const EPS = 0.15;

/**
 * Looks at one closed trade and lists conditions that were present and plausibly contributed. Every item is a hypothesis with its
 * evidence, not proof. When nothing stands out the answer is "unknown": it never invents a reason because a trade lost.
 */
export function analyzeTrade(rec: TradeRecord, all: TradeRecord[], now = Date.now()): Analysis {
  const outcome: Analysis["outcome"] = rec.r == null ? (rec.pnl > 0 ? "win" : rec.pnl < 0 ? "loss" : "flat") : rec.r > EPS ? "win" : rec.r < -EPS ? "loss" : "flat";
  const causes: Cause[] = [];
  const c = rec.ctx;
  const loss = outcome === "loss";
  const win = outcome === "win";
  if (c) {
    if (loss && c.align === "against") causes.push({ category: "market", text: `Traded against the ${c.htfMin}m bias`, evidence: `${c.htfWhy}; the trade was a ${rec.side}`, confidence: "medium" });
    if (win && c.align === "with") causes.push({ category: "market", text: `Traded with the ${c.htfMin}m bias`, evidence: c.htfWhy, confidence: "low" });
    if (loss && (c.regime === "unclear" || c.regime === "vol-expansion")) causes.push({ category: "market", text: `Entered in a ${c.regime === "unclear" ? "transition / unclear" : "volatility-expansion"} market`, evidence: c.regimeWhy, confidence: "low" });
    if (loss && c.extensionAtr != null && c.extensionAtr > 1.5) causes.push({ category: "timing", text: "Entry was extended from the 21 EMA (chasing)", evidence: `${c.extensionAtr.toFixed(1)} ATR beyond EMA21 in the trade direction`, confidence: "low" });
    if (loss && c.stopAtr != null && c.stopAtr < 0.8) causes.push({ category: "risk", text: "Stop was tight compared with normal noise", evidence: `stop only ${c.stopAtr.toFixed(2)} ATR away`, confidence: rec.exitKind === "stop" && rec.holdMin <= 20 ? "medium" : "low" });
    if (loss && c.spreadPct != null && c.spreadPct > 0.1) causes.push({ category: "execution", text: "Spread was wide at entry", evidence: `${c.spreadPct.toFixed(3)}% spread`, confidence: "low" });
  }
  if (rec.riskUnit > 0 && rec.fees / rec.riskUnit > 0.25 && rec.r != null && rec.r < 0.25) {
    causes.push({ category: "execution", text: "Costs took a large share of the risk", evidence: `fees were ${(100 * rec.fees / rec.riskUnit).toFixed(0)}% of the amount risked`, confidence: "medium" });
  }
  if (/outside this app|uncertain|could not|stale|missing/i.test(rec.exitReason)) {
    causes.push({ category: "system", text: "The exit was recorded after a data or sync problem", evidence: rec.exitReason.slice(0, 120), confidence: "low" });
  }
  // Strategy fit: only from history that excludes this trade, and only with enough trades to say anything.
  const before = all.filter((x) => x.id !== rec.id && x.strategy === rec.strategy && x.closedAt <= rec.openedAt);
  if (c && loss) {
    const seg = before.filter((x) => x.ctx?.regime === c.regime);
    const m = metricsIndependent(seg);
    if (m.n >= 10 && m.expectancy < -0.1) causes.push({ category: "fit", text: `${rec.strategy} had a weak record in ${c.regime} markets`, evidence: `${m.n} earlier independent trades, ${m.expectancy.toFixed(2)}R average`, confidence: m.n >= 30 ? "medium" : "low" });
  }
  const unknown = !win && causes.length === 0;
  const summary = win
    ? causes.length ? `Win. Conditions present: ${causes.map((x) => x.text).join("; ")}.` : "Win. No recorded condition stands out; it may be ordinary variance."
    : loss
      ? causes.length ? `Loss. Possible contributors (hypotheses, not proof): ${causes.map((x) => x.text).join("; ")}.` : "Loss. Unknown / insufficient evidence: no recorded condition stands out."
      : "Close to breakeven.";
  return { id: rec.id, at: now, outcome, causes, unknown, summary };
}
