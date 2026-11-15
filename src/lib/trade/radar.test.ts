import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES, buildCtx, measureEdge, simulate } from "../market/strategies.ts";
import { registerMarkets, type Candle } from "../market/types.ts";
import { SCALP_DEFAULTS } from "./scalp.ts";
import { RADAR_DEFAULTS, candidateDecision, clusterKeys, confidenceOf, diversify, isSpikeIndex, parseRadar, radarBrief, runRadar, spikiness, type Candidate } from "./radar.ts";
import { planCycle } from "./planner.ts";

const TF = 300_000;
const T0 = 1_700_000_000_000;

/** Deterministic pseudo-random walk with trend and pullback waves, so strategies fire and resolve. */
function walk(n: number, seed = 7, drift = 0.0006, vol = 0.004): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 7) * vol * 0.6;
    const o = p;
    const c = p * (1 + drift + wave * 0.5 + rnd() * vol);
    const h = Math.max(o, c) * (1 + Math.abs(rnd()) * vol * 0.5);
    const l = Math.min(o, c) * (1 - Math.abs(rnd()) * vol * 0.5);
    out.push({ t: T0 + i * TF, o, h, l, c, v: 1000 * (1 + Math.abs(rnd())) });
    p = c;
  }
  return out;
}

test("simulate: stop first when one bar touches both, banking at quickR, breakeven lock, timeout, unresolved", () => {
  const mk = (h: number, l: number, c: number): Candle => ({ t: 0, o: 100, h, l, c, v: 1 });
  const base = mk(100, 100, 100);
  assert.equal(simulate([base, mk(103, 98, 100)], 0, "BUY", 98.5, 1, 0, 3), -1);
  assert.equal(simulate([base, mk(102, 99.5, 101)], 0, "BUY", 99, 1, 0, 3), 1);
  assert.equal(simulate([base, mk(100.4, 99.6, 100.2), mk(100.5, 99.7, 100.5)], 0, "BUY", 99, 2, 0, 2)!.toFixed(2), "0.50");
  assert.equal(simulate([base, mk(100.4, 99.6, 100.2)], 0, "BUY", 99, 2, 0, 5), null);
  assert.equal(simulate([base, mk(101, 97, 99)], 0, "SELL", 101, 1, 0, 3), -1);
  // Lock: price reaches 0.4R, then falls back to entry -> closed at zero, not a full loss.
  assert.equal(simulate([base, mk(100.5, 100.1, 100.4), mk(100.3, 99.95, 100)], 0, "BUY", 99, 1, 0.4, 5), 0);
  assert.equal(simulate([base, mk(100.5, 99.9, 100.4)], 0, "BUY", 99, 1, 0.4, 5), 0);
  // Without the lock the same path keeps running to its end.
  assert.equal(simulate([base, mk(100.5, 100.1, 100.4), mk(100.3, 99.95, 100)], 0, "BUY", 99, 1, 0, 2), 0);
  assert.equal(simulate([base, mk(99.9, 99.1, 99.5)], 0, "SELL", 101, 1, 0.4, 5), null);
});

test("every strategy runs on every bar without throwing and returns sane stops", () => {
  const c = walk(400);
  const x = buildCtx(c)!;
  assert.ok(x);
  let fired = 0;
  for (const s of STRATEGIES) {
    for (let i = 55; i < c.length; i++) {
      const sig = s.signal(x, i);
      if (!sig) continue;
      fired++;
      const e = c[i]!.c;
      assert.ok(sig.side === "BUY" ? sig.stop < e : sig.stop > e, `${s.id}: stop on the wrong side`);
      assert.ok(sig.strength >= 0 && sig.strength <= 100);
      const atr = x.atr[i]!;
      const d = Math.abs(e - sig.stop);
      assert.ok(d >= 0.8 * atr - 1e-9 && d <= 2.5 * atr + 1e-9, `${s.id}: stop distance outside 0.8-2.5 ATR`);
      assert.ok(s.rr >= 1.5, `${s.id}: runner target below the risk engine's minimum reward:risk`);
    }
  }
  assert.ok(fired > 20, `strategies fired only ${fired} times on 400 bars`);
});

test("signals only use data up to their own bar (no look-ahead)", () => {
  const c = walk(300, 11);
  const full = buildCtx(c)!;
  for (const s of STRATEGIES) {
    for (const i of [150, 200, 250]) {
      const cut = buildCtx(c.slice(0, i + 1))!;
      const a = s.signal(full, i);
      const b = s.signal(cut, i);
      assert.equal(!!a, !!b, `${s.id} at ${i}: fires differently with future bars present`);
      if (a && b) assert.ok(Math.abs(a.stop - b.stop) < 1e-9 && a.side === b.side);
    }
  }
});

