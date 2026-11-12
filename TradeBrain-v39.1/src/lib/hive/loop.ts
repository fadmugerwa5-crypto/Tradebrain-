// The colony's heartbeat. Every two seconds it checks each desk's Watchdog, watches open trades, writes lessons,
// and runs one colony round on whichever desk is due. One desk per connected broker:
// Deriv scalps, Binance trades (or scalps if switched). Both can run side by side.
import { marketData } from "@/lib/brokers/api";
import { deriv } from "@/lib/brokers/deriv";
import { BINANCE_HOSTS, INTERVAL_MS, isFuturesEnv, type Candle } from "@/lib/market/types";
import { equityOf, type BookPosition } from "@/lib/trade/account";
import type { EntryIntent } from "@/lib/trade/planner";
import { useBrain } from "@/stores/brain";
import { profileFor, useHive, type Receipt } from "@/stores/hive";
import { AGENTS, manageSystem, systemFor } from "./agents.ts";
import { buildBrief, rankBriefs } from "./brief.ts";
import { runRound, type Ask } from "./colony.ts";
import { AFTER_MS, adviceFor, analyzeTrade, gradeAgents, lessonLine, relevantLessons, scorecards, weightsFrom } from "./learn.ts";
import { CallGate, makeAsk } from "./llm.ts";
import { extractJson, parseManage } from "./parse.ts";
import { sizeHive } from "./sizing.ts";
import { saveHiveWait } from "../trade/watchtower.ts";
import { derivHiveLossCut } from "../trade/scalp.ts";
import { evaluateTradeSurvival, stopQualityNote } from "../trade/survival.ts";
import { HIVE_DEFAULTS, type AccountView, type AgentId, type Brief, type DeskVenue, type Lesson, type Style, type StyleCfg } from "./types.ts";

export type ExecVenue = "paper" | "binance" | "deriv";
export type HiveDeps = {
  open: (e: EntryIntent, tag: Partial<BookPosition>, venue: ExecVenue) => Promise<void>;
  close: (pos: BookPosition, price: number, reason: string) => Promise<void>;
  forceClosing: () => boolean;
};

/** One connected broker the colony works on. */
export type Desk = { venue: DeskVenue; style: Style; sim: boolean; cfg: StyleCfg };

const gate = new CallGate(HIVE_DEFAULTS.callsPerMin);
const ask: Ask = makeAsk({
  profile: (a) => profileFor(useHive.getState(), a),
  gate,
  onCall: (agent, ok, error) => {
    const h = useHive.getState();
    h.patchAgent(agent, { calls: h.agents[agent].calls + 1, errors: h.agents[agent].errors + (ok ? 0 : 1), ...(ok ? {} : { note: error ?? "" }) });
  },
  budget: {
    policy: (agent) => useHive.getState().budgetPolicies[agent],
    usage: (agent) => useHive.getState().budgetUsage[agent],
    record: (agent, kind, at) => useHive.getState().recordBudget(agent, kind, at),
  },
});

const has = (a: AgentId) => profileFor(useHive.getState(), a) != null;
const money = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const deskName = (d: DeskVenue) => (d === "deriv" ? "Deriv" : "Binance");

const closing = new Map<string, number>();
const managedAt = new Map<string, number>();
/** Best and worst price seen while each trade was open. */
const track = new Map<string, { high: number; low: number }>();
let coachBusy = false;

function hivePositions(open = true, desk?: DeskVenue): BookPosition[] {
  return useBrain.getState().positions.filter((p) => p.hive === true && (open ? p.status === "open" : p.status === "closed") && (!desk || p.hiveDesk === desk));
}

/** The desks that are connected and switched on. Deriv always scalps (its contracts have a fixed duration). */
export function activeDesks(): Desk[] {
  const h = useHive.getState();
  const b = useBrain.getState();
  const out: Desk[] = [];
  for (const venue of ["deriv", "binance"] as DeskVenue[]) {
    if (b.conn[venue].status !== "connected") continue;
    const pref = h.desks[venue];
    if (!pref.on) continue;
    const style: Style = venue === "deriv" ? "scalp" : pref.style;
    out.push({ venue, style, sim: pref.sim, cfg: h.config[style] });
  }
  return out;
}

const execVenue = (d: Desk): ExecVenue => (d.sim ? "paper" : d.venue);

