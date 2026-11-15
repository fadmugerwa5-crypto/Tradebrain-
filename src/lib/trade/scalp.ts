import { FEE, SLIP, type BookPosition } from "./account.ts";
import { startOfUtcDay } from "./goal.ts";

/** Scalp-and-compound rules. They only apply in aggressive mode, and only when enabled. */
export type ScalpConfig = {
  enabled: boolean;
  /** Take the profit once a trade is this many R in profit (R = distance from entry to stop). */
  quickR: number;
  /** Move the stop to entry plus fees once a trade is this many R in profit. */
  lockR: number;
  /** An entry is only allowed if the quick profit is at least this many times the round-trip fees. */
  feeMult: number;
  /** Stop new entries for the day after giving back this % of the day's best realized profit. */
  givebackPct: number;
  /** After a loss on a symbol, no new entry on that symbol for this many minutes. */
  lossCoolMin: number;
  /** Entries per hour while scalping (aggressive normally allows 12). */
  maxEntriesHour: number;
  /** Half the risk size after 2 losses in a row. Size is never increased after a loss. */
  stepDown: boolean;
  /** AI approves or skips each entry the rules found, and picks where to bank it. */
  aiEntry: boolean;
  /** AI watches open scalps and can bank early, tighten the stop, or hold. */
  aiManage: boolean;
  /** Which AI key to use. "auto" takes the first connected one. */
  aiSlot: "auto" | "gemini" | "grok" | "other";
  /** What happens to NEW entries while the AI cannot answer. Open trades always fall back to the rules. */
  aiOnFail: "skip" | "rules";
  /** How picky the AI is when it approves entries. relaxed = takes anything reasonable and only vetoes clear red flags. */
  aiStrict: "relaxed" | "balanced" | "strict";
  /** Seconds to wait for the AI before treating it as down. */
  aiTimeoutSec: number;
  /** Stop using a strategy whose last 20 aggressive trades lost money overall. */
  stratGuard: boolean;
  /** Deriv contracts: sell early once profit reaches this % of the stake. 0 = off. */
  derivTakePct: number;
  /** Deriv contracts: sell early once the loss reaches this % of the stake. 0 = off (the contract runs to expiry). */
  derivCutPct: number;
  /** Normal mode scalps too (small profits, capped losses). Off = Normal behaves as before. */
  normalScalp: boolean;
  /** Normal mode, Deriv: sell as soon as profit reaches this % of the stake (9 is about $1.70 on a $19 stake). */
  normalTakePct: number;
  /** Normal mode, Deriv: after the contract has been this % under water, sell on the first bounce to {normalRecoverPct} profit. */
  normalDipPct: number;
  /** Normal mode, Deriv: profit % of stake that counts as "back in profit" after a dip. */
  normalRecoverPct: number;
  /** Normal mode, Deriv: hard loss cap. Sell once the loss reaches this % of the stake. */
  normalCutPct: number;
  /** Minimum time a normal-mode Deriv contract must be held before any configured early-exit rule can run. */
  normalMinHoldSec: number;
  /** Normal mode, Deriv: share of the contract's life after which the bot sells whatever it is holding instead of risking the whole stake at expiry. 0 = off. */
  normalTimeFrac: number;
  /** Normal mode, Deriv: new contracts per scan. */
  normalMaxNew: number;
};

export const SCALP_DEFAULTS: ScalpConfig = {
  enabled: true,
  quickR: 0.6,
  lockR: 0.4,
  feeMult: 2,
  givebackPct: 50,
  lossCoolMin: 5,
  maxEntriesHour: 20,
  stepDown: true,
  aiEntry: true,
  aiManage: true,
  aiSlot: "auto",
  aiOnFail: "rules",
  aiStrict: "relaxed",
  aiTimeoutSec: 10,
  stratGuard: true,
  derivTakePct: 35,
  derivCutPct: 0,
  normalScalp: true,
  normalTakePct: 9,
  normalDipPct: 5,
  normalRecoverPct: 3,
  normalCutPct: 50,
  normalMinHoldSec: 60,
  normalTimeFrac: 0,
  normalMaxNew: 3,
};

/** Fees plus slippage for opening and closing, as a fraction of price. */
export const ROUND_TRIP_COST = 2 * (FEE + SLIP);

export function scalpFor(mode: string, cfg: ScalpConfig | undefined): ScalpConfig | null {
  if (!cfg?.enabled) return null;
  if (mode === "aggressive") return cfg;
  return mode === "normal" && cfg.normalScalp ? cfg : null;
}

/** Null when the quick profit clears the fees by enough; otherwise the reason to skip this entry. */
export function feeGate(entry: number, stop: number, cfg: ScalpConfig): string | null {
  if (!(entry > 0)) return null;
  const gainPct = (cfg.quickR * Math.abs(entry - stop)) / entry;
  const need = cfg.feeMult * ROUND_TRIP_COST;
  if (gainPct + 1e-12 >= need) return null;
  return `Fee gate: quick profit ${(gainPct * 100).toFixed(2)}% is under ${cfg.feeMult}x the round-trip cost (${(need * 100).toFixed(2)}%)`;
}

function lastClosedOn(positions: BookPosition[], symbol: string): BookPosition | undefined {
  let best: BookPosition | undefined;
  for (const p of positions) {
    if (p.status !== "closed" || p.symbol !== symbol || p.closedAt == null) continue;
    if (!best || (p.closedAt ?? 0) >= (best.closedAt ?? 0)) best = p;
  }
  return best;
}

