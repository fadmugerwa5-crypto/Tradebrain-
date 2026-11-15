import { useMemo, useState } from "react";
import { AGENTS } from "@/lib/hive/agents";
import { scorecards, weightsFrom } from "@/lib/hive/learn";
import { runLab } from "@/lib/learn/backtest";
import type { Candle } from "@/lib/market/types";
import type { AgentId, AgentBudgetPolicy } from "@/lib/hive/types";
import { useBrain } from "@/stores/brain";
import { profileFor, useHive } from "@/stores/hive";

const card = "rounded-[22px] border border-line bg-elev p-4";
const fmtTime = (t: number) => t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
const pct = (n: number) => `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="rounded-2xl bg-bg/60 p-3"><p className="text-[10px] text-faint">{label}</p><p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>{hint && <p className="mt-0.5 text-[10px] text-faint">{hint}</p>}</div>;
}

function BudgetField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return <label className="block text-[10px] text-faint">{label}<input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value) || min))))} className="mt-1 h-9 w-full rounded-xl border border-line bg-elev-2 px-2 text-xs text-fg outline-none focus:border-accent" /></label>;
}

function BudgetRow({ id, name, color }: { id: AgentId; name: string; color: string }) {
  const policy = useHive((s) => s.budgetPolicies[id]);
  const usage = useHive((s) => s.budgetUsage[id]);
  const patchBudget = useHive((s) => s.patchBudget);
  const keys = useHive((s) => s.keys);
  const keyState = useHive((s) => s.keyState);
  const ownReady = !!keys[id]?.key && keyState[id]?.status === "ready";
  const sharedReady = !!keys.shared?.key && keyState.shared?.status === "ready";
  const ready = profileFor(useHive.getState(), id) != null;
  const day = new Date().toISOString().slice(0, 10);
  const used = usage.day === day ? usage.calls : 0;
  const cached = usage.day === day ? usage.cached : 0;
  const blocked = usage.day === day ? usage.blocked : 0;
  const errors = usage.day === day ? usage.errors : 0;
  const update = (p: Partial<AgentBudgetPolicy>) => patchBudget(id, p);
  const builtin = id === "watchdog";
  return (
    <details className="rounded-2xl border border-line bg-bg/45 p-3" open={id === "scout" || id === "master"}>
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 text-sm font-medium">{name}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] ${builtin ? "border-line text-faint" : ready ? "border-up/40 text-up" : "border-warn/40 text-warn"}`}>{builtin ? "BUILT IN" : ownReady ? "OWN KEY READY" : sharedReady ? "SHARED FALLBACK" : ready ? "READY" : "NO KEY"}</span>
        {!builtin && <span className="text-[10px] text-faint">{used}/{policy.dailyCalls > 0 ? policy.dailyCalls : "∞"} today</span>}
      </summary>
      {!builtin && <>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Metric label="API calls" value={used} />
          <Metric label="Cache hits" value={cached} />
          <Metric label="Blocked" value={blocked} />
          <Metric label="Errors" value={errors} />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-bg/50 px-3 py-2 text-xs">
          <span>Allow this brain to call its own provider</span>
          <input aria-label={`${name} API calls enabled`} type="checkbox" checked={policy.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="h-4 w-4" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <BudgetField label="Daily API call cap" value={policy.dailyCalls} min={0} max={5000} onChange={(n) => update({ dailyCalls: n })} />
          <BudgetField label="Calls per minute" value={policy.perMinute} min={0} max={60} onChange={(n) => update({ perMinute: n })} />
          <BudgetField label="Cooldown seconds" value={policy.cooldownSec} min={0} max={3600} onChange={(n) => update({ cooldownSec: n })} />
          <BudgetField label="Identical-prompt cache seconds" value={policy.cacheSec} min={0} max={3600} onChange={(n) => update({ cacheSec: n })} />
          <BudgetField label="Maximum input characters" value={policy.maxInputChars} min={500} max={6000} onChange={(n) => update({ maxInputChars: n })} />
          <BudgetField label="Maximum output tokens" value={policy.maxOutputTokens} min={64} max={2048} onChange={(n) => update({ maxOutputTokens: n })} />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-faint">Last real request: {fmtTime(usage.lastAt)}. Cache is used only for an identical brain, model and prompt. Risk Guard, Executor and Master default to no cached approvals.</p>
      </>}
    </details>
  );
}

