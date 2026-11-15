import { useEffect, useMemo, useState } from "react";
import { money, px } from "@/lib/format";
import { setKeepAlive } from "@/lib/keepalive";
import { unrealized } from "@/lib/trade/account";
import { useBrain, type ViewName } from "@/stores/brain";
import { ChartPage } from "./chart-page";
import { Connect } from "./connect-tab";
import { LearnTab } from "./learn-tab";
import { HiveTab } from "./hive-tab";
import { useHive } from "@/stores/hive";
import { startLearning } from "@/lib/learn/watch";
import { closeAllNow, closePositionNow, forceCloseEverything, useEngine } from "./use-engine";
import { NoBroker, Stat, labelOf } from "./ui";
import { Logo } from "./logo";
import { IntelligenceTab } from "./intelligence-tab";
import { WatchtowerTab } from "./watchtower-tab";

const NAV: { id: ViewName; label: string; icon: string }[] = [
  { id: "hive", label: "Home", icon: "M12 2l8 4.5v9L12 20l-8-4.5v-9zM12 8v4l3 2" },
  { id: "markets", label: "Markets", icon: "M4 20V10M10 20V4M16 20v-8M22 20H2" },
  { id: "chart", label: "Chart", icon: "M3 17l5-6 4 3 8-9" },
  { id: "learn", label: "Learn", icon: "M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11zM9 21h6" },
  { id: "intelligence", label: "Intel", icon: "M12 2a7 7 0 0 0-4 12.75V18h8v-3.25A7 7 0 0 0 12 2zM9 22h6M9 18h6" },
  { id: "watchtower", label: "Watchtower", icon: "M3 21h18M5 21V9l7-6 7 6v12M9 21v-7h6v7M12 3v4" },
  { id: "journal", label: "Journal", icon: "M6 3h12v18H6zM9 8h6M9 12h6" },
  { id: "connect", label: "Connect", icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
];

export function Terminal() {
  useEngine();
  useEffect(() => {
    const t = setTimeout(startLearning, 1500);
    return () => clearTimeout(t);
  }, []);
  const view = useBrain((s) => s.view);
  const setView = useBrain((s) => s.setView);
  const armed = useBrain((s) => s.armed);
  const swingArmed = useBrain((s) => s.swingArmed);
    const emergency = useBrain((s) => s.emergency);
  const log = useBrain((s) => s.log);
  const feedNote = useBrain((s) => s.feedNote);
  const conn = useBrain((s) => s.conn);
  const connected = [conn.binance, conn.deriv].filter((c) => c.status === "connected");
  const hiveArmed = useHive((s) => s.armed);
  useEffect(() => {
    void setKeepAlive(armed || swingArmed || hiveArmed);
  }, [armed, swingArmed, hiveArmed]);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-white/70 bg-white/70 backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 pt-3">
          <Logo size={36} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight tracking-tight">TradeBrain</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {connected.length === 0 ? (
                <button type="button" className="text-warn underline underline-offset-2" onClick={() => setView("connect")}>
                  No broker connected
                </button>
              ) : (
                connected.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${c.demo ? "bg-up" : "bg-warn"}`} aria-hidden="true" />
                    {c.label}
                  </span>
                ))
              )}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pt-3">
          <button
            type="button"
            className="h-11 rounded-full border border-line bg-white px-2 text-sm font-medium text-fg"
            onClick={() => {
              emergency();
              useHive.getState().setArmed(false);
              log("Stop pressed. The colony is asleep and new entries are off. Open positions were not closed (use Close ALL for that).", "warn");
            }}
          >
            Stop everything
          </button>
          <ForceCloseButton />
        </div>
        <p className="px-4 pb-3 pt-2 text-xs leading-relaxed text-muted">{feedNote}</p>
      </header>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 md:grid-cols-[180px_1fr]">
        <nav className="hidden flex-col gap-1 md:flex">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`flex h-11 items-center gap-3 rounded-md border px-3 text-left text-sm ${view === item.id ? "border-accent bg-accent font-medium text-accent-fg" : "border-line bg-elev text-muted"}`}
            >
              <Icon d={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <main className="min-w-0 pb-28">
          {view === "hive" && <HiveTab />}
          {view === "markets" && <Markets />}
          {view === "chart" && <ChartPage />}
          {view === "journal" && <Journal />}
          {view === "learn" && <LearnTab />}
          {view === "intelligence" && <IntelligenceTab />}
          {view === "watchtower" && <WatchtowerTab />}
          {view === "connect" && <Connect />}
        </main>
      </div>
      <nav className="fixed inset-x-2 bottom-2 z-20 grid grid-cols-8 rounded-3xl border border-white/80 bg-white/80 px-1 pb-[env(safe-area-inset-bottom,0px)] pt-1 shadow-[0_10px_30px_rgba(15,39,68,0.18)] backdrop-blur-md md:hidden" aria-label="Sections">
        {NAV.map((item) => (
          <button key={item.id} type="button" aria-current={view === item.id ? "page" : undefined} className={`flex h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] ${view === item.id ? "bg-accent/10 font-medium text-accent" : "text-faint"}`} onClick={() => setView(item.id)}>
            <Icon d={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Markets() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("All");
  const settings = useBrain((s) => s.settings);
  const patch = useBrain((s) => s.patchSettings);
  const markets = useBrain((s) => s.markets);
  const quotes = useBrain((s) => s.quotes);
  const decisions = useBrain((s) => s.decisions);
  const setSymbol = useBrain((s) => s.setSymbol);
  const groups = useMemo(() => ["All", ...[...new Set(markets.map((m) => m.group))]], [markets]);
  if (markets.length === 0) return <NoBroker what="Markets" />;
  const needle = q.trim().toLowerCase();
  const rows = markets.filter((m) => (group === "All" || m.group === group) && (!needle || `${m.symbol} ${m.label} ${m.group}`.toLowerCase().includes(needle)));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium">Markets</h2>
        <p className="text-xs text-muted">
          {markets.length} from your broker · {settings.enabled.length} scanned by the bot
        </p>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets" className="h-11 rounded-md border border-line bg-elev px-3 text-sm text-fg outline-none" />
      <div className="flex gap-1 overflow-x-auto pb-1">
        {groups.map((g) => (
          <button key={g} type="button" className={`h-9 shrink-0 rounded-full border px-3 text-xs ${group === g ? "border-accent bg-elev-2 text-fg" : "border-line text-muted"}`} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>
      <ul className="overflow-hidden rounded-lg border border-line bg-elev">
        {rows.map((m) => {
          const quote = quotes[m.symbol];
          const d = decisions[m.symbol];
          const on = settings.enabled.includes(m.symbol);
          const spread = quote?.bid && quote.ask ? ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100 : null;
          return (
            <li key={m.symbol} className="flex items-stretch border-t border-line first:border-t-0">
              <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-3 text-left" onClick={() => setSymbol(m.symbol)}>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{m.label}</span>
                  <span className="block truncate text-xs text-faint">
                    {m.group}
                    {m.open === false ? " · market closed" : ""}
                    {spread != null ? ` · spread ${spread.toFixed(3)}%` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm">{quote ? px(quote.last) : "—"}</span>
                  <span className="block text-xs">
                    {quote?.chg != null && <span className={quote.chg >= 0 ? "text-up" : "text-down"}>{quote.chg >= 0 ? "+" : ""}{quote.chg.toFixed(2)}% </span>}
                    <span className={d?.action === "BUY" ? "text-up" : d?.action === "SELL" ? "text-down" : "text-faint"}>{d ? `${d.action} ${d.quality}` : on ? "Scanning" : "Chart only"}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${on ? "Stop scanning" : "Scan"} ${m.label} with the bot`}
                className={`w-16 shrink-0 border-l border-line text-xs ${on ? "text-fg" : "text-faint"}`}
                onClick={() => patch({ autoAll: false, enabled: on ? settings.enabled.filter((x) => x !== m.symbol) : [...settings.enabled, m.symbol] })}
              >
                {on ? "Bot on" : "Bot off"}
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="text-sm text-faint">No market matches that search.</p>}
    </section>
  );
}

