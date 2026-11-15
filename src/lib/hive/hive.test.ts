import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, parseManage, parseReply, parseWeights } from "./parse.ts";
import { consensus, tally } from "./consensus.ts";
import { resolveLevels } from "./levels.ts";
import { sizeHive } from "./sizing.ts";
import { buildBrief, rankBriefs, isStale } from "./brief.ts";
import { runRound, type Ask } from "./colony.ts";
import { CallGate, makeAsk, detectProfile, askProfile, type Profile } from "./llm.ts";
import { AGENTS, KEYED } from "./agents.ts";
import { HIVE_DEFAULTS, STYLE_DEFAULTS, type AccountView, type AgentId, type AgentReply, type Lesson } from "./types.ts";
import { analyzeTrade, gradeAgents, relevantLessons, scorecards, weightsFrom, adviceFor } from "./learn.ts";
import { STYLE_NOTE, systemFor } from "./agents.ts";
import type { Candle } from "../market/types.ts";

const rep = (agent: AgentId, vote: "BUY" | "SELL" | "WAIT", confidence: number, extra: Partial<AgentReply> = {}): AgentReply => ({ agent, ok: true, vote, confidence, note: "", at: 0, ms: 0, ...extra });

function candles(n: number, start = 100, drift = 0.1, t0 = Date.now() - n * 60_000): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p + drift + Math.sin(i / 3) * 0.2;
    out.push({ t: t0 + i * 60_000, o, h: Math.max(o, p) + 0.15, l: Math.min(o, p) - 0.15, c: p, v: 100 + (i % 7) * 10 });
  }
  return out;
}

test("extractJson handles fences, chatter, think tags and nested braces", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"vote":"BUY","note":"has } brace"} thanks'), { vote: "BUY", note: "has } brace" });
  assert.deepEqual(extractJson('<think>{"x":1}</think>{"y":2}'), { y: 2 });
  assert.deepEqual(extractJson('{"a":{"b":2}}'), { a: { b: 2 } });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

test("parseReply: votes, confidence scaling, levels, risk fields, junk", () => {
  const r = parseReply("scalper", '{"vote":"long","confidence":0.8,"entry":"100.5","stop":99.9,"target":101.7,"note":"  clean   it "}', 1, 2);
  assert.equal(r.ok, true);
  assert.equal(r.vote, "BUY");
  assert.equal(r.confidence, 80);
  assert.equal(r.entry, 100.5);
  assert.equal(r.stop, 99.9);
  assert.equal(r.note, "clean it");
  const ex = parseReply("executor", '{"action":"SELL","confidence":70,"stop_loss":5,"take_profit":3}', 1, 2);
  assert.equal(ex.vote, "SELL");
  assert.equal(ex.stop, 5);
  assert.equal(ex.target, 3);
  const rk = parseReply("risk", '{"approve":"no","sizeMult":5}', 1, 2);
  assert.equal(rk.approve, false);
  assert.equal(rk.sizeMult, 1);
  const sc = parseReply("scout", '{"pick":"null","vote":"WAIT"}', 1, 2);
  assert.equal(sc.pick, null);
  const bad = parseReply("trend", "I think it goes up", 1, 2);
  assert.equal(bad.ok, false);
  assert.equal(parseReply("trend", '{"vote":"maybe","confidence":500}', 1, 2).confidence, 100);
});

test("parseWeights clamps to 0.5..1.5 and ignores unknown agents", () => {
  const w = parseWeights('{"note":"ok","weights":{"trend":3,"scout":0.1,"risk":9,"pulse":"1.2"}}');
  assert.deepEqual(w?.weights, { trend: 1.5, scout: 0.5, pulse: 1.2 });
  assert.equal(parseWeights("nothing"), null);
});

