// Conviction sizing: the AI proposes how much to risk, deterministic code decides how much it may.
//
// The Executor states a riskPct (percent of equity lost if the stop is hit). This module turns that request into the
// risk actually taken. The AI can ask for more than the base risk only when the evidence is strong, and never above
// the hard maximum. It is never allowed to grow after a loss, to push open risk past the cap, or to breach the daily
// loss budget. Nothing here chases losses or doubles up.

export type SizingInput = {
  equity: number;
  /** Normal risk per trade, percent of equity. */
  baseRiskPct: number;
  /** Hard ceiling per trade, percent of equity. */
  maxRiskPct: number;
  /** What the Executor asked for. Missing means base. */
  requestedRiskPct?: number;
  /** 0-100: average confidence of the agreeing analysts blended with the Executor's. */
  confidence: number;
  /** Analysts that agree on the direction. */
  agreeing: number;
  /** Planned reward divided by risk. */
  rr: number;
  /** Losing trades in a row on this desk, most recent first. */
  consecLosses: number;
  /** Closed colony trades on this desk so far. */
  closedTrades: number;
  /** Trades needed before the full scale-up is unlocked. */
  scaleAfterTrades: number;
  /** Risk Guard's shrink factor, 0.1 to 1. It can only reduce. */
  riskGuardMult: number;
  /** Money at risk right now in open colony trades on this desk. */
  openRiskCash: number;
  /** Cap on total open risk, percent of equity. */
  maxOpenRiskPct: number;
  /** Loss still allowed today before the daily lock, in money. null when unknown. */
  dayLossBudgetCash: number | null;
};

export type SizingResult =
  | { ok: true; riskPct: number; riskCash: number; ceilingPct: number; notes: string[] }
  | { ok: false; why: string };

/** Evidence needed before the risk may rise above the base. */
export const SCALE_MIN_CONFIDENCE = 70;
export const SCALE_FULL_CONFIDENCE = 95;
export const SCALE_MIN_AGREE = 3;
export const SCALE_MIN_RR = 2;

/** Smallest share of base risk worth a trade. */
export const MIN_FRACTION = 0.25;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function sizeByConviction(x: SizingInput): SizingResult {
  if (!(x.equity > 0)) return { ok: false, why: "No account equity to size from." };
  const base = Math.max(0, x.baseRiskPct);
  if (!(base > 0)) return { ok: false, why: "Base risk is zero." };
  const max = Math.max(base, x.maxRiskPct);
  const notes: string[] = [];

  // 1. The ceiling: base unless the evidence is strong.
  let ceiling = base;
  const why: string[] = [];
  if (x.confidence < SCALE_MIN_CONFIDENCE) why.push(`confidence ${Math.round(x.confidence)} is under ${SCALE_MIN_CONFIDENCE}`);
  if (x.agreeing < SCALE_MIN_AGREE) why.push(`only ${x.agreeing} analysts agree (need ${SCALE_MIN_AGREE})`);
  if (x.rr < SCALE_MIN_RR) why.push(`reward is ${f2(x.rr)}x risk (need ${SCALE_MIN_RR}x)`);
  if (x.consecLosses > 0) why.push(`the last ${x.consecLosses} trade${x.consecLosses > 1 ? "s were" : " was a"} ${x.consecLosses > 1 ? "losses" : "loss"}, so no scaling up`);
  if (why.length === 0) {
    const frac = clamp((x.confidence - SCALE_MIN_CONFIDENCE) / (SCALE_FULL_CONFIDENCE - SCALE_MIN_CONFIDENCE), 0, 1);
    ceiling = base + (max - base) * frac;
    if (x.closedTrades < x.scaleAfterTrades) {
      ceiling = base + (ceiling - base) * 0.5;
      notes.push(`Only ${x.closedTrades} of ${x.scaleAfterTrades} trades recorded, so scale-up is limited to half until there is a track record.`);
    }
  } else {
    notes.push(`Base risk only: ${why.join("; ")}.`);
  }

  // 2. The AI's request, inside [a quarter of base, ceiling]. It may ask for less than base when it is unsure.
  //    A quarter of base is also the smallest trade worth sending, so a timid request is raised to it, not refused.
  const asked = x.requestedRiskPct != null && Number.isFinite(x.requestedRiskPct) ? x.requestedRiskPct : base;
  let pct = clamp(asked, base * MIN_FRACTION, ceiling);
  if (asked > ceiling + 1e-9) notes.push(`AI asked for ${f2(asked)}% risk; limited to ${f2(ceiling)}%.`);
  else if (pct > base + 1e-9) notes.push(`AI sized up to ${f2(pct)}% (base ${f2(base)}%) on strong evidence.`);
  else if (pct < base - 1e-9) notes.push(`AI sized down to ${f2(pct)}%.`);

  // 3. Risk Guard can only shrink.
  const guard = clamp(x.riskGuardMult, 0.1, 1);
  if (guard < 1) {
    pct *= guard;
    notes.push(`Risk Guard shrank the size to x${f2(guard)}.`);
  }
  let cash = (x.equity * pct) / 100;

  // 4. Total open risk cap.
  const room = (x.equity * x.maxOpenRiskPct) / 100 - Math.max(0, x.openRiskCash);
  if (!(room > 0)) return { ok: false, why: `Open risk is already at the ${f2(x.maxOpenRiskPct)}% cap. No new trade until one closes.` };
  if (cash > room) {
    cash = room;
    notes.push(`Cut to ${f2(room)} to stay inside the ${f2(x.maxOpenRiskPct)}% open-risk cap.`);
  }

  // 5. A single stop must not breach the daily loss lock.
  if (x.dayLossBudgetCash != null) {
    if (!(x.dayLossBudgetCash > 0)) return { ok: false, why: "The daily loss budget is used up." };
    if (cash > x.dayLossBudgetCash) {
      cash = x.dayLossBudgetCash;
      notes.push(`Cut to ${f2(cash)}, the loss still allowed before today's lock.`);
    }
  }

  // 6. Too little room left is not worth a trade.
  const floor = (x.equity * base * MIN_FRACTION) / 100 - 1e-9;
  if (cash < floor) return { ok: false, why: `Only ${f2(cash)} of risk room is left, under the ${f2(floor)} minimum worth trading.` };
  return { ok: true, riskPct: (cash / x.equity) * 100, riskCash: cash, ceilingPct: ceiling, notes };
}

/** Trailing losing streak, newest trade last in `pnls`. */
export function lossStreak(pnls: number[]): number {
  let n = 0;
  for (let i = pnls.length - 1; i >= 0 && pnls[i]! < 0; i--) n++;
  return n;
}