/** Equity and cash of one desk. null = not known yet, so nothing is traded rather than guessing. */
function deskMoney(d: Desk): { equity: number; cash: number } | null {
  const b = useBrain.getState();
  if (d.sim) {
    const marks: Record<string, number> = {};
    for (const [s, q] of Object.entries(b.quotes)) marks[s] = q.last;
    return { equity: equityOf(b.account, b.positions, marks), cash: b.account.cash };
  }
  if (d.venue === "deriv") {
    if (!deriv.authorized || deriv.balance == null) return null;
    // A Deriv stake leaves the balance when a contract opens, so open contracts are added back at their current value.
    const open = b.positions.filter((p) => p.status === "open" && p.venue === "deriv").reduce((s, p) => s + (p.liveValue ?? p.plannedRisk), 0);
    return { equity: deriv.balance + open, cash: deriv.balance };
  }
  const br = b.broker;
  if (!br || Date.now() - br.at > 90_000) return null;
  return { equity: br.equity, cash: br.cash };
}

/** The Watchdog: plain code that pauses one desk and says why. Empty string = all clear. */
function watchdog(d: Desk, m: { equity: number } | null): string {
  const b = useBrain.getState();
  const h = useHive.getState();
  if (b.uncertain) return "A broker order came back unclear, so the colony is paused. Check the broker, then Stop and wake it again.";
  if (!d.sim) {
    if (d.venue === "binance" && BINANCE_HOSTS[b.settings.binanceEnv].live && !b.settings.liveUnlock) return "Live Binance is locked. Use a demo environment, or unlock live on the Connect tab.";
    if (d.venue === "deriv" && deriv.authorized && !deriv.virtual && !b.settings.liveUnlock) return "This Deriv account is REAL. Use the demo account, or unlock live on the Connect tab.";
    if (d.venue === "deriv" && !deriv.authorized) return "Deriv is not authorized yet.";
  }
  if (!m) return d.venue === "binance" ? "Waiting for the Binance balance." : "Waiting for the account balance.";
  const ds = h.dayStart[d.venue];
  if (ds.day === today() && ds.equity > 0 && m.equity - ds.equity <= -(ds.equity * h.config.dailyLossPct) / 100) return `Daily loss limit reached (${h.config.dailyLossPct}%). This desk rests until tomorrow, or raise the limit.`;
  return "";
}

function syncPhases() {
  const h = useHive.getState();
  for (const a of AGENTS) {
    if (a.kind === "builtin") continue;
    const live = h.agents[a.id];
    const awake = has(a.id);
    if (!awake && live.phase !== "asleep") h.patchAgent(a.id, { phase: "asleep", note: "No AI key yet." });
    else if (awake && live.phase === "asleep") h.patchAgent(a.id, { phase: "idle", note: "" });
  }
  const live = useHive.getState().deskLive;
  const reasons = (["deriv", "binance"] as DeskVenue[]).map((v) => live[v].paused).filter((r) => r && r !== "Off" && r !== "Not connected");
  h.patchAgent("watchdog", { phase: reasons.length ? "error" : "idle", note: reasons[0] ?? "All clear.", vote: "WAIT" });
}

// ---- candles: the engine feeds one timeframe; a desk on another timeframe gets its own klines ----

const own = new Map<string, { at: number; candles: Candle[] }>();
let ownBusy = false;
const ownKey = (interval: string, symbol: string) => `${interval}:${symbol}`;

function deskCandles(d: Desk, symbol: string): Candle[] | undefined {
  const b = useBrain.getState();
  if (d.cfg.interval === b.settings.interval) return b.candles[symbol];
  return own.get(ownKey(d.cfg.interval, symbol))?.candles;
}

/** Markets this desk may trade: the ones switched on in Markets, for its broker. */
function universe(d: Desk): string[] {
  const b = useBrain.getState();
  const out: string[] = [];
  for (const m of b.markets) {
    if (m.broker !== d.venue || m.open === false) continue;
    if (!b.settings.enabled.includes(m.symbol)) continue;
    if (m.broker === "deriv" && deriv.isBlocked(m.symbol)) continue;
    out.push(m.symbol);
  }
  return out.slice(0, 14);
}

