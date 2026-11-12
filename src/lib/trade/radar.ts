import type { Decision } from "../market/analyze.ts";
import { STRATEGIES, buildCtx, measureEdge, type Edge, type Signal, type Strategy } from "../market/strategies.ts";
import { marketInfo, type Candle, type Side } from "../market/types.ts";
import { extractJson, shapeEntry, type AiEntryReply } from "./aiscalp.ts";
import { ROUND_TRIP_COST, type ScalpConfig } from "./scalp.ts";
import type { GateFn } from "../learn/rules.ts";

/** Scalp radar: scan every loaded market with every strategy, rank the setups, and hand the best to the AI. */
export type RadarConfig = {
  enabled: boolean;
  /** How many candidates may be traded at once (the best ones). */
  top: number;
  /** How many of the best candidates go to the AI for the final pick. */
  aiList: number;
  /** A strategy needs at least this many past trades on the market before it counts. */
  minTrades: number;
  /** Minimum average result per trade in R, after fees, on that market's recent history. */
  minEdge: number;
  /** Minimum overall score (0-100). */
  minScore: number;
  /** How many past bars are used to measure each strategy on each market. */
  lookback: number;
  /** Most candidates from one market group (Forex, Volatility, Crypto...) that may reach the AI shortlist. */
  perGroup: number;
  /** Warm-up: no trading until this % of the open markets have loaded their candles. */
  warmupPct: number;
  /** Warm-up never lasts longer than this many seconds. */
  warmupMaxSec: number;
  /** Markets the radar is not sure about (thin record, erratic, spiky) are left out below this confidence (0-100). */
  minConfidence: number;
  /** A market whose biggest recent bar is this many times its typical bar is spiky: penalised, and left out above spikeMax. */
  spikeMax: number;
  /** After this many losses in a row on one market, the radar benches it. 0 = off. */
  benchLosses: number;
  /** How long a benched market sits out, in minutes (doubles after twice as many losses). */
  benchMin: number;
};

export const RADAR_DEFAULTS: RadarConfig = {
  enabled: true,
  top: 3,
  aiList: 5,
  minTrades: 6,
  minEdge: 0.05,
  minScore: 55,
  lookback: 220,
  perGroup: 2,
  warmupPct: 85,
  warmupMaxSec: 300,
  minConfidence: 45,
  spikeMax: 14,
  benchLosses: 2,
  benchMin: 90,
};

export type Candidate = {
  id: number;
  key: string;
  symbol: string;
  label: string;
  group: string;
  strategy: string;
  strategyName: string;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  quickR: number;
  holdMin: number;
  stopPct: number;
  atr: number;
  atrPct: number;
  quickGainPct: number;
  costPct: number;
  strength: number;
  edge: Edge;
  score: number;
  spreadPct: number | null;
  why: string;
  signalTime: number;
  howTo: string[];
  /** Set once the AI has judged this candidate. */
  ai?: AiEntryReply;
  /** What the Learning Brain saw at the signal: market regime and the higher-timeframe bias. */
  /** 0-100: how sure the radar is about this market (evidence, stable record, not spiky). */
  confidence?: number;
  learn?: { regime: string; align: string; htfBias: string; htfMin: number; note: string };
};

export type RadarRow = { symbol: string; candles: Candle[]; spreadPct: number | null; tradable: boolean; /** The market is closed right now, so it is not waited for during warm-up. */ closed?: boolean };

export type RadarResult = {
  ranked: Candidate[];
  total: number;
  withData: number;
  signals: number;
  /** Markets that are open and should have candles (the warm-up waits for these). */
  expected: number;
  rejected: RadarRejected;
};

export type RadarRejected = { noEdge: number; fees: number; stale: number; lowScore: number; learned: number; unsure: number; benched: number; crowded: number };

/** What the screens show about the last radar sweep. */
export type RadarView = {
  at: number;
  interval: string;
  total: number;
  withData: number;
  signals: number;
  rejected: RadarResult["rejected"];
  /** Warm-up: loaded share of the open markets, and whether trading has been released. */
  warm: { done: boolean; pct: number; expected: number };
  shortlist: Candidate[];
  /** Symbols the radar is allowing the bot to scalp right now. */
  chosen: string[];
  /** Plain-language state: waiting for candles, asking the AI, AI down, and so on. */
  note: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : "?");

