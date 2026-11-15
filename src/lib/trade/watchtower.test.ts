import test from "node:test";
import assert from "node:assert/strict";
import {
  atrOf, clearArchivedOpportunities, evaluateOpportunity, listOpportunities, markReviewStart, nextReady,
  recordReview, refreshOpportunities, saveHiveWait, structureLevels, type WatchOpportunity,
} from "./watchtower.ts";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  clear() { this.data.clear(); }
}
const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

const IV = 60_000;
const T0 = 1_700_000_000_000;
type C = { t: number; o: number; h: number; l: number; c: number; v: number };
/** Sideways range between 99 and 101, then `extra` candles supplied by the test. The last candle is the forming one. */
function range(n: number): C[] {
  const out: C[] = [];
  for (let i = 0; i < n; i++) {
    const mid = 100 + (i % 2 ? 0.4 : -0.4);
    out.push({ t: T0 + i * IV, o: mid, h: Math.min(101, mid + 0.6), l: Math.max(99, mid - 0.6), c: mid, v: 0 });
  }
  return out;
}
const candle = (i: number, o: number, h: number, l: number, c: number): C => ({ t: T0 + i * IV, o, h, l, c, v: 0 });
const nowFor = (candles: C[]) => candles[candles.length - 1]!.t + 20_000;

function save(side: "BUY" | "SELL" = "BUY", candles = [...range(40), candle(40, 100, 100.2, 99.9, 100.1)]) {
  store.clear();
  const o = saveHiveWait({ symbol: "R_75", label: "Volatility 75", direction: side, price: 100.1, reason: "Only 2 of 3 needed analysts agree.", timeframe: "1m", venue: "deriv", candles, intervalMs: IV, agreeing: 2 }, nowFor(candles));
  assert.ok(o);
  return { o: o!, candles };
}

test("structure uses completed candles and stores a measurable level", () => {
  const candles = [...range(40), candle(40, 100, 100.2, 99.9, 100.1)];
  const st = structureLevels(candles, "BUY")!;
  assert.ok(st.level >= 100.5 && st.level <= 101);
  assert.ok(st.invalidation < 100);
  assert.ok(st.atr > 0 && atrOf(candles) > 0);
  assert.equal(structureLevels(range(10), "BUY"), null);
});

test("a promising WAIT is saved with the exact level it is waiting for", () => {
  const { o } = save("BUY");
  assert.equal(o.status, "MONITORING");
  assert.equal(o.trigger, o.level);
  assert.match(o.missing[0]!, /closing above/);
  assert.equal(listOpportunities().length, 1);
});

test("not saved: lone voice, no direction, no data, risk veto, communication failure", () => {
  store.clear();
  const candles = [...range(40), candle(40, 100, 100.2, 99.9, 100.1)];
  const mk = (over: object) => saveHiveWait({ symbol: "X", label: "X", direction: "BUY", price: 100, reason: "Need confirmation", timeframe: "1m", venue: "deriv", candles, intervalMs: IV, agreeing: 2, ...over }, nowFor(candles));
  assert.equal(mk({ agreeing: 1 }), null);
  assert.equal(mk({ direction: undefined }), null);
  assert.equal(mk({ candles: range(5) }), null);
  assert.equal(mk({ reason: "Risk Guard vetoed: daily loss" }), null);
  assert.equal(mk({ reason: "no answer (timeout)" }), null);
  assert.equal(listOpportunities().length, 0);
});

test("saving the same setup again refreshes it and keeps its level", () => {
  const { o, candles } = save("BUY");
  const again = saveHiveWait({ symbol: "R_75", label: "Volatility 75", direction: "BUY", price: 100.3, reason: "Still waiting", timeframe: "1m", venue: "deriv", candles: [...candles.slice(0, -1), candle(40, 100, 100.4, 99.9, 100.3), candle(41, 100.3, 100.4, 100.2, 100.3)], intervalMs: IV, agreeing: 2 }, nowFor(candles) + IV);
  assert.equal(listOpportunities().length, 1);
  assert.equal(again!.level, o.level);
  assert.equal(again!.checks, 2);
});

test("price near the level becomes APPROACHING_TRIGGER, a mere wick does not confirm", () => {
  const { o, candles } = save("BUY");
  const forming = candle(41, 100.5, o.level + 0.8, 100.3, o.level - 0.01);
  const withWick = [...candles.slice(0, -1), candle(40, 100, o.level + 0.8, 99.9, 100.2), forming];
  const e = evaluateOpportunity(o, withWick, o.level - 0.05, nowFor(withWick));
  assert.equal(e.status, "APPROACHING_TRIGGER");
  assert.equal(e.confirmedT, null);
});

test("a completed close beyond the level makes it READY for a fresh review", () => {
  const { o, candles } = save("BUY");
  const breakout = candle(41, 100.4, o.level + 0.5, 100.3, o.level + 0.3);
  const next = [...candles.slice(0, -1), candle(40, 100, 100.2, 99.9, 100.1), breakout, candle(42, o.level + 0.3, o.level + 0.4, o.level + 0.2, o.level + 0.3)];
  const e = evaluateOpportunity(o, next, o.level + 0.3, nowFor(next));
  assert.equal(e.status, "READY_FOR_MASTER_REVIEW");
  assert.equal(e.confirmedT, breakout.t);
});

