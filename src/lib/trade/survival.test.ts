import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTradeSurvival } from "./survival.ts";
import type { Candle } from "../market/types.ts";

function candles(direction: "up" | "down" = "up"): Candle[] {
  const rows: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 40; i++) {
    const move = direction === "up" ? 0.5 : -0.5;
    const o = p; p += move;
    rows.push({ t: i * 60_000, o, h: Math.max(o, p) + 0.2, l: Math.min(o, p) - 0.2, c: p, v: 100 });
  }
  return rows;
}

test("normal adverse movement is classified as pullback, not exit", () => {
  const cs = candles("up");
  const result = evaluateTradeSurvival({ side: "BUY", entry: 119, stop: 117, price: 118.5, high: 120, low: 118.4, candles: cs });
  assert.equal(result.state, "NORMAL_PULLBACK");
  assert.equal(result.reviewWithAI, false);
});

test("insufficient candle history never authorizes an AI early exit", () => {
  const result = evaluateTradeSurvival({ side: "BUY", entry: 100, stop: 98, price: 99, high: 100, low: 99, candles: candles().slice(0, 10) });
  assert.equal(result.state, "INSUFFICIENT_DATA");
  assert.equal(result.reviewWithAI, false);
});

test("survival monitor never changes the original stop", () => {
  const stop = 98;
  const result = evaluateTradeSurvival({ side: "BUY", entry: 100, stop, price: 99, high: 100, low: 99, candles: candles() });
  assert.equal(stop, 98);
  assert.equal(result.reviewWithAI, false);
});

test("confirmed swing-structure break requests a specialist review", () => {
  const cs = candles("up");
  let p = cs[cs.length - 1]!.c;
  for (let i = 0; i < 5; i++) {
    const o = p; p -= 3;
    cs.push({ t: (40 + i) * 60_000, o, h: o + 0.2, l: p - 0.2, c: p, v: 100 });
  }
  const result = evaluateTradeSurvival({ side: "BUY", entry: 118, stop: 114, price: p, high: 121, low: p - 0.2, candles: cs });
  assert.equal(result.state, "THESIS_INVALIDATED");
  assert.equal(result.reviewWithAI, true);
});

test("one losing candle does not trigger an early-close review", () => {
  const cs = candles("up");
  const p = cs[cs.length - 1]!.c;
  cs.push({ t: 40 * 60_000, o: p, h: p + 0.1, l: p - 1, c: p - 0.8, v: 100 });
  const result = evaluateTradeSurvival({ side: "BUY", entry: 118, stop: 115, price: p - 0.8, high: 120, low: p - 1, candles: cs });
  assert.notEqual(result.state, "THESIS_INVALIDATED");
  assert.equal(result.reviewWithAI, false);
});