async function refreshOwn(d: Desk) {
  const b = useBrain.getState();
  if (d.venue !== "binance" || d.cfg.interval === b.settings.interval || ownBusy) return;
  ownBusy = true;
  try {
    const ttl = Math.min(INTERVAL_MS[d.cfg.interval] / 4, 60_000);
    const due = universe(d).filter((s) => Date.now() - (own.get(ownKey(d.cfg.interval, s))?.at ?? 0) > ttl);
    await Promise.all(
      due.map(async (symbol) => {
        const res = (await marketData({ data: { op: "klines", env: b.settings.binanceEnv, symbol, interval: d.cfg.interval } })) as { candles?: Candle[] };
        if (res.candles?.length) own.set(ownKey(d.cfg.interval, symbol), { at: Date.now(), candles: res.candles });
      }),
    );
  } catch {
    /* the next tick tries again */
  } finally {
    ownBusy = false;
  }
}

/** The engine loads one timeframe for everyone. If any desk scalps, that is the scalp timeframe; otherwise the trader one. */
function syncInterval(desks: Desk[]) {
  if (!desks.length) return;
  const want = (desks.find((d) => d.style === "scalp") ?? desks[0]!).cfg.interval;
  const b = useBrain.getState();
  if (b.settings.interval !== want) b.patchSettings({ interval: want });
}

function shortlist(d: Desk): Brief[] {
  const b = useBrain.getState();
  const h = useHive.getState();
  const fut = isFuturesEnv(b.settings.binanceEnv);
  const intervalMs = INTERVAL_MS[d.cfg.interval];
  const openSyms = new Set(hivePositions(true, d.venue).map((p) => p.symbol));
  const now = Date.now();
  const briefs: Brief[] = [];
  for (const symbol of universe(d)) {
    if (openSyms.has(symbol)) continue;
    const m = b.markets.find((x) => x.symbol === symbol);
    const candles = deskCandles(d, symbol);
    if (!m || !candles || candles.length < 30) continue;
    const f = b.filters[symbol];
    if (d.venue === "binance" && f && f.status !== "TRADING") continue;
    const q = b.quotes[symbol];
    const brief = buildBrief({ symbol, label: m.label, group: m.group, candles, bid: q?.bid, ask: q?.ask, last: q?.last, intervalMs, now, canShort: d.venue === "deriv" || d.sim ? true : fut });
    if (brief) briefs.push(brief);
  }
  return rankBriefs(briefs, intervalMs, h.config.shortlist);
}

// ---- watching open trades ----

/** Stop and target for trades the app watches itself (practice trades, or Binance without an exchange-side order). */
async function monitor(deps: HiveDeps) {
  const b = useBrain.getState();
  const now = Date.now();
  for (const pos of hivePositions()) {
    const price = b.quotes[pos.symbol]?.last;
    if (!(price > 0)) continue;
    const t = track.get(pos.id) ?? { high: Math.max(pos.entry, price), low: Math.min(pos.entry, price) };
    t.high = Math.max(t.high, price);
    t.low = Math.min(t.low, price);
    track.set(pos.id, t);
    if (deps.forceClosing()) continue;
    if (pos.venue === "deriv" || pos.protection === "broker-confirmed") continue;
    if (now - (closing.get(pos.id) ?? 0) < 15_000) continue;
    const buy = pos.side === "BUY";
    const hitStop = buy ? price <= pos.stop : price >= pos.stop;
    const hitTarget = buy ? price >= pos.target : price <= pos.target;
    if (!hitStop && !hitTarget) continue;
    closing.set(pos.id, now);
    await deps.close(pos, price, hitStop ? "Stop" : "Target");
  }
}

