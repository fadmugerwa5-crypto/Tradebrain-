import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import { useBrain } from "@/stores/brain";
import { findPatterns } from "@/lib/learn/learn";
import { diary, guardPatch, mistakeRegister, reflect } from "@/lib/learn/reflection";
import { runLab, type LabResult, type Row } from "@/lib/learn/backtest";
import { specLabel } from "@/lib/learn/rules";
import { fmtR, metricsIndependent, metricsOf, recordsToCsv, segment, type Metrics } from "@/lib/learn/stats";
import { useLearn } from "@/lib/learn/store";
import type { Candidate, SegmentSpec, TradeRecord } from "@/lib/learn/types";
import { swingCandles, swingLoadedSymbols } from "./swing-engine";
import { Field, Num, Toggle } from "./ui";

type Sub = "mind" | "overview" | "journal" | "health" | "lab" | "history" | "settings";
const SUBS: { id: Sub; label: string }[] = [
  { id: "mind", label: "Mind" },
  { id: "overview", label: "Overview" },
  { id: "journal", label: "Journal" },
  { id: "health", label: "Strategy health" },
  { id: "lab", label: "Backtest lab" },
  { id: "history", label: "Change history" },
  { id: "settings", label: "Settings" },
];

const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const conf = (m: Metrics) => (m.confidence === "insufficient" ? "too few trades" : `${m.confidence} confidence`);
const lowConf = (m: Metrics) => m.confidence === "insufficient" || m.confidence === "low";

function Pill({ text, tone }: { text: string; tone?: "up" | "down" | "warn" }) {
  return <span className={`rounded border border-line px-1.5 py-0.5 text-[10px] ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "text-muted"}`}>{text}</span>;
}

