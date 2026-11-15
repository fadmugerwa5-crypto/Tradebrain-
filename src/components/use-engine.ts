import { useEffect } from "react";
import { marketData, binanceOrder, binanceBalances, binanceProtect, binanceProtectionStatus, binanceUnprotect, futuresPrepare, futuresProtect, futuresStatus, futuresUnprotect } from "@/lib/brokers/api";
import { autoReconnect, refreshDerivMarkets } from "@/lib/brokers/connect";
import { DERIV_GRANULARITY, deriv } from "@/lib/brokers/deriv";
import { decide } from "@/lib/market/analyze";
import { BINANCE_HOSTS, INTERVAL_MS, isDerivSymbol, isFuturesEnv, marketInfo, type BinanceEnv, type Candle } from "@/lib/market/types";
import { learnGate } from "@/lib/learn/store";
import { dayKey, equityOf, fillPrice, openPosition, closePosition, type BookPosition } from "@/lib/trade/account";
import { askAI } from "@/lib/brokers/ai";
import { evalGoal, realizedSince, startOfUtcDay } from "@/lib/trade/goal";
import { MANAGE_SYSTEM, entrySystemFor, entryBrief, favorableR, manageBrief, parseEntry, parseManage, type AiEntryReply, type BriefContext } from "@/lib/trade/aiscalp";
import { floorToStep } from "@/lib/trade/risk";
import { derivExit, derivNormalExit, givebackHalt, riskScale, scalpFor, type ScalpConfig } from "@/lib/trade/scalp";
import { planCycle, type EntryIntent, type RadarPick } from "@/lib/trade/planner";
import { candidateDecision, radarSystemFor, parseRadar, radarBrief, runRadar, type Candidate, type RadarRow } from "@/lib/trade/radar";
import { saveRadarOpportunity } from "@/lib/trade/watchtower";
import type { SwingEntry } from "@/lib/trade/swing";
import { AI_SLOTS, useBrain } from "@/stores/brain";
import { startSwingLoop } from "./swing-engine";
import { startHiveLoop } from "@/lib/hive/loop";
import { useHive } from "@/stores/hive";

const fetchedAt: Record<string, number> = {};
let cursor = 0;
let marketsRefreshedAt = Date.now();
let tickersAt = 0;
let lastInterval = "";
/** Set after a profitable close in scalp mode so the next scan runs at once instead of waiting. */
const scan = { soon: false };
/** Futures symbols whose leverage and margin type were already set in this session. */
const futuresReady = new Set<string>();

/** Market data always comes from the connected Binance account's own environment. */
function dataEnv(): BinanceEnv {
  return useBrain.getState().settings.binanceEnv;
}

/** One request gives the last price and 24h change for every Binance market in the list. */
async function refreshTickers(env: BinanceEnv, symbols: string[]) {
  if (!symbols.length || Date.now() - tickersAt < 15_000) return;
  tickersAt = Date.now();
  const res = (await marketData({ data: { op: "tickers", env, symbols } })) as { rows?: { symbol: string; lastPrice: string; priceChangePercent: string }[] };
  const patch: Record<string, { bid: number | null; ask: number | null; last: number; chg: number | null }> = {};
  const prev = useBrain.getState().quotes;
  for (const r of res.rows ?? []) {
    const last = Number(r.lastPrice);
    if (!(last > 0)) continue;
    patch[r.symbol] = { bid: prev[r.symbol]?.bid ?? null, ask: prev[r.symbol]?.ask ?? null, last, chg: Number(r.priceChangePercent) };
  }
  if (Object.keys(patch).length) useBrain.setState((st) => ({ quotes: { ...st.quotes, ...patch }, feedAt: Date.now() }));
}

const badSymbolLogged = new Set<string>();
const klineFailLogged = new Set<string>();
async function refreshBinance(symbols: string[], interval: string, env: BinanceEnv) {
  const now = Date.now();
  const focus = useBrain.getState().symbol;
  // A symbol Binance cannot take (a stray Deriv/other-broker name, an empty or odd value) must not stop the whole
  // cycle: it is skipped, named once in the log, and everything else keeps loading.
  const valid = symbols.filter((sym) => {
    if (/^[A-Z0-9]{5,20}$/.test(String(sym ?? "").toUpperCase())) return true;
    if (!badSymbolLogged.has(String(sym))) {
      badSymbolLogged.add(String(sym));
      useBrain.getState().log(`Skipping "${String(sym)}": not a Binance symbol, so it is not loaded from Binance.`, "warn");
    }
    return false;
  });
  symbols = valid;
  const due = symbols.filter((sym) => now - (fetchedAt[sym] ?? 0) > (sym === focus ? 5_000 : 20_000));
  await Promise.all(
    due.map(async (symbol) => {
      try {
        const res = await marketData({ data: { op: "klines", env, symbol, interval } });
        const candles = (res as { candles?: Candle[] }).candles;
        if (!candles?.length) return;
        if (useBrain.getState().settings.interval !== interval) return; // timeframe changed while this was in flight
        fetchedAt[symbol] = Date.now();
        useBrain.setState((st) => ({
          candles: { ...st.candles, [symbol]: candles },
          quotes: {
            ...st.quotes,
            [symbol]: {
              ...st.quotes[symbol],
              bid: st.quotes[symbol]?.bid ?? null,
              ask: st.quotes[symbol]?.ask ?? null,
              last: candles[candles.length - 1]!.c,
              chg: st.quotes[symbol]?.chg ?? null,
            },
          },
          feedAt: Date.now(),
        }));
      } catch (err) {
        // Back off this one symbol for a minute and say which one failed.
        fetchedAt[symbol] = Date.now() + 40_000;
        const msg = err instanceof Error ? err.message : "load failed";
        if (!klineFailLogged.has(symbol)) {
          klineFailLogged.add(symbol);
          useBrain.getState().log(`${symbol}: ${msg}`, "warn");
        }
      }
    }),
  );
  if (symbols.length) {
    const books = (await marketData({ data: { op: "books", env, symbols } })) as {
      rows?: { symbol: string; bidPrice: string; askPrice: string }[];
    };
    const patch: Record<string, { bid: number; ask: number; last: number; chg: number | null }> = {};
    for (const row of books.rows ?? []) {
      const bid = Number(row.bidPrice);
      const ask = Number(row.askPrice);
      if (!(bid > 0) || !(ask > 0)) continue;
      const prev = useBrain.getState().quotes[row.symbol];
      patch[row.symbol] = { bid, ask, last: (bid + ask) / 2, chg: prev?.chg ?? null };
    }
    if (Object.keys(patch).length) {
      useBrain.setState((st) => ({ quotes: { ...st.quotes, ...patch }, feedAt: Date.now() }));
    }
  }
}

let derivBackoffUntil = 0;
/** Lowest profit % of stake seen on each open Deriv contract (Normal-mode scalp: wait out a dip, sell on the bounce). */
const worstPct: Record<string, number> = {};

/**
 * Deriv limits history requests ("ticks_history_expensive"), so they are paced, not fired in bursts.
 * Markets without candles go first, then the stalest. A rate-limit answer pauses all history fetching for a minute.
 */
async function refreshDeriv(symbols: string[], interval: string) {
  const g = DERIV_GRANULARITY[interval] ?? 900;
  const focus = useBrain.getState().symbol;
  const store = useBrain.getState().candles;
  const stale = (s: string) => (s === focus ? 5_000 : 90_000);
  const due = symbols
    .filter((s) => Date.now() - (fetchedAt[s] ?? 0) >= stale(s))
    .sort((a, b) => (a === focus ? -1 : b === focus ? 1 : (store[a]?.length ? 1 : 0) - (store[b]?.length ? 1 : 0) || (fetchedAt[a] ?? 0) - (fetchedAt[b] ?? 0)))
    // While the radar warms up it loads faster; the rate-limit backoff below still protects the connection.
    .slice(0, radarWarmDone ? 6 : 10);
  for (const symbol of due) {
    if (Date.now() < derivBackoffUntil) return;
    if (useBrain.getState().settings.interval !== interval) return;
    let candles: Candle[] = [];
    try {
      candles = await deriv.candles(symbol, g);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "no data";
      if (/rate limit|too many/i.test(msg)) {
        derivBackoffUntil = Date.now() + 60_000;
        useBrain.setState((st) => ({ feedNote: "Deriv rate limit on candle history: pausing candle loading for 60 s. Open trades are still watched.", feedAt: st.feedAt }));
        return;
      }
      // One market that Deriv will not serve must not stop the rest.
      fetchedAt[symbol] = Date.now();
      useBrain.setState((st) => ({ feedNote: `${symbol}: ${msg}`, feedAt: st.feedAt }));
      continue;
    }
    await new Promise((r) => setTimeout(r, 1_200));
    if (useBrain.getState().settings.interval !== interval) return;
    fetchedAt[symbol] = Date.now();
    if (!candles.length) continue;
    const last = candles[candles.length - 1]!.c;
    useBrain.setState((st) => ({
      candles: { ...st.candles, [symbol]: candles },
      quotes: { ...st.quotes, [symbol]: { bid: null, ask: null, last, chg: candles.length > 1 ? ((last - candles[0]!.o) / candles[0]!.o) * 100 : null } },
      feedAt: Date.now(),
    }));
  }
}