test("consensus: agreement, confidence floor, ties, fewer keys", () => {
  const cfg = { minAgree: 3, minConfidence: 60 };
  const t1 = tally([rep("scout", "BUY", 70), rep("trend", "BUY", 80), rep("scalper", "BUY", 65), rep("regime", "WAIT", 50), rep("pulse", "SELL", 40)]);
  assert.equal(consensus(t1, cfg, 5).side, "BUY");
  const t2 = tally([rep("scout", "BUY", 50), rep("trend", "BUY", 55), rep("scalper", "BUY", 52)]);
  assert.equal(consensus(t2, cfg, 5).side, "WAIT");
  assert.match(consensus(t2, cfg, 5).reason, /confidence/);
  const t3 = tally([rep("scout", "BUY", 90), rep("trend", "BUY", 90), rep("scalper", "SELL", 90), rep("regime", "SELL", 90)]);
  assert.equal(consensus(t3, { minAgree: 2, minConfidence: 60 }, 5).side, "WAIT");
  // Two keyed analysts: two must agree, not three.
  const t4 = tally([rep("trend", "SELL", 75), rep("scalper", "SELL", 70)]);
  assert.equal(consensus(t4, cfg, 2).side, "SELL");
  assert.equal(consensus(t4, cfg, 0).side, "WAIT");
  // Failed agents and non-analysts do not count.
  const t5 = tally([{ ...rep("trend", "BUY", 99), ok: false }, rep("risk", "BUY", 99)]);
  assert.equal(t5.used, 0);
});

test("consensus: Coach weights move the average, not the head count", () => {
  const t = tally([rep("scout", "BUY", 60), rep("trend", "BUY", 60), rep("scalper", "BUY", 60)], { scout: 0.5, trend: 1.5, scalper: 1 });
  assert.equal(t.buy, 3);
  assert.ok(Math.abs(t.avgBuy - 60) < 1e-9);
});

test("resolveLevels keeps sane agent levels and repairs nonsense", () => {
  const ok = resolveLevels("BUY", 100, 1, [{ stop: 99, target: 102 }], 1.5);
  assert.equal(ok.stop, 99);
  assert.equal(ok.target, 102);
  const wrongSide = resolveLevels("BUY", 100, 1, [{ stop: 101, target: 99 }], 1.5);
  assert.equal(wrongSide.stop, 99);
  assert.equal(wrongSide.target, 101.5);
  const absurd = resolveLevels("SELL", 100, 1, [{ stop: 150, target: 10 }], 2);
  assert.equal(absurd.stop, 101);
  assert.equal(absurd.target, 98);
  const second = resolveLevels("BUY", 100, 1, [{ stop: undefined, target: undefined }, { stop: 98.5, target: 103 }], 1.5);
  assert.equal(second.stop, 98.5);
  assert.equal(second.target, 103);
  const tinyStop = resolveLevels("BUY", 100, 1, [{ stop: 99.99 }], 1.5);
  assert.equal(tinyStop.stop, 99);
});

test("sizeHive: spot, minimums, Deriv stake", () => {
  const a = sizeHive({ venue: "paper", equity: 10_000, cash: 10_000, riskPct: 0.5, sizeMult: 1, price: 100, stop: 99, step: 0.01, maxNotional: 10_000 });
  assert.equal(a.ok && a.qty, 50);
  assert.equal(a.ok && Math.round(a.lossAtStop), 50);
  const capped = sizeHive({ venue: "binance", equity: 10_000, cash: 1_000, riskPct: 1, sizeMult: 1, price: 100, stop: 99.9, step: 0.001, maxNotional: 950 });
  assert.equal(capped.ok && capped.notional <= 950, true);
  const half = sizeHive({ venue: "paper", equity: 10_000, cash: 10_000, riskPct: 0.5, sizeMult: 0.5, price: 100, stop: 99, maxNotional: 10_000 });
  assert.equal(half.ok && Math.round(half.qty), 25);
  const small = sizeHive({ venue: "binance", equity: 100, cash: 100, riskPct: 0.1, sizeMult: 1, price: 100, stop: 99, step: 0.001, minNotional: 20, maxNotional: 100 });
  assert.equal(small.ok, false);
  const d = sizeHive({ venue: "deriv", equity: 1000, cash: 1000, riskPct: 0.5, sizeMult: 1, price: 1, stop: 1, maxNotional: 0 });
  assert.equal(d.ok && d.lossAtStop, 5);
  const dLow = sizeHive({ venue: "deriv", equity: 10, cash: 10, riskPct: 0.1, sizeMult: 1, price: 1, stop: 1, maxNotional: 0 });
  assert.equal(dLow.ok && dLow.lossAtStop, 1);
  assert.equal(sizeHive({ venue: "paper", equity: 100, cash: 100, riskPct: 1, sizeMult: 1, price: 100, stop: 100, maxNotional: 100 }).ok, false);
});