/** Typical vs biggest recent bar. Spike indices (Boom/Crash) have a huge ratio; calm forex and volatility indices do not. */
export function spikiness(candles: Candle[], n = 100): number {
  const r = candles.slice(-n).map((c) => c.h - c.l).filter((x) => x >= 0);
  if (r.length < 20) return 0;
  const sorted = [...r].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  if (!(med > 0)) return 0;
  return sorted[sorted.length - 1]! / med;
}

export const isSpikeIndex = (symbol: string) => /^(BOOM|CRASH)/i.test(symbol);

/** Markets that move together. A candidate may not join a shortlist that already holds its cluster. */
export function clusterKeys(symbol: string): string[] {
  const m = marketInfo(symbol);
  if (/^(BOOM|CRASH)/i.test(symbol)) return ["spike-indices"];
  if (/^(R_\d+|1HZ\d+V)$/i.test(symbol)) return ["volatility-indices"];
  if (/^JD/i.test(symbol)) return ["jump-indices"];
  if (/^stp/i.test(symbol)) return ["step-indices"];
  if (/^(RDBEAR|RDBULL)/i.test(symbol)) return ["bear-bull"];
  if (/^WLD/i.test(symbol)) return ["basket"];
  if (/^OTC_/i.test(symbol)) return ["stock-indices"];
  const fx = /^frx([A-Z]{3})([A-Z]{3})$/.exec(symbol);
  if (fx) return [`fx-${fx[1]}`, `fx-${fx[2]}`];
  if (/^cry/i.test(symbol) || m?.broker === "binance") return ["crypto"];
  return [];
}
/** Crypto moves almost as one, so two at a time is the limit. Everything else: one per cluster. */
const clusterCap = (key: string) => (key === "crypto" ? 2 : 1);

/** Keeps the best candidates but spreads them: limited per group and one per cluster of markets that move together. */
export function diversify(sorted: Candidate[], cfg: Pick<RadarConfig, "aiList" | "perGroup">): { list: Candidate[]; crowded: number } {
  const list: Candidate[] = [];
  const byGroup = new Map<string, number>();
  const byKey = new Map<string, number>();
  let crowded = 0;
  for (const c of sorted) {
    if (list.length >= cfg.aiList) break;
    const keys = clusterKeys(c.symbol);
    if ((byGroup.get(c.group) ?? 0) >= cfg.perGroup || keys.some((k) => (byKey.get(k) ?? 0) >= clusterCap(k))) {
      crowded++;
      continue;
    }
    byGroup.set(c.group, (byGroup.get(c.group) ?? 0) + 1);
    for (const k of keys) byKey.set(k, (byKey.get(k) ?? 0) + 1);
    list.push(c);
  }
  return { list, crowded };
}

/** How sure the radar is about a market: enough past trades, a steady win rate, and no wild spikes. */
export function confidenceOf(edge: Edge, spike: number): number {
  const evidence = clamp(edge.trades / 20, 0, 1) * 40;
  const steady = clamp((edge.winRate - 0.35) / 0.3, 0, 1) * 30;
  const calm = clamp(1 - Math.max(0, spike - 4) / 10, 0, 1) * 30;
  return Math.round(evidence + steady + calm);
}

type ClosedSig = { s: Strategy; sig: Signal; edge: Edge };
type ClosedScan = { i: number; t: number; atr: number; close: number; sigs: ClosedSig[] };
const cache = new Map<string, ClosedScan>();

export function clearRadarCache() {
  cache.clear();
}

/** Costs for one market: Deriv contracts have no fee on top of the stake, exchange markets pay fees and slippage. */
export function costFor(symbol: string): { costFrac: number; deriv: boolean } {
  const deriv = marketInfo(symbol)?.broker === "deriv";
  return { costFrac: deriv ? 0.0002 : ROUND_TRIP_COST, deriv };
}

