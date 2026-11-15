import test from "node:test";
import assert from "node:assert/strict";
import { derivPatientReview, durationSecFromLabel, minHoldPassed, patientMinHold } from "./exit-policy.ts";

const base = { stake: 50, durationSec: 300, minHoldSec: 90, bankPct: 35 };

test("duration labels parse", () => {
  assert.equal(durationSecFromLabel("5-minute"), 300);
  assert.equal(durationSecFromLabel("2-hour"), 7200);
  assert.equal(durationSecFromLabel("1-day"), 86400);
  assert.equal(durationSecFromLabel("weird"), null);
});

test("minimum hold is the larger of the setting and 40% of the contract", () => {
  assert.equal(patientMinHold({ minHoldSec: 90, durationSec: 300 }), 120);
  assert.equal(patientMinHold({ minHoldSec: 200, durationSec: 300 }), 200);
  assert.equal(patientMinHold({ minHoldSec: 90, durationSec: null }), 90);
});

test("a Deriv trade sold within seconds is never reviewed, even in profit", () => {
  const g = derivPatientReview({ ...base, profit: 40, heldSec: 5 });
  assert.equal(g.review, false);
  assert.equal(derivPatientReview({ ...base, profit: 40, heldSec: 100 }).review, false);
});

test("a small profit is not worth selling early", () => {
  const g = derivPatientReview({ ...base, profit: 2, heldSec: 150 });
  assert.equal(g.review, false);
  assert.match(g.reason, /Letting the contract run/);
});

test("a loss never opens an early-sale review", () => {
  assert.equal(derivPatientReview({ ...base, profit: -1.74, heldSec: 150 }).review, false);
});

test("a large profit after the minimum hold may be reviewed", () => {
  assert.equal(derivPatientReview({ ...base, profit: 20, heldSec: 150 }).review, true);
});

test("no review in the last 30 seconds: let it settle", () => {
  assert.equal(derivPatientReview({ ...base, profit: 30, heldSec: 285 }).review, false);
});

test("unknown stake is never reviewed", () => {
  assert.equal(derivPatientReview({ ...base, stake: 0, profit: 5, heldSec: 200 }).review, false);
});

test("non-Deriv minimum hold", () => {
  assert.equal(minHoldPassed(30, 90), false);
  assert.equal(minHoldPassed(90, 90), true);
});
