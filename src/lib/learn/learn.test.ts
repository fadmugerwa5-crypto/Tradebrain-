import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../market/types.ts";
import { analyzeTrade } from "./analyzer.ts";
import { runLab } from "./backtest.ts";
import { evaluate, findPatterns, learnStep } from "./learn.ts";
import { alignOf, buildContext, detectRegime, htfBias, resample, sessionOf } from "./regime.ts";
import { baselineVersion, decide, matchSpec, type Facts } from "./rules.ts";
import { diary, guardPatch, mistakeRegister, reflect } from "./reflection.ts";
import { clusterR, confidenceOf, metricsOfR, recordsToCsv } from "./stats.ts";
import { FILTERS0, LEARN0, type Candidate, type ContextSnapshot, type TradeRecord } from "./types.ts";

const T0 = 1_700_000_000_000 - (1_700_000_000_000 % 86_400_000);
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;

function candles(n: number, tf: number, drift: number, vol: number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * (1 + drift + rnd() * vol);
    out.push({ t: T0 + i * tf, o, h: Math.max(o, c) * (1 + Math.abs(rnd()) * vol * 0.4), l: Math.min(o, c) * (1 - Math.abs(rnd()) * vol * 0.4), c, v: 1000 });
    p = c;
  }
  return out;
}

const ctx = (over: Partial<ContextSnapshot> = {}): ContextSnapshot => ({ regime: "range", regimeWhy: "", htfMin: 15, htfBias: "up", htfWhy: "up", align: "with", structure: "mixed", adx: 15, atrPct: 0.3, atrRank: 0.5, bbwRank: 0.5, extensionAtr: 0.2, stopAtr: 1.2, spreadPct: 0.01, candleTime: T0, tfMin: 5, ...over });
let id = 0;
function rec(over: Partial<TradeRecord> & { r: number }): TradeRecord {
  id++;
  const { r, ...rest } = over;
  return { id: `t${id}`, openedAt: T0 + id * 3_600_000, closedAt: T0 + id * 3_600_000 + 600_000, symbol: "BTCUSDT", label: "BTC", venue: "paper", mode: "paper", book: "scalp", side: "BUY", strategy: "ema-pullback", strategyVersion: "v33", entry: 100, stop: 99, target: 102, exit: 100, qty: 1, fees: 0.1, pnl: r, riskUnit: 1, r, exitReason: "stop", exitKind: "stop", session: "london", holdMin: 10, ai: "rules-only", aiNote: "", configVersion: "v0", ctx: ctx(), backfilled: false, ...rest };
}
const facts = (o: Partial<Facts> = {}): Facts => ({ strategy: "ema-pullback", symbol: "BTCUSDT", side: "BUY", regime: "range", session: "london", align: "with", ...o });

test("resample joins only complete clock-aligned groups", () => {
  const c = candles(31, 300_000, 0, 0.001); // 31 bars of 5m from midnight = 10 full 15m bars + 1 spare
  const h = resample(c, 300_000, 3);
  assert.equal(h.length, 10);
  assert.equal(h[0]!.t, T0);
  assert.equal(h[0]!.h, Math.max(c[0]!.h, c[1]!.h, c[2]!.h));
  assert.equal(h[9]!.c, c[29]!.c);
});

test("regime: strong steady rise is trend-up; the 15m bias is up and aligns with a BUY", () => {
  const c: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 300; i++) {
    const o = p;
    p = p * (1 + 0.0015 + Math.sin(i / 5) * 0.0008);
    c.push({ t: T0 + i * 300_000, o, h: Math.max(o, p) * 1.0004, l: Math.min(o, p) * 0.9996, c: p, v: 100 });
  }
  const r = detectRegime(c);
  assert.equal(r.regime, "trend-up", r.why);
  const b = htfBias(c, 300_000, 15);
  assert.equal(b.bias, "up");
  assert.equal(alignOf("BUY", b.bias), "with");
  assert.equal(alignOf("SELL", b.bias), "against");
  assert.equal(alignOf("BUY", "flat"), "neutral");
});