let brokerAt = 0;
const peakByVenue: Record<string, number> = {};
const ocoPolledAt: Record<string, number> = {};
let derivDay = { key: "", start: 0, first: 0 };

/** Real Binance balances. Sizing and goals on the Binance venue use these, never the paper book. */
async function refreshBroker() {
  const st = useBrain.getState();
  if (!st.secrets.binanceKey || !st.secrets.binanceSecret) return;
  if (Date.now() - brokerAt < 15_000) return;
  brokerAt = Date.now();
  const r = await binanceBalances({ data: { env: st.settings.binanceEnv, apiKey: st.secrets.binanceKey, secret: st.secrets.binanceSecret } });
  if (!r.ok) {
    st.log(`Binance balances: ${r.error}`, "warn");
    return;
  }
  const usdt = r.balances.find((b) => b.asset === "USDT");
  let equity = r.futures ? r.futures.margin : usdt ? usdt.free + usdt.locked : 0;
  let partial = false;
  for (const b of r.futures ? [] : r.balances) {
    if (b.asset === "USDT") continue;
    const q = useBrain.getState().quotes[`${b.asset}USDT`];
    if (q) equity += (b.free + b.locked) * q.last;
    else partial = true;
  }
  const today = dayKey();
  useBrain.setState((cur) => ({
    broker: {
      cash: r.futures ? r.futures.available : (usdt?.free ?? 0),
      equity,
      startEquity: cur.broker?.startEquity ?? equity,
      dayStartEquity: cur.broker && cur.broker.dayKey === today ? cur.broker.dayStartEquity : equity,
      dayKey: today,
      at: Date.now(),
      partial,
    },
  }));
}

/** AI scalp: when the AI last failed, and per-trade timestamps so one trade is not asked about every few seconds. */
const aiDown = { until: 0, warned: false };
const manageAt: Record<string, number> = {};

function aiPick(cfg: ScalpConfig) {
  const st = useBrain.getState();
  for (const slot of cfg.aiSlot === "auto" ? AI_SLOTS : [cfg.aiSlot]) {
    const a = st.ai[slot];
    const key = slot === "gemini" ? st.secrets.geminiKey : slot === "grok" ? st.secrets.grokKey : st.secrets.otherKey;
    if (a.status === "ready" && a.provider && key) return { slot, provider: a.provider, model: a.model, key };
  }
  return null;
}

function aiFail(why: string, cfg: ScalpConfig) {
  aiDown.until = Date.now() + 30_000;
  if (aiDown.warned) return;
  aiDown.warned = true;
  useBrain.getState().log(`AI scalp: ${why}. Open trades use the plain scalp rules. New entries: ${cfg.aiOnFail === "skip" ? "skipped" : "taken by the rules"} until the AI answers again.`, "warn");
}

function aiContext(symbol: string, now: number): BriefContext {
  const st = useBrain.getState();
  const daily = st.sizing?.gs.rows.find((r) => r.key === "daily");
  const today = startOfUtcDay(now);
  const mine = st.positions.filter((p) => p.status === "closed" && p.symbol === symbol && (p.closedAt ?? 0) >= today).slice(-4);
  return {
    symbol,
    interval: st.settings.interval,
    candles: (st.candles[symbol] ?? []).slice(-10),
    dayPnl: realizedSince(st.positions, today),
    dailyRemaining: daily ? daily.remaining : null,
    recent: mine.map((p) => `${p.side} ${(p.pnl ?? 0) >= 0 ? "win" : "loss"} ${Math.round((now - (p.closedAt ?? now)) / 60_000)}m ago`),
    consecLosses: consecOf(st.positions),
    openCount: st.positions.filter((p) => p.status === "open").length,
  };
}

/** The rules engine proposes; the AI approves or skips, picks where to bank, and may shrink (never grow) the size. */
async function aiGate(
  entries: EntryIntent[],
  scalp: ScalpConfig | null,
  now: number,
  decisions: { symbol: string; decision: { modules: { name: string; verdict: string; score: number }[] } }[],
  spreads: Record<string, number | null>,
): Promise<EntryIntent[]> {
  // Entries the radar already put in front of the AI (and the AI took) are not asked about a second time. Only the size cut is applied.
  const pre = entries.filter((e) => e.ai).map((e) => shrinkEntry(e, e.ai?.sizeMult ?? 1));
  entries = entries.filter((e) => !e.ai);
  if (!scalp || !scalp.aiEntry || !entries.length) return [...pre, ...entries];
  const pick = aiPick(scalp);
  if (!pick) return [...pre, ...entries];
  if (now < aiDown.until) return [...pre, ...(scalp.aiOnFail === "rules" ? entries : [])];
  type Verdict = { e: EntryIntent; reply: AiEntryReply } | { e: EntryIntent; fail: string };
  const results: Verdict[] = await Promise.all(
    entries.slice(0, 3).map(async (e): Promise<Verdict> => {
      const mods = decisions.find((d) => d.symbol === e.symbol)?.decision.modules ?? [];
      const derivNote = isDerivSymbol(e.symbol) ? "\nNote: this is a fixed 5-minute Deriv CALL/PUT contract. The stop and target above are not used and fees do not apply. The most that can be lost is the stake. The bot may sell early for a profit." : "";
      const brief = entryBrief(e, mods, spreads[e.symbol] ?? null, scalp, aiContext(e.symbol, now)) + derivNote;
      const res = await askAI({ brief, key: pick.key, provider: pick.provider, model: pick.model, system: entrySystemFor(scalp.aiStrict), json: true, ms: scalp.aiTimeoutSec * 1000 });
      if (!res.ok) return { e, fail: res.error };
      const reply = parseEntry(res.text, e, scalp);
      return reply ? { e, reply } : { e, fail: "the AI gave an answer the app could not use" };
    }),
  );
  const st = useBrain.getState();
  const out: EntryIntent[] = [];
  for (const r of results) {
    if ("fail" in r) {
      aiFail(r.fail, scalp);
      if (scalp.aiOnFail === "rules") out.push(r.e);
      continue;
    }
    aiDown.warned = false;
    const { e, reply } = r;
    if (reply.action === "SKIP") {
      useBrain.setState((cur) => ({ seen: [...cur.seen, e.key].slice(-400) }));
      st.log(`AI skipped ${e.symbol} ${e.side}: ${reply.reason || "no reason given"}`);
      continue;
    }
    const f = st.filters[e.symbol];
    let qty = e.qty;
    if (reply.sizeMult < 1) {
      const smaller = floorToStep(e.qty * reply.sizeMult, f?.step ?? 1e-6);
      if (smaller > 0 && (!f?.minNotional || smaller * e.entry >= f.minNotional)) qty = smaller;
    }
    const k = qty / e.qty;
    st.log(`AI took ${e.symbol} ${e.side}: ${reply.reason || "approved"} (bank at ${reply.quickR.toFixed(2)}R${k < 1 ? `, size x${k.toFixed(2)}` : ""})`);
    out.push({ ...e, qty, notional: e.notional * k, lossAtStop: e.lossAtStop * k, ai: { quickR: reply.quickR, note: reply.reason || "approved" } });
  }
  return [...pre, ...out];
}

/** The AI may shrink an entry, never grow it. Keeps the exchange's lot step and minimum order size. */
function shrinkEntry(e: EntryIntent, mult: number): EntryIntent {
  if (!(mult < 1)) return e;
  const f = useBrain.getState().filters[e.symbol];
  const smaller = floorToStep(e.qty * mult, f?.step ?? 1e-6);
  if (!(smaller > 0) || (f?.minNotional && smaller * e.entry < f.minNotional)) return e;
  const k = smaller / e.qty;
  return { ...e, qty: smaller, notional: e.notional * k, lossAtStop: e.lossAtStop * k };
}

/** Scalp radar: scan every market with every strategy, rank the setups, let the AI pick the best, and tell the planner what may be traded. */
const radarVerdicts = new Map<string, AiEntryReply>();
let radarAskedAt = 0;
let radarBusy = false;
let radarChosenKey = "";

function radarAsk(shortlist: Candidate[], pick: NonNullable<ReturnType<typeof aiPick>>, scalp: ScalpConfig, res: { total: number; withData: number; signals: number }, now: number) {
  radarBusy = true;
  radarAskedAt = now;
  const cfg = useBrain.getState().settings.radar;
  const ctx = aiContext("", now);
  const brief = radarBrief(shortlist, { interval: ctx.interval, dayPnl: ctx.dayPnl, dailyRemaining: ctx.dailyRemaining, openCount: ctx.openCount, consecLosses: ctx.consecLosses, scanned: res.total, withData: res.withData, signals: res.signals, top: cfg.top });
  void (async () => {
    try {
      const r = await askAI({ brief, key: pick.key, provider: pick.provider, model: pick.model, system: radarSystemFor(scalp.aiStrict), json: true, ms: Math.max(scalp.aiTimeoutSec, 15) * 1000 });
      const verdicts = r.ok ? parseRadar(r.text, shortlist, scalp, cfg.top) : null;
      if (!verdicts) {
        aiFail(r.ok ? "the AI gave a shortlist answer the app could not use" : r.error, scalp);
        return;
      }
      aiDown.warned = false;
      if (radarVerdicts.size > 400) radarVerdicts.clear();
      for (const [k, v] of verdicts) radarVerdicts.set(k, v);
      const took = shortlist.filter((c) => verdicts.get(c.key)?.action === "TAKE");
      useBrain.getState().log(`AI radar: picked ${took.length ? took.map((c) => `${c.label} ${c.side}`).join(", ") : "nothing"} out of ${shortlist.length} candidates.`);
      scan.soon = true;
    } catch (err) {
      aiFail(err instanceof Error ? err.message : "the AI shortlist call failed", scalp);
    } finally {
      radarBusy = false;
    }
  })();
}

