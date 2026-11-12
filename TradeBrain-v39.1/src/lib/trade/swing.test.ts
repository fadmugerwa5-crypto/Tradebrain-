import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../market/types.ts";
import type { BookPosition } from "./account.ts";
import { SWING_DEFAULTS, SWING_STRATEGIES, buildSwingCtx, signalOf, clearSwingCache, measureSwingEdge, planSwing, signalText, simulateSwing, sizeMultiplier, swingExit, swingStrategyById, type SwingRowIn } from "./swing.ts";

const H = 3_600_000;
const D = 24 * H;
/** Deterministic pseudo-random walk, 1h candles from a UTC midnight. */
function walk(n: number, seed = 7, drift = 0, vol = 0.004, t0 = Date.UTC(2026, 0, 1)): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * (1 + drift + rnd() * vol * 2);
    const h = Math.max(o, c) * (1 + Math.abs(rnd()) * vol);
    const l = Math.min(o, c) * (1 - Math.abs(rnd()) * vol);
    out.push({ t: t0 + i * H, o, h, l, c, v: 1000 + Math.abs(rnd()) * 800 });
    p = c;
  }
  return out;
}

test("context: sessions, alignment and previous-day levels", () => {
  const c = walk(240);
  const x = buildSwingCtx(c, H, 0)!;
  assert.ok(x);
  assert.equal(x.sessStarts.length, 10);
  assert.equal(x.start[30], 24);
  assert.equal(x.aligned[30], true);
  assert.equal(x.pdh[30], null); // second session: previous session is not trusted yet
  // Bar 77 is in the 4th session (index 3); its previous full session is the 3rd (bars 48..71).
  assert.equal(x.pdh[24 * 3 + 5], Math.max(...c.slice(48, 72).map((b) => b.h)));
  assert.equal(x.pdl[24 * 3 + 5], Math.min(...c.slice(48, 72).map((b) => b.l)));
  assert.ok(x.vwap[30] != null);
});

test("no look-ahead: a signal on bar i never changes when later bars change", () => {
  const c = walk(700, 11);
  const x = buildSwingCtx(c, H, 0)!;
  const cut = 500;
  const y = buildSwingCtx(c.slice(0, cut + 1), H, 0)!;
  for (const s of SWING_STRATEGIES) {
    for (let i = 260; i <= cut; i++) {
      const a = s.signal(x, i);
      const b = s.signal(y, i);
      assert.deepEqual(a ? { ...a } : null, b ? { ...b } : null, `${s.id} differs at ${i}`);
    }
  }
});

test("simulate: stop wins a tie, target pays rr, time exit is marked", () => {
  const base = (o: number, h: number, l: number, c: number, t: number): Candle => ({ t, o, h, l, c, v: 1 });
  const bars = [base(100, 100, 100, 100, 0), base(100, 103, 98, 101, 1), base(101, 102, 101, 101.5, 2)];
  // both stop (99) and target (102) inside bar 1 -> stop
  assert.deepEqual(simulateSwing(bars, 0, "BUY", 99, 102, 5), { r: -1, bars: 1, exit: "stop" });
  const up = [base(100, 100, 100, 100, 0), base(100, 101, 99.5, 100.8, 1), base(100.8, 102.5, 100.5, 102, 2)];
  const r = simulateSwing(up, 0, "BUY", 99, 102, 5)!;
  assert.equal(r.exit, "target");
  assert.equal(r.r, 2);
  const slow = [base(100, 100, 100, 100, 0), base(100, 100.5, 99.8, 100.2, 1), base(100.2, 100.6, 99.9, 100.4, 2)];
  const t = simulateSwing(slow, 0, "BUY", 99, 102, 2)!;
  assert.equal(t.exit, "time");
  assert.ok(Math.abs(t.r - 0.4) < 1e-9);
  assert.equal(simulateSwing(slow, 0, "BUY", 99, 102, 9), null); // data ends first
  const short = [base(100, 100, 100, 100, 0), base(100, 100.5, 97.5, 98, 1)];
  assert.equal(simulateSwing(short, 0, "SELL", 101, 98, 3)!.exit, "target");
});

