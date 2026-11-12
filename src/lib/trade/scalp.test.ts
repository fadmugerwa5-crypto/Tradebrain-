import assert from "node:assert/strict";
import test from "node:test";
import { protectiveIntent, type BookPosition } from "./account.ts";
import { SCALP_DEFAULTS, derivHiveLossCut, feeGate, givebackHalt, lossCooldown, riskScale, scalpFor, wonSince } from "./scalp.ts";

const cfg = { ...SCALP_DEFAULTS };
const base: BookPosition = {
  id: "a", symbol: "BTCUSDT", side: "BUY", qty: 1, entry: 100, stop: 98, target: 104, openedAt: 0, fees: 0, plannedRisk: 2,
  reason: "", quality: 80, strategy: "t", mode: "aggressive", venue: "paper", protection: "local-monitor", brokerOrderId: null, status: "open",
};
const closed = (pnl: number, closedAt: number, symbol = "BTCUSDT"): BookPosition => ({ ...base, id: String(closedAt), symbol, status: "closed", pnl, closedAt });
const opts = { trail: true, now: 1000, maxHoldMin: 120, scalp: { quickR: 0.6, lockR: 0.4 } };

test("scalp only applies in aggressive mode when enabled", () => {
  assert.ok(scalpFor("aggressive", cfg));
  assert.equal(scalpFor("normal", { ...cfg, normalScalp: false }), null);
  assert.equal(scalpFor("mad", cfg), null);
  assert.equal(scalpFor("aggressive", { ...cfg, enabled: false }), null);
});

test("quick profit closes at 0.6R, not at the far target", () => {
  const r = protectiveIntent(base, 101.3, { h: 101.3, l: 100 }, opts);
  assert.equal(r?.type, "close");
});

test("without scalp the same price does nothing", () => {
  assert.equal(protectiveIntent(base, 101.3, { h: 101.3, l: 100 }, { ...opts, scalp: undefined }), null);
});

test("breakeven lock moves the stop above entry by the fees and never widens it", () => {
  const r = protectiveIntent(base, 100.9, { h: 100.9, l: 100 }, opts);
  assert.equal(r?.type, "tighten");
  if (r?.type === "tighten") assert.ok(r.stop > 100 && r.stop < 100.9);
  const locked = { ...base, stop: 100.5 };
  assert.equal(protectiveIntent(locked, 100.9, { h: 100.9, l: 100.6 }, opts)?.type === "tighten", false);
});

test("short side mirrors", () => {
  const s = { ...base, side: "SELL" as const, stop: 102, target: 96 };
  assert.equal(protectiveIntent(s, 98.7, { h: 100, l: 98.7 }, opts)?.type, "close");
});

test("fee gate blocks tiny stops and allows wide ones", () => {
  assert.ok(feeGate(100, 99.8, cfg));
  assert.equal(feeGate(100, 98, cfg), null);
});

test("loss cool-off applies per symbol and expires", () => {
  const ps = [closed(-5, 1_000_000)];
  assert.ok(lossCooldown(ps, "BTCUSDT", 1_000_000 + 60_000, cfg));
  assert.equal(lossCooldown(ps, "BTCUSDT", 1_000_000 + 6 * 60_000, cfg), null);
  assert.equal(lossCooldown(ps, "ETHUSDT", 1_000_000 + 60_000, cfg), null);
});

test("win skips the entry cooldown", () => {
  assert.equal(wonSince([closed(2, 500)], "BTCUSDT", 400), true);
  assert.equal(wonSince([closed(-2, 500)], "BTCUSDT", 400), false);
});

test("size halves after two losses and never grows", () => {
  assert.equal(riskScale(0, cfg), 1);
  assert.equal(riskScale(1, cfg), 1);
  assert.equal(riskScale(2, cfg), 0.5);
  assert.equal(riskScale(5, cfg), 0.5);
});

test("giveback halts the day after half the best profit is lost", () => {
  const now = Date.UTC(2026, 9, 26, 15);
  const t = (h: number) => Date.UTC(2026, 9, 26, h);
  assert.equal(givebackHalt([closed(10, t(9)), closed(-3, t(10))], now, cfg, 1), null);
  assert.ok(givebackHalt([closed(10, t(9)), closed(-6, t(10))], now, cfg, 1));
  assert.equal(givebackHalt([closed(10, t(9)), closed(-6, t(10))], now, cfg, 20), null);
  assert.equal(givebackHalt([closed(10, t(9)), closed(-6, Date.UTC(2026, 9, 25, 10))], now, cfg, 1), null);
});

import { favorableR, manageBrief, entryBrief, extractJson, parseEntry, parseManage } from "./aiscalp.ts";
import { strategyBlocked } from "./scalp.ts";
import { summarize } from "./stats.ts";