test("buildBrief: needs data, flags stale feeds, ranks", () => {
  assert.equal(buildBrief({ symbol: "X", label: "X", group: "g", candles: candles(10), intervalMs: 60_000, now: Date.now(), canShort: true }), null);
  const now = Date.now();
  const b = buildBrief({ symbol: "BTCUSDT", label: "Bitcoin", group: "Crypto", candles: candles(120, 100, 0.1, now - 120 * 60_000), bid: 100, ask: 100.01, last: 112, intervalMs: 60_000, now, canShort: false })!;
  assert.ok(b);
  assert.equal(b.price, 112);
  assert.equal(b.canShort, false);
  assert.ok(b.atr > 0 && b.rsi != null && b.ema50 != null);
  assert.equal(isStale(b, 60_000), false);
  const old = buildBrief({ symbol: "OLD", label: "Old", group: "g", candles: candles(120, 100, 0.1, now - 5 * 3_600_000), intervalMs: 60_000, now, canShort: true })!;
  assert.equal(isStale(old, 60_000), true);
  assert.deepEqual(rankBriefs([old, b], 60_000, 5).map((x) => x.symbol), ["BTCUSDT"]);
});

function fixture() {
  const now = Date.now();
  const b = buildBrief({ symbol: "BTCUSDT", label: "Bitcoin", group: "Crypto", candles: candles(120, 100, 0.1, now - 120 * 60_000), last: 112, intervalMs: 60_000, now, canShort: true })!;
  const e = buildBrief({ symbol: "ETHUSDT", label: "Ether", group: "Crypto", candles: candles(120, 50, 0.05, now - 120 * 60_000), last: 56, intervalMs: 60_000, now, canShort: true })!;
  const account: AccountView = { equity: 10_000, cash: 10_000, openPositions: 0, openSymbols: [], dayPnl: 0, recent: [], venue: "deriv", style: "scalp", currency: "USD" };
  return { b, e, account };
}

/** A fake model: one canned answer per agent. */
const script = (answers: Partial<Record<AgentId, string>>, log: AgentId[] = []): Ask => async (agent) => {
  log.push(agent);
  const a = answers[agent];
  return a == null ? { ok: false, error: "no key" } : { ok: true, text: a };
};

test("round: five analysts agree, Risk and Executor confirm -> a BUY with levels", async () => {
  const { b, e, account } = fixture();
  const called: AgentId[] = [];
  const res = await runRound(
    { shortlist: [b, e], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => true, now: Date.now },
    script(
      {
        scout: '{"pick":"BTCUSDT","vote":"BUY","confidence":75,"note":"clean push"}',
        trend: '{"vote":"BUY","confidence":80,"note":"EMA stack up"}',
        scalper: `{"vote":"BUY","confidence":70,"stop":${b.price - b.atr},"target":${b.price + b.atr * 2},"note":"pullback"}`,
        regime: '{"vote":"BUY","confidence":65,"note":"trending"}',
        pulse: '{"vote":"WAIT","confidence":40,"note":"a little stretched"}',
        risk: '{"approve":true,"sizeMult":0.6,"note":"fine"}',
        executor: `{"action":"BUY","confidence":72,"stop":${b.price - b.atr},"target":${b.price + b.atr * 2},"note":"go"}`,
        master: '{"approve":true,"note":"independent review passed"}',
      },
      called,
    ),
  );
  assert.equal(res.symbol, "BTCUSDT");
  assert.equal(res.decision.action, "BUY");
  if (res.decision.action === "BUY") {
    assert.equal(res.decision.sizeMult, 0.6);
    assert.ok(res.decision.stop < res.decision.entry && res.decision.target > res.decision.entry);
  }
  assert.equal(res.tally.buy, 4);
  assert.ok(called.indexOf("risk") > called.indexOf("pulse"));
  assert.ok(called.indexOf("executor") > called.indexOf("risk"));
  assert.equal(res.chatter.length, 8);
});