test("opening range breakout fires on the first close above the range, only once", () => {
  // 3 sessions of flat 1h bars, then a session whose first two bars set the range and bar 3 closes above it.
  const t0 = Date.UTC(2026, 0, 1);
  const c: Candle[] = [];
  for (let i = 0; i < 24 * 4; i++) c.push({ t: t0 + i * H, o: 100, h: 100.6, l: 99.4, c: 100.1, v: 1000 });
  const s = 24 * 3;
  c[s + 3] = { t: t0 + (s + 3) * H, o: 100.2, h: 101.8, l: 100.1, c: 101.6, v: 3000 }; // 03:00 closes above 100.6
  c[s + 4] = { t: t0 + (s + 4) * H, o: 101.6, h: 102.5, l: 101.4, c: 102.3, v: 3000 }; // later, already broke once
  const x = buildSwingCtx(c, H, 0)!;
  const orb = swingStrategyById("orb")!;
  const a = orb.signal(x, s + 3);
  assert.ok(a && a.side === "BUY");
  assert.ok(a!.stop < 101.6);
  assert.equal(orb.signal(x, s + 4), null); // second break same side, same session: not taken
});

test("previous-day high sweep fade needs a close back inside and a long upper wick", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const c: Candle[] = [];
  for (let i = 0; i < 24 * 4; i++) c.push({ t: t0 + i * H, o: 100, h: 100.5, l: 99.5, c: 100.1, v: 1000 });
  // day 3 (index 2) high 103, day 4 sweeps it
  c[24 * 2 + 5] = { t: t0 + (24 * 2 + 5) * H, o: 100, h: 103, l: 99.8, c: 100.2, v: 1000 };
  const i = 24 * 3 + 6;
  c[i] = { t: t0 + i * H, o: 102.3, h: 103.6, l: 101.9, c: 102.0, v: 1500 }; // spiked over 103, closed back under, bearish
  const x = buildSwingCtx(c, H, 0)!;
  const f = swingStrategyById("pdhl-fade")!;
  const sig = f.signal(x, i);
  assert.ok(sig && sig.side === "SELL");
  assert.ok(sig!.stop > 103.6);
  c[i] = { ...c[i]!, c: 103.4 }; // closes above the level: no fade
  assert.equal(f.signal(buildSwingCtx(c, H, 0)!, i), null);
});

test("edge measurement is deterministic and fees only ever reduce it", () => {
  const c = walk(900, 3, 0.0002);
  const x = buildSwingCtx(c, H, 0)!;
  for (const s of SWING_STRATEGIES) {
    const free = measureSwingEdge(x, s, 0, 55, c.length - 2);
    const paid = measureSwingEdge(x, s, 0.0024, 55, c.length - 2);
    assert.equal(free.trades, paid.trades);
    if (free.trades > 0) assert.ok(paid.totalR <= free.totalR + 1e-9);
    assert.deepEqual(measureSwingEdge(x, s, 0.0024, 55, c.length - 2), paid);
  }
});

function rowFor(symbol: string, candles: Candle[], longOnly = false, kind: "binance" | "deriv" = "binance", derivMult?: number[] | null): SwingRowIn {
  return { symbol, label: symbol, group: "Crypto", kind, candles, spreadPct: 0.01, tradable: true, longOnly, derivMult };
}

test("planner: never arms without the switch, never trades a market with no record, respects the open limit", () => {
  clearSwingCache();
  const c = walk(900, 5, 0.0003);
  const now = c[c.length - 1]!.t + H + 60_000;
  const base = {
    now,
    venue: "paper" as const,
    cfg: { ...SWING_DEFAULTS, minTrades: 0, minEdge: -10, requireStable: false, dailyTrendFilter: false },
    rows: [rowFor("AAAUSDT", c)],
    positions: [] as BookPosition[],
    equity: 10_000,
    cash: 10_000,
    dayPnl: 0,
    dayStartEquity: 10_000,
    dailyLossPct: 2,
    seen: [] as string[],
    halted: null,
  };
  const off = planSwing({ ...base, armed: false });
  assert.equal(off.entries.length, 0);
  const strict = planSwing({ ...base, armed: true, cfg: { ...base.cfg, minTrades: 9999 } });
  assert.equal(strict.entries.length, 0);
  assert.ok(strict.signals.every((s) => s.status === "blocked"));
  const halted = planSwing({ ...base, armed: true, halted: "Drawdown limit reached" });
  assert.equal(halted.entries.length, 0);
  const one = planSwing({ ...base, armed: true, cfg: { ...base.cfg, maxOpen: 0 } });
  assert.equal(one.entries.length, 0);
});

