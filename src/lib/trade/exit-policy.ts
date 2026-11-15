// Patient exit policy for the colony's Executor.
//
// A Deriv rise/fall contract settles by itself. Selling it early pays the buy/sell spread and gives up the rest of
// the payout, so an early sale has to be earned. These rules are deterministic: the AI is only asked about a close
// after they say a review is allowed, and its answer is checked again afterwards.

export const DEFAULT_MIN_HOLD_SEC = { scalp: 90, trader: 1800 } as const;
export const DEFAULT_BANK_PCT = 35;
/** Share of a fixed-duration contract's life that must pass before any discretionary early sale. */
export const MIN_CONTRACT_FRACTION = 0.4;
/** Never bother selling this close to expiry: the contract settles on its own. */
export const NEAR_EXPIRY_SEC = 30;

/** "5-minute" -> 300, "2-hour" -> 7200. Returns null for a label this does not understand. */
export function durationSecFromLabel(label?: string): number | null {
  const m = /^(\d+)\s*-?\s*(minute|min|hour|day)s?$/i.exec((label ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const mult = unit.startsWith("min") ? 60 : unit === "hour" ? 3600 : 86400;
  return n > 0 ? n * mult : null;
}

/** Seconds a trade must be held before the Executor may even be asked about closing it. */
export function patientMinHold(c: { minHoldSec: number; durationSec: number | null }): number {
  const frac = c.durationSec ? Math.floor(c.durationSec * MIN_CONTRACT_FRACTION) : 0;
  return Math.max(Math.max(0, c.minHoldSec), frac);
}

export type ReviewGate = { review: boolean; reason: string };

/** May the Executor be asked to close this Deriv contract early? Only to bank a real profit, and never near expiry. */
export function derivPatientReview(c: {
  profit: number;
  stake: number;
  heldSec: number;
  durationSec: number | null;
  minHoldSec: number;
  bankPct: number;
}): ReviewGate {
  if (!(c.stake > 0)) return { review: false, reason: "Stake unknown, so no early sale is considered." };
  const minHold = patientMinHold(c);
  if (c.heldSec < minHold) return { review: false, reason: `Held ${c.heldSec}s of the ${minHold}s minimum. Letting the contract run.` };
  if (c.durationSec && c.durationSec - c.heldSec <= NEAR_EXPIRY_SEC) return { review: false, reason: "Settles within seconds. Letting it settle instead of paying the sale spread." };
  const pct = (c.profit / c.stake) * 100;
  if (pct < c.bankPct) return { review: false, reason: `Profit ${pct.toFixed(0)}% of stake is under the ${c.bankPct}% level worth banking early. Letting the contract run.` };
  return { review: true, reason: `Profit ${pct.toFixed(0)}% of stake is worth a second look.` };
}

/** Non-Deriv trades: just a minimum hold before the Executor is consulted. */
export function minHoldPassed(heldSec: number, minHoldSec: number): boolean {
  return heldSec >= Math.max(0, minHoldSec);
}