function ForceCloseButton() {
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [result, setResult] = useState<string>("");
  const openCount = useBrain((st) => st.positions.filter((p) => p.status === "open").length);
  const run = async () => {
    setStep("busy");
    setResult("");
    try {
      const left = await forceCloseEverything();
      setResult(left === 0 ? "Everything is closed. Auto-trading is off." : `${left} position(s) could not be closed. See the Journal for the reason.`);
    } catch (err) {
      setResult(`Close ALL failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setStep("idle");
      window.setTimeout(() => setResult(""), 9000);
    }
  };
  return (
    <>
      <button type="button" disabled={step === "busy"} className="h-11 rounded-md border border-down px-2 text-sm font-semibold text-down disabled:opacity-60" onClick={() => setStep("confirm")}>
        {step === "busy" ? "Closing…" : "Close ALL"}
      </button>
      {step === "confirm" && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="tb-rise w-full max-w-sm rounded-lg border border-line bg-elev p-5">
            <h2 className="text-base font-semibold">Close every open trade?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {openCount > 0 ? `${openCount} open position${openCount === 1 ? "" : "s"} will be closed at the current price.` : "No open positions are recorded in the app."} Auto-trading is switched off first
              {" "}so nothing new opens. On Deriv, any other open contract on the account is sold too.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="h-12 rounded-md border border-line bg-elev-2 text-sm" onClick={() => setStep("idle")}>
                Cancel
              </button>
              <button type="button" className="h-12 rounded-md bg-down text-sm font-semibold text-bg" onClick={() => void run()}>
                Yes, close all
              </button>
            </div>
          </div>
        </div>
      )}
      {result && (
        <div className="tb-rise fixed inset-x-4 bottom-20 z-40 rounded-md border border-line bg-elev px-4 py-3 text-sm shadow-lg" role="status" onClick={() => setResult("")}>
          {result}
        </div>
      )}
    </>
  );
}

function CloseButton({ id, label = "Close now" }: { id: string; label?: string }) {
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  return (
    <button
      type="button"
      disabled={step === "busy"}
      className={`mt-2 h-11 rounded-md border px-3 text-sm ${step === "confirm" ? "border-down text-down" : "border-line text-fg"}`}
      onClick={async () => {
        if (step === "idle") {
          setStep("confirm");
          window.setTimeout(() => setStep((cur) => (cur === "confirm" ? "idle" : cur)), 8000);
          return;
        }
        setStep("busy");
        try {
          await (id === "all" ? closeAllNow() : closePositionNow(id));
        } catch (err) {
          useBrain.getState().log(`Close failed: ${err instanceof Error ? err.message : "unknown error"}`, "warn");
        } finally {
          setStep("idle");
        }
      }}
    >
      {step === "busy" ? "Closing…" : step === "confirm" ? "Tap again to confirm" : label}
    </button>
  );
}

function Book() {
  const positions = useBrain((s) => s.positions);
  const quotes = useBrain((s) => s.quotes);
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed").slice(-12).reverse();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Open</h2>
        {open.length > 1 && <CloseButton id="all" label="Close all" />}
      </div>
      {open.length === 0 && <p className="text-sm text-faint">No open positions.</p>}
      <ul className="flex flex-col gap-2">
        {open.map((p) => {
          const mark = quotes[p.symbol]?.last ?? p.entry;
          const isContract = p.venue === "deriv";
          const u = isContract ? (p.livePnl ?? 0) : unrealized(p, mark);
          return (
            <li key={p.id} className="rounded-lg border border-line bg-elev p-3 text-sm">
              <div className="flex justify-between">
                <span>{labelOf(p.symbol)} {p.side}</span>
                <span className={u >= 0 ? "text-up" : "text-down"}>{money(u)}</span>
              </div>
              {isContract ? (
                <p className="mt-1 text-xs text-faint">
                  {p.book === "swing"
                    ? `Swing trade: ${p.durLabel ?? "Multiplier"} ${p.side === "BUY" ? "up" : "down"} from ${px(p.entry)}. Stake ${money(p.plannedRisk)} · worth now ${money(p.liveValue ?? p.plannedRisk)}. Deriv holds the stop loss (about ${px(p.stop)}) and take profit (about ${px(p.target)}). Close now sells it at Deriv's current price.`
                    : `Stake ${money(p.plannedRisk)} · worth now ${money(p.liveValue ?? p.plannedRisk)} · ${p.durLabel ?? "5-minute"} ${p.side === "BUY" ? "CALL" : "PUT"} from ${px(p.entry)}. The most you can lose is the stake. Close now sells it at Deriv's current price.`}
                </p>
              ) : (
                <p className="mt-1 text-xs text-faint">
                  Qty {p.qty} · entry {px(p.entry)} · stop {px(p.stop)} · target {px(p.target)}
                </p>
              )}
              <p className="text-xs text-faint">
                {p.protection === "broker-confirmed"
                  ? `Stop and target are resting at Binance (order list ${p.ocoListId}). Confirmed by the broker.`
                  : p.protection === "local-monitor"
                  ? "Stop and target are watched by this page. They are not resting orders at the broker."
                  : p.protection === "contract-stake"
                    ? `Deriv contract ${p.brokerOrderId}.`
                    : p.protection}
                {p.brokerOrderId && !isContract ? ` · id ${p.brokerOrderId}` : ""}
                {p.aiNote ? ` · AI: ${p.aiNote}` : ""}
              </p>
              <CloseButton id={p.id} />
            </li>
          );
        })}
      </ul>
      <h2 className="text-lg font-medium">Recently closed</h2>
      <ul className="flex flex-col gap-2">
        {closed.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
            <span>{labelOf(p.symbol)} · {p.exitReason}</span>
            <span className={(p.pnl ?? 0) >= 0 ? "text-up" : "text-down"}>{money(p.pnl ?? 0)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Journal() {
  const positions = useBrain((s) => s.positions);
  const logs = useBrain((s) => s.logs);
  const closed = positions.filter((p) => p.status === "closed" && p.pnl != null);
  const wins = closed.filter((p) => (p.pnl ?? 0) > 0);
  const net = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const p of closed) {
    eq += p.pnl ?? 0;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const byStrategy = new Map<string, { n: number; net: number }>();
  for (const p of closed) {
    const row = byStrategy.get(p.strategy) ?? { n: 0, net: 0 };
    row.n++;
    row.net += p.pnl ?? 0;
    byStrategy.set(p.strategy, row);
  }
  return (
    <section className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Closed" value={String(closed.length)} note={`${closed.length ? Math.round((wins.length / closed.length) * 100) : 0}% wins`} />
        <Stat label="Net" value={money(net)} note="After modeled paper fees" />
        <Stat label="Max drawdown" value={money(dd)} note="On closed paper results" />
      </div>
      <ul className="text-sm text-muted">
        {[...byStrategy.entries()].map(([name, row]) => (
          <li key={name}>
            {name}: {row.n} trades, {money(row.net)}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-2">
        {logs.map((l, i) => (
          <li key={`${l.t}-${i}`} className="text-xs text-faint">
            <span className={l.level === "bad" ? "text-down" : l.level === "warn" ? "text-warn" : "text-muted"}>{new Date(l.t).toLocaleTimeString()}</span> {l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