/** Warm-up: the radar does not trade until almost every open market has loaded, so the first few to load cannot win by default. */
let radarWarmKey = "";
let radarWarmStart = 0;
let radarWarmDone = false;
const benchLogged = new Set<string>();

/** Learning from mistakes, the quick layer: a market that lost several times in a row sits out for a while, then gets another chance. */
function benchReason(symbol: string, now: number): string | null {
  const st = useBrain.getState();
  const cfg = st.settings.radar;
  if (!(cfg.benchLosses > 0)) return null;
  const closed = st.positions.filter((p) => p.symbol === symbol && p.status === "closed" && p.book !== "swing" && !p.hive && p.closedAt).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  let streak = 0;
  for (const p of closed) {
    if ((p.pnl ?? 0) < 0) streak++;
    else break;
  }
  if (streak < cfg.benchLosses) return null;
  const mins = cfg.benchMin * (streak >= cfg.benchLosses * 2 ? 2 : 1);
  const until = (closed[0]!.closedAt ?? 0) + mins * 60_000;
  if (now >= until) return null;
  const tag = `${symbol}|${closed[0]!.closedAt}`;
  if (!benchLogged.has(tag)) {
    benchLogged.add(tag);
    if (benchLogged.size > 200) benchLogged.clear();
    st.log(`Radar benched ${marketInfo(symbol)?.label ?? symbol} for ${mins} min after ${streak} losses in a row. It gets another look after that.`);
  }
  return `${streak} losses in a row`;
}

function radarStep(rows: RadarRow[], scalp: ScalpConfig, now: number): Record<string, RadarPick> {
  const st = useBrain.getState();
  const cfg = st.settings.radar;
  const interval = st.settings.interval;
  const res = runRadar({ rows, intervalMs: INTERVAL_MS[interval], now, cfg, scalp, gate: learnGate, benched: (sym) => benchReason(sym, now) });
  if (radarWarmKey !== interval) {
    radarWarmKey = interval;
    radarWarmStart = now;
    radarWarmDone = false;
  }
  const warmPct = res.expected > 0 ? Math.min(100, Math.round((res.withData / res.expected) * 100)) : 100;
  if (!radarWarmDone && (warmPct >= cfg.warmupPct || now - radarWarmStart >= cfg.warmupMaxSec * 1000)) {
    radarWarmDone = true;
    st.log(`Radar warm-up finished: ${res.withData} of ${res.expected} open markets loaded. Ranking all of them now.`);
  }
  const warm = { done: radarWarmDone, pct: warmPct, expected: res.expected };
  if (!radarWarmDone) {
    useBrain.setState({ radar: { at: now, interval, total: res.total, withData: res.withData, signals: res.signals, rejected: res.rejected, warm, shortlist: [], chosen: [], note: `Warming up: ${res.withData} of ${res.expected} open markets loaded (${warmPct}%). Trading starts at ${cfg.warmupPct}% so every market is ranked fairly, not just the first ones to load.` } });
    return {};
  }
  const shortlist = res.ranked.slice(0, cfg.aiList);
  // Persist qualifying candidates independently of the execution shortlist. WAIT is not a discarded opportunity.
  for (const candidate of shortlist) saveRadarOpportunity(candidate, interval, now);
  for (const c of shortlist) {
    const v = radarVerdicts.get(c.key);
    if (v) c.ai = v;
  }
  const pick = scalp.aiEntry ? aiPick(scalp) : null;
  const down = now < aiDown.until;
  if (pick && !down && !radarBusy && shortlist.some((c) => !c.ai) && now - radarAskedAt >= 15_000) radarAsk(shortlist, pick, scalp, res, now);
  let chosen: Candidate[];
  let note: string;
  if (!shortlist.length) {
    chosen = [];
    note = res.withData < res.total * 0.5 ? `Loading markets: ${res.withData} of ${res.total} have enough candles. The radar ranks what it has so far.` : `No market has a qualifying scalp setup right now (${res.signals} raw signals checked against fees and each market's recent record).`;
  } else if (!pick) {
    chosen = shortlist.slice(0, cfg.top);
    note = `${scalp.aiEntry ? "No AI connected, so" : "AI approval is off, so"} the radar's own ranking decides. Best ${chosen.length} of ${res.ranked.length} candidates.`;
  } else {
    const taken = shortlist.filter((c) => c.ai?.action === "TAKE");
    const waiting = shortlist.filter((c) => !c.ai);
    if (down && waiting.length) {
      chosen = scalp.aiOnFail === "rules" ? [...taken, ...waiting].slice(0, cfg.top) : taken.slice(0, cfg.top);
      note = `AI is not answering. ${scalp.aiOnFail === "rules" ? "Candidates it has not judged follow the radar's ranking." : "Candidates it has not judged are skipped."}`;
    } else {
      chosen = taken.slice(0, cfg.top);
      note = waiting.length && !taken.length ? "Asking the AI to pick the best candidates…" : `AI picked ${taken.length} of ${shortlist.length} candidates${waiting.length ? `, ${waiting.length} still waiting for its verdict` : ""}.`;
    }
  }
  const picks: Record<string, RadarPick> = {};
  for (const c of chosen) {
    const a = c.ai?.action === "TAKE" ? c.ai : null;
    picks[c.symbol] = { decision: candidateDecision(c), quickR: c.quickR, ...(a ? { ai: { quickR: a.quickR, note: `AI radar: ${a.reason || "approved"}`, sizeMult: a.sizeMult } } : {}) };
  }
  const key = chosen.map((c) => `${c.symbol}${c.side}`).join(",");
  if (key !== radarChosenKey) {
    radarChosenKey = key;
    if (chosen.length) st.log(`Radar is scalping: ${chosen.map((c) => `${c.label} ${c.side} (${c.strategyName}, score ${c.score})`).join("; ")}.`);
  }
  useBrain.setState({ radar: { at: now, interval, total: res.total, withData: res.withData, signals: res.signals, rejected: res.rejected, warm, shortlist, chosen: chosen.map((c) => c.symbol), note } });
  return picks;
}

/** The AI watches open scalps. It can hold, bank now, or tighten the stop. If it goes quiet, the plain rules take over again. */
async function aiManage(scalp: ScalpConfig | null, marks: Record<string, number>, now: number) {
  if (!scalp || !scalp.aiManage || now < aiDown.until) return;
  const st0 = useBrain.getState();
  if (st0.uncertain) return;
  const pick = aiPick(scalp);
  if (!pick) return;
  const due = st0.positions
    .filter((p) => p.status === "open" && p.venue !== "deriv" && p.protection !== "contract-stake" && marks[p.symbol] != null)
    .map((p) => ({ p, mark: marks[p.symbol]!, r: favorableR(p, marks[p.symbol]!) }))
    .filter((x) => (x.r >= 0.25 || x.r <= -0.5) && now - (manageAt[x.p.id] ?? 0) >= 20_000)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, 3);
  await Promise.all(
    due.map(async ({ p, mark }) => {
      manageAt[p.id] = now;
      const res = await askAI({ brief: manageBrief(p, mark, now, aiContext(p.symbol, now)), key: pick.key, provider: pick.provider, model: pick.model, system: MANAGE_SYSTEM, json: true, ms: scalp.aiTimeoutSec * 1000 });
      const reply = res.ok ? parseManage(res.text, p, mark) : null;
      if (!reply) {
        aiFail(res.ok ? "the AI gave an answer the app could not use" : res.error, scalp);
        return;
      }
      aiDown.warned = false;
      const lease = now + 45_000;
      const fresh = useBrain.getState().positions.find((x) => x.id === p.id && x.status === "open");
      if (!fresh) return;
      if (reply.action === "EXIT") {
        const why = `AI exit: ${reply.reason || "no reason given"}`;
        if (fresh.venue === "paper") settle(fresh.id, mark, why);
        else if (fresh.venue === "binance") await brokerClose(fresh, mark, why);
        return;
      }
      if (reply.action === "TIGHTEN" && reply.stop != null && fresh.protection !== "broker-confirmed") {
        useBrain.setState((cur) => ({ positions: cur.positions.map((x) => (x.id === p.id ? { ...x, stop: reply.stop!, aiUntil: lease } : x)) }));
        useBrain.getState().log(`AI tightened the ${p.symbol} stop to ${reply.stop.toPrecision(6)}: ${reply.reason}`);
        return;
      }
      useBrain.setState((cur) => ({ positions: cur.positions.map((x) => (x.id === p.id ? { ...x, aiUntil: lease } : x)) }));
    }),
  );
}

const sellFailAt: Record<string, number> = {};

