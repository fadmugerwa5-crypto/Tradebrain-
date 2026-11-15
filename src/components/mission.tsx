import { useMemo } from "react";
import { BINANCE_HOSTS } from "@/lib/market/types";
import { ago, money } from "@/lib/format";
import { equityOf, unrealized } from "@/lib/trade/account";
import { evalGoal, realizedSince, startOfUtcDay } from "@/lib/trade/goal";
import { useBrain } from "@/stores/brain";
import { NoBroker, Stat, labelOf } from "./ui";
import { RadarPanel } from "./radar-panel";
import { Signal } from "./signal";

export function Mission() {
  const account = useBrain((s) => s.account);
  const positions = useBrain((s) => s.positions);
  const quotes = useBrain((s) => s.quotes);
  const settings = useBrain((s) => s.settings);
  const decisions = useBrain((s) => s.decisions);
  const armed = useBrain((s) => s.armed);
  const lossPause = useBrain((s) => s.lossPause);
  const uncertain = useBrain((s) => s.uncertain);
  const feedAt = useBrain((s) => s.feedAt);
  const sizing = useBrain((s) => s.sizing);
  const peak = useBrain((s) => s.peakEquity);
  const setView = useBrain((s) => s.setView);
  const marks = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(quotes)) m[k] = v.last;
    return m;
  }, [quotes]);
  const open = positions.filter((p) => p.status === "open");
  const paperUnreal = open.reduce((s, p) => s + (p.venue === "deriv" ? (p.livePnl ?? 0) : unrealized(p, marks[p.symbol] ?? p.entry)), 0);
  // Prefer what the engine is really sizing against (broker balances); fall back to the paper book.
  const equity = sizing?.equity ?? equityOf(account, positions, marks);
  const cash = sizing?.cash ?? account.cash;
  const startEquity = sizing?.startEquity ?? account.startEquity;
  const dayStart = sizing?.dayStartEquity ?? account.dayStartEquity;
  const gs = sizing?.gs ?? evalGoal({ goal: settings.goal, positions, account, equity, peakEquity: peak, unrealized: paperUnreal, now: Date.now() });
  const source = sizing?.source ?? "paper";
  const realizedAll = positions.filter((p) => p.status === "closed").reduce((s, p) => s + (p.pnl ?? 0), 0);
  const exposure = open.reduce((s, p) => s + (p.venue === "deriv" ? p.plannedRisk : p.qty * p.entry), 0);
  const realizedToday = realizedSince(positions, startOfUtcDay(Date.now()));
  const openPnl = sizing?.unrealized ?? paperUnreal;
  // What the account really moved today versus what the app recorded. A gap means trades the app did not record.
  const gap = equity - dayStart - realizedToday - openPnl;
  const gapNote = source !== "paper" && Math.abs(gap) >= 0.5 ? ` · not in the app's records ${money(gap)}` : "";
  const openRisk = open.reduce((s, p) => s + p.plannedRisk, 0);
  const ranked = Object.entries(decisions).sort((a, b) => b[1].quality - a[1].quality).slice(0, 5);
  const conn = useBrain((s) => s.conn);
  const envLabel = settings.venue === "binance" ? BINANCE_HOSTS[settings.binanceEnv].label : settings.venue === "deriv" ? conn.deriv.label || "Deriv" : "Simulated orders";
  const live = (settings.venue === "binance" && BINANCE_HOSTS[settings.binanceEnv].live) || (settings.venue === "deriv" && conn.deriv.status === "connected" && !conn.deriv.demo);
  const status = uncertain
    ? "Stopped: execution is uncertain. Check the broker before resuming."
    : !armed
      ? "Scanning only. New entries are off."
      : gs.blocks
        ? `Armed but paused: ${gs.reason}`
        : lossPause
          ? "Armed but paused after consecutive losses."
          : "Scanning and entering when the risk engine approves.";
  return (
    <section className="flex flex-col gap-4">
      <Signal />
      {conn.binance.status !== "connected" && conn.deriv.status !== "connected" && <NoBroker what="Live market data" />}
      <div className={`tb-card p-3 text-sm ${live ? "border-down" : ""}`}>
        <p>
          <span className="text-muted">Environment</span> {envLabel}
          {live ? " · REAL MONEY" : ""} · <span className="text-muted">Mode</span> {settings.mode === "mad" ? "MADBOT" : settings.mode} · <span className="text-muted">Data</span> {ago(feedAt)}
        </p>
        <p className="mt-1 text-muted">{status}</p>
      </div>
      {!armed && !uncertain && (
        <div className="flex items-center justify-between gap-3 tb-card border-warn/50 p-3">
          <p className="text-sm text-muted">No orders are placed while auto-trading is off. Turn it on to let the {settings.mode === "mad" ? "MADBOT" : settings.mode} mode send orders to {envLabel}.</p>
          <button type="button" className="h-11 shrink-0 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg" onClick={() => useBrain.getState().setArmed(true)}>
            Arm now
          </button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={source === "paper" ? "Paper equity" : `${source === "binance" ? "Binance" : "Deriv"} equity`} value={money(equity)} note={`Started ${money(startEquity)} · cash ${money(cash)}`} />
        <Stat label="Day change" value={money(equity - dayStart)} note={`Realized today ${money(realizedToday)} · open ${money(openPnl)} · fees ${money(gs.fees)}${gapNote}`} tone={equity - dayStart >= 0 ? "up" : "down"} />
        <Stat label="Exposure" value={money(exposure)} note={`${open.length} open · planned risk ${money(openRisk)} (${equity > 0 ? ((openRisk / equity) * 100).toFixed(2) : "0"}%)`} />
      </div>

      <div className="tb-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Profit goal</h2>
          <button type="button" className="text-sm text-muted" onClick={() => setView("controls")}>
            Edit
          </button>
        </div>
        {gs.rows.length === 0 && <p className="text-sm text-faint">No target set. Add one in Controls. Targets count realized results only.</p>}
        <ul className="flex flex-col gap-3">
          {gs.rows.map((r) => (
            <li key={r.key}>
              <div className="flex justify-between text-sm">
                <span>
                  {r.label} {r.reached ? "· reached" : ""}
                </span>
                <span className="text-muted">
                  {money(r.realized)} of {money(r.target)} · {money(r.remaining)} left
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-md bg-elev-2">
                <div className="h-full bg-accent" style={{ width: `${r.progress * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Drawdown from peak {gs.drawdownPct.toFixed(2)}% (limit {settings.goal.maxDrawdownPct > 0 ? `${settings.goal.maxDrawdownPct}%` : "off"}). Unrealized {money(gs.unrealized)} is shown separately and never counts toward a target.
          {gs.reason ? ` ${gs.reason}` : ""}
        </p>
      </div>

      <RadarPanel />
      <div className="tb-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Latest signals</h2>
          <button type="button" className="text-sm text-muted" onClick={() => setView("markets")}>
            All markets
          </button>
        </div>
        {ranked.length === 0 && <p className="text-sm text-faint">The scanner is still loading candles.</p>}
        <ul className="flex flex-col">
          {ranked.map(([sym, d]) => (
            <li key={sym} className="flex items-center justify-between gap-3 border-t border-line py-3 text-sm">
              <span>{labelOf(sym)}</span>
              <span className={d.action === "BUY" ? "text-up" : d.action === "SELL" ? "text-down" : "text-muted"}>
                {d.action} {d.quality}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs leading-relaxed text-faint">
        The controller runs only while this page is open. Closing it stops scanning and any locally watched exits; only stops and targets that Binance confirmed as resting orders keep working. Nothing here has been shown to be profitable, and reaching a target is never promised.
      </p>
    </section>
  );
}
