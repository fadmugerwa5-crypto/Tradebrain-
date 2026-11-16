import test from "node:test";
import assert from "node:assert/strict";
import { assessJump, netProfitAfterCosts, shouldCollectProfit, riskSizedQuantity } from "./jump-scalper.ts";

test("detects repeated intrabar oscillation and a short-term direction", () => {
  const prices = [100, 100.08, 100.02, 100.1, 100.03, 100.12, 100.05, 100.14, 100.08, 100.16, 100.1, 100.18];
  const result = assessJump(prices.map((price, i) => ({ at: i * 1000, price, bid: price - .001, ask: price + .001 })));
  assert.equal(result.state, "oscillating");
  assert.equal(result.direction, "BUY");
});

test("blocks thin data and wide spreads", () => {
  assert.equal(assessJump([{ at: 1, price: 1 }]).state, "insufficient");
  const ticks = Array.from({ length: 16 }, (_, i) => ({ at: i, price: 100 + (i % 2 ? .1 : 0), bid: 99, ask: 101 }));
  assert.equal(assessJump(ticks).direction, "WAIT");
});

test("collects only after net target and sizes risk conservatively", () => {
  assert.equal(netProfitAfterCosts(.6, .08, .02), .5);
  assert.equal(shouldCollectProfit(.5, .5), true);
  assert.equal(shouldCollectProfit(.49, .5), false);
  assert.ok(riskSizedQuantity(1000, 1, 2) > 0);
  assert.equal(riskSizedQuantity(1000, 1, 0), 0);
});
