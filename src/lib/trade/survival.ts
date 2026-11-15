import { atrSeries, ema } from "../market/indicators.ts";
import type { Candle } from "../market/types.ts";

export type SurvivalState = "INSUFFICIENT_DATA" | "NORMAL_PULLBACK" | "THESIS_INTACT" | "THESIS_INVALIDATED" | "PROFIT_GIVEBACK_RISK";
export type SurvivalSnapshot = {
  state: SurvivalState;
  currentR: number;
  maxFavorableR: number;
  maxAdverseR: number;
  atr: number | null;
  stopDistanceAtr: number | null;
  structureLevel: number | null;
  reason: string;
  /** AI may be consulted only when a meaningful exit condition is present. */
  reviewWithAI: boolean;
};

export type SurvivalInput = {
  side: "BUY" | "SELL";
  entry: number;
  stop: number;
  price: number;
  high: number;
  low: number;
  candles: Candle[];
};

const finite = (n: number) => Number.isFinite(n) && n > 0;

/**
 * Pullback-aware position monitor. It never widens or disables the original stop.
 * Only completed candles are used for structural confirmation (the newest candle is treated as live).
 */
export function evaluateTradeSurvival(input: SurvivalInput): SurvivalSnapshot {
  const risk = Math.abs(input.entry - input.stop);
  const dir = input.side === "BUY" ? 1 : -1;
  const currentR = risk > 0 ? ((input.price - input.entry) * dir) / risk : 0;
  const maxFavorableR = risk > 0 ? Math.max(0, ((input.side === "BUY" ? input.high - input.entry : input.entry - input.low) / risk)) : 0;
  const maxAdverseR = risk > 0 ? Math.max(0, ((input.side === "BUY" ? input.entry - input.low : input.high - input.entry) / risk)) : 0;
  const closed = input.candles.length > 1 ? input.candles.slice(0, -1) : [];
  if (!(risk > 0) || !finite(input.price) || closed.length < 24) {
    return { state: "INSUFFICIENT_DATA", currentR, maxFavorableR, maxAdverseR, atr: null, stopDistanceAtr: null, structureLevel: null, reason: "Not enough completed candles or valid stop distance; keep the original protective stop and do not make an AI early exit.", reviewWithAI: false };
  }

  const atrValues = atrSeries(closed, 14);
  const atr = atrValues[atrValues.length - 1] ?? null;
  const closes = closed.map((c) => c.c);
  const ema21 = ema(closes, 21);
  const eNow = ema21[ema21.length - 1] ?? null;
  const ePrev = ema21[ema21.length - 4] ?? null;
  const last = closed.slice(-3);
  const previousSwing = closed.slice(-8, -3);
  const structureLevel = previousSwing.length ? (input.side === "BUY" ? Math.min(...previousSwing.map((c) => c.l)) : Math.max(...previousSwing.map((c) => c.h))) : null;
  const twoClosesAgainst = last.length >= 2 && (input.side === "BUY"
    ? last.slice(-2).every((c) => c.c < (eNow ?? c.c))
    : last.slice(-2).every((c) => c.c > (eNow ?? c.c)));
  const emaTurningAgainst = eNow != null && ePrev != null && (input.side === "BUY" ? eNow < ePrev : eNow > ePrev);
  const brokeStructure = structureLevel != null && (input.side === "BUY"
    ? last[last.length - 1]!.c < structureLevel && last[last.length - 2]!.c < structureLevel
    : last[last.length - 1]!.c > structureLevel && last[last.length - 2]!.c > structureLevel);
  const thesisInvalidated = brokeStructure && twoClosesAgainst && emaTurningAgainst;
  const oppositeMomentum = last.length >= 2 && (input.side === "BUY"
    ? last.slice(-2).every((c) => c.c < c.o)
    : last.slice(-2).every((c) => c.c > c.o));
  const gaveBack = maxFavorableR >= 1 && currentR <= 0.15 && oppositeMomentum;
  const stopDistanceAtr = atr && atr > 0 ? risk / atr : null;

  if (thesisInvalidated) {
    return { state: "THESIS_INVALIDATED", currentR, maxFavorableR, maxAdverseR, atr, stopDistanceAtr, structureLevel, reason: `Two completed closes broke the recent ${input.side === "BUY" ? "swing low" : "swing high"}, with EMA21 turning against the position.`, reviewWithAI: true };
  }
  if (gaveBack) {
    return { state: "PROFIT_GIVEBACK_RISK", currentR, maxFavorableR, maxAdverseR, atr, stopDistanceAtr, structureLevel, reason: `The trade reached ${maxFavorableR.toFixed(2)}R in open profit and gave most of it back with two opposite candles.`, reviewWithAI: true };
  }
  if (currentR < 0) {
    return { state: "NORMAL_PULLBACK", currentR, maxFavorableR, maxAdverseR, atr, stopDistanceAtr, structureLevel, reason: "Price is temporarily against the entry, but confirmed structure has not invalidated the original thesis. Hold and keep the original stop active.", reviewWithAI: false };
  }
  return { state: "THESIS_INTACT", currentR, maxFavorableR, maxAdverseR, atr, stopDistanceAtr, structureLevel, reason: "The original trade thesis remains intact. Continue managing the existing stop and target.", reviewWithAI: false };
}

/** A stop-width diagnostic only; it never moves a stop or increases account risk. */
export function stopQualityNote(snapshot: SurvivalSnapshot, style: "scalp" | "trader"): string {
  if (snapshot.stopDistanceAtr == null) return "Stop-width check unavailable until ATR data is loaded.";
  const floor = style === "scalp" ? 0.55 : 0.8;
  return snapshot.stopDistanceAtr < floor
    ? `Initial stop is relatively tight (${snapshot.stopDistanceAtr.toFixed(2)} ATR; reference floor ${floor.toFixed(2)} ATR). Do not widen it after entry; review entry quality and size on future setups.`
    : `Initial stop width is ${snapshot.stopDistanceAtr.toFixed(2)} ATR.`;
}