/** The Executor looks at each open trade now and then and may close it early. */
async function manage(deps: HiveDeps) {
  if (deps.forceClosing() || !has("executor")) return;
  const h = useHive.getState();
  const b = useBrain.getState();
  const now = Date.now();
  for (const pos of hivePositions()) {
    const style: Style = pos.hiveStyle ?? "scalp";
    const cfg = h.config[style];
    if (now - pos.openedAt < Math.min(15_000, cfg.manageSec * 1000)) continue;
    if (now - (managedAt.get(pos.id) ?? 0) < cfg.manageSec * 1000) continue;
    if (now - (closing.get(pos.id) ?? 0) < 15_000) continue;
    managedAt.set(pos.id, now);
    const price = b.quotes[pos.symbol]?.last ?? pos.entry;
    const pnlNow = pos.venue === "deriv" ? (pos.livePnl ?? 0) : (pos.side === "BUY" ? price - pos.entry : pos.entry - price) * pos.qty;
    const held = Math.round((now - pos.openedAt) / 1000);
    const receipt = useHive.getState().receipts.find((x) => x.posId === pos.id);
    let survival = null;
    // Deriv fixed-duration contracts retain their existing management path. Binance and its practice book
    // use completed-candle structure checks before an early-close AI request is even allowed.
    if (pos.hiveDesk !== "deriv") {
      const venue = pos.hiveDesk ?? "binance";
      const desk: Desk = { venue, style, sim: pos.venue === "paper", cfg };
      const candles = deskCandles(desk, pos.symbol) ?? [];
      const extrema = track.get(pos.id) ?? { high: Math.max(pos.entry, price), low: Math.min(pos.entry, price) };
      survival = evaluateTradeSurvival({ side: pos.side, entry: pos.entry, stop: pos.stop, price, high: extrema.high, low: extrema.low, candles });
      const note = `${survival.reason} ${stopQualityNote(survival, style)}`;
      if (receipt) {
        const prior = receipt.managementEvents ?? [];
        const event = { t: now, state: survival.state, note, currentR: Number(survival.currentR.toFixed(3)), maxAdverseR: Number(survival.maxAdverseR.toFixed(3)), maxFavorableR: Number(survival.maxFavorableR.toFixed(3)) };
        const last = prior[0];
        const changed = !last || last.state !== event.state || now - last.t > 5 * 60_000;
        useHive.getState().patchReceipt(receipt.id, { managementState: survival.state, managementNote: note, ...(changed ? { managementEvents: [event, ...prior].slice(0, 30) } : {}) });
      }
      // Save free API credits: ordinary pullbacks and intact setups do not call Executor at all.
      if (!survival.reviewWithAI) continue;
    }
    // Deriv CALL/PUT contracts are fixed-expiry options. Their mark can go negative briefly
    // even while the underlying later moves in the predicted direction. Do not let the AI
    // close them just because the first quote is underwater. A deterministic 60% stake-loss
    // guard remains after a 60-second grace period; otherwise let the contract run to expiry.
    if (pos.venue === "deriv") {
      const stake = Math.max(0, pos.plannedRisk);
      const heldSec = Math.max(0, Math.floor((now - pos.openedAt) / 1000));
      if (derivHiveLossCut({ profit: pnlNow, stake, heldSec, canSell: true })) {
        if (now - (closing.get(pos.id) ?? 0) < 15_000) continue;
        closing.set(pos.id, now);
        h.say("executor", `${pos.symbol}: deterministic Deriv loss guard reached (${((pnlNow / stake) * 100).toFixed(0)}% of stake); closing after the 60-second grace period.`, "warn");
        await deps.close(pos, price, "Deriv hard loss guard (-60% stake after 60s)");
        continue;
      }
      if (pnlNow < 0) {
        if (receipt) useHive.getState().patchReceipt(receipt.id, { managementState: "THESIS_INTACT", managementNote: `Holding through normal Deriv contract value fluctuation (${money(pnlNow)}). AI early-close is blocked while the contract is at a loss; hard guard is -60% of stake after 60 seconds.` });
        continue;
      }
    }

    const survivalText = survival ? ` Adaptive monitor: ${survival.state}. ${survival.reason} Current result ${survival.currentR.toFixed(2)}R; maximum favourable excursion ${survival.maxFavorableR.toFixed(2)}R; maximum adverse excursion ${survival.maxAdverseR.toFixed(2)}R; stop distance ${survival.stopDistanceAtr == null ? "unknown" : survival.stopDistanceAtr.toFixed(2) + " ATR"}. A negative P&L alone is not an exit reason.` : " Deriv fixed-duration contract: preserve existing contract handling.";
    const text = `Open ${pos.side} ${pos.symbol}${pos.venue === "deriv" ? ` (a Deriv ${pos.durLabel ?? ""} contract: it settles by itself, stake ${pos.plannedRisk.toFixed(2)})` : ""}. Entry ${pos.entry}, stop ${pos.stop}, target ${pos.target}, price now ${price}, profit now ${money(pnlNow)}, open for ${held < 3600 ? `${held}s` : `${(held / 3600).toFixed(1)}h`}.${survivalText}`;
    h.patchAgent("executor", { phase: "thinking" });
    const r = await ask("executor", manageSystem(style), text);
    useHive.getState().patchAgent("executor", { phase: "idle" });
    if (!r.ok) continue;
    const m = parseManage(r.text);
    if (!m.close) continue;
    // Recheck the market after the model response. A stale AI answer cannot close a trade after its thesis recovers.
    const still = useBrain.getState().positions.find((p) => p.id === pos.id && p.status === "open");
    if (!still || deps.forceClosing()) continue;
    if (survival && still.hiveDesk !== "deriv") {
      const latestBrain = useBrain.getState();
      const latestPrice = latestBrain.quotes[still.symbol]?.last ?? price;
      const venue = still.hiveDesk ?? "binance";
      const latestCandles = deskCandles({ venue, style, sim: still.venue === "paper", cfg }, still.symbol) ?? [];
      const latestExtrema = track.get(still.id) ?? { high: Math.max(still.entry, latestPrice), low: Math.min(still.entry, latestPrice) };
      const latest = evaluateTradeSurvival({ side: still.side, entry: still.entry, stop: still.stop, price: latestPrice, high: latestExtrema.high, low: latestExtrema.low, candles: latestCandles });
      if (!latest.reviewWithAI) {
        if (receipt) useHive.getState().patchReceipt(receipt.id, { earlyExitBlocked: (receipt.earlyExitBlocked ?? 0) + 1, managementState: latest.state, managementNote: `Executor close rejected: ${latest.reason}` });
        h.say("executor", `${still.symbol}: early close rejected; the pullback/structure evidence no longer supports exiting.`, "info");
        continue;
      }
    }
    closing.set(pos.id, Date.now());
    h.say("executor", `Closing ${pos.symbol} early${m.note ? `: ${m.note}` : "."}`, "info");
    await deps.close(still, useBrain.getState().quotes[still.symbol]?.last ?? price, `Executor closed early${m.note ? `: ${m.note}` : ""}`);
  }
}