/** Sells an open Deriv contract at the current price and records the real result. */
async function derivSellNow(id: string, reason: string): Promise<boolean> {
  const st = useBrain.getState();
  const pos = st.positions.find((p) => p.id === id && p.status === "open" && p.venue === "deriv");
  if (!pos?.brokerOrderId) return false;
  if (!(await deriv.ensure())) {
    st.log("Deriv is not authorized, so the contract could not be sold.", "warn");
    return false;
  }
  try {
    const res = await deriv.sell(pos.brokerOrderId);
    const pnl = res.soldFor - pos.plannedRisk;
    useBrain.setState((cur) => ({
      positions: cur.positions.map((p) => (p.id === id ? { ...p, status: "closed" as const, pnl, exitReason: reason, closedAt: Date.now(), exit: pos.entry, livePnl: pnl, liveValue: res.soldFor } : p)),
    }));
    st.log(`${reason}: sold Deriv contract ${pos.brokerOrderId} for ${res.soldFor.toFixed(2)} (stake ${pos.plannedRisk.toFixed(2)}), ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}.`);
    refreshLossPause();
    return true;
  } catch (err) {
    sellFailAt[id] = Date.now();
    st.log(`Could not sell Deriv contract ${pos.brokerOrderId}: ${err instanceof Error ? err.message : "unknown error"}. It stays open and will settle at expiry.`, "warn");
    return false;
  }
}

/** True while Close ALL is running, so a scan that started earlier cannot open a new trade behind its back. */
let forceClosing = false;

export const isForceClosing = () => forceClosing;

/**
 * Sends one Trades-tab entry through the same order path as the scalper: same live-money lock, same sizing checks already done,
 * same exchange-side stop and target after the fill. Only the position's tag differs.
 */
export async function openSwingEntry(e: SwingEntry): Promise<void> {
  const st = useBrain.getState();
  const intent: EntryIntent = {
    symbol: e.symbol,
    side: e.side,
    qty: e.qty,
    notional: e.notional,
    lossAtStop: e.lossAtStop,
    entry: e.entry,
    stop: e.stop,
    target: e.target,
    reason: e.reason,
    quality: e.quality,
    strategy: e.strategy,
    key: e.key,
    candleTime: e.candleTime,
    regime: e.regime,
  };
  const tag: Partial<BookPosition> = { book: "swing", holdUntil: e.holdUntil, riskAtStop: e.lossAtStop };
  // The plan was made for one venue. If the Order execution choice changed since, nothing is sent.
  if (st.settings.venue !== e.venue) {
    st.log(`Trades: ${e.symbol} was planned for ${e.venue} but orders are now set to ${st.settings.venue}. Nothing was sent.`, "warn");
    return;
  }
  if (e.venue === "paper") bookPaperEntry(intent, tag);
  else if (e.venue === "binance") await brokerOpen(intent, tag);
  else if (e.venue === "deriv") await derivSwingOpen(e, tag);
}

/** Opens a Deriv multiplier contract: stop loss and take profit are part of the contract and held by Deriv. */
async function derivSwingOpen(e: SwingEntry, tag: Partial<BookPosition>): Promise<void> {
  const st = useBrain.getState();
  if (!e.deriv) {
    st.log(`Trades: ${e.symbol} has no multiplier sizing, so no Deriv order was sent.`, "warn");
    return;
  }
  if (!(await deriv.ensure())) {
    st.log("Deriv is not authorized.", "warn");
    return;
  }
  if (!deriv.virtual && !st.settings.liveUnlock) {
    st.log("This Deriv account is REAL. Type LIVE on the Connect tab to unlock real-money contracts.", "warn");
    return;
  }
  try {
    const bought = await deriv.multiplier(e.symbol, e.side, e.deriv.stake, deriv.currency || "USD", e.deriv.multiplier, e.deriv.stopLoss, e.deriv.takeProfit);
    const pos: BookPosition = {
      id: crypto.randomUUID(),
      symbol: e.symbol,
      side: e.side,
      qty: 1,
      entry: e.entry,
      stop: e.stop,
      target: e.target,
      openedAt: Date.now(),
      fees: 0,
      plannedRisk: bought.buyPrice,
      reason: e.reason,
      quality: e.quality,
      strategy: e.strategy,
      mode: st.settings.mode,
      venue: "deriv",
      protection: "contract-stake",
      brokerOrderId: bought.contractId,
      durLabel: bought.label,
      status: "open",
      ...tag,
    };
    useBrain.setState((cur) => ({
      positions: [...cur.positions, pos],
      seen: [...cur.seen, e.key].slice(-400),
      recent: [...cur.recent, { t: Date.now(), symbol: e.symbol, price: e.entry, strategy: e.strategy }].slice(-200),
    }));
    st.log(`Deriv ${e.side === "BUY" ? "MULTUP" : "MULTDOWN"} ${e.symbol} x${e.deriv.multiplier}, stake ${bought.buyPrice} ${deriv.currency}, stop loss ${e.deriv.stopLoss}, take profit ${e.deriv.takeProfit}. Contract ${bought.contractId}. Deriv holds the stop loss and take profit.`);
  } catch (err) {
    st.log(`Deriv swing order failed: ${err instanceof Error ? err.message : "unknown error"}`, "bad");
  }
}

/** Closes a swing position at market (paper or Binance). */
export async function closeSwingPosition(pos: BookPosition, price: number, reason: string): Promise<void> {
  if (pos.venue === "paper") settle(pos.id, price, reason);
  else if (pos.venue === "binance") await brokerClose(pos, price, reason);
  else if (pos.venue === "deriv") await derivSellNow(pos.id, reason);
}

/**
 * Sends one HIVE entry through the same order paths as the scalper (same live-money lock, same exchange-side stop and target on Binance).
 * The colony passes its own position id and hive flag in `tag`, so the receipt can find the trade afterwards.
 */
export async function openHiveEntry(e: EntryIntent, tag: Partial<BookPosition>, venue: "paper" | "binance" | "deriv"): Promise<void> {
  if (venue === "paper") bookPaperEntry(e, tag);
  else if (venue === "binance") await brokerOpen(e, tag);
  else if (venue === "deriv") await derivOpen(e, tag);
}

/** Closes one open position by hand, whatever the venue. */
export async function closePositionNow(id: string) {
  const st = useBrain.getState();
  const pos = st.positions.find((p) => p.id === id && p.status === "open");
  if (!pos) return;
  const mark = st.quotes[pos.symbol]?.last ?? pos.entry;
  if (pos.venue === "deriv") await derivSellNow(id, "Closed by you");
  else if (pos.venue === "paper") settle(id, mark, "Closed by you");
  else await brokerClose(pos, mark, "Closed by you");
}

export async function closeAllNow() {
  const ids = useBrain.getState().positions.filter((p) => p.status === "open").map((p) => p.id);
  // Every position is tried on its own. One failure must never stop the rest.
  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        await closePositionNow(id);
      } catch (err) {
        useBrain.getState().log(`Close ALL: could not close one position (${err instanceof Error ? err.message : "unknown error"}). The others were still closed.`, "warn");
      }
    }),
  );
  const left = useBrain.getState().positions.filter((p) => p.status === "open").length;
  if (left > 0) useBrain.getState().log(`Close ALL: ${left} position(s) are still open. Look at the Book tab and the log above for the reason.`, "warn");
  return left;
}

/** Panic button: turns auto-trading off, closes everything the app knows about, then sells any other open Deriv contract on the account. */
export async function forceCloseEverything(): Promise<number> {
  const st0 = useBrain.getState();
  useBrain.setState({ armed: false, swingArmed: false });
  useHive.getState().setArmed(false);
  forceClosing = true;
  st0.log("FORCE CLOSE: auto-trading is off. Closing everything.", "warn");
  try {
    await closeAllNow();
  } catch (err) {
    st0.log(`FORCE CLOSE: ${err instanceof Error ? err.message : "unknown error"}`, "warn");
  }
  if (useBrain.getState().conn.deriv.status === "connected" && (await deriv.ensure())) {
    for (let round = 0; round < 2; round++) {
      let list: { id: string; buyPrice: number }[] = [];
      try {
        list = await deriv.openContracts();
      } catch (err) {
        useBrain.getState().log(`FORCE CLOSE: could not read the Deriv account's open contracts: ${err instanceof Error ? err.message : "unknown error"}.`, "warn");
        break;
      }
      if (list.length === 0) break;
      for (const c of list) {
        try {
          const res = await deriv.sell(c.id);
          const known = useBrain.getState().positions.some((p) => p.brokerOrderId === c.id);
          const pnl = res.soldFor - c.buyPrice;
          useBrain.getState().log(`FORCE CLOSE: sold Deriv contract ${c.id}${known ? "" : " (was not in the app's records)"} for ${res.soldFor.toFixed(2)}, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}.`);
        } catch (err) {
          useBrain.getState().log(`FORCE CLOSE: could not sell Deriv contract ${c.id}: ${err instanceof Error ? err.message : "unknown error"}.`, "warn");
        }
      }
    }
  }
  forceClosing = false;
  const left = useBrain.getState().positions.filter((p) => p.status === "open").length;
  useBrain.getState().log(`FORCE CLOSE: finished${left ? `, ${left} still open` : ", nothing left open"}. Auto-trading stays off until you arm it again.`, left ? "warn" : "info");
  return left;
}