test("measureEdge subtracts costs and shrinks small samples", () => {
  const c = walk(400, 3);
  const x = buildCtx(c)!;
  for (const s of STRATEGIES) {
    const free = measureEdge(x, s, 0, 220, c.length - 2);
    const costly = measureEdge(x, s, 0.01, 220, c.length - 2);
    assert.equal(free.trades, costly.trades);
    if (free.trades) assert.ok(costly.avgR < free.avgR, `${s.id}: costs did not reduce the result`);
    assert.ok(Math.abs(free.expectancy) <= Math.abs(free.avgR) + 1e-9);
    assert.ok(free.winRate >= 0 && free.winRate <= 1);
  }
});

function cand(over: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    id: 1, key: "AAAUSDT|ema-pullback|BUY|1", symbol: "AAAUSDT", label: "AAA/USDT", group: "Crypto spot", strategy: "ema-pullback", strategyName: "EMA pullback", side: "BUY",
    entry: 100, stop: 99, target: 101.8, rr: 1.8, quickR: 0.7, holdMin: 70, stopPct: 1, atr: 0.6, atrPct: 0.6, quickGainPct: 0.7, costPct: 0.24, strength: 70,
    edge: { trades: 12, wins: 7, winRate: 0.58, expectancy: 0.12, avgR: 0.18, profitFactor: 1.5 }, score: 66, spreadPct: 0.02, why: "test", signalTime: 1, howTo: [],
  };
  return { ...base, ...over };
}

test("parseRadar: ids map to candidates, numbers are clamped, TAKE count is capped, rest are skipped", () => {
  const cs = [cand({ id: 1, key: "a" }), cand({ id: 2, key: "b" }), cand({ id: 3, key: "c" }), cand({ id: 4, key: "d" })];
  const text = "```json\n" + JSON.stringify({ picks: [
    { id: 2, action: "take", quickR: 5, sizeMult: 9, reason: "clean" },
    { id: 1, action: "TAKE", quickR: 0.5, sizeMult: 0.5, reason: "ok" },
    { id: 3, action: "TAKE", quickR: 0.5, sizeMult: 1, reason: "third" },
    { id: 99, action: "TAKE" },
  ] }) + "\n```";
  const out = parseRadar(text, cs, SCALP_DEFAULTS, 2)!;
  assert.equal(out.get("b")!.action, "TAKE");
  assert.equal(out.get("b")!.quickR, 1);
  assert.equal(out.get("b")!.sizeMult, 1);
  assert.equal(out.get("a")!.sizeMult, 0.5);
  assert.equal(out.get("c")!.action, "SKIP");
  assert.equal(out.get("d")!.action, "SKIP");
  assert.equal(out.size, 4);
  assert.equal(parseRadar("nonsense", cs, SCALP_DEFAULTS, 2), null);
  assert.equal(parseRadar('{"other":1}', cs, SCALP_DEFAULTS, 2), null);
});

test("radarBrief stays inside the AI input limit", () => {
  const cs = Array.from({ length: 8 }, (_, i) => cand({ id: i + 1, key: `k${i}`, why: "x".repeat(300) }));
  const b = radarBrief(cs, { interval: "5m", dayPnl: 1.2, dailyRemaining: 3, openCount: 1, consecLosses: 0, scanned: 90, withData: 80, signals: 14, top: 4 });
  assert.ok(b.length <= 3900);
  assert.ok(b.includes("#1 ") && b.includes("#8 "));
});

test("runRadar ranks, uses closed bars only, drops stale and fee-eaten setups, and the planner trades only the picks", () => {
  registerMarkets([{ symbol: "AAAUSDT", label: "AAA/USDT", group: "Crypto spot", broker: "binance", open: true }]);
  const c = walk(420, 5, 0.0008, 0.008);
  const now = c[c.length - 1]!.t + TF * 5; // newest candle is closed
  const cfg = { ...RADAR_DEFAULTS, minTrades: 1, minEdge: -1, minScore: 0 };
  const res = runRadar({ rows: [{ symbol: "AAAUSDT", candles: c, spreadPct: 0.02, tradable: true }], intervalMs: TF, now, cfg, scalp: { ...SCALP_DEFAULTS, feeMult: 0 } });
  assert.equal(res.total, 1);
  assert.equal(res.withData, 1);
  for (const k of res.ranked) {
    assert.ok(k.side === "BUY" ? k.stop < k.entry && k.target > k.entry : k.stop > k.entry && k.target < k.entry);
    assert.ok(k.score >= 0 && k.score <= 100);
    assert.equal(k.howTo.length, 3);
  }
  // Heavy fee gate removes everything.
  const gated = runRadar({ rows: [{ symbol: "AAAUSDT", candles: c, spreadPct: 0.02, tradable: true }], intervalMs: TF, now, cfg, scalp: { ...SCALP_DEFAULTS, feeMult: 1000 } });
  assert.equal(gated.ranked.length, 0);
  // Not tradable or too little data are not scanned.
  const none = runRadar({ rows: [{ symbol: "AAAUSDT", candles: c.slice(0, 50), spreadPct: 0.02, tradable: true }, { symbol: "BBBUSDT", candles: c, spreadPct: 0.02, tradable: false }], intervalMs: TF, now, cfg, scalp: SCALP_DEFAULTS });
  assert.equal(none.withData, 0);

  // Planner: with radar picks only the picked market is traded; without a pick nothing is.
  const k = cand({ symbol: "AAAUSDT", entry: 100, stop: 99, target: 101.8, signalTime: c[c.length - 1]!.t });
  const decision = candidateDecision(k);
  assert.equal(decision.action, "BUY");
  assert.equal(decision.lead, "ema-pullback");
  const rowCandles = walk(120, 9);
  const base = {
    now: rowCandles[rowCandles.length - 1]!.t + TF * 1.2, mode: "aggressive" as const, interval: "5m" as const, armed: true, rows: [{ symbol: "AAAUSDT", candles: rowCandles, spreadPct: 0.02, tradable: true, longOnly: false }],
    positions: [], marks: {}, equity: 10_000, cash: 10_000, dayPnl: 0, startEquity: 10_000, riskPct: 0.25, maxOpenRiskPct: 5, dailyLossPct: 5, maxPositions: 8, maxPerSymbol: 5,
    consecLosses: 0, consecLimit: 3, lossPause: false, goalReached: false, seen: [], recent: [], trail: true, scalp: SCALP_DEFAULTS,
  };
  const none2 = planCycle({ ...base, radar: {} });
  assert.equal(none2.entries.length, 0);
  const picked = planCycle({ ...base, scalp: { ...SCALP_DEFAULTS, feeMult: 0 }, radar: { AAAUSDT: { decision, ai: { quickR: 0.6, note: "AI radar: ok", sizeMult: 0.5 } } } });
  assert.equal(picked.entries.length, 1);
  assert.equal(picked.entries[0]!.strategy, "ema-pullback");
  assert.deepEqual(picked.entries[0]!.ai, { quickR: 0.6, note: "AI radar: ok", sizeMult: 0.5 });
});