// ---- learning ----

function refreshWeights() {
  const s = useHive.getState();
  s.patch({ weights: weightsFrom(scorecards(s.lessons)) });
}

/** Matches finished trades to their receipts; a while after each exit it measures what the price did and writes the lesson. */
async function bookkeeping() {
  const h = useHive.getState();
  const b = useBrain.getState();
  let closed = 0;
  const now = Date.now();
  for (const r of h.receipts) {
    if (r.outcome === "sent") {
      const p = b.positions.find((x) => x.id === r.posId);
      if (!p) {
        h.patchReceipt(r.id, { outcome: "closed", lessonDone: true, exitReason: "The position record is gone." });
        continue;
      }
      if (p.status !== "closed") continue;
      const pnl = p.pnl ?? 0;
      const t = track.get(p.id);
      h.patchReceipt(r.id, { outcome: "closed", pnl, exitReason: p.exitReason, exitPrice: p.exit ?? undefined, closedAt: p.closedAt ?? now, high: t?.high, low: t?.low });
      h.say("colony", `${r.symbol} ${r.side} closed ${money(pnl)}${p.exitReason ? ` (${p.exitReason})` : ""}.`, pnl >= 0 ? "good" : "bad");
      closed++;
      continue;
    }
    if (r.outcome === "closed" && !r.lessonDone && r.closedAt != null && r.pnl != null && r.exitPrice != null) {
      if (now - r.closedAt < AFTER_MS[r.style]) continue;
      // If the app was closed for a long time, the price "after" is not about this exit any more.
      const fresh = now - r.closedAt <= AFTER_MS[r.style] * 3;
      const after = fresh ? b.quotes[r.symbol]?.last : undefined;
      h.patchReceipt(r.id, { lessonDone: true });
      void writeLesson(r, after);
    }
  }
  if (closed) useHive.getState().patch({ closedSinceCoach: useHive.getState().closedSinceCoach + closed });
  if (useHive.getState().closedSinceCoach >= 5 && has("coach") && !coachBusy) void coach();
}

async function writeLesson(r: Receipt, after: number | undefined) {
  const a = analyzeTrade({ side: r.side, entry: r.entry, stop: r.stop, target: r.target, exit: r.exitPrice!, pnl: r.pnl!, risk: r.risk, high: r.high ?? Math.max(r.entry, r.exitPrice!), low: r.low ?? Math.min(r.entry, r.exitPrice!), after });
  const g = gradeAgents(r.votes, r.side, a.outcome);
  const lesson: Lesson = { id: r.id, t: Date.now(), symbol: r.symbol, side: r.side, style: r.style, desk: r.desk, r: a.r, tags: a.tags, text: adviceFor(a.tags), right: g.right, wrong: g.wrong };
  const s = useHive.getState();
  s.addLesson(lesson);
  s.patchReceipt(r.id, { r: a.r, tags: a.tags });
  refreshWeights();
  if (!has("journal")) return;
  const text = `${r.side} ${r.symbol} (${r.style}) at ${r.entry}, stop ${r.stop}, target ${r.target}, exit ${r.exitPrice}. ${a.facts} Tags: ${a.tags.join(", ")}. Votes: ${r.votes.map((v) => `${v.agent} ${v.vote} ${v.confidence.toFixed(0)}`).join(", ")}. Colony reason: ${r.reason}`;
  s.patchAgent("journal", { phase: "thinking" });
  const ans = await ask("journal", systemFor("journal", r.style), text);
  useHive.getState().patchAgent("journal", { phase: "idle" });
  if (!ans.ok) return;
  const note = String(extractJson(ans.text)?.note ?? "").slice(0, 300);
  if (note) {
    useHive.getState().patchLesson(r.id, { text: note });
    useHive.getState().patchReceipt(r.id, { journal: note });
    useHive.getState().say("journal", note, "info");
  }
}

