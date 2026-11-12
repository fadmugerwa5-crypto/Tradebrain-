import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Candle, Interval, Mode, Venue, BinanceEnv, Plan, MarketInfo } from "@/lib/market/types";
import { registerMarkets } from "@/lib/market/types";
import type { AiProvider } from "@/lib/brokers/ai";
import { freshAccount, type BookAccount, type BookPosition } from "@/lib/trade/account";
import { GOAL_DEFAULTS, type GoalConfig, type GoalState } from "@/lib/trade/goal";
import { SCALP_DEFAULTS, type ScalpConfig } from "@/lib/trade/scalp";
import { RADAR_DEFAULTS, type RadarConfig, type RadarView } from "@/lib/trade/radar";
import { SWING_DEFAULTS, type SwingConfig, type SwingPlan } from "@/lib/trade/swing";

export type ViewName = "hive" | "mission" | "markets" | "chart" | "swing" | "book" | "controls" | "journal" | "learn" | "connect" | "intelligence" | "watchtower";

export type SlimDecision = {
  action: string;
  reason: string;
  quality: number;
  regime: string;
  plan: Plan | null;
  modules: { name: string; verdict: string; score: number; why: string }[];
};

export type Settings = {
  mode: Mode;
  interval: Interval;
  venue: Venue;
  binanceEnv: BinanceEnv;
  riskPct: number;
  maxOpenRiskPct: number;
  dailyLossPct: number;
  maxPositions: number;
  maxPerSymbol: number;
  consecLimit: number;
  goal: GoalConfig;
  /** Aggressive mode only: bank small profits, re-scan at once, protect the day's gains. */
  scalp: ScalpConfig;
  /** Scan every market with every strategy, rank the scalp candidates, let the AI pick, and scalp only those. */
  radar: RadarConfig;
  /** The Trades tab: real swing trades held hours to days, with their own limits. Separate from scalping. */
  swing: SwingConfig;
  enabled: string[];
  /** true = every open market of the connected brokers is scanned and traded, including markets Deriv adds later. Switching a single market by hand turns this off. */
  autoAll: boolean;
  chartStyle: "candle" | "line";
  layers: Layers;
  panels: Panels;
  ind: Ind;
  /** If a broker-side stop/target cannot be confirmed after a fill: keep watching locally and stop new entries, or close at market. */
  onProtectFail: "keep-local" | "close";
  /** Binance Futures: leverage applied to each symbol before its first order, and isolated margin so one loss cannot touch the rest of the wallet. */
  leverage: number;
  /** Load size: multiplies the size of every Binance entry (1 = as before, 1.5 = half again as big). The risk limits still apply. */
  lotSize: number;
  isolated: boolean;
  liveUnlock: boolean;
};

export type BrokerConn = {
  status: "idle" | "connecting" | "connected" | "error";
  /** Human label, e.g. "Binance Futures Demo". */
  label: string;
  demo: boolean;
  account: string;
  balance: number | null;
  currency: string;
  at: number;
  markets: number;
  error: string;
};
export const CONN0: BrokerConn = { status: "idle", label: "", demo: true, account: "", balance: null, currency: "USD", at: 0, markets: 0, error: "" };

/** What the Trades tab last found. Not saved. */
export type SwingView = { at: number; tf: string; plan: SwingPlan | null; loaded: number; wanted: number; note: string; error: string };

/** A signal kept so it can be copied to another broker later. */
export type SwingLogItem = { key: string; t: number; symbol: string; label: string; side: "BUY" | "SELL"; strategy: string; entry: number; stop: number; target: number; text: string };

export type AiSlot = "gemini" | "grok" | "other";
export const AI_SLOTS: AiSlot[] = ["gemini", "grok", "other"];
export type AiState = { status: "idle" | "checking" | "ready" | "error"; provider: AiProvider | null; model: string; note: string };
const AI0: AiState = { status: "idle", provider: null, model: "", note: "" };

