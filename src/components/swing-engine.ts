import { learnGate } from "@/lib/learn/store";
import { marketData } from "@/lib/brokers/api";
import { DERIV_GRANULARITY, deriv } from "@/lib/brokers/deriv";
import { BINANCE_HOSTS, isDerivSymbol, isFuturesEnv, marketInfo, type BinanceEnv, type Candle } from "@/lib/market/types";
import type { BookPosition } from "@/lib/trade/account";
import { SWING_HISTORY, planSwing, signalText, swingExit, swingTfMs, type SwingEntry, type SwingRowIn } from "@/lib/trade/swing";
import { mixByGroup, useBrain } from "@/stores/brain";

export type SwingHooks = {
  open: (e: SwingEntry) => Promise<void>;
  close: (pos: BookPosition, price: number, reason: string) => Promise<void>;
  forceClosing: () => boolean;
};

type Loaded = { tf: string; at: number; candles: Candle[] };

/** Candles per market at the swing timeframe. Not saved: they are reloaded when the app opens. */
const loaded: Record<string, Loaded> = {};

/** Read-only access for the Learn tab's Backtest Lab: candles the Trades tab has already loaded. */
export const swingCandles = (symbol: string): { candles: import("@/lib/market/types").Candle[]; tf: string } | null => (loaded[symbol] ? { candles: loaded[symbol]!.candles, tf: String(loaded[symbol]!.tf) } : null);
export const swingLoadedSymbols = (): string[] => Object.keys(loaded).filter((k) => (loaded[k]?.candles.length ?? 0) >= 120);
/** Short candles for open trades only, so a stop or target touched between two checks is still seen. */
const exitBars: Record<string, { at: number; candles: Candle[] }> = {};
/** Deriv multipliers on offer per market. null = none, missing = not checked yet. */
const multOpts: Record<string, number[] | null> = {};
const multFailAt: Record<string, number> = {};
/** An entry is tried once per signal. A failed order is never retried by this loop. */
const attempted = new Set<string>();
const closeFailAt: Record<string, number> = {};
let derivBackoffUntil = 0;
let wake: (() => void) | null = null;
let forceReload = false;

/** Called by the Scan now button. */
export function scanSwingNow() {
  forceReload = true;
  wake?.();
}

const set = (p: Parameters<typeof useBrain.setState>[0]) => useBrain.setState(p);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function binanceBars(env: BinanceEnv, symbol: string, interval: string, limit: number): Promise<Candle[] | null> {
  try {
    const res = (await marketData({ data: { op: "klines", env, symbol, interval, limit } })) as { candles?: Candle[] };
    return res.candles?.length ? res.candles : null;
  } catch {
    return null;
  }
}

/** Deriv limits history requests, so they are paced by the caller. A rate-limit answer pauses all of them for a minute. */
async function derivBars(symbol: string, tf: string, count: number): Promise<Candle[] | null> {
  if (Date.now() < derivBackoffUntil) return null;
  try {
    const c = await deriv.candles(symbol, DERIV_GRANULARITY[tf] ?? 3600, count);
    return c.length ? c : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/rate limit|too many/i.test(msg)) derivBackoffUntil = Date.now() + 60_000;
    return null;
  }
}