test("regime: too few candles is unclear, never a guess", () => {
  assert.equal(detectRegime(candles(30, 300_000, 0, 0.002)).regime, "unclear");
  assert.equal(buildContext({ candles: candles(30, 300_000, 0, 0.002), now: T0 + 40 * 300_000, side: "BUY", entry: 100, stop: 99, spreadPct: null, htfMin: 15 }), null);
});

test("no look-ahead: the forming candle is dropped and later candles cannot change the snapshot", () => {
  const c = candles(300, 300_000, 0.0002, 0.003);
  const now = c[299]!.t + 60_000; // last candle is still forming
  const a = buildContext({ candles: c, now, side: "BUY", entry: c[298]!.c, stop: c[298]!.c * 0.99, spreadPct: null, htfMin: 15 })!;
  const b = buildContext({ candles: c.slice(0, 299), now: c[299]!.t, side: "BUY", entry: c[298]!.c, stop: c[298]!.c * 0.99, spreadPct: null, htfMin: 15 })!;
  assert.equal(a.candleTime, c[298]!.t);
  assert.deepEqual({ ...a }, { ...b });
});

test("sessions", () => {
  assert.equal(sessionOf(T0 + 3 * 3_600_000), "asia");
  assert.equal(sessionOf(T0 + 9 * 3_600_000), "london");
  assert.equal(sessionOf(T0 + 13 * 3_600_000), "overlap");
  assert.equal(sessionOf(T0 + 18 * 3_600_000), "newyork");
  assert.equal(sessionOf(T0 + 22 * 3_600_000), "late");
});

test("metrics: expectancy, drawdown, losing run, confidence gates, wide interval for small samples", () => {
  const m = metricsOfR([1, -1, -1, -1, 2, 1]);
  assert.equal(m.n, 6);
  assert.equal(m.netR, 1);
  assert.ok(Math.abs(m.expectancy - 1 / 6) < 1e-9);
  assert.equal(m.maxLossStreak, 3);
  assert.equal(m.maxDrawdownR, 3);
  assert.equal(m.confidence, "insufficient");
  assert.ok(m.expCI[0] < 0 && m.expCI[1] > 0);
  assert.equal(confidenceOf(29), "low");
  assert.equal(confidenceOf(30), "medium");
  assert.equal(confidenceOf(100), "high");
});

test("six trades never count as proof: the pattern is labelled, no candidate is made", () => {
  const rs = Array.from({ length: 6 }, () => rec({ r: -1 }));
  const out = learnStep(rs, [], [], LEARN0);
  assert.equal(out.candidates.length, 0);
});

test("clustered entries on one market and side count once", () => {
  const base = T0;
  const rs = [rec({ r: -1, openedAt: base }), rec({ r: -1, openedAt: base + 60_000 }), rec({ r: -1, openedAt: base + 120_000 }), rec({ r: 1, openedAt: base + 5 * 3_600_000 })];
  assert.equal(clusterR(rs).length, 2);
});

test("analyzer: a loss with no standing-out condition is 'unknown', never an invented reason", () => {
  const r = rec({ r: -1, ctx: ctx({ align: "with", regime: "trend-up", extensionAtr: 0.2, stopAtr: 1.5 }), fees: 0.02 });
  const a = analyzeTrade(r, [r]);
  assert.equal(a.outcome, "loss");
  assert.equal(a.unknown, true);
  assert.equal(a.causes.length, 0);
});

test("analyzer: lists conditions that were really present, as hypotheses with evidence", () => {
  const r = rec({ r: -1, ctx: ctx({ align: "against", htfBias: "down", extensionAtr: 2, stopAtr: 0.5 }), fees: 0.4 });
  const a = analyzeTrade(r, [r]);
  const cats = a.causes.map((c) => c.category);
  assert.ok(cats.includes("market") && cats.includes("timing") && cats.includes("risk") && cats.includes("execution"));
  assert.ok(a.causes.every((c) => c.evidence.length > 0));
  assert.equal(a.unknown, false);
});