test("round: configured Master Intelligence has its own final veto", async () => {
  const { b, account } = fixture();
  const yes = { scout: '{"pick":"BTCUSDT","vote":"BUY","confidence":85}', trend: '{"vote":"BUY","confidence":85}', scalper: `{"vote":"BUY","confidence":85,"stop":${b.price - b.atr},"target":${b.price + b.atr * 2}}`, regime: '{"vote":"BUY","confidence":85}', pulse: '{"vote":"BUY","confidence":85}', risk: '{"approve":true}', executor: '{"action":"BUY","confidence":85}', master: '{"approve":false,"note":"conflicting evidence"}' };
  const res = await runRound({ shortlist: [b], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => true, now: Date.now }, script(yes));
  assert.equal(res.decision.action, "WAIT");
  assert.match(res.decision.action === "WAIT" ? res.decision.reason : "", /Master Intelligence vetoed/);
});

test("round: a split colony stops before Risk and Executor are even asked", async () => {
  const { b, account } = fixture();
  const called: AgentId[] = [];
  const res = await runRound(
    { shortlist: [b], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => true, now: Date.now },
    script({ scout: '{"pick":"BTCUSDT","vote":"BUY","confidence":70}', trend: '{"vote":"BUY","confidence":70}', scalper: '{"vote":"SELL","confidence":70}', regime: '{"vote":"WAIT","confidence":50}', pulse: '{"vote":"WAIT","confidence":50}', risk: '{"approve":true}', executor: '{"action":"BUY"}' }, called),
  );
  assert.equal(res.decision.action, "WAIT");
  assert.ok(!called.includes("risk") && !called.includes("executor"));
});

test("round: Risk veto, Executor disagreement, Scout 'nothing', long-only SELL", async () => {
  const { b, account } = fixture();
  const yes = { scout: '{"pick":"BTCUSDT","vote":"BUY","confidence":80}', trend: '{"vote":"BUY","confidence":80}', scalper: '{"vote":"BUY","confidence":80}', regime: '{"vote":"BUY","confidence":80}', pulse: '{"vote":"BUY","confidence":80}' };
  const run = (answers: Partial<Record<AgentId, string>>, shortlist = [b]) => runRound({ shortlist, account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => true, now: Date.now }, script(answers));
  const veto = await run({ ...yes, risk: '{"approve":false,"note":"too hot"}', executor: '{"action":"BUY","confidence":90}' });
  assert.equal(veto.decision.action, "WAIT");
  assert.match(veto.decision.action === "WAIT" ? veto.decision.reason : "", /Risk Guard vetoed/);
  const dis = await run({ ...yes, risk: '{"approve":true}', executor: '{"action":"SELL","confidence":90}' });
  assert.match(dis.decision.action === "WAIT" ? dis.decision.reason : "", /opposite/);
  const none = await run({ scout: '{"pick":null,"vote":"WAIT","note":"flat"}', trend: '{"vote":"BUY","confidence":99}' });
  assert.match(none.decision.action === "WAIT" ? none.decision.reason : "", /nothing worth/);
  const longOnly = { ...b, canShort: false };
  const sell = await run({ scout: '{"pick":"BTCUSDT","vote":"SELL","confidence":80}', trend: '{"vote":"SELL","confidence":80}', scalper: '{"vote":"SELL","confidence":80}', regime: '{"vote":"SELL","confidence":80}', pulse: '{"vote":"SELL","confidence":80}', risk: '{"approve":true}', executor: '{"action":"SELL"}' }, [longOnly]);
  assert.match(sell.decision.action === "WAIT" ? sell.decision.reason : "", /long-only/);
});

