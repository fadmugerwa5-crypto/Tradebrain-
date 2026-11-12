import assert from "node:assert/strict";
import test from "node:test";
import { cleanCredential, credentialShape, maskCredential, roundToTick } from "../brokers/creds.ts";
import { snapshot } from "./analyze.ts";
import { buildAnnotations, type LayerFlags } from "./annotate.ts";
import { ema, macdHist, macdSeries } from "./indicators.ts";
import { equalLevels, lineAt, previousDayLevels, swingLabels, trendlines } from "./layers.ts";
import type { Candle } from "./types.ts";
import { freshAccount, type BookPosition } from "../trade/account.ts";
import { GOAL_DEFAULTS, evalGoal, realizedSince, startOfUtcWeek } from "../trade/goal.ts";
import { planCycle } from "../trade/planner.ts";

const DAY = 86_400_000;
const ALL: LayerFlags = { plan: true, trend: true, ema: true, bb: true, vwap: true, levels: true, zones: true, structure: true, liquidity: true, prevDay: true };
const NONE: LayerFlags = { plan: false, trend: false, ema: false, bb: false, vwap: false, levels: false, zones: false, structure: false, liquidity: false, prevDay: false };

/** Rising zigzag with a few displacement candles so swings, levels and zones all exist. */
function waves(n = 260, start = Date.UTC(2026, 0, 1)): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 6) * 1.6 + i * 0.05;
    const o = p;
    let c = 100 + wave + (i % 37 === 0 ? 3 : 0);
    const h = Math.max(o, c) + 0.3;
    const l = Math.min(o, c) - 0.3;
    out.push({ t: start + i * 900_000, o, h, l, c, v: 1000 + (i % 13) * 50 });
    p = c;
    c = p;
  }
  return out;
}

function pos(over: Partial<BookPosition>): BookPosition {
  return {
    id: crypto.randomUUID(),
    symbol: "BTCUSDT",
    side: "BUY",
    qty: 1,
    entry: 100,
    stop: 99,
    target: 102,
    openedAt: 0,
    fees: 0,
    plannedRisk: 1,
    reason: "t",
    quality: 70,
    strategy: "t",
    mode: "normal",
    venue: "paper",
    protection: "local-monitor",
    brokerOrderId: null,
    status: "closed",
    pnl: 0,
    closedAt: 0,
    ...over,
  };
}

test("cleanCredential strips zero-width characters, spaces, quotes and line breaks", () => {
  const raw = "\u200BAbC123\n def456 \u201C\u00A0";
  const c = cleanCredential(raw);
  assert.equal(c.value, "AbC123def456");
  assert.equal(c.removed, raw.length - c.value.length);
  assert.ok(c.removed >= 5);
});

test("credentialShape flags identical key and secret, odd characters and odd lengths", () => {
  const k = "a".repeat(64);
  assert.equal(credentialShape(k, "b".repeat(64)).ok, true);
  assert.match(credentialShape(k, k).notes.join(" "), /identical/);
  assert.match(credentialShape("abc$", "b".repeat(64)).notes.join(" "), /characters/);
  assert.match(credentialShape("short", "b".repeat(64)).notes.join(" "), /unusual/);
  assert.equal(credentialShape("", "").ok, false);
});

test("maskCredential never shows the middle of a secret", () => {
  const secret = "ABCDEFGH1234567890IJKLMNOP";
  const m = maskCredential(secret);
  assert.ok(!m.includes("1234567890"));
  assert.match(m, /^ABCD…MNOP \(26 chars\)$/);
  assert.equal(maskCredential(""), "empty");
});

test("roundToTick respects direction and tick precision", () => {
  assert.equal(roundToTick(100.037, 0.01, "down"), 100.03);
  assert.equal(roundToTick(100.031, 0.01, "up"), 100.04);
  assert.equal(roundToTick(100.034, 0.01), 100.03);
  assert.equal(roundToTick(0.00012345, 0.00000001, "down"), 0.00012345);
});

test("macdSeries lines up with macdHist and the signal is an EMA of the line", () => {
  const closes = waves().map((c) => c.c);
  const m = macdSeries(closes);
  const h = macdHist(closes);
  assert.equal(m.hist.length, closes.length);
  for (let i = 0; i < closes.length; i++) {
    if (h[i] == null) assert.equal(m.hist[i], null);
    else assert.ok(Math.abs((m.hist[i] ?? NaN) - h[i]!) < 1e-9, `hist mismatch at ${i}`);
  }
  const i = closes.length - 1;
  assert.ok(Math.abs(m.line[i]! - m.signal[i]! - m.hist[i]!) < 1e-9);
  // custom periods change the output
  assert.notEqual(macdSeries(closes, 5, 10, 4).line[i], m.line[i]);
  assert.ok(ema(closes, 9)[i] != null);
});