test("SELL setups mirror the logic", () => {
  const { o, candles } = save("SELL");
  const breakdown = candle(41, 99.6, 99.7, o.level - 0.5, o.level - 0.3);
  const next = [...candles, breakdown, candle(42, o.level - 0.3, o.level - 0.2, o.level - 0.4, o.level - 0.3)];
  const e = evaluateOpportunity(o, next, o.level - 0.3, nowFor(next));
  assert.equal(e.status, "READY_FOR_MASTER_REVIEW");
});

test("breakout that falls back inside the range is a false breakout and needs a fresh close", () => {
  const { o, candles } = save("BUY");
  const breakout = candle(41, 100.4, o.level + 0.5, 100.3, o.level + 0.3);
  const next = [...candles.slice(0, -1), candle(40, 100, 100.2, 99.9, 100.1), breakout, candle(42, o.level + 0.3, o.level + 0.3, o.level - 0.4, o.level - 0.2)];
  const e = evaluateOpportunity(o, next, o.level - 0.2, nowFor(next));
  assert.equal(e.status, "MONITORING");
  assert.match(e.reason, /false breakout|fell back/);
});

test("an extended move is not chased", () => {
  const { o, candles } = save("BUY");
  const far = o.level + 3 * o.atr;
  const next = [...candles.slice(0, -1), candle(40, 100, 100.2, 99.9, 100.1), candle(41, o.level, far, o.level, far), candle(42, far, far + 0.1, far - 0.1, far)];
  const e = evaluateOpportunity(o, next, far, nowFor(next));
  assert.equal(e.status, "MONITORING");
  assert.match(e.reason, /extended/);
});

test("closing through the invalidation level archives it as INVALIDATED", () => {
  const { o, candles } = save("BUY");
  const bad = o.invalidation - 0.3;
  const next = [...candles, candle(41, 100, 100, bad - 0.1, bad), candle(42, bad, bad + 0.1, bad - 0.1, bad)];
  const e = evaluateOpportunity(o, next, bad, nowFor(next));
  assert.equal(e.status, "INVALIDATED");
});

test("expiry archives it", () => {
  const { o, candles } = save("BUY");
  const e = evaluateOpportunity(o, candles, 100.1, o.expiresAt + 1);
  assert.equal(e.status, "EXPIRED");
});

test("stale or missing data pauses monitoring and can never trigger", () => {
  const { o, candles } = save("BUY");
  const stale = evaluateOpportunity(o, candles, 100.1, nowFor(candles) + 10 * IV);
  assert.equal(stale.status, "PAUSED_DATA");
  assert.equal(evaluateOpportunity(o, undefined, undefined, nowFor(candles)).status, "PAUSED_DATA");
});

test("refreshOpportunities persists transitions and survives a reload (the state lives in storage)", () => {
  const { o, candles } = save("BUY");
  const breakout = candle(41, 100.4, o.level + 0.5, 100.3, o.level + 0.3);
  const next = [...candles.slice(0, -1), candle(40, 100, 100.2, 99.9, 100.1), breakout, candle(42, o.level + 0.3, o.level + 0.4, o.level + 0.2, o.level + 0.3)];
  refreshOpportunities(() => ({ candles: next, price: o.level + 0.3 }), nowFor(next));
  const reloaded = listOpportunities()[0]!;
  assert.equal(reloaded.status, "READY_FOR_MASTER_REVIEW");
  assert.ok(reloaded.history.some((h) => h.status === "READY_FOR_MASTER_REVIEW"));
});

function readyRow(): WatchOpportunity {
  const { o, candles } = save("BUY");
  const breakout = candle(41, 100.4, o.level + 0.5, 100.3, o.level + 0.3);
  const next = [...candles.slice(0, -1), candle(40, 100, 100.2, 99.9, 100.1), breakout, candle(42, o.level + 0.3, o.level + 0.4, o.level + 0.2, o.level + 0.3)];
  refreshOpportunities(() => ({ candles: next, price: o.level + 0.3 }), nowFor(next));
  return listOpportunities()[0]!;
}

test("only a READY opportunity on the right desk is picked for review, and not twice in a minute", () => {
  const r = readyRow();
  assert.equal(nextReady("binance")?.id, undefined);
  assert.equal(nextReady("deriv", Date.now())?.id, r.id);
  markReviewStart(r.id, 5_000);
  assert.equal(nextReady("deriv", 5_000 + 30_000), undefined);
  assert.equal(nextReady("deriv", 5_000 + 61_000)?.id, r.id);
  assert.equal(nextReady("deriv", Date.now(), () => true), undefined);
});

test("a WAIT review needs a newer confirming candle; three misses archive it as REJECTED", () => {
  const r = readyRow();
  recordReview(r.id, { kind: "WAIT", note: "Volume was thin." });
  let row = listOpportunities()[0]!;
  assert.equal(row.status, "MONITORING");
  assert.equal(row.reviews, 1);
  assert.equal(row.confirmAfterT, r.confirmedT);
  assert.equal(row.confirmedT, null);
  recordReview(r.id, { kind: "WAIT", note: "Still unclear." });
  recordReview(r.id, { kind: "WAIT", note: "Still unclear." });
  row = listOpportunities()[0]!;
  assert.equal(row.status, "REJECTED");
  clearArchivedOpportunities();
  assert.equal(listOpportunities().length, 0);
});

test("an approved review marks it EXECUTED with the position id", () => {
  const r = readyRow();
  recordReview(r.id, { kind: "EXECUTED", positionId: "pos-1" });
  const row = listOpportunities()[0]!;
  assert.equal(row.status, "EXECUTED");
  assert.equal(row.positionId, "pos-1");
  assert.equal(nextReady("deriv", Date.now() + 10 * 60_000), undefined);
});