function MetricLine({ m }: { m: Metrics }) {
  const ci = Number.isFinite(m.expCI[0]) ? ` (${m.expCI[0].toFixed(2)} to ${m.expCI[1].toFixed(2)})` : "";
  return (
    <p className="text-xs text-muted">
      {m.n} trades · {Math.round(m.winRate * 100)}% won · <span className={m.expectancy >= 0 ? "text-up" : "text-down"}>{fmtR(m.expectancy)}</span> each{ci} · PF {m.profitFactor == null ? "n/a" : m.profitFactor.toFixed(2)} · worst drawdown {m.maxDrawdownR.toFixed(1)}R · longest losing run {m.maxLossStreak} ·{" "}
      <span className={lowConf(m) ? "text-warn" : ""}>{conf(m)}</span>
    </p>
  );
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

export function LearnTab() {
  const [sub, setSub] = useState<Sub>("mind");
  return (
    <div className="flex flex-col gap-3">
      <div className="tb-card p-3">
        <h1 className="text-sm font-medium">Learning Brain</h1>
        <p className="mt-1 text-xs leading-relaxed text-faint">It records every trade with the facts at entry, studies wins and losses, and tests an idea on trades it has not seen before it can change anything. It cannot change your risk limits, stake size or stops. It can only switch a setup off or rank it lower, and only after you approve.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {SUBS.map((s) => (
          <button key={s.id} type="button" onClick={() => setSub(s.id)} className={`h-9 shrink-0 rounded-md border px-3 text-xs ${sub === s.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-elev text-muted"}`}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === "mind" && <Mind />}
      {sub === "overview" && <Overview />}
      {sub === "journal" && <JournalPanel />}
      {sub === "health" && <Health />}
      {sub === "lab" && <Lab />}
      {sub === "history" && <History />}
      {sub === "settings" && <LearnSettings />}
    </div>
  );
}

// ------------------------------------------------------------------ mind

function Mind() {
  const records = useLearn((s) => s.records);
  const candidates = useLearn((s) => s.candidates);
  const versions = useLearn((s) => s.versions);
  const activeId = useLearn((s) => s.activeId);
  const minSample = useLearn((s) => s.settings.minSample);
  const setFilters = useLearn((s) => s.setFilters);
  const filters = versions.find((v) => v.id === activeId)?.filters ?? { htf: "off" as const, standAside: false, maxSpreadPct: 0 };
  const ref = useMemo(() => reflect(records, candidates, versions, activeId, minSample), [records, candidates, versions, activeId, minSample]);
  const reg = useMemo(() => mistakeRegister(records), [records]);
  return (
    <>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">What I have learned about myself</h2>
        <p className="mt-1 text-xs text-faint">Written from my own trade records. This is self-review, not awareness: I only know what I have recorded, and I say so when it is too little.</p>
        <ul className="mt-2 flex flex-col gap-2">
          {ref.lessons.map((l, i) => <li key={i} className="border-t border-line pt-2 text-sm leading-relaxed">{l}</li>)}
        </ul>
        <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
          {ref.status.map((l, i) => <li key={i}>{l}</li>)}
          <li>{diary(records)}</li>
        </ul>
      </div>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">My mistake register</h2>
        {reg.mistakes.length === 0 ? <p className="mt-1 text-xs text-muted">No habit has cost me clearly yet (needs 10+ cases and 0.2R worse than without it).</p> : (
          <ul className="mt-2 flex flex-col">
            {reg.mistakes.map((k) => {
              const patch = k.guard ? guardPatch(k.guard, filters) : null;
              return (
                <li key={k.id} className="border-t border-line py-2 text-xs">
                  <p className="text-sm">{k.label} {k.repeating && <Pill text="still repeating" tone="down" />} <Pill text={`${k.confidence} confidence`} tone={k.confidence === "low" ? "warn" : undefined} /></p>
                  <p className="text-muted">{k.cases} trades · {fmtR(k.avgWith)} with it, {fmtR(k.avgWithout)} without · {k.recent} of my last 20</p>
                  {patch && <button type="button" className="mt-1 h-9 rounded-md border border-accent px-3 text-accent" onClick={() => setFilters(patch)}>Guard against this</button>}
                  {k.guard && !patch && <p className="mt-1 text-up">Guard is on.</p>}
                </li>
              );
            })}
          </ul>
        )}
        {reg.watching.length > 0 && <p className="mt-2 text-xs text-faint">Watching (too few cases): {reg.watching.map((k) => k.label.replace(/^I /, "")).join("; ")}.</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ overview

function modeLabel() {
  const b = useBrain.getState();
  if (b.settings.venue === "paper") return "Paper";
  if (b.settings.venue === "binance") return /live/.test(b.settings.binanceEnv) ? "LIVE (Binance)" : "Demo (Binance)";
  return b.derivStatus.virtual === false ? "LIVE (Deriv)" : "Demo (Deriv)";
}

function Overview() {
  const records = useLearn((s) => s.records);
  const candidates = useLearn((s) => s.candidates);
  const settings = useLearn((s) => s.settings);
  const setSettings = useLearn((s) => s.setSettings);
  const versions = useLearn((s) => s.versions);
  const activeId = useLearn((s) => s.activeId);
  const removeRule = useLearn((s) => s.removeRule);
  const sizing = useBrain((s) => s.sizing);
  const feedAt = useBrain((s) => s.feedAt);
  const armed = useBrain((s) => s.armed);
  const swingArmed = useBrain((s) => s.swingArmed);
  const ai = useBrain((s) => s.ai);
  useBrain((s) => s.settings.venue);
  const all = useMemo(() => metricsOf(records), [records]);
  const ind = useMemo(() => metricsIndependent(records), [records]);
  const patterns = useMemo(() => findPatterns(records, settings.minSample), [records, settings.minSample]);
  const cur = versions.find((v) => v.id === activeId);
  const aiReady = Object.entries(ai).filter(([, a]) => a.status === "ready").map(([k]) => k);
  const age = feedAt ? Math.round((Date.now() - feedAt) / 1000) : null;
  const open = candidates.filter((c) => c.status !== "approved" && c.status !== "rejected");
  const done = candidates.filter((c) => c.status === "rejected").slice(-5).reverse();
  return (
    <>
      <div className="tb-card p-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <p><span className="text-faint">Mode</span><br />{modeLabel()}</p>
          <p><span className="text-faint">Equity</span><br />{sizing ? money(sizing.equity) : "no balance yet"}</p>
          <p><span className="text-faint">Today</span><br />{sizing ? money(sizing.equity - sizing.dayStartEquity) : "n/a"}</p>
          <p><span className="text-faint">Data</span><br />{age == null ? "no feed" : age < 90 ? `fresh (${age}s)` : `STALE (${Math.round(age / 60)} min)`}</p>
          <p><span className="text-faint">Engines</span><br />Scalper {armed ? "ARMED" : "off"} · Trades {swingArmed ? "ARMED" : "off"}</p>
          <p><span className="text-faint">AI review</span><br />{aiReady.length ? `ready (${aiReady.join(", ")})` : "unavailable: signals are rules-only"}</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Toggle on={settings.learning} label={settings.learning ? "Learning on" : "Learning paused"} set={(v) => setSettings({ learning: v })} />
          <Toggle on={!settings.pauseSignals} label={settings.pauseSignals ? "Signals paused" : "Signals on"} set={(v) => setSettings({ pauseSignals: !v })} />
          <button type="button" className="h-11 rounded-md border border-down px-2 text-xs font-medium text-down" onClick={() => useBrain.getState().emergency()}>
            Emergency stop
          </button>
        </div>
      </div>

      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">All recorded trades</h2>
        {records.length === 0 ? (
          <p className="mt-1 text-xs text-faint">Nothing recorded yet. Each closed trade appears here with the market facts it was entered on.</p>
        ) : (
          <>
            <MetricLine m={all} />
            <p className="mt-1 text-xs text-faint">Counting clustered entries once: {ind.n} independent observations, {fmtR(ind.expectancy)} each. {records.filter((r) => !r.backfilled).length} trades have full entry context; {records.filter((r) => r.backfilled).length} are older and have none.</p>
            {lowConf(ind) && <p className="mt-1 text-xs text-warn">Small sample: nothing below is evidence yet. About 30 independent trades per setup are needed before a pattern counts.</p>}
          </>
        )}
      </div>

      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Candidate changes</h2>
        <p className="mt-1 text-xs text-faint">Order: watch, then confirmed on later unseen trades, then shadow test, then your approval. Nothing here changes live trading until you approve it.</p>
        {open.length === 0 && <p className="mt-2 text-xs text-muted">No candidate yet.</p>}
        <ul className="mt-2 flex flex-col">{open.map((c) => <CandidateRow key={c.id} c={c} need={settings.shadowMin} />)}</ul>
        {done.length > 0 && (
          <details className="mt-2 text-xs text-muted">
            <summary>Rejected ({done.length} latest)</summary>
            {done.map((c) => <p key={c.id} className="mt-1">{c.label}: {c.reason}</p>)}
          </details>
        )}
      </div>

      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Active rules ({cur?.id ?? "v0"})</h2>
        {!cur || (cur.rules.length === 0) ? <p className="mt-1 text-xs text-muted">None. The app trades exactly as v33 did, plus your filters under Settings.</p> : (
          <ul className="mt-2 flex flex-col">
            {cur.rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 border-t border-line py-2 text-xs">
                <span>{r.action === "disable" ? "Off" : "Restricted"}: {specLabel(r.spec)} <Pill text={r.source} /></span>
                <button type="button" className="text-warn underline" onClick={() => removeRule(r.id)}>remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Patterns seen</h2>
        {patterns.length === 0 ? <p className="mt-1 text-xs text-muted">No repeated pattern yet.</p> : (
          <ul className="mt-2 flex flex-col">
            {patterns.slice(0, 10).map((p) => (
              <li key={p.label + p.kind} className="border-t border-line py-2 text-xs">
                <p className="text-sm"><span className={p.kind === "weak" ? "text-down" : "text-up"}>{p.kind === "weak" ? "Weak" : "Strong"}</span> · {p.label}</p>
                <MetricLine m={p.m} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function CandidateRow({ c, need }: { c: Candidate; need: number }) {
  const approve = useLearn((s) => s.approve);
  const reject = useLearn((s) => s.reject);
  const reset = useLearn((s) => s.resetCandidate);
  const tone = c.status === "ready" ? "up" : c.status === "shadow" ? "warn" : undefined;
  return (
    <li className="border-t border-line py-2 text-xs">
      <p className="text-sm">{c.action === "disable" ? "Switch off" : "Restrict"}: {c.label} <Pill text={c.status === "ready" ? "ready for approval" : c.status} tone={tone} /></p>
      <p className="mt-1 text-muted">{c.reason}</p>
      {c.train && <p className="mt-1 text-faint">Earlier trades: {c.train.n} · {fmtR(c.train.exp)}{c.validation ? ` · later unseen: ${c.validation.n} · ${fmtR(c.validation.exp)}` : ""}{c.status === "shadow" || c.status === "ready" ? ` · shadow ${c.shadow.rs.length}/${need}` : ""}</p>}
      <div className="mt-2 flex gap-2">
        {c.status === "ready" && <button type="button" className="h-9 rounded-md border border-accent bg-accent px-3 text-accent-fg" onClick={() => approve(c.id)}>Approve</button>}
        <button type="button" className="h-9 rounded-md border border-line px-3 text-muted" onClick={() => reset(c.id)}>Reset test</button>
        <button type="button" className="h-9 rounded-md border border-line px-3 text-muted" onClick={() => reject(c.id)}>Reject</button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ journal

function JournalPanel() {
  const records = useLearn((s) => s.records);
  const analyses = useLearn((s) => s.analyses);
  const [strat, setStrat] = useState("all");
  const [reg, setReg] = useState("all");
  const [mode, setMode] = useState("all");
  const strategies = useMemo(() => [...new Set(records.map((r) => r.strategy))].sort(), [records]);
  const list = useMemo(() => records.filter((r) => (strat === "all" || r.strategy === strat) && (reg === "all" || (r.ctx?.regime ?? "unknown") === reg) && (mode === "all" || r.mode === mode)).slice(-80).reverse(), [records, strat, reg, mode]);
  const sel = "h-10 rounded-md border border-line bg-elev-2 px-2 text-xs text-fg";
  return (
    <div className="tb-card p-3">
      <div className="grid grid-cols-3 gap-2">
        <select className={sel} value={strat} onChange={(e) => setStrat(e.target.value)}><option value="all">All strategies</option>{strategies.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className={sel} value={reg} onChange={(e) => setReg(e.target.value)}>{["all", "trend-up", "trend-down", "range", "squeeze", "vol-expansion", "unclear", "unknown"].map((s) => <option key={s} value={s}>{s === "all" ? "All regimes" : s}</option>)}</select>
        <select className={sel} value={mode} onChange={(e) => setMode(e.target.value)}>{["all", "paper", "demo", "live"].map((s) => <option key={s} value={s}>{s === "all" ? "All modes" : s}</option>)}</select>
      </div>
      <p className="mt-2 text-xs text-faint">{list.length} shown (latest 80 of the filter). Tap a trade for the full record.</p>
      {list.length === 0 && <p className="mt-2 text-sm text-muted">No trades match.</p>}
      <ul className="mt-2 flex flex-col">
        {list.map((r) => (
          <li key={r.id} className="border-t border-line py-2 text-xs">
            <details>
              <summary className="cursor-pointer list-none">
                <span className="text-sm">{r.label} <span className={r.side === "BUY" ? "text-up" : "text-down"}>{r.side}</span> · {r.strategy}</span>
                <span className={`float-right ${r.pnl >= 0 ? "text-up" : "text-down"}`}>{r.r != null ? fmtR(r.r) : money(r.pnl)}</span>
                <br />
                <span className="text-faint">{when(r.openedAt)} · {r.book} · {r.mode} · {r.exitKind} · {r.ctx ? `${r.ctx.regime}, ${r.ctx.htfMin}m ${r.ctx.align}` : "no entry context"} · {r.ai === "reviewed" ? "AI reviewed" : r.ai === "ai-unavailable" ? "AI unavailable" : "rules only"}</span>
              </summary>
              <TradeDetail r={r} summary={analyses[r.id]?.summary} causes={analyses[r.id]?.causes ?? []} />
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TradeDetail({ r, summary, causes }: { r: TradeRecord; summary?: string; causes: { category: string; text: string; evidence: string; confidence: string }[] }) {
  return (
    <div className="mt-2 rounded-md border border-line p-2 text-muted">
      <p>Entry {r.entry} · stop {r.stop} · target {r.target} · exit {r.exit ?? "n/a"} · fees {money(r.fees)} · net {money(r.pnl)} · risk {money(r.riskUnit)} · held {r.holdMin} min · {r.session} session · config {r.configVersion}</p>
      <p className="mt-1">Exit: {r.exitReason || "n/a"}</p>
      {r.ctx && <p className="mt-1">Market at entry: {r.ctx.regime} ({r.ctx.regimeWhy}). Bias: {r.ctx.htfBias} ({r.ctx.htfWhy}). Structure {r.ctx.structure}. Stop {r.ctx.stopAtr?.toFixed(2) ?? "?"} ATR. Spread {r.ctx.spreadPct?.toFixed(3) ?? "unknown"}%.</p>}
      {r.aiNote && <p className="mt-1">AI said: {r.aiNote}</p>}
      <p className="mt-2 text-fg">{summary ?? "Not analysed yet."}</p>
      {causes.map((c, i) => <p key={i} className="mt-1">· {c.text} <span className="text-faint">({c.category}, {c.confidence} confidence: {c.evidence})</span></p>)}
    </div>
  );
}

// ------------------------------------------------------------------ strategy health

const DIMS: { id: string; dims: string[]; label: string }[] = [
  { id: "strategy", dims: ["strategy"], label: "Strategy" },
  { id: "strategy|symbol", dims: ["strategy", "symbol"], label: "Strategy and market" },
  { id: "strategy|regime", dims: ["strategy", "regime"], label: "Strategy and regime" },
  { id: "strategy|side", dims: ["strategy", "side"], label: "Strategy and direction" },
  { id: "strategy|session", dims: ["strategy", "session"], label: "Strategy and session" },
  { id: "regime|align", dims: ["regime", "align"], label: "Regime and 15m bias" },
  { id: "symbol", dims: ["symbol"], label: "Market" },
  { id: "venue", dims: ["venue", "mode"], label: "Venue and mode" },
];

function Health() {
  const records = useLearn((s) => s.records);
  const disableSpec = useLearn((s) => s.disableSpec);
  const [d, setD] = useState("strategy");
  const def = DIMS.find((x) => x.id === d)!;
  const rows = useMemo(() => segment(records, def.dims), [records, def]);
  const toSpec = (key: string): SegmentSpec | null => {
    const parts = key.split(" | ");
    const spec: Record<string, string> = {};
    def.dims.forEach((dim, i) => {
      if (["strategy", "symbol", "regime", "side", "session", "align"].includes(dim)) spec[dim] = parts[i]!;
    });
    return spec.strategy || spec.regime ? (spec as unknown as SegmentSpec) : null;
  };
  return (
    <div className="tb-card p-3">
      <Field label="Group results by">
        <select className="h-10 rounded-md border border-line bg-elev-2 px-2 text-sm text-fg" value={d} onChange={(e) => setD(e.target.value)}>{DIMS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      </Field>
      <p className="mt-2 text-xs text-faint">Results in R (profit divided by the amount risked), after fees. A group with few trades is labelled low confidence and is not a verdict.</p>
      {rows.length === 0 && <p className="mt-2 text-sm text-muted">No trades yet.</p>}
      <ul className="mt-2 flex flex-col">
        {rows.slice(0, 40).map((r) => {
          const spec = toSpec(r.key);
          return (
            <li key={r.key} className="border-t border-line py-2">
              <p className="text-sm">{r.key}</p>
              <MetricLine m={r.m} />
              {spec && !r.key.includes("unknown") && <button type="button" className="mt-1 text-xs text-warn underline" onClick={() => disableSpec(spec)}>Switch this off</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ backtest lab

function RowView({ r }: { r: Row }) {
  return (
    <li className="border-t border-line py-2 text-xs">
      <p className="text-sm">{r.strategy}</p>
      {(["train", "validation", "holdout"] as const).map((k) => (
        <p key={k} className="text-muted"><span className="inline-block w-20 text-faint">{k}</span>{r[k].n} trades · {Math.round(r[k].winRate * 100)}% · <span className={r[k].expectancy >= 0 ? "text-up" : "text-down"}>{fmtR(r[k].expectancy)}</span>{lowConf(r[k]) ? <span className="text-warn"> · low confidence</span> : null}</p>
      ))}
    </li>
  );
}

function Lab() {
  const candles = useBrain((s) => s.candles);
  const interval = useBrain((s) => s.settings.interval);
  const htfMin = useLearn((s) => s.settings.htfMin);
  const [kind, setKind] = useState<"scalp" | "swing">("scalp");
  const [sym, setSym] = useState("");
  const [res, setRes] = useState<(LabResult & { src: string }) | null>(null);
  const [err, setErr] = useState("");
  const scalpSyms = Object.keys(candles).filter((k) => (candles[k]?.length ?? 0) >= 120);
  const swingSyms = swingLoadedSymbols();
  const syms = kind === "scalp" ? scalpSyms : swingSyms;
  const run = () => {
    setErr("");
    const s = syms.includes(sym) ? sym : syms[0];
    if (!s) return setErr(kind === "swing" ? "No Trades-tab candles are loaded yet. Open the Trades tab and let it scan first." : "No market has enough candles yet (needs 120).");
    const src = kind === "scalp" ? { candles: candles[s]!, tf: interval } : swingCandles(s);
    if (!src) return setErr("Candles are not loaded for that market.");
    const r = runLab({ candles: src.candles, kind, htfMin });
    setRes({ ...r, src: `${s} · ${src.tf}` });
  };
  const sel = "h-10 rounded-md border border-line bg-elev-2 px-2 text-sm text-fg";
  return (
    <div className="tb-card p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Strategy set"><select className={sel} value={kind} onChange={(e) => { setKind(e.target.value as "scalp" | "swing"); setSym(""); setRes(null); }}><option value="scalp">Scalp strategies (Controls interval)</option><option value="swing">Swing strategies (Trades tab candles)</option></select></Field>
        <Field label="Market"><select className={sel} value={syms.includes(sym) ? sym : (syms[0] ?? "")} onChange={(e) => setSym(e.target.value)}>{syms.length === 0 && <option value="">none loaded</option>}{syms.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
      </div>
      <button type="button" className="mt-3 h-11 w-full rounded-md border border-accent bg-accent text-sm font-medium text-accent-fg" onClick={run}>Run walk-forward test</button>
      {err && <p className="mt-2 text-xs text-warn">{err}</p>}
      {res && (
        <div className="mt-3">
          <p className="text-sm font-medium">{res.src} · {res.trades.length} simulated trades</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-faint">{res.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <h3 className="mt-3 text-sm font-medium">Baseline versus 15m-bias filter</h3>
          <ul><RowView r={res.baseline} /><RowView r={res.filtered} /></ul>
          <p className="text-xs text-faint">No-trade baseline is 0.00R. A filter only helps if it is better on validation and holdout, not just training.</p>
          <h3 className="mt-3 text-sm font-medium">By strategy</h3>
          <ul>{res.rows.map((r) => <RowView key={r.strategy} r={r} />)}</ul>
          <h3 className="mt-3 text-sm font-medium">By market regime</h3>
          <ul>{res.byRegime.map((x) => <li key={x.regime} className="border-t border-line py-2"><p className="text-sm">{x.regime}</p><MetricLine m={x.m} /></li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ history

function History() {
  const versions = useLearn((s) => s.versions);
  const activeId = useLearn((s) => s.activeId);
  const log = useLearn((s) => s.log);
  const rollback = useLearn((s) => s.rollback);
  return (
    <>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Configuration versions</h2>
        <ul className="mt-2 flex flex-col">
          {[...versions].reverse().map((v) => (
            <li key={v.id} className="border-t border-line py-2 text-xs">
              <p className="text-sm">{v.id} {v.id === activeId && <Pill text="active" tone="up" />} <Pill text={v.source} /></p>
              <p className="text-muted">{v.note}</p>
              <p className="text-faint">{when(v.createdAt)} · {v.rules.length} rule(s){v.parent ? ` · from ${v.parent}` : ""}</p>
              {v.id !== activeId && <button type="button" className="mt-1 text-warn underline" onClick={() => rollback(v.id)}>Restore this version</button>}
            </li>
          ))}
        </ul>
      </div>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Learning log</h2>
        <ul className="mt-2 flex flex-col">
          {log.slice(0, 60).map((e, i) => (
            <li key={i} className="border-t border-line py-2 text-xs">
              <p><Pill text={e.kind} /> {e.text}</p>
              {e.evidence && <p className="mt-1 text-faint">{e.evidence}</p>}
              <p className="text-faint">{when(e.t)}</p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ settings

function LearnSettings() {
  const settings = useLearn((s) => s.settings);
  const setSettings = useLearn((s) => s.setSettings);
  const versions = useLearn((s) => s.versions);
  const activeId = useLearn((s) => s.activeId);
  const setFilters = useLearn((s) => s.setFilters);
  const records = useLearn((s) => s.records);
  const exportJson = useLearn((s) => s.exportJson);
  const importJson = useLearn((s) => s.importJson);
  const clearAll = useLearn((s) => s.clearAll);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  const f = versions.find((v) => v.id === activeId)?.filters ?? { htf: "off" as const, standAside: false, maxSpreadPct: 0 };
  const share = async (what: string) => {
    const t = what === "csv" ? recordsToCsv(records) : exportJson();
    const ok = await copyText(t);
    setMsg(ok ? `${what.toUpperCase()} copied.` : "Copy was blocked: select the text below and copy it by hand.");
    if (!ok) setText(t);
  };
  return (
    <>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Entry filters (yours, all off by default)</h2>
        <p className="mt-1 text-xs text-faint">These only remove setups. With them off the app enters exactly the trades v33 would. The 15m bias and market regime are recorded on every trade either way.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Toggle on={f.htf === "block"} label={f.htf === "block" ? "Block trades against 15m bias" : "15m bias: record only"} set={(v) => setFilters({ htf: v ? "block" : "off" })} />
          <Toggle on={f.standAside} label={f.standAside ? "Stand aside: unclear or wild market" : "Stand aside: off"} set={(v) => setFilters({ standAside: v })} />
          <Num label="Skip when spread above % (0 = off)" value={f.maxSpreadPct} onChange={(n) => setFilters({ maxSpreadPct: Math.max(0, n) })} />
          <Num label="Higher timeframe (minutes)" value={settings.htfMin} onChange={(n) => setSettings({ htfMin: Math.max(5, Math.min(240, Math.round(n))) })} />
        </div>
      </div>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Evidence gates</h2>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Num label="Trades to trust a pattern" value={settings.minSample} onChange={(n) => setSettings({ minSample: Math.max(10, Math.round(n)) })} />
          <Num label="Later trades to confirm" value={settings.minValidate} onChange={(n) => setSettings({ minValidate: Math.max(5, Math.round(n)) })} />
          <Num label="Shadow trades" value={settings.shadowMin} onChange={(n) => setSettings({ shadowMin: Math.max(5, Math.round(n)) })} />
        </div>
        <p className="mt-2 text-xs text-faint">Lowering these makes the app act on thinner evidence. 30, 10 and 10 are the starting values.</p>
      </div>
      <div className="tb-card p-3">
        <h2 className="text-sm font-medium">Your data</h2>
        <p className="mt-1 text-xs text-faint">Trades are kept in this app on this device. Copy a backup now and then.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className="h-11 rounded-md border border-line text-sm" onClick={() => share("json")}>Copy backup (JSON)</button>
          <button type="button" className="h-11 rounded-md border border-line text-sm" onClick={() => share("csv")}>Copy trades (CSV)</button>
        </div>
        <textarea className="mt-2 h-24 w-full rounded-md border border-line bg-elev-2 p-2 text-xs text-fg" placeholder="Paste a backup here to import it" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className="h-11 rounded-md border border-line text-sm" onClick={() => setMsg(importJson(text))}>Import pasted backup</button>
          <button type="button" className={`h-11 rounded-md border text-sm ${confirm ? "border-down text-down" : "border-line text-muted"}`} onClick={() => { if (confirm) { clearAll(); setConfirm(false); setMsg("Learning data cleared."); } else setConfirm(true); }}>{confirm ? "Tap again to erase" : "Erase learning data"}</button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
      </div>
    </>
  );
}