export function IntelligenceTab() {
  const markets = useBrain((s) => s.markets);
  const positions = useBrain((s) => s.positions);
  const candleMap = useBrain((s) => s.candles);
  const enabled = useBrain((s) => s.settings.enabled);
  const radar = useBrain((s) => s.radar);
  const feedAt = useBrain((s) => s.feedAt);
  const setView = useBrain((s) => s.setView);
  const lessons = useHive((s) => s.lessons);
  const memory = useHive((s) => s.agentMemory);
  const receipts = useHive((s) => s.receipts);
  const agents = useHive((s) => s.agents);
  const budgetUsage = useHive((s) => s.budgetUsage);
  const clearBudgetUsage = useHive((s) => s.clearBudgetUsage);
  const [showAll, setShowAll] = useState(false);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchProgress, setResearchProgress] = useState("");
  const [researchRows, setResearchRows] = useState<{ symbol: string; strategy: string; bars: number; n: number; winRate: number; expectancy: number; profitFactor: number | null; drawdown: number }[]>([]);
  const cards = useMemo(() => scorecards(lessons), [lessons]);
  const weights = useMemo(() => weightsFrom(cards), [cards]);
  const calibration = useMemo(() => {
    const byId = new Map(lessons.map((l) => [l.id, l]));
    return Object.fromEntries(AGENTS.map((a) => {
      const rows = receipts.flatMap((r) => {
        const lesson = byId.get(r.id);
        const vote = r.votes.find((v) => v.agent === a.id);
        if (!lesson || !vote) return [];
        const actual = lesson.right.includes(a.id) ? 1 : lesson.wrong.includes(a.id) ? 0 : null;
        return actual == null ? [] : [{ confidence: vote.confidence / 100, actual }];
      });
      const brier = rows.length ? rows.reduce((sum, x) => sum + (x.confidence - x.actual) ** 2, 0) / rows.length : null;
      const accuracy = rows.length ? rows.reduce((sum, x) => sum + x.actual, 0) / rows.length : null;
      const confidence = rows.length ? rows.reduce((sum, x) => sum + x.confidence, 0) / rows.length : null;
      return [a.id, { n: rows.length, brier, accuracy, confidence }];
    })) as Record<AgentId, { n: number; brier: number | null; accuracy: number | null; confidence: number | null }>;
  }, [lessons, receipts]);
  const candidates = radar?.shortlist ?? [];
  const chosen = new Set(radar?.chosen ?? []);
  const totalCalls = Object.values(budgetUsage).reduce((n, u) => n + u.calls, 0);
  const totalCache = Object.values(budgetUsage).reduce((n, u) => n + u.cached, 0);
  const totalBlocked = Object.values(budgetUsage).reduce((n, u) => n + u.blocked, 0);
  const readyBrains = AGENTS.filter((a) => a.kind !== "builtin" && profileFor(useHive.getState(), a.id)).length;
  const rows = showAll ? candidates : candidates.slice(0, 5);
  const managedReceipts = receipts.filter((r) => r.managementState || (r.managementEvents?.length ?? 0) > 0);
  const openHivePositions = positions.filter((p) => p.hive && p.status === "open");
  const normalPullbacks = managedReceipts.filter((r) => r.managementState === "NORMAL_PULLBACK").length;
  const invalidated = managedReceipts.filter((r) => r.managementState === "THESIS_INVALIDATED").length;
  const blockedExits = managedReceipts.reduce((n, r) => n + (r.earlyExitBlocked ?? 0), 0);
  const runLocalResearch = async () => {
    if (researchBusy) return;
    const loaded = Object.entries(candleMap).filter(([, cs]) => Array.isArray(cs) && cs.length >= 80) as [string, Candle[]][];
    if (!loaded.length) { setResearchProgress("No markets have at least 80 loaded candles yet. Connect a broker and allow market data to load."); return; }
    setResearchBusy(true); setResearchRows([]); setResearchProgress(`Starting local research on ${loaded.length} markets…`);
    const found: typeof researchRows = [];
    for (let i = 0; i < loaded.length; i++) {
      const [symbol, candles] = loaded[i]!;
      try {
        const lab = runLab({ candles, kind: "scalp", htfMin: 15 });
        for (const row of lab.rows) found.push({ symbol, strategy: row.strategy, bars: lab.bars, n: row.holdout.n, winRate: row.holdout.winRate, expectancy: row.holdout.expectancy, profitFactor: row.holdout.profitFactor, drawdown: row.holdout.maxDrawdownR });
      } catch { /* One incomplete market must not stop the rest of the research sweep. */ }
      setResearchProgress(`Researching ${i + 1}/${loaded.length}: ${symbol}`);
      if (i % 2 === 1) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    found.sort((a, b) => b.expectancy - a.expectancy || b.n - a.n);
    setResearchRows(found.slice(0, 30));
    setResearchProgress(`Finished ${loaded.length} markets. ${found.length} market/strategy combinations were measured on unseen holdout data. No live rules were changed.`);
    setResearchBusy(false);
  };

  return <div className="flex flex-col gap-3">
    <section className="rounded-[22px] border border-line bg-elev p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">TradeBrain intelligence</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Intelligence Command</h2><p className="mt-1 text-xs leading-relaxed text-muted">Live market discovery, independent AI brains, individual API budgets, performance and learned memory. Existing brain keys and settings are unchanged.</p></div>
        <span className="rounded-full border border-up/40 bg-up/10 px-2.5 py-1 text-[10px] text-up">{readyBrains} AI brains ready</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Broker markets" value={markets.length} hint={`${enabled.length} enabled for scanning`} />
        <Metric label="Radar coverage" value={radar ? `${radar.withData}/${radar.total}` : "—"} hint={radar?.warm && !radar.warm.done ? `Warm-up ${radar.warm.pct}%` : "Loaded market data"} />
        <Metric label="API calls today" value={totalCalls} hint="All individual brains" />
        <Metric label="Saved calls" value={totalCache + totalBlocked} hint={`${totalCache} cache · ${totalBlocked} blocked`} />
      </div>
    </section>

    <section className={card}>
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Market discovery pipeline</h3><p className="mt-1 text-[11px] text-faint">Data engine → local Radar → ranked candidates → Scout → specialist brains → Master → Risk Guard → Executor.</p></div><span className={`rounded-full border px-2 py-1 text-[9px] ${radar?.warm?.done ? "border-up/40 text-up" : "border-warn/40 text-warn"}`}>{radar?.warm?.done ? "WARM" : "WARMING / WAITING"}</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Markets scanned" value={radar?.total ?? 0} />
        <Metric label="Markets with data" value={radar?.withData ?? 0} />
        <Metric label="Signals found" value={radar?.signals ?? 0} />
      </div>
      {radar && <>
        <p className="mt-3 rounded-xl bg-bg/60 p-3 text-xs leading-relaxed text-muted">{radar.note} {radar.interval} candles · {radar.warm.pct}% warm-up coverage · last sweep {fmtTime(radar.at)}. Market feed last updated {fmtTime(feedAt ?? 0)}.</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-faint">
          <span className="rounded-full bg-bg px-2 py-1">No edge: {radar.rejected.noEdge}</span><span className="rounded-full bg-bg px-2 py-1">Fees: {radar.rejected.fees}</span><span className="rounded-full bg-bg px-2 py-1">Stale: {radar.rejected.stale}</span><span className="rounded-full bg-bg px-2 py-1">Learning: {radar.rejected.learned}</span><span className="rounded-full bg-bg px-2 py-1">Unsure: {radar.rejected.unsure}</span><span className="rounded-full bg-bg px-2 py-1">Benched: {radar.rejected.benched}</span><span className="rounded-full bg-bg px-2 py-1">Crowded: {radar.rejected.crowded}</span>
        </div>
        <div className="mt-3 flex items-center justify-between"><h4 className="text-xs font-semibold">Top ranked candidates</h4>{candidates.length > 5 && <button type="button" onClick={() => setShowAll(!showAll)} className="text-[10px] text-accent underline">{showAll ? "Show top five" : `Show all ${candidates.length}`}</button>}</div>
        {rows.length ? <ul className="mt-1">{rows.map((c, i) => <li key={c.key} className="border-t border-line py-3 first:border-t-0"><div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-medium">{i + 1}. {c.label} <span className={c.side === "BUY" ? "text-up" : "text-down"}>{c.side}</span></span><span className="shrink-0 text-xs font-semibold">{c.score}/100</span></div><p className="mt-1 text-[10px] text-faint">{c.strategyName} · {c.group} · {c.edge.trades} historical samples · {pct(c.edge.winRate)} wins · {c.edge.avgR >= 0 ? "+" : ""}{c.edge.avgR.toFixed(2)}R average</p><p className="mt-1 text-[10px] text-muted">{c.why} {c.ai ? `· AI ${c.ai.action}: ${c.ai.reason}` : "· Local rules ranking"}</p>{chosen.has(c.symbol) && <span className="mt-1 inline-flex rounded-full border border-up/40 bg-up/10 px-2 py-0.5 text-[9px] text-up">Selected by radar</span>}</li>)}</ul> : <p className="mt-3 text-xs text-faint">No shortlist yet. Connect a broker, load market candles and let Radar finish warming up.</p>}
      </>}
      {!radar && <p className="mt-3 text-xs text-faint">Radar has not completed its first sweep yet. It scans locally and does not need AI calls for ordinary indicators.</p>}
    </section>

    <section className={card}>
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">AI Budget Manager</h3><p className="mt-1 text-[11px] text-faint">Separate daily caps, per-minute limits, cooldowns, prompt sizes and cache settings for every brain. Each brain continues using its own configured API key.</p></div><button type="button" onClick={() => clearBudgetUsage()} className="rounded-full border border-line px-3 py-1.5 text-[10px] text-muted">Reset counters</button></div>
      <div className="mt-3 flex flex-col gap-2">{AGENTS.map((a) => <BudgetRow key={a.id} id={a.id} name={a.name} color={a.color} />)}</div>
      <p className="mt-3 text-[10px] leading-relaxed text-faint">A daily cap of 0 means unlimited by the daily cap; a per-minute cap of 0 disables that per-brain limit. Provider quotas can change, so these controls are local safety ceilings, not a guarantee of free usage. The existing colony-wide calls/minute limit still applies too.</p>
    </section>

    <section className={card}>
      <h3 className="text-sm font-semibold">Brain performance scoreboard</h3><p className="mt-1 text-[11px] text-faint">Grades come from closed trade outcomes, not the model's own confidence claims. Too little evidence is shown as learning, not as a reliable accuracy rate.</p>
      <div className="mt-3 flex flex-col gap-3">{AGENTS.filter((a) => a.kind !== "builtin").map((a) => { const c = cards[a.id]; const accuracy = c?.n ? c.right / c.n : null; const live = agents[a.id]; return <div key={a.id}><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium" style={{ color: a.color }}>{a.name}</span><span className="text-[10px] text-faint">{c?.n ? `${c.right}/${c.n} correct${weights[a.id] ? ` · weight ${weights[a.id]!.toFixed(2)}` : " · building evidence"}` : "No graded evidence"} · {live.calls} calls · {live.errors} errors</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full" style={{ width: `${(accuracy ?? 0) * 100}%`, background: a.color }} /></div><p className="mt-1 text-[9px] text-faint">{calibration[a.id].n >= 3 ? `Confidence calibration: ${(calibration[a.id].confidence! * 100).toFixed(0)}% average confidence · ${(calibration[a.id].accuracy! * 100).toFixed(0)}% observed correctness · Brier ${calibration[a.id].brier!.toFixed(3)}` : "Confidence calibration needs at least 3 graded decisions."}</p></div>; })}</div>
    </section>

    <section className={card}>
      <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">Adaptive Trade Management · Trade Survival</h3><p className="mt-1 text-[11px] leading-relaxed text-faint">Separates ordinary pullbacks from confirmed structure breaks and major profit givebacks. It does not widen or disable the original stop. Ordinary pullbacks do not consume Executor API calls.</p></div><span className="rounded-full border border-up/40 bg-up/10 px-2 py-1 text-[9px] text-up">ACTIVE</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Open HIVE positions" value={openHivePositions.length} hint="Currently monitored" />
        <Metric label="Pullback states" value={normalPullbacks} hint="Thesis still intact" />
        <Metric label="Structure invalidations" value={invalidated} hint="Sent for AI review" />
        <Metric label="Early closes blocked" value={blockedExits} hint="Stale / unsupported exits" />
      </div>
      <div className="mt-3 rounded-xl bg-bg/60 p-3 text-[10px] leading-relaxed text-muted">Protection order: exchange/local hard stop and target first → completed-candle structure monitor → Executor review only for a confirmed invalidation or significant profit giveback → recheck the evidence after the AI responds. A negative floating P&L alone is never an early-exit reason. Fixed-duration Deriv contract management retains its existing path.</div>
      {managedReceipts.length ? <ul className="mt-3 flex flex-col gap-2">{managedReceipts.slice(0, 8).map((r) => <li key={`atm-${r.id}`} className="rounded-xl border border-line bg-bg/45 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{r.symbol} · {r.side}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] ${r.managementState === "THESIS_INVALIDATED" || r.managementState === "PROFIT_GIVEBACK_RISK" ? "border-warn/40 text-warn" : "border-up/40 text-up"}`}>{(r.managementState ?? "MONITORING").replaceAll("_", " ")}</span></div><p className="mt-1 text-[10px] leading-relaxed text-muted">{r.managementNote ?? "No management note yet."}</p><p className="mt-1 text-[9px] text-faint">Blocked early exits: {r.earlyExitBlocked ?? 0} · {r.managementEvents?.length ?? 0} recorded observations</p></li>)}</ul> : <p className="mt-3 text-[10px] text-faint">No managed HIVE trades recorded yet. New Binance HIVE positions will appear here as market conditions are evaluated.</p>}
    </section>

    <section className={card}>
      <h3 className="text-sm font-semibold">Independent brain memories</h3><p className="mt-1 text-[11px] text-faint">Each brain keeps its own compact record of where its past judgement was right or wrong. Memory is generated from graded closed trades; it does not make up lessons.</p>
      <div className="mt-3 grid gap-2">{AGENTS.filter((a) => a.kind !== "builtin").map((a) => { const rows = memory[a.id] ?? []; return <details key={a.id} className="rounded-2xl border border-line bg-bg/45 p-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-2"><span className="text-xs font-medium" style={{ color: a.color }}>{a.name}</span><span className="text-[10px] text-faint">{rows.length} memories</span></summary>{rows.length ? <ul className="mt-2 flex flex-col gap-2">{rows.slice(0, 5).map((m) => <li key={m.id} className="border-t border-line pt-2 text-[10px]"><div className="flex justify-between gap-2"><span className="font-medium">{m.symbol} · {m.result.toUpperCase()}</span><span className={m.r >= 0 ? "text-up" : "text-down"}>{m.r >= 0 ? "+" : ""}{m.r.toFixed(2)}R</span></div><p className="mt-1 leading-relaxed text-muted">{m.text}</p></li>)}</ul> : <p className="mt-2 text-[10px] text-faint">No graded memory yet.</p>}</details>; })}</div>
    </section>

    <section className={card}>
      <h3 className="text-sm font-semibold">Decision replay and audit trail</h3>
      <p className="mt-1 text-[11px] text-faint">Reconstruct the decision record for each saved colony trade: which brain voted, what the proposed levels were, and how the trade finished. This is an audit replay of recorded facts, not a reconstructed tick-by-tick chart.</p>
      {receipts.length ? <ul className="mt-3 flex flex-col gap-2">{receipts.slice(0, 12).map((r) => <li key={r.id} className="rounded-2xl border border-line bg-bg/45 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{r.symbol} · {r.side} · {r.style}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] ${r.outcome === "failed" ? "border-down/40 text-down" : r.outcome === "closed" ? (r.pnl ?? 0) >= 0 ? "border-up/40 text-up" : "border-down/40 text-down" : "border-line text-faint"}`}>{r.outcome === "closed" ? `${(r.pnl ?? 0) >= 0 ? "+" : ""}${(r.pnl ?? 0).toFixed(2)}` : r.outcome.toUpperCase()}</span></div><p className="mt-1 text-[10px] text-faint">Entry {r.entry} · Stop {r.stop} · Target {r.target} · {new Date(r.t).toLocaleString()}</p><p className="mt-1 text-[10px] leading-relaxed text-muted">{r.reason}{r.exitReason ? ` · Exit: ${r.exitReason}` : r.failNote ? ` · ${r.failNote}` : ""}</p><div className="mt-2 flex flex-wrap gap-1">{r.votes.map((v) => <span key={v.agent} className={`rounded-full border px-2 py-0.5 text-[9px] ${v.vote === r.side ? "border-up/40 text-up" : v.vote === "WAIT" ? "border-line text-faint" : "border-down/40 text-down"}`}>{AGENTS.find((a) => a.id === v.agent)?.name ?? v.agent}: {v.vote} {Math.round(v.confidence)}</span>)}</div>{r.tags?.length ? <p className="mt-2 text-[9px] leading-relaxed text-warn">Recovery analysis: {r.tags.join(" · ")}{r.high != null && r.low != null ? ` · observed range ${r.low}–${r.high}` : ""}</p> : null}</li>)}</ul> : <p className="mt-2 text-xs text-faint">No colony decisions recorded yet. New trade receipts will appear here.</p>}
    </section>

    <section className={card}>
      <h3 className="text-sm font-semibold">Autonomous local research laboratory</h3><p className="mt-1 text-[11px] leading-relaxed text-faint">Run the existing strategy library across every market that currently has at least 80 loaded candles. The lab uses chronological train/validation/holdout splits and charges its configured costs. This uses local CPU, not Grok or Gemini credits. It proposes research findings only; it never changes live strategies or opens trades.</p>
      <button type="button" disabled={researchBusy} onClick={() => void runLocalResearch()} className="mt-3 h-11 w-full rounded-xl bg-accent px-3 text-xs font-semibold text-accent-fg disabled:opacity-50">{researchBusy ? "Research sweep running…" : "Run local research across loaded markets"}</button>
      {researchProgress && <p className="mt-2 rounded-xl bg-bg/60 p-3 text-[10px] leading-relaxed text-muted">{researchProgress}</p>}
      {researchRows.length > 0 && <div className="mt-3"><h4 className="text-xs font-semibold">Best holdout findings</h4><ul className="mt-2">{researchRows.slice(0, 12).map((r, i) => <li key={`${r.symbol}-${r.strategy}`} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[10px]"><span className="min-w-0"><span className="block truncate font-medium">{i + 1}. {r.symbol} · {r.strategy}</span><span className="text-faint">{r.n} holdout trades · {Math.round(r.winRate * 100)}% wins · PF {r.profitFactor == null ? "n/a" : r.profitFactor.toFixed(2)} · DD {r.drawdown.toFixed(1)}R</span></span><span className={`shrink-0 font-semibold ${r.expectancy >= 0 ? "text-up" : "text-down"}`}>{r.expectancy >= 0 ? "+" : ""}{r.expectancy.toFixed(2)}R</span></li>)}</ul><p className="mt-2 text-[9px] text-faint">A small holdout sample is weak evidence. Inspect the full Strategy Lab before approving any rule changes.</p></div>}
      <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setView("learn")} className="h-11 rounded-xl border border-line px-3 text-xs font-semibold text-muted">Open full Strategy Lab</button><button type="button" onClick={() => setView("journal")} className="h-11 rounded-xl border border-line px-3 text-xs font-semibold text-muted">Open Trade Journal</button></div>
      <p className="mt-2 text-[10px] text-faint">Current learning record: {lessons.length} graded lessons. Local strategy calculations run without spending AI credits; Journal and Coach use their own configured keys when called.</p>
    </section>
  </div>;
}
