import type { BookAccount, BookPosition } from "./account.ts";

export type GoalConfig = {
  /** "amount" = currency targets below; "percent" = targets are % of starting equity. */
  basis: "amount" | "percent";
  session: number;
  daily: number;
  weekly: number;
  /** Session length in hours. 0 = no time limit. */
  sessionHours: number;
  /** Epoch ms when the current session began, or null if none started. */
  sessionStart: number | null;
  /** Peak-to-now equity drop that halts new entries. 0 = off. */
  maxDrawdownPct: number;
  /** What happens on reaching a target. Default: stop new entries, keep managing open positions. */
  onReach: "stop-entries" | "continue";
};

export const GOAL_DEFAULTS: GoalConfig = {
  basis: "amount",
  session: 100,
  daily: 0,
  weekly: 0,
  sessionHours: 0,
  sessionStart: null,
  maxDrawdownPct: 5,
  onReach: "stop-entries",
};

export type GoalRow = {
  key: "session" | "daily" | "weekly";
  label: string;
  target: number;
  realized: number;
  remaining: number;
  progress: number;
  reached: boolean;
};

export type GoalState = {
  rows: GoalRow[];
  anyReached: boolean;
  sessionExpired: boolean;
  drawdownPct: number;
  drawdownBreached: boolean;
  /** True when new entries must be blocked for goal or drawdown reasons. */
  blocks: boolean;
  reason: string | null;
  unrealized: number;
  fees: number;
};

export function startOfUtcDay(t: number) {
  return Math.floor(t / 86_400_000) * 86_400_000;
}

/** Monday 00:00 UTC of the week containing t. */
export function startOfUtcWeek(t: number) {
  const day = startOfUtcDay(t);
  const dow = new Date(day).getUTCDay(); // 0 = Sunday
  return day - ((dow + 6) % 7) * 86_400_000;
}

/** Realized only: closed positions with a recorded close time at or after `since`. Open gains are never counted. */
export function realizedSince(positions: BookPosition[], since: number): number {
  return positions.reduce((s, p) => (p.status === "closed" && p.pnl != null && (p.closedAt ?? 0) >= since ? s + p.pnl : s), 0);
}

export function evalGoal(input: {
  goal: GoalConfig;
  positions: BookPosition[];
  account: BookAccount;
  equity: number;
  peakEquity: number;
  unrealized: number;
  now: number;
}): GoalState {
  const { goal, positions, account, equity, now } = input;
  const base = account.startEquity > 0 ? account.startEquity : 0;
  const toAmount = (v: number) => (goal.basis === "percent" ? (base * v) / 100 : v);
  const sessionStart = goal.sessionStart ?? startOfUtcDay(now);
  const sessionExpired = goal.sessionHours > 0 && goal.sessionStart != null && now - goal.sessionStart >= goal.sessionHours * 3_600_000;
  const defs: { key: GoalRow["key"]; label: string; value: number; since: number }[] = [
    { key: "session", label: "Session", value: goal.session, since: sessionStart },
    { key: "daily", label: "Daily", value: goal.daily, since: startOfUtcDay(now) },
    { key: "weekly", label: "Weekly", value: goal.weekly, since: startOfUtcWeek(now) },
  ];
  const rows: GoalRow[] = defs
    .filter((d) => d.value > 0)
    .map((d) => {
      const target = toAmount(d.value);
      const realized = realizedSince(positions, d.since);
      return {
        key: d.key,
        label: d.label,
        target,
        realized,
        remaining: Math.max(0, target - realized),
        progress: target > 0 ? Math.max(0, Math.min(1, realized / target)) : 0,
        reached: target > 0 && realized >= target,
      };
    });
  const anyReached = rows.some((r) => r.reached);
  const peak = Math.max(input.peakEquity, equity, 0);
  const drawdownPct = peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;
  const drawdownBreached = goal.maxDrawdownPct > 0 && drawdownPct >= goal.maxDrawdownPct;
  let reason: string | null = null;
  if (drawdownBreached) reason = `Drawdown ${drawdownPct.toFixed(2)}% reached the ${goal.maxDrawdownPct}% limit. New entries are blocked.`;
  else if (sessionExpired) reason = "Session time is over. New entries are blocked until a new session starts.";
  else if (anyReached && goal.onReach === "stop-entries") reason = `${rows.find((r) => r.reached)!.label} target reached. New entries are paused; open positions are still managed.`;
  return {
    rows,
    anyReached,
    sessionExpired,
    drawdownPct,
    drawdownBreached,
    blocks: reason != null,
    reason,
    unrealized: input.unrealized,
    fees: account.feesPaid,
  };
}