test("planner: any entry is sized by risk, has stop and target on the right sides, and is not repeated", () => {
  clearSwingCache();
  let found = false;
  for (let seed = 1; seed < 60 && !found; seed++) {
    const c = walk(900, seed, 0.0004);
    const now = c[c.length - 1]!.t + H + 60_000;
    const input = {
      now,
      venue: "paper" as const,
      cfg: { ...SWING_DEFAULTS, minTrades: 0, minEdge: -10, requireStable: false, dailyTrendFilter: false, minRR: 1.5 },
      armed: true,
      rows: [rowFor("AAAUSDT", c)],
      positions: [] as BookPosition[],
      equity: 10_000,
      cash: 10_000,
      dayPnl: 0,
      dayStartEquity: 10_000,
      dailyLossPct: 2,
      seen: [] as string[],
      halted: null,
    };
    const plan = planSwing(input);
    for (const e of plan.entries) {
      found = true;
      assert.ok(e.lossAtStop <= 10_000 * (SWING_DEFAULTS.riskPct / 100) + 1e-6, "risk per trade is capped");
      if (e.side === "BUY") assert.ok(e.stop < e.entry && e.target > e.entry);
      else assert.ok(e.stop > e.entry && e.target < e.entry);
      assert.ok(e.holdUntil > now);
      assert.ok(e.strategy.startsWith("swing:"));
      const again = planSwing({ ...input, seen: plan.entries.map((x) => x.key) });
      assert.ok(!again.entries.some((x) => x.key === e.key), "same candle is not traded twice");
    }
  }
  assert.ok(found, "expected at least one signal across the sample markets");
});

test("loss pause: blocks new entries after a run of losses, and lifts itself after 24 h", () => {
  clearSwingCache();
  const lossAt = (id: string, closedAt: number): BookPosition => ({
    id, symbol: "OLD", side: "BUY", qty: 1, entry: 100, stop: 99, target: 102, openedAt: closedAt - H, fees: 0, plannedRisk: 1, reason: "", quality: 50,
    strategy: "swing:orb", mode: "normal", venue: "paper", protection: "local-monitor", brokerOrderId: null, status: "closed", book: "swing", pnl: -1, closedAt,
  });
  for (let seed = 1; seed < 80; seed++) {
    const c = walk(900, seed, 0.0004);
    const now = c[c.length - 1]!.t + H + 60_000;
    const mk = (positions: BookPosition[]) => planSwing({
      now, venue: "paper" as const, cfg: { ...SWING_DEFAULTS, minTrades: 0, minEdge: -10, requireStable: false, dailyTrendFilter: false, minRR: 1.5, pauseAfter: 2 }, armed: true, rows: [rowFor("AAAUSDT", c)], positions,
      equity: 10_000, cash: 10_000, dayPnl: 0, dayStartEquity: 10_000, dailyLossPct: 2, seen: [], halted: null,
    });
    const free = mk([]);
    if (free.entries.length === 0) continue;
    const recent = mk([lossAt("a", now - 2 * H), lossAt("b", now - H)]);
    assert.equal(recent.entries.length, 0, "paused after two recent losses");
    const old = mk([lossAt("a", now - 50 * H), lossAt("b", now - 49 * H)]);
    assert.ok(old.entries.length > 0, "pause lifted after 24 h");
    return;
  }
  assert.fail("no sample market produced an entry");
});

