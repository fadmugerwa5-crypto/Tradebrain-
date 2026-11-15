import { useState } from "react";
import { binanceSignTradfi } from "@/lib/brokers/api";
import { money, px } from "@/lib/format";
import { BINANCE_HOSTS, isFuturesEnv } from "@/lib/market/types";
import { unrealized } from "@/lib/trade/account";
import { SWING_DEFAULTS, SWING_STRATEGIES, SWING_TFS, signalText, type SwingSignal } from "@/lib/trade/swing";
import { useBrain } from "@/stores/brain";
import { scanSwingNow } from "./swing-engine";
import { closePositionNow } from "./use-engine";
import { Field, Num, Stat, labelOf } from "./ui";

const SESSIONS: { min: number; text: string }[] = [
  { min: 0, text: "00:00 UTC (crypto day, same as Binance's daily candle)" },
  { min: 480, text: "08:00 UTC (London open, winter time)" },
  { min: 810, text: "13:30 UTC (New York open, summer time)" },
  { min: 870, text: "14:30 UTC (New York open, winter time)" },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

function hoursLeft(until: number | undefined) {
  if (!until) return "no time limit";
  const h = (until - Date.now()) / 3_600_000;
  return h <= 0 ? "closing now" : h < 1 ? `${Math.round(h * 60)} min left` : `${h.toFixed(1)} h left`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Copies a signal as plain text, or opens the phone's share sheet (WhatsApp, Telegram, the other broker's app...). */
function CopyBtn({ text, label = "Copy signal" }: { text: string; label?: string }) {
  const [done, setDone] = useState("");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const flash = (m: string) => {
    setDone(m);
    window.setTimeout(() => setDone(""), 2500);
  };
  return (
    <span className="mt-2 flex flex-wrap gap-2">
      <button type="button" className="h-10 rounded-md border border-line px-3 text-xs" onClick={async () => flash((await copyText(text)) ? "Copied" : "Copy failed: select the text in 'How the trade works'")}>
        {done || label}
      </button>
      {canShare && (
        <button
          type="button"
          className="h-10 rounded-md border border-line px-3 text-xs"
          onClick={async () => {
            try {
              await navigator.share({ text });
            } catch {
              /* the person closed the share sheet */
            }
          }}
        >
          Share
        </button>
      )}
    </span>
  );
}

function CloseBtn({ id }: { id: string }) {
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
          await closePositionNow(id);
        } catch (err) {
          useBrain.getState().log(`Close failed: ${err instanceof Error ? err.message : "unknown error"}`, "warn");
        } finally {
          setStep("idle");
        }
      }}
    >
      {step === "busy" ? "Closing…" : step === "confirm" ? "Tap again to confirm" : "Close now"}
    </button>
  );
}