function refreshLossPause() {
  const st = useBrain.getState();
  const n = consecOf(st.positions);
  if (n >= st.settings.consecLimit) useBrain.setState({ lossPause: true });
  const lastClosed = [...st.positions].filter((p) => p.status === "closed" && p.book !== "swing").pop();
  if (lastClosed && (lastClosed.pnl ?? 0) > 0) {
    useBrain.setState({ lossPause: false });
    if (scalpFor(st.settings.mode, st.settings.scalp)) scan.soon = true;
  }
}

function bookPaperEntry(e: EntryIntent, tag: Partial<BookPosition> = {}) {
  const st = useBrain.getState();
  const fill = fillPrice(e.side, e.entry, "entry");
  const shift = fill - e.entry;
  const pos: BookPosition = {
    id: crypto.randomUUID(),
    symbol: e.symbol,
    side: e.side,
    qty: e.qty,
    entry: fill,
    stop: e.stop + shift,
    target: e.target + shift,
    openedAt: Date.now(),
    fees: 0,
    plannedRisk: e.lossAtStop,
    reason: e.reason,
    quality: e.quality,
    strategy: e.strategy,
    mode: st.settings.mode,
    aiQuickR: e.ai?.quickR ?? e.quickR,
    aiNote: e.ai?.note,
    venue: "paper",
    protection: "local-monitor",
    brokerOrderId: null,
    status: "open",
    ...tag,
  };
  const opened = openPosition(st.account, pos);
  if ("error" in opened) {
    st.log(opened.error, "warn");
    return;
  }
  useBrain.setState({
    account: opened.account,
    positions: [...st.positions, opened.position],
    seen: [...st.seen, e.key].slice(-400),
    recent: [...st.recent, { t: Date.now(), symbol: e.symbol, price: fill, strategy: e.strategy }].slice(-200),
  });
  st.log(`Paper ${e.side} ${e.symbol} ${e.qty} @ ${fill.toPrecision(6)}. Stop is watched here, not at a broker.`);
}

function settle(id: string, price: number, reason: string, qty?: number) {
  const st = useBrain.getState();
  const pos = st.positions.find((p) => p.id === id && p.status === "open");
  if (!pos) return;
  const result = closePosition(st.account, pos, price, reason, Date.now(), qty);
  const rest = st.positions.filter((p) => p.id !== id);
  const positions = result.remainder ? [...rest, result.remainder, result.closed] : [...rest, result.closed];
  let lossPause = st.lossPause;
  let consec = 0;
  const closed = positions.filter((p) => p.status === "closed" && p.book !== "swing");
  for (let i = closed.length - 1; i >= 0; i--) {
    if ((closed[i]!.pnl ?? 0) < 0) consec++;
    else break;
  }
  if (consec >= st.settings.consecLimit) lossPause = true;
  if ((result.closed.pnl ?? 0) > 0) lossPause = false;
  useBrain.setState({ account: result.account, positions, lossPause });
  if ((result.closed.pnl ?? 0) > 0 && scalpFor(st.settings.mode, st.settings.scalp)) scan.soon = true;
  st.log(`${reason}: ${pos.symbol} ${(result.closed.pnl ?? 0) >= 0 ? "+" : ""}${(result.closed.pnl ?? 0).toFixed(2)}`);
}