test("local exit: stop first, target, time limit, and exchange-held trades only time out", () => {
  const t0 = 1_000_000;
  const pos = (over: Partial<BookPosition> = {}): BookPosition => ({
    id: "p", symbol: "X", side: "BUY", qty: 1, entry: 100, stop: 98, target: 104, openedAt: t0, fees: 0, plannedRisk: 2, reason: "", quality: 60,
    strategy: "swing:orb", mode: "normal", venue: "paper", protection: "local-monitor", brokerOrderId: null, status: "open", book: "swing", holdUntil: t0 + 10 * H, ...over,
  });
  const bar = (t: number, h: number, l: number): Candle => ({ t, o: 100, h, l, c: 100, v: 1 });
  assert.equal(swingExit(pos(), [bar(t0 + H, 105, 97)], 100, t0 + 2 * H)!.price, 98); // both -> stop
  assert.equal(swingExit(pos(), [bar(t0 + H, 104.5, 99)], 100, t0 + 2 * H)!.price, 104);
  assert.equal(swingExit(pos(), [bar(t0 - H, 110, 90)], 100, t0 + 2 * H), null); // candle before the entry is ignored
  assert.equal(swingExit(pos(), [], 100, t0 + 11 * H)!.reason, "Time limit reached");
  assert.equal(swingExit(pos({ protection: "broker-confirmed" }), [bar(t0 + H, 110, 90)], 100, t0 + 2 * H), null);
  assert.equal(swingExit(pos({ protection: "broker-confirmed" }), [], 100, t0 + 11 * H)!.reason, "Time limit reached");
  assert.equal(swingExit(pos({ side: "SELL", stop: 102, target: 96 }), [bar(t0 + H, 103, 99)], 100, t0 + 2 * H)!.price, 102);
});