/** One pass: manage open swing trades, refresh candles, scan, log signals, and (only when armed) enter. Returns true when more loading is pending. */
async function step(h: SwingHooks): Promise<boolean> {
  const st = useBrain.getState();
  const cfg = st.settings.swing;
  const binOn = st.conn.binance.status === "connected";
  const derOn = st.conn.deriv.status === "connected";
  const watching = st.swingArmed || st.view === "swing";
  const openSwing = st.positions.filter((p) => p.status === "open" && p.book === "swing");
  const env = st.settings.binanceEnv;
  const tfMs = swingTfMs(cfg.tf);

  // 1. Open swing trades first: they matter more than new ones. Exits run even when swing entries are switched off.
  if (openSwing.length) {
    for (const pos of openSwing) {
      // A Deriv contract holds its own stop loss and take profit: no candles are needed, only the time limit runs here.
      if (pos.protection === "contract-stake") continue;
      const cached = exitBars[pos.symbol];
      if (cached && Date.now() - cached.at < 25_000) continue;
      const isDer = isDerivSymbol(pos.symbol);
      const c = isDer ? (derOn ? await derivBars(pos.symbol, "15m", 100) : null) : binOn ? await binanceBars(env, pos.symbol, "15m", 100) : null;
      if (c) {
        exitBars[pos.symbol] = { at: Date.now(), candles: c };
        if (isDer) set((s) => ({ quotes: { ...s.quotes, [pos.symbol]: { ...(s.quotes[pos.symbol] ?? { bid: null, ask: null, chg: null }), last: c[c.length - 1]!.c } } }));
      }
    }
    for (const pos of openSwing) {
      if (h.forceClosing()) break;
      const fresh = useBrain.getState().positions.find((p) => p.id === pos.id);
      if (!fresh || fresh.status !== "open") continue;
      if (Date.now() - (closeFailAt[pos.id] ?? 0) < 120_000) continue;
      const bars = exitBars[pos.symbol]?.candles ?? [];
      const mark = useBrain.getState().quotes[pos.symbol]?.last ?? bars[bars.length - 1]?.c ?? null;
      const ex = swingExit(fresh, bars, mark, Date.now());
      if (!ex) continue;
      await h.close(fresh, ex.price, ex.reason);
      const after = useBrain.getState().positions.find((p) => p.id === pos.id);
      if (after?.status === "open") closeFailAt[pos.id] = Date.now();
    }
  }
  if (!watching) return false;
  if (!binOn && !derOn) {
    set({ swingView: { at: Date.now(), tf: cfg.tf, plan: null, loaded: 0, wanted: 0, note: "Connect Binance or Deriv on the Connect tab. Markets and candles come from your connected brokers.", error: "" } });
    return false;
  }

  // 2. Which markets: top Binance markets by volume (plus every gold, silver and other TradFi perpetual) and open Deriv markets, mixed across groups.
  const all = st.markets;
  const binList = binOn && cfg.markets !== "deriv" ? all.filter((m) => m.broker === "binance").sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0)) : [];
  const topBin = binList.slice(0, Math.max(1, Math.min(120, Math.round(cfg.topN))));
  const tradfi = binList.filter((m) => /TradFi/i.test(m.group) && !topBin.includes(m));
  const derList = derOn && cfg.markets !== "binance" ? mixByGroup(all.filter((m) => m.broker === "deriv" && m.open !== false)).slice(0, Math.max(1, Math.min(120, Math.round(cfg.derivMax)))) : [];
  const wantedBin = [...topBin, ...tradfi].map((m) => m.symbol);
  const wantedDer = derList.map((m) => m.symbol);

  // 3. Load candles: Binance in parallel, Deriv one at a time (it rate-limits history requests).
  const dueBin = wantedBin.filter((s) => forceReload || !loaded[s] || loaded[s]!.tf !== cfg.tf || Date.now() - loaded[s]!.at > Math.min(tfMs / 6, 180_000)).slice(0, 8);
  const dueDer = wantedDer.filter((s) => forceReload || !loaded[s] || loaded[s]!.tf !== cfg.tf || Date.now() - loaded[s]!.at > Math.min(tfMs / 4, 900_000)).slice(0, 4);
  forceReload = false;
  await Promise.all(
    dueBin.map(async (symbol) => {
      const c = await binanceBars(env, symbol, cfg.tf, SWING_HISTORY);
      if (c && useBrain.getState().settings.swing.tf === cfg.tf) loaded[symbol] = { tf: cfg.tf, at: Date.now(), candles: c };
      else if (!c) loaded[symbol] = { tf: cfg.tf, at: Date.now() - 150_000, candles: loaded[symbol]?.tf === cfg.tf ? loaded[symbol]!.candles : [] };
    }),
  );
  for (const symbol of dueDer) {
    if (Date.now() < derivBackoffUntil) break;
    const c = await derivBars(symbol, cfg.tf, SWING_HISTORY);
    if (c && useBrain.getState().settings.swing.tf === cfg.tf) loaded[symbol] = { tf: cfg.tf, at: Date.now(), candles: c };
    else loaded[symbol] = { tf: cfg.tf, at: Date.now() - 600_000, candles: loaded[symbol]?.tf === cfg.tf ? loaded[symbol]!.candles : [] };
    await sleep(1_200);
  }

  // 4. When orders go to Deriv, find out which markets sell a multiplier contract (cached six hours).
  if (useBrain.getState().settings.venue === "deriv" && derOn) {
    let n = 0;
    for (const symbol of wantedDer) {
      if (n >= 3) break;
      if (multOpts[symbol] !== undefined || Date.now() - (multFailAt[symbol] ?? 0) < 300_000 || (loaded[symbol]?.candles.length ?? 0) < 220) continue;
      n++;
      try {
        multOpts[symbol] = await deriv.multiplierOptions(symbol);
      } catch {
        multFailAt[symbol] = Date.now();
      }
      await sleep(800);
    }
  }

  const wantedAll = [...wantedBin, ...wantedDer];
  const have = wantedAll.filter((s) => loaded[s]?.tf === cfg.tf && loaded[s]!.candles.length >= 220).length;
  const pending = wantedAll.some((s) => !loaded[s] || loaded[s]!.tf !== cfg.tf);

  // 5. Plan. Entries only when armed and nothing is wrong with the account.
  const now = Date.now();
  const live = useBrain.getState();
  const venue = live.settings.venue;
  const sz = live.sizing;
  let halted: string | null = null;
  if (!sz) halted = "Account balance is not known yet.";
  else if (venue === "binance" && sz.source !== "binance") halted = "Real Binance balance is unknown or stale, so entries are blocked rather than sized from the paper book.";
  else if (venue === "deriv" && sz.source !== "deriv") halted = "Deriv is not authorized (add the App ID on the Connect tab), so entries are blocked.";
  else if (sz.gs.drawdownBreached) halted = sz.gs.reason;
  else if (!live.goalBypass && sz.gs.anyReached && live.settings.goal.onReach === "stop-entries") halted = "Profit goal reached, new entries are paused.";
  if (live.uncertain) halted = "Execution is uncertain after a broker answer. Check the broker, then reset on the Connect tab.";
  const armed = live.swingArmed && !h.forceClosing() && !live.uncertain;
  const futuresEnv = isFuturesEnv(env);
  const rows: SwingRowIn[] = wantedAll
    .map((symbol): SwingRowIn | null => {
      const l = loaded[symbol];
      if (!l || l.tf !== cfg.tf) return null;
      const info = marketInfo(symbol) ?? live.markets.find((m) => m.symbol === symbol);
      const kind = isDerivSymbol(symbol) ? "deriv" : "binance";
      const q = live.quotes[symbol];
      const f = live.filters[symbol];
      return {
        symbol,
        label: info?.label ?? symbol,
        group: info?.group ?? (kind === "deriv" ? "Deriv" : "Crypto"),
        kind,
        candles: l.candles,
        spreadPct: kind === "binance" && q?.bid && q.ask ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : null,
        tradable: l.candles.length >= 220 && (kind === "deriv" ? info?.open !== false : f ? f.status === "TRADING" : true),
        longOnly: kind === "binance" && venue === "binance" && !futuresEnv,
        step: f?.step,
        minNotional: f?.minNotional,
        derivMult: kind === "deriv" ? multOpts[symbol] : undefined,
      };
    })
    .filter((r): r is SwingRowIn => r != null);
  const plan = planSwing({
    gate: learnGate,
    now,
    cfg,
    armed,
    venue,
    rows,
    positions: live.positions,
    equity: sz?.equity ?? 0,
    cash: sz?.cash ?? 0,
    dayPnl: sz ? sz.equity - sz.dayStartEquity : 0,
    dayStartEquity: sz?.dayStartEquity ?? 0,
    dailyLossPct: live.settings.dailyLossPct,
    seen: live.seen,
    halted,
  });
  set({ swingView: { at: now, tf: cfg.tf, plan, loaded: have, wanted: wantedAll.length, note: plan.note + (halted ? ` Entries are blocked: ${halted}` : ""), error: "" } });

  // 6. Signal log: every actionable signal is kept (newest first, 60 max) so it can be copied to another broker even after the tab is closed.
  const known = new Set(useBrain.getState().swingLog.map((x) => x.key));
  const fresh = plan.signals.filter((s) => (s.status === "ready" || s.status === "signal") && !known.has(s.key));
  if (fresh.length) {
    set((s) => ({
      swingLog: [
        ...fresh.map((g) => ({ key: g.key, t: now, symbol: g.symbol, label: g.label, side: g.side, strategy: g.strategyName, entry: g.entry, stop: g.stop, target: g.target, text: signalText(g, cfg.riskPct) })),
        ...s.swingLog,
      ].slice(0, 60),
    }));
    for (const g of fresh.slice(0, 3)) useBrain.getState().log(`Signal: ${g.side} ${g.label} at ${g.entry.toPrecision(6)}, stop ${g.stop.toPrecision(6)}, target ${g.target.toPrecision(6)} (${g.strategyName}).`);
  }

  // 7. Send the entries, one at a time, each only once.
  for (const e of plan.entries) {
    const cur = useBrain.getState();
    if (!cur.swingArmed || cur.uncertain || h.forceClosing()) break;
    if (attempted.has(e.key)) continue;
    attempted.add(e.key);
    if (attempted.size > 400) attempted.clear();
    const where = e.venue === "paper" ? "the simulator" : e.venue === "deriv" ? cur.conn.deriv.label || "Deriv" : BINANCE_HOSTS[cur.settings.binanceEnv].label;
    cur.log(`Trades: ${e.side} ${e.symbol} (${e.reason}) risk ${e.lossAtStop.toFixed(2)}, holds up to ${Math.round((e.holdUntil - now) / 3_600_000)} h. Sending to ${where}.`);
    await h.open(e);
  }
  return pending;
}