const withRisk = (o: Partial<BookPosition>): BookPosition => ({ ...base, plannedRisk: 2, qty: 1, ...o });

test("after the breakeven lock, R is still measured from the original stop (v17 bug)", () => {
  const locked = withRisk({ stop: 100.3 }); // stop moved up by the lock; original stop was 98, so 1R = 2
  // 0.5R profit = 101: below the 0.6R quick profit, so nothing should happen and certainly no tiny-profit close
  assert.equal(protectiveIntent(locked, 101, { h: 101, l: 100.4 }, opts), null);
  // 0.7R profit = 101.4: now it banks
  assert.equal(protectiveIntent(locked, 101.4, { h: 101.4, l: 100.4 }, opts)?.type, "close");
});

test("the old 1.6R scale-out does not fire repeatedly on a locked stop", () => {
  const locked = withRisk({ stop: 100.3 });
  const r = protectiveIntent(locked, 100.8, { h: 100.8, l: 100.4 }, { ...opts, scalp: { quickR: 1.5, lockR: 0.4 } });
  assert.notEqual(r?.type, "reduce");
});

test("extractJson survives code fences and chatter", () => {
  assert.deepEqual(extractJson('```json\n{"action":"TAKE"}\n```'), { action: "TAKE" });
  assert.deepEqual(extractJson('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

test("AI entry reply is validated and clamped", () => {
  const e = { entry: 100, stop: 98 };
  const ok = parseEntry('{"action":"take","quickR":5,"sizeMult":3,"reason":"clean break"}', e, cfg)!;
  assert.equal(ok.action, "TAKE");
  assert.equal(ok.quickR, 1.0); // clamped down from 5
  assert.equal(ok.sizeMult, 1); // can never grow size
  assert.equal(parseEntry('{"action":"TAKE","sizeMult":0.01}', e, cfg)!.sizeMult, 0.25);
  assert.equal(parseEntry('{"action":"BUY"}', e, cfg), null);
  assert.equal(parseEntry("garbage", e, cfg), null);
  assert.equal(parseEntry('{"action":"SKIP","reason":"chasing"}', e, cfg)!.action, "SKIP");
});

test("AI cannot pick a profit level that fees would eat", () => {
  const e = { entry: 100, stop: 99 }; // 1% stop. need = 2 * 0.24% / 1% = 0.48R
  const r = parseEntry('{"action":"TAKE","quickR":0.4}', e, cfg)!;
  assert.ok(r.quickR >= 0.48 - 1e-9);
});

test("AI stop suggestions must tighten and stay behind price", () => {
  const pos = withRisk({});
  assert.equal(parseManage('{"action":"TIGHTEN","stop":100.5}', pos, 101.5)?.action, "TIGHTEN");
  assert.equal(parseManage('{"action":"TIGHTEN","stop":97}', pos, 101.5)?.action, "HOLD"); // wider than the old stop
  assert.equal(parseManage('{"action":"TIGHTEN","stop":102}', pos, 101.5)?.action, "HOLD"); // beyond price
  assert.equal(parseManage('{"action":"EXIT","reason":"stalled"}', pos, 101.5)?.action, "EXIT");
  assert.equal(parseManage("nope", pos, 101.5), null);
  const sell = withRisk({ side: "SELL", stop: 102, target: 96 });
  assert.equal(parseManage('{"action":"TIGHTEN","stop":100}', sell, 99)?.action, "TIGHTEN");
  assert.equal(parseManage('{"action":"TIGHTEN","stop":98}', sell, 99)?.action, "HOLD");
});

test("favorable R uses the original risk", () => {
  assert.equal(favorableR(withRisk({ stop: 100.3 }), 101), 0.5);
  assert.equal(favorableR(withRisk({ side: "SELL", stop: 102 }), 99), 0.5);
});

test("briefs carry the key facts and stay short", () => {
  const ctx = { symbol: "BTCUSDT", interval: "15m", candles: Array.from({ length: 10 }, (_, i) => ({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i })), dayPnl: 3.2, dailyRemaining: 6.8, recent: ["BUY win 12m ago"], consecLosses: 1, openCount: 2 };
  const b = entryBrief({ side: "BUY", entry: 100, stop: 98, target: 104, quality: 72, regime: "Trending", strategy: "trend", reason: "x" }, [{ name: "Trend", verdict: "BUY", score: 80 }], 0.02, cfg, ctx);
  assert.ok(b.includes("BTCUSDT") && b.includes("fees") && b.includes("6.80 left"));
  assert.ok(b.length < 3000);
  const m = manageBrief(withRisk({}), 101.2, 5 * 60_000, ctx);
  assert.ok(m.includes("0.60R") && m.includes("Held 5 min"));
});

test("strategy guard needs 10 trades, then blocks a net loser", () => {
  const mk = (n: number, pnl: number) => Array.from({ length: n }, (_, i) => ({ ...closed(pnl, 1000 + i), mode: "aggressive", strategy: "s1" }));
  assert.equal(strategyBlocked(mk(9, -1), "s1", cfg), null);
  assert.ok(strategyBlocked(mk(12, -1), "s1", cfg));
  assert.equal(strategyBlocked(mk(12, 1), "s1", cfg), null);
  assert.equal(strategyBlocked(mk(12, -1), "other", cfg), null);
  assert.equal(strategyBlocked(mk(12, -1), "s1", { ...cfg, stratGuard: false }), null);
});

test("stats summary", () => {
  const ps = [closed(4, 1), closed(-2, 2), closed(2, 3), { ...closed(0, 4), status: "open" as const }];
  const s = summarize(ps);
  assert.equal(s.n, 3);
  assert.equal(s.wins, 2);
  assert.equal(s.net, 4);
  assert.equal(s.avgWin, 3);
  assert.equal(s.avgLoss, -2);
  assert.equal(s.profitFactor, 3);
});

import { derivExit } from "./scalp.ts";

test("deriv scalp sells early at the profit level and only when sellable", () => {
  assert.equal(derivExit({ profit: 4, stake: 10, canSell: true }, cfg)?.kind, "take"); // 40% >= 35%
  assert.equal(derivExit({ profit: 3, stake: 10, canSell: true }, cfg), null);
  assert.equal(derivExit({ profit: 9, stake: 10, canSell: false }, cfg), null);
  assert.equal(derivExit({ profit: -9, stake: 10, canSell: true }, cfg), null); // cut loss is off by default
  assert.equal(derivExit({ profit: -6, stake: 10, canSell: true }, { ...cfg, derivCutPct: 50 })?.kind, "cut");
  assert.equal(derivExit({ profit: 9, stake: 10, canSell: true }, { ...cfg, derivTakePct: 0 }), null);
});

import { derivNormalExit } from "./scalp.ts";

test("normal mode scalps: small profit, bounce after a dip, loss cap, time stop", () => {
  const n = { ...cfg, normalScalp: true, normalTakePct: 9, normalDipPct: 5, normalRecoverPct: 3, normalCutPct: 35, normalTimeFrac: 0.7 };
  const ok = { canSell: true, stake: 19, worstPct: 0, elapsedFrac: 0.2 };
  assert.equal(derivNormalExit({ ...ok, profit: 1.8 }, n)?.kind, "take"); // 9.5%
  assert.equal(derivNormalExit({ ...ok, profit: 1.0 }, n), null); // small profit, keep waiting
  assert.equal(derivNormalExit({ ...ok, profit: -3 }, n), null); // in a loss: wait
  assert.equal(derivNormalExit({ ...ok, profit: 0.7, worstPct: -12 }, n)?.kind, "bounce"); // dipped, now +3.7%
  assert.equal(derivNormalExit({ ...ok, profit: 0.2, worstPct: -12 }, n), null); // not back far enough
  assert.equal(derivNormalExit({ ...ok, profit: -7, worstPct: -37 }, n)?.kind, "cut"); // -36.8%
  assert.equal(derivNormalExit({ ...ok, profit: -2, elapsedFrac: 0.75 }, n)?.kind, "time");
  assert.equal(derivNormalExit({ ...ok, profit: -2, elapsedFrac: null }, n), null);
  assert.equal(derivNormalExit({ ...ok, profit: 5, canSell: false }, n), null);
});

test("scalpFor: normal uses the scalp rules only when normalScalp is on", () => {
  assert.ok(scalpFor("normal", { ...cfg, normalScalp: true }));
  assert.equal(scalpFor("normal", { ...cfg, normalScalp: false }), null);
  assert.equal(scalpFor("normal", { ...cfg, enabled: false, normalScalp: true }), null);
  assert.ok(scalpFor("aggressive", cfg));
});

test("Hive Deriv contracts ignore ordinary negative fluctuations and enforce only the delayed hard loss guard", () => {
  assert.equal(derivHiveLossCut({ profit: -0.2, stake: 1, heldSec: 120, canSell: true }), false);
  assert.equal(derivHiveLossCut({ profit: -0.7, stake: 1, heldSec: 30, canSell: true }), false);
  assert.equal(derivHiveLossCut({ profit: -0.7, stake: 1, heldSec: 60, canSell: true }), true);
  assert.equal(derivHiveLossCut({ profit: -0.7, stake: 1, heldSec: 60, canSell: false }), false);
});

test("Deriv default exits allow normal price fluctuation instead of time-closing at 70%", () => {
  assert.equal(SCALP_DEFAULTS.normalTimeFrac, 0);
  assert.equal(SCALP_DEFAULTS.normalMinHoldSec, 60);
  assert.equal(SCALP_DEFAULTS.normalCutPct, 50);
});
