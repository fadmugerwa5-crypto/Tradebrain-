import assert from "node:assert/strict";
import test from "node:test";
import { takeReadings } from "./readings.ts";
import type { Candle } from "./types.ts";

function walk(n: number, drift: number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 5) * 0.4;
    const o = p;
    p = p + drift + wave * 0.3;
    out.push({ t: 1_700_000_000_000 + i * 300_000, o, h: Math.max(o, p) + 0.2, l: Math.min(o, p) - 0.2, c: p, v: 100 });
  }
  return out;
}

test("takeReadings gives eight readings with a value each", () => {
  const r = takeReadings(walk(260, 0.1), "5m", 14);
  assert.equal(r.length, 8);
  for (const x of r) assert.ok(x.label && x.value, x.key);
  assert.equal(r[0]!.value, "Up");
  assert.equal(r[5]!.value, "Above both");
});

test("takeReadings: a falling market reads Down and below the EMAs", () => {
  const r = takeReadings(walk(260, -0.1), "5m", 14);
  assert.equal(r[0]!.value, "Down");
  assert.equal(r[5]!.value, "Below both");
});

test("takeReadings: short history says so instead of inventing numbers", () => {
  const r = takeReadings(walk(40, 0.1), "1m", 14);
  assert.equal(r.length, 8);
  assert.equal(r[5]!.tone === "flat" || r[5]!.value.includes("needs more"), true);
});
