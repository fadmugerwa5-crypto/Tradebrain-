import { create } from "zustand";
import { persist } from "zustand/middleware";
import { analyzeTrade } from "./analyzer.ts";
import { learnStep } from "./learn.ts";
import { baselineVersion, makeGate, nextVersion, specLabel, type GateFn } from "./rules.ts";
import type { Analysis, Candidate, ConfigVersion, ContextSnapshot, Filters, LearnEvent, LearnSettings, Rule, SegmentSpec, TradeRecord } from "./types.ts";
import { FILTERS0, LEARN0 } from "./types.ts";

export type OpenSnap = { ctx: ContextSnapshot | null; configVersion: string; mode: TradeRecord["mode"]; ai: TradeRecord["ai"]; openedAt: number };

type Learn = {
  records: TradeRecord[];
  open: Record<string, OpenSnap>;
  analyses: Record<string, Analysis>;
  versions: ConfigVersion[];
  activeId: string;
  candidates: Candidate[];
  flagged: string[];
  log: LearnEvent[];
  settings: LearnSettings;
  lastRunAt: number;
  addEvent: (e: Omit<LearnEvent, "t"> & { t?: number }) => void;
  setOpen: (id: string, s: OpenSnap) => void;
  dropOpen: (id: string) => void;
  addRecord: (r: TradeRecord) => void;
  run: () => void;
  approve: (id: string) => void;
  reject: (id: string) => void;
  resetCandidate: (id: string) => void;
  disableSpec: (spec: SegmentSpec, action?: Rule["action"]) => void;
  removeRule: (ruleId: string) => void;
  setFilters: (p: Partial<Filters>) => void;
  setSettings: (p: Partial<LearnSettings>) => void;
  rollback: (versionId: string) => void;
  exportJson: () => string;
  importJson: (text: string) => string;
  clearAll: () => void;
};

const MAX_RECORDS = 1500;
const active = (s: Pick<Learn, "versions" | "activeId">) => s.versions.find((v) => v.id === s.activeId) ?? s.versions[0]!;
const ev = (e: Omit<LearnEvent, "t"> & { t?: number }): LearnEvent => ({ ...e, t: e.t ?? Date.now() });

