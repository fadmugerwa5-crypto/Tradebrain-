import { create } from "zustand";
import { persist } from "zustand/middleware";
import { cleanKey } from "@/lib/brokers/ai";
import { AGENTS } from "@/lib/hive/agents";
import { EMPTY_KEY, type AgentKey, type Profile } from "@/lib/hive/llm";
import { AGENT_BUDGET_DEFAULTS, EMPTY_AGENT_USAGE, DESK_DEFAULTS, HIVE_DEFAULTS, type AgentBudgetPolicy, type AgentId, type AgentMemory, type AgentUsage, type DeskPref, type DeskVenue, type HiveConfig, type Lesson, type Style, type Vote } from "@/lib/hive/types";

export type KeySlot = AgentId | "shared";
export const KEY_SLOTS: KeySlot[] = ["shared", ...AGENTS.filter((a) => a.kind !== "builtin").map((a) => a.id)];

export type KeyState = { status: "idle" | "checking" | "ready" | "error"; provider: string; label: string; model: string; note: string };
const KS0: KeyState = { status: "idle", provider: "", label: "", model: "", note: "" };

export type AgentLive = { phase: "asleep" | "idle" | "thinking" | "voted" | "error"; vote: Vote; confidence: number; note: string; at: number; calls: number; errors: number };
const AL0: AgentLive = { phase: "asleep", vote: "WAIT", confidence: 0, note: "", at: 0, calls: 0, errors: 0 };

export type Feed = { t: number; agent: AgentId | "colony"; text: string; tone: "info" | "good" | "bad" };

export type DeskLive = { lastRoundAt: number; paused: string; equity: number | null; cash: number | null; dayPnl: number; open: number; rounds: number };
const DLIVE0: DeskLive = { lastRoundAt: 0, paused: "", equity: null, cash: null, dayPnl: 0, open: 0, rounds: 0 };

export type Receipt = {
  id: string;
  t: number;
  symbol: string;
  side: "BUY" | "SELL";
  style: Style;
  desk: DeskVenue;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  /** Money at risk when the trade was opened. */
  risk: number;
  venue: string;
  confidence: number;
  reason: string;
  votes: { agent: AgentId; vote: Vote; confidence: number; note: string }[];
  outcome: "sent" | "failed" | "closed";
  posId: string;
  pnl?: number;
  exitReason?: string;
  exitPrice?: number;
  closedAt?: number;
  /** Best and worst price seen while the trade was open. */
  high?: number;
  low?: number;
  /** Set once the lesson has been written. */
  lessonDone?: boolean;
  r?: number;
  tags?: string[];
  journal?: string;
  failNote?: string;
  /** Adaptive Trade Management audit trail; local deterministic observations, not AI claims. */
  managementState?: string;
  managementNote?: string;
  managementEvents?: { t: number; state: string; note: string; currentR: number; maxAdverseR: number; maxFavorableR: number }[];
  earlyExitBlocked?: number;
};

export type Verdict = { symbol: string; label: string; action: Vote | "BLOCKED"; reason: string; confidence: number; t: number };

const agents0 = () => Object.fromEntries(AGENTS.map((a) => [a.id, { ...AL0, phase: a.kind === "builtin" ? "idle" : "asleep" }])) as Record<AgentId, AgentLive>;
const keys0 = () => Object.fromEntries(KEY_SLOTS.map((k) => [k, { ...EMPTY_KEY }])) as Record<KeySlot, AgentKey>;
const keyState0 = () => Object.fromEntries(KEY_SLOTS.map((k) => [k, { ...KS0 }])) as Record<KeySlot, KeyState>;