async function cycle() {
        const st = useBrain.getState();
        if (st.settings.interval !== lastInterval) {
          // A new timeframe must never be analysed with candles from the old one.
          lastInterval = st.settings.interval;
          for (const k of Object.keys(fetchedAt)) delete fetchedAt[k];
          useBrain.setState({ candles: {}, decisions: {} });
        }
        const env = dataEnv();
        const binOn = st.conn.binance.status === "connected";
        const derOn = st.conn.deriv.status === "connected";
        if (!binOn && !derOn) {
          // No broker, no markets, no charts. Nothing is fetched and nothing is analysed.
          const wait = st.conn.binance.status === "connecting" || st.conn.deriv.status === "connecting";
          useBrain.setState({ decisions: {}, feedNote: wait ? "Connecting to your broker…" : "No broker connected. Open the Connect tab to load markets." });
          return;
        }
        // Scan list = the markets switched on for the bot. The focused chart is always loaded as well, switched on or not.
        const enabled = st.settings.enabled.filter((x) => st.markets.some((m) => m.symbol === x));
        const binanceSyms = binOn ? enabled.filter((s) => !isDerivSymbol(s)) : [];
        if (derOn && Date.now() - marketsRefreshedAt > 10 * 60_000) {
          marketsRefreshedAt = Date.now();
          void refreshDerivMarkets();
        }
        // Closed markets are not fetched or scanned (the open flag is refreshed every 10 minutes).
        const derivSyms = derOn ? enabled.filter((s) => isDerivSymbol(s) && marketInfo(s)?.open !== false) : [];
        const focus = st.symbol;
        const rot = (list: string[], n: number) => (list.length ? Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(cursor + i) % list.length]!) : []);
        const focusBin = binOn && !isDerivSymbol(focus) && st.markets.some((m) => m.symbol === focus) ? [focus] : [];
        // Radar mode loads every market quickly (24 Binance markets per sweep) so the scan covers all of them within about a minute.
        const radarWanted = !!scalpFor(st.settings.mode, st.settings.scalp) && st.settings.radar.enabled;
        const perCycle = radarWanted ? 24 : 5;
        const unique = [...new Set([...focusBin, ...rot(binanceSyms, perCycle)])];
        cursor += perCycle;
        if (binOn) {
          await refreshBinance(unique, st.settings.interval, env);
          await refreshTickers(env, st.markets.filter((m) => m.broker === "binance").map((m) => m.symbol));
        }
        if (derOn) {
          const focusDer = isDerivSymbol(focus) && st.markets.some((m) => m.symbol === focus) ? [focus] : [];
          await refreshDeriv([...new Set([...focusDer, ...derivSyms])], st.settings.interval);
          if (deriv.hasAuth) void deriv.ensure();
        }
        const live = useBrain.getState();
        const open = live.positions.filter((p) => p.status === "open");
        for (const pos of open) {
          if (pos.venue === "deriv" && pos.brokerOrderId) {
            try {
              const status = await deriv.contractStatus(pos.brokerOrderId);
              if (status && (status.is_sold || status.is_expired)) {
                const profit = Number(status.profit ?? 0);
                useBrain.setState((cur) => ({
                  positions: cur.positions.map((p) =>
                    p.id === pos.id
                      ? { ...p, status: "closed" as const, pnl: profit, exitReason: status.is_sold && !status.is_expired ? "Deriv contract sold" : "Deriv contract settled", closedAt: Date.now(), exit: pos.entry }
                      : p,
                  ),
                }));
                live.log(`Deriv contract ${pos.brokerOrderId} settled ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} ${deriv.currency}.`);
                refreshLossPause();
              } else if (status) {
                // Live value of the contract, so open profit, equity and the Book show real money and not index points.
                const stake = Number(status.buy_price ?? pos.plannedRisk);
                const profit = Number(status.profit ?? 0);
                const value = status.bid_price != null ? Number(status.bid_price) : stake + profit;
                useBrain.setState((cur) => ({ positions: cur.positions.map((p) => (p.id === pos.id ? { ...p, livePnl: profit, liveValue: value } : p)) }));
                // Swing contracts keep their Deriv-held stop loss and take profit; the scalp's early-sell rules do not apply.
                if (pos.book === "swing" || pos.hive) continue;
                const rule = scalpFor(live.settings.mode, live.settings.scalp);
                const canTry = !!rule && Date.now() - pos.openedAt >= rule.normalMinHoldSec * 1000 && Date.now() - (sellFailAt[pos.id] ?? 0) > 30_000;
                if (live.settings.mode === "normal" && rule) {
                  const pct = stake > 0 ? (profit / stake) * 100 : 0;
                  worstPct[pos.id] = Math.min(worstPct[pos.id] ?? 0, pct);
                  const t0 = Number(status.date_start ?? 0);
                  const t1 = Number(status.date_expiry ?? 0);
                  const nowSec = Number(status.current_spot_time ?? Math.floor(Date.now() / 1000));
                  const elapsedFrac = t1 > t0 && t0 > 0 ? Math.min(1, Math.max(0, (nowSec - t0) / (t1 - t0))) : null;
                  const hit = canTry ? derivNormalExit({ profit, stake, canSell: status.is_valid_to_sell !== 0, worstPct: worstPct[pos.id]!, elapsedFrac }, rule) : null;
                  if (hit) {
                    const why = hit.kind === "take" ? `Quick profit (${hit.pct.toFixed(0)}% of stake)` : hit.kind === "bounce" ? `Bounced back into profit after a dip (${hit.pct.toFixed(0)}% of stake)` : hit.kind === "cut" ? `Loss cap hit (${Math.abs(hit.pct).toFixed(0)}% of stake)` : `Time stop (${hit.pct >= 0 ? "+" : ""}${hit.pct.toFixed(0)}% of stake), sold before expiry`;
                    await derivSellNow(pos.id, why);
                  }
                } else {
                  const hit = canTry ? derivExit({ profit, stake, canSell: status.is_valid_to_sell !== 0 }, rule!) : null;
                  if (hit) await derivSellNow(pos.id, hit.kind === "take" ? `Quick profit (scalp, ${hit.pct.toFixed(0)}% of stake)` : `Cut loss (${Math.abs(hit.pct).toFixed(0)}% of stake)`);
                }
              }
            } catch {
              /* status can lag; try next pass */
            }
          }
        }
        for (const pos of open) {
          if (pos.venue !== "binance" || !pos.ocoListId) continue;
          if (Date.now() - (ocoPolledAt[pos.id] ?? 0) < 8_000) continue;
          ocoPolledAt[pos.id] = Date.now();
          const keys = useBrain.getState().secrets;
          if (pos.ocoListId.startsWith("fut:")) {
            const fr = await futuresStatus({ data: { env: useBrain.getState().settings.binanceEnv, apiKey: keys.binanceKey, secret: keys.binanceSecret, symbol: pos.symbol, side: pos.side, openedAt: pos.openedAt, algoIds: pos.ocoListId.slice(4).split(",") } });
            if (!fr.ok || fr.state === "resting") continue;
            if (fr.state === "filled") {
              useBrain.setState((cur) => ({
                positions: cur.positions.map((p) => (p.id === pos.id ? { ...p, status: "closed" as const, exit: fr.avgPrice, pnl: fr.pnl, exitReason: `Binance futures ${fr.leg === "stop" ? "stop" : "target"} filled at the exchange (order ${fr.orderId})`, closedAt: Date.now(), ocoListId: null } : p)),
              }));
              live.log(`${pos.symbol} ${fr.leg === "stop" ? "stop" : "target"} filled at Binance @ ${fr.avgPrice.toPrecision(6)}. ${fr.pnl >= 0 ? "+" : ""}${fr.pnl.toFixed(2)}`);
              refreshLossPause();
            } else {
              useBrain.setState((cur) => ({ positions: cur.positions.map((p) => (p.id === pos.id ? { ...p, status: "closed" as const, pnl: 0, exit: pos.entry, exitReason: "Position is flat at Binance (closed outside this app)", closedAt: Date.now(), ocoListId: null } : p)) }));
              live.log(`${pos.symbol}: the futures position is flat at Binance but no closing fill was found. Marked closed at zero; check Binance.`, "warn");
            }
            continue;
          }
          const r = await binanceProtectionStatus({ data: { env: useBrain.getState().settings.binanceEnv, apiKey: keys.binanceKey, secret: keys.binanceSecret, symbol: pos.symbol, orderListId: pos.ocoListId } });
          if (!r.ok) continue;
          if (r.state === "filled") {
            const pnl = (r.avgPrice - pos.entry) * r.qty;
            useBrain.setState((cur) => ({
              positions: cur.positions.map((p) =>
                p.id === pos.id ? { ...p, status: "closed" as const, exit: r.avgPrice, pnl, exitReason: `Binance ${r.leg === "stop" ? "stop" : "target"} filled at the exchange (order ${r.orderId})`, closedAt: Date.now(), ocoListId: null } : p,
              ),
            }));
            live.log(`${pos.symbol} ${r.leg === "stop" ? "stop" : "target"} filled at Binance @ ${r.avgPrice.toPrecision(6)}. ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`);
            refreshLossPause();
          } else if (r.state === "closed-unfilled") {
            useBrain.setState((cur) => ({ positions: cur.positions.map((p) => (p.id === pos.id ? { ...p, protection: "local-monitor" as const, ocoListId: null } : p)) }));
            live.log(`${pos.symbol}: the Binance stop/target order is gone (${r.status}). The position is no longer protected at the exchange; it is watched locally.`, "bad");
          }
        }
        const now = Date.now();
        const venueNow = useBrain.getState().settings.venue;
        if ((venueNow === "binance" || useHive.getState().armed) && binOn) await refreshBroker();
        let account = useBrain.getState().account;
        const marks: Record<string, number> = {};
        for (const [sym, q] of Object.entries(useBrain.getState().quotes)) marks[sym] = q.last;
        if (account.dayKey !== dayKey(now)) {
          account = { ...account, dayKey: dayKey(now), dayStartEquity: equityOf(account, useBrain.getState().positions, marks) };
          useBrain.setState({ account });
        }
        const positions = useBrain.getState().positions;
        const broker = venueNow === "binance" ? useBrain.getState().broker : null;
        const brokerFresh = !!broker && Date.now() - broker.at < 90_000;
        const dBal = venueNow === "deriv" && derOn && deriv.authorized && deriv.balance != null ? deriv.balance : null;
        // On Deriv the stake leaves the balance when a contract opens, so open contracts are added back at their current value.
        const dOpen = positions.filter((p) => p.status === "open" && p.venue === "deriv").reduce((sum, p) => sum + (p.liveValue ?? p.plannedRisk), 0);
        if (dBal != null && derivDay.key !== dayKey(now)) derivDay = { key: dayKey(now), start: dBal + dOpen, first: derivDay.first || dBal + dOpen };
        const equity = brokerFresh ? broker!.equity : dBal != null ? dBal + dOpen : equityOf(account, positions, marks);
        const cashNow = brokerFresh ? broker!.cash : dBal != null ? dBal : account.cash;
        const dayStart = brokerFresh ? broker!.dayStartEquity : dBal != null ? derivDay.start : account.dayStartEquity;
        const dayPnl = equity - dayStart;
        const venueKey: "paper" | "binance" | "deriv" = brokerFresh ? "binance" : dBal != null ? "deriv" : "paper";
        const peak = Math.max(venueKey === "paper" ? useBrain.getState().peakEquity : (peakByVenue[venueKey] ?? equity), equity);
        if (venueKey === "paper") {
          if (peak !== useBrain.getState().peakEquity) useBrain.setState({ peakEquity: peak });
        } else peakByVenue[venueKey] = peak;
        const unreal = positions.filter((p) => p.status === "open").reduce((sum, p) => sum + (p.venue === "deriv" ? (p.livePnl ?? 0) : marks[p.symbol] != null ? (p.side === "BUY" ? marks[p.symbol]! - p.entry : p.entry - marks[p.symbol]!) * p.qty : 0), 0);
        const stSettings = useBrain.getState().settings;
        const goalAccount = brokerFresh ? { ...account, startEquity: broker!.startEquity } : dBal != null ? { ...account, startEquity: derivDay.first } : account;
        const gs = evalGoal({ goal: stSettings.goal, positions, account: goalAccount, equity, peakEquity: peak, unrealized: unreal, now });
        useBrain.setState({ sizing: { source: venueKey, equity, cash: cashNow, startEquity: goalAccount.startEquity, dayStartEquity: dayStart, unrealized: unreal, gs } });
        const goalReached = !useBrain.getState().goalBypass && gs.anyReached && stSettings.goal.onReach === "stop-entries";
        const scalp = scalpFor(stSettings.mode, stSettings.scalp);
        const dailyRow = gs.rows.find((r) => r.key === "daily");
        const scalpHalt = scalp ? givebackHalt(positions, now, scalp, dailyRow ? dailyRow.target * 0.25 : goalAccount.startEquity * 0.001) : null;
        const haltReason = (gs.drawdownBreached || gs.sessionExpired ? gs.reason : venueNow === "binance" && !brokerFresh ? "Real Binance balance is unknown or stale, so entries are blocked rather than sized from the paper book." : venueNow === "deriv" && dBal == null ? "Deriv is not authorized, so entries are blocked." : null) ?? scalpHalt;
        const rows = enabled.map((symbol) => {
          const candles = useBrain.getState().candles[symbol] ?? [];
          const q = useBrain.getState().quotes[symbol];
          const derivSym = isDerivSymbol(symbol);
          const filter = useBrain.getState().filters[symbol];
          const spread = q?.bid && q.ask ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : null;
          const tradable = candles.length >= 80 && (derivSym ? marketInfo(symbol)?.open !== false && !deriv.isBlocked(symbol) : filter ? filter.status === "TRADING" : true);
          return {
            symbol,
            candles,
            spreadPct: spread,
            tradable,
            closed: derivSym && marketInfo(symbol)?.open === false,
            longOnly: useBrain.getState().settings.venue === "binance" && !derivSym && !isFuturesEnv(env),
            step: filter?.step,
            minNotional: filter?.minNotional,
          };
        });
        const names = [binOn ? BINANCE_HOSTS[env].label : "", derOn ? useBrain.getState().conn.deriv.label : ""].filter(Boolean).join(" + ");
        const venueLabel = venueNow === "paper" ? "Simulated orders on real broker prices." : venueNow === "binance" ? `Orders go to ${BINANCE_HOSTS[env].label}.` : `Orders go to ${useBrain.getState().conn.deriv.label}.`;
        useBrain.setState({ feedNote: `${names} · ${useBrain.getState().markets.length} markets · scanning ${enabled.length} (${rows.filter((r) => r.tradable).length} ready). ${venueLabel}` });
        await aiManage(scalp, marks, now);
        const radarPicks = scalp && useBrain.getState().settings.radar.enabled ? radarStep(rows, scalp, now) : null;
        if (!radarPicks && useBrain.getState().radar) useBrain.setState({ radar: null });
        const cycle = planCycle({
          now,
          mode: useBrain.getState().settings.mode,
          interval: useBrain.getState().settings.interval,
          armed: useBrain.getState().armed && !useBrain.getState().uncertain,
          rows,
          positions: useBrain.getState().positions.filter((p) => p.book !== "swing" && !p.hive),
          marks,
          equity,
          cash: cashNow,
          dayPnl,
          startEquity: dayStart,
          halted: haltReason,
          riskPct: useBrain.getState().settings.riskPct * (useBrain.getState().settings.venue === "binance" ? (useBrain.getState().settings.lotSize ?? 1) : 1) * (scalp ? riskScale(consecOf(useBrain.getState().positions), scalp) : 1),
          maxOpenRiskPct: useBrain.getState().settings.maxOpenRiskPct,
          dailyLossPct: useBrain.getState().settings.dailyLossPct,
          maxPositions: useBrain.getState().settings.maxPositions,
          maxPerSymbol: useBrain.getState().settings.maxPerSymbol,
          consecLosses: consecOf(useBrain.getState().positions),
          consecLimit: useBrain.getState().settings.consecLimit,
          lossPause: useBrain.getState().lossPause,
          goalReached,
          seen: useBrain.getState().seen,
          recent: useBrain.getState().recent,
          trail: useBrain.getState().settings.mode !== "normal",
          scalp,
          radar: radarPicks,
        });
        const decisions: typeof live.decisions = {};
        for (const row of cycle.decisions) {
          decisions[row.symbol] = {
            action: row.decision.action,
            reason: row.blocked ? `${row.decision.reason} Blocked: ${row.blocked}` : row.decision.reason,
            quality: row.decision.quality,
            regime: row.decision.regime,
            plan: row.decision.plan,
            modules: row.decision.modules.map((m) => ({ name: m.name, verdict: m.verdict, score: m.score, why: m.why })),
          };
        }
        const fSym = useBrain.getState().symbol;
        const fCandles = useBrain.getState().candles[fSym] ?? [];
        if (!decisions[fSym] && fCandles.length >= 80) {
          const d = decide(fCandles, useBrain.getState().settings.mode);
          if (d) decisions[fSym] = { action: d.action, reason: d.reason, quality: d.quality, regime: d.regime, plan: d.plan, modules: d.modules.map((m) => ({ name: m.name, verdict: m.verdict, score: m.score, why: m.why })) };
        }
        useBrain.setState({ decisions });
        for (const ex of cycle.exits) {
          const pos = useBrain.getState().positions.find((p) => p.id === ex.id);
          if (!pos || pos.status !== "open" || pos.book === "swing" || pos.hive) continue;
          if (pos.venue === "binance" && pos.protection === "broker-confirmed") {
            // The exchange owns the stop and target. Only a time stop may act, and it cancels the OCO first.
            const exchangeLeg = ex.type !== "close" || /^(Stop|Target)/.test(ex.reason);
            if (exchangeLeg) continue;
          }
          if (ex.type === "tighten") {
            useBrain.setState((cur) => ({
              positions: cur.positions.map((p) => (p.id === ex.id ? { ...p, stop: ex.stop } : p)),
            }));
            continue;
          }
          if (pos.venue === "paper") {
            if (ex.type === "close") settle(ex.id, ex.price, ex.reason);
            if (ex.type === "reduce") settle(ex.id, ex.price, ex.reason, ex.qty);
          } else if (pos.venue === "binance" && ex.type === "close") {
            await brokerClose(pos, ex.price, ex.reason);
          }
        }
        const spreads: Record<string, number | null> = {};
        for (const r of rows) spreads[r.symbol] = r.spreadPct;
        const entries = await aiGate(cycle.entries, scalp, Date.now(), cycle.decisions, spreads);
        // The AI call takes seconds. If you pressed Stop or Close ALL meanwhile, nothing new may open.
        if (forceClosing || !useBrain.getState().armed) return;
        const venue = useBrain.getState().settings.venue;
        if (venue === "paper") {
          for (const e of entries) bookPaperEntry(e);
        } else if (venue === "binance") {
          const e = entries.find((x) => !isDerivSymbol(x.symbol));
          if (e) await brokerOpen(e);
        } else if (venue === "deriv") {
          // More than one entry per cycle, spread across market groups (forex, indices, synthetics, crypto...), so one group is not the only thing traded.
          const stNow = useBrain.getState();
          const maxNew = stNow.settings.mode === "mad" ? 3 : stNow.settings.mode === "aggressive" ? 2 : scalp ? Math.max(1, stNow.settings.scalp.normalMaxNew) : 1;
          const groupCap = Math.max(2, Math.ceil(stNow.settings.maxPositions / 2));
          const groupOf = (sym: string) => marketInfo(sym)?.group ?? "Deriv";
          const openByGroup: Record<string, number> = {};
          for (const p of stNow.positions) if (p.status === "open" && p.venue === "deriv") openByGroup[groupOf(p.symbol)] = (openByGroup[groupOf(p.symbol)] ?? 0) + 1;
          let taken = 0;
          for (const e of entries) {
            if (taken >= maxNew) break;
            if (!isDerivSymbol(e.symbol) || deriv.isBlocked(e.symbol)) continue;
            const g = groupOf(e.symbol);
            if ((openByGroup[g] ?? 0) >= groupCap) continue;
            if (await derivOpen(e)) {
              taken++;
              openByGroup[g] = (openByGroup[g] ?? 0) + 1;
            }
          }
        }
}