test("v37: diversify caps one group and one cluster, spikiness and confidence separate calm from spiky markets", () => {
  const mk = (symbol: string, group: string, score: number) => cand({ symbol, group, score, key: `${symbol}|${score}`, id: 0 });
  const sorted = [
    mk("BOOM500", "Synthetic", 90), mk("CRASH500", "Synthetic", 88), mk("R_50", "Synthetic", 86), mk("R_75", "Synthetic", 85),
    mk("frxEURUSD", "Forex", 80), mk("frxGBPUSD", "Forex", 79), mk("frxEURJPY", "Forex", 78), mk("BTCUSDT", "Crypto", 70),
  ];
  const { list, crowded } = diversify(sorted, { aiList: 5, perGroup: 2 });
  const syms = list.map((c) => c.symbol);
  // One spike index only (Boom and Crash share a cluster), one volatility index, forex pairs may not share a currency.
  assert.deepEqual(syms, ["BOOM500", "R_50", "frxEURUSD", "BTCUSDT"]);
  assert.ok(crowded >= 4);
  assert.ok(list.length <= 5);
  assert.deepEqual(clusterKeys("frxEURUSD"), ["fx-EUR", "fx-USD"]);
  assert.deepEqual(clusterKeys("1HZ100V"), ["volatility-indices"]);
  assert.ok(isSpikeIndex("CRASH1000") && !isSpikeIndex("R_100"));

  const calm = walk(200, 3);
  const spiky = calm.map((c, i) => (i === 150 ? { ...c, h: c.h * 1.5, l: c.l * 0.7 } : c));
  assert.ok(spikiness(spiky) > 3 * spikiness(calm));
  const edge = { trades: 20, wins: 12, winRate: 0.6, expectancy: 0.2, avgR: 0.25, profitFactor: 1.8 };
  assert.ok(confidenceOf(edge, 3) >= 90);
  assert.ok(confidenceOf(edge, 20) < confidenceOf(edge, 3));
  assert.ok(confidenceOf({ ...edge, trades: 3, winRate: 0.3 }, 3) < RADAR_DEFAULTS.minConfidence);
});

test("v37: benched markets are skipped, closed markets are not waited for, and the result reports what was left out", () => {
  const c = walk(260, 5, 0.0008);
  const now = c[c.length - 1]!.t + TF * 1.2;
  const cfg = { ...RADAR_DEFAULTS, minTrades: 1, minEdge: -1, minScore: 0, minConfidence: 0, spikeMax: 1000 };
  const rows = [{ symbol: "AAAUSDT", candles: c, spreadPct: 0.02, tradable: true }, { symbol: "CLOSEDX", candles: [], spreadPct: null, tradable: false, closed: true }];
  const open = runRadar({ rows, intervalMs: TF, now, cfg, scalp: SCALP_DEFAULTS });
  assert.equal(open.expected, 1);
  const benched = runRadar({ rows, intervalMs: TF, now, cfg, scalp: SCALP_DEFAULTS, benched: () => "2 losses in a row" });
  assert.equal(benched.ranked.length, 0);
  assert.equal(benched.rejected.benched, 1);
  const unsure = runRadar({ rows, intervalMs: TF, now, cfg: { ...cfg, minConfidence: 101 }, scalp: SCALP_DEFAULTS });
  assert.equal(unsure.ranked.length, 0);
});