test("round: works with only some keys, and with none", async () => {
  const { b, account } = fixture();
  const has = (a: AgentId) => a === "trend" || a === "scalper";
  const res = await runRound(
    { shortlist: [b], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has, now: Date.now },
    script({ trend: '{"vote":"SELL","confidence":75}', scalper: '{"vote":"SELL","confidence":70}' }),
  );
  assert.equal(res.decision.action, "SELL");
  const none = await runRound({ shortlist: [b], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => false, now: Date.now }, script({}));
  assert.equal(none.decision.action, "WAIT");
  const empty = await runRound({ shortlist: [], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => true, now: Date.now }, script({}));
  assert.equal(empty.decision.action, "WAIT");
});

test("round: an agent that throws or returns junk never crashes the colony", async () => {
  const { b, account } = fixture();
  const ask: Ask = async (agent) => {
    if (agent === "trend") throw new Error("boom");
    if (agent === "scalper") return { ok: true, text: "I refuse to answer in JSON" };
    return { ok: true, text: '{"vote":"BUY","confidence":90,"pick":"BTCUSDT"}' };
  };
  const res = await runRound({ shortlist: [b], account, config: { ...STYLE_DEFAULTS.scalp, minAgree: 2 }, style: "scalp", weights: {}, has: (a) => a !== "risk" && a !== "executor" && a !== "master", now: Date.now }, ask);
  assert.equal(res.replies.filter((r) => !r.ok).length, 2);
  assert.equal(res.decision.action, "BUY");
});

test("CallGate limits calls per minute and rests agents", () => {
  let t = 1_000_000;
  const g = new CallGate(3, () => t);
  assert.equal(g.take() && g.take() && g.take(), true);
  assert.equal(g.take(), false);
  t += 61_000;
  assert.equal(g.take(), true);
  g.pause("trend", 5000);
  assert.equal(g.resting("trend"), 5000);
  t += 6000;
  assert.equal(g.resting("trend"), 0);
});

test("makeAsk: no key, limit, rate-limit rest", async () => {
  const gate = new CallGate(2);
  const profile: Profile = { provider: "groq", label: "Groq", model: "m", key: "k".repeat(20) };
  let calls = 0;
  const ask = makeAsk({
    profile: (a) => (a === "trend" ? null : profile),
    gate,
    ask: async () => {
      calls++;
      return calls === 1 ? { ok: false, error: "Groq request failed (429: slow down)" } : { ok: true, text: "{}" };
    },
  });
  assert.equal((await ask("trend", "s", "u")).ok, false);
  assert.equal(calls, 0);
  assert.equal((await ask("scout", "s", "u")).ok, false);
  const rest = await ask("scout", "s", "u");
  assert.equal(rest.ok === false && /Resting/.test(rest.error), true);
  assert.equal(calls, 1);
  assert.equal((await ask("pulse", "s", "u")).ok, true);
  const lim = await ask("regime", "s", "u");
  assert.equal(lim.ok === false && /limit/.test(lim.error), true);
});

