import { summarize } from "@/lib/trade/stats";
import { useBrain } from "@/stores/brain";

const f = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

export function ScalpStats() {
  const positions = useBrain((s) => s.positions);
  const rows = [
    { label: "All trades", s: summarize(positions) },
    { label: "Aggressive", s: summarize(positions, (p) => p.mode === "aggressive") },
    { label: "Aggressive, AI approved", s: summarize(positions, (p) => p.mode === "aggressive" && !!p.aiNote) },
    { label: "Aggressive, rules only", s: summarize(positions, (p) => p.mode === "aggressive" && !p.aiNote) },
  ];
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-medium">Results (closed trades)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-faint">
            <tr>
              <th className="pb-1 pr-3 font-normal">Group</th>
              <th className="pb-1 pr-3 font-normal">Trades</th>
              <th className="pb-1 pr-3 font-normal">Win %</th>
              <th className="pb-1 pr-3 font-normal">Avg win</th>
              <th className="pb-1 pr-3 font-normal">Avg loss</th>
              <th className="pb-1 font-normal">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, s }) => (
              <tr key={label} className="border-t border-line">
                <td className="py-1 pr-3 text-fg">{label}</td>
                <td className="py-1 pr-3">{s.n}</td>
                <td className="py-1 pr-3">{s.n ? (s.winRate * 100).toFixed(0) : "–"}</td>
                <td className="py-1 pr-3">{s.wins ? f(s.avgWin) : "–"}</td>
                <td className="py-1 pr-3">{s.n - s.wins > 0 && s.avgLoss ? f(s.avgLoss) : "–"}</td>
                <td className="py-1">{s.n ? f(s.net) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">Compare "AI approved" with "rules only" before trusting the AI with real money. A group needs about 30 trades before its numbers mean much.</p>
    </div>
  );
}
