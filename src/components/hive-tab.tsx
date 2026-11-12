import { useMemo, useState, type ReactNode } from "react";
import { AGENTS, ANALYSTS, KEYED } from "@/lib/hive/agents";
import { ago, money, px } from "@/lib/format";
import type { DeskVenue, Style } from "@/lib/hive/types";
import type { BookPosition } from "@/lib/trade/account";
import { useBrain } from "@/stores/brain";
import { slotFor, useHive, type Receipt } from "@/stores/hive";
import { AgentKeys, HiveSettings } from "./hive-keys";
import { LearnPanel } from "./hive-learn";
import { RadarPanel } from "./radar-panel";
import { AgentStrip, ColonyRoom } from "./hive-room";
import { Connect } from "./connect-tab";
import { closePositionNow } from "./use-engine";
import { labelOf } from "./ui";

const agentColor = (id: string) => AGENTS.find((a) => a.id === id)?.color ?? "#8196ab";
const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? "Colony";
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const actionCls = (a: string) => (a === "BUY" ? "border-up/40 bg-up/10 text-up" : a === "SELL" ? "border-down/40 bg-down/10 text-down" : a === "BLOCKED" ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-elev-2 text-faint");
const card = "rounded-[22px] border border-white/80 bg-elev";

function Chip({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

function useColonyPositions() {
  const positions = useBrain((s) => s.positions);
  return useMemo(() => positions.filter((p) => p.hive === true), [positions]);
}

// ---------- desks: one per connected broker ----------

function DeskCard({ venue, onConnect }: { venue: DeskVenue; onConnect: () => void }) {
  const pref = useHive((s) => s.desks[venue]);
  const live = useHive((s) => s.deskLive[venue]);
  const armed = useHive((s) => s.armed);
  const cfgScalp = useHive((s) => s.config.scalp.roundSec);
  const cfgTrader = useHive((s) => s.config.trader.roundSec);
  const setDesk = useHive((s) => s.setDesk);
  const conn = useBrain((s) => s.conn[venue]);
  const connected = conn.status === "connected";
  const style: Style = venue === "deriv" ? "scalp" : pref.style;
  const title = venue === "deriv" ? "Deriv" : "Binance";
  const real = connected && !conn.demo;
  const state = !connected ? "Not connected" : !pref.on ? "Off" : live.paused ? live.paused : armed ? `Working · a round every ${style === "scalp" ? cfgScalp : cfgTrader}s` : "Ready. Wake the colony to start.";
  return (
    <div className={`${card} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${!connected ? "bg-faint" : live.paused && live.paused !== "Off" ? "bg-warn" : "bg-up"}`} aria-hidden="true" />
          <span className="truncate text-sm font-semibold">{title}</span>
          {connected && <Chip cls={real ? "border-warn/40 bg-warn/10 text-warn" : "border-up/40 bg-up/10 text-up"}>{real ? "REAL" : "DEMO"}</Chip>}
        </div>
        {connected ? (
          <button type="button" role="switch" aria-checked={pref.on} aria-label={`${title} desk on or off`} className={`relative h-7 w-12 shrink-0 rounded-full ${pref.on ? "bg-accent" : "bg-elev-2"} border border-line`} onClick={() => setDesk(venue, { on: !pref.on })}>
            <span className={`absolute top-0.5 h-5.5 w-5.5 rounded-full bg-white shadow ${pref.on ? "right-0.5" : "left-0.5"}`} style={{ height: 22, width: 22 }} />
          </button>
        ) : (
          <button type="button" className="h-8 rounded-full bg-accent px-3 text-xs font-medium text-accent-fg" onClick={onConnect}>
            Connect
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-elev-2 p-1" role="radiogroup" aria-label={`${title} trading style`}>
        {(["scalp", "trader"] as Style[]).map((st) => {
          const locked = venue === "deriv" && st === "trader";
          return (
            <button key={st} type="button" role="radio" aria-checked={style === st} disabled={locked} className={`h-8 rounded-full text-xs disabled:opacity-40 ${style === st ? "bg-white font-semibold text-fg shadow" : "text-muted"}`} onClick={() => setDesk(venue, { style: st })}>
              {st === "scalp" ? "Scalp" : "Trader"}
            </button>
          );
        })}
      </div>
      {venue === "deriv" && <p className="-mt-1 text-[10px] leading-snug text-faint">Deriv contracts have a fixed duration, so this desk always scalps.</p>}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-faint">Equity</p>
          <p className="mt-0.5 font-medium">{live.equity != null ? money(live.equity) : "—"}</p>
        </div>
        <div>
          <p className="text-faint">Today</p>
          <p className={`mt-0.5 font-medium ${live.dayPnl >= 0 ? "text-up" : "text-down"}`}>{live.equity != null ? money(live.dayPnl) : "—"}</p>
        </div>
        <div>
          <p className="text-faint">Open</p>
          <p className="mt-0.5 font-medium">{live.open}</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted">
        <input type="checkbox" checked={pref.sim} onChange={(e) => setDesk(venue, { sim: e.target.checked })} className="h-4 w-4" />
        Practice: simulate the orders on real prices
      </label>
      <p className={`text-[11px] leading-snug ${live.paused && live.paused !== "Off" && live.paused !== "Not connected" ? "text-warn" : "text-muted"}`}>{state}</p>
    </div>
  );
}

function Wake({ onConnect }: { onConnect: () => void }) {
  const armed = useHive((s) => s.armed);
  const keys = useHive((s) => s.keys);
  const keyState = useHive((s) => s.keyState);
  const desks = useHive((s) => s.desks);
  const setArmed = useHive((s) => s.setArmed);
  const conn = useBrain((s) => s.conn);
  const analysts = useMemo(() => ANALYSTS.filter((a) => slotFor({ keys, keyState }, a)).length, [keys, keyState]);
  const awake = useMemo(() => KEYED.filter((a) => slotFor({ keys, keyState }, a)).length, [keys, keyState]);
  const deskCount = (["deriv", "binance"] as DeskVenue[]).filter((v) => conn[v].status === "connected" && desks[v].on).length;
  const ready = analysts > 0 && deskCount > 0;
  const steps = [
    { done: deskCount > 0, text: "Connect a demo account" },
    { done: analysts > 0, text: "Add AI keys" },
    { done: armed, text: "Wake the colony" },
  ];
  return (
    <section className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
          <p className="mt-0.5 text-xs text-muted">Your colony&apos;s summary and activity.</p>
        </div>
        <button
          type="button"
          aria-pressed={armed}
          disabled={!armed && !ready}
          className={`h-11 shrink-0 rounded-full px-5 text-sm font-semibold disabled:opacity-40 ${armed ? "bg-up text-white" : "bg-accent text-accent-fg"}`}
          onClick={() => {
            if (!armed && deskCount === 0) return onConnect();
            setArmed(!armed);
            useHive.getState().say("colony", !armed ? `The colony is awake: ${deskCount} desk${deskCount === 1 ? "" : "s"}, ${awake} AI agents on the job.` : "The colony went back to sleep. Open trades are still watched.", "info");
          }}
        >
          {armed ? "Awake · tap to sleep" : ready ? "Wake the colony" : "Not ready"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {steps.map((st, i) => (
          <span key={st.text} className={`rounded-full border px-2.5 py-1 text-[11px] ${st.done ? "border-up/40 bg-up/10 text-up" : "border-line text-faint"}`}>
            {st.done ? "✓" : i + 1} {st.text}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---------- numbers ----------

function Gauge({ value, max, label }: { value: number; max: number; label: string }) {
  const N = 28;
  const cx = 100;
  const cy = 100;
  const filled = Math.round((value / max) * N);
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`;
  return (
    <svg viewBox="0 0 200 118" className="block w-full" role="img" aria-label={`${label}: ${value} of ${max}`}>
      {Array.from({ length: N }, (_, i) => {
        const a0 = Math.PI - (i / N) * Math.PI - 0.012;
        const a1 = Math.PI - ((i + 1) / N) * Math.PI + 0.012;
        const d = `M${pt(92, a0)} A92,92 0 0 1 ${pt(92, a1)} L${pt(62, a1)} A62,62 0 0 0 ${pt(62, a0)} Z`;
        return <path key={i} d={d} fill={i < filled ? `rgba(34,180,212,${0.3 + (0.7 * i) / N})` : "#dbe7f1"} />;
      })}
      <text x="100" y="86" textAnchor="middle" fontSize="34" fontWeight="600" fill="#0f2744">
        {value}
      </text>
      <text x="100" y="104" textAnchor="middle" fontSize="10" fill="#4b6279">
        {label}
      </text>
    </svg>
  );
}

function WeekBars({ closed }: { closed: BookPosition[] }) {
  const days = useMemo(() => {
    const out: { t0: number; label: string; pnl: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      out.push({ t0: d.getTime(), label: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()]!, pnl: 0 });
    }
    for (const p of closed) {
      const t = p.closedAt ?? 0;
      const day = out.find((d) => t >= d.t0 && t < d.t0 + 86_400_000);
      if (day) day.pnl += p.pnl ?? 0;
    }
    return out;
  }, [closed]);
  const maxAbs = Math.max(1e-9, ...days.map((d) => Math.abs(d.pnl)));
  const hasNeg = days.some((d) => d.pnl < 0);
  const base = hasNeg ? 62 : 84;
  const scale = (hasNeg ? 50 : 70) / maxAbs;
  const best = days.reduce((b, d) => (d.pnl > b.pnl ? d : b), days[0]!);
  return (
    <svg viewBox="0 0 280 118" className="block w-full" role="img" aria-label="Colony profit for the last seven days">
      <defs>
        <linearGradient id="wk-up" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22b4d4" />
          <stop offset="100%" stopColor="#bfe9f3" />
        </linearGradient>
      </defs>
      {days.map((d, i) => {
        const h = Math.max(3, Math.abs(d.pnl) * scale);
        const x = 10 + i * 38;
        const isBest = d === best && d.pnl > 0;
        return (
          <g key={d.t0}>
            <rect x={x} y={d.pnl >= 0 ? base - h : base} width="26" height={h} rx="8" fill={d.pnl < 0 ? "#f3b4b8" : isBest ? "url(#wk-up)" : "#d8eaf3"} />
            <text x={x + 13} y="112" textAnchor="middle" fontSize="9" fill="#8196ab">
              {d.label}
            </text>
            {isBest && (
              <text x={x + 13} y={base - h - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill="#0f2744">
                {money(d.pnl)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function EquityCurve({ closed }: { closed: BookPosition[] }) {
  const curve = useMemo(() => {
    const rows = [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    let cum = 0;
    let peak = 0;
    let dd = 0;
    const pts = [0];
    for (const p of rows) {
      cum += p.pnl ?? 0;
      pts.push(cum);
      peak = Math.max(peak, cum);
      dd = Math.min(dd, cum - peak);
    }
    return { pts, cum, peak, dd };
  }, [closed]);
  const W = 300;
  const H = 70;
  const lo = Math.min(0, ...curve.pts);
  const hi = Math.max(0, ...curve.pts);
  const span = hi - lo || 1;
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (H - 12);
  const x = (i: number) => (curve.pts.length < 2 ? 0 : (i / (curve.pts.length - 1)) * W);
  const line = curve.pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const col = curve.cum >= 0 ? "#0f9d78" : "#dd4f58";
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Colony profit curve">
        <defs>
          <linearGradient id="hive-eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.35" />
            <stop offset="100%" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="#8196ab" strokeOpacity="0.4" strokeDasharray="3 3" />
        {curve.pts.length > 1 ? (
          <>
            <polygon points={`0,${y(0)} ${line} ${W},${y(0)}`} fill="url(#hive-eq)" />
            <polyline points={line} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" />
          </>
        ) : (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="9" fill="#8196ab">
            No closed colony trades yet
          </text>
        )}
      </svg>
      <p className="mt-1 text-[11px] text-faint">
        Best {money(curve.peak)} · deepest dip {money(curve.dd)}
      </p>
    </div>
  );
}

function Numbers() {
  const deskLive = useHive((s) => s.deskLive);
  const agents = useHive((s) => s.agents);
  const callsMin = useHive((s) => s.callsMin);
  const callsCap = useHive((s) => s.config.callsPerMin);
  const mine = useColonyPositions();
  const closed = useMemo(() => mine.filter((p) => p.status === "closed"), [mine]);
  const wins = closed.filter((p) => (p.pnl ?? 0) > 0).length;
  const total = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const eqs = (["deriv", "binance"] as DeskVenue[]).map((v) => deskLive[v]).filter((d) => d.equity != null);
  const equity = eqs.reduce((s, d) => s + (d.equity ?? 0), 0);
  const day = eqs.reduce((s, d) => s + d.dayPnl, 0);
  const dayPct = equity - day > 0 ? (day / (equity - day)) * 100 : 0;
  const awake = AGENTS.filter((a) => a.kind !== "builtin" && agents[a.id].phase !== "asleep").length;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="navy-card rounded-[22px] p-4 shadow-[0_14px_30px_rgba(14,47,92,0.3)]">
        <p className="text-xs text-white/70">Total equity</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{eqs.length ? money(equity) : "—"}</p>
        {eqs.length > 0 && <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${day >= 0 ? "bg-white/20 text-[#9ff0d6]" : "bg-white/20 text-[#ffb3b8]"}`}>{`${day >= 0 ? "+" : ""}${dayPct.toFixed(2)}% today`}</span>}
      </div>
      <div className={`${card} p-4`}>
        <p className="text-xs text-muted">Colony profit</p>
        <p className={`mt-2 text-2xl font-semibold tracking-tight ${total >= 0 ? "text-fg" : "text-down"}`}>{money(total)}</p>
        <span className="mt-2 inline-flex rounded-full bg-aqua/15 px-2 py-0.5 text-[10px] font-semibold text-accent">{closed.length ? `${Math.round((wins / closed.length) * 100)}% wins · ${closed.length} trades` : "no trades yet"}</span>
      </div>
      <div className={`${card} p-4`}>
        <p className="text-xs text-muted">Agents awake</p>
        <Gauge value={awake} max={10} label={`of 10 · ${callsMin}/${callsCap} calls a min`} />
      </div>
      <div className={`${card} p-4`}>
        <p className="text-xs text-muted">Last 7 days</p>
        <WeekBars closed={closed} />
      </div>
      <div className={`${card} col-span-2 p-4`}>
        <p className="text-xs text-muted">Profit curve</p>
        <EquityCurve closed={closed} />
      </div>
    </div>
  );
}

// ---------- lists ----------

function Verdicts() {
  const verdicts = useHive((s) => s.verdicts);
  return (
    <section className={card}>
      <h3 className="px-4 pt-4 text-sm font-semibold">Across the colony</h3>
      {verdicts.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-xs text-muted">No market has been judged yet. Once the colony is awake, each round&apos;s verdict and the reason appear here.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 px-3 pb-3">
          {verdicts.map((v) => (
            <li key={v.symbol} className="flex items-start justify-between gap-3 rounded-2xl bg-bg/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{labelOf(v.symbol)}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{v.reason}</p>
              </div>
              <div className="shrink-0 text-right">
                <Chip cls={actionCls(v.action)}>{v.action}</Chip>
                <p className="mt-1 text-[10px] text-faint">{ago(v.t)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedPanel() {
  const feed = useHive((s) => s.feed);
  const rounds = useHive((s) => s.rounds);
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold">Colony chatter</h3>
        <span className="text-[11px] text-faint">{rounds} rounds so far</span>
      </div>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {feed.slice(0, 40).map((f, i) => (
          <li key={`${f.t}-${i}`} className="flex gap-2 border-t border-line px-4 py-2 text-xs leading-snug">
            <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: f.agent === "colony" ? "#8196ab" : agentColor(f.agent) }} />
            <span className="min-w-0">
              <span className="text-faint">
                {clock(f.t)} · {agentName(f.agent)}{" "}
              </span>
              <span className={f.tone === "good" ? "text-up" : f.tone === "bad" ? "text-down" : "text-muted"}>{f.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Positions({ mine }: { mine: BookPosition[] }) {
  const quotes = useBrain((s) => s.quotes);
  const [busy, setBusy] = useState("");
  const open = mine.filter((p) => p.status === "open");
  if (!open.length) return <p className="px-4 py-4 text-xs text-muted">No colony trades are open.</p>;
  return (
    <ul>
      {open.map((p) => {
        const q = quotes[p.symbol]?.last;
        const pnl = p.venue === "deriv" ? (p.livePnl ?? 0) : q ? (p.side === "BUY" ? q - p.entry : p.entry - q) * p.qty : 0;
        return (
          <li key={p.id} className="border-t border-line px-4 py-3 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">
                <Chip cls={actionCls(p.side)}>{p.side}</Chip> {labelOf(p.symbol)} <span className="text-[10px] text-faint">{p.hiveStyle ?? ""}</span>
              </span>
              <span className={`text-sm font-medium ${pnl >= 0 ? "text-up" : "text-down"}`}>{money(pnl)}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Entry {px(p.entry)} · stop {p.venue === "deriv" ? "contract stake" : px(p.stop)} · target {px(p.target)} · {p.venue} · {ago(p.openedAt)}
            </p>
            <button
              type="button"
              disabled={busy === p.id}
              className="mt-2 h-9 rounded-full border border-line px-4 text-xs text-muted disabled:opacity-50"
              onClick={async () => {
                setBusy(p.id);
                try {
                  await closePositionNow(p.id);
                } catch (err) {
                  useHive.getState().say("colony", `Could not close ${p.symbol}: ${err instanceof Error ? err.message : "unknown error"}`, "bad");
                } finally {
                  setBusy("");
                }
              }}
            >
              {busy === p.id ? "Closing…" : "Close now"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Orders({ mine }: { mine: BookPosition[] }) {
  const receipts = useHive((s) => s.receipts);
  if (!receipts.length) return <p className="px-4 py-4 text-xs text-muted">No orders have been sent yet.</p>;
  return (
    <ul>
      {receipts.map((r) => {
        const pos = mine.find((p) => p.id === r.posId);
        return (
          <li key={r.id} className="border-t border-line px-4 py-2.5 text-xs first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">
                <Chip cls={actionCls(r.side)}>{r.side}</Chip> {labelOf(r.symbol)}
              </span>
              <Chip cls={r.outcome === "failed" ? "border-down/40 bg-down/10 text-down" : r.outcome === "closed" ? "border-line bg-elev-2 text-faint" : "border-up/40 bg-up/10 text-up"}>{r.outcome === "failed" ? "REJECTED" : r.outcome === "closed" ? "CLOSED" : "FILLED"}</Chip>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {clock(r.t)} · {r.venue} · {r.style} · qty {r.qty} @ {px(r.entry)}
              {pos?.brokerOrderId ? ` · order ${pos.brokerOrderId}` : ""}
            </p>
            {r.failNote && <p className="mt-1 text-[11px] text-down">{r.failNote}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function Receipts() {
  const receipts = useHive((s) => s.receipts);
  if (!receipts.length) return <p className="px-4 py-4 text-xs text-muted">Every trade gets a receipt that shows how each agent voted and why. None yet.</p>;
  return (
    <ul>
      {receipts.map((r: Receipt) => (
        <li key={r.id} className="border-t border-line first:border-t-0">
          <details className="px-4 py-2.5">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
              <span className="truncate">
                <Chip cls={actionCls(r.side)}>{r.side}</Chip> {labelOf(r.symbol)}
              </span>
              <span className={`shrink-0 text-xs ${r.pnl == null ? "text-faint" : r.pnl >= 0 ? "text-up" : "text-down"}`}>{r.pnl == null ? (r.outcome === "failed" ? "rejected" : "open") : money(r.pnl)}</span>
            </summary>
            <p className="mt-2 text-[11px] leading-snug text-muted">{r.reason}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {r.votes.map((v) => (
                <li key={v.agent} className="text-[11px] leading-snug">
                  <span style={{ color: agentColor(v.agent) }}>{agentName(v.agent)}</span> <span className={v.vote === "BUY" ? "text-up" : v.vote === "SELL" ? "text-down" : "text-faint"}>{v.vote}</span> <span className="text-faint">{v.confidence.toFixed(0)}</span> <span className="text-muted">{v.note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-faint">
              {r.style} · entry {px(r.entry)} · stop {px(r.stop)} · target {px(r.target)} · {clock(r.t)}
              {r.exitReason ? ` · exit: ${r.exitReason}` : ""}
              {r.r != null ? ` · ${r.r >= 0 ? "+" : ""}${r.r.toFixed(1)}R` : ""}
            </p>
            {r.tags && r.tags.length > 0 && <p className="mt-1 text-[11px] text-warn">{r.tags.map((t) => t.replace(/-/g, " ")).join(" · ")}</p>}
            {r.journal && (
              <p className="mt-1 text-[11px] leading-snug" style={{ color: agentColor("journal") }}>
                Journal: {r.journal}
              </p>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}

function Books() {
  const [tab, setTab] = useState<"positions" | "orders" | "receipts">("positions");
  const mine = useColonyPositions();
  const openCount = mine.filter((p) => p.status === "open").length;
  const receiptCount = useHive((s) => s.receipts.length);
  const tabs: { id: typeof tab; label: string; n: number }[] = [
    { id: "positions", label: "Positions", n: openCount },
    { id: "orders", label: "Broker orders", n: receiptCount },
    { id: "receipts", label: "Agent receipts", n: receiptCount },
  ];
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="grid grid-cols-3 gap-1 p-2">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`h-10 rounded-full text-xs ${tab === t.id ? "bg-accent font-medium text-accent-fg" : "text-muted"}`} onClick={() => setTab(t.id)}>
            {t.label} <span className={tab === t.id ? "text-white/70" : "text-faint"}>{t.n}</span>
          </button>
        ))}
      </div>
      {tab === "positions" && <Positions mine={mine} />}
      {tab === "orders" && <Orders mine={mine} />}
      {tab === "receipts" && <Receipts />}
    </section>
  );
}

export function HiveTab() {
  const [connect, setConnect] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Wake onConnect={() => setConnect(true)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskCard venue="deriv" onConnect={() => setConnect(true)} />
        <DeskCard venue="binance" onConnect={() => setConnect(true)} />
      </div>
      <Numbers />
      <RadarPanel />
      <ColonyRoom />
      <AgentStrip />
      <Verdicts />
      <Books />
      <LearnPanel />
      <FeedPanel />
      <AgentKeys />
      <HiveSettings />
      <p className="px-1 text-[11px] leading-relaxed text-faint">The agents are AI language models. They can be wrong, slow or unavailable, and past results do not predict future ones. Keep this on demo accounts until you have watched it for a long time.</p>
      {connect && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-[#0f2744]/60 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Connect accounts">
          <div className="mx-auto flex max-w-xl flex-col gap-3 pb-10">
            <div className="glass sticky top-0 z-10 flex items-center justify-between rounded-[22px] px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Your trading accounts</p>
                <p className="text-[11px] text-muted">Connect Deriv and Binance. The colony sets up a desk for each.</p>
              </div>
              <button type="button" className="h-10 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg" onClick={() => setConnect(false)}>
                Done
              </button>
            </div>
            <Connect />
          </div>
        </div>
      )}
    </div>
  );
}
