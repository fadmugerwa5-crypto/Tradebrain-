// Everything runs inside the app now. No server: these used to be server functions.
// The call shape fn({ data }) is kept so the screens did not have to change.
import { isFuturesEnv, type BinanceEnv } from "../market/types.ts";
import {
  accountBalances,
  cancelFuturesProtection,
  cancelProtection,
  diagnoseBinance,
  discoverBinance,
  futuresProtectionStatus,
  futuresSetup,
  placeFuturesOrder,
  placeFuturesProtection,
  placeMarketOrder,
  placeProtection,
  probeEnvs,
  protectionStatus,
  publicMarket,
  signTradfiAgreement,
  testOrder,
} from "./market.ts";

function asEnv(v: unknown): BinanceEnv {
  if (v === "spot-live" || v === "spot-demo" || v === "spot-testnet" || v === "fut-live" || v === "fut-demo" || v === "fut-testnet") return v;
  throw new Error("Unknown Binance environment.");
}

type Creds = { env: BinanceEnv; apiKey: string; secret: string };
const creds = (input: Creds): Creds => ({ env: asEnv(input?.env), apiKey: String(input?.apiKey ?? ""), secret: String(input?.secret ?? "") });

export async function marketData({ data }: { data: { op: "klines" | "tickers" | "books" | "exchangeInfo" | "time"; env: BinanceEnv; symbol?: string; interval?: string; symbols?: string[]; limit?: number } }) {
  return publicMarket({ ...data, env: asEnv(data?.env) });
}

export async function binanceDiagnose({ data }: { data: Creds }) {
  return diagnoseBinance(creds(data));
}

/** Validates the key, signature, permissions, symbol and lot size through Binance's order/test endpoint. Nothing is placed. */
export async function binanceTestOrder({ data }: { data: Creds & { symbol: string } }) {
  return testOrder({ ...creds(data), symbol: String(data?.symbol ?? "BTCUSDT") });
}

export async function binanceBalances({ data }: { data: Creds }) {
  return accountBalances(creds(data));
}

export async function binanceProtect({ data }: { data: Creds & { symbol: string; quantity: number; stop: number; target: number; tick: number; clientId: string } }) {
  return placeProtection({
    ...creds(data),
    symbol: String(data?.symbol ?? ""),
    quantity: Number(data?.quantity),
    stop: Number(data?.stop),
    target: Number(data?.target),
    tick: Number(data?.tick),
    clientId: String(data?.clientId ?? ""),
  });
}

export async function binanceUnprotect({ data }: { data: Creds & { symbol: string; orderListId: string } }) {
  return cancelProtection({ ...creds(data), symbol: String(data?.symbol ?? ""), orderListId: String(data?.orderListId ?? "") });
}

export async function binanceProtectionStatus({ data }: { data: Creds & { symbol: string; orderListId: string } }) {
  return protectionStatus({ ...creds(data), symbol: String(data?.symbol ?? ""), orderListId: String(data?.orderListId ?? "") });
}

export async function binanceOrder({ data }: { data: Creds & { symbol: string; side: "BUY" | "SELL"; quantity: number; clientId: string; confirm: string; reduceOnly?: boolean } }) {
  if (data?.confirm !== "PLACE") throw new Error("Order confirmation missing.");
  if (isFuturesEnv(asEnv(data.env))) {
    return placeFuturesOrder({
      ...creds(data),
      symbol: String(data.symbol ?? ""),
      side: data.side === "SELL" ? ("SELL" as const) : ("BUY" as const),
      quantity: Number(data.quantity),
      clientId: String(data.clientId ?? ""),
      reduceOnly: data.reduceOnly === true,
    });
  }
  return placeMarketOrder({
    ...creds(data),
    symbol: String(data.symbol ?? ""),
    side: data.side === "SELL" ? ("SELL" as const) : ("BUY" as const),
    quantity: Number(data.quantity),
    clientId: String(data.clientId ?? ""),
  });
}

export async function binanceSignTradfi({ data }: { data: Creds }) {
  return signTradfiAgreement(creds(data));
}

export async function binanceDiscover({ data }: { data: { env: BinanceEnv } }) {
  return discoverBinance({ env: asEnv(data?.env) });
}

export async function binanceProbe({ data }: { data: { apiKey: string; secret: string } }) {
  return probeEnvs(String(data?.apiKey ?? ""), String(data?.secret ?? ""));
}

export async function futuresPrepare({ data }: { data: Creds & { symbol: string; leverage: number; isolated: boolean } }) {
  return futuresSetup({ ...creds(data), symbol: String(data?.symbol ?? ""), leverage: Number(data?.leverage), isolated: data?.isolated !== false });
}

export async function futuresProtect({ data }: { data: Creds & { symbol: string; side: "BUY" | "SELL"; stop: number; target: number; tick: number; clientId: string } }) {
  return placeFuturesProtection({
    ...creds(data),
    symbol: String(data?.symbol ?? ""),
    side: data?.side === "SELL" ? ("SELL" as const) : ("BUY" as const),
    stop: Number(data?.stop),
    target: Number(data?.target),
    tick: Number(data?.tick),
    clientId: String(data?.clientId ?? ""),
  });
}

export async function futuresUnprotect({ data }: { data: Creds & { symbol: string; algoIds: string[] } }) {
  return cancelFuturesProtection({ ...creds(data), symbol: String(data?.symbol ?? ""), algoIds: (data?.algoIds ?? []).map(String) });
}

export async function futuresStatus({ data }: { data: Creds & { symbol: string; side: "BUY" | "SELL"; openedAt: number; algoIds: string[] } }) {
  return futuresProtectionStatus({
    ...creds(data),
    symbol: String(data?.symbol ?? ""),
    side: data?.side === "SELL" ? ("SELL" as const) : ("BUY" as const),
    openedAt: Number(data?.openedAt),
    algoIds: (data?.algoIds ?? []).map(String),
  });
}

export { askAI, detectAI } from "./ai.ts";