/** Runs every strategy on the last closed bar of one market and measures each on that market's history. Cached per closed bar. */
function closedScan(symbol: string, closed: Candle[], intervalMs: number, costFrac: number, lookback: number, lockR: number): ClosedScan | null {
  const key = `${symbol}|${intervalMs}|${closed.length}|${closed[closed.length - 1]!.t}|${costFrac}|${lookback}|${lockR}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const x = buildCtx(closed);
  if (!x) return null;
  const i = closed.length - 1;
  const atr = x.atr[i];
  if (!(atr && atr > 0)) return null;
  const sigs: ClosedSig[] = [];
  for (const s of STRATEGIES) {
    const sig = s.signal(x, i);
    if (!sig) continue;
    sigs.push({ s, sig, edge: measureEdge(x, s, costFrac, lookback, i - 1, lockR) });
  }
  const out = { i, t: closed[i]!.t, atr, close: closed[i]!.c, sigs };
  if (cache.size > 600) cache.clear();
  cache.set(key, out);
  return out;
}

export function runRadar(input: { rows: RadarRow[]; intervalMs: number; now: number; cfg: RadarConfig; scalp: ScalpConfig; gate?: GateFn; /** Returns a reason when the market is benched after repeated losses. */ benched?: (symbol: string) => string | null }): RadarResult {
  const { cfg, scalp, intervalMs, now } = input;
  const rejected: RadarRejected = { noEdge: 0, fees: 0, stale: 0, lowScore: 0, learned: 0, unsure: 0, benched: 0, crowded: 0 };
  const best = new Map<string, Candidate>();
  let withData = 0;
  let signals = 0;
  for (const row of input.rows) {
    if (!row.tradable || row.candles.length < 80) continue;
    withData++;
    if (input.benched?.(row.symbol)) {
      rejected.benched++;
      continue;
    }
    const spike = spikiness(row.candles);
    const live = row.candles[row.candles.length - 1]!;
    const forming = now - live.t < intervalMs;
    const closed = forming ? row.candles.slice(0, -1) : row.candles;
    const { costFrac, deriv } = costFor(row.symbol);
    const scan = closedScan(row.symbol, closed, intervalMs, costFrac, cfg.lookback, scalp.lockR);
    if (!scan) continue;
    const info = marketInfo(row.symbol);
    for (const { s, sig, edge } of scan.sigs) {
      signals++;
      const entry = live.c;
      const dist = Math.abs(entry - sig.stop);
      const onRightSide = sig.side === "BUY" ? entry > sig.stop : entry < sig.stop;
      // The signal is on the last closed bar. If price has already run away from it, the setup is gone.
      if (!onRightSide || !(dist > 0) || Math.abs(entry - scan.close) > 0.6 * scan.atr) {
        rejected.stale++;
        continue;
      }
      const costPct = costFrac * 100;
      const stopPct = (dist / entry) * 100;
      const quickGainPct = s.quickR * stopPct;
      if (!deriv && quickGainPct + 1e-9 < scalp.feeMult * costPct) {
        rejected.fees++;
        continue;
      }
      // Boom/Crash look good in a back-test because of their drift, then a spike takes the stop. They must show twice the proof.
      const spikeIdx = isSpikeIndex(row.symbol);
      if (edge.trades < (spikeIdx ? Math.ceil(cfg.minTrades * 1.5) : cfg.minTrades) || edge.expectancy < (spikeIdx ? cfg.minEdge * 2 : cfg.minEdge)) {
        rejected.noEdge++;
        continue;
      }
      const confidence = confidenceOf(edge, spike);
      if (spike > cfg.spikeMax || confidence < cfg.minConfidence) {
        rejected.unsure++;
        continue;
      }
      let adj = 0;
      let learn: Candidate["learn"];
      if (input.gate) {
        const g = input.gate({ symbol: row.symbol, candles: row.candles, tfMs: intervalMs, strategy: s.id, side: sig.side, entry, stop: sig.stop, spreadPct: row.spreadPct, now });
        if (!g.allow) {
          rejected.learned++;
          continue;
        }
        adj = g.scoreAdj;
        if (g.ctx) learn = { regime: g.ctx.regime, align: g.ctx.align, htfBias: g.ctx.htfBias, htfMin: g.ctx.htfMin, note: g.note };
      }
      const edgeScore = clamp(50 + 100 * edge.expectancy, 0, 100);
      const moveScore = deriv ? 70 : clamp((quickGainPct / costPct - 1) * 25, 0, 100);
      const spreadScore = row.spreadPct == null ? 70 : clamp(100 - 400 * row.spreadPct, 0, 100);
      const spikePenalty = Math.round(clamp((spike - 6) * 3, 0, 30));
      const score = Math.max(0, Math.round(0.4 * sig.strength + 0.4 * edgeScore + 0.2 * (0.5 * moveScore + 0.5 * spreadScore)) + adj - spikePenalty);
      if (score < cfg.minScore) {
        rejected.lowScore++;
        continue;
      }
      const target = sig.side === "BUY" ? entry + s.rr * dist : entry - s.rr * dist;
      const holdMin = Math.round((s.holdBars * intervalMs) / 60_000);
      const quickPrice = sig.side === "BUY" ? entry + s.quickR * dist : entry - s.quickR * dist;
      const c: Candidate = {
        id: 0,
        key: `${row.symbol}|${s.id}|${sig.side}|${scan.t}`,
        symbol: row.symbol,
        label: info?.label ?? row.symbol,
        group: info?.group ?? "other",
        strategy: s.id,
        strategyName: s.name,
        side: sig.side,
        entry,
        stop: sig.stop,
        target,
        rr: s.rr,
        quickR: s.quickR,
        holdMin,
        stopPct,
        atr: scan.atr,
        atrPct: (scan.atr / entry) * 100,
        quickGainPct,
        costPct,
        strength: sig.strength,
        edge,
        score,
        spreadPct: row.spreadPct,
        why: sig.why,
        signalTime: scan.t,
        confidence,
        learn,
        howTo: [
          `${sig.side === "BUY" ? "Buy" : "Sell"} ${info?.label ?? row.symbol} at market, about ${fmt(entry)}.`,
          `Stop ${fmt(sig.stop)} (${stopPct.toFixed(2)}% away). Bank a quick profit near ${fmt(quickPrice)} (${s.quickR}R, +${quickGainPct.toFixed(2)}%${deriv ? "" : ` against ${costPct.toFixed(2)}% round-trip cost`}). Runner target ${fmt(target)} (${s.rr}R).`,
          `Once price is ${scalp.lockR}R in profit, move the stop to entry plus fees. If nothing has happened in about ${holdMin} min, close at market.`,
        ],
      };
      const prev = best.get(row.symbol);
      if (!prev || c.score > prev.score) best.set(row.symbol, c);
    }
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score);
  const { list: ranked, crowded } = diversify(sorted, cfg);
  rejected.crowded = crowded;
  ranked.forEach((c, k) => (c.id = k + 1));
  const expected = input.rows.filter((r) => !r.closed).length;
  return { ranked, total: input.rows.length, withData, signals, expected, rejected };
}

/** The decision the planner and risk engine work with, built from a radar candidate. */
export function candidateDecision(c: Candidate): Decision {
  const plan = { entry: c.entry, stop: c.stop, target: c.target, risk: Math.abs(c.entry - c.stop), rr: c.rr };
  const e = c.edge;
  return {
    action: c.side,
    reason: `Radar pick: ${c.strategyName}. ${c.why} On this market it made ${e.avgR >= 0 ? "+" : ""}${e.avgR.toFixed(2)}R per trade after costs over ${e.trades} trades (${Math.round(e.winRate * 100)}% won). Score ${c.score}.`,
    quality: c.score,
    regime: "Radar",
    plan,
    modules: [{ id: c.strategy, name: c.strategyName, family: "momentum", verdict: c.side, score: c.strength, why: c.why, plan }],
    lead: c.strategy,
    net: 1,
    agreeFamilies: 1,
    opposeFamilies: 0,
    candleTime: c.signalTime,
    price: c.entry,
    atr: c.atr,
    spreadNote: "Spread is checked separately by the risk engine.",
  };
}

export const RADAR_SYSTEM =
  "You are the head scalping analyst of a trading bot. A scanner ran seven scalping strategies on every market and measured how each strategy did on that same market's recent history, after fees. " +
  "From the shortlist below, choose which candidates to trade right now. List ALL ids, best first. " +
  "Prefer: positive average R with a decent win rate over enough trades, a clear signal, a tight spread, and a quick profit that is well above the round-trip cost. " +
  "SKIP: setups that chase a move that already ran, markets that look stalled, several near-identical correlated picks (keep the cleanest one), thin evidence, or a quick profit that barely clears costs. " +
  "You cannot change entry, stop or target, add markets, or raise the size. " +
  "Reply with ONLY one JSON object and nothing else: " +
  '{"picks":[{"id":number,"action":"TAKE" or "SKIP","quickR":number from 0.4 to 1.0,"sizeMult":number from 0.25 to 1,"reason":"at most 12 words"}]}. ' +
  "Use only the numbers given. Do not invent prices or news.";

/** The radar prompt for each strictness level. Relaxed lets the AI keep most of the ranked list and veto only clear problems. */
export function radarSystemFor(level: ScalpConfig["aiStrict"] | undefined): string {
  if (level === "strict") return RADAR_SYSTEM;
  const tail =
    "You cannot change entry, stop or target, add markets, or raise the size. " +
    "Reply with ONLY one JSON object and nothing else: " +
    '{"picks":[{"id":number,"action":"TAKE" or "SKIP","quickR":number from 0.4 to 1.0,"sizeMult":number from 0.25 to 1,"reason":"at most 12 words"}]}. ' +
    "Use only the numbers given. Do not invent prices or news.";
  if (level === "balanced")
    return (
      "You are the head scalping analyst of a trading bot. A scanner ran seven scalping strategies on every market and measured how each did on that market's recent history, after fees. " +
      "From the shortlist, choose which candidates to trade now. List ALL ids, best first. TAKE the good ones. SKIP only chasing setups, stalled markets, near-duplicate correlated picks, or a quick profit that barely clears costs. " +
      tail
    );
  return (
    "You are the head scalping analyst of a trading bot. A scanner already filtered every market with seven strategies and each market's recent record after fees, so every candidate below is a real setup. " +
    "Your job is to rank them and keep the trades flowing. TAKE every candidate that is not clearly bad, best first. Use sizeMult below 1 for the ones you like less. " +
    "SKIP only for a clear red flag (very wide spread, profit that cannot clear costs, an obviously late entry, or an exact duplicate of a better pick). " +
    tail
  );
}

export type RadarBriefContext = { interval: string; dayPnl: number; dailyRemaining: number | null; openCount: number; consecLosses: number; scanned: number; withData: number; signals: number; top: number };

export function radarBrief(cands: Candidate[], c: RadarBriefContext): string {
  const head = [
    `Scalp shortlist on ${c.interval} candles. Scanned ${c.withData} of ${c.scanned} markets, ${c.signals} live signals, ${cands.length} passed the checks. Pick at most ${c.top} to trade.`,
    `Open trades ${c.openCount}. Losses in a row ${c.consecLosses}. Today realized ${c.dayPnl >= 0 ? "+" : ""}${c.dayPnl.toFixed(2)}${c.dailyRemaining != null ? `, ${c.dailyRemaining.toFixed(2)} left to the daily goal` : ""}.`,
  ];
  const cap = Math.max(200, Math.floor((3900 - head.join("\n").length - cands.length) / Math.max(1, cands.length)));
  const lines = cands.map((k) =>
    (
      `#${k.id} ${k.label} (${k.group}) ${k.side} via ${k.strategyName}: entry ${fmt(k.entry)}, stop ${fmt(k.stop)}, target ${fmt(k.target)}. ` +
      `Stop ${k.stopPct.toFixed(2)}%, ATR ${k.atrPct.toFixed(2)}%, spread ${k.spreadPct == null ? "unknown" : k.spreadPct.toFixed(3) + "%"}. ` +
      `Recent record here: ${k.edge.trades} trades, ${Math.round(k.edge.winRate * 100)}% won, ${k.edge.avgR >= 0 ? "+" : ""}${k.edge.avgR.toFixed(2)}R each after costs. ` +
      `Signal ${k.strength}/100, score ${k.score}. Quick profit at ${k.quickR}R is ${k.quickGainPct.toFixed(2)}% vs cost ${k.costPct.toFixed(2)}%. ${k.why}`
    ).slice(0, cap),
  );
  return [...head, ...lines].join("\n").slice(0, 3900);
}