test("goal: realized only, per-window, and unrealized never counts", () => {
  const now = Date.UTC(2026, 9, 21, 15, 0); // Wednesday
  const account = freshAccount(10_000, now);
  const positions = [
    pos({ pnl: 40, closedAt: now - 3_600_000 }), // today
    pos({ pnl: 30, closedAt: startOfUtcWeek(now) + 3_600_000 }), // earlier this week
    pos({ pnl: 500, closedAt: now - 20 * DAY }), // long ago
    pos({ status: "open", pnl: undefined, closedAt: undefined }),
  ];
  assert.equal(realizedSince(positions, now - DAY), 40);
  const s = evalGoal({
    goal: { ...GOAL_DEFAULTS, session: 0, daily: 50, weekly: 60, maxDrawdownPct: 0 },
    positions,
    account,
    equity: 10_070 + 9_999, // huge unrealized must be ignored
    peakEquity: 0,
    unrealized: 9_999,
    now,
  });
  const daily = s.rows.find((r) => r.key === "daily")!;
  const weekly = s.rows.find((r) => r.key === "weekly")!;
  assert.equal(daily.realized, 40);
  assert.equal(daily.reached, false);
  assert.equal(daily.remaining, 10);
  assert.equal(weekly.realized, 70);
  assert.equal(weekly.reached, true);
  assert.equal(s.blocks, true);
  assert.match(s.reason ?? "", /Weekly target reached/);
});

test("goal: percent basis converts from starting equity, and 'continue' does not block", () => {
  const now = Date.UTC(2026, 9, 21, 15, 0);
  const account = freshAccount(20_000, now);
  const positions = [pos({ pnl: 250, closedAt: now - 1000 })];
  const stop = evalGoal({ goal: { ...GOAL_DEFAULTS, basis: "percent", session: 1, maxDrawdownPct: 0 }, positions, account, equity: 20_250, peakEquity: 20_250, unrealized: 0, now });
  assert.equal(stop.rows[0]!.target, 200);
  assert.equal(stop.rows[0]!.reached, true);
  assert.equal(stop.blocks, true);
  const go = evalGoal({ goal: { ...GOAL_DEFAULTS, basis: "percent", session: 1, maxDrawdownPct: 0, onReach: "continue" }, positions, account, equity: 20_250, peakEquity: 20_250, unrealized: 0, now });
  assert.equal(go.anyReached, true);
  assert.equal(go.blocks, false);
});

test("goal: drawdown from peak and session expiry block new entries", () => {
  const now = Date.UTC(2026, 9, 21, 15, 0);
  const account = freshAccount(10_000, now);
  const dd = evalGoal({ goal: { ...GOAL_DEFAULTS, session: 0, maxDrawdownPct: 3 }, positions: [], account, equity: 9_600, peakEquity: 10_000, unrealized: 0, now });
  assert.ok(Math.abs(dd.drawdownPct - 4) < 1e-9);
  assert.equal(dd.drawdownBreached, true);
  assert.equal(dd.blocks, true);
  const ok = evalGoal({ goal: { ...GOAL_DEFAULTS, session: 0, maxDrawdownPct: 5 }, positions: [], account, equity: 9_600, peakEquity: 10_000, unrealized: 0, now });
  assert.equal(ok.blocks, false);
  const exp = evalGoal({ goal: { ...GOAL_DEFAULTS, session: 0, maxDrawdownPct: 0, sessionHours: 2, sessionStart: now - 3 * 3_600_000 }, positions: [], account, equity: 10_000, peakEquity: 10_000, unrealized: 0, now });
  assert.equal(exp.sessionExpired, true);
  assert.equal(exp.blocks, true);
});

test("previousDayLevels only reports a complete previous UTC day", () => {
  const dayStart = Date.UTC(2026, 2, 10);
  const mk = (from: number, count: number): Candle[] =>
    Array.from({ length: count }, (_, i) => ({ t: from + i * 3_600_000, o: 10, h: 11 + (i === 5 ? 4 : 0), l: 9 - (i === 7 ? 3 : 0), c: 10, v: 1 }));
  const full = mk(dayStart, 48); // yesterday + today
  const pd = previousDayLevels(full)!;
  assert.equal(pd.high, 15);
  assert.equal(pd.low, 6);
  assert.equal(pd.day, "2026-03-10");
  // window that starts mid-way through the previous day is incomplete
  assert.equal(previousDayLevels(mk(dayStart + 6 * 3_600_000, 40)), null);
  assert.equal(previousDayLevels(mk(dayStart + DAY, 10)), null);
});