test("analyzer: a trade without stored context is still analysed without crashing", () => {
  const r = rec({ r: -1, ctx: null, backfilled: true });
  assert.equal(analyzeTrade(r, [r]).unknown, true);
});

/** 120 trades: ema-pullback in a range loses; everything else is mildly positive. */
function history(rangeLater = -0.8): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (let i = 0; i < 160; i++) {
    const inRange = i % 2 === 0;
    const later = i >= 100;
    const r = inRange ? (later ? rangeLater : -0.8) + (i % 4 === 0 ? 0.3 : -0.1) : 0.4 + (i % 3 === 0 ? 0.4 : -0.2);
    out.push(rec({ r, openedAt: T0 + i * 2 * 3_600_000, symbol: i % 2 ? "ETHUSDT" : "BTCUSDT", ctx: ctx({ regime: inRange ? "range" : "trend-up" }) }));
  }
  return out;
}

test("learning: a repeated weak pattern is confirmed on LATER unseen trades, then runs in shadow; nothing is active yet", () => {
  const h = history();
  const ev = evaluate({ strategy: "ema-pullback", regime: "range" }, h, LEARN0);
  assert.equal(ev.pass, true, ev.reason);
  const out = learnStep(h, [], [], LEARN0);
  const c = out.candidates.find((x) => x.spec.regime === "range" && x.spec.strategy === "ema-pullback" && Object.keys(x.spec).length === 2);
  assert.ok(c, "candidate exists");
  assert.equal(c!.status, "shadow");
  assert.notEqual(c!.status, "approved");
  assert.ok(out.events.some((e) => e.kind === "propose"));
});

test("learning: a pattern that does NOT hold on later trades is rejected, with the explanation kept", () => {
  const h = history(+0.9); // the range segment is profitable in the later 40%
  const ev = evaluate({ strategy: "ema-pullback", regime: "range" }, h, LEARN0);
  assert.equal(ev.pass, false);
  assert.match(ev.reason, /Rejected|not clearly negative/);
  const out = learnStep(h, [], [], LEARN0);
  assert.ok(!out.candidates.some((x) => x.status === "shadow" && x.spec.regime === "range" && x.spec.strategy === "ema-pullback" && Object.keys(x.spec).length === 2));
});

test("learning: shadow candidate becomes ready only after enough later matching trades still lose; fails if they win", () => {
  const h = history();
  const first = learnStep(h, [], [], LEARN0);
  const cand = first.candidates.find((x) => x.status === "shadow")!;
  assert.ok(cand);
  const lastT = h[h.length - 1]!.openedAt;
  const losing = Array.from({ length: 14 }, (_, k) => rec({ r: -0.7, openedAt: lastT + (k + 1) * 3 * 3_600_000, symbol: "BTCUSDT", ctx: ctx({ regime: cand.spec.regime ?? "range" }), strategy: cand.spec.strategy ?? "ema-pullback", side: cand.spec.side ?? "BUY", session: cand.spec.session ?? "london" }));
  const ok = learnStep([...h, ...losing], first.candidates, first.flagged, LEARN0);
  assert.equal(ok.candidates.find((x) => x.id === cand.id)!.status, "ready");
  const winning = losing.map((x, k) => ({ ...x, id: `w${k}`, r: 0.8, pnl: 0.8 }));
  const bad = learnStep([...h, ...winning], first.candidates, first.flagged, LEARN0);
  assert.equal(bad.candidates.find((x) => x.id === cand.id)!.status, "rejected");
});

test("learning never invents patterns from unknown context (older trades without a snapshot)", () => {
  const old = Array.from({ length: 120 }, (_, i) => rec({ r: i % 2 ? -1 : 0.2, ctx: null, backfilled: true }));
  const pats = findPatterns(old, 30).filter((p) => p.spec.regime != null || p.spec.align != null);
  assert.equal(pats.length, 0);
});

