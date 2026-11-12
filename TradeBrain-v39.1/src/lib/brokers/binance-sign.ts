/** HMAC-SHA256 hex via WebCrypto (works in the Android WebView, Electron and Node, no node:crypto). */
export async function signQuery(secret: string, query: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(query));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function explainBinanceError(code: number | undefined, msg: string, envLabel: string): string {
  switch (code) {
    case -2015:
      return `Invalid API key, IP, or permissions on ${envLabel}. Demo keys only work on the demo hosts (demo-api.binance.com for Spot, demo-fapi.binance.com for Futures), Testnet keys only on testnet.binance.vision (Spot) or testnet.binancefuture.com (Futures), and live keys only on the live hosts. Check the key has no IP restriction (a phone IP changes) and that trading is ticked. Do not enable withdrawals.`;
    case -1022:
      return "Invalid signature. The secret does not match this API key.";
    case -1021:
      return "Timestamp outside the receive window, even after syncing to Binance server time.";
    case -2010:
      return msg || "Order rejected. Often insufficient balance or a filter on the symbol.";
    case -1121:
      return "Invalid symbol for this environment.";
    case -1013:
      return msg || "Filter failure: quantity, price, or notional is outside the symbol rules.";
    case -2019:
      return "Margin is insufficient for this order. Lower the risk per entry or the leverage, or add demo funds.";
    case -4164:
      return msg || "Order notional is below the symbol minimum.";
    case -1111:
      return msg || "Quantity or price has more decimals than this symbol allows.";
    case -4061:
      return "Position mode mismatch (hedge vs one-way). Check the position mode in Binance Futures settings.";
    case -2021:
      return msg || "The stop or target would trigger immediately at the current price.";
    case -1003:
      return "Rate limit. Wait before retrying.";
    case -2011:
      return "Unknown order. It may already be filled or canceled.";
    default:
      return msg || "Binance rejected the request.";
  }
}

export type SymbolFilter = {
  step: number;
  minQty: number;
  minNotional: number;
  tick: number;
  status: string;
};

export function readFilters(symbol: {
  status?: string;
  filters?: { filterType: string; stepSize?: string; minQty?: string; minNotional?: string; notional?: string; tickSize?: string }[];
}): SymbolFilter {
  const filters = symbol.filters ?? [];
  const lot = filters.find((f) => f.filterType === "LOT_SIZE");
  const notion = filters.find((f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL");
  const price = filters.find((f) => f.filterType === "PRICE_FILTER");
  return {
    step: Number(lot?.stepSize ?? "0.000001") || 0.000001,
    minQty: Number(lot?.minQty ?? "0") || 0,
    minNotional: Number(notion?.minNotional ?? notion?.notional ?? "5") || 5,
    tick: Number(price?.tickSize ?? "0.01") || 0.01,
    status: symbol.status ?? "UNKNOWN",
  };
}

export { cleanCredential, credentialShape, maskCredential, roundToTick } from "./creds.ts";
