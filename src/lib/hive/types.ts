// HIVE: a colony of AI agents that trade together. Plain types shared by the logic and the screen.

import type { Interval } from "../market/types.ts";

export type AgentId = "scout" | "trend" | "scalper" | "regime" | "pulse" | "risk" | "watchdog" | "executor" | "journal" | "coach" | "master";
export type Vote = "BUY" | "SELL" | "WAIT";
/** Per-brain API budget. Each brain keeps its own key and its own independent limits. */
export type AgentBudgetPolicy = { enabled: boolean; dailyCalls: number; perMinute: number; cooldownSec: number; cacheSec: number; maxInputChars: number; maxOutputTokens: number };
export type AgentUsage = { day: string; calls: number; cached: number; blocked: number; errors: number; stamps: number[]; lastAt: number };
export type AgentMemory = { id: string; t: number; symbol: string; result: "right" | "wrong"; r: number; text: string };

export const AGENT_BUDGET_DEFAULTS: Record<AgentId, AgentBudgetPolicy> = {
  scout: { enabled: true, dailyCalls: 80, perMinute: 4, cooldownSec: 10, cacheSec: 18, maxInputChars: 4200, maxOutputTokens: 350 },
  trend: { enabled: true, dailyCalls: 80, perMinute: 4, cooldownSec: 10, cacheSec: 15, maxInputChars: 4200, maxOutputTokens: 300 },
  scalper: { enabled: true, dailyCalls: 70, perMinute: 4, cooldownSec: 8, cacheSec: 8, maxInputChars: 4200, maxOutputTokens: 350 },
  regime: { enabled: true, dailyCalls: 60, perMinute: 3, cooldownSec: 15, cacheSec: 25, maxInputChars: 4200, maxOutputTokens: 280 },
  pulse: { enabled: true, dailyCalls: 80, perMinute: 5, cooldownSec: 8, cacheSec: 5, maxInputChars: 3800, maxOutputTokens: 250 },
  risk: { enabled: true, dailyCalls: 60, perMinute: 4, cooldownSec: 8, cacheSec: 0, maxInputChars: 4200, maxOutputTokens: 250 },
  watchdog: { enabled: false, dailyCalls: 0, perMinute: 0, cooldownSec: 0, cacheSec: 0, maxInputChars: 0, maxOutputTokens: 0 },
  executor: { enabled: true, dailyCalls: 60, perMinute: 3, cooldownSec: 12, cacheSec: 0, maxInputChars: 4200, maxOutputTokens: 300 },
  journal: { enabled: true, dailyCalls: 35, perMinute: 2, cooldownSec: 20, cacheSec: 90, maxInputChars: 3000, maxOutputTokens: 220 },
  coach: { enabled: true, dailyCalls: 12, perMinute: 1, cooldownSec: 120, cacheSec: 180, maxInputChars: 3500, maxOutputTokens: 280 },
  master: { enabled: true, dailyCalls: 50, perMinute: 3, cooldownSec: 12, cacheSec: 0, maxInputChars: 4800, maxOutputTokens: 300 },
};

export const EMPTY_AGENT_USAGE: AgentUsage = { day: "", calls: 0, cached: 0, blocked: 0, errors: 0, stamps: [], lastAt: 0 };

export type AgentKind = "analyst" | "risk" | "executor" | "support" | "builtin";

export type AgentSpec = {
  id: AgentId;
  name: string;
  /** One line shown on the card. */
  role: string;
  color: string;
  kind: AgentKind;
  /** What this agent is told to do (the shared rules and the JSON shape are added around it). */
  job: string;
};

/** One agent's answer in a round. */
export type AgentReply = {
  agent: AgentId;
  ok: boolean;
  error?: string;
  vote: Vote;
  confidence: number;
  note: string;
  /** Scout: the market it wants the colony to look at. */
  pick?: string | null;
  /** Scalper / Executor: price levels. */
  entry?: number;
  stop?: number;
  target?: number;
  /** Risk Guard. */
  approve?: boolean;
  sizeMult?: number;
  at: number;
  ms: number;
};

