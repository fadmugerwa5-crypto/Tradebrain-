import type { Side } from "../market/types.ts";

/** Everything the Learning Brain stores or decides is typed here. There is deliberately NO risk setting anywhere in these types:
 *  the learning layer can restrict or disable setups, it has no field with which it could raise risk, size or limits. */

export type Regime = "trend-up" | "trend-down" | "range" | "squeeze" | "vol-expansion" | "unclear";
export type Bias = "up" | "down" | "flat" | "unknown";
export type Align = "with" | "against" | "neutral" | "unknown";
export type Session = "asia" | "london" | "overlap" | "newyork" | "late";
export type Structure = "hh-hl" | "lh-ll" | "mixed" | "unknown";
export type AiReview = "reviewed" | "rules-only" | "ai-unavailable";
export type AccountMode = "paper" | "demo" | "live";
export type ExitKind = "stop" | "target" | "time" | "manual" | "broker" | "other";

export const STRATEGY_VERSION = "v33";

/** Facts known at the moment of the signal, using closed candles only. */
export type ContextSnapshot = {
  regime: Regime;
  regimeWhy: string;
  htfMin: number;
  htfBias: Bias;
  htfWhy: string;
  align: Align;
  structure: Structure;
  adx: number | null;
  atrPct: number | null;
  atrRank: number | null;
  bbwRank: number | null;
  /** Distance of the entry from the 21 EMA, in ATR, signed in the trade direction (positive = chasing). */
  extensionAtr: number | null;
  /** Stop distance in ATR. */
  stopAtr: number | null;
  spreadPct: number | null;
  /** Open time of the last fully closed candle used. */
  candleTime: number | null;
  tfMin: number;
};

export type TradeRecord = {
  id: string;
  openedAt: number;
  closedAt: number;
  symbol: string;
  label: string;
  venue: "paper" | "binance" | "deriv";
  mode: AccountMode;
  book: "scalp" | "swing";
  side: Side;
  strategy: string;
  strategyVersion: string;
  entry: number;
  stop: number;
  target: number;
  exit: number | null;
  qty: number;
  fees: number;
  /** Net result in account currency, as the app recorded it. */
  pnl: number;
  /** What was at risk at the stop, in account currency. */
  riskUnit: number;
  /** Net result in R (pnl / riskUnit). null when the risk unit is unknown. */
  r: number | null;
  exitReason: string;
  exitKind: ExitKind;
  session: Session;
  holdMin: number;
  ai: AiReview;
  aiNote: string;
  /** Learning configuration that was active when the trade opened. */
  configVersion: string;
  /** Signal-time context. null for trades recorded before v34 (no snapshot exists for them). */
  ctx: ContextSnapshot | null;
  backfilled: boolean;
};

/** An attribute filter. A trade matches when every attribute that is set equals the trade's. */
export type SegmentSpec = { strategy?: string; symbol?: string; regime?: Regime; session?: Session; side?: Side; align?: Align };

export type RuleAction = "restrict" | "disable";
export type Rule = {
  id: string;
  spec: SegmentSpec;
  /** restrict = only allowed when the higher-timeframe bias is with the trade, and ranked lower. disable = no entries in this segment. */
  action: RuleAction;
  source: "learned" | "user";
  candidateId?: string;
  note: string;
  createdAt: number;
};

/** Entry-validator switches. All off by default, so v34 behaves like v33 until the user turns something on. */
export type Filters = {
  /** off = only record the bias. block = no trade against the higher-timeframe bias. */
  htf: "off" | "block";
  /** No new entries while the regime is unclear or in a volatility expansion. */
  standAside: boolean;
  /** No entries when the live spread is wider than this percent (0 = off). */
  maxSpreadPct: number;
};
export const FILTERS0: Filters = { htf: "off", standAside: false, maxSpreadPct: 0 };

export type ConfigVersion = {
  id: string;
  createdAt: number;
  source: "baseline" | "learned" | "user" | "rollback";
  note: string;
  parent: string | null;
  rules: Rule[];
  filters: Filters;
};

export type CandidateStatus = "watch" | "shadow" | "ready" | "approved" | "rejected";
export type Slice = { n: number; exp: number; win: number };
export type Candidate = {
  id: string;
  createdAt: number;
  spec: SegmentSpec;
  label: string;
  action: RuleAction;
  status: CandidateStatus;
  reason: string;
  /** Evidence that produced the proposal. */
  train: Slice | null;
  validation: Slice | null;
  baselineValidation: Slice | null;
  filteredValidation: Slice | null;
  /** Trades that matched the segment after the candidate passed validation (not used to create it). */
  shadow: { start: number; rs: number[] };
  decidedAt?: number;
};

export type LearnSettings = {
  learning: boolean;
  pauseSignals: boolean;
  /** Higher-timeframe used for the bias, in minutes (the doc's default experiment is 15m context). */
  htfMin: number;
  /** Fewest independent observations before a pattern is trusted. */
  minSample: number;
  /** Fewest out-of-sample observations of the segment required to confirm it. */
  minValidate: number;
  /** Fewest shadow observations before a candidate can be approved. */
  shadowMin: number;
};
export const LEARN0: LearnSettings = { learning: true, pauseSignals: false, htfMin: 15, minSample: 30, minValidate: 10, shadowMin: 10 };

export type LearnEvent = { t: number; kind: "observe" | "propose" | "validate" | "shadow" | "approve" | "reject" | "rollback" | "user" | "system"; text: string; evidence?: string; version?: string };

export type Cause = { category: "market" | "setup" | "timing" | "risk" | "execution" | "fit" | "system"; text: string; evidence: string; confidence: "low" | "medium" };
export type Analysis = { id: string; at: number; outcome: "win" | "loss" | "flat"; causes: Cause[]; unknown: boolean; summary: string };