export type Layers = { plan: boolean; trend: boolean; ema: boolean; bb: boolean; vwap: boolean; levels: boolean; zones: boolean; structure: boolean; liquidity: boolean; prevDay: boolean };
export type Ind = { ema1: number; ema2: number; ema3: number; bbPeriod: number; bbK: number; rsiPeriod: number; macdFast: number; macdSlow: number; macdSignal: number };
export const IND0: Ind = { ema1: 9, ema2: 21, ema3: 0, bbPeriod: 20, bbK: 2, rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9 };
export type Drawing = { id: string; kind: "h" | "t"; a: { t: number; p: number }; b?: { t: number; p: number } };
export type Panels = { rsi: boolean; macd: boolean; volume: boolean; atr: boolean };

export const LAYERS0: Layers = { plan: true, trend: true, ema: true, bb: false, vwap: true, levels: true, zones: true, structure: true, liquidity: true, prevDay: true };
export const PANELS0: Panels = { rsi: true, macd: false, volume: true, atr: false };

type Log = { t: number; level: "info" | "warn" | "bad"; text: string };

type Brain = {
  view: ViewName;
  symbol: string;
  armed: boolean;
  /** Trades tab switch. Separate from the scalper's Arm. Always off after a restart. */
  swingArmed: boolean;
  swingView: SwingView | null;
  /** Last 60 actionable swing signals, newest first. Saved. */
  swingLog: SwingLogItem[];
  lossPause: boolean;
  goalBypass: boolean;
  uncertain: boolean;
  flattenArmed: boolean;
  settings: Settings;
  secrets: { binanceKey: string; binanceSecret: string; geminiKey: string; grokKey: string; otherKey: string; derivToken: string; derivAppId: string };
  /** What each connected broker reported. No connection means no markets and no charts. */
  conn: { binance: BrokerConn; deriv: BrokerConn };
  markets: MarketInfo[];
  ai: Record<AiSlot, AiState>;
  peakEquity: number;
  drawings: Record<string, Drawing[]>;
  /** Real broker balances (Binance) used for sizing and goals when the venue is not paper. */
  broker: null | { cash: number; equity: number; startEquity: number; dayStartEquity: number; dayKey: string; at: number; partial: boolean };
  /** What the engine is actually sizing and measuring goals against right now. */
  sizing: null | { source: "paper" | "binance" | "deriv"; equity: number; cash: number; startEquity: number; dayStartEquity: number; unrealized: number; gs: GoalState };
  /** Last result of each Connect-tab test, so the screen shows real outcomes and not assumptions. */
  tests: Record<string, { ok: boolean; at: number; note: string }>;
  account: BookAccount;
  positions: BookPosition[];
  seen: string[];
  recent: { t: number; symbol: string; price: number; strategy: string }[];
  logs: Log[];
  candles: Record<string, Candle[]>;
  quotes: Record<string, { bid: number | null; ask: number | null; last: number; chg: number | null }>;
  filters: Record<string, { step: number; minNotional: number; status: string }>;
  feedNote: string;
  feedAt: number | null;
  decisions: Record<string, SlimDecision>;
  /** Last sweep of the scalp radar. Not saved. */
  radar: RadarView | null;
  aiText: string;
  aiBusy: boolean;
  diag: null | {
    ready: boolean;
    label: string;
    rest: string;
    steps: { name: string; ok: boolean; detail: string; code?: number; http?: number }[];
    balances: { asset: string; free: number; locked: number }[];
  };
  derivStatus: { status: string; balance: number | null; currency: string; loginid: string; virtual: boolean | null; error: string };
  setMarkets: (markets: MarketInfo[]) => void;
  patchConn: (broker: "binance" | "deriv", p: Partial<BrokerConn>) => void;
  setView: (view: ViewName) => void;
  setSymbol: (symbol: string) => void;
  patchSettings: (p: Partial<Settings>) => void;
  patchSecrets: (p: Partial<Brain["secrets"]>) => void;
  setArmed: (armed: boolean) => void;
  setSwingArmed: (armed: boolean) => void;
  log: (text: string, level?: Log["level"]) => void;
  resetPaper: () => void;
  emergency: () => void;
};