export const useLearn = create<Learn>()(
  persist(
    (set, get) => ({
      records: [],
      open: {},
      analyses: {},
      versions: [baselineVersion()],
      activeId: "v0",
      candidates: [],
      flagged: [],
      log: [ev({ kind: "system", text: "Learning Brain started. It records every trade and tests changes before any are used. It cannot change your risk settings." })],
      settings: { ...LEARN0 },
      lastRunAt: 0,
      addEvent: (e) => set((s) => ({ log: [ev(e), ...s.log].slice(0, 300) })),
      setOpen: (id, snap) => set((s) => ({ open: { ...s.open, [id]: snap } })),
      dropOpen: (id) => set((s) => { const o = { ...s.open }; delete o[id]; return { open: o }; }),
      addRecord: (r) =>
        set((s) => {
          if (s.records.some((x) => x.id === r.id)) return {};
          const records = [...s.records, r].sort((a, b) => a.openedAt - b.openedAt).slice(-MAX_RECORDS);
          const an = analyzeTrade(r, records);
          const keep = Object.entries({ ...s.analyses, [r.id]: an }).sort((a, b) => b[1].at - a[1].at).slice(0, 400);
          return { records, analyses: Object.fromEntries(keep) };
        }),
      run: () => {
        const s = get();
        if (!s.settings.learning) return;
        const out = learnStep(s.records, s.candidates, s.flagged, s.settings);
        set((c) => ({ candidates: out.candidates.slice(-120), flagged: out.flagged, lastRunAt: Date.now(), log: [...out.events.map((e) => ev(e)).reverse(), ...c.log].slice(0, 300) }));
      },
      approve: (id) => {
        const s = get();
        const c = s.candidates.find((x) => x.id === id);
        if (!c || c.status !== "ready") return;
        const cur = active(s);
        const rule: Rule = { id: `r${Date.now().toString(36)}`, spec: c.spec, action: c.action, source: "learned", candidateId: c.id, note: c.reason, createdAt: Date.now() };
        const v = nextVersion(s.versions, cur.id, { source: "learned", note: `Approved: ${c.action === "disable" ? "switch off" : "restrict"} ${c.label}`, rules: [...cur.rules, rule], filters: cur.filters });
        set((x) => ({ versions: [...x.versions, v].slice(-60), activeId: v.id, candidates: x.candidates.map((k) => (k.id === id ? { ...k, status: "approved" as const, decidedAt: Date.now() } : k)), log: [ev({ kind: "approve", text: `Approved ${v.id}: ${c.label} (${c.action}). Rollback is available.`, evidence: c.reason, version: v.id }), ...x.log].slice(0, 300) }));
      },
      reject: (id) => set((s) => ({ candidates: s.candidates.map((k) => (k.id === id && k.status !== "approved" ? { ...k, status: "rejected" as const, decidedAt: Date.now(), reason: "Rejected by you." } : k)), log: [ev({ kind: "reject", text: "You rejected a candidate." }), ...s.log].slice(0, 300) })),
      resetCandidate: (id) => set((s) => ({ candidates: s.candidates.map((k) => (k.id === id && k.status !== "approved" ? { ...k, status: "watch" as const, shadow: { start: Date.now(), rs: [] }, decidedAt: undefined, reason: "Experiment reset; it must be confirmed again." } : k)), log: [ev({ kind: "user", text: "You reset a candidate experiment." }), ...s.log].slice(0, 300) })),
      disableSpec: (spec, action = "disable") => {
        const s = get();
        const cur = active(s);
        const rule: Rule = { id: `r${Date.now().toString(36)}`, spec, action, source: "user", note: "Set by you.", createdAt: Date.now() };
        const v = nextVersion(s.versions, cur.id, { source: "user", note: `You ${action === "disable" ? "switched off" : "restricted"} ${specLabel(spec)}`, rules: [...cur.rules, rule], filters: cur.filters });
        set((x) => ({ versions: [...x.versions, v].slice(-60), activeId: v.id, log: [ev({ kind: "user", text: v.note, version: v.id }), ...x.log].slice(0, 300) }));
      },
      removeRule: (ruleId) => {
        const s = get();
        const cur = active(s);
        if (!cur.rules.some((r) => r.id === ruleId)) return;
        const v = nextVersion(s.versions, cur.id, { source: "user", note: "You removed a rule", rules: cur.rules.filter((r) => r.id !== ruleId), filters: cur.filters });
        set((x) => ({ versions: [...x.versions, v].slice(-60), activeId: v.id, log: [ev({ kind: "user", text: v.note, version: v.id }), ...x.log].slice(0, 300) }));
      },
      setFilters: (p) => {
        const s = get();
        const cur = active(s);
        const filters = { ...cur.filters, ...p };
        const note = `Filters: 15m rule ${filters.htf}, stand aside ${filters.standAside ? "on" : "off"}, max spread ${filters.maxSpreadPct || "off"}`;
        // Typing a number must not create a version per keystroke: a recent user filter version is updated in place.
        if (cur.source === "user" && cur.note.startsWith("Filters:") && Date.now() - cur.createdAt < 120_000 && cur.id === s.versions[s.versions.length - 1]!.id) {
          set((x) => ({ versions: x.versions.map((v) => (v.id === cur.id ? { ...v, filters, note } : v)) }));
          return;
        }
        const v = nextVersion(s.versions, cur.id, { source: "user", note, rules: cur.rules, filters });
        set((x) => ({ versions: [...x.versions, v].slice(-60), activeId: v.id, log: [ev({ kind: "user", text: note, version: v.id }), ...x.log].slice(0, 300) }));
      },
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      rollback: (versionId) => {
        const s = get();
        const target = s.versions.find((v) => v.id === versionId);
        if (!target || versionId === s.activeId) return;
        const v = nextVersion(s.versions, versionId, { source: "rollback", note: `Rolled back to ${versionId}`, rules: target.rules.map((r) => ({ ...r })), filters: { ...target.filters } });
        set((x) => ({ versions: [...x.versions, v].slice(-60), activeId: v.id, log: [ev({ kind: "rollback", text: `Rolled back to ${versionId} (now ${v.id}).`, version: v.id }), ...x.log].slice(0, 300) }));
      },
      exportJson: () => {
        const s = get();
        return JSON.stringify({ app: "tradebrain-learn", v: 1, at: Date.now(), records: s.records, versions: s.versions, activeId: s.activeId, candidates: s.candidates, flagged: s.flagged, log: s.log.slice(0, 100), settings: s.settings });
      },
      importJson: (text) => {
        try {
          const d = JSON.parse(text) as Partial<Pick<Learn, "records" | "versions" | "activeId" | "candidates" | "flagged" | "log" | "settings">> & { app?: string };
          if (d.app !== "tradebrain-learn" || !Array.isArray(d.records)) return "That is not a TradeBrain learning export.";
          const s = get();
          const have = new Set(s.records.map((r) => r.id));
          const add = d.records.filter((r) => r && typeof r.id === "string" && typeof r.pnl === "number" && !have.has(r.id));
          const records = [...s.records, ...add].sort((a, b) => a.openedAt - b.openedAt).slice(-MAX_RECORDS);
          const fresh = s.records.length === 0 && s.versions.length <= 1;
          set({
            records,
            ...(fresh && Array.isArray(d.versions) && d.versions.length && d.activeId ? { versions: d.versions, activeId: d.activeId, candidates: d.candidates ?? [], flagged: d.flagged ?? [], settings: { ...LEARN0, ...(d.settings ?? {}) } } : {}),
          });
          get().addEvent({ kind: "system", text: `Imported ${add.length} trades.` });
          get().run();
          return `Imported ${add.length} new trades (${d.records.length - add.length} were already here).`;
        } catch {
          return "Could not read that text. Paste the full export.";
        }
      },
      clearAll: () => set({ records: [], open: {}, analyses: {}, versions: [baselineVersion()], activeId: "v0", candidates: [], flagged: [], log: [ev({ kind: "system", text: "Learning data cleared." })], settings: { ...LEARN0 }, lastRunAt: 0 }),
    }),
    {
      name: "tradebrain-learn-v1",
      partialize: (s) => ({ records: s.records, open: s.open, analyses: s.analyses, versions: s.versions, activeId: s.activeId, candidates: s.candidates, flagged: s.flagged, log: s.log, settings: s.settings, lastRunAt: s.lastRunAt }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Learn>;
        const versions = p.versions?.length ? p.versions : current.versions;
        return { ...current, ...p, versions, activeId: versions.some((v) => v.id === p.activeId) ? (p.activeId as string) : versions[0]!.id, settings: { ...LEARN0, ...(p.settings ?? {}) } };
      },
    },
  ),
);

export const activeConfig = () => {
  const v = active(useLearn.getState());
  return { rules: v.rules, filters: { ...FILTERS0, ...v.filters } };
};

/** Most recent context the gate computed per market and side, so the trade that follows can be stored with the facts it was judged on. */
export const gateSeen = new Map<string, { ctx: ContextSnapshot | null; t: number; strategy: string }>();

export const learnGate: GateFn = makeGate(
  () => ({ cfg: activeConfig(), settings: useLearn.getState().settings }),
  (q, ctx) => {
    gateSeen.set(`${q.symbol}|${q.side}`, { ctx, t: q.now, strategy: q.strategy });
    if (gateSeen.size > 400) gateSeen.clear();
  },
);
