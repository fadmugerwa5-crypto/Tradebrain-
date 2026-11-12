import { useBrain } from "@/stores/brain";
import { scalpFor } from "@/lib/trade/scalp";
import type { Candidate } from "@/lib/trade/radar";

function Row({ c, chosen }: { c: Candidate; chosen: boolean }) {
  const e = c.edge;
  return (
    <li className="border-t border-line py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          {c.label} <span className={c.side === "BUY" ? "text-up" : "text-down"}>{c.side}</span>
        </span>
        <span className={chosen ? "text-up" : "text-muted"}>{chosen ? "scalping" : c.ai?.action === "SKIP" ? "AI skipped" : "candidate"} · {c.score}</span>
      </div>
      <p className="mt-1 text-xs text-faint">
        {c.strategyName} · {e.trades} past trades, {Math.round(e.winRate * 100)}% won, {e.avgR >= 0 ? "+" : ""}
        {e.avgR.toFixed(2)}R each after fees · {c.group}
      </p>
      {c.learn ? <p className="mt-1 text-xs text-faint">Market: {c.learn.regime} · {c.learn.htfMin}m bias {c.learn.htfBias} ({c.learn.align === "with" ? "with the trade" : c.learn.align === "against" ? "against the trade" : c.learn.align}){c.learn.note ? ` · ${c.learn.note}` : ""} · {c.ai ? "AI reviewed" : "rules only"}</p> : null}
      {c.ai?.reason ? <p className="mt-1 text-xs text-muted">AI: {c.ai.reason}</p> : null}
      {chosen && (
        <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-muted">
          {c.howTo.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** What the scalp radar found: every market scanned with every strategy, the best candidates, and how to scalp them. */
export function RadarPanel() {
  const radar = useBrain((s) => s.radar);
  const settings = useBrain((s) => s.settings);
  const scalpOn = !!scalpFor(settings.mode, settings.scalp);
  if (!settings.radar.enabled) return null;
  if (!scalpOn)
    return (
      <div className="tb-card p-3 text-sm">
        <h2 className="font-medium">Scalp radar</h2>
        <p className="mt-1 text-xs text-faint">The radar is on but only runs in Aggressive mode with scalp rules on. Open Controls and tap &ldquo;Start scalp radar&rdquo;.</p>
      </div>
    );
  return (
    <div className="tb-card p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Scalp radar</h2>
        {radar && (
          <span className="text-xs text-muted">
            {radar.withData}/{radar.total} markets · {radar.interval}{radar.warm && !radar.warm.done ? ` · warming up ${radar.warm.pct}%` : ""}
          </span>
        )}
      </div>
      {!radar ? (
        <p className="mt-2 text-sm text-faint">Waiting for the first scan.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-faint">{radar.note}</p>
          <p className="mt-1 text-xs text-faint">
            {radar.signals} live signals · dropped: {radar.rejected.noEdge} weak record, {radar.rejected.fees} fees, {radar.rejected.stale} already ran, {radar.rejected.lowScore} low score, {radar.rejected.learned ?? 0} by learning rules, {radar.rejected.unsure ?? 0} not sure enough, {radar.rejected.benched ?? 0} benched after losses, {radar.rejected.crowded ?? 0} too similar to a better pick
          </p>
          <ul className="mt-2 flex flex-col">
            {radar.shortlist.map((c) => (
              <Row key={c.key} c={c} chosen={radar.chosen.includes(c.symbol)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