test("gate: pause blocks everything; filters only remove; a disable rule blocks; restrict needs the 15m bias with the trade", () => {
  const cfg = { rules: [], filters: { ...FILTERS0 } };
  assert.equal(decide(cfg, true, facts(), ctx(), 0.01).allow, false);
  assert.equal(decide(cfg, false, facts(), ctx(), 0.01).allow, true);
  assert.equal(decide({ rules: [], filters: { ...FILTERS0, htf: "block" } }, false, facts({ align: "against" }), ctx({ align: "against" }), null).allow, false);
  assert.equal(decide({ rules: [], filters: { ...FILTERS0, htf: "block" } }, false, facts({ align: "neutral" }), ctx({ align: "neutral" }), null).allow, true);
  assert.equal(decide({ rules: [], filters: { ...FILTERS0, standAside: true } }, false, facts(), ctx({ regime: "unclear" }), null).allow, false);
  assert.equal(decide({ rules: [], filters: { ...FILTERS0, maxSpreadPct: 0.05 } }, false, facts(), ctx(), 0.2).allow, false);
  const rule = (action: "disable" | "restrict") => ({ rules: [{ id: "r", spec: { strategy: "ema-pullback", regime: "range" as const }, action, source: "learned" as const, note: "", createdAt: 0 }], filters: { ...FILTERS0 } });
  assert.equal(decide(rule("disable"), false, facts(), ctx(), null).allow, false);
  assert.equal(decide(rule("disable"), false, facts({ regime: "trend-up" }), ctx(), null).allow, true);
  assert.equal(decide(rule("restrict"), false, facts({ align: "against" }), ctx({ align: "against" }), null).allow, false);
  const r = decide(rule("restrict"), false, facts({ align: "with" }), ctx(), null);
  assert.equal(r.allow, true);
  assert.ok(r.scoreAdj < 0);
});

test("gate can never raise score or risk: scoreAdj is never positive, and no learning type has a risk field", () => {
  for (const regime of ["range", "trend-up", "unclear"]) for (const align of ["with", "against", "neutral", "unknown"]) {
    const g = decide({ rules: [{ id: "r", spec: { strategy: "ema-pullback" }, action: "restrict", source: "user", note: "", createdAt: 0 }], filters: { ...FILTERS0 } }, false, facts({ regime, align }), ctx(), null);
    assert.ok(g.scoreAdj <= 0);
  }
  const keys = JSON.stringify([baselineVersion(), LEARN0, FILTERS0]).toLowerCase();
  assert.ok(!/riskpct|stake|leverage|maxpositions|dailyloss/.test(keys));
});

test("rules: segment matching", () => {
  assert.equal(matchSpec({ strategy: "a", regime: "range" }, facts({ strategy: "a", regime: "range" })), true);
  assert.equal(matchSpec({ strategy: "a", regime: "range" }, facts({ strategy: "a", regime: "squeeze" })), false);
  assert.equal(matchSpec({}, facts()), true);
});

test("csv export escapes commas and quotes", () => {
  const csv = recordsToCsv([rec({ r: 1, exitReason: 'hit "target", fast' })]);
  assert.match(csv, /"hit ""target"", fast"/);
  assert.equal(csv.split("\n").length, 2);
});

test("lab: chronological splits, costs lower results, holdout is the last stretch", () => {
  const c = candles(900, 300_000, 0.0003, 0.004);
  const a = runLab({ candles: c, kind: "scalp", htfMin: 15, costFrac: 0 });
  const b = runLab({ candles: c, kind: "scalp", htfMin: 15 });
  assert.ok(a.trades.length > 10);
  assert.equal(a.trades.length, b.trades.length);
  assert.ok(b.baseline.all.netR < a.baseline.all.netR);
  const maxTrain = Math.max(...b.trades.filter((t) => t.split === "train").map((t) => t.i));
  const minHold = Math.min(...b.trades.filter((t) => t.split === "holdout").map((t) => t.i));
  assert.ok(maxTrain < minHold);
  assert.ok(b.assumptions.length >= 4);
  assert.equal(b.noTradeR, 0);
  const s = runLab({ candles: candles(1000, 3_600_000, 0.0002, 0.006), kind: "swing", htfMin: 15 });
  assert.ok(Array.isArray(s.rows));
});