export function useEngine() {
  useEffect(() => {
    void useBrain.persist.rehydrate();
    autoReconnect();
    let stop = false;
    let timer = 0;
    let running = false;
    let rerun = false;
    const tick = async () => {
      if (stop || running) return;
      running = true;
      try {
        await cycle();
      } catch (err) {
        useBrain.getState().log(err instanceof Error ? err.message : "Market loop error", "bad");
        useBrain.setState({ feedNote: err instanceof Error ? err.message : "Market feed error" });
      }
      const mode = useBrain.getState().settings.mode;
      const base = mode === "mad" ? 8000 : mode === "aggressive" ? 12_000 : 18_000;
      const derivOpen = useBrain.getState().positions.some((p) => p.status === "open" && p.venue === "deriv");
      const wait = rerun || scan.soon ? 150 : derivOpen ? Math.min(base, 5000) : base;
      rerun = false;
      scan.soon = false;
      running = false;
      timer = window.setTimeout(() => void tick(), wait);
    };
    timer = window.setTimeout(() => void tick(), 300);
    const stopSwing = startSwingLoop({ open: openSwingEntry, close: closeSwingPosition, forceClosing: isForceClosing });
    const stopHive = startHiveLoop({ open: openHiveEntry, close: closeSwingPosition, forceClosing: isForceClosing });
    // Switching market or timeframe should load right away, not at the next scheduled scan.
    const unsub = useBrain.subscribe((s, prev) => {
      const connChanged = s.conn.binance.status !== prev.conn.binance.status || s.conn.deriv.status !== prev.conn.deriv.status;
      if (!connChanged && s.settings.interval === prev.settings.interval && s.symbol === prev.symbol) return;
      if (running) rerun = true;
      else {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void tick(), 150);
      }
    });
    return () => {
      stop = true;
      stopSwing();
      stopHive();
      unsub();
      window.clearTimeout(timer);
    };
  }, []);
}

function consecOf(positions: BookPosition[]) {
  const closed = positions.filter((p) => p.status === "closed" && p.book !== "swing");
  let n = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    if ((closed[i]!.pnl ?? 0) < 0) n++;
    else break;
  }
  return n;
}

