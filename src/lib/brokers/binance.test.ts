import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { accountBalances, cancelProtection, diagnoseBinance, placeMarketOrder, placeProtection, probeEnvs, protectionStatus, testOrder } from "./market.ts";

/**
 * A small in-process fake of Binance Spot REST. It verifies what the client actually sends:
 * HTTP method, API-key header, HMAC signature over the exact query string, and timestamp against
 * ITS clock (8 s ahead of local, so a client that used local time would be rejected).
 * This proves request construction. It is NOT evidence that real Binance accepts the same calls.
 */
const SKEW = 8000;
type Calls = { method: string; host: string; path: string; params: Record<string, string> }[];

function fakeBinance(opts: { accounts: Record<string, { secret: string; host: string; canTrade?: boolean }>; orderStatus?: string; failOrder?: { code: number; msg: string }; ocoStatus?: string; fee?: { asset: string; amount: string }; timeout?: boolean }) {
  const calls: Calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    if (opts.timeout) throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ method, host: url.host, path: url.pathname, params });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const key = (init?.headers as Record<string, string> | undefined)?.["X-MBX-APIKEY"];
    if (url.pathname === "/api/v3/time") return json({ serverTime: Date.now() + SKEW });
    if (url.pathname === "/api/v3/exchangeInfo") {
      const syms = JSON.parse(params.symbols!) as string[];
      return json({
        symbols: syms.map((symbol) => ({
          symbol,
          status: "TRADING",
          filters: [
            { filterType: "LOT_SIZE", stepSize: "0.00100000", minQty: "0.00100000" },
            { filterType: "NOTIONAL", minNotional: "5.00000000" },
            { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
          ],
        })),
      });
    }
    if (url.pathname === "/api/v3/ticker/bookTicker") return json([{ symbol: "BTCUSDT", bidPrice: "100.00", askPrice: "100.10" }]);
    // ---- signed from here
    const acct = key ? opts.accounts[key] : undefined;
    if (!acct || acct.host !== url.host) return json({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }, 401);
    const { signature, ...rest } = params;
    const expect = createHmac("sha256", acct.secret).update(new URLSearchParams(rest).toString()).digest("hex");
    if (signature !== expect) return json({ code: -1022, msg: "Signature for this request is not valid." }, 400);
    if (Math.abs(Number(rest.timestamp) - (Date.now() + SKEW)) > 5000) return json({ code: -1021, msg: "Timestamp outside of recvWindow." }, 400);
    if (url.pathname === "/api/v3/account") return json({ canTrade: acct.canTrade ?? true, permissions: ["SPOT"], balances: [{ asset: "USDT", free: "1000.0", locked: "0.0" }, { asset: "BTC", free: "0.5", locked: "0.0" }, { asset: "ETH", free: "0", locked: "0" }] });
    if (url.pathname === "/api/v3/order/test") return method === "POST" ? json({}) : json({ code: -1102, msg: "wrong method" }, 400);
    if (url.pathname === "/api/v3/order" && method === "POST") {
      if (opts.failOrder) return json(opts.failOrder, 400);
      const qty = rest.quantity!;
      return json({
        orderId: 777,
        status: opts.orderStatus ?? "FILLED",
        executedQty: qty,
        cummulativeQuoteQty: String(Number(qty) * 100.1),
        fills: [{ price: "100.1", qty, commission: opts.fee?.amount ?? "0.00001", commissionAsset: opts.fee?.asset ?? "BNB" }],
      });
    }
    if (url.pathname === "/api/v3/order" && method === "GET") {
      const isStop = rest.orderId === "2";
      return json({ orderId: Number(rest.orderId), type: isStop ? "STOP_LOSS_LIMIT" : "LIMIT_MAKER", executedQty: isStop ? "0.5" : "0", cummulativeQuoteQty: isStop ? "48.5" : "0" });
    }
    if (url.pathname === "/api/v3/orderList/oco" && method === "POST") return json({ orderListId: 42, listOrderStatus: opts.ocoStatus ?? "EXECUTING" });
    if (url.pathname === "/api/v3/orderList" && method === "DELETE") return json({ orderListId: Number(rest.orderListId), listOrderStatus: "ALL_DONE" });
    if (url.pathname === "/api/v3/orderList" && method === "GET") return json({ orderListId: 42, listOrderStatus: opts.ocoStatus ?? "ALL_DONE", orders: [{ orderId: 1 }, { orderId: 2 }] });
    return json({ code: -1102, msg: `unhandled ${method} ${url.pathname}` }, 400);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}

let restore = () => {};
afterEach(() => restore());