test("per-brain budget: independent daily caps, cooldown and identical-prompt cache", async () => {
  let now = Date.UTC(2026, 0, 1, 12);
  const profile: Profile = { provider: "groq", label: "Groq", model: "m", key: "gsk_" + "a".repeat(40) };
  const usage: Record<string, any> = {};
  const records: string[] = [];
  let calls = 0;
  const ask = makeAsk({
    profile: () => profile, gate: new CallGate(20, () => now), now: () => now,
    ask: async () => { calls++; return { ok: true, text: `answer-${calls}` }; },
    budget: {
      policy: () => ({ enabled: true, dailyCalls: 1, perMinute: 5, cooldownSec: 0, cacheSec: 30, maxInputChars: 3000, maxOutputTokens: 200 }),
      usage: (a) => usage[a] ?? { day: "", calls: 0, cached: 0, blocked: 0, errors: 0, stamps: [], lastAt: 0 },
      record: (a, k, at) => { records.push(`${a}:${k}`); const old = usage[a] ?? { day: new Date(at).toISOString().slice(0, 10), calls: 0, cached: 0, blocked: 0, errors: 0, stamps: [], lastAt: 0 }; usage[a] = { ...old, day: new Date(at).toISOString().slice(0, 10), calls: old.calls + (k === "call" ? 1 : 0), cached: old.cached + (k === "cached" ? 1 : 0), blocked: old.blocked + (k === "blocked" ? 1 : 0), stamps: k === "call" ? [...old.stamps, at] : old.stamps, lastAt: k === "call" ? at : old.lastAt }; },
    },
  });
  const first = await ask("scout", "sys", "same market facts");
  const cached = await ask("scout", "sys", "same market facts");
  assert.equal(first.ok, true);
  assert.equal(cached.ok && cached.text, "answer-1");
  assert.equal(calls, 1, "identical prompt should reuse the cached answer");
  const blocked = await ask("scout", "sys", "different prompt");
  assert.equal(blocked.ok === false && /daily API limit/.test(blocked.error), true);
  const otherBrain = await ask("trend", "sys", "same market facts");
  assert.equal(otherBrain.ok, true, "one brain's daily cap must not consume another brain's budget");
  assert.deepEqual(records.slice(0, 4), ["scout:call", "scout:cached", "scout:blocked", "trend:call"]);
});

test("detectProfile: known keys are detected from the key alone; unknown ones use an endpoint", async () => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const auth = JSON.stringify(init?.headers ?? {});
    if (u.startsWith("https://api.groq.com/openai/v1/models")) return new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large" }] }), { status: 200 });
    if (u.startsWith("https://my.llm.example/v1/models")) return new Response(JSON.stringify({ data: [{ id: "text-embed-1" }, { id: "cool-chat-1" }] }), { status: 200 });
    if (u.startsWith("https://my.llm.example/v1/chat/completions")) return new Response(JSON.stringify({ choices: [{ message: { content: '{"vote":"BUY"}' } }] }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: `no ${auth.length}` } }), { status: 401 });
  }) as typeof fetch;
  try {
    const g = await detectProfile({ key: "gsk_" + "a".repeat(40), base: "", model: "" });
    assert.equal(g.ok && g.profile.provider, "groq");
    assert.equal(g.ok && g.profile.model, "llama-3.3-70b-versatile");
    assert.ok(!calls.some((c) => c.includes("openai.com")), "a gsk_ key must never be sent to OpenAI");
    const c = await detectProfile({ key: "weird-key-1234567890", base: "https://my.llm.example/v1/", model: "" });
    assert.equal(c.ok && c.profile.provider, "custom");
    assert.equal(c.ok && c.profile.model, "cool-chat-1");
    if (c.ok) {
      const a = await askProfile(c.profile, "sys", "user");
      assert.equal(a.ok && a.text, '{"vote":"BUY"}');
    }
    const bad = await detectProfile({ key: "gsk_" + "b".repeat(5), base: "", model: "" });
    assert.equal(bad.ok, false);
    const forced = await detectProfile({ key: "weird-key-1234567890", base: "https://my.llm.example/v1", model: "forced" });
    assert.equal(forced.ok && forced.profile.model, "forced");
  } finally {
    globalThis.fetch = real;
  }
});

test("roster: eleven agents, ten need a key, unique ids and colors", () => {
  assert.equal(AGENTS.length, 11);
  assert.equal(KEYED.length, 10);
  assert.equal(new Set(AGENTS.map((a) => a.id)).size, 11);
  assert.equal(new Set(AGENTS.map((a) => a.color)).size, 11);
});

test("parseManage: only a clear CLOSE closes", () => {
  assert.equal(parseManage('{"action":"CLOSE","note":"momentum died"}').close, true);
  assert.equal(parseManage('{"action":"exit"}').close, true);
  assert.equal(parseManage('{"action":"HOLD"}').close, false);
  assert.equal(parseManage("close it now please").close, false);
  assert.equal(parseManage("").close, false);
});

