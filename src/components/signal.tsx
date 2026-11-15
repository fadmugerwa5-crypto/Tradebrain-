import { useEffect, useMemo, useState } from "react";
import { takeReadings, type Tone } from "@/lib/market/readings";
import { useBrain } from "@/stores/brain";
import { Logo } from "./logo";
import { labelOf } from "./ui";

const TONE: Record<Tone, string> = { up: "text-up", down: "text-down", flat: "text-muted" };
const TOTAL = 8;

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

const SHOW = 40;

/** The "Signal" analyzer: opens by sweeping every market the bot scans, shows each one as it really loads and gets its verdict, then the best setup. */
export function Signal() {
  const symbol = useBrain((s) => s.symbol);
  const setView = useBrain((s) => s.setView);
  const markets = useBrain((s) => s.markets);
  const enabled = useBrain((s) => s.settings.enabled);
  const interval = useBrain((s) => s.settings.interval);
  const rsiPeriod = useBrain((s) => s.settings.ind.rsiPeriod);
  const allCandles = useBrain((s) => s.candles);
  const decisions = useBrain((s) => s.decisions);
  const radar = useBrain((s) => s.radar);
  const aiSlots = useBrain((s) => s.ai);
  const ai = (["gemini", "grok", "other"] as const).map((k) => aiSlots[k]).find((a) => a.status === "ready");
  const aiName = ai ? ai.model || ai.provider || "AI" : "Rules engine";
  const candles = allCandles[symbol];
  const ready = !!candles && candles.length >= 30;
  const readings = useMemo(() => (ready ? takeReadings(candles!, interval, rsiPeriod) : []), [ready, candles, interval, rsiPeriod]);

  // The markets being scanned: the ones switched on for the bot that the broker really lists.
  const list = useMemo(() => {
    const known = new Set(markets.map((m) => m.symbol));
    const syms = enabled.filter((x) => known.has(x));
    return syms.length ? syms : known.has(symbol) ? [symbol] : [];
  }, [markets, enabled, symbol]);
  const sigMap = useMemo(() => new Map((radar?.shortlist ?? []).map((c) => [c.symbol, { side: c.side as string, score: c.score }])), [radar]);
  const rows = useMemo(
    () =>
      list.map((sym) => {
        const n = allCandles[sym]?.length ?? 0;
        const d = decisions[sym];
        const sig = sigMap.get(sym);
        // "Loaded" means enough candles for the engine to analyse it (the same rule the radar uses).
        const side = d && (d.action === "BUY" || d.action === "SELL") ? d.action : sig ? sig.side : null;
        const score = d && (d.action === "BUY" || d.action === "SELL") ? d.quality : sig ? sig.score : (d?.quality ?? -1);
        return { sym, n, loaded: n >= 80, d, side, score };
      }),
    [list, allCandles, decisions, sigMap],
  );
  const total = rows.length;
  const loaded = rows.filter((r) => r.loaded).length;
  const scanning = total > 0 && loaded < total;
  const firstWaiting = rows.find((r) => !r.loaded);
  const activeSym = scanning ? firstWaiting?.sym ?? null : null;
  const buys = rows.filter((r) => r.loaded && r.side === "BUY").length;
  const sells = rows.filter((r) => r.loaded && r.side === "SELL").length;
  const best = [...rows].filter((r) => r.loaded && r.side).sort((a, b) => b.score - a.score)[0];
  const ordered = [...rows].sort((a, b) => Number(b.loaded) - Number(a.loaded) || (b.side ? 1 : 0) - (a.side ? 1 : 0) || b.score - a.score);
  const bestTone: Tone = best ? (best.side === "BUY" ? "up" : "down") : "flat";
  const shown = loaded;
  const [run, setRun] = useState(0);

  // The eight readings below belong to one market: the one you tapped (or the chart's market).
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
  }, [symbol, interval, run, ready]);
  useEffect(() => {
    if (!ready || step >= TOTAL) return;
    const id = window.setTimeout(() => setStep((n) => n + 1), step === 0 ? 500 : 320);
    return () => window.clearTimeout(id);
  }, [ready, step]);
  const decision = decisions[symbol];

  return (
    <div className="flex flex-col gap-3">
      <div className={`tb-card p-4 ${scanning ? "tb-card-hot tb-glow" : bestTone === "up" ? "border-up/60" : bestTone === "down" ? "border-down/60" : "tb-card-hot"}`}>
        {total === 0 ? (
          <div className="flex items-center gap-4">
            <Ring spinning />
            <div>
              <p className="text-xl font-semibold">Waiting for markets…</p>
              <p className="mt-1 text-sm text-muted">Connect a broker on the Connect tab and the scan starts by itself.</p>
            </div>
          </div>
        ) : scanning ? (
          <div className="flex items-center gap-4">
            <Ring spinning />
            <div className="min-w-0">
              <p className="text-2xl font-semibold">Analyzing…</p>
              <p className="tb-pulse mt-1 truncate text-sm text-muted">✦ Loading {activeSym ? labelOf(activeSym) : "markets"}…</p>
              <p className="mt-0.5 text-xs text-faint">
                {loaded} of {total} markets loaded · {interval} candles · the rest load a few at a time (Deriv limits history requests)
              </p>
            </div>
          </div>
        ) : (
          <div className="tb-rise">
            <div className="flex items-center gap-4">
              <Ring />
              <div className="min-w-0">
                {best ? (
                  <>
                    <p className="text-xs text-faint">Best setup right now</p>
                    <p className="truncate text-xl font-semibold">{labelOf(best.sym)}</p>
                    <p className={`text-lg font-bold ${TONE[bestTone]}`}>
                      {best.side} <span className="text-sm font-medium text-muted">score {best.score}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-muted">WAIT</p>
                    <p className="text-sm text-muted">No market has a clear setup right now.</p>
                  </>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">
              Scanned {total} markets: <span className="text-up">{buys} buy</span> · <span className="text-down">{sells} sell</span> · {total - buys - sells} no setup
              {radar?.chosen?.length ? ` · radar is scalping ${radar.chosen.length}` : ""}
            </p>
            {best?.d?.reason && <p className="mt-2 text-sm leading-relaxed text-muted">{best.d.reason.slice(0, 200)}</p>}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-medium">Markets being scanned</h2>
          <button type="button" className="h-8 rounded-md border border-line bg-elev-2 px-3 text-xs text-muted" onClick={() => setRun((n) => n + 1)}>
            Re-scan
          </button>
        </div>
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1">
          {ordered.slice(0, SHOW).map((r) => {
            const revealed = r.loaded;
            const active = r.sym === activeSym;
            const tone: Tone = r.side === "BUY" ? "up" : r.side === "SELL" ? "down" : "flat";
            return (
              <button
                key={r.sym}
                type="button"
                onClick={() => useBrain.setState({ symbol: r.sym })}
                className={`min-h-[60px] rounded-md border px-3 py-2 text-left transition-colors ${r.sym === symbol ? "border-accent bg-elev-2" : active ? "border-accent/60 bg-elev" : "border-line bg-elev"}`}
              >
                <p className={`flex items-center gap-1.5 text-sm font-medium ${revealed ? "text-fg" : "text-faint"}`}>
                  {revealed && (
                    <span className="text-up">
                      <Check />
                    </span>
                  )}
                  <span className="truncate">{labelOf(r.sym)}</span>
                </p>
                {revealed ? (
                  <p className={`mt-1 text-xs ${TONE[tone]}`}>{r.side ? `${r.side} · score ${r.score}` : "Scanned · no setup"}</p>
                ) : active ? (
                  <p className="tb-pulse mt-1 text-sm tracking-widest text-accent">•••</p>
                ) : r.n > 0 ? (
                  <p className="mt-1 text-xs text-faint">loading {r.n}/80</p>
                ) : (
                  <div className="mt-2 h-1.5 w-2/3 rounded-full bg-elev-2" />
                )}
              </button>
            );
          })}
        </div>
        {total > SHOW && <p className="mt-2 px-1 text-xs text-faint">+{total - SHOW} more markets are scanned in the background.</p>}
        <div className="relative mt-3 h-11 overflow-hidden rounded-md border border-line bg-elev-2">
          <div className="absolute inset-y-0 left-0 bg-accent/70 transition-all duration-300" style={{ width: `${total ? (shown / total) * 100 : 0}%` }} />
          <p className="relative flex h-full items-center justify-between px-4 text-sm font-medium">
            <span className="truncate">{scanning ? `${aiName} is analyzing` : `${aiName} finished`}</span>
            <span>
              {shown} of {total}
            </span>
          </p>
        </div>
      </div>

      <div className="tb-card flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">Readings for</p>
          <p className="truncate text-base font-semibold">{labelOf(symbol)}</p>
          <p className="text-xs text-muted">
            {interval} candles{decision ? ` · ${decision.action} · score ${decision.quality}` : ""}
          </p>
        </div>
        <button type="button" className="h-10 shrink-0 rounded-md border border-line bg-elev-2 px-3 text-sm text-muted" onClick={() => setView("chart")}>
          Open chart
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm font-medium">Readings · real market</h2>
          <span className="text-xs text-faint">
            {Math.min(step, TOTAL)} of {TOTAL}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: TOTAL }, (_, i) => {
            const r = readings[i];
            const state = !ready ? "pending" : i < step ? "done" : i === step ? "active" : "pending";
            return (
              <div key={r?.key ?? i} className={`min-h-[64px] rounded-md border px-3 py-2 transition-colors ${state === "active" ? "border-accent bg-elev-2" : "border-line bg-elev"}`}>
                <p className={`flex items-center gap-1.5 text-sm font-medium ${state === "pending" ? "text-faint" : "text-fg"}`}>
                  {state === "done" && (
                    <span className="text-up">
                      <Check />
                    </span>
                  )}
                  <span className="truncate">{r?.label ?? "…"}</span>
                </p>
                {state === "done" && r && <p className={`tb-rise mt-1 text-xs ${TONE[r.tone]}`}>{r.value}</p>}
                {state === "active" && <p className="tb-pulse mt-1 text-sm tracking-widest text-accent">•••</p>}
                {state === "pending" && <div className="mt-2 h-1.5 w-2/3 rounded-full bg-elev-2" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Ring({ spinning = false }: { spinning?: boolean }) {
  return (
    <div className="relative h-[72px] w-[72px] shrink-0">
      <svg viewBox="0 0 72 72" className={`absolute inset-0 ${spinning ? "tb-spin" : ""}`} aria-hidden="true">
        <circle cx="36" cy="36" r="33" fill="none" stroke="rgba(239,125,78,0.18)" strokeWidth="3" />
        <circle cx="36" cy="36" r="33" fill="none" stroke="#ef7d4e" strokeWidth="3" strokeLinecap="round" strokeDasharray={spinning ? "52 156" : "207 0"} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Logo size={46} />
      </div>
    </div>
  );
}