async function brokerOpen(e: EntryIntent, tag: Partial<BookPosition> = {}) {
  const st = useBrain.getState();
  const env = st.settings.binanceEnv;
  const fut = isFuturesEnv(env);
  if (BINANCE_HOSTS[env].live && !st.settings.liveUnlock) {
    st.log("Live Binance is locked. Type LIVE on the Connect tab to unlock real-money orders.", "warn");
    return;
  }
  if (st.conn.binance.status !== "connected") {
    st.log("Binance is not connected, so the order was not sent.", "warn");
    return;
  }
  if (fut) {
    // One futures position per symbol: in one-way mode a second order would merge into the first and break its stop and target.
    if (st.positions.some((p) => p.status === "open" && p.venue === "binance" && p.symbol === e.symbol)) return;
    const key = `${env}:${e.symbol}`;
    if (!futuresReady.has(key)) {
      const prep = await futuresPrepare({ data: { env, apiKey: st.secrets.binanceKey, secret: st.secrets.binanceSecret, symbol: e.symbol, leverage: st.settings.leverage, isolated: st.settings.isolated } });
      if (prep.ok) futuresReady.add(key);
      else st.log(`${e.symbol}: ${prep.error}. Trading with the leverage already set on Binance.`, "warn");
    }
  }
  if (!st.secrets.binanceKey || !st.secrets.binanceSecret) {
    st.log("Binance key or secret is missing.", "warn");
    return;
  }
  const res = await binanceOrder({
    data: {
      env: st.settings.binanceEnv,
      apiKey: st.secrets.binanceKey,
      secret: st.secrets.binanceSecret,
      symbol: e.symbol,
      side: e.side,
      quantity: e.qty,
      clientId: e.key.replace(/[^a-zA-Z0-9]/g, "").slice(0, 36),
      confirm: "PLACE",
    },
  });
  if (!res.ok) {
    st.log(/agreement|tradfi|sign/i.test(res.error) ? `${res.error} If this is gold, silver or another TradFi market, sign the TradFi-Perps agreement with the button on the Trades tab.` : res.error, "bad");
    return;
  }
  if (!res.avgPrice || !(res.executedQty > 0)) {
    useBrain.setState({ uncertain: true, armed: false, swingArmed: false });
    st.log(`Order ${res.orderId} status ${res.status}. Execution is uncertain, so new entries are stopped.`, "bad");
    return;
  }
  const fill = res.avgPrice;
  const shift = fill - e.entry;
  if (res.status !== "FILLED") st.log(`Order ${res.orderId} is ${res.status}; only the executed ${res.executedQty} is tracked.`, "warn");
  const pos: BookPosition = {
    id: crypto.randomUUID(),
    symbol: e.symbol,
    side: e.side,
    qty: res.netQty > 0 ? res.netQty : res.executedQty,
    entry: fill,
    stop: e.stop + shift,
    target: e.target + shift,
    openedAt: Date.now(),
    fees: 0,
    plannedRisk: Math.abs(e.stop - e.entry) * res.executedQty,
    reason: e.reason,
    quality: e.quality,
    strategy: e.strategy,
    mode: st.settings.mode,
    aiQuickR: e.ai?.quickR ?? e.quickR,
    aiNote: e.ai?.note,
    venue: "binance",
    protection: "local-monitor",
    brokerOrderId: res.orderId,
    status: "open",
    ...tag,
  };
  useBrain.setState((cur) => ({
    positions: [...cur.positions, pos],
    seen: [...cur.seen, e.key].slice(-400),
    recent: [...cur.recent, { t: Date.now(), symbol: e.symbol, price: fill, strategy: e.strategy }].slice(-200),
  }));
  st.log(`Binance ${res.status} ${e.side} ${e.symbol} qty ${res.executedQty} @ ${fill.toPrecision(6)}. Order ${res.orderId}. Placing exchange-side stop and target…`);
  if (fut || e.side === "BUY") await protectPosition(pos.id, res.tick);
}

/** Places the OCO and marks the position protected only if Binance confirms it is EXECUTING. */
async function protectPosition(id: string, tick: number) {
  const st = useBrain.getState();
  const pos = st.positions.find((p) => p.id === id && p.status === "open");
  if (!pos) return;
  let failure = "";
  try {
    if (isFuturesEnv(st.settings.binanceEnv)) {
      const fr = await futuresProtect({ data: { env: st.settings.binanceEnv, apiKey: st.secrets.binanceKey, secret: st.secrets.binanceSecret, symbol: pos.symbol, side: pos.side, stop: pos.stop, target: pos.target, tick, clientId: `p${pos.id.replace(/-/g, "").slice(0, 28)}` } });
      if (fr.ok) {
        useBrain.setState((cur) => ({
          positions: cur.positions.map((p) => (p.id === id ? { ...p, protection: "broker-confirmed" as const, ocoListId: `fut:${fr.algoIds.join(",")}`, stop: fr.stop, target: fr.target } : p)),
        }));
        st.log(`${pos.symbol}: Binance futures confirmed stop ${fr.stop} and target ${fr.target}.`);
        return;
      }
      failure = fr.error;
    } else {
    const r = await binanceProtect({
      data: { env: st.settings.binanceEnv, apiKey: st.secrets.binanceKey, secret: st.secrets.binanceSecret, symbol: pos.symbol, quantity: pos.qty, stop: pos.stop, target: pos.target, tick, clientId: `p${pos.id.replace(/-/g, "").slice(0, 30)}` },
    });
    if (r.ok) {
      useBrain.setState((cur) => ({
        positions: cur.positions.map((p) => (p.id === id ? { ...p, protection: "broker-confirmed" as const, ocoListId: r.orderListId, stop: r.stop, target: r.target } : p)),
      }));
      st.log(`${pos.symbol}: Binance confirmed stop ${r.stop} and target ${r.target} (order list ${r.orderListId}).`);
      return;
    }
    failure = r.error;
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : "Protection request failed";
  }
  st.log(`${pos.symbol} is UNPROTECTED at the exchange: ${failure}`, "bad");
  if (useBrain.getState().settings.onProtectFail === "close") {
    st.log(`Safe response is "close": selling ${pos.symbol} at market.`, "warn");
    const fresh = useBrain.getState().positions.find((p) => p.id === id);
    if (fresh) await brokerClose(fresh, pos.entry, "Protection could not be placed");
  } else {
    useBrain.setState({ armed: false, swingArmed: false });
    st.log("Safe response is \"keep local\": new entries are off and this position is watched by this page only.", "warn");
  }
}

async function brokerClose(pos: BookPosition, fallback: number, reason: string) {
  const st = useBrain.getState();
  if (!st.secrets.binanceKey) {
    st.log(`${pos.symbol}: cannot close at Binance because no Binance key is saved. Add it on the Connect tab.`, "warn");
    return;
  }
  if (pos.ocoListId) {
    // The OCO holds the coins. It must be gone before they can be sold.
    const c = pos.ocoListId.startsWith("fut:")
      ? await futuresUnprotect({ data: { env: st.settings.binanceEnv, apiKey: st.secrets.binanceKey, secret: st.secrets.binanceSecret, symbol: pos.symbol, algoIds: pos.ocoListId.slice(4).split(",") } })
      : await binanceUnprotect({ data: { env: st.settings.binanceEnv, apiKey: st.secrets.binanceKey, secret: st.secrets.binanceSecret, symbol: pos.symbol, orderListId: pos.ocoListId } });
    if (!c.ok) {
      useBrain.setState({ uncertain: true, armed: false, swingArmed: false });
      st.log(`${pos.symbol}: could not cancel the exchange stop/target (${c.error}). It may already have filled. Check Binance. New entries stopped.`, "bad");
      return;
    }
    useBrain.setState((cur) => ({ positions: cur.positions.map((p) => (p.id === pos.id ? { ...p, ocoListId: null, protection: "local-monitor" as const } : p)) }));
  }
  const res = await binanceOrder({
    data: {
      env: st.settings.binanceEnv,
      apiKey: st.secrets.binanceKey,
      secret: st.secrets.binanceSecret,
      symbol: pos.symbol,
      side: pos.side === "BUY" ? "SELL" : "BUY",
      quantity: pos.qty,
      clientId: `x${pos.id.replace(/-/g, "").slice(0, 20)}`,
      confirm: "PLACE",
      reduceOnly: isFuturesEnv(st.settings.binanceEnv),
    },
  });
  if (!res.ok || !res.avgPrice) {
    useBrain.setState({ uncertain: true, armed: false, swingArmed: false });
    st.log(`${reason} could not be confirmed at Binance. ${res.ok ? "No fill price." : res.error} New entries stopped.`, "bad");
    return;
  }
  const pnl = pos.side === "BUY" ? (res.avgPrice - pos.entry) * res.executedQty : (pos.entry - res.avgPrice) * res.executedQty;
  useBrain.setState((cur) => ({
    positions: cur.positions.map((p) =>
      p.id === pos.id ? { ...p, status: "closed" as const, exit: res.avgPrice!, pnl, exitReason: `${reason}. Broker order ${res.orderId}`, closedAt: Date.now() } : p,
    ),
  }));
  st.log(`${reason}. Binance filled ${res.executedQty} @ ${res.avgPrice.toPrecision(6)}.`);
  refreshLossPause();
}

async function derivOpen(e: EntryIntent, tag: Partial<BookPosition> = {}): Promise<boolean> {
  const st = useBrain.getState();
  if (!(await deriv.ensure())) {
    st.log("Deriv is not authorized.", "warn");
    return false;
  }
  if (!deriv.virtual && !st.settings.liveUnlock) {
    st.log("This Deriv account is REAL. Type LIVE on the Connect tab to unlock real-money contracts.", "warn");
    return false;
  }
  try {
    const stake = Math.min(Math.max(e.lossAtStop, 1), deriv.balance ?? st.account.cash);
    const bought = await deriv.contract(e.symbol, e.side, stake, deriv.currency || "USD");
    const pos: BookPosition = {
      id: crypto.randomUUID(),
      symbol: e.symbol,
      side: e.side,
      qty: 1,
      entry: e.entry,
      stop: e.entry,
      target: e.target,
      openedAt: Date.now(),
      fees: 0,
      plannedRisk: bought.buyPrice,
      reason: e.reason,
      quality: e.quality,
      strategy: e.strategy,
      mode: st.settings.mode,
      venue: "deriv",
      protection: "contract-stake",
      brokerOrderId: bought.contractId,
      durLabel: bought.durLabel,
      status: "open",
      ...tag,
    };
    useBrain.setState((cur) => ({
      positions: [...cur.positions, pos],
      seen: [...cur.seen, e.key].slice(-400),
      recent: [...cur.recent, { t: Date.now(), symbol: e.symbol, price: e.entry, strategy: e.strategy }].slice(-200),
    }));
    st.log(`Deriv bought contract ${bought.contractId} (${e.side === "BUY" ? "CALL" : "PUT"}) stake ${bought.buyPrice} ${deriv.currency}. Paper cash was not used. Loss is limited to the stake.`);
    return true;
  } catch (err) {
    st.log(err instanceof Error ? err.message : "Deriv order failed", "bad");
    return false;
  }
}