/**
 * Turns the AI's answer into one verdict per candidate. Unusable answers return null (treated as the AI being down).
 * Every number is clamped by the same rules as a single entry verdict; at most `top` TAKEs are kept, in the order the AI listed them.
 */
export function parseRadar(text: string, cands: Candidate[], cfg: ScalpConfig, top: number): Map<string, AiEntryReply> | null {
  const j = extractJson(text);
  const picks = j && Array.isArray(j.picks) ? (j.picks as unknown[]) : null;
  if (!picks) return null;
  const out = new Map<string, AiEntryReply>();
  let taken = 0;
  for (const raw of picks) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const id = Number(p.id);
    const c = cands.find((k) => k.id === id);
    if (!c || out.has(c.key)) continue;
    const reply = shapeEntry(p, { entry: c.entry, stop: c.stop }, cfg);
    if (!reply) continue;
    if (reply.action === "TAKE") {
      if (taken >= top) {
        out.set(c.key, { ...reply, action: "SKIP", reason: `Ranked below the best ${top}` });
        continue;
      }
      taken++;
    }
    out.set(c.key, reply);
  }
  for (const c of cands) {
    if (out.has(c.key)) continue;
    // Relaxed: a candidate the AI left out is not a veto. It follows the radar's own ranking while there is room.
    if (cfg.aiStrict !== "strict" && taken < top) {
      out.set(c.key, { action: "TAKE", quickR: c.quickR, sizeMult: 1, reason: "Radar ranking (AI had no objection)" });
      taken++;
    } else out.set(c.key, { action: "SKIP", quickR: c.quickR, sizeMult: 1, reason: "Not picked by the AI" });
  }
  return out;
}
