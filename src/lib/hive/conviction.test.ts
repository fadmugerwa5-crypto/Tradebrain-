import test from "node:test";
import assert from "node:assert/strict";
import { lossStreak, sizeByConviction, type SizingInput } from "./conviction.ts";
import { parseReply } from "./parse.ts";
import { runRound, type Ask } from "./colony.ts";
import { buildBrief } from "./brief.ts";
import { STYLE_DEFAULTS, type AccountView, type AgentId } from "./types.ts";
import { sizeMultiplier } from "../trade/swing.ts";
import type { Candle } from "../market/types.ts";

const base: SizingInput = {
  equity: 9000, baseRiskPct: 0.5, maxRiskPct: 1, requestedRiskPct: undefined, confidence: 85, agreeing: 4, rr: 2.5,
  consecLosses: 0, closedTrades: 50, scaleAfterTrades: 20, riskGuardMult: 1, openRiskCash: 0, maxOpenRiskPct: 3, dayLossBudgetCash: 270,
};
const ok = (x: Partial<SizingInput>) => {
  const r = sizeByConviction({ ...base, ...x });
  assert.ok(r.ok, r.ok ? "" : r.why);
  return r.ok ? r : (undefined as never);
};

test("no request means base risk: $45 on $9,000", () => {
  const r = ok({ requestedRiskPct: undefined });
  assert.equal(Math.round(r.riskCash), 45);
});

test("the AI may size up on strong evidence, up to the ceiling for that conviction", () => {
  const r = ok({ requestedRiskPct: 1, confidence: 95 });
  assert.equal(r.riskPct.toFixed(2), "1.00");
  assert.equal(Math.round(r.riskCash), 90);
  const mid = ok({ requestedRiskPct: 1, confidence: 82.5 });
  assert.ok(mid.riskPct > 0.5 && mid.riskPct < 1, `mid ${mid.riskPct}`);
});

test("asking for more than the ceiling is cut, and the reason is recorded", () => {
  const r = ok({ requestedRiskPct: 5, confidence: 95 });
  assert.equal(r.riskPct.toFixed(2), "1.00");
  assert.ok(r.notes.some((n) => /limited to/.test(n)));
});

test("weak evidence caps the AI at base risk, whatever it asks", () => {
  for (const weak of [{ confidence: 60 }, { agreeing: 2 }, { rr: 1.4 }]) {
    const r = ok({ requestedRiskPct: 1, ...weak });
    assert.equal(r.riskPct.toFixed(2), "0.50", JSON.stringify(weak));
  }
});

test("no scaling up after a loss (no loss chasing)", () => {
  const r = ok({ requestedRiskPct: 1, confidence: 95, consecLosses: 2 });
  assert.equal(r.riskPct.toFixed(2), "0.50");
  assert.ok(r.notes.some((n) => /no scaling up/.test(n)));
});

test("the AI can ask for less than base when unsure", () => {
  const r = ok({ requestedRiskPct: 0.2 });
  assert.equal(r.riskPct.toFixed(2), "0.20");
  const tiny = ok({ requestedRiskPct: 0.001 });
  assert.ok(Math.abs(tiny.riskPct - 0.125) < 1e-9, `tiny ${tiny.riskPct}`);
});

test("without a track record, scale-up is limited to half", () => {
  const r = ok({ requestedRiskPct: 1, confidence: 95, closedTrades: 3 });
  assert.equal(r.riskPct.toFixed(2), "0.75");
});

test("Risk Guard can shrink the size but never enlarge it", () => {
  const small = ok({ requestedRiskPct: 0.5, riskGuardMult: 0.5 });
  assert.equal(small.riskPct.toFixed(2), "0.25");
  const big = ok({ requestedRiskPct: 0.5, riskGuardMult: 5 });
  assert.equal(big.riskPct.toFixed(2), "0.50");
});

test("total open risk is capped; at the cap there is no new trade", () => {
  const cut = ok({ requestedRiskPct: 1, confidence: 95, openRiskCash: 200 });
  assert.equal(Math.round(cut.riskCash), 70);
  const full = sizeByConviction({ ...base, openRiskCash: 270 });
  assert.equal(full.ok, false);
});

test("one stop may not breach the daily loss lock", () => {
  const r = ok({ requestedRiskPct: 1, confidence: 95, dayLossBudgetCash: 60 });
  assert.equal(Math.round(r.riskCash), 60);
  assert.equal(sizeByConviction({ ...base, dayLossBudgetCash: 0 }).ok, false);
  assert.equal(sizeByConviction({ ...base, dayLossBudgetCash: 5 }).ok, false);
});

