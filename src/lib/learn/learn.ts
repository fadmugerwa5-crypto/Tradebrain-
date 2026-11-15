import { clusterR, metricsIndependent, metricsOfR, withR, type Metrics } from "./stats.ts";
import { matchSpec, specKey, specLabel, type Facts } from "./rules.ts";
import type { Candidate, LearnEvent, LearnSettings, SegmentSpec, Slice, TradeRecord } from "./types.ts";

/** Attribute combinations the Pattern Learner looks at. */
export const DIM_SETS: (keyof SegmentSpec)[][] = [["strategy", "regime"], ["strategy", "symbol"], ["strategy", "session"], ["strategy", "side"], ["strategy", "align"], ["regime", "align"]];

export const factsOf = (r: TradeRecord): Facts => ({ strategy: r.strategy, symbol: r.symbol, side: r.side, regime: r.ctx?.regime ?? "unknown", session: r.session, align: r.ctx?.align ?? "unknown" });
const val = (f: Facts, d: keyof SegmentSpec) => f[d] as string;
const inSeg = (spec: SegmentSpec, r: TradeRecord) => matchSpec(spec, factsOf(r));
const slice = (m: Metrics): Slice => ({ n: m.n, exp: m.expectancy, win: m.winRate });

export type Pattern = { spec: SegmentSpec; label: string; m: Metrics; kind: "weak" | "strong" };

/** Repeated outcomes by segment. Independent-observation counts (clustered entries count once). Labelled by sample size, never declared profitable. */
export function findPatterns(records: TradeRecord[], minSample: number): Pattern[] {
  const out: Pattern[] = [];
  const recs = withR(records);
  for (const dims of DIM_SETS) {
    const by = new Map<string, { spec: SegmentSpec; recs: TradeRecord[] }>();
    for (const r of recs) {
      const f = factsOf(r);
      if (dims.some((d) => val(f, d) === "unknown")) continue;
      const spec: SegmentSpec = {};
      for (const d of dims) (spec as Record<string, string>)[d] = val(f, d);
      const k = specKey(spec);
      const e = by.get(k);
      if (e) e.recs.push(r);
      else by.set(k, { spec, recs: [r] });
    }
    for (const { spec, recs: rs } of by.values()) {
      const m = metricsIndependent(rs);
      if (m.n < 5) continue;
      if (m.expectancy <= -0.1) out.push({ spec, label: specLabel(spec), m, kind: "weak" });
      else if (m.expectancy >= 0.1 && m.n >= Math.min(minSample, 10)) out.push({ spec, label: specLabel(spec), m, kind: "strong" });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.m.n - a.m.n : a.kind === "weak" ? -1 : 1));
}

/** Chronological split: the earlier 60% discovers, the later 40% confirms. */
export function split(records: TradeRecord[]): { train: TradeRecord[]; test: TradeRecord[] } {
  const s = [...records].sort((a, b) => a.openedAt - b.openedAt);
  const k = Math.floor(s.length * 0.6);
  return { train: s.slice(0, k), test: s.slice(k) };
}

export type Evaluation = { train: Slice; validation: Slice | null; baseline: Slice | null; filtered: Slice | null; pass: boolean; wait: boolean; reason: string; action: "restrict" | "disable" };

/** Does a restriction on `spec`, found on earlier trades, hold on later trades it never saw? */
export function evaluate(spec: SegmentSpec, records: TradeRecord[], st: LearnSettings): Evaluation {
  const { train, test } = split(withR(records));
  const tm = metricsIndependent(train.filter((r) => inSeg(spec, r)));
  const action: "restrict" | "disable" = tm.expectancy <= -0.3 && tm.expCI[1] < 0 ? "disable" : "restrict";
  const base: Evaluation = { train: slice(tm), validation: null, baseline: null, filtered: null, pass: false, wait: false, reason: "", action };
  if (tm.n < st.minSample) return { ...base, wait: true, reason: `Low confidence: ${tm.n} of ${st.minSample} independent trades needed.` };
  if (!(tm.expectancy <= -0.15 && tm.expCI[1] < 0.05)) return { ...base, reason: `Earlier record ${tm.expectancy.toFixed(2)}R is not clearly negative.` };
  const inT = test.filter((r) => inSeg(spec, r));
  const vm = metricsIndependent(inT);
  const bm = metricsIndependent(test);
  const fm = metricsIndependent(test.filter((r) => !inSeg(spec, r)));
  const ev = { ...base, validation: slice(vm), baseline: slice(bm), filtered: slice(fm) };
  if (vm.n < st.minValidate) return { ...ev, wait: true, reason: `Waiting for out-of-sample evidence: ${vm.n} of ${st.minValidate} later trades.` };
  if (!(vm.expectancy < 0)) return { ...ev, reason: `Rejected: on later unseen trades the segment made ${vm.expectancy.toFixed(2)}R, not a loss.` };
  if (inT.length > 0.5 * test.length) return { ...ev, reason: "Rejected: it would remove more than half of the later trades." };
  if (!(fm.expectancy >= bm.expectancy)) return { ...ev, reason: `Rejected: removing it would not improve later results (${fm.expectancy.toFixed(2)}R vs ${bm.expectancy.toFixed(2)}R).` };
  return { ...ev, pass: true, reason: `Passed: earlier ${tm.expectancy.toFixed(2)}R (${tm.n} trades), later unseen ${vm.expectancy.toFixed(2)}R (${vm.n} trades); results without it ${fm.expectancy.toFixed(2)}R vs ${bm.expectancy.toFixed(2)}R with it.` };
}