type Hive = {
  keys: Record<KeySlot, AgentKey>;
  keyState: Record<KeySlot, KeyState>;
  config: HiveConfig;
  weights: Partial<Record<AgentId, number>>;
  /** Independent per-agent budgets and usage counters. API keys remain in their existing per-agent slots. */
  budgetPolicies: Record<AgentId, AgentBudgetPolicy>;
  budgetUsage: Record<AgentId, AgentUsage>;
  agentMemory: Record<AgentId, AgentMemory[]>;
  coachNote: string;
  closedSinceCoach: number;
  receipts: Receipt[];
  lessons: Lesson[];
  /** What the person chose per desk. */
  desks: Record<DeskVenue, DeskPref>;
  /** The UTC day's starting equity per desk, for the daily loss lock. */
  dayStart: Record<DeskVenue, { day: string; equity: number }>;
  /** Not saved: the colony always starts switched off. */
  armed: boolean;
  busy: boolean;
  /** The desk whose round is running now. */
  activeDesk: DeskVenue | null;
  deskLive: Record<DeskVenue, DeskLive>;
  focus: string | null;
  agents: Record<AgentId, AgentLive>;
  feed: Feed[];
  verdicts: Verdict[];
  rounds: number;
  callsMin: number;
  setKey: (slot: KeySlot, p: Partial<AgentKey>) => void;
  setKeyState: (slot: KeySlot, p: Partial<KeyState>) => void;
  patchBudget: (agent: AgentId, p: Partial<AgentBudgetPolicy>) => void;
  recordBudget: (agent: AgentId, kind: "call" | "cached" | "blocked" | "error", at?: number) => void;
  clearBudgetUsage: (agent?: AgentId) => void;
  patchConfig: (p: Partial<HiveConfig>) => void;
  setArmed: (armed: boolean) => void;
  patch: (p: Partial<Pick<Hive, "busy" | "activeDesk" | "focus" | "rounds" | "callsMin" | "coachNote" | "closedSinceCoach" | "weights">>) => void;
  setDesk: (venue: DeskVenue, p: Partial<DeskPref>) => void;
  setDeskLive: (venue: DeskVenue, p: Partial<DeskLive>) => void;
  setDayStart: (venue: DeskVenue, day: string, equity: number) => void;
  addLesson: (l: Lesson) => void;
  patchLesson: (id: string, p: Partial<Lesson>) => void;
  patchAgent: (id: AgentId, p: Partial<AgentLive>) => void;
  say: (agent: AgentId | "colony", text: string, tone?: Feed["tone"]) => void;
  addReceipt: (r: Receipt) => void;
  patchReceipt: (id: string, p: Partial<Receipt>) => void;
  setVerdict: (v: Verdict) => void;
};