import { makeGate } from "./rules.ts";
import { registerMarkets } from "../market/types.ts";
import { SCALP_DEFAULTS } from "../trade/scalp.ts";
import { RADAR_DEFAULTS, runRadar } from "../trade/radar.ts";
import { SWING_DEFAULTS, planSwing } from "../trade/swing.ts";

const TF5 = 300_000;
function walkRadar(n: number, sd = 1, drift = 0.0008, vol = 0.008): Candle[] {
  let q = sd;
  const r = () => ((q = (q * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + drift + Math.sin(i / 7) * vol * 0.3 + r() * vol);
    out.push({ t: T0 + i * TF5, o, h: Math.max(o, p) * (1 + Math.abs(r()) * vol * 0.5), l: Math.min(o, p) * (1 - Math.abs(r()) * vol * 0.5), c: p, v: 1000 * (1 + Math.abs(r())) });
  }
  return out;
}

test("integration: the radar with an allow-all gate matches the radar without one; a blocking rule removes the setup and counts it", () => {
  registerMarkets([{ symbol: "AAAUSDT", label: "AAA/USDT", group: "Crypto spot", broker: "binance", open: true }]);
  const all = walkRadar(700);
  const cfg = { ...RADAR_DEFAULTS, minTrades: 1, minEdge: -1, minScore: 0 };
  const scalp = { ...SCALP_DEFAULTS, feeMult: 0 };
  let c: Candle[] = [];
  let plain = null as ReturnType<typeof runRadar> | null;
  let rows: { symbol: string; candles: Candle[]; spreadPct: number; tradable: boolean }[] = [];
  let now = 0;
  for (let n = 300; n <= 700 && !plain?.ranked.length; n++) {
    c = all.slice(0, n);
    now = c[c.length - 1]!.t + TF5 * 5;
    rows = [{ symbol: "AAAUSDT", candles: c, spreadPct: 0.02, tradable: true }];
    plain = runRadar({ rows, intervalMs: TF5, now, cfg, scalp });
  }
  assert.ok(plain && plain.ranked.length > 0, "test data must fire a signal on some bar");
  const mk = (rules: import("./types.ts").Rule[], filters = { ...FILTERS0 }, paused = false) => makeGate(() => ({ cfg: { rules, filters }, settings: { ...LEARN0, pauseSignals: paused } }));
  const open = runRadar({ rows, intervalMs: TF5, now, cfg, scalp, gate: mk([]) });
  assert.deepEqual(open.ranked.map((x) => [x.key, x.score]), plain.ranked.map((x) => [x.key, x.score]));
  assert.equal(open.rejected.learned, 0);
  assert.ok(open.ranked.every((x) => x.learn != null));
  const paused = runRadar({ rows, intervalMs: TF5, now, cfg, scalp, gate: mk([], { ...FILTERS0 }, true) });
  assert.equal(paused.ranked.length, 0);
  assert.ok(paused.rejected.learned >= plain.ranked.length);
  const off = plain.ranked[0]!;
  const blockOne = runRadar({ rows, intervalMs: TF5, now, cfg, scalp, gate: mk([{ id: "r", spec: { strategy: off.strategy, side: off.side }, action: "disable", source: "user", note: "", createdAt: 0 }]) });
  assert.ok(!blockOne.ranked.some((x) => x.strategy === off.strategy && x.side === off.side));
  assert.ok(blockOne.rejected.learned >= 1);
  const restricted = runRadar({ rows, intervalMs: TF5, now, cfg, scalp, gate: mk([{ id: "r", spec: { strategy: off.strategy }, action: "restrict", source: "user", note: "", createdAt: 0 }]) });
  const same = restricted.ranked.find((x) => x.key === off.key);
  if (same) assert.ok(same.score <= off.score);
});

test("integration: the Trades-tab planner treats a gate block as a normal blocked reason", () => {
  registerMarkets([{ symbol: "BBBUSDT", label: "BBB/USDT", group: "Crypto spot", broker: "binance", open: true }]);
  seed = 21;
  const c: Candle[] = [];
  let p = 100;
  const TF = 3_600_000;
  for (let i = 0; i < 700; i++) {
    const o = p;
    p = p * (1 + 0.0004 + Math.sin(i / 9) * 0.004 + rnd() * 0.01);
    c.push({ t: T0 + i * TF, o, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996, c: p, v: 1000 });
  }
  const now = c[c.length - 1]!.t + TF * 2;
  const cfg = { ...SWING_DEFAULTS, minTrades: 0, minEdge: -9, requireStable: false, dailyTrendFilter: false, minRR: 0 };
  const input = { now, cfg, armed: false, venue: "paper" as const, rows: [{ symbol: "BBBUSDT", label: "BBB", group: "Crypto", kind: "binance" as const, candles: c, spreadPct: 0.01, tradable: true, longOnly: false }], positions: [], equity: 10_000, cash: 10_000, dayPnl: 0, dayStartEquity: 10_000, dailyLossPct: 5, seen: [], halted: null };
  const plain = planSwing({ ...input, rows: [{ ...input.rows[0]!, candles: c.slice(0, 303) }], now: c[302]!.t + TF * 2 });
  assert.ok(plain.signals.length + plain.entries.length > 0, "test data must fire a swing signal");
  const gated = planSwing({ ...input, rows: [{ ...input.rows[0]!, candles: c.slice(0, 303) }], now: c[302]!.t + TF * 2, gate: makeGate(() => ({ cfg: { rules: [], filters: { ...FILTERS0 } }, settings: { ...LEARN0, pauseSignals: true } })) });
  assert.equal(gated.signals.length + gated.entries.length, plain.signals.length + plain.entries.length);
  assert.equal(gated.entries.length, 0);
  assert.ok(gated.signals.every((s) => s.status !== "ready"));
  if (plain.signals.length + plain.entries.length > 0) assert.ok(gated.signals.some((s) => /paused/i.test(s.blocked)));
});

test("reflection: a real repeated mistake is found with numbers; a small sample is not called a mistake", () => {
  const rs: TradeRecord[] = [];
  for (let i = 0; i < 80; i++) {
    const against = i % 3 === 0;
    rs.push(rec({ r: against ? -0.6 + (i % 2 ? 0.2 : -0.1) : 0.3 + (i % 2 ? 0.2 : -0.1), openedAt: T0 + i * 3_600_000, ctx: ctx({ align: against ? "against" : "with" }) }));
  }
  const reg = mistakeRegister(rs);
  const m = reg.mistakes.find((x) => x.id === "against-bias");
  assert.ok(m && m.guard === "htf" && m.avgWith < 0 && m.delta < -0.2 && m.cases >= 10);
  assert.equal(m!.repeating, true);
  const ref = reflect(rs, [], [baselineVersion()], "v0");
  assert.ok(ref.lessons.some((l) => /against the higher-timeframe bias/.test(l) && /still repeating/.test(l)));
  assert.deepEqual(guardPatch("htf", { ...FILTERS0 }), { htf: "block" });
  assert.equal(guardPatch("htf", { ...FILTERS0, htf: "block" }), null);
  const few = rs.slice(0, 8);
  assert.equal(mistakeRegister(few).mistakes.length, 0);
  const none = reflect([], [], [baselineVersion()], "v0");
  assert.match(none.lessons[0]!, /Too few trades/);
  assert.match(diary([], T0), /No trades/);
});