test("Deriv multiplier sizing: loses the risk budget at the stop, never raises size to reach a minimum, respects the stop-out", () => {
  // equity 10,000, risk 0.5% = 50. Entry 100, stop 99 (1%), target 102 (2%).
  const ok = sizeMultiplier({ equity: 10_000, cash: 10_000, riskPct: 0.5, entry: 100, stop: 99, target: 102, options: [5, 10, 20, 50, 100] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.ok(ok.multiplier * 0.01 <= 0.6 + 1e-9, "stop stays inside the stop-out");
    assert.ok(Math.abs(ok.stopLoss - 50) < 1, "stop loss amount is the risk budget");
    assert.ok(Math.abs(ok.takeProfit - 2 * ok.stopLoss) < 1, "take profit is 2R");
    assert.ok(ok.stopLoss < ok.stake, "stop loss is below the stake");
  }
  // tiny account and only huge multipliers on offer: even the smallest stake needed is below the minimum -> refuse, do not raise it
  const tiny = sizeMultiplier({ equity: 2, cash: 2, riskPct: 0.5, entry: 100, stop: 99.5, target: 101, options: [100, 200], minStake: 1 });
  assert.equal(tiny.ok, false);
  // a stop so wide that every multiplier would stop out first
  const wide = sizeMultiplier({ equity: 10_000, cash: 10_000, riskPct: 0.5, entry: 100, stop: 80, target: 140, options: [5, 10, 20] });
  assert.equal(wide.ok, false);
  // small account that fits: risk 0.10, stop 1% -> picks the multiplier that reaches the 1.00 minimum stake
  const small = sizeMultiplier({ equity: 20, cash: 20, riskPct: 0.5, entry: 100, stop: 99, target: 102, options: [5, 10, 20, 50], minStake: 1 });
  assert.equal(small.ok, true);
  if (small.ok) assert.ok(small.stake >= 1 && small.stopLoss <= 0.11);
  assert.equal(sizeMultiplier({ equity: 10_000, cash: 10_000, riskPct: 0.5, entry: 100, stop: 99, target: 102, options: [] }).ok, false);
});

test("routing: orders go only to the broker chosen as the venue; the rest are signals", () => {
  clearSwingCache();
  for (let seed = 1; seed < 80; seed++) {
    const c = walk(900, seed, 0.0004);
    const now = c[c.length - 1]!.t + H + 60_000;
    const base = {
      now, cfg: { ...SWING_DEFAULTS, minTrades: 0, minEdge: -10, requireStable: false, dailyTrendFilter: false, minRR: 1.5 }, armed: true, positions: [] as BookPosition[],
      equity: 10_000, cash: 10_000, dayPnl: 0, dayStartEquity: 10_000, dailyLossPct: 2, seen: [] as string[], halted: null,
    };
    const binRow = rowFor("AAAUSDT", c, false, "binance");
    const derRow = rowFor("frxXAUUSD", c, false, "deriv", [5, 10, 20, 50]);
    const onBinance = planSwing({ ...base, venue: "binance", rows: [binRow, derRow] });
    if (onBinance.entries.length === 0) continue;
    assert.ok(onBinance.entries.every((e) => e.venue === "binance" && e.symbol === "AAAUSDT"));
    assert.ok(onBinance.signals.filter((s) => s.symbol === "frxXAUUSD").every((s) => s.status === "signal" && /signal only/i.test(s.blocked)));
    const onDeriv = planSwing({ ...base, venue: "deriv", rows: [binRow, derRow] });
    assert.ok(onDeriv.entries.every((e) => e.venue === "deriv" && e.symbol === "frxXAUUSD" && e.deriv && e.deriv.stake >= 1));
    assert.ok(onDeriv.entries.length > 0);
    // multipliers not known yet -> held back; none offered -> signal only
    const unknown = planSwing({ ...base, venue: "deriv", rows: [rowFor("frxXAUUSD", c, false, "deriv", undefined)] });
    assert.equal(unknown.entries.length, 0);
    const none = planSwing({ ...base, venue: "deriv", rows: [rowFor("frxXAUUSD", c, false, "deriv", null)] });
    assert.equal(none.entries.length, 0);
    assert.ok(none.signals.every((s) => s.status === "signal"));
    // simulated: everything is tradable on the paper book, including Deriv markets
    const paper = planSwing({ ...base, venue: "paper", rows: [derRow] });
    assert.ok(paper.entries.length > 0 && paper.entries.every((e) => e.venue === "paper" && !e.deriv));
    return;
  }
  assert.fail("no sample market produced an entry");
});

test("signal text carries everything needed to place the order elsewhere", () => {
  clearSwingCache();
  for (let seed = 1; seed < 80; seed++) {
    const c = walk(900, seed, 0.0004);
    const now = c[c.length - 1]!.t + H + 60_000;
    const plan = planSwing({
      now, venue: "paper", cfg: { ...SWING_DEFAULTS, minTrades: 0, minEdge: -10, requireStable: false, dailyTrendFilter: false, minRR: 1.5 }, armed: false, rows: [rowFor("AAAUSDT", c)], positions: [],
      equity: 10_000, cash: 10_000, dayPnl: 0, dayStartEquity: 10_000, dailyLossPct: 2, seen: [], halted: null,
    });
    const sg = plan.signals[0];
    if (!sg) continue;
    const t = signalText(sg);
    assert.ok(t.includes("AAAUSDT") && /Stop loss:/.test(t) && /Take profit:/.test(t) && /BUY|SELL/.test(t) && /not financial advice/i.test(t));
    return;
  }
  assert.fail("no signal found");
});

test("Deriv contracts: the broker holds stop and target, only the time limit acts here", () => {
  const t0 = 1_000_000;
  const pos: BookPosition = {
    id: "d", symbol: "frxXAUUSD", side: "BUY", qty: 1, entry: 100, stop: 98, target: 104, openedAt: t0, fees: 0, plannedRisk: 40, riskAtStop: 5, reason: "", quality: 60,
    strategy: "swing:orb", mode: "normal", venue: "deriv", protection: "contract-stake", brokerOrderId: "1", status: "open", book: "swing", holdUntil: t0 + 10 * H,
  };
  const bar: Candle = { t: t0 + H, o: 100, h: 120, l: 80, c: 100, v: 0 };
  assert.equal(swingExit(pos, [bar], 100, t0 + 2 * H), null);
  assert.equal(swingExit(pos, [], 100, t0 + 11 * H)!.reason, "Time limit reached");
});

test("scalp: failed-breakout return fires on a close back inside the range, and not without the break", async () => {
  const { STRATEGIES, buildCtx } = await import("../market/strategies.ts");
  const fb = STRATEGIES.find((s) => s.id === "failed-break")!;
  assert.ok(fb);
  const t0 = Date.UTC(2026, 0, 1);
  const bars: Candle[] = [];
  for (let i = 0; i < 60; i++) bars.push({ t: t0 + i * 300_000, o: 100, h: 100.5, l: 99.5, c: 100.1 + (i % 2) * 0.1, v: 1000 });
  bars[58] = { t: t0 + 58 * 300_000, o: 100.2, h: 101.4, l: 100.1, c: 101.2, v: 1500 }; // closes above the 20-bar high
  bars[59] = { t: t0 + 59 * 300_000, o: 101.0, h: 101.1, l: 99.9, c: 100.0, v: 1500 }; // closes back inside, bearish
  const x = buildCtx(bars)!;
  const sig = fb.signal(x, 59);
  assert.ok(sig && sig.side === "SELL" && sig.stop > 100.0);
  assert.equal(fb.signal(x, 58), null);
});

test("scalp: previous-day sweep needs a complete previous day, and fades a close back inside", async () => {
  const { STRATEGIES, buildCtx } = await import("../market/strategies.ts");
  const ps = STRATEGIES.find((s) => s.id === "prior-day-sweep")!;
  const t0 = Date.UTC(2026, 0, 1); // midnight UTC
  const step = 15 * 60_000;
  const perDay = 96;
  const bars: Candle[] = [];
  for (let i = 0; i < perDay * 3; i++) bars.push({ t: t0 + i * step, o: 100, h: 100.4, l: 99.6, c: 100.1, v: 1000 });
  bars[perDay + 10] = { ...bars[perDay + 10]!, h: 103 }; // day 2 high 103
  const i = perDay * 2 + 20;
  bars[i] = { t: bars[i]!.t, o: 102.3, h: 103.6, l: 101.9, c: 102.0, v: 1500 };
  const x = buildCtx(bars)!;
  const sig = ps.signal(x, i);
  assert.ok(sig && sig.side === "SELL");
  // history that starts mid-day: previous day incomplete -> no signal
  const partial = bars.slice(perDay + 40);
  const xp = buildCtx(partial)!;
  assert.equal(ps.signal(xp, partial.length - 1 - (bars.length - 1 - i)), null);
});

test("steady-record gate: a record that is only good in one half is held back; the filter blocks counter-trend signals", () => {
  clearSwingCache();
  // stable flag from measureSwingEdge: needs >= 6 trades, both halves positive
  const c = walk(900, 3, 0.0002);
  const x = buildSwingCtx(c, H, 0)!;
  for (const s of SWING_STRATEGIES) {
    const e = measureSwingEdge(x, s, 0.0024, 55, c.length - 2);
    if (e.trades < 6) assert.equal(e.stable, false);
    else assert.equal(e.stable, e.firstHalf! > 0 && e.secondHalf! > 0);
  }
  // with the daily filter, any signal that remains agrees with the daily trend
  const filteredSignals: number[] = [];
  for (const s of SWING_STRATEGIES) {
    for (let i = 260; i < c.length; i++) {
      const sig = signalOf(s, x, i, true);
      if (!sig) continue;
      const t = x.htf[i];
      if (t != null) assert.equal(t, sig.side === "BUY" ? 1 : -1);
      filteredSignals.push(i);
    }
  }
  // the filter only ever removes signals
  for (const s of SWING_STRATEGIES) for (let i = 260; i < c.length; i++) if (signalOf(s, x, i, true)) assert.ok(s.signal(x, i));
  // the planner reports why a record was held back
  const now = c[c.length - 1]!.t + H + 60_000;
  let sawReason = false;
  for (let seed = 1; seed < 60 && !sawReason; seed++) {
    const cc = walk(900, seed, 0.0004);
    const plan = planSwing({
      now: cc[cc.length - 1]!.t + H + 60_000, venue: "paper", cfg: { ...SWING_DEFAULTS, minTrades: 0, minEdge: -10, requireStable: true, dailyTrendFilter: false }, armed: true,
      rows: [rowFor("AAAUSDT", cc)], positions: [], equity: 10_000, cash: 10_000, dayPnl: 0, dayStartEquity: 10_000, dailyLossPct: 2, seen: [], halted: null,
    });
    if (plan.signals.some((g) => /not steady/.test(g.blocked))) sawReason = true;
  }
  assert.ok(sawReason, "expected at least one signal held back for an unsteady record");
  void now;
});

test("daily trend is built from completed sessions only (no look-ahead into the current day)", () => {
  const c = walk(24 * 60, 21, 0.0003);
  const x = buildSwingCtx(c, H, 0)!;
  // change only the LAST bars of the final session: htf for bars of that session must not change
  const d = c.map((b) => ({ ...b }));
  const lastStart = x.sessStarts[x.sessStarts.length - 1]!;
  for (let i = lastStart + 2; i < d.length; i++) d[i] = { ...d[i]!, c: d[i]!.c * 1.5, h: d[i]!.h * 1.5 };
  const y = buildSwingCtx(d, H, 0)!;
  for (let i = lastStart; i < c.length; i++) assert.equal(y.htf[i], x.htf[i]);
});

test("new strategies fire on crafted patterns", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const base = (n: number, drift: number): Candle[] => {
    const out: Candle[] = [];
    let p = 100;
    for (let i = 0; i < n; i++) {
      const o = p;
      const cl = p * (1 + drift + (i % 2 ? 0.0015 : -0.0012));
      out.push({ t: t0 + i * H, o, h: Math.max(o, cl) * 1.0015, l: Math.min(o, cl) * 0.9985, c: cl, v: 1000 });
      p = cl;
    }
    return out;
  };
  // narrow range: seven normal bars, one tiny bar, then a strong close above it
  const nr = base(300, 0);
  const k = 290;
  nr[k - 1] = { ...nr[k - 1]!, o: 100, h: 100.05, l: 99.98, c: 100.02 };
  nr[k] = { t: nr[k]!.t, o: 100.03, h: 101.4, l: 100.02, c: 101.3, v: 2500 };
  const x1 = buildSwingCtx(nr, H, 0)!;
  const n1 = swingStrategyById("narrow-range")!.signal(x1, k);
  assert.ok(n1 && n1.side === "BUY" && n1.stop < 101.3);

  // RSI(2): long uptrend then a sharp 3-bar drop that stays above the 200 EMA
  const up = base(300, 0.0012);
  for (let i = 296; i < 300; i++) up[i] = { ...up[i]!, o: up[i - 1]!.c, c: up[i - 1]!.c * 0.992, h: up[i - 1]!.c, l: up[i - 1]!.c * 0.99 };
  const x2 = buildSwingCtx(up, H, 0)!;
  const r2 = swingStrategyById("rsi2-revert")!;
  let fired = false;
  for (let i = 296; i < 300; i++) {
    const sg = r2.signal(x2, i);
    if (sg) {
      fired = true;
      assert.equal(sg.side, "BUY");
    }
  }
  assert.ok(fired, "RSI(2) should fire during the sharp drop");

  // weekly sweep: weeks of flat data, then a spike above last week's high that closes back inside
  const wk = 24 * 7;
  const flat: Candle[] = [];
  const mondayish = Date.UTC(2026, 0, 5); // a Monday 00:00 UTC
  for (let i = 0; i < wk * 4; i++) flat.push({ t: mondayish + i * H, o: 100, h: 100.4, l: 99.6, c: 100.1, v: 1000 });
  flat[wk * 2 + 30] = { ...flat[wk * 2 + 30]!, h: 103 }; // week 3 high is 103
  const j = wk * 3 + 40;
  flat[j] = { t: flat[j]!.t, o: 102.2, h: 103.7, l: 101.9, c: 102.0, v: 1500 };
  const x3 = buildSwingCtx(flat, H, 0)!;
  const w = swingStrategyById("weekly-sweep")!.signal(x3, j);
  assert.ok(w && w.side === "SELL" && w.stop > 103.7);
  assert.equal(swingStrategyById("weekly-sweep")!.signal(x3, wk + 5), null); // no previous full week yet
});
