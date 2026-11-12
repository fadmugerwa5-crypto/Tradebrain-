import { useMemo } from "react";
import { AGENTS, ANALYSTS } from "@/lib/hive/agents";
import { scorecards, weightsFrom } from "@/lib/hive/learn";
import { useHive } from "@/stores/hive";
import { ago } from "@/lib/format";

const tagCls = (t: string) => (t === "clean-win" ? "border-up/40 text-up" : t === "went-nowhere" ? "border-line text-faint" : "border-warn/40 text-warn");

/** What the colony has learned: each analyst's hit rate, and the lessons from real trades. */
export function LearnPanel() {
  const lessons = useHive((s) => s.lessons);
  const coachNote = useHive((s) => s.coachNote);
  const cards = useMemo(() => scorecards(lessons), [lessons]);
  const weights = useMemo(() => weightsFrom(cards), [cards]);
  return (
    <section className="rounded-[22px] border border-line bg-elev p-4">
      <h3 className="text-base font-medium">What the colony learned</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">After every closed trade the app measures what the price did, grades each analyst, and writes a lesson. The lessons that fit a market are shown to all agents before the next round. An agent&apos;s vote counts for more or less once it has been graded on 10 trades.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {ANALYSTS.map((id) => {
          const a = AGENTS.find((x) => x.id === id)!;
          const c = cards[id];
          const acc = c && c.n ? Math.round((c.right / c.n) * 100) : null;
          return (
            <li key={id} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium" style={{ color: a.color }}>
                  {a.name}
                </span>
                <span className="text-faint">{c ? `${c.right} of ${c.n} right${weights[id] != null ? ` · weight ${weights[id]!.toFixed(2)}` : c.n < 10 ? " · learning" : ""}` : "no graded trades yet"}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elev-2">
                <div className="h-full rounded-full" style={{ width: `${acc ?? 0}%`, background: a.color }} />
              </div>
            </li>
          );
        })}
      </ul>
      {coachNote && (
        <p className="mt-3 rounded-2xl bg-bg/60 p-3 text-xs leading-relaxed text-muted">
          <span className="font-medium text-fg">Coach: </span>
          {coachNote}
        </p>
      )}
      <h4 className="mt-4 text-sm font-medium">Lessons</h4>
      {lessons.length === 0 ? (
        <p className="mt-1 text-xs text-muted">No lessons yet. They appear a few minutes after each trade closes.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {lessons.slice(0, 10).map((l) => (
            <li key={l.id} className="rounded-2xl border border-line p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {l.symbol} {l.side} <span className="font-normal text-faint">· {l.style}</span>
                </span>
                <span className={l.r >= 0 ? "text-up" : "text-down"}>
                  {l.r >= 0 ? "+" : ""}
                  {l.r.toFixed(1)}R
                </span>
              </div>
              <p className="mt-1 leading-snug text-muted">{l.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {l.tags.map((t) => (
                  <span key={t} className={`rounded-full border px-2 py-0.5 text-[10px] ${tagCls(t)}`}>
                    {t.replace(/-/g, " ")}
                  </span>
                ))}
                <span className="ml-auto text-[10px] text-faint">{ago(l.t)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