function SignalCard({ s, riskPct }: { s: SwingSignal; riskPct: number }) {
  const wouldTake = s.blocked.startsWith("Swing trading is not armed");
  const chip =
    s.status === "ready"
      ? { t: "Entering", c: "border-up text-up" }
      : wouldTake
        ? { t: "Would take", c: "border-accent text-accent" }
        : s.status === "signal"
          ? { t: "Signal only", c: "border-accent text-accent" }
          : { t: "Held back", c: "border-line text-faint" };
  const strat = SWING_STRATEGIES.find((x) => x.id === s.strategy);
  return (
    <li className="tb-card p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">
          {s.label} <span className={s.side === "BUY" ? "text-up" : "text-down"}>{s.side === "BUY" ? "LONG" : "SHORT"}</span>
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${chip.c}`}>{chip.t}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {s.strategyName} · entry {px(s.entry)} · stop {px(s.stop)} ({s.stopPct.toFixed(2)}%) · target {px(s.target)} ({s.rr}R)
      </p>
      <p className="mt-1 text-xs text-faint">
        Record on this market: {s.edge.trades} trades, {pct(s.edge.winRate)} won, {signed(s.edge.avgR)}R average after fees{s.edge.firstHalf != null && s.edge.secondHalf != null ? ` (earlier half ${signed(s.edge.firstHalf)}R, later half ${signed(s.edge.secondHalf)}R)` : ""}, worst run of {s.edge.worstStreak} losses in a row.
        {s.lossAtStop != null ? ` Risk if stopped: ${money(s.lossAtStop)}.` : ""}
      </p>
      {s.deriv && (
        <p className="mt-1 text-xs text-muted">
          Deriv multiplier x{s.deriv.multiplier}: stake {s.deriv.stake}, stop loss {s.deriv.stopLoss}, take profit {s.deriv.takeProfit}.
        </p>
      )}
      {s.blocked && !wouldTake && <p className="mt-1 text-xs text-warn">{s.blocked}</p>}
      {(s.status === "ready" || s.status === "signal") && <CopyBtn text={signalText(s, riskPct)} />}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer text-faint">How the trade works</summary>
        <ul className="mt-1 flex flex-col gap-1">
          {s.howTo.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {strat && <li className="text-faint">{strat.blurb}</li>}
        </ul>
      </details>
    </li>
  );
}

export function SwingTab() {
  const settings = useBrain((s) => s.settings);
  const patch = useBrain((s) => s.patchSettings);
  const conn = useBrain((s) => s.conn);
  const armed = useBrain((s) => s.swingArmed);
  const setArmed = useBrain((s) => s.setSwingArmed);
  const view = useBrain((s) => s.swingView);
  const positions = useBrain((s) => s.positions);
  const quotes = useBrain((s) => s.quotes);
  const setView = useBrain((s) => s.setView);
  const log = useBrain((s) => s.log);
  const secrets = useBrain((s) => s.secrets);
  const swingLog = useBrain((s) => s.swingLog);
  const [confirmLive, setConfirmLive] = useState(false);
  const [signStep, setSignStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [signMsg, setSignMsg] = useState("");
  const cfg = settings.swing;
  const setCfg = (p: Partial<typeof cfg>) => patch({ swing: { ...cfg, ...p } });
  const env = settings.binanceEnv;
  const host = BINANCE_HOSTS[env];
  const binOn = conn.binance.status === "connected";
  const derOn = conn.deriv.status === "connected";
  const venue = settings.venue;
  const live = (venue === "binance" && host.live) || (venue === "deriv" && !conn.deriv.demo);
  const locked = live && !settings.liveUnlock;

  const where =
    venue === "paper"
      ? { tone: "text-warn", text: "Orders are SIMULATED. Fills are calculated on Binance's real prices; nothing reaches the exchange. Switch Order execution on the Connect tab to Binance to place real orders." }
      : venue === "binance"
        ? live
          ? locked
            ? { tone: "text-warn", text: `${host.label} is locked. Type LIVE on the Connect tab before real-money orders can be sent.` }
            : { tone: "text-down", text: `LIVE: real money. Orders go to ${host.label}, each with an exchange-side stop and target.` }
          : { tone: "text-up", text: `Orders go to ${host.label} (demo money) with an exchange-side stop and target. Same order path as live.` }
        : locked
          ? { tone: "text-warn", text: "This Deriv account is REAL and locked. Type LIVE on the Connect tab before real-money contracts can be sent." }
          : conn.deriv.demo
            ? { tone: "text-up", text: "Orders go to Deriv (demo money) as multiplier contracts. Stop loss and take profit are part of the contract and held by Deriv, so they keep working with the app closed." }
            : { tone: "text-down", text: "LIVE: real money on Deriv, as multiplier contracts with a Deriv-held stop loss and take profit." };
  const connectedForVenue = venue === "paper" ? binOn || derOn : venue === "binance" ? binOn : derOn;
  const canArm = connectedForVenue && !locked;
  const needsConnect = !connectedForVenue || locked;
  const futures = isFuturesEnv(env);

  const open = positions.filter((p) => p.status === "open" && p.book === "swing");
  const closed = positions.filter((p) => p.status === "closed" && p.book === "swing");
  const wins = closed.filter((p) => (p.pnl ?? 0) > 0).length;
  const net = closed.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
  const openPnl = open.reduce((sum, p) => sum + unrealized(p, quotes[p.symbol]?.last ?? p.entry), 0);
  const signals = view?.plan?.signals ?? [];
  const byStrategy = new Map<string, { n: number; net: number }>();
  for (const p of closed) {
    const row = byStrategy.get(p.strategy) ?? { n: 0, net: 0 };
    row.n++;
    row.net += p.pnl ?? 0;
    byStrategy.set(p.strategy, row);
  }

  const toggleArm = () => {
    if (armed) {
      setArmed(false);
      setConfirmLive(false);
      log("Trades: swing entries are off. Open swing trades keep their stop and target.", "warn");
      return;
    }
    if (live && !confirmLive) {
      setConfirmLive(true);
      window.setTimeout(() => setConfirmLive(false), 8000);
      return;
    }
    setConfirmLive(false);
    setArmed(true);
    log(`Trades: swing entries are ON (${cfg.tf}, risk ${cfg.riskPct}% per trade, up to ${cfg.maxOpen} open).`);
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="tb-card p-4">
        <h2 className="text-base font-medium">Trades: real swing trades, not scalping</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Each trade is held for hours to days, with a stop and a target placed at the exchange, so they keep protecting it if this app is closed. A strategy may only trade a market if its own record on that market, after fees, is good enough. The scalper keeps running separately and never touches these trades.
        </p>
        <p className={`mt-2 text-xs leading-relaxed ${where.tone}`}>{where.text}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canArm && !armed}
            aria-pressed={armed}
            className={`h-12 rounded-md px-2 text-sm font-semibold disabled:opacity-40 ${armed ? "bg-up text-bg" : confirmLive ? "bg-down text-bg" : "bg-accent text-accent-fg"}`}
            onClick={toggleArm}
          >
            {armed ? "Swing trading: ON (tap to stop)" : confirmLive ? "Tap again: REAL MONEY" : "Start swing trading"}
          </button>
          <button type="button" className="h-12 rounded-md border border-line bg-elev-2 px-2 text-sm" onClick={() => (needsConnect ? setView("connect") : scanSwingNow())}>
            {needsConnect ? "Open Connect tab" : "Scan now"}
          </button>
        </div>
        {!binOn && !derOn && <p className="mt-2 text-xs text-warn">Connect Binance or Deriv on the Connect tab. Markets and candles come from them.</p>}
        <p className="mt-2 text-xs text-faint">Not ready to trade? Leave it off: signals still appear below as "Would take" or "Signal only", and each one has a Copy button so you can place it at any other broker.</p>
        <p className="mt-2 text-xs text-faint">Stopping here (or the Stop button above) only stops NEW entries. Open trades keep their stop and target. Close ALL closes them.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Open" value={String(open.length)} note={`${money(openPnl)} now`} tone={openPnl > 0 ? "up" : openPnl < 0 ? "down" : undefined} />
        <Stat label="Closed" value={String(closed.length)} note={closed.length ? `${pct(wins / closed.length)} won` : "none yet"} />
        <Stat label="Net" value={money(net)} note="after fees" tone={net > 0 ? "up" : net < 0 ? "down" : undefined} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Open swing trades</h2>
        {open.length === 0 && <p className="text-sm text-faint">None open.</p>}
        <ul className="flex flex-col gap-2">
          {open.map((p) => {
            const mark = quotes[p.symbol]?.last ?? p.entry;
            const u = unrealized(p, mark);
            return (
              <li key={p.id} className="rounded-lg border border-line bg-elev p-3 text-sm">
                <div className="flex justify-between">
                  <span>
                    {labelOf(p.symbol)} {p.side === "BUY" ? "long" : "short"} · {p.strategy.replace("swing:", "")}
                  </span>
                  <span className={u >= 0 ? "text-up" : "text-down"}>{money(u)}</span>
                </div>
                <p className="mt-1 text-xs text-faint">
                  Qty {p.qty} · entry {px(p.entry)} · stop {px(p.stop)} · target {px(p.target)} · {hoursLeft(p.holdUntil)}
                </p>
                <p className="text-xs text-faint">
                  {p.protection === "broker-confirmed"
                    ? `Stop and target are resting at Binance (${p.ocoListId}). The exchange keeps them even if this app is closed.`
                    : "Stop and target are watched by this app only. Keep it open."}
                  {p.venue === "paper" ? " Simulated." : ""}
                </p>
                <CloseBtn id={p.id} />
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Signals now ({cfg.tf})</h2>
          <p className="text-xs text-faint">{view ? `${view.loaded}/${view.wanted} markets loaded` : "starting"}</p>
        </div>
        <p className="mb-2 text-xs leading-relaxed text-muted">{view?.note ?? "Starting the first scan."}</p>
        {view?.error && <p className="mb-2 text-xs text-down">{view.error}</p>}
        {view?.plan && signals.length === 0 && view.plan.withData > 0 && <p className="text-sm text-faint">No strategy has a signal on the last closed candle. That is normal: these set-ups are not frequent.</p>}
        <ul className="flex flex-col gap-2">
          {signals.map((s) => (
            <SignalCard key={s.key} s={s} riskPct={cfg.riskPct} />
          ))}
        </ul>
      </div>

      <div className="rounded-md border border-line p-3">
        <h2 className="text-sm font-medium">Settings</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Candle timeframe">
            <select className="h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={cfg.tf} onChange={(e) => setCfg({ tf: e.target.value as typeof cfg.tf })}>
              {SWING_TFS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Trading day starts at">
            <select className="h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={cfg.sessionMin} onChange={(e) => setCfg({ sessionMin: Number(e.target.value) })}>
              {SESSIONS.map((o) => (
                <option key={o.min} value={o.min}>
                  {o.text}
                </option>
              ))}
            </select>
          </Field>
          <Num label="Risk per trade %" value={cfg.riskPct} onChange={(n) => setCfg({ riskPct: clamp(n, 0.05, 2) })} />
          <Num label="Max open swing trades" value={cfg.maxOpen} onChange={(n) => setCfg({ maxOpen: clamp(Math.round(n), 1, 10) })} />
          <Num label="Max combined risk %" value={cfg.maxTotalRiskPct} onChange={(n) => setCfg({ maxTotalRiskPct: clamp(n, 0.1, 10) })} />
          <Num label="Min reward to risk" value={cfg.minRR} onChange={(n) => setCfg({ minRR: clamp(n, 1, 5) })} />
          <Num label="Past trades needed on a market" value={cfg.minTrades} onChange={(n) => setCfg({ minTrades: clamp(Math.round(n), 0, 60) })} />
          <Num label="Min average result per trade (R, after fees)" value={cfg.minEdge} onChange={(n) => setCfg({ minEdge: clamp(n, -1, 2) })} />
          <Field label="Which markets to scan">
            <select className="h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={cfg.markets} onChange={(e) => setCfg({ markets: e.target.value as typeof cfg.markets })}>
              <option value="both">Binance and Deriv</option>
              <option value="binance">Binance only</option>
              <option value="deriv">Deriv only (forex, gold, silver, indices...)</option>
            </select>
          </Field>
          <Num label="Binance markets (top by volume; gold and silver always added)" value={cfg.topN} onChange={(n) => setCfg({ topN: clamp(Math.round(n), 3, 120) })} />
          <Num label="Deriv markets (open ones, mixed across groups)" value={cfg.derivMax} onChange={(n) => setCfg({ derivMax: clamp(Math.round(n), 3, 120) })} />
          <Num label="Pause 24 h after this many losses in a row" value={cfg.pauseAfter} onChange={(n) => setCfg({ pauseAfter: clamp(Math.round(n), 1, 10) })} />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" aria-pressed={cfg.dailyTrendFilter} className={`min-h-11 rounded-md border px-3 py-2 text-left text-xs ${cfg.dailyTrendFilter ? "border-accent text-fg" : "border-line text-faint"}`} onClick={() => setCfg({ dailyTrendFilter: !cfg.dailyTrendFilter })}>
            Only trade with the daily trend: {cfg.dailyTrendFilter ? "ON" : "OFF"}. Longs only when the daily trend is up, shorts only when it is down. Needs about 25 days of candles, otherwise it does not judge (15m candles load too few).
          </button>
          <button type="button" aria-pressed={cfg.requireStable} className={`min-h-11 rounded-md border px-3 py-2 text-left text-xs ${cfg.requireStable ? "border-accent text-fg" : "border-line text-faint"}`} onClick={() => setCfg({ requireStable: !cfg.requireStable })}>
            Steady record required: {cfg.requireStable ? "ON" : "OFF"}. A strategy must be positive in BOTH the earlier and the later half of its past trades on that market, not just overall.
          </button>
        </div>
        <h3 className="mt-3 text-xs font-medium text-muted">Strategies</h3>
        <div className="mt-1 flex flex-wrap gap-2">
          {SWING_STRATEGIES.map((s) => {
            const on = cfg.strategies.includes(s.id);
            const fits = s.tfs.includes(cfg.tf);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                className={`h-10 rounded-full border px-3 text-xs ${on && fits ? "border-accent text-fg" : "border-line text-faint"}`}
                onClick={() => setCfg({ strategies: on ? cfg.strategies.filter((x) => x !== s.id) : [...cfg.strategies, s.id] })}
              >
                {s.name}
                {!fits ? ` (not for ${cfg.tf})` : ""}
              </button>
            );
          })}
        </div>
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer text-faint">What each strategy does, and where it comes from</summary>
          <ul className="mt-1 flex flex-col gap-2">
            {SWING_STRATEGIES.map((s) => (
              <li key={s.id}>
                <span className="text-fg">{s.name}</span> ({s.rr}R target, held up to {s.maxHours} h). {s.blurb} <span className="text-faint">{s.source}</span>
              </li>
            ))}
          </ul>
        </details>
        <button type="button" className="mt-3 h-11 rounded-md border border-line px-3 text-sm" onClick={() => patch({ swing: { ...SWING_DEFAULTS, strategies: [...SWING_DEFAULTS.strategies] } })}>
          Reset these settings
        </button>
      </div>

      {binOn && futures && (
        <div className="rounded-md border border-line p-3">
          <h2 className="text-sm font-medium">Gold, silver and other TradFi markets (Binance Futures)</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Binance only lets an account trade these (XAUUSDT, XAGUSDT...) after the TradFi-Perps agreement is signed once. If you have not signed it, orders on them are refused. The button below sends the signature for THIS Binance account, using your API key. It does not sign anything by itself: you tap it, and you confirm.
          </p>
          <button
            type="button"
            disabled={signStep === "busy" || !secrets.binanceKey || !secrets.binanceSecret}
            className={`mt-2 h-11 rounded-md border px-3 text-sm disabled:opacity-40 ${signStep === "confirm" ? "border-down text-down" : "border-line"}`}
            onClick={async () => {
              if (signStep === "idle") {
                setSignStep("confirm");
                setSignMsg("");
                window.setTimeout(() => setSignStep((c) => (c === "confirm" ? "idle" : c)), 10_000);
                return;
              }
              setSignStep("busy");
              try {
                const r = await binanceSignTradfi({ data: { env, apiKey: secrets.binanceKey, secret: secrets.binanceSecret } });
                setSignMsg(r.ok ? "Signed. Gold, silver and the other TradFi markets can now be traded on this account." : `Not signed: ${r.error}`);
                log(r.ok ? "Binance TradFi-Perps agreement signed for this account." : `TradFi-Perps agreement not signed: ${r.error}`, r.ok ? "info" : "warn");
              } catch (err) {
                setSignMsg(`Not signed: ${err instanceof Error ? err.message : "unknown error"}`);
              } finally {
                setSignStep("idle");
              }
            }}
          >
            {signStep === "busy" ? "Signing…" : signStep === "confirm" ? "Tap again: I accept Binance's TradFi-Perps agreement" : "Sign the TradFi-Perps agreement"}
          </button>
          {signMsg && <p className={`mt-2 text-xs ${signMsg.startsWith("Signed") ? "text-up" : "text-warn"}`}>{signMsg}</p>}
          <p className="mt-2 text-xs text-faint">Needs an API key with Futures permission. Not available on every account or region, and not on portfolio-margin accounts from here. Binance may also limit these markets to certain trading hours.</p>
        </div>
      )}

      {swingLog.length > 0 && (
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">Saved signals ({swingLog.length})</summary>
          <p className="mt-1 text-xs text-faint">Every actionable signal is kept here, newest first, so you can copy it to another broker even after the tab was closed. Check the live price before using an old one.</p>
          <CopyBtn text={swingLog.slice(0, 10).map((x) => x.text).join("\n\n----------\n\n")} label="Copy the latest 10" />
          <ul className="mt-2 flex flex-col gap-2">
            {swingLog.map((x) => (
              <li key={x.key} className="rounded-md border border-line p-2 text-xs">
                <span className="text-fg">
                  {x.label} <span className={x.side === "BUY" ? "text-up" : "text-down"}>{x.side === "BUY" ? "LONG" : "SHORT"}</span>
                </span>{" "}
                <span className="text-faint">{new Date(x.t).toLocaleString()} · {x.strategy}</span>
                <p className="mt-1 text-muted">
                  entry {px(x.entry)} · stop {px(x.stop)} · target {px(x.target)}
                </p>
                <CopyBtn text={x.text} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {closed.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Results by strategy</h2>
          <ul className="mb-3 text-sm text-muted">
            {[...byStrategy.entries()].map(([name, row]) => (
              <li key={name}>
                {name.replace("swing:", "")}: {row.n} trades, {money(row.net)}
              </li>
            ))}
          </ul>
          <h2 className="mb-2 text-sm font-medium">Recently closed</h2>
          <ul className="flex flex-col gap-2">
            {closed
              .slice(-8)
              .reverse()
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {labelOf(p.symbol)} · {p.exitReason}
                  </span>
                  <span className={(p.pnl ?? 0) >= 0 ? "text-up" : "text-down"}>{money(p.pnl ?? 0)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-faint">
        Deriv trades use multiplier contracts (Deriv must offer one on that market; otherwise it stays a signal). A strategy's record is how it did on this market's last ~1000 candles, with fees and slippage taken off. It is not a forecast, and the same strategy can lose for weeks. Signals are read only on closed candles. The time limit and the app-side stop run only while this app is open; an exchange-held stop and target do not need it.
      </p>
    </section>
  );
}