async function coach() {
  coachBusy = true;
  try {
    const h = useHive.getState();
    const rows = h.receipts.filter((r) => r.outcome === "closed" && r.pnl != null).slice(0, 10);
    if (!rows.length) return;
    const cards = scorecards(h.lessons);
    const text = `Recent closed trades (newest first):\n${rows.map((r) => `${r.symbol} ${r.side} ${r.style} result ${money(r.pnl ?? 0)}${r.tags?.length ? ` [${r.tags.join(", ")}]` : ""}; votes ${r.votes.map((v) => `${v.agent}:${v.vote}${v.confidence.toFixed(0)}`).join(" ")}`).join("\n")}\nLessons so far:\n${h.lessons.slice(0, 6).map(lessonLine).join("\n") || "none"}\nHit rate per analyst: ${Object.entries(cards).map(([k, v]) => `${k} ${v!.right}/${v!.n}`).join(", ") || "not enough trades"}`;
    h.patchAgent("coach", { phase: "thinking" });
    const a = await ask("coach", systemFor("coach"), text);
    useHive.getState().patchAgent("coach", { phase: "idle" });
    useHive.getState().patch({ closedSinceCoach: 0 });
    if (!a.ok) return;
    const note = String(extractJson(a.text)?.note ?? "").slice(0, 400);
    if (!note) return;
    useHive.getState().patch({ coachNote: note });
    useHive.getState().say("coach", note, "info");
  } finally {
    coachBusy = false;
  }
}

// ---- one colony round on one desk ----

function accountView(d: Desk, m: { equity: number; cash: number }): AccountView {
  const h = useHive.getState();
  const ds = h.dayStart[d.venue];
  const open = hivePositions(true, d.venue);
  const recent = hivePositions(false, d.venue)
    .slice(-4)
    .map((p) => `${p.symbol} ${money(p.pnl ?? 0)}`);
  return {
    equity: m.equity,
    cash: m.cash,
    openPositions: open.length,
    openSymbols: open.map((p) => p.symbol),
    dayPnl: ds.day === today() ? m.equity - ds.equity : 0,
    recent,
    venue: `${deskName(d.venue)}${d.sim ? " practice" : ""}`,
    style: d.style,
    currency: d.venue === "deriv" ? deriv.currency || "USD" : "USDT",
  };
}

