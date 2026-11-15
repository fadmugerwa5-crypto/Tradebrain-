import { useMemo, type ReactNode } from "react";
import { AGENTS } from "@/lib/hive/agents";
import type { AgentId } from "@/lib/hive/types";
import { labelOf } from "./ui";
import { px } from "@/lib/format";
import { useBrain } from "@/stores/brain";
import { useHive, type AgentLive } from "@/stores/hive";

const W = 360;
const H = 372;
const R = 27;
const QUEEN = { x: 180, y: 238 };
const voteColor = (v: string) => (v === "BUY" ? "#0f9d78" : v === "SELL" ? "#dd4f58" : "#8196ab");

// A honeycomb: the Queen's chamber in the middle, with independent analysts, controls, memory and Master Intelligence around her.
const CELL: Record<AgentId, { x: number; y: number }> = {
  scout: { x: 180, y: 148 },
  master: { x: 180, y: 100 },
  trend: { x: 154, y: 193 },
  scalper: { x: 206, y: 193 },
  regime: { x: 128, y: 238 },
  pulse: { x: 232, y: 238 },
  risk: { x: 154, y: 283 },
  executor: { x: 206, y: 283 },
  watchdog: { x: 180, y: 328 },
  journal: { x: 76, y: 238 },
  coach: { x: 284, y: 238 },
};

const TUNNELS: [{ x: number; y: number }, { x: number; y: number }][] = [
  ...(["trend", "scalper", "regime", "pulse", "risk", "executor"] as AgentId[]).map((id): [{ x: number; y: number }, { x: number; y: number }] => [CELL[id], QUEEN]),
  [CELL.master, CELL.scout], [CELL.master, QUEEN], [CELL.scout, CELL.trend], [CELL.scout, CELL.scalper], [CELL.journal, CELL.regime], [CELL.coach, CELL.pulse], [CELL.watchdog, CELL.risk], [CELL.watchdog, CELL.executor],
  [CELL.trend, CELL.scalper], [CELL.scalper, CELL.pulse], [CELL.pulse, CELL.executor], [CELL.executor, CELL.risk], [CELL.risk, CELL.regime], [CELL.regime, CELL.trend],
];

const hex = (cx: number, cy: number, r = R) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

/** An ant drawn walking towards +x. The legs step (tripod gait) when `walking`. */
function Ant({ color, walking, scale = 1, load }: { color: string; walking: boolean; scale?: number; load?: string }) {
  // [attach x, tip x, side, phase]: front pair, middle pair, back pair.
  const legs: [number, number, number, number][] = [
    [1.6, 3.6, -1, 0], [1.6, 3.6, 1, 1],
    [-0.2, 0.4, -1, 1], [-0.2, 0.4, 1, 0],
    [-1.8, -3.4, -1, 0], [-1.8, -3.4, 1, 1],
  ];
  return (
    <g transform={`scale(${scale})`}>
      <g stroke="#0f2744" strokeOpacity="0.75" strokeWidth="0.9" strokeLinecap="round">
        {legs.map(([ax, tx, side, phase], i) => (
          <line key={i} x1={ax} y1={side * 1.4} x2={tx} y2={side * 5} >
            {walking && <animate attributeName="x2" values={`${tx - 1.8};${tx + 1.8};${tx - 1.8}`} dur="0.42s" begin={phase ? "-0.21s" : "0s"} repeatCount="indefinite" />}
          </line>
        ))}
        <line x1="5" y1="-0.9" x2="8" y2="-3" />
        <line x1="5" y1="0.9" x2="8" y2="3" />
      </g>
      <ellipse cx="-5.4" cy="0" rx="4.4" ry="3.1" fill={color} />
      <ellipse cx="-0.4" cy="0" rx="2.7" ry="2.3" fill={color} />
      <ellipse cx="3.8" cy="0" rx="2.5" ry="2.2" fill={color} />
      <circle cx="4.9" cy="-0.9" r="0.6" fill="#ffffff" />
      <circle cx="4.9" cy="0.9" r="0.6" fill="#ffffff" />
      <ellipse cx="-5.4" cy="0" rx="2.2" ry="1.2" fill="#ffffff" fillOpacity="0.3" />
      {load && <circle cx="-5.4" cy="0" r="1.9" fill={load} stroke="#ffffff" strokeWidth="0.7" />}
    </g>
  );
}