/** Reason string while this symbol is cooling off after a loss, else null. */
export function lossCooldown(positions: BookPosition[], symbol: string, now: number, cfg: ScalpConfig): string | null {
  const last = lastClosedOn(positions, symbol);
  if (!last || (last.pnl ?? 0) >= 0 || cfg.lossCoolMin <= 0) return null;
  const left = (last.closedAt ?? 0) + cfg.lossCoolMin * 60_000 - now;
  return left > 0 ? `Loss cool-off on ${symbol}: ${Math.ceil(left / 1000)}s left` : null;
}

/** True when the last trade on this symbol was a win that closed after the last entry, so the entry cooldown can be skipped. */
export function wonSince(positions: BookPosition[], symbol: string, since: number): boolean {
  const last = lastClosedOn(positions, symbol);
  return !!last && (last.pnl ?? 0) > 0 && (last.closedAt ?? 0) >= since;
}

/** Half size after 2 losses in a row. Never above 1. */
export function riskScale(consecLosses: number, cfg: ScalpConfig): number {
  return cfg.stepDown && consecLosses >= 2 ? 0.5 : 1;
}

/** Stops new entries for the rest of the UTC day once too much of the day's best profit has been given back. */
export function givebackHalt(positions: BookPosition[], now: number, cfg: ScalpConfig, floor: number): string | null {
  if (!(cfg.givebackPct > 0)) return null;
  const since = startOfUtcDay(now);
  const today = positions
    .filter((p) => p.status === "closed" && p.pnl != null && (p.closedAt ?? 0) >= since)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let run = 0;
  let peak = 0;
  for (const p of today) {
    run += p.pnl ?? 0;
    if (run > peak) peak = run;
  }
  if (peak <= 0 || peak < floor) return null;
  const gave = peak - run;
  if (gave + 1e-9 < (peak * cfg.givebackPct) / 100) return null;
  return `Gave back ${((gave / peak) * 100).toFixed(0)}% of the day's best profit (+${peak.toFixed(2)} peak, +${run.toFixed(2)} now). New entries stop until tomorrow (UTC).`;
}

/** Blocks a strategy whose recent aggressive trades lost money overall. Needs at least 10 trades to judge. */
export function strategyBlocked(positions: BookPosition[], strategy: string, cfg: ScalpConfig): string | null {
  if (!cfg.stratGuard) return null;
  const recent = positions
    .filter((p) => p.status === "closed" && p.pnl != null && p.mode === "aggressive" && p.strategy === strategy)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
    .slice(-20);
  if (recent.length < 10) return null;
  const net = recent.reduce((s, p) => s + (p.pnl ?? 0), 0);
  return net < 0 ? `Strategy guard: "${strategy}" lost ${Math.abs(net).toFixed(2)} over its last ${recent.length} aggressive trades` : null;
}

/**
 * Hive Deriv CALL/PUT contracts are fixed-expiry products. A brief negative mark is normal
 * option-price noise and must never trigger an AI panic-close. Only cut a severe loss after
 * the minimum hold period; otherwise let the original contract thesis play out to expiry.
 */
export const DERIV_HIVE_MIN_HOLD_SEC = 60;
export const DERIV_HIVE_MAX_EARLY_LOSS_PCT = 60;
export function derivHiveLossCut(c: { profit: number; stake: number; heldSec: number; canSell: boolean }): boolean {
  if (!c.canSell || !(c.stake > 0) || c.heldSec < DERIV_HIVE_MIN_HOLD_SEC) return false;
  return (c.profit / c.stake) * 100 <= -DERIV_HIVE_MAX_EARLY_LOSS_PCT;
}

/** Deriv scalp rule. Looks at an open contract's current profit against its stake. */
export function derivExit(c: { profit: number; stake: number; canSell: boolean }, cfg: ScalpConfig): { kind: "take" | "cut"; pct: number } | null {
  if (!c.canSell || !(c.stake > 0)) return null;
  const pct = (c.profit / c.stake) * 100;
  if (cfg.derivTakePct > 0 && pct >= cfg.derivTakePct) return { kind: "take", pct };
  if (cfg.derivCutPct > 0 && pct <= -cfg.derivCutPct) return { kind: "cut", pct };
  return null;
}

/**
 * Normal-mode Deriv rule: bank small profits, wait out small dips, never ride a contract to a full-stake loss.
 * worstPct = the lowest profit % of stake seen so far on this contract (0 or negative).
 * elapsedFrac = how much of the contract's life has passed (0 to 1), or null when unknown.
 */
export function derivNormalExit(
  c: { profit: number; stake: number; canSell: boolean; worstPct: number; elapsedFrac: number | null },
  cfg: ScalpConfig,
): { kind: "take" | "bounce" | "cut" | "time"; pct: number } | null {
  if (!c.canSell || !(c.stake > 0)) return null;
  const pct = (c.profit / c.stake) * 100;
  if (cfg.normalTakePct > 0 && pct >= cfg.normalTakePct) return { kind: "take", pct };
  if (cfg.normalCutPct > 0 && pct <= -cfg.normalCutPct) return { kind: "cut", pct };
  if (cfg.normalDipPct > 0 && c.worstPct <= -cfg.normalDipPct && pct >= cfg.normalRecoverPct) return { kind: "bounce", pct };
  if (cfg.normalTimeFrac > 0 && c.elapsedFrac != null && c.elapsedFrac >= cfg.normalTimeFrac) return { kind: "time", pct };
  return null;
}
