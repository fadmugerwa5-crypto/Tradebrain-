import assert from "node:assert/strict";
import test from "node:test";
import { ema, rsi } from "./indicators.ts";
import { decide, makePlan } from "./analyze.ts";
import type { Candle } from "./types.ts";
import { closePosition, freshAccount, openPosition, protectiveIntent, type BookPosition } from "../trade/account.ts";
import { checkRisk, floorToStep } from "../trade/risk.ts";
import { planCycle } from "../trade/planner.ts";
import { explainBinanceError, signQuery } from "../brokers/binance-sign.ts";

function trendCandles(n = 160): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const drift = 0.35 + Math.sin(i / 9) * 0.08;
    const o = p;
    const c = p + drift;
    const h = Math.max(o, c) + 0.05;
    const l = Math.min(o, c) - 0.04;
    out.push({ t: 1_700_000_000_000 + i * 900_000, o, h, l, c, v: 1000 + i * 10 });
    p = c;
  }
  return out;
}

test("ema seeds with the simple average", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const e = ema(values, 3);
  assert.equal(e[2], 2);
  assert.ok((e[9] ?? 0) > 7);
});

test("rsi stays inside 0..100", () => {
  const v = trendCandles().map((c) => c.c);
  const r = rsi(v);
  assert.ok(r != null && r > 0 && r <= 100);
});

test("uptrend produces a directional plan from the trend module", () => {
  const d = decide(trendCandles(), "mad");
  assert.ok(d);
  const trend = d!.modules.find((m) => m.id === "trend");
  assert.equal(trend?.verdict, "BUY");
  assert.ok(d!.action === "BUY" || d!.action === "WAIT");
  assert.ok(d!.reason.length > 10);
});

test("abnormal candle forces WAIT", () => {
  const c = trendCandles(100);
  const last = c[c.length - 1]!;
  c.push({ t: last.t + 900_000, o: last.c, h: last.c + 50, l: last.c - 1, c: last.c + 48, v: 5000 });
  const d = decide(c, "normal");
  assert.equal(d?.action, "WAIT");
  assert.match(d?.reason ?? "", /ATR|No new entries|Abnormal/);
});

test("plan keeps stop and target on the right sides", () => {
  const buy = makePlan("BUY", 100, 2, null, 1.5);
  assert.ok(buy && buy.stop < buy.entry && buy.target > buy.entry);
  const sell = makePlan("SELL", 100, 2, null, 1.5);
  assert.ok(sell && sell.stop > sell.entry && sell.target < sell.entry);
});

test("official Binance HMAC vector", async () => {
  const q = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
  const sig = await signQuery("NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j", q);
  assert.equal(sig, "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
});

test("step size rounds down", () => {
  assert.equal(floorToStep(0.1239, 0.001), 0.123);
});

test("binance -2015 explanation names the environment mismatch", () => {
  const msg = explainBinanceError(-2015, "Invalid API-key, IP, or permissions for action.", "Binance Spot Testnet");
  assert.match(msg, /demo-api\.binance\.com/);
  assert.match(msg, /testnet\.binance\.vision/);
});

test("risk blocks daily loss, duplicates, and spot shorts", () => {
  const plan = makePlan("BUY", 100, 1, null, 1.5)!;
  const base = {
    side: "BUY" as const,
    price: 100,
    plan,
    equity: 10_000,
    cash: 10_000,
    dayPnl: 0,
    startEquity: 10_000,
    riskPct: 0.25,
    maxOpenRiskPct: 1,
    dailyLossPct: 2,
    maxPositions: 8,
    maxPerSymbol: 5,
    openPositions: 0,
    sameSymbol: 0,
    openRisk: 0,
    halted: null,
    longOnly: false,
    spreadPct: 0.01,
    maxSpreadPct: 0.15,
    seen: false,
    cooldownMsLeft: 0,
    entriesThisHour: 0,
    maxEntriesHour: 10,
    minRR: 1.25,
    consecLosses: 0,
    consecLimit: 3,
    lossPause: false,
    goalReached: false,
    goalBlocks: true,
    ageMs: 1000,
    tfMs: 900_000,
    regime: "Trending",
    duplicateSetup: false,
  };
  assert.equal(checkRisk(base).ok, true);
  assert.equal(checkRisk({ ...base, dayPnl: -250 }).ok, false);
  assert.equal(checkRisk({ ...base, seen: true }).ok, false);
  assert.equal(checkRisk({ ...base, side: "SELL", plan: makePlan("SELL", 100, 1, null, 1.5), longOnly: true }).ok, false);
  assert.equal(checkRisk({ ...base, goalReached: true }).ok, false);
});

test("paper account round trip and stop precedence", () => {
  const acct = freshAccount(10_000, Date.parse("2026-10-25T12:00:00Z"));
  const pos: BookPosition = {
    id: "1",
    symbol: "BTCUSDT",
    side: "BUY",
    qty: 0.01,
    entry: 100,
    stop: 90,
    target: 120,
    openedAt: acct.startEquity,
    fees: 0,
    plannedRisk: 0.1,
    reason: "test",
    quality: 70,
    strategy: "trend",
    mode: "normal",
    venue: "paper",
    protection: "local-monitor",
    brokerOrderId: null,
    status: "open",
  };
  const opened = openPosition(acct, pos);
  assert.ok(!("error" in opened));
  if ("error" in opened) return;
  const hit = protectiveIntent(opened.position, 110, { h: 121, l: 89 }, { trail: false, now: Date.now(), maxHoldMin: 0 });
  assert.equal(hit?.type, "close");
  if (hit?.type === "close") assert.match(hit.reason, /Stop/);
  const closed = closePosition(opened.account, opened.position, 110, "target", Date.now());
  assert.ok((closed.closed.pnl ?? 0) !== 0);
  assert.equal(closed.remainder, null);
});

test("disarmed cycle still manages exits but does not enter", () => {
  const candles = trendCandles();
  const pos: BookPosition = {
    id: "1",
    symbol: "BTCUSDT",
    side: "BUY",
    qty: 0.01,
    entry: candles[0]!.c,
    stop: candles[candles.length - 1]!.c + 10,
    target: candles[candles.length - 1]!.c + 50,
    openedAt: Date.now() - 60_000,
    fees: 0,
    plannedRisk: 1,
    reason: "test",
    quality: 80,
    strategy: "trend",
    mode: "mad",
    venue: "paper",
    protection: "local-monitor",
    brokerOrderId: null,
    status: "open",
  };
  // stop is above price for a long, so it is already through the stop
  const cycle = planCycle({
    now: candles[candles.length - 1]!.t + 900_000,
    mode: "mad",
    interval: "15m",
    armed: false,
    rows: [{ symbol: "BTCUSDT", candles, spreadPct: 0.01, tradable: true, longOnly: true }],
    positions: [pos],
    marks: { BTCUSDT: candles[candles.length - 1]!.c },
    equity: 10_000,
    cash: 9_000,
    dayPnl: 0,
    startEquity: 10_000,
    riskPct: 0.25,
    maxOpenRiskPct: 1,
    dailyLossPct: 2,
    maxPositions: 8,
    maxPerSymbol: 5,
    consecLosses: 0,
    consecLimit: 3,
    lossPause: false,
    goalReached: false,
    seen: [],
    recent: [],
    trail: false,
  });
  assert.equal(cycle.entries.length, 0);
  assert.ok(cycle.exits.some((e) => e.type === "close"));
});