test("equalLevels groups swings inside tolerance and ignores singles", () => {
  const eq = equalLevels({ highs: [{ p: 100, i: 1 }, { p: 100.1, i: 9 }, { p: 105, i: 20 }], lows: [{ p: 90, i: 3 }, { p: 95, i: 11 }] }, 0.3);
  assert.equal(eq.highs.length, 1);
  assert.equal(eq.highs[0]!.n, 2);
  assert.equal(eq.lows.length, 0);
});

test("swingLabels and trendlines follow the definitions", () => {
  const piv = { highs: [{ i: 5, p: 10 }, { i: 15, p: 12 }, { i: 25, p: 11 }], lows: [{ i: 10, p: 5 }, { i: 20, p: 6 }, { i: 30, p: 5.5 }] };
  assert.deepEqual(
    swingLabels(piv).map((s) => s.label),
    ["HH", "HL", "LH", "LL"],
  );
  assert.equal(trendlines({ highs: piv.highs, lows: [{ i: 10, p: 5 }, { i: 20, p: 6 }] }).filter((t) => t.kind === "support").length, 1);
  // last two lows falling and last two highs rising -> no lines
  assert.equal(trendlines({ highs: [{ i: 1, p: 1 }, { i: 2, p: 2 }], lows: [{ i: 1, p: 5 }, { i: 2, p: 4 }] }).length, 0);
  const t = trendlines({ highs: [], lows: [{ i: 10, p: 5 }, { i: 20, p: 6 }] })[0]!;
  assert.equal(lineAt(t, 30), 7);
});

test("annotations: disabled layers draw nothing, enabled ones carry reasons from real calculations", () => {
  const candles = waves();
  const snap = snapshot(candles, 1.5)!;
  assert.ok(snap);
  const none = buildAnnotations(candles, snap, NONE, { action: "BUY", entry: 1, stop: 0.5, target: 2 });
  assert.equal(none.lines.length + none.boxes.length + none.markers.length + none.trend.length + none.notes.length, 0);
  const all = buildAnnotations(candles, snap, ALL, { action: "BUY", entry: snap.price, stop: snap.price - 1, target: snap.price + 2 });
  assert.ok(all.notes.length > 0);
  for (const n of all.notes) assert.ok(n.why.length > 10, `annotation "${n.label}" has no reason`);
  assert.equal(all.lines.filter((l) => l.layer === "plan").length, 3);
  // every marker sits on a real candle time and markers are time-sorted
  const times = new Set(candles.map((c) => Math.floor(c.t / 1000)));
  for (const m of all.markers) assert.ok(times.has(m.t));
  for (let i = 1; i < all.markers.length; i++) assert.ok(all.markers[i - 1]!.t <= all.markers[i]!.t);
  // no plan line for WAIT
  const wait = buildAnnotations(candles, snap, ALL, { action: "WAIT", entry: 1, stop: 0.5, target: 2 });
  assert.equal(wait.lines.filter((l) => l.layer === "plan").length, 0);
  // too little data -> nothing
  assert.equal(buildAnnotations(candles.slice(0, 30), null, ALL, null).notes.length, 0);
});

test("a hard halt reason blocks entries that would otherwise be approved", () => {
  const candles: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 200; i++) {
    const o = p;
    const c = p + 0.35 + Math.sin(i / 9) * 0.08;
    candles.push({ t: 1_700_000_000_000 + i * 900_000, o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.04, c, v: 1000 + i * 10 });
    p = c;
  }
  const base = {
    now: candles[candles.length - 1]!.t + 60_000,
    mode: "mad" as const,
    interval: "15m" as const,
    armed: true,
    rows: [{ symbol: "BTCUSDT", candles, spreadPct: 0.01, tradable: true, longOnly: false, step: 0.0001, minNotional: 5 }],
    positions: [],
    marks: { BTCUSDT: candles[candles.length - 1]!.c },
    equity: 10_000,
    cash: 10_000,
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
    trail: true,
  };
  assert.equal(planCycle(base).entries.length, 1, "control case must produce an entry or this test proves nothing");
  const halted = planCycle({ ...base, halted: "Drawdown 5.00% reached the 5% limit." });
  assert.equal(halted.entries.length, 0);
  assert.match(halted.decisions[0]!.blocked ?? "", /Not halted: Drawdown/);
  const goal = planCycle({ ...base, goalReached: true });
  assert.equal(goal.entries.length, 0);
  assert.match(goal.decisions[0]!.blocked ?? "", /Profit goal/);
});