const DEMO = "demo-api.binance.com";
const TESTNET = "testnet.binance.vision";
const accounts = { KEYDEMO: { secret: "SECDEMO", host: DEMO }, KEYTEST: { secret: "SECTEST", host: TESTNET } };
const demo = { env: "spot-demo" as const, apiKey: "KEYDEMO", secret: "SECDEMO" };

test("orders are POSTed and signed, using Binance server time (local clock is 8 s off)", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const r = await placeMarketOrder({ ...demo, symbol: "BTCUSDT", side: "BUY", quantity: 0.0456789, clientId: "abc" });
  assert.equal(r.ok, true);
  const order = f.calls.find((c) => c.path === "/api/v3/order")!;
  assert.equal(order.method, "POST");
  assert.equal(order.host, DEMO);
  assert.equal(order.params.quantity, "0.045", "quantity floors to the 0.001 step");
  assert.equal(order.params.newClientOrderId, "abc");
});

test("pasted keys with hidden characters are cleaned before signing", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const r = await accountBalances({ env: "spot-demo", apiKey: "\u200BKEYDEMO \n", secret: " \u201CSECDEMO\u201D\u00A0" });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.balances.map((b) => b.asset), ["USDT", "BTC"]);
});

test("wrong environment: -2015 is explained and the probe names the environment that accepts the key", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const d = await diagnoseBinance({ env: "spot-testnet", apiKey: "KEYDEMO", secret: "SECDEMO" });
  assert.equal(d.ready, false);
  const acct = d.steps.find((s) => s.name === "Signed account")!;
  assert.equal(acct.ok, false);
  assert.equal(acct.code, -2015);
  assert.equal(acct.http, 401);
  const probe = d.steps.find((s) => s.name === "Environment probe")!;
  assert.equal(probe.ok, true);
  assert.match(probe.detail, /Binance Spot Demo/);
  assert.ok(!JSON.stringify(d).includes("SECDEMO"), "the secret must never appear in diagnostics");
  assert.ok(!f.calls.some((c) => c.path === "/api/v3/order"), "a connection test must not place or query orders");
});

test("a correct key on the right environment passes every step without trading", async () => {
  const K = "k".repeat(64);
  const S = "s".repeat(64);
  const f = fakeBinance({ accounts: { [K]: { secret: S, host: DEMO } } });
  restore = f.restore;
  const d = await diagnoseBinance({ env: "spot-demo", apiKey: K, secret: S });
  assert.equal(d.ready, true, JSON.stringify(d.steps.filter((s) => !s.ok)));
  const clock = d.steps.find((s) => s.name === "Clock")!;
  assert.equal(clock.ok, false, "an 8 s skew is reported");
  assert.match(clock.detail, /ahead of|behind/);
  assert.ok(d.steps.find((s) => s.name === "Permissions")?.ok);
  assert.ok(!f.calls.some((c) => c.path.startsWith("/api/v3/order")));
});

test("a wrong secret gives -1022 and identical key/secret is flagged", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const d = await diagnoseBinance({ ...demo, apiKey: "KEYDEMO", secret: "NOTTHESECRET" });
  const acct = d.steps.find((s) => s.name === "Signed account")!;
  assert.equal(acct.code, -1022);
  assert.match(acct.detail, /secret does not match/);
  const same = await diagnoseBinance({ ...demo, apiKey: "K".repeat(40), secret: "K".repeat(40) });
  assert.match(same.steps.find((s) => s.name === "Key format")!.detail, /identical/);
});

test("canTrade=false is reported as a permission failure", async () => {
  const f = fakeBinance({ accounts: { KEYDEMO: { secret: "SECDEMO", host: DEMO, canTrade: false } } });
  restore = f.restore;
  const d = await diagnoseBinance(demo);
  assert.equal(d.steps.find((s) => s.name === "Permissions")!.ok, false);
  assert.equal(d.ready, false);
});

test("network timeout surfaces as a failed step, not a crash", async () => {
  const f = fakeBinance({ accounts, timeout: true });
  restore = f.restore;
  const d = await diagnoseBinance(demo);
  assert.equal(d.ready, false);
  assert.match(d.steps.find((s) => s.name === "Clock")!.detail, /timed out/);
});

test("probeEnvs lists only environments that accept the pair", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  assert.deepEqual(await probeEnvs("KEYTEST", "SECTEST"), ["spot-testnet"]);
  assert.deepEqual(await probeEnvs("KEYDEMO", "SECDEMO"), ["spot-demo"]);
  assert.deepEqual(await probeEnvs("NOPE", "NOPE"), []);
});