async function colonyRound(d: Desk, deps: HiveDeps) {
  const h = useHive.getState();
  const cfg = d.cfg;
  const m = deskMoney(d);
  if (!m) return;
  const list = shortlist(d);
  h.setDeskLive(d.venue, { lastRoundAt: Date.now() });
  h.patch({ busy: true, activeDesk: d.venue, focus: list[0]?.symbol ?? h.focus });
  try {
    if (!list.length) {
      h.say("colony", `${deskName(d.venue)} desk: no market has fresh candles yet. Waiting for data.`, "info");
      return;
    }
    const account = accountView(d, m);
    const result = await runRound(
      {
        shortlist: list,
        account,
        config: cfg,
        style: d.style,
        lessons: (symbol) => relevantLessons(useHive.getState().lessons, { symbol, style: d.style, desk: d.venue }).map(lessonLine),
        weights: h.weights,
        has,
        now: Date.now,
        onStep: (agent, state, reply) => {
          const s = useHive.getState();
          if (state === "thinking") s.patchAgent(agent, { phase: "thinking" });
          else if (reply?.ok) s.patchAgent(agent, { phase: "voted", vote: reply.vote, confidence: reply.confidence, note: reply.note || (reply.approve === false ? "Veto" : ""), at: Date.now() });
          else s.patchAgent(agent, { phase: "error", note: reply?.error ?? "No answer." });
        },
      },
      ask,
    );
    const s = useHive.getState();
    s.patch({ rounds: s.rounds + 1, focus: result.symbol ?? list[0]!.symbol });
    s.setDeskLive(d.venue, { rounds: s.deskLive[d.venue].rounds + 1 });
    for (const c of result.chatter) s.say(c.agent, c.text, "info");
    const pickBrief = list.find((x) => x.symbol === result.symbol) ?? null;
    list.forEach((x, i) => {
      if (x.symbol === result.symbol) return;
      s.setVerdict({ symbol: x.symbol, label: x.label, action: "WAIT", reason: `Ranked #${i + 1}; the Scout chose ${result.symbol ?? "no market"} this round.`, confidence: 0, t: Date.now() });
    });
    const dec = result.decision;
    if (dec.action === "WAIT") {
      if (result.symbol) {
        s.setVerdict({ symbol: result.symbol, label: pickBrief?.label ?? result.symbol, action: "WAIT", reason: dec.reason, confidence: 0, t: Date.now() });
        const direction = result.tally.buy > result.tally.sell ? "BUY" : result.tally.sell > result.tally.buy ? "SELL" : undefined;
        const levels = result.replies.find(r => r.ok && r.agent === "scalper");
        saveHiveWait({ symbol: result.symbol, label: pickBrief?.label ?? result.symbol, direction, price: pickBrief?.price ?? 0, stop: levels?.stop, target: levels?.target, reason: dec.reason, timeframe: d.cfg.interval, venue: d.venue });
      }
      s.say("colony", `${deskName(d.venue)} · ${result.symbol ?? "no market"}: wait. ${dec.reason}`, "info");
      return;
    }
    const symbol = result.symbol!;
    if (deps.forceClosing() || !useHive.getState().armed) return;
    if (hivePositions(true, d.venue).length >= cfg.maxOpen || hivePositions().some((p) => p.symbol === symbol && p.hiveDesk === d.venue)) return;
    const fresh = useBrain.getState();
    const money2 = deskMoney(d);
    if (!money2) return;
    const f = fresh.filters[symbol];
    const maxNotional = d.sim ? money2.cash : d.venue === "binance" ? (isFuturesEnv(fresh.settings.binanceEnv) ? money2.cash * fresh.settings.leverage * 0.9 : money2.cash * 0.95) : money2.cash;
    const size = sizeHive({ venue: execVenue(d), equity: money2.equity, cash: money2.cash, riskPct: cfg.riskPct, sizeMult: dec.sizeMult, price: dec.entry, stop: dec.stop, step: f?.step, minNotional: f?.minNotional, maxNotional });
    if (!size.ok) {
      s.setVerdict({ symbol, label: pickBrief?.label ?? symbol, action: "BLOCKED", reason: size.why, confidence: dec.confidence, t: Date.now() });
      s.say("colony", `${symbol}: the colony agreed on ${dec.action} but the order was not sent. ${size.why}`, "bad");
      return;
    }
    const id = crypto.randomUUID();
    const candles = deskCandles(d, symbol) ?? [];
    const intent: EntryIntent = {
      symbol,
      side: dec.action,
      qty: size.qty,
      notional: size.notional,
      lossAtStop: size.lossAtStop,
      entry: dec.entry,
      stop: dec.stop,
      target: dec.target,
      reason: dec.reason,
      quality: Math.round(dec.confidence),
      strategy: `HIVE·${id.slice(0, 6)}`,
      key: `hive-${id}`,
      candleTime: candles[candles.length - 1]?.t ?? Date.now(),
      regime: "hive",
    };
    s.say("executor", `${deskName(d.venue)} ${d.style}: ${dec.action} ${symbol} @ ${dec.entry.toPrecision(6)}, stop ${dec.stop.toPrecision(6)}, target ${dec.target.toPrecision(6)}.`, "info");
    await deps.open(intent, { id, hive: true, hiveDesk: d.venue, hiveStyle: d.style }, execVenue(d));
    const opened = useBrain.getState().positions.some((p) => p.id === id);
    const receipt: Receipt = {
      id,
      t: Date.now(),
      symbol,
      side: dec.action,
      style: d.style,
      desk: d.venue,
      entry: dec.entry,
      stop: dec.stop,
      target: dec.target,
      qty: size.qty,
      risk: size.lossAtStop,
      venue: `${deskName(d.venue)}${d.sim ? " practice" : ""}`,
      confidence: dec.confidence,
      reason: dec.reason,
      votes: result.replies.filter((r) => r.ok).map((r) => ({ agent: r.agent, vote: r.vote, confidence: r.confidence, note: r.note })),
      outcome: opened ? "sent" : "failed",
      posId: id,
      lessonDone: !opened,
      ...(opened ? {} : { failNote: "The broker did not accept the order. The reason is in the Journal tab." }),
    };
    useHive.getState().addReceipt(receipt);
    useHive.getState().setVerdict({ symbol, label: pickBrief?.label ?? symbol, action: opened ? dec.action : "BLOCKED", reason: opened ? dec.reason : "The broker did not accept the order.", confidence: dec.confidence, t: Date.now() });
  } catch (err) {
    useHive.getState().say("colony", `${deskName(d.venue)} round failed: ${err instanceof Error ? err.message : "unknown error"}`, "bad");
  } finally {
    useHive.getState().patch({ busy: false, activeDesk: null });
    const s = useHive.getState();
    for (const a of AGENTS) if (s.agents[a.id].phase === "thinking") s.patchAgent(a.id, { phase: "idle" });
  }
}

