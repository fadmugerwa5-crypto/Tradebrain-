import { BINANCE_HOSTS, INTERVALS, isFuturesEnv, type BinanceEnv, type Interval, type MarketInfo } from "../market/types.ts";
import { explainBinanceError, readFilters, signQuery } from "./binance-sign.ts";
import { cleanCredential, credentialShape, roundToTick } from "./creds.ts";

const SYMBOL = /^[A-Z0-9]{5,20}$/;

function host(env: BinanceEnv) {
  const h = BINANCE_HOSTS[env];
  if (!h) throw new Error("Unknown Binance environment.");
  return h;
}

/** Plain-language reason for a request that never got an answer. */
export function networkReason(err: unknown, hostName: string): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return `${hostName} request timed out. Check the internet connection or try again.`;
  return `Could not reach ${hostName}. Check the internet connection. If you are on a VPN or in a region where Binance is blocked, switch it off or change it.`;
}

async function getText(url: string, headers?: Record<string, string>, ms = 12_000, method: "GET" | "POST" | "DELETE" = "GET") {
  let res: Response;
  try {
    res = await fetch(url, { method, headers, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    throw new Error(networkReason(err, new URL(url).host));
  }
  const text = await res.text();
  return { res, text };
}

/** Binance answers HTTP 451 / 403 with an HTML or empty body when the region or IP is blocked. */
function blocked(http: number): string | null {
  if (http === 451) return "Binance refused the request from this region or IP (HTTP 451). Use a different network or VPN location.";
  if (http === 403) return "The request was blocked (HTTP 403). The IP or region may be restricted by Binance or a firewall.";
  return null;
}

const API = (env: BinanceEnv) => (isFuturesEnv(env) ? "/fapi/v1" : "/api/v3");

type Signed = { ok: true; body: Record<string, unknown>; http: number } | { ok: false; http: number; code?: number; msg: string };

/** One signed Binance call. Trading endpoints must be POST/DELETE; reads are GET. Server time is used for the timestamp. */
async function signedCall(
  env: BinanceEnv,
  creds: { apiKey: string; secret: string },
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string>,
): Promise<Signed> {
  const info = host(env);
  const key = cleanCredential(creds.apiKey).value;
  const secret = cleanCredential(creds.secret).value;
  const time = await publicMarket({ op: "time", env });
  const q = new URLSearchParams({ ...params, timestamp: String(time.serverTime), recvWindow: "5000" });
  q.set("signature", await signQuery(secret, q.toString()));
  const { res, text } = await getText(`${info.rest}${path}?${q.toString()}`, { "X-MBX-APIKEY": key }, 12_000, method);
  const body = parseJson(text) as Record<string, unknown>;
  const code = typeof body.code === "number" ? body.code : undefined;
  if (!res.ok || code) {
    return { ok: false, http: res.status, code, msg: explainBinanceError(code, String(body.msg ?? `HTTP ${res.status}`), info.label) };
  }
  return { ok: true, body, http: res.status };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { msg: text.slice(0, 180) };
  }
}

const exchangeInfoCache = new Map<string, { at: number; body: unknown }>();

async function futuresExchangeInfo(base: string) {
  const hit = exchangeInfoCache.get(base);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.body as { symbols?: FuturesSymbol[] };
  const { res, text } = await getText(`${base}/fapi/v1/exchangeInfo`, undefined, 20_000);
  const body = parseJson(text) as { symbols?: FuturesSymbol[]; msg?: string };
  if (!res.ok || !body.symbols) throw new Error(blocked(res.status) || body.msg || `exchangeInfo failed (${res.status})`);
  exchangeInfoCache.set(base, { at: Date.now(), body });
  return body;
}

type FuturesSymbol = {
  symbol: string;
  status?: string;
  contractType?: string;
  /** COIN, INDEX, COMMODITY, EQUITY... (TradFi perpetuals such as XAUUSDT are not COIN). */
  underlyingType?: string;
  quoteAsset?: string;
  baseAsset?: string;
  filters?: { filterType: string; stepSize?: string; minQty?: string; minNotional?: string; notional?: string; tickSize?: string }[];
};

export async function publicMarket(data: {
  op: "klines" | "tickers" | "books" | "exchangeInfo" | "time";
  env: BinanceEnv;
  symbol?: string;
  interval?: string;
  symbols?: string[];
  /** Klines only: how many candles (50 to 1000, default 300). */
  limit?: number;
}) {
  const base = host(data.env).rest;
  const fut = isFuturesEnv(data.env);
  const api = API(data.env);
  if (data.op === "time") {
    const { res, text } = await getText(`${base}${api}/time`);
    const body = parseJson(text) as { serverTime?: number; msg?: string };
    if (!res.ok || !body.serverTime) throw new Error(blocked(res.status) || body.msg || `Time request failed (${res.status})`);
    return { serverTime: body.serverTime, skewMs: body.serverTime - Date.now() };
  }
  if (data.op === "klines") {
    const symbol = (data.symbol ?? "").toUpperCase();
    const interval = data.interval as Interval;
    if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
    if (!INTERVALS.includes(interval)) throw new Error("Invalid interval.");
    const { res, text } = await getText(`${base}${api}/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(1000, Math.max(50, Math.round(Number(data.limit) || 300)))}`);
    const body = parseJson(text);
    if (!res.ok || !Array.isArray(body)) {
      const msg = blocked(res.status) || (body as { msg?: string }).msg || `Klines failed (${res.status})`;
      throw new Error(msg);
    }
    const candles = (body as unknown[][]).map((k) => ({
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    }));
    return { candles, source: base, at: Date.now() };
  }
  const symbols = (data.symbols ?? []).map((s) => s.toUpperCase()).filter((s) => SYMBOL.test(s)).slice(0, 400);
  if (!symbols.length) throw new Error("No symbols.");
  if (data.op === "exchangeInfo") {
    const filters: Record<string, ReturnType<typeof readFilters>> = {};
    if (fut) {
      const body = await futuresExchangeInfo(base);
      for (const s of body.symbols ?? []) if (symbols.includes(s.symbol)) filters[s.symbol] = readFilters(s);
      return { filters, source: base };
    }
    const q = encodeURIComponent(JSON.stringify(symbols));
    const { res, text } = await getText(`${base}/api/v3/exchangeInfo?symbols=${q}`);
    const body = parseJson(text) as { symbols?: { symbol: string; status?: string; filters?: { filterType: string; stepSize?: string; minQty?: string; minNotional?: string; notional?: string; tickSize?: string }[] }[]; msg?: string };
    if (!res.ok || !body.symbols) throw new Error(blocked(res.status) || body.msg || `exchangeInfo failed (${res.status})`);
    for (const s of body.symbols) filters[s.symbol] = readFilters(s);
    return { filters, source: base };
  }
  const path = data.op === "books" ? "ticker/bookTicker" : "ticker/24hr";
  // Futures endpoints do not take a symbols list: fetch all rows and keep the ones asked for.
  const url = fut ? `${base}${api}/${path}` : `${base}${api}/${path}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const { res, text } = await getText(url, undefined, 15_000);
  const body = parseJson(text);
  if (!res.ok || !Array.isArray(body)) throw new Error(blocked(res.status) || (body as { msg?: string }).msg || `${path} failed (${res.status})`);
  const rows = fut ? (body as { symbol: string }[]).filter((r) => symbols.includes(r.symbol)) : body;
  return { rows, source: base, at: Date.now() };
}

/**
 * Everything the connected Binance account can trade, ranked by 24h volume.
 * Spot: USDT pairs. Futures: USDT perpetual contracts. Leveraged tokens and dead pairs are dropped.
 */
export async function discoverBinance(data: { env: BinanceEnv; limit?: number }) {
  const base = host(data.env).rest;
  const fut = isFuturesEnv(data.env);
  const limit = Math.min(Math.max(data.limit ?? 250, 5), 400);
  const t = await getText(`${base}${API(data.env)}/ticker/24hr`, undefined, 25_000);
  const rows = parseJson(t.text);
  if (!t.res.ok || !Array.isArray(rows)) throw new Error(blocked(t.res.status) || (rows as { msg?: string }).msg || `Market list failed (${t.res.status})`);
  const vol = new Map<string, number>();
  for (const r of rows as { symbol: string; quoteVolume?: string }[]) vol.set(r.symbol, Number(r.quoteVolume ?? 0));
  const bad = /(UP|DOWN|BULL|BEAR)USDT$/;
  let usable: { symbol: string; base: string; raw: { status?: string; filters?: FuturesSymbol["filters"]; contractType?: string; underlyingType?: string } }[] = [];
  if (fut) {
    const info = await futuresExchangeInfo(base);
    usable = (info.symbols ?? [])
      // PERPETUAL and TRADIFI_PERPETUAL (gold, silver and other non-crypto perpetuals) both count.
      .filter((s) => s.status === "TRADING" && /PERPETUAL/.test(s.contractType ?? "") && s.quoteAsset === "USDT" && SYMBOL.test(s.symbol))
      .map((s) => ({ symbol: s.symbol, base: s.baseAsset ?? s.symbol.replace(/USDT$/, ""), raw: s }));
  } else {
    const ranked = [...vol.entries()].filter(([s]) => s.endsWith("USDT") && !bad.test(s) && SYMBOL.test(s)).sort((a, b) => b[1] - a[1]).slice(0, limit + 20);
    const q = encodeURIComponent(JSON.stringify(ranked.map(([s]) => s)));
    const e = await getText(`${base}/api/v3/exchangeInfo?symbols=${q}`, undefined, 20_000);
    const body = parseJson(e.text) as { symbols?: { symbol: string; status?: string; baseAsset?: string; filters?: FuturesSymbol["filters"] }[]; msg?: string };
    if (!e.res.ok || !body.symbols) throw new Error(blocked(e.res.status) || body.msg || `exchangeInfo failed (${e.res.status})`);
    usable = body.symbols.filter((s) => s.status === "TRADING").map((s) => ({ symbol: s.symbol, base: s.baseAsset ?? s.symbol.replace(/USDT$/, ""), raw: s }));
  }
  usable.sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  // Gold, silver and other TradFi perpetuals are always kept, however thin their volume is.
  const tradfi = (u: { symbol: string; raw: { contractType?: string; underlyingType?: string } }) => isTradfi(u.symbol, u.raw);
  const top = [...usable.slice(0, limit), ...usable.slice(limit).filter(tradfi)];
  const filters: Record<string, ReturnType<typeof readFilters>> = {};
  const markets: MarketInfo[] = top.map((u) => {
    filters[u.symbol] = readFilters(u.raw);
    const tf = fut && tradfi(u);
    return {
      symbol: u.symbol,
      label: tf ? `${TRADFI_NAMES[u.base] ?? u.base} (${u.base}/USDT)` : `${u.base}/USDT`,
      group: fut ? (tf ? "Metals & TradFi (Binance)" : "Crypto futures") : "Crypto spot",
      broker: "binance",
      open: true,
      vol: vol.get(u.symbol) ?? 0,
    };
  });
  if (!markets.length) throw new Error("Binance returned no tradable USDT markets for this account type.");
  return { markets, filters };
}

const TRADFI_NAMES: Record<string, string> = { XAU: "Gold", XAG: "Silver" };
const METALS = new Set(["XAUUSDT", "XAGUSDT"]);
function isTradfi(symbol: string, raw: { contractType?: string; underlyingType?: string }): boolean {
  return METALS.has(symbol) || /TRADIFI/.test(raw.contractType ?? "") || raw.underlyingType === "COMMODITY" || raw.underlyingType === "EQUITY";
}

/**
 * Signs Binance's TradFi-Perps agreement for this account (POST /fapi/v1/stock/contract). Gold, silver and other TradFi
 * perpetuals cannot be traded until it is signed. Binance answers {"code":200,"msg":"success"}, which the generic caller sees as a code,
 * so 200 is treated as success here.
 */
export async function signTradfiAgreement(data: { env: BinanceEnv; apiKey: string; secret: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isFuturesEnv(data.env)) return { ok: false, error: "The TradFi-Perps agreement belongs to Binance Futures. Switch the connection to Futures on the Connect tab first." };
  const r = await signedCall(data.env, data, "POST", "/fapi/v1/stock/contract", {});
  if (r.ok || r.code === 200) return { ok: true };
  return { ok: false, error: r.msg };
}

type Step = { name: string; ok: boolean; detail: string; code?: number; http?: number };

export async function diagnoseBinance(data: { env: BinanceEnv; apiKey: string; secret: string }) {
  const envInfo = host(data.env);
  const steps: Step[] = [];
  const cleaned = { key: cleanCredential(data.apiKey), secret: cleanCredential(data.secret) };
  const key = cleaned.key.value;
  const secret = cleaned.secret.value;
  steps.push({
    name: "Environment",
    ok: true,
    detail: `${envInfo.label}. REST ${envInfo.rest}. Keys from another Binance environment will fail here even if the lengths look right.`,
  });
  steps.push({
    name: "Credentials present",
    ok: key.length >= 20 && secret.length >= 20,
    detail: `Key length ${key.length}, secret length ${secret.length}. Length is not proof the key is valid.`,
  });
  const shape = credentialShape(key, secret);
  const stripped = cleaned.key.removed + cleaned.secret.removed;
  steps.push({
    name: "Key format",
    ok: shape.ok,
    detail: [
      stripped > 0 ? `Removed ${stripped} hidden or stray character(s) from what was pasted (spaces, line breaks, quotes). That alone can cause -2015.` : "",
      ...shape.notes,
      shape.ok && stripped === 0 ? "Looks like a normal Binance key pair. This is a format check only." : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  let serverTime = 0;
  try {
    const t = await publicMarket({ op: "time", env: data.env });
    serverTime = t.serverTime ?? 0;
    const skew = t.skewMs ?? 0;
    steps.push({
      name: "Clock",
      ok: Math.abs(skew) < 1000,
      detail: `Local clock is ${skew >= 0 ? "behind" : "ahead of"} Binance by ${Math.abs(skew)} ms. Requests use server time.`,
    });
  } catch (err) {
    steps.push({ name: "Clock", ok: false, detail: err instanceof Error ? err.message : "Time request failed" });
  }
  let balances: { asset: string; free: number; locked: number }[] = [];
  let probeNote = "";
  if (key && secret && serverTime) {
    const params = new URLSearchParams({ timestamp: String(serverTime), recvWindow: "5000" });
    const signature = await signQuery(secret, params.toString());
    params.set("signature", signature);
    const fut = isFuturesEnv(data.env);
    const url = `${envInfo.rest}${fut ? "/fapi/v2/account" : "/api/v3/account"}?${params.toString()}`;
    try {
      const { res, text } = await getText(url, { "X-MBX-APIKEY": key });
      const body = parseJson(text) as { code?: number; msg?: string; canTrade?: boolean; permissions?: string[]; balances?: { asset: string; free: string; locked: string }[]; assets?: { asset: string; walletBalance: string; availableBalance: string }[] };
      if (fut && body.assets) {
        body.balances = body.assets.map((a) => ({ asset: a.asset, free: a.availableBalance, locked: String(Number(a.walletBalance) - Number(a.availableBalance)) }));
        body.permissions = ["FUTURES"];
      }
      if (!res.ok || body.code) {
        steps.push({
          name: "Signed account",
          ok: false,
          detail: blocked(res.status) || explainBinanceError(body.code, body.msg || `HTTP ${res.status}`, envInfo.label),
          code: body.code,
          http: res.status,
        });
        if (body.code === -2015 || body.code === -2014 || body.code === -1022) {
          const found = await probeEnvs(key, secret);
          probeNote = found.length
            ? `This key pair IS accepted by: ${found.map((f) => BINANCE_HOSTS[f].label).join(", ")}. Switch the environment to match.`
            : "This key pair was rejected by every Binance environment (spot and futures, live, demo and testnet). Re-create the key inside the Demo Trading area, copy the key and secret again, and check the key has no IP restriction (a phone's IP changes) and that trading is ticked.";
          steps.push({ name: "Environment probe", ok: found.length > 0, detail: probeNote });
        }
      } else {
        steps.push({
          name: "Signed account",
          ok: true,
          detail: body.canTrade ? `Account responded. ${fut ? "Futures" : "Spot"} trading permission is on.` : "Account responded, but trading is not enabled for this key. Tick the trading permission on the key.",
          http: res.status,
        });
        steps.push({
          name: "Permissions",
          ok: !!body.canTrade && (fut || ((body as { permissions?: string[] }).permissions ?? ["SPOT"]).includes("SPOT")),
          detail: `Account permissions: ${((body as { permissions?: string[] }).permissions ?? []).join(", ") || "not reported"}. Withdrawals are never used by this app.`,
        });
        balances = (body.balances ?? [])
          .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
          .filter((b) => b.free > 0 || b.locked > 0)
          .slice(0, 12);
        steps.push({
          name: "Balances",
          ok: true,
          detail: balances.length ? balances.map((b) => `${b.asset} ${b.free}`).join(", ") : "No non-zero balances returned. The key works; the account is empty.",
        });
      }
    } catch (err) {
      steps.push({ name: "Signed account", ok: false, detail: err instanceof Error ? err.message : "Network timeout" });
    }
  }
  try {
    const info = await publicMarket({ op: "exchangeInfo", env: data.env, symbols: ["BTCUSDT"] });
    const f = info.filters?.BTCUSDT;
    steps.push({
      name: "BTCUSDT filters",
      ok: !!f && f.status === "TRADING",
      detail: f ? `Status ${f.status}. Step ${f.step}. Min notional ${f.minNotional}.` : "BTCUSDT missing.",
    });
  } catch (err) {
    steps.push({ name: "BTCUSDT filters", ok: false, detail: err instanceof Error ? err.message : "exchangeInfo failed" });
  }
  const ready = steps.filter((s) => s.name !== "Clock").every((s) => s.ok);
  steps.push({
    name: "Order readiness",
    ok: ready,
    detail: ready ? "Authenticated read succeeded. No order was sent." : "Not ready to trade. No order was sent.",
  });
  return {
    environment: data.env,
    label: envInfo.label,
    rest: envInfo.rest,
    live: envInfo.live,
    steps,
    balances,
    ready,
  };
}

export async function placeMarketOrder(data: {
  env: BinanceEnv;
  apiKey: string;
  secret: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  clientId: string;
}) {
  const envInfo = host(data.env);
  const symbol = data.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
  if (data.side !== "BUY" && data.side !== "SELL") throw new Error("Invalid side.");
  const time = await publicMarket({ op: "time", env: data.env });
  const info = await publicMarket({ op: "exchangeInfo", env: data.env, symbols: [symbol] });
  const f = info.filters?.[symbol];
  if (!f || f.status !== "TRADING") throw new Error(`${symbol} is not trading on ${envInfo.label}.`);
  const { floorToStep } = await import("../trade/risk.ts");
  const qty = floorToStep(data.quantity, f.step);
  if (!(qty > 0)) throw new Error("Quantity rounds to zero under this symbol's step size.");
  const params = new URLSearchParams({
    symbol,
    side: data.side,
    type: "MARKET",
    quantity: String(qty),
    newClientOrderId: data.clientId.slice(0, 36),
    timestamp: String(time.serverTime),
    recvWindow: "5000",
    newOrderRespType: "FULL",
  });
  params.set("signature", await signQuery(cleanCredential(data.secret).value, params.toString()));
  // Placing an order is POST. A GET to this path is "query order" and never trades.
  const { res, text } = await getText(`${envInfo.rest}/api/v3/order?${params.toString()}`, { "X-MBX-APIKEY": cleanCredential(data.apiKey).value }, 12_000, "POST");
  const body = parseJson(text) as {
    code?: number;
    msg?: string;
    orderId?: number;
    status?: string;
    executedQty?: string;
    cummulativeQuoteQty?: string;
    fills?: { price: string; qty: string; commission: string; commissionAsset?: string }[];
  };
  if (!res.ok || body.code || !body.orderId) {
    return {
      ok: false as const,
      http: res.status,
      code: body.code,
      error: explainBinanceError(body.code, body.msg || `HTTP ${res.status}`, envInfo.label),
    };
  }
  const exec = Number(body.executedQty ?? 0);
  const quote = Number(body.cummulativeQuoteQty ?? 0);
  // Fees paid in the base asset reduce what can be sold later.
  const baseFee = (body.fills ?? []).reduce((sum, f) => (f.commissionAsset && symbol.startsWith(f.commissionAsset) ? sum + Number(f.commission) : sum), 0);
  const quoteFee = (body.fills ?? []).reduce((sum, f) => (f.commissionAsset && !symbol.startsWith(f.commissionAsset) && symbol.endsWith(f.commissionAsset) ? sum + Number(f.commission) : sum), 0);
  const netQty = data.side === "BUY" ? floorToStep(Math.max(0, exec - baseFee), f.step) : exec;
  return {
    ok: true as const,
    orderId: String(body.orderId),
    status: body.status ?? "UNKNOWN",
    executedQty: exec,
    netQty,
    quoteFee,
    tick: f.tick,
    step: f.step,
    avgPrice: exec > 0 ? quote / exec : null,
    rawStatus: body.status,
  };
}

/** Which environments accept this key pair on a signed read. Reads only. Never trades. */
export async function probeEnvs(apiKey: string, secret: string): Promise<BinanceEnv[]> {
  const out: BinanceEnv[] = [];
  for (const env of Object.keys(BINANCE_HOSTS) as BinanceEnv[]) {
    try {
      const r = await signedCall(env, { apiKey, secret }, "GET", isFuturesEnv(env) ? "/fapi/v2/account" : "/api/v3/account", isFuturesEnv(env) ? {} : { omitZeroBalances: "true" });
      if (r.ok) out.push(env);
    } catch {
      /* unreachable host counts as not accepted */
    }
  }
  return out;
}

/**
 * Binance /api/v3/order/test validates signature, permissions, symbol, lot size and notional
 * and then discards the order. Nothing is executed and no balance changes.
 */
export async function testOrder(data: { env: BinanceEnv; apiKey: string; secret: string; symbol: string }) {
  const symbol = data.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
  const info = await publicMarket({ op: "exchangeInfo", env: data.env, symbols: [symbol] });
  const f = info.filters?.[symbol];
  if (!f || f.status !== "TRADING") return { ok: false as const, error: `${symbol} is not trading on ${host(data.env).label}.` };
  const books = (await publicMarket({ op: "books", env: data.env, symbols: [symbol] })) as { rows?: { askPrice: string }[] };
  const ask = Number(books.rows?.[0]?.askPrice ?? 0);
  if (!(ask > 0)) return { ok: false as const, error: "No ask price to size a test order." };
  const { floorToStep } = await import("../trade/risk.ts");
  let qty = floorToStep((f.minNotional * 1.5) / ask, f.step);
  if (qty < f.minQty) qty = f.minQty;
  const r = await signedCall(data.env, data, "POST", "/api/v3/order/test", { symbol, side: "BUY", type: "MARKET", quantity: String(qty) });
  if (!r.ok) return { ok: false as const, http: r.http, code: r.code, error: r.msg };
  return { ok: true as const, http: r.http, symbol, quantity: qty, note: "Binance accepted the test order. It was validated and discarded; nothing was placed." };
}

/** Sell-side OCO for a filled long: take-profit LIMIT_MAKER above, STOP_LOSS_LIMIT below. Confirmed only if Binance says EXECUTING. */
export async function placeProtection(data: {
  env: BinanceEnv;
  apiKey: string;
  secret: string;
  symbol: string;
  quantity: number;
  stop: number;
  target: number;
  tick: number;
  clientId: string;
}) {
  const symbol = data.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
  const stop = roundToTick(data.stop, data.tick, "down");
  const stopLimit = roundToTick(data.stop * 0.998, data.tick, "down");
  const target = roundToTick(data.target, data.tick, "up");
  if (!(stopLimit > 0) || !(stop > stopLimit) || !(target > stop)) return { ok: false as const, error: "Protective prices are not in a valid order after rounding." };
  const r = await signedCall(data.env, data, "POST", "/api/v3/orderList/oco", {
    symbol,
    side: "SELL",
    quantity: String(data.quantity),
    aboveType: "LIMIT_MAKER",
    abovePrice: String(target),
    belowType: "STOP_LOSS_LIMIT",
    belowStopPrice: String(stop),
    belowPrice: String(stopLimit),
    belowTimeInForce: "GTC",
    listClientOrderId: data.clientId.slice(0, 36),
  });
  if (!r.ok) return { ok: false as const, http: r.http, code: r.code, error: r.msg };
  const status = String(r.body.listOrderStatus ?? "");
  const id = r.body.orderListId;
  if (status !== "EXECUTING" || id == null) return { ok: false as const, error: `OCO came back as ${status || "unknown"}. Treat the position as unprotected.` };
  return { ok: true as const, orderListId: String(id), stop, target };
}

export async function cancelProtection(data: { env: BinanceEnv; apiKey: string; secret: string; symbol: string; orderListId: string }) {
  const r = await signedCall(data.env, data, "DELETE", "/api/v3/orderList", { symbol: data.symbol.toUpperCase(), orderListId: data.orderListId });
  if (!r.ok) return { ok: false as const, http: r.http, code: r.code, error: r.msg };
  return { ok: true as const };
}

/** Did the resting OCO fill at the broker? Reads the list, then the filled leg for its real average price. */
export async function protectionStatus(data: { env: BinanceEnv; apiKey: string; secret: string; symbol: string; orderListId: string }) {
  const symbol = data.symbol.toUpperCase();
  const list = await signedCall(data.env, data, "GET", "/api/v3/orderList", { orderListId: data.orderListId });
  if (!list.ok) return { ok: false as const, error: list.msg, http: list.http, code: list.code };
  const status = String(list.body.listOrderStatus ?? "");
  if (status === "EXECUTING") return { ok: true as const, state: "resting" as const };
  const orders = (list.body.orders as { orderId: number }[] | undefined) ?? [];
  for (const o of orders) {
    const one = await signedCall(data.env, data, "GET", "/api/v3/order", { symbol, orderId: String(o.orderId) });
    if (!one.ok) continue;
    const exec = Number(one.body.executedQty ?? 0);
    if (exec > 0) {
      const quote = Number(one.body.cummulativeQuoteQty ?? 0);
      const type = String(one.body.type ?? "");
      return { ok: true as const, state: "filled" as const, leg: type.startsWith("STOP") ? ("stop" as const) : ("target" as const), qty: exec, avgPrice: quote / exec, orderId: String(o.orderId) };
    }
  }
  return { ok: true as const, state: "closed-unfilled" as const, status };
}

/** Free and locked balances from the signed account endpoint. Read only. */
export async function accountBalances(data: { env: BinanceEnv; apiKey: string; secret: string }) {
  if (isFuturesEnv(data.env)) {
    const f = await signedCall(data.env, data, "GET", "/fapi/v2/account", {});
    if (!f.ok) return { ok: false as const, http: f.http, code: f.code, error: f.msg };
    const assets = (f.body.assets as { asset: string; walletBalance: string; availableBalance: string; unrealizedProfit?: string }[] | undefined) ?? [];
    return {
      ok: true as const,
      canTrade: f.body.canTrade === true,
      balances: assets.map((a) => ({ asset: a.asset, free: Number(a.availableBalance), locked: Math.max(0, Number(a.walletBalance) - Number(a.availableBalance)) })).filter((b) => b.free > 0 || b.locked > 0),
      futures: { wallet: Number(f.body.totalWalletBalance ?? 0), available: Number(f.body.availableBalance ?? 0), margin: Number(f.body.totalMarginBalance ?? f.body.totalWalletBalance ?? 0) },
    };
  }
  const r = await signedCall(data.env, data, "GET", "/api/v3/account", { omitZeroBalances: "true" });
  if (!r.ok) return { ok: false as const, http: r.http, code: r.code, error: r.msg };
  const rows = (r.body.balances as { asset: string; free: string; locked: string }[] | undefined) ?? [];
  return {
    ok: true as const,
    canTrade: r.body.canTrade === true,
    balances: rows.map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) })).filter((b) => b.free > 0 || b.locked > 0),
    futures: null as null | { wallet: number; available: number; margin: number },
  };
}

/* ───────────────────────── USDⓈ-M Futures (demo, testnet, live) ───────────────────────── */

type FCreds = { env: BinanceEnv; apiKey: string; secret: string };

/** One-way mode (default) or hedge mode. Hedge mode needs positionSide on every order. */
async function isHedgeMode(c: FCreds): Promise<boolean> {
  const r = await signedCall(c.env, c, "GET", "/fapi/v1/positionSide/dual", {});
  return r.ok && r.body.dualSidePosition === true;
}

/** Isolated margin and the chosen leverage for one symbol. A leverage failure is reported, never hidden. */
export async function futuresSetup(data: FCreds & { symbol: string; leverage: number; isolated: boolean }) {
  const symbol = data.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
  if (data.isolated) {
    const m = await signedCall(data.env, data, "POST", "/fapi/v1/marginType", { symbol, marginType: "ISOLATED" });
    // -4046 means it already is isolated; -4048 means a position is open and the type cannot change now.
    if (!m.ok && m.code !== -4046 && m.code !== -4048) return { ok: false as const, error: `Margin type: ${m.msg}` };
  }
  const lev = Math.min(125, Math.max(1, Math.round(data.leverage)));
  const l = await signedCall(data.env, data, "POST", "/fapi/v1/leverage", { symbol, leverage: String(lev) });
  if (!l.ok) return { ok: false as const, error: `Leverage: ${l.msg}` };
  return { ok: true as const, leverage: Number(l.body.leverage ?? lev) };
}

export async function placeFuturesOrder(data: FCreds & { symbol: string; side: "BUY" | "SELL"; quantity: number; clientId: string; reduceOnly?: boolean }) {
  const envInfo = host(data.env);
  const symbol = data.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
  const info = await publicMarket({ op: "exchangeInfo", env: data.env, symbols: [symbol] });
  const f = info.filters?.[symbol];
  if (!f || f.status !== "TRADING") throw new Error(`${symbol} is not trading on ${envInfo.label}.`);
  const { floorToStep } = await import("../trade/risk.ts");
  const qty = floorToStep(data.quantity, f.step);
  if (!(qty > 0)) throw new Error("Quantity rounds to zero under this symbol's step size.");
  const hedge = await isHedgeMode(data);
  const params: Record<string, string> = {
    symbol,
    side: data.side,
    type: "MARKET",
    quantity: String(qty),
    newClientOrderId: data.clientId.slice(0, 36),
    newOrderRespType: "RESULT",
  };
  if (hedge) params.positionSide = (data.reduceOnly ? data.side === "SELL" : data.side === "BUY") ? "LONG" : "SHORT";
  else if (data.reduceOnly) params.reduceOnly = "true";
  const r = await signedCall(data.env, data, "POST", "/fapi/v1/order", params);
  if (!r.ok) return { ok: false as const, http: r.http, code: r.code, error: r.msg };
  let body = r.body;
  let exec = Number(body.executedQty ?? 0);
  let avg = Number(body.avgPrice ?? 0);
  if (!(exec > 0) || !(avg > 0)) {
    // Market orders normally fill at once; read the order back when the first answer was early.
    const q = await signedCall(data.env, data, "GET", "/fapi/v1/order", { symbol, orderId: String(body.orderId) });
    if (q.ok) {
      body = q.body;
      exec = Number(body.executedQty ?? 0);
      avg = Number(body.avgPrice ?? 0);
      if (!(avg > 0) && exec > 0) avg = Number(body.cumQuote ?? 0) / exec;
    }
  }
  return {
    ok: true as const,
    orderId: String(body.orderId ?? ""),
    status: String(body.status ?? "UNKNOWN"),
    executedQty: exec,
    netQty: exec,
    quoteFee: 0,
    tick: f.tick,
    step: f.step,
    avgPrice: exec > 0 && avg > 0 ? avg : null,
    rawStatus: String(body.status ?? ""),
  };
}

/** Stop-loss and take-profit as exchange-side conditional orders (Binance Algo Service). Both must be accepted. */
export async function placeFuturesProtection(data: FCreds & { symbol: string; side: "BUY" | "SELL"; stop: number; target: number; tick: number; clientId: string }) {
  const symbol = data.symbol.toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("Invalid symbol.");
  const long = data.side === "BUY";
  const stop = roundToTick(data.stop, data.tick, long ? "down" : "up");
  const target = roundToTick(data.target, data.tick, long ? "up" : "down");
  if (!(stop > 0) || !(target > 0) || (long ? !(stop < target) : !(stop > target))) return { ok: false as const, error: "Protective prices are not in a valid order after rounding." };
  const hedge = await isHedgeMode(data);
  const exitSide = long ? "SELL" : "BUY";
  const one = (type: "STOP_MARKET" | "TAKE_PROFIT_MARKET", price: number, tag: string) =>
    signedCall(data.env, data, "POST", "/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL",
      symbol,
      side: exitSide,
      type,
      triggerPrice: String(price),
      closePosition: "true",
      workingType: "MARK_PRICE",
      clientAlgoId: `${tag}${data.clientId}`.slice(0, 36),
      ...(hedge ? { positionSide: long ? "LONG" : "SHORT" } : {}),
    });
  const sl = await one("STOP_MARKET", stop, "s");
  if (!sl.ok) return { ok: false as const, http: sl.http, code: sl.code, error: `Stop: ${sl.msg}` };
  const tp = await one("TAKE_PROFIT_MARKET", target, "t");
  const slId = String(sl.body.algoId ?? "");
  if (!tp.ok) {
    await cancelFuturesProtection({ ...data, algoIds: [slId] });
    return { ok: false as const, http: tp.http, code: tp.code, error: `Target: ${tp.msg}` };
  }
  return { ok: true as const, algoIds: [slId, String(tp.body.algoId ?? "")], stop, target };
}

export async function cancelFuturesProtection(data: FCreds & { symbol: string; algoIds: string[] }) {
  for (const id of data.algoIds.filter(Boolean)) {
    const r = await signedCall(data.env, data, "DELETE", "/fapi/v1/algoOrder", { algoId: id });
    // -2011 / -2013: already triggered, cancelled or filled. Nothing left to cancel.
    if (!r.ok && r.code !== -2011 && r.code !== -2013) return { ok: false as const, http: r.http, code: r.code, error: r.msg };
  }
  return { ok: true as const };
}

/** Is the position still open at the exchange? If it is flat, read the closing fills for the real exit price and PnL. */
export async function futuresProtectionStatus(data: FCreds & { symbol: string; side: "BUY" | "SELL"; openedAt: number; algoIds: string[] }) {
  const symbol = data.symbol.toUpperCase();
  let pr = await signedCall(data.env, data, "GET", "/fapi/v2/positionRisk", { symbol });
  if (!pr.ok && pr.http === 404) pr = await signedCall(data.env, data, "GET", "/fapi/v3/positionRisk", { symbol });
  if (!pr.ok) return { ok: false as const, error: pr.msg, http: pr.http, code: pr.code };
  const rows = Array.isArray((pr.body as unknown)) ? ((pr.body as unknown) as { positionAmt: string }[]) : [];
  const open = rows.reduce((s, r) => s + Math.abs(Number(r.positionAmt ?? 0)), 0);
  if (open > 0) return { ok: true as const, state: "resting" as const };
  const tr = await signedCall(data.env, data, "GET", "/fapi/v1/userTrades", { symbol, startTime: String(Math.max(0, data.openedAt - 5000)), limit: "100" });
  await cancelFuturesProtection(data);
  if (!tr.ok) return { ok: false as const, error: tr.msg, http: tr.http, code: tr.code };
  const trades = (Array.isArray((tr.body as unknown)) ? ((tr.body as unknown) as { side: string; price: string; qty: string; realizedPnl: string; commission: string; commissionAsset: string; orderId: number }[]) : []);
  const exitSide = data.side === "BUY" ? "SELL" : "BUY";
  const closing = trades.filter((t) => t.side === exitSide);
  const qty = closing.reduce((s, t) => s + Number(t.qty), 0);
  if (!(qty > 0)) return { ok: true as const, state: "closed-unfilled" as const, status: "position is flat but no closing fill was found" };
  const avgPrice = closing.reduce((s, t) => s + Number(t.price) * Number(t.qty), 0) / qty;
  const fees = trades.filter((t) => t.commissionAsset === "USDT" || t.commissionAsset === "USDC").reduce((s, t) => s + Number(t.commission), 0);
  const pnl = trades.reduce((s, t) => s + Number(t.realizedPnl), 0) - fees;
  return { ok: true as const, state: "filled" as const, leg: pnl >= 0 ? ("target" as const) : ("stop" as const), qty, avgPrice, pnl, orderId: String(closing[closing.length - 1]!.orderId) };
}