test("order check uses /order/test (POST) and never the real order endpoint", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const r = await testOrder({ ...demo, symbol: "BTCUSDT" });
  assert.equal(r.ok, true);
  const paths = f.calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(paths.includes("POST /api/v3/order/test"));
  assert.ok(!paths.includes("POST /api/v3/order"));
  const t = f.calls.find((c) => c.path === "/api/v3/order/test")!;
  assert.ok(Number(t.params.quantity) * 100.1 >= 5, "test quantity clears the minimum notional");
});

test("rejected order keeps Binance's HTTP status and code with a readable reason", async () => {
  const f = fakeBinance({ accounts, failOrder: { code: -2010, msg: "Account has insufficient balance for requested action." } });
  restore = f.restore;
  const r = await placeMarketOrder({ ...demo, symbol: "BTCUSDT", side: "BUY", quantity: 1, clientId: "x1" });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.http, 400);
    assert.equal(r.code, -2010);
    assert.match(r.error, /insufficient balance/);
  }
});

test("quantity that rounds to zero is refused before any request is signed", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  await assert.rejects(() => placeMarketOrder({ ...demo, symbol: "BTCUSDT", side: "BUY", quantity: 0.0004, clientId: "x2" }), /rounds to zero/);
  assert.ok(!f.calls.some((c) => c.path === "/api/v3/order"));
});

test("fees paid in the base asset reduce the quantity available to protect or sell", async () => {
  const f = fakeBinance({ accounts, fee: { asset: "BTC", amount: "0.001" } });
  restore = f.restore;
  const r = await placeMarketOrder({ ...demo, symbol: "BTCUSDT", side: "BUY", quantity: 0.05, clientId: "x3" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.executedQty, 0.05);
    assert.equal(r.netQty, 0.049);
  }
});

test("protection: OCO is sent with rounded prices and counts as confirmed only when EXECUTING", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const ok = await placeProtection({ ...demo, symbol: "BTCUSDT", quantity: 0.049, stop: 98.456, target: 103.001, tick: 0.01, clientId: "p1" });
  assert.equal(ok.ok, true);
  const c = f.calls.find((x) => x.path === "/api/v3/orderList/oco")!;
  assert.equal(c.method, "POST");
  assert.equal(c.params.side, "SELL");
  assert.equal(c.params.aboveType, "LIMIT_MAKER");
  assert.equal(c.params.abovePrice, "103.01", "target rounds up to the tick");
  assert.equal(c.params.belowType, "STOP_LOSS_LIMIT");
  assert.equal(c.params.belowStopPrice, "98.45", "stop rounds down to the tick");
  assert.ok(Number(c.params.belowPrice) < Number(c.params.belowStopPrice));
  f.restore();
  const g = fakeBinance({ accounts, ocoStatus: "REJECT" });
  restore = g.restore;
  const bad = await placeProtection({ ...demo, symbol: "BTCUSDT", quantity: 0.049, stop: 98, target: 103, tick: 0.01, clientId: "p2" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /unprotected/i);
});

test("protection: invalid price order after rounding is refused locally", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const r = await placeProtection({ ...demo, symbol: "BTCUSDT", quantity: 1, stop: 100, target: 99, tick: 0.01, clientId: "p3" });
  assert.equal(r.ok, false);
  assert.ok(!f.calls.some((c) => c.path === "/api/v3/orderList/oco"));
});

test("protection status reports which leg filled and at what real average price", async () => {
  const f = fakeBinance({ accounts, ocoStatus: "ALL_DONE" });
  restore = f.restore;
  const r = await protectionStatus({ ...demo, symbol: "BTCUSDT", orderListId: "42" });
  assert.equal(r.ok, true);
  if (r.ok && r.state === "filled") {
    assert.equal(r.leg, "stop");
    assert.equal(r.qty, 0.5);
    assert.equal(r.avgPrice, 97);
  } else assert.fail("expected a filled stop leg");
  f.restore();
  const g = fakeBinance({ accounts, ocoStatus: "EXECUTING" });
  restore = g.restore;
  const resting = await protectionStatus({ ...demo, symbol: "BTCUSDT", orderListId: "42" });
  assert.equal(resting.ok && resting.state, "resting");
});

test("protection can be cancelled with DELETE", async () => {
  const f = fakeBinance({ accounts });
  restore = f.restore;
  const r = await cancelProtection({ ...demo, symbol: "BTCUSDT", orderListId: "42" });
  assert.equal(r.ok, true);
  assert.equal(f.calls.find((c) => c.path === "/api/v3/orderList")!.method, "DELETE");
});
