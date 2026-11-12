import { useEffect, useMemo, useState } from "react";
import { askAI, marketData } from "@/lib/brokers/api";
import { DERIV_GRANULARITY, deriv } from "@/lib/brokers/deriv";
import { AI_LABEL } from "@/lib/brokers/ai";
import { snapshot } from "@/lib/market/analyze";
import { INTERVALS, MODE_PROFILES, isDerivSymbol, type Candle } from "@/lib/market/types";
import { ago, money, px } from "@/lib/format";
import { unrealized } from "@/lib/trade/account";
import { AI_SLOTS, useBrain, type AiSlot } from "@/stores/brain";
import { ChartView, type DrawTool } from "./chart-view";
import { NoBroker, labelOf } from "./ui";

const btn = "h-11 rounded-sm border px-3 text-sm";

export function ChartPage() {
  const symbol = useBrain((s) => s.symbol);
  const candles = useBrain((s) => s.candles[symbol] ?? []);
  const settings = useBrain((s) => s.settings);
  const patch = useBrain((s) => s.patchSettings);
  const positions = useBrain((s) => s.positions);
  const decisions = useBrain((s) => s.decisions);
  const quote = useBrain((s) => s.quotes[symbol]);
  const feedAt = useBrain((s) => s.feedAt);
  const aiText = useBrain((s) => s.aiText);
  const aiBusy = useBrain((s) => s.aiBusy);
  const secrets = useBrain((s) => s.secrets);
  const drawings = useBrain((s) => s.drawings[symbol]);
  const log = useBrain((s) => s.log);
  const markets = useBrain((s) => s.markets);
  const conn = useBrain((s) => s.conn);
  const ai = useBrain((s) => s.ai);
  const readySlots = AI_SLOTS.filter((k) => ai[k].status === "ready");
  const setSymbol = useBrain((s) => s.setSymbol);
  const [tool, setTool] = useState<DrawTool>("none");
  const [full, setFull] = useState(false);
  const d = decisions[symbol];
  const profile = MODE_PROFILES[settings.mode];
  const derivSym = isDerivSymbol(symbol);
  const source = derivSym ? conn.deriv.label || "Deriv" : conn.binance.label || "Binance";
  const snap = useMemo(() => snapshot(candles, profile.minRR), [candles, profile.minRR]);
  const [feedErr, setFeedErr] = useState("");
  // The chart loads its OWN candles for the market on screen, so it no longer waits in the scalper's queue (which also pauses
  // Deriv history for a minute after a rate limit). Whatever goes wrong is shown on screen instead of leaving an empty box.
  useEffect(() => {
    let dead = false;
    let timer = 0;
    const next = (ms: number) => {
      if (!dead) timer = window.setTimeout(() => void load(), ms);
    };
    const load = async () => {
      const st = useBrain.getState();
      const sym = st.symbol;
      const interval = st.settings.interval;
      const isDer = isDerivSymbol(sym);
      if (st.markets.length === 0) return next(3_000);
      try {
        let c: Candle[] | null = null;
        if (isDer) {
          if (st.conn.deriv.status !== "connected") {
            setFeedErr("Deriv is not connected. Connect it on the Connect tab to see this market.");
            return next(4_000);
          }
          c = await deriv.candles(sym, DERIV_GRANULARITY[interval] ?? 300, 400);
        } else {
          if (st.conn.binance.status !== "connected") {
            setFeedErr("Binance is not connected. Connect it on the Connect tab to see this market.");
            return next(4_000);
          }
          const res = (await marketData({ data: { op: "klines", env: st.settings.binanceEnv, symbol: sym, interval, limit: 500 } })) as { candles?: Candle[] };
          c = res.candles ?? null;
        }
        if (dead) return;
        const cur = useBrain.getState();
        if (c?.length && cur.symbol === sym && cur.settings.interval === interval) {
          const last = c[c.length - 1]!.c;
          useBrain.setState((s) => ({
            candles: { ...s.candles, [sym]: c! },
            quotes: { ...s.quotes, [sym]: { bid: s.quotes[sym]?.bid ?? null, ask: s.quotes[sym]?.ask ?? null, last, chg: s.quotes[sym]?.chg ?? (c!.length > 1 ? ((last - c![0]!.o) / c![0]!.o) * 100 : null) } },
            feedAt: Date.now(),
          }));
          setFeedErr("");
        } else if (!c?.length) setFeedErr(`No candles came back for ${sym} on ${interval}. The market may be closed, or the broker has no history for it.`);
        next(isDer ? 15_000 : 5_000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        setFeedErr(`Could not load ${sym}: ${msg}`);
        next(/rate limit|too many/i.test(msg) ? 30_000 : 8_000);
      }
    };
    void load();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [symbol, settings.interval]);
  const groups = useMemo(() => [...new Set(markets.map((m) => m.group))], [markets]);
  // Stable identity: a new object on every render made the chart rebuild itself on every store update.
  const planAction = d && d.plan && (d.action === "BUY" || d.action === "SELL") ? d.action : null;
  const planEntry = d?.plan?.entry;
  const planStop = d?.plan?.stop;
  const planTarget = d?.plan?.target;
  const plan = useMemo(
    () => (planAction && planEntry != null && planStop != null && planTarget != null ? { action: planAction, entry: planEntry, stop: planStop, target: planTarget } : null),
    [planAction, planEntry, planStop, planTarget],
  );
  if (markets.length === 0) return <NoBroker what="Charts" />;
  const lastT = candles.length ? candles[candles.length - 1]!.t : null;
  const fresh = feedAt != null && Date.now() - feedAt < 60_000;
  const spread = quote?.bid && quote.ask ? quote.ask - quote.bid : null;
  const mine = positions.filter((p) => p.symbol === symbol && p.status === "open");


  return (
    <section className={full ? "fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-bg p-3" : "flex flex-col gap-4"}>
      <select aria-label="Market" className="h-12 w-full rounded-sm border border-line bg-elev px-3 text-base text-fg" value={symbol} onChange={(e) => useBrain.setState({ symbol: e.target.value })}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {markets.filter((m) => m.group === g).map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.label}
                {m.open === false ? " (closed)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium">{labelOf(symbol)}</h2>
          <p className="text-sm text-muted">
            {quote ? px(quote.last) : "—"} · {settings.interval} · quality gate {profile.minScore}
          </p>
          <p className="text-xs text-faint">
            {quote?.bid && quote.ask ? `Bid ${px(quote.bid)} · Ask ${px(quote.ask)} · Spread ${spread != null ? spread.toPrecision(3) : "—"}` : "Bid/ask not supplied by this feed."}
            {lastT ? ` · last candle ${new Date(lastT).toLocaleString()}` : ""}
          </p>
          <p className={`text-xs ${fresh ? "text-up" : "text-warn"}`}>
            {candles.length === 0 ? "No data" : fresh ? "Live (polled about every 5 s, not a streaming socket)" : `Stale: last update ${ago(feedAt)}`} · {source}
          </p>
        </div>
        <div className="flex gap-2">
          {readySlots.length === 0 && (
            <button type="button" className={`${btn} border-line`} disabled title="Add an AI key on the Connect tab">
              Ask AI
            </button>
          )}
          {readySlots.map((k) => (
            <button key={k} type="button" className={`${btn} border-line`} disabled={aiBusy || !d} onClick={() => void review(k)}>
              {aiBusy ? "Asking…" : `Ask ${ai[k].provider ? AI_LABEL[ai[k].provider!].split(" ").pop() : "AI"}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {INTERVALS.map((t) => (
          <button key={t} type="button" className={`${btn} shrink-0 ${settings.interval === t ? "border-accent bg-elev-2" : "border-line text-muted"}`} onClick={() => patch({ interval: t })}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${btn} ${tool === "h" ? "border-accent bg-elev-2" : "border-line text-muted"}`} onClick={() => setTool(tool === "h" ? "none" : "h")}>
          Horizontal line
        </button>
        <button type="button" className={`${btn} ${tool === "t" ? "border-accent bg-elev-2" : "border-line text-muted"}`} onClick={() => setTool(tool === "t" ? "none" : "t")}>
          Trendline (2 taps)
        </button>
        <button type="button" className={`${btn} border-line text-muted`} onClick={() => useBrain.setState((s) => ({ drawings: { ...s.drawings, [symbol]: [] } }))}>
          Clear mine
        </button>
        <button type="button" className={`${btn} border-line text-muted`} onClick={() => patch({ chartStyle: settings.chartStyle === "line" ? "candle" : "line" })}>
          {settings.chartStyle === "line" ? "Candles" : "Line"}
        </button>
        <button type="button" className={`${btn} border-line text-muted`} onClick={() => setFull(!full)}>
          {full ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      {tool !== "none" && <p className="text-xs text-warn">{tool === "h" ? "Tap the chart where the line should sit." : "Tap two points on the chart. Your drawings are saved per instrument and are not trading orders."}</p>}

      {feedErr && candles.length < 2 && <p className="text-xs text-warn">{feedErr}</p>}
      <ChartView
        candles={candles}
        settings={settings}
        positions={positions}
        symbol={symbol}
        plan={plan}
        drawings={drawings ?? []}
        tool={tool}
        fullscreen={full}
        onDraw={(dr) => {
          useBrain.setState((s) => ({ drawings: { ...s.drawings, [symbol]: [...(s.drawings[symbol] ?? []), dr].slice(-30) } }));
          if (dr.kind === "h") setTool("none");
        }}
      />

      {mine.length > 0 && (
        <ul className="flex flex-col gap-2">
          {mine.map((p) => {
            const mark = quote?.last ?? p.entry;
            const u = unrealized(p, mark);
            return (
              <li key={p.id} className="rounded-sm border border-line bg-elev px-3 py-2 text-xs text-muted">
                <span className="text-fg">
                  {p.side} {p.qty}
                </span>{" "}
                · entry {px(p.entry)} · stop {px(p.stop)} · target {px(p.target)} · now {px(mark)} ·{" "}
                <span className={u >= 0 ? "text-up" : "text-down"}>{money(u)}</span> · {p.protection === "broker-confirmed" ? "stop/target confirmed at broker" : p.protection === "contract-stake" ? "Deriv contract, loss limited to stake" : "stop/target watched locally by this page"}
                {p.brokerOrderId ? ` · order ${p.brokerOrderId}` : ""}
                {p.ocoListId ? ` · list ${p.ocoListId}` : ""}
              </li>
            );
          })}
        </ul>
      )}

      {snap && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(() => {
            const px0 = snap.price;
            const sup = [...snap.levels].filter((l) => l.p < px0).sort((a, b) => b.p - a.p)[0];
            const res = [...snap.levels].filter((l) => l.p > px0).sort((a, b) => a.p - b.p)[0];
            const trend = snap.e9 != null && snap.e21 != null && snap.e50 != null ? (snap.e9 > snap.e21 && snap.e21 > snap.e50 ? "Up (9 > 21 > 50)" : snap.e9 < snap.e21 && snap.e21 < snap.e50 ? "Down (9 < 21 < 50)" : "Mixed") : "—";
            const lastStruct = snap.structure[snap.structure.length - 1];
            const cells: [string, string][] = [
              ["Trend", trend],
              ["Regime", snap.regime.name],
              ["RSI · ADX", `${snap.rsi != null ? snap.rsi.toFixed(0) : "—"} · ${snap.adx ? snap.adx.adx.toFixed(0) : "—"}`],
              ["Volatility (ATR)", snap.atr != null ? px(snap.atr) : "—"],
              ["Nearest support", sup ? px(sup.p) : "—"],
              ["Nearest resistance", res ? px(res.p) : "—"],
              ["Latest structure", lastStruct ? `${lastStruct.kind} ${lastStruct.side === "BUY" ? "up" : "down"}` : "None yet"],
              ["Open zones", String(snap.zones.length)],
            ];
            return cells.map(([k, v]) => (
              <div key={k} className="rounded-sm border border-line bg-elev px-3 py-2">
                <p className="text-xs text-muted">{k}</p>
                <p className="mt-0.5 truncate text-sm">{v}</p>
              </div>
            ));
          })()}
        </div>
      )}

      <div className="rounded-lg border border-line bg-elev p-3">
        <p className="text-sm">{d ? `${d.action} · ${d.quality} · ${d.regime}` : "Waiting for a full candle set."}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">{d?.reason}</p>
        {d?.plan && (
          <p className="mt-2 text-xs text-faint">
            Plan entry {px(d.plan.entry)} · stop {px(d.plan.stop)} · target {px(d.plan.target)} · {d.plan.rr.toFixed(2)}R. These levels are calculations, not live broker orders. The quality score is a ranking, not a probability of profit.
          </p>
        )}
        {aiText && <p className="mt-3 text-sm text-fg">{aiText}</p>}
      </div>
      {d && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.modules.map((m) => (
            <li key={m.name} className="rounded-sm border border-line bg-elev px-3 py-2">
              <p className="text-sm">
                {m.name} · <span className={m.verdict === "BUY" ? "text-up" : m.verdict === "SELL" ? "text-down" : "text-muted"}>{m.verdict}</span> {m.score}
              </p>
              <p className="text-xs text-faint">{m.why}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  async function review(slot: AiSlot) {
    const cfg = useBrain.getState().ai[slot];
    if (!d || cfg.status !== "ready" || !cfg.provider) return;
    const brief = `${labelOf(symbol)} ${settings.interval}. Proposed ${d.action}, quality ${d.quality}, regime ${d.regime}. ${d.reason} Modules: ${d.modules.map((m) => `${m.name} ${m.verdict} ${m.score}`).join("; ")}.${d.plan ? ` Plan entry ${d.plan.entry}, stop ${d.plan.stop}, target ${d.plan.target}.` : ""}`;
    useBrain.setState({ aiBusy: true });
    const keyName = slot === "gemini" ? "geminiKey" : slot === "grok" ? "grokKey" : "otherKey";
    const res = await askAI({ brief, key: useBrain.getState().secrets[keyName], provider: cfg.provider, model: cfg.model });
    useBrain.setState({ aiBusy: false, aiText: res.ok ? `${AI_LABEL[cfg.provider]}: ${res.text}` : res.error });
    if (!res.ok) log(res.error, "warn");
  }
}