export function startSwingLoop(h: SwingHooks): () => void {
  let stop = false;
  let running = false;
  let again = false;
  let timer = 0;
  const schedule = (ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void tick(), ms);
  };
  const tick = async () => {
    if (stop) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    let pending = false;
    try {
      pending = await step(h);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Trades loop error";
      const cfg = useBrain.getState().settings.swing;
      set((s) => ({ swingView: { at: Date.now(), tf: cfg.tf, plan: s.swingView?.plan ?? null, loaded: s.swingView?.loaded ?? 0, wanted: s.swingView?.wanted ?? 0, note: s.swingView?.note ?? "", error: msg } }));
    }
    running = false;
    const next = again || pending ? 2_500 : useBrain.getState().positions.some((p) => p.status === "open" && p.book === "swing") ? 20_000 : 30_000;
    again = false;
    schedule(next);
  };
  wake = () => schedule(150);
  schedule(2_500);
  const unsub = useBrain.subscribe((s, prev) => {
    const opened = s.view === "swing" && prev.view !== "swing";
    if (opened || s.swingArmed !== prev.swingArmed || s.settings.swing !== prev.settings.swing || s.settings.venue !== prev.settings.venue || s.conn.binance.status !== prev.conn.binance.status || s.conn.deriv.status !== prev.conn.deriv.status) schedule(200);
  });
  return () => {
    stop = true;
    wake = null;
    unsub();
    window.clearTimeout(timer);
  };
}