export type StepOut = { candidates: Candidate[]; events: LearnEvent[]; flagged: string[] };

/**
 * One learning step over the full record. Never touches live behaviour: it only creates, advances or rejects candidates.
 *  watch -> (out-of-sample confirmed) -> shadow -> (enough later matching trades still losing) -> ready -> user approves.
 */
export function learnStep(records: TradeRecord[], candidates: Candidate[], flagged: string[], st: LearnSettings, now = Date.now()): StepOut {
  const events: LearnEvent[] = [];
  const out = candidates.map((c) => ({ ...c, shadow: { ...c.shadow, rs: [...c.shadow.rs] } }));
  const newFlag = new Set(flagged);
  const recs = withR(records);
  const lastT = recs.length ? recs[recs.length - 1]!.openedAt : now;

  // 1. Pattern monitoring: log a weak pattern once, when first seen.
  for (const p of findPatterns(records, st.minSample)) {
    if (p.kind !== "weak") continue;
    const k = specKey(p.spec);
    if (newFlag.has(k)) continue;
    newFlag.add(k);
    events.push({ t: now, kind: "observe", text: `Watching: ${p.label} has averaged ${p.m.expectancy.toFixed(2)}R over ${p.m.n} independent trades (${p.m.confidence} confidence).`, evidence: p.m.n < st.minSample ? "Small sample: no change is made." : "Large enough to test as a candidate." });
  }

  // 2. Create candidates for weak patterns that are testable, and refresh the ones still waiting.
  const have = new Map(out.map((c) => [specKey(c.spec), c]));
  for (const p of findPatterns(records, st.minSample)) {
    if (p.kind !== "weak" || p.m.n < st.minSample) continue;
    const k = specKey(p.spec);
    if (have.has(k)) continue;
    const ev = evaluate(p.spec, records, st);
    if (!ev.pass && !ev.wait) {
      // rejected on evidence: keep the explanation once
      const c: Candidate = { id: `c${now.toString(36)}${out.length}`, createdAt: now, spec: p.spec, label: p.label, action: ev.action, status: "rejected", reason: ev.reason, train: ev.train, validation: ev.validation, baselineValidation: ev.baseline, filteredValidation: ev.filtered, shadow: { start: lastT, rs: [] }, decidedAt: now };
      out.push(c);
      have.set(k, c);
      events.push({ t: now, kind: "reject", text: `Rejected candidate: ${p.label}.`, evidence: ev.reason });
      continue;
    }
    const c: Candidate = { id: `c${now.toString(36)}${out.length}`, createdAt: now, spec: p.spec, label: p.label, action: ev.action, status: ev.pass ? "shadow" : "watch", reason: ev.reason, train: ev.train, validation: ev.validation, baselineValidation: ev.baseline, filteredValidation: ev.filtered, shadow: { start: lastT, rs: [] } };
    out.push(c);
    have.set(k, c);
    events.push({ t: now, kind: "propose", text: `Candidate: ${ev.action === "disable" ? "switch off" : "restrict"} ${p.label}.`, evidence: ev.reason });
    if (ev.pass) events.push({ t: now, kind: "shadow", text: `${p.label} passed the out-of-sample check and is now in shadow test (nothing changes live).` });
  }
  for (const c of out) {
    if (c.status === "watch") {
      const ev = evaluate(c.spec, records, st);
      c.train = ev.train;
      c.validation = ev.validation;
      c.baselineValidation = ev.baseline;
      c.filteredValidation = ev.filtered;
      c.reason = ev.reason;
      if (ev.pass) {
        c.status = "shadow";
        c.action = ev.action;
        c.shadow = { start: lastT, rs: [] };
        events.push({ t: now, kind: "validate", text: `${c.label} passed the out-of-sample check; shadow test started.`, evidence: ev.reason });
      } else if (!ev.wait) {
        c.status = "rejected";
        c.decidedAt = now;
        events.push({ t: now, kind: "reject", text: `Rejected candidate: ${c.label}.`, evidence: ev.reason });
      }
    }
    // 3. Shadow test on trades that happened after validation (the segment was still being traded, so they are real, unseen outcomes).
    if (c.status === "shadow") {
      const after = records.filter((r) => r.openedAt > c.shadow.start && inSeg(c.spec, r));
      c.shadow.rs = clusterR(after).map((x) => x.r);
      if (c.shadow.rs.length >= st.shadowMin) {
        const m = metricsOfR(c.shadow.rs);
        if (m.expectancy < 0) {
          c.status = "ready";
          c.reason = `Shadow test passed: ${m.n} later trades in this segment averaged ${m.expectancy.toFixed(2)}R. Waiting for your approval.`;
          events.push({ t: now, kind: "validate", text: `${c.label} is ready for approval.`, evidence: c.reason });
        } else {
          c.status = "rejected";
          c.decidedAt = now;
          c.reason = `Shadow test failed: ${m.n} later trades averaged ${m.expectancy.toFixed(2)}R.`;
          events.push({ t: now, kind: "reject", text: `Rejected candidate: ${c.label}.`, evidence: c.reason });
        }
      }
    }
  }
  return { candidates: out, events, flagged: [...newFlag].slice(-300) };
}