function Walker({ path, dur, begin = "0s", once = false, children }: { path: string; dur: string; begin?: string; once?: boolean; children: ReactNode }) {
  return (
    <g>
      {children}
      <animateMotion path={path} dur={dur} begin={begin} repeatCount={once ? "1" : "indefinite"} rotate="auto" fill={once ? "freeze" : "remove"} />
      {once && <set attributeName="visibility" to="hidden" begin={dur} fill="freeze" />}
    </g>
  );
}

const RING = `M${CELL.trend.x} ${CELL.trend.y} L${CELL.scalper.x} ${CELL.scalper.y} L${CELL.pulse.x} ${CELL.pulse.y} L${CELL.executor.x} ${CELL.executor.y} L${CELL.risk.x} ${CELL.risk.y} L${CELL.regime.x} ${CELL.regime.y} Z`;
const TOP = `M${CELL.scout.x} ${CELL.scout.y} L${CELL.scalper.x} ${CELL.scalper.y} L${QUEEN.x} ${QUEEN.y} L${CELL.trend.x} ${CELL.trend.y} Z`;
const BOTTOM = `M${CELL.watchdog.x} ${CELL.watchdog.y} L${CELL.executor.x} ${CELL.executor.y} L${QUEEN.x} ${QUEEN.y} L${CELL.risk.x} ${CELL.risk.y} Z`;
const WALKERS: { path: string; dur: string; begin: string; color: string }[] = [
  { path: RING, dur: "20s", begin: "0s", color: "#475f7a" },
  { path: RING, dur: "20s", begin: "-7s", color: "#6a4a2f" },
  { path: RING, dur: "20s", begin: "-14s", color: "#475f7a" },
  { path: TOP, dur: "11s", begin: "-3s", color: "#6a4a2f" },
  { path: BOTTOM, dur: "13s", begin: "-6s", color: "#475f7a" },
];

