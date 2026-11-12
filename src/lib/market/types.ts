export type Mode = "normal" | "aggressive" | "mad";
export type Venue = "paper" | "binance" | "deriv";
export type BinanceEnv = "spot-live" | "spot-demo" | "spot-testnet" | "fut-live" | "fut-demo" | "fut-testnet";
export type BinanceKind = "spot" | "futures";
export type BinanceAccountType = "demo" | "live" | "testnet";
export type Interval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export type Side = "BUY" | "SELL";
export type Action = "BUY" | "SELL" | "WAIT" | "CLOSE" | "REDUCE";

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Plan = {
  entry: number;
  stop: number;
  target: number;
  risk: number;
  rr: number;
};

export const INTERVALS: Interval[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

export const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export const BINANCE_DEFAULTS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "LTCUSDT",
] as const;

export const DERIV_DEFAULTS = [
  { symbol: "frxEURUSD", label: "EURUSD" },
  { symbol: "frxGBPUSD", label: "GBPUSD" },
  { symbol: "frxUSDJPY", label: "USDJPY" },
  { symbol: "frxAUDUSD", label: "AUDUSD" },
  { symbol: "frxUSDCAD", label: "USDCAD" },
  { symbol: "frxXAUUSD", label: "XAUUSD" },
] as const;

export type MarketInfo = {
  symbol: string;
  label: string;
  group: string;
  broker: "binance" | "deriv";
  /** false when the exchange is closed right now (charts still load). */
  open?: boolean;
  /** 24h quote volume, used to rank Binance markets. */
  vol?: number;
};

const REGISTRY = new Map<string, MarketInfo>();

/** Remember the markets the connected brokers returned, so labels and broker lookups work everywhere. */
export function registerMarkets(list: MarketInfo[]) {
  REGISTRY.clear();
  for (const m of list) REGISTRY.set(m.symbol, m);
}

export function marketInfo(symbol: string): MarketInfo | undefined {
  return REGISTRY.get(symbol);
}

export function isDerivSymbol(symbol: string): boolean {
  const m = REGISTRY.get(symbol);
  if (m) return m.broker === "deriv";
  return /^(frx|cry|R_|1HZ|JD|BOOM|CRASH|stp|WLD|OTC_|RDBEAR|RDBULL)/.test(symbol);
}

export type ModeProfile = {
  minScore: number;
  minFamilies: number;
  minNet: number;
  maxOppose: number;
  cooldownSec: number;
  maxPerSymbol: number;
  maxEntriesHour: number;
  minRR: number;
  maxHoldMin: number;
};

export const MODE_PROFILES: Record<Mode, ModeProfile> = {
  normal: {
    minScore: 70,
    minFamilies: 2,
    minNet: 0.35,
    maxOppose: 0,
    cooldownSec: 480,
    maxPerSymbol: 2,
    maxEntriesHour: 4,
    minRR: 1.6,
    maxHoldMin: 240,
  },
  aggressive: {
    minScore: 58,
    minFamilies: 2,
    minNet: 0.22,
    maxOppose: 1,
    cooldownSec: 120,
    maxPerSymbol: 4,
    maxEntriesHour: 12,
    minRR: 1.4,
    maxHoldMin: 120,
  },
  mad: {
    minScore: 48,
    minFamilies: 1,
    minNet: 0.15,
    maxOppose: 1,
    cooldownSec: 45,
    maxPerSymbol: 5,
    maxEntriesHour: 24,
    minRR: 1.25,
    maxHoldMin: 90,
  },
};

export const BINANCE_HOSTS: Record<BinanceEnv, { rest: string; label: string; live: boolean; kind: BinanceKind }> = {
  "spot-live": { rest: "https://api.binance.com", label: "Binance Spot live", live: true, kind: "spot" },
  "spot-demo": { rest: "https://demo-api.binance.com", label: "Binance Spot Demo", live: false, kind: "spot" },
  "spot-testnet": { rest: "https://testnet.binance.vision", label: "Binance Spot Testnet", live: false, kind: "spot" },
  "fut-live": { rest: "https://fapi.binance.com", label: "Binance Futures live", live: true, kind: "futures" },
  "fut-demo": { rest: "https://demo-fapi.binance.com", label: "Binance Futures Demo", live: false, kind: "futures" },
  "fut-testnet": { rest: "https://testnet.binancefuture.com", label: "Binance Futures Testnet", live: false, kind: "futures" },
};

export function isFuturesEnv(env: BinanceEnv): boolean {
  return BINANCE_HOSTS[env]?.kind === "futures";
}

export function binanceEnvOf(account: BinanceAccountType, kind: BinanceKind): BinanceEnv {
  return `${kind === "futures" ? "fut" : "spot"}-${account}` as BinanceEnv;
}

export function envAccount(env: BinanceEnv): BinanceAccountType {
  return env.endsWith("-live") ? "live" : env.endsWith("-testnet") ? "testnet" : "demo";
}