function inCooldown(d: Desk): boolean {
  const lastLoss = Math.max(0, ...hivePositions(false, d.venue).filter((p) => (p.pnl ?? 0) < 0).map((p) => p.closedAt ?? 0));
  return Date.now() - lastLoss < d.cfg.cooldownSec * 1000;
}

export function startHiveLoop(deps: HiveDeps): () => void {
  void useHive.persist.rehydrate();
  let stopped = false;
  let running = false;
  // AI rounds take seconds. They run beside the fast tick, never inside it, so stops and targets keep being watched meanwhile.
  let roundRunning = false;
  let manageRunning = false;
  const fail = (what: string) => (err: unknown) => useHive.getState().say("colony", `${what} failed: ${err instanceof Error ? err.message : "unknown error"}`, "bad");
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const h = useHive.getState();
      gate.setLimit(h.config.callsPerMin);
      const desks = activeDesks();
      syncInterval(desks);
      // Per-desk money, daily start and watchdog.
      for (const venue of ["deriv", "binance"] as DeskVenue[]) {
        const d = desks.find((x) => x.venue === venue);
        const s = useHive.getState();
        if (!d) {
          const conn = useBrain.getState().conn[venue].status === "connected";
          s.setDeskLive(venue, { paused: conn ? "Off" : "Not connected", equity: null, cash: null, dayPnl: 0, open: hivePositions(true, venue).length });
          continue;
        }
        const m = deskMoney(d);
        if (m && s.dayStart[venue].day !== today()) s.setDayStart(venue, today(), m.equity);
        const ds = useHive.getState().dayStart[venue];
        const reason = watchdog(d, m);
        if (reason !== s.deskLive[venue].paused && reason && s.armed) s.say("watchdog", `${deskName(venue)}: ${reason}`, "bad");
        s.setDeskLive(venue, { paused: reason, equity: m?.equity ?? null, cash: m?.cash ?? null, dayPnl: m && ds.day === today() ? m.equity - ds.equity : 0, open: hivePositions(true, venue).length });
        void refreshOwn(d);
      }
      useHive.getState().patch({ callsMin: gate.used() });
      syncPhases();
      await monitor(deps);
      await bookkeeping();
      const s = useHive.getState();
      if (!s.armed || deps.forceClosing()) return;
      if (!manageRunning) {
        manageRunning = true;
        void manage(deps)
          .catch(fail("Trade check"))
          .finally(() => {
            manageRunning = false;
          });
      }
      if (roundRunning || s.busy) return;
      // Whichever due desk has waited longest goes next. One round at a time keeps the colony's thinking readable and the AI bill small.
      const due = desks
        .filter((d) => {
          const live = s.deskLive[d.venue];
          return !live.paused && Date.now() - live.lastRoundAt >= d.cfg.roundSec * 1000 && hivePositions(true, d.venue).length < d.cfg.maxOpen && !inCooldown(d);
        })
        .sort((a, b) => s.deskLive[a.venue].lastRoundAt - s.deskLive[b.venue].lastRoundAt)[0];
      if (due) {
        roundRunning = true;
        void colonyRound(due, deps)
          .catch(fail("Colony round"))
          .finally(() => {
            roundRunning = false;
          });
      }
    } catch (err) {
      fail("Colony loop")(err);
    } finally {
      running = false;
    }
  };
  const timer = window.setInterval(() => void tick(), 2000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