export type Brief = {
  symbol: string;
  label: string;
  group: string;
  price: number;
  spreadPct: number | null;
  atr: number;
  atrPct: number;
  changePct: number;
  rsi: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  adx: number | null;
  pdi: number | null;
  mdi: number | null;
  efficiency: number | null;
  bbPos: number | null;
  volRatio: number | null;
  rangeHigh: number;
  rangeLow: number;
  /** Last candles, oldest first: [open, high, low, close]. */
  tail: number[][];
  candles: number;
  ageSec: number;
  canShort: boolean;
  /** How promising the numbers look. Only used to pick who the Scout sees first. */
  rank: number;
};

export type AccountView = {
  equity: number;
  cash: number;
  openPositions: number;
  openSymbols: string[];
  dayPnl: number;
  recent: string[];
  venue: string;
  style: Style;
  currency: string;
};

/** Scalp = seconds to minutes on 1-5 minute candles. Trader = ordinary trading: hours to days on hourly candles. */
export type Style = "scalp" | "trader";
/** One desk per connected broker. Deriv always scalps; Binance trades (or scalps if you switch it). */
export type DeskVenue = "deriv" | "binance";

export type StyleCfg = {
  interval: Interval;
  /** Seconds between colony rounds on a desk with this style. */
  roundSec: number;
  /** Seconds between the Executor's check on an open trade. */
  manageSec: number;
  /** Risk taken per trade, percent of the desk's equity. The Risk Guard may shrink it, never grow it. */
  riskPct: number;
  /** Most positions one desk may hold at once. */
  maxOpen: number;
  /** Analysts that must agree on a direction. */
  minAgree: number;
  /** Average confidence (0-100) of the agreeing analysts. */
  minConfidence: number;
  /** Seconds to wait after a losing trade before the next entry on that desk. */
  cooldownSec: number;
  /** Reward to risk used when an agent gives no target. */
  defaultRR: number;
};

export type RoundConfig = Pick<StyleCfg, "minAgree" | "minConfidence" | "defaultRR">;

export type HiveConfig = {
  /** How many shortlisted markets the Scout sees. */
  shortlist: number;
  /** Stop opening trades on a desk after losing this percent of its day's starting equity. */
  dailyLossPct: number;
  /** Most AI calls per minute across all agents. */
  callsPerMin: number;
  scalp: StyleCfg;
  trader: StyleCfg;
};

export const STYLE_DEFAULTS: Record<Style, StyleCfg> = {
  scalp: { interval: "1m", roundSec: 45, manageSec: 20, riskPct: 0.5, maxOpen: 3, minAgree: 3, minConfidence: 60, cooldownSec: 60, defaultRR: 1.5 },
  trader: { interval: "1h", roundSec: 300, manageSec: 120, riskPct: 1, maxOpen: 3, minAgree: 3, minConfidence: 65, cooldownSec: 900, defaultRR: 2.5 },
};

export const HIVE_DEFAULTS: HiveConfig = {
  shortlist: 5,
  dailyLossPct: 3,
  callsPerMin: 40,
  scalp: { ...STYLE_DEFAULTS.scalp },
  trader: { ...STYLE_DEFAULTS.trader },
};

/** What the person chose for one desk. */
export type DeskPref = { on: boolean; style: Style; /** Practice: orders are simulated on the real prices. */ sim: boolean };
export const DESK_DEFAULTS: Record<DeskVenue, DeskPref> = {
  deriv: { on: true, style: "scalp", sim: false },
  binance: { on: true, style: "trader", sim: false },
};

export type Lesson = {
  id: string;
  t: number;
  symbol: string;
  side: "BUY" | "SELL";
  style: Style;
  desk: DeskVenue;
  /** Result in multiples of the planned risk. */
  r: number;
  tags: string[];
  /** What to do differently (or keep doing). */
  text: string;
  right: AgentId[];
  wrong: AgentId[];
};

export type Decision =
  | { action: "WAIT"; reason: string }
  | { action: "BUY" | "SELL"; entry: number; stop: number; target: number; confidence: number; sizeMult: number; reason: string };

export type RoundResult = {
  symbol: string | null;
  replies: AgentReply[];
  decision: Decision;
  tally: { buy: number; sell: number; wait: number; avgBuy: number; avgSell: number; used: number };
  /** Lines for the colony feed, in order. */
  chatter: { agent: AgentId; text: string }[];
};