test("styles: defaults, prompts and level bounds differ", () => {
  assert.equal(HIVE_DEFAULTS.scalp.interval, "1m");
  assert.equal(HIVE_DEFAULTS.trader.interval, "1h");
  assert.ok(HIVE_DEFAULTS.trader.roundSec > HIVE_DEFAULTS.scalp.roundSec);
  assert.match(systemFor("trend", "trader"), /TRADER/);
  assert.match(systemFor("trend", "scalp"), /SCALP/);
  assert.notEqual(STYLE_NOTE.scalp, STYLE_NOTE.trader);
  // A 0.3 ATR stop is fine for a scalp, too tight for a trader (min 0.5 ATR), so it is replaced by 1.5 ATR.
  const sc = resolveLevels("BUY", 100, 1, [{ stop: 99.7, target: 101 }], 1.5, "scalp");
  assert.equal(Math.round(sc.stop * 100) / 100, 99.7);
  const tr = resolveLevels("BUY", 100, 1, [{ stop: 99.7, target: 101 }], 2.5, "trader");
  assert.equal(tr.stop, 98.5);
  assert.equal(tr.target, 103.75);
  const far = resolveLevels("BUY", 100, 1, [{ stop: 94.5, target: 114 }], 2.5, "trader");
  assert.equal(far.stop, 94.5);
  assert.equal(far.target, 114);
});

test("round: the trader style reaches the agents, and lessons are shown to them", async () => {
  const { b, account } = fixture();
  const seen: string[] = [];
  const ask: Ask = async (agent, system, user) => {
    seen.push(system.includes("TRADER") ? "T" : "S");
    if (agent === "trend") assert.match(user, /Lessons from this colony/);
    if (agent === "trend") assert.match(user, /stop was too tight/);
    return { ok: true, text: '{"vote":"WAIT","confidence":30}' };
  };
  await runRound({ shortlist: [b], account: { ...account, style: "trader" }, config: STYLE_DEFAULTS.trader, style: "trader", lessons: () => ["BTCUSDT BUY (trader) -1.0R: The stop was too tight."], weights: {}, has: (a) => a === "trend", now: Date.now }, ask);
  assert.deepEqual(seen, ["T"]);
});

test("analyzeTrade: what went wrong, in numbers", () => {
  // Buy 100, stop 99, target 102. Went to 101.2 then fell to the stop. After the exit it climbed back to 101.5.
  const a = analyzeTrade({ side: "BUY", entry: 100, stop: 99, target: 102, exit: 99, pnl: -25, risk: 25, high: 101.2, low: 98.9, after: 101.5 });
  assert.equal(a.outcome, "loss");
  assert.equal(Math.round(a.r * 10) / 10, -1);
  assert.ok(a.tags.includes("was-winning-then-reversed"));
  assert.ok(a.tags.includes("stopped-out-then-reversed"));
  assert.ok(!a.tags.includes("wrong-from-the-start"));
  // Wrong from the start: straight against, never in profit.
  const w = analyzeTrade({ side: "SELL", entry: 100, stop: 101, target: 98, exit: 101, pnl: -20, risk: 20, high: 101.1, low: 99.9 });
  assert.ok(w.tags.includes("wrong-from-the-start"));
  // A win that was cut short.
  const e = analyzeTrade({ side: "BUY", entry: 100, stop: 99, target: 103, exit: 101, pnl: 25, risk: 25, high: 101.2, low: 99.8, after: 103 });
  assert.equal(e.outcome, "win");
  assert.ok(e.tags.includes("exited-early"));
  // Target almost reached then reversed.
  const t = analyzeTrade({ side: "BUY", entry: 100, stop: 99, target: 102, exit: 99.2, pnl: -20, risk: 25, high: 101.6, low: 99.1 });
  assert.ok(t.tags.includes("target-too-far"));
  assert.match(adviceFor(["was-winning-then-reversed"]), /profit/);
  assert.equal(analyzeTrade({ side: "BUY", entry: 100, stop: 100, target: 101, exit: 100, pnl: 0, risk: 0, high: 100, low: 100 }).tags.length, 0);
});