const settings0 = (): Settings => ({
  mode: "normal",
  interval: "15m",
  venue: "paper",
  binanceEnv: "spot-demo",
  riskPct: 0.25,
  maxOpenRiskPct: 1,
  dailyLossPct: 2,
  maxPositions: 8,
  maxPerSymbol: 5,
  consecLimit: 3,
  goal: { ...GOAL_DEFAULTS },
  scalp: { ...SCALP_DEFAULTS },
  radar: { ...RADAR_DEFAULTS },
  swing: { ...SWING_DEFAULTS, strategies: [...SWING_DEFAULTS.strategies] },
  enabled: [],
  autoAll: true,
  chartStyle: "candle",
  layers: { ...LAYERS0 },
  panels: { ...PANELS0 },
  ind: { ...IND0 },
  onProtectFail: "keep-local",
  leverage: 3,
  lotSize: 1,
  isolated: true,
  liveUnlock: false,
});

/** Round-robin across market groups, so any "first N" is a mix of forex, indices, synthetics, crypto... and not one group. */
export function mixByGroup<T extends { group: string }>(list: T[]): T[] {
  const by = new Map<string, T[]>();
  for (const m of list) by.set(m.group, [...(by.get(m.group) ?? []), m]);
  const out: T[] = [];
  const lists = [...by.values()];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export const useBrain = create<Brain>()(
  persist(
    (set) => ({
      view: "hive",
      symbol: "BTCUSDT",
      armed: false,
      swingArmed: false,
      swingView: null,
      swingLog: [],
      lossPause: false,
      goalBypass: false,
      uncertain: false,
      flattenArmed: false,
      settings: settings0(),
      secrets: { binanceKey: "", binanceSecret: "", geminiKey: "", grokKey: "", otherKey: "", derivToken: "", derivAppId: "" },
      conn: { binance: { ...CONN0 }, deriv: { ...CONN0 } },
      markets: [],
      ai: { gemini: { ...AI0 }, grok: { ...AI0 }, other: { ...AI0 } },
      peakEquity: 10_000,
      drawings: {},
      broker: null,
      sizing: null,
      tests: {},
      account: freshAccount(),
      positions: [],
      seen: [],
      recent: [],
      logs: [
        {
          t: Date.now(),
          level: "info",
          text: "Connect a broker on the Connect tab. Markets and charts come from the connected broker. New entries stay off until you arm the engine.",
        },
      ],
      candles: {},
      quotes: {},
      filters: {},
      feedNote: "No broker connected. Open the Connect tab to load markets.",
      feedAt: null,
      decisions: {},
      radar: null,
      aiText: "",
      aiBusy: false,
      diag: null,
      derivStatus: { status: "off", balance: null, currency: "USD", loginid: "", virtual: null, error: "" },
      setMarkets: (markets) => {
        registerMarkets(markets);
        set((s) => {
          const names = new Set(markets.map((m) => m.symbol));
          let enabled = s.settings.enabled.filter((x) => names.has(x));
          // Default: every open market, from every group (forex, commodities, stock indices, synthetics, crypto), not only the first ones in the list.
          if (s.settings.autoAll || !enabled.length) {
            const bin = markets.filter((m) => m.broker === "binance").slice(0, 20).map((m) => m.symbol);
            const der = mixByGroup(markets.filter((m) => m.broker === "deriv" && m.open !== false)).map((m) => m.symbol);
            enabled = [...bin, ...der];
          }
          const symbol = names.has(s.symbol) ? s.symbol : (markets[0]?.symbol ?? s.symbol);
          return { markets, symbol, settings: { ...s.settings, enabled } };
        });
      },
      patchConn: (broker, p) => set((s) => ({ conn: { ...s.conn, [broker]: { ...s.conn[broker], ...p } } })),
      setView: (view) => set({ view }),
      setSymbol: (symbol) => set({ symbol, view: "chart" }),
      patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      patchSecrets: (p) => set((s) => ({ secrets: { ...s.secrets, ...p } })),
      setArmed: (armed) => set({ armed }),
      setSwingArmed: (swingArmed) => set({ swingArmed }),
      log: (text, level = "info") =>
        set((s) => ({ logs: [{ t: Date.now(), level, text }, ...s.logs].slice(0, 80) })),
      resetPaper: () =>
        set({
          account: freshAccount(),
          positions: [],
          seen: [],
          recent: [],
          lossPause: false,
          goalBypass: false,
          uncertain: false,
          armed: false,
          swingArmed: false,
          peakEquity: 10_000,
          broker: null,
          sizing: null,
        }),
      emergency: () => set({ armed: false, swingArmed: false }),
    }),
    {
      name: "brain-ultimate-v1",
      skipHydration: true,
      partialize: (s) => ({
        symbol: s.symbol,
        lossPause: s.lossPause,
        goalBypass: s.goalBypass,
        settings: { ...s.settings, liveUnlock: false },
        secrets: s.secrets,
        ai: s.ai,
        peakEquity: s.peakEquity,
        drawings: s.drawings,
        account: s.account,
        positions: s.positions,
        seen: s.seen.slice(-400),
        recent: s.recent.slice(-200),
        swingLog: s.swingLog.slice(0, 60),
        logs: s.logs.slice(0, 40),
      }),
      // Older saves lack newer settings. Fill gaps from defaults instead of leaving them undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Brain> & { settings?: Partial<Settings> & { goalAmount?: number } };
        const base = settings0();
        const old = p.settings ?? {};
        // Saves from v31/v32 hold the old default thresholds and the original five strategies: move those to the current defaults.
        const savedSwing = old.swing;
        const oldDefaults = savedSwing != null && savedSwing.minTrades === 10 && savedSwing.minEdge === 0.1;
        const oldFive = ["orb", "pdhl-fade", "sigma-band", "avwap-trend", "trend-break"];
        const sv: string[] | undefined = savedSwing?.strategies;
        const oldSwingStrategies: string[] | undefined = sv && sv.length === 5 && oldFive.every((id) => sv.includes(id)) ? undefined : sv;
        const settings: Settings = {
          ...base,
          ...old,
          goal: { ...base.goal, ...(old.goal ?? {}), ...(old.goal == null && typeof old.goalAmount === "number" ? { session: old.goalAmount } : {}) },
          // Saves from before v28 had no strictness setting: move them to the relaxed AI (follow the rules if the AI is down, wait longer for it).
          scalp: { ...base.scalp, ...(old.scalp ?? {}), ...(old.scalp && old.scalp.aiStrict === undefined ? { aiOnFail: "rules" as const, aiTimeoutSec: Math.max(10, old.scalp.aiTimeoutSec ?? 10) } : {}), ...(old.scalp?.normalTimeFrac === 0.7 ? { normalTimeFrac: 0 } : {}), ...(old.scalp?.normalCutPct === 35 ? { normalCutPct: 50 } : {}) },
          // Saves from before v37 hold the old radar numbers (top 4, AI looks at 8): move them to the new shortlist of 5 and the new warm-up and safety settings.
          radar: { ...base.radar, ...(old.radar ?? {}), ...(old.radar && old.radar.perGroup === undefined ? { top: base.radar.top, aiList: base.radar.aiList } : {}) },
          swing: { ...base.swing, ...(old.swing ?? {}), ...(oldDefaults ? { minTrades: base.swing.minTrades, minEdge: base.swing.minEdge } : {}), strategies: Array.isArray(oldSwingStrategies) ? oldSwingStrategies : base.swing.strategies },
          layers: { ...base.layers, ...(old.layers ?? {}) },
          panels: { ...base.panels, ...(old.panels ?? {}) },
          ind: { ...base.ind, ...(old.ind ?? {}) },
        };
        // Older saves had one AI key box. Route it to the right slot by its prefix.
        const oldSecrets = (p.secrets ?? {}) as Record<string, string>;
        const secrets = { ...current.secrets, ...oldSecrets } as Brain["secrets"];
        const legacy = oldSecrets.aiKey;
        if (legacy && !secrets.geminiKey && /^(AIza|AQ\.)/.test(legacy)) secrets.geminiKey = legacy;
        else if (legacy && !secrets.grokKey && /^xai-/.test(legacy)) secrets.grokKey = legacy;
        else if (legacy && !secrets.otherKey) secrets.otherKey = legacy;
        delete (secrets as Record<string, unknown>).aiKey;
        const pa = (p.ai ?? {}) as Partial<Record<AiSlot, AiState>>;
        const ai = Object.fromEntries(AI_SLOTS.map((k) => [k, { ...AI0, ...(pa[k] ?? {}), status: pa[k]?.status === "ready" ? "ready" : "idle" }])) as Record<AiSlot, AiState>;
        return { ...current, ...p, settings, secrets, ai } as Brain;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.armed = false;
          state.swingArmed = false;
        }
      },
    },
  ),
);