test("invalid account or base is refused", () => {
  assert.equal(sizeByConviction({ ...base, equity: 0 }).ok, false);
  assert.equal(sizeByConviction({ ...base, baseRiskPct: 0 }).ok, false);
});

test("loss streak counts trailing losses only", () => {
  assert.equal(lossStreak([5, -1, -2]), 2);
  assert.equal(lossStreak([-1, 5]), 0);
  assert.equal(lossStreak([]), 0);
});

test("the Executor's riskPct is parsed and clamped", () => {
  assert.equal(parseReply("executor", '{"action":"BUY","riskPct":0.8}', 0, 0).riskPct, 0.8);
  assert.equal(parseReply("executor", '{"action":"BUY","risk_pct":"1.5"}', 0, 0).riskPct, 1.5);
  assert.equal(parseReply("executor", '{"action":"BUY","riskPct":99}', 0, 0).riskPct, 10);
  assert.equal(parseReply("executor", '{"action":"BUY","riskPct":-3}', 0, 0).riskPct, undefined);
  assert.equal(parseReply("executor", '{"action":"BUY"}', 0, 0).riskPct, undefined);
});

// ---- a full round: the AI chooses its own size, and sees the limits ----
function candles(n: number, start: number, drift: number, t0: number): Candle[] {
  const out: Candle[] = []; let p = start;
  for (let i = 0; i < n; i++) { const o = p; p += drift + (i % 3 === 0 ? 0.05 : -0.02); out.push({ t: t0 + i * 60_000, o, h: Math.max(o, p) + 0.1, l: Math.min(o, p) - 0.1, c: p, v: 0 }); }
  return out;
}
test("round: the Executor's riskPct and the agreeing count reach the decision; the prompt states the limits", async () => {
  const now = Date.now();
  const b = buildBrief({ symbol: "R_75", label: "Volatility 75", group: "Synthetic", candles: candles(120, 100, 0.1, now - 120 * 60_000), last: 112, intervalMs: 60_000, now, canShort: true })!;
  const account: AccountView = { equity: 9000, cash: 9000, openPositions: 0, openSymbols: [], dayPnl: 0, recent: [], venue: "deriv", style: "scalp", currency: "USD" };
  let executorPrompt = "";
  const ask: Ask = async (agent: AgentId, _sys, user) => {
    if (agent === "executor") executorPrompt = user;
    const a: Partial<Record<AgentId, string>> = {
      scout: '{"pick":"R_75","vote":"BUY","confidence":85}', trend: '{"vote":"BUY","confidence":88}', scalper: '{"vote":"BUY","confidence":84}', regime: '{"vote":"BUY","confidence":82}', pulse: '{"vote":"BUY","confidence":80}',
      risk: '{"approve":true,"sizeMult":1}', master: '{"approve":true,"note":"ok"}', executor: `{"action":"BUY","confidence":90,"stop":${b.price - b.atr},"target":${b.price + b.atr * 3},"riskPct":0.9,"note":"clean"}`,
    };
    return a[agent] == null ? { ok: false, error: "no key" } : { ok: true, text: a[agent]! };
  };
  const res = await runRound({ shortlist: [b], account, config: { ...STYLE_DEFAULTS.scalp, minRR: 1.8, sizing: { baseRiskPct: 0.5, maxRiskPct: 1 } }, style: "scalp", weights: {}, has: () => true, now: Date.now }, ask);
  assert.equal(res.decision.action, "BUY");
  if (res.decision.action === "BUY") {
    assert.equal(res.decision.requestedRiskPct, 0.9);
    assert.ok((res.decision.agreeing ?? 0) >= 3);
  }
  assert.match(executorPrompt, /Base risk 0\.5%/);
  assert.match(executorPrompt, /hard maximum 1%/);
});

// ---- multiplier sizing already in the app: a win can be larger than the loss ----
test("multiplier sizing: $90 risk with a 2.5x target pays about $225, and the loss is capped near $90", () => {
  const s = sizeMultiplier({ equity: 9000, cash: 9000, riskPct: 1, entry: 100, stop: 99.7, target: 100.75, options: [10, 20, 40, 60, 100, 200] });
  assert.ok(s.ok);
  if (s.ok) {
    assert.ok(Math.abs(s.stopLoss - 90) < 2, `stop loss ${s.stopLoss}`);
    assert.ok(Math.abs(s.takeProfit - 225) < 5, `take profit ${s.takeProfit}`);
    assert.ok(s.takeProfit > s.stopLoss * 2.4);
    assert.ok(s.stake <= 4500);
  }
});