test("gradeAgents, scorecards and weights", () => {
  const votes = [
    { agent: "trend" as AgentId, vote: "BUY" as const, confidence: 80 },
    { agent: "pulse" as AgentId, vote: "WAIT" as const, confidence: 40 },
    { agent: "risk" as AgentId, vote: "BUY" as const, confidence: 90 },
  ];
  const loss = gradeAgents(votes, "BUY", "loss");
  assert.deepEqual(loss.wrong, ["trend"]);
  assert.deepEqual(loss.right, ["pulse"]);
  const win = gradeAgents(votes, "BUY", "win");
  assert.deepEqual(win.right, ["trend"]);
  const masterVote = { agent: "master" as AgentId, vote: "WAIT" as const, confidence: 80 };
  assert.deepEqual(gradeAgents([...votes, masterVote], "BUY", "win"), { right: ["trend", "master"], wrong: ["pulse"] });
  assert.deepEqual(gradeAgents([...votes, masterVote], "BUY", "loss"), { right: ["pulse"], wrong: ["trend", "master"] });
  assert.deepEqual(gradeAgents(votes, "BUY", "flat"), { right: [], wrong: [] });
  const lessons = Array.from({ length: 12 }, (_, i) => ({ right: (i < 9 ? ["trend"] : []) as AgentId[], wrong: (i < 9 ? ["scalper"] : ["trend"]) as AgentId[] }));
  const cards = scorecards(lessons);
  assert.deepEqual(cards.trend, { n: 12, right: 9 });
  const w = weightsFrom(cards, 5);
  assert.ok(Math.abs((w.trend ?? 0) - 1.25) < 1e-9);
  assert.ok((w.scalper ?? 1) <= 0.5 + 1e-9);
  assert.equal(weightsFrom({ trend: { n: 5, right: 5 } }).trend, undefined);
});

test("relevantLessons: same market and losses first, nothing unrelated", () => {
  const L = (id: string, symbol: string, style: "scalp" | "trader", r: number, t: number): Lesson => ({ id, t, symbol, side: "BUY", style, desk: "binance", r, tags: [], text: id, right: [], wrong: [] });
  const list = [L("a", "BTCUSDT", "trader", -1, 100), L("b", "ETHUSDT", "trader", -1, 200), L("c", "R_100", "scalp", -1, 300), L("d", "BTCUSDT", "trader", 2, 50)];
  const got = relevantLessons(list, { symbol: "BTCUSDT", style: "trader", desk: "binance", side: "BUY" }, 3).map((l) => l.id);
  assert.equal(got[0], "a");
  assert.ok(!got.includes("c"));
  assert.deepEqual(relevantLessons([], { symbol: "X", style: "scalp", desk: "deriv" }), []);
});

test("round: Master, Risk and Executor prompts keep the decision first, so a length cut never removes it", async () => {
  const { b, account } = fixture();
  const seen: Record<string, string> = {};
  const yes: Record<string, string> = { scout: '{"pick":"BTCUSDT","vote":"BUY","confidence":85}', trend: '{"vote":"BUY","confidence":85}', scalper: `{"vote":"BUY","confidence":85,"stop":${b.price - b.atr},"target":${b.price + b.atr * 2}}`, regime: '{"vote":"BUY","confidence":85}', pulse: '{"vote":"BUY","confidence":85}', risk: '{"approve":true}', executor: '{"action":"BUY","confidence":85}', master: '{"approve":true}' };
  const ask: Ask = async (agent, _system, user) => {
    seen[agent] = user;
    const a = yes[agent];
    return a == null ? { ok: false, error: "no key" } : { ok: true, text: a };
  };
  await runRound({ shortlist: [b], account, config: STYLE_DEFAULTS.scalp, style: "scalp", weights: {}, has: () => true, now: Date.now }, ask);
  const cut = (s: string) => s.slice(0, 600);
  assert.match(cut(seen.master!), /Proposed trade: BUY BTCUSDT/);
  assert.match(cut(seen.master!), /veto/i);
  assert.match(cut(seen.executor!), /Give the final call/);
  assert.match(cut(seen.risk!), /Review this proposal/);
});