export const useHive = create<Hive>()(
  persist(
    (set) => ({
      keys: keys0(),
      keyState: keyState0(),
      config: { ...HIVE_DEFAULTS },
      weights: {},
      budgetPolicies: Object.fromEntries(Object.entries(AGENT_BUDGET_DEFAULTS).map(([k, v]) => [k, { ...v }])) as Record<AgentId, AgentBudgetPolicy>,
      budgetUsage: Object.fromEntries(Object.keys(AGENT_BUDGET_DEFAULTS).map((k) => [k, { ...EMPTY_AGENT_USAGE }])) as Record<AgentId, AgentUsage>,
      agentMemory: Object.fromEntries(Object.keys(AGENT_BUDGET_DEFAULTS).map((k) => [k, []])) as Record<AgentId, AgentMemory[]>,
      coachNote: "",
      closedSinceCoach: 0,
      receipts: [],
      lessons: [],
      desks: { deriv: { ...DESK_DEFAULTS.deriv }, binance: { ...DESK_DEFAULTS.binance } },
      dayStart: { deriv: { day: "", equity: 0 }, binance: { day: "", equity: 0 } },
      armed: false,
      busy: false,
      activeDesk: null,
      deskLive: { deriv: { ...DLIVE0 }, binance: { ...DLIVE0 } },
      focus: null,
      agents: agents0(),
      feed: [{ t: Date.now(), agent: "colony", text: "The colony is asleep. Connect a demo account, paste an AI key for each agent below, then press Wake the colony.", tone: "info" }],
      verdicts: [],
      rounds: 0,
      callsMin: 0,
      setKey: (slot, p) => set((s) => ({ keys: { ...s.keys, [slot]: { ...s.keys[slot], ...p } } })),
      setKeyState: (slot, p) => set((s) => ({ keyState: { ...s.keyState, [slot]: { ...s.keyState[slot], ...p } } })),
      patchBudget: (agent, p) => set((s) => ({ budgetPolicies: { ...s.budgetPolicies, [agent]: { ...s.budgetPolicies[agent], ...p } } })),
      recordBudget: (agent, kind, at = Date.now()) => set((s) => {
        const day = new Date(at).toISOString().slice(0, 10);
        const old = s.budgetUsage[agent] ?? { ...EMPTY_AGENT_USAGE };
        const base = old.day === day ? old : { ...EMPTY_AGENT_USAGE, day };
        const stamps = kind === "call" ? [...base.stamps.filter((t) => at - t < 60_000), at].slice(-120) : base.stamps.filter((t) => at - t < 60_000);
        return { budgetUsage: { ...s.budgetUsage, [agent]: { ...base, day, calls: base.calls + (kind === "call" ? 1 : 0), cached: base.cached + (kind === "cached" ? 1 : 0), blocked: base.blocked + (kind === "blocked" ? 1 : 0), errors: base.errors + (kind === "error" ? 1 : 0), stamps, lastAt: kind === "call" ? at : base.lastAt } } };
      }),
      clearBudgetUsage: (agent) => set((s) => ({ budgetUsage: agent ? { ...s.budgetUsage, [agent]: { ...EMPTY_AGENT_USAGE } } : Object.fromEntries(Object.keys(AGENT_BUDGET_DEFAULTS).map((k) => [k, { ...EMPTY_AGENT_USAGE }])) as Record<AgentId, AgentUsage> })),
      patchConfig: (p) => set((s) => ({ config: { ...s.config, ...p } })),
      setArmed: (armed) => set({ armed }),
      patch: (p) => set(p),
      setDesk: (venue, p) => set((s) => ({ desks: { ...s.desks, [venue]: { ...s.desks[venue], ...p } } })),
      setDeskLive: (venue, p) => set((s) => ({ deskLive: { ...s.deskLive, [venue]: { ...s.deskLive[venue], ...p } } })),
      setDayStart: (venue, day, equity) => set((s) => ({ dayStart: { ...s.dayStart, [venue]: { day, equity } } })),
      addLesson: (l) => set((s) => {
        const agentMemory = { ...s.agentMemory };
        for (const id of [...l.right, ...l.wrong]) {
          const result = l.right.includes(id) ? "right" : "wrong";
          const row: AgentMemory = { id: `${l.id}-${id}`, t: l.t, symbol: l.symbol, result, r: l.r, text: l.text };
          agentMemory[id] = [row, ...(agentMemory[id] ?? [])].slice(0, 30);
        }
        return { lessons: [l, ...s.lessons].slice(0, 80), agentMemory };
      }),
      patchLesson: (id, p) => set((s) => ({ lessons: s.lessons.map((l) => (l.id === id ? { ...l, ...p } : l)) })),
      patchAgent: (id, p) => set((s) => ({ agents: { ...s.agents, [id]: { ...s.agents[id], ...p } } })),
      say: (agent, text, tone = "info") => set((s) => ({ feed: [{ t: Date.now(), agent, text, tone }, ...s.feed].slice(0, 120) })),
      addReceipt: (r) => set((s) => ({ receipts: [r, ...s.receipts].slice(0, 80) })),
      patchReceipt: (id, p) => set((s) => ({ receipts: s.receipts.map((r) => (r.id === id ? { ...r, ...p } : r)) })),
      setVerdict: (v) => set((s) => ({ verdicts: [v, ...s.verdicts.filter((x) => x.symbol !== v.symbol)].slice(0, 30) })),
    }),
    {
      name: "tradebrain-hive-v1",
      skipHydration: true,
      partialize: (s) => ({ keys: s.keys, keyState: s.keyState, config: s.config, weights: s.weights, budgetPolicies: s.budgetPolicies, budgetUsage: s.budgetUsage, agentMemory: s.agentMemory, coachNote: s.coachNote, closedSinceCoach: s.closedSinceCoach, receipts: s.receipts.slice(0, 80), lessons: s.lessons.slice(0, 80), desks: s.desks, dayStart: s.dayStart }),
      // Older or partial saves: fill every gap from the defaults so a missing field never crashes the screen.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Hive>;
        const keys = { ...current.keys };
        const keyState = { ...current.keyState };
        for (const k of KEY_SLOTS) {
          keys[k] = { ...EMPTY_KEY, ...(p.keys?.[k] ?? {}) };
          const ks = { ...KS0, ...(p.keyState?.[k] ?? {}) };
          // A saved "checking" never finished. A saved "ready" is kept, so the colony wakes without re-checking every key.
          keyState[k] = { ...ks, status: ks.status === "ready" && keys[k].key ? "ready" : ks.status === "checking" ? "idle" : ks.status };
        }
        const pc = (p.config ?? {}) as Partial<HiveConfig>;
        const config: HiveConfig = { ...HIVE_DEFAULTS, shortlist: pc.shortlist ?? HIVE_DEFAULTS.shortlist, dailyLossPct: pc.dailyLossPct ?? HIVE_DEFAULTS.dailyLossPct, callsPerMin: pc.callsPerMin ?? HIVE_DEFAULTS.callsPerMin, scalp: { ...HIVE_DEFAULTS.scalp, ...(pc.scalp ?? {}) }, trader: { ...HIVE_DEFAULTS.trader, ...(pc.trader ?? {}) } };
        const desks = { deriv: { ...DESK_DEFAULTS.deriv, ...(p.desks?.deriv ?? {}) }, binance: { ...DESK_DEFAULTS.binance, ...(p.desks?.binance ?? {}) } };
        // Deriv contracts have a fixed duration, so that desk always scalps.
        desks.deriv.style = "scalp";
        const dayStart = { deriv: { day: "", equity: 0, ...(p.dayStart?.deriv ?? {}) }, binance: { day: "", equity: 0, ...(p.dayStart?.binance ?? {}) } };
        const budgetPolicies = Object.fromEntries(Object.entries(AGENT_BUDGET_DEFAULTS).map(([k, v]) => [k, { ...v, ...((p as any).budgetPolicies?.[k] ?? {}) }])) as Record<AgentId, AgentBudgetPolicy>;
        const budgetUsage = Object.fromEntries(Object.keys(AGENT_BUDGET_DEFAULTS).map((k) => [k, { ...EMPTY_AGENT_USAGE, ...((p as any).budgetUsage?.[k] ?? {}) }])) as Record<AgentId, AgentUsage>;
        const agentMemory = Object.fromEntries(Object.keys(AGENT_BUDGET_DEFAULTS).map((k) => [k, Array.isArray((p as any).agentMemory?.[k]) ? (p as any).agentMemory[k].slice(0, 30) : []])) as Record<AgentId, AgentMemory[]>;
        return { ...current, ...p, keys, keyState, config, desks, dayStart, budgetPolicies, budgetUsage, agentMemory, weights: p.weights ?? {}, receipts: Array.isArray(p.receipts) ? p.receipts : [], lessons: Array.isArray(p.lessons) ? p.lessons : [] } as Hive;
      },
      onRehydrateStorage: () => (state) => {
        if (state) state.armed = false;
      },
    },
  ),
);

/** The slot that serves this agent: its own key if it has one, else the shared key. */
export function slotFor(s: Pick<Hive, "keys" | "keyState">, agent: AgentId): KeySlot | null {
  for (const slot of [agent, "shared"] as KeySlot[]) {
    if (cleanKey(s.keys[slot]?.key ?? "") && s.keyState[slot]?.status === "ready") return slot;
  }
  return null;
}

/** The ready profile behind one key box, or null while the key is empty, being checked or rejected. */
export function profileOfSlot(s: Pick<Hive, "keys" | "keyState">, slot: KeySlot): Profile | null {
  const k = s.keys[slot];
  const ks = s.keyState[slot];
  if (!k || !ks || ks.status !== "ready" || !cleanKey(k.key)) return null;
  const base = k.base.trim().replace(/\/+$/, "");
  return { provider: (base ? "custom" : ks.provider) as Profile["provider"], label: ks.label || ks.provider, model: ks.model, base: base || undefined, key: cleanKey(k.key) };
}

export function profileFor(s: Pick<Hive, "keys" | "keyState">, agent: AgentId): Profile | null {
  const slot = slotFor(s, agent);
  return slot ? profileOfSlot(s, slot) : null;
}