export function ColonyRoom() {
  const agents = useHive((s) => s.agents);
  const busy = useHive((s) => s.busy);
  const armed = useHive((s) => s.armed);
  const focus = useHive((s) => s.focus);
  const activeDesk = useHive((s) => s.activeDesk);
  const desks = useHive((s) => s.desks);
  const deskLive = useHive((s) => s.deskLive);
  const verdict = useHive((s) => (s.focus ? s.verdicts.find((v) => v.symbol === s.focus) : undefined));
  const candles = useBrain((s) => (focus ? s.candles[focus] : undefined));
  const tail = useMemo(() => (candles ?? []).slice(-40), [candles]);
  const lo = tail.length ? Math.min(...tail.map((c) => c.l)) : 0;
  const hi = tail.length ? Math.max(...tail.map((c) => c.h)) : 1;
  const span = hi - lo || 1;
  const cy = (p: number) => 44 + (1 - (p - lo) / span) * 52;
  const last = tail.length ? tail[tail.length - 1]!.c : null;
  const anyPaused = (["deriv", "binance"] as const).some((v) => deskLive[v].paused && deskLive[v].paused !== "Off" && deskLive[v].paused !== "Not connected");
  const badge = anyPaused ? "PAUSED" : armed ? "AWAKE" : "ASLEEP";
  const badgeColor = anyPaused ? "#cf7f14" : armed ? "#0f9d78" : "#8196ab";
  const deskTag = activeDesk ? `${activeDesk === "deriv" ? "Deriv" : "Binance"} · ${activeDesk === "deriv" ? "scalp" : desks.binance.style}` : null;
  const act = verdict && verdict.action !== "BLOCKED" ? verdict.action : null;
  const queenFill = act === "BUY" ? "url(#sd-buy)" : act === "SELL" ? "url(#sd-sell)" : "url(#sd-honey)";

  return (
    <div className="overflow-hidden rounded-[22px] border border-white/80 shadow-[0_12px_32px_rgba(15,39,68,0.1)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="The colony: agents as ants in a honeycomb hive">
        <defs>
          <linearGradient id="sd-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5fafe" />
            <stop offset="100%" stopColor="#dcecf6" />
          </linearGradient>
          <linearGradient id="sd-honey" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde9a8" />
            <stop offset="100%" stopColor="#f5b83d" />
          </linearGradient>
          <linearGradient id="sd-buy" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c8f1e2" />
            <stop offset="100%" stopColor="#3cc9a0" />
          </linearGradient>
          <linearGradient id="sd-sell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbd3d6" />
            <stop offset="100%" stopColor="#ec7a82" />
          </linearGradient>
          <pattern id="sd-hex" width="52" height="90" patternUnits="userSpaceOnUse" patternTransform="translate(2 4)">
            <g fill="none" stroke="#b9d0e2" strokeOpacity="0.55" strokeWidth="1">
              <polygon points="26,0 52,15 52,45 26,60 0,45 0,15" />
              <polygon points="0,45 26,60 26,90 0,105 -26,90 -26,60" />
              <polygon points="52,45 78,60 78,90 52,105 26,90 26,60" />
            </g>
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#sd-bg)" />
        <rect width={W} height={H} fill="url(#sd-hex)" />

        {/* Observatory */}
        <rect x="14" y="12" width="332" height="100" rx="16" fill="#ffffff" fillOpacity="0.78" stroke="#ffffff" />
        <text x="26" y="30" fontSize="11" fontWeight="700" fill="#0f2744">
          {focus ? labelOf(focus) : "Observatory"}
        </text>
        <text x="26" y="42" fontSize="8" fill="#4b6279">
          {last != null ? px(last) : "Waiting for prices…"}
          {deskTag ? `  ·  ${deskTag}` : ""}
        </text>
        <rect x="270" y="20" width="64" height="16" rx="8" fill={badgeColor} fillOpacity="0.14" />
        <text x="302" y="31" fontSize="7.5" fontWeight="700" textAnchor="middle" fill={badgeColor}>
          {badge}
        </text>
        {tail.map((c, i) => {
          const x = 26 + i * 7.6;
          const col = c.c >= c.o ? "#0f9d78" : "#dd4f58";
          const y1 = cy(Math.max(c.o, c.c));
          const y2 = cy(Math.min(c.o, c.c));
          return (
            <g key={c.t}>
              <line x1={x + 2} y1={cy(c.h)} x2={x + 2} y2={cy(c.l)} stroke={col} strokeWidth="0.9" />
              <rect x={x} y={y1} width="4" height={Math.max(1, y2 - y1)} rx="1" fill={col} />
            </g>
          );
        })}

        {/* Tunnels */}
        <g stroke="#c4d8e8" strokeWidth="6" strokeLinecap="round">
          {TUNNELS.map(([a, b], i) => (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          ))}
        </g>
        {AGENTS.map((a) => {
          const live = agents[a.id];
          const c = CELL[a.id];
          if (live.phase !== "voted" && live.phase !== "thinking") return null;
          return <line key={`flow-${a.id}`} x1={c.x} y1={c.y} x2={QUEEN.x} y2={QUEEN.y} stroke={live.phase === "voted" ? voteColor(live.vote) : a.color} strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" className={live.phase === "thinking" ? "hive-flow" : undefined} />;
        })}

        {/* Chambers */}
        {busy && <circle cx={QUEEN.x} cy={QUEEN.y} r="24" fill="none" stroke="#f59e0b" strokeWidth="2" className="hive-ring" />}
        <polygon points={hex(QUEEN.x, QUEEN.y)} fill={queenFill} stroke="#d99a1e" strokeWidth="1.6" />
        <path transform={`translate(${QUEEN.x} ${QUEEN.y - 8}) scale(0.9)`} d="M-7 3 L-7 -3 L-3.5 0 L0 -5 L3.5 0 L7 -3 L7 3 Z" fill="#b45309" />
        <text x={QUEEN.x} y={QUEEN.y + 11} fontSize="8" fontWeight="700" textAnchor="middle" fill="#0f2744">
          {act ?? (busy ? "…" : "QUEEN")}
        </text>
        {AGENTS.map((a) => {
          const live: AgentLive = agents[a.id];
          const c = CELL[a.id];
          const asleep = live.phase === "asleep";
          const status = asleep ? "asleep" : live.phase === "thinking" ? "thinking…" : live.phase === "error" ? "no answer" : live.phase === "voted" ? (a.kind === "risk" ? (live.note === "Veto" ? "VETO" : "OK") : `${live.vote} ${live.confidence.toFixed(0)}`) : a.kind === "builtin" ? "watching" : "ready";
          const sc = live.phase === "voted" ? voteColor(live.vote) : live.phase === "error" ? "#dd4f58" : "#6b8197";
          return (
            <g key={a.id}>
              <polygon points={hex(c.x, c.y)} fill={asleep ? "#e9f0f6" : "#ffffff"} fillOpacity={asleep ? 0.9 : 0.94} stroke={a.color} strokeOpacity={asleep ? 0.35 : 0.95} strokeWidth="1.6" strokeDasharray={asleep ? "3 3" : undefined} />
              <g transform={`translate(${c.x} ${c.y - 7})`} opacity={asleep ? 0.4 : 1}>
                {live.phase === "thinking" ? (
                  <Walker path="M -7 0 a 7 7 0 1 1 14 0 a 7 7 0 1 1 -14 0" dur="2.6s">
                    <Ant color={a.color} walking scale={0.95} />
                  </Walker>
                ) : (
                  <g className={live.phase === "voted" ? "hive-wiggle" : undefined}>
                    <Ant color={a.color} walking={false} scale={0.95} />
                  </g>
                )}
              </g>
              <text x={c.x} y={c.y + 10} fontSize="7.2" fontWeight="700" textAnchor="middle" fill={a.color} fillOpacity={asleep ? 0.6 : 1}>
                {a.name}
              </text>
              <text x={c.x} y={c.y + 18} fontSize="6.2" textAnchor="middle" fill={sc} className={live.phase === "thinking" ? "hive-blink" : undefined}>
                {status}
              </text>
            </g>
          );
        })}

        {/* Ants that live in the tunnels */}
        {WALKERS.map((w, i) => (
          <Walker key={i} path={w.path} dur={w.dur} begin={w.begin}>
            <Ant color={w.color} walking scale={0.8} />
          </Walker>
        ))}

        {/* A messenger ant carries each fresh vote to the Queen */}
        {AGENTS.map((a) => {
          const live = agents[a.id];
          if (live.phase !== "voted" || !live.at) return null;
          const c = CELL[a.id];
          return (
            <Walker key={`${a.id}-${live.at}`} path={`M${c.x} ${c.y} L${QUEEN.x} ${QUEEN.y}`} dur="1.5s" once>
              <Ant color={a.color} walking scale={0.95} load={voteColor(live.vote)} />
            </Walker>
          );
        })}
      </svg>
    </div>
  );
}

export function AgentStrip() {
  const agents = useHive((s) => s.agents);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {AGENTS.map((a) => {
        const live = agents[a.id];
        const asleep = live.phase === "asleep";
        return (
          <div key={a.id} className="hive-card rounded-2xl border border-line bg-elev p-2.5" style={{ borderLeftColor: a.color, opacity: asleep ? 0.65 : 1 }}>
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-xs font-semibold" style={{ color: a.color }}>
                {a.name}
              </span>
              <span className={`text-[10px] ${live.phase === "thinking" ? "hive-blink text-warn" : live.phase === "error" ? "text-down" : live.phase === "voted" ? "text-up" : "text-faint"}`}>{live.phase === "voted" ? "voted" : live.phase}</span>
            </div>
            <p className="mt-1 line-clamp-2 min-h-[2.2rem] text-[10px] leading-snug text-muted">{live.note || a.role}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elev-2">
              <div className="h-full rounded-full" style={{ width: `${live.phase === "voted" ? live.confidence : 0}%`, background: a.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
