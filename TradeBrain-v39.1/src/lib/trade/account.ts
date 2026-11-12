import type { Side } from "../market/types.ts";

export type BookAccount = {
  cash: number;
  locked: number;
  startEquity: number;
  dayStartEquity: number;
  dayKey: string;
  feesPaid: number;
  realized: number;
};

export type BookPosition = {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  stop: number;
  target: number;
  openedAt: number;
  fees: number;
  plannedRisk: number;
  reason: string;
  quality: number;
  strategy: string;
  mode: string;
  venue: "paper" | "binance" | "deriv";
  protection: "local-monitor" | "broker-confirmed" | "contract-stake" | "none";
  brokerOrderId: string | null;
  /** Binance OCO order-list id when exchange-side stop and target are confirmed. */
  ocoListId?: string | null;
  status: "open" | "closed" | "uncertain";
  /** true = opened by the HIVE colony. It has its own book, limits and exits. */
  hive?: boolean;
  /** Which HIVE desk and trading style opened it. */
  hiveDesk?: "deriv" | "binance";
  hiveStyle?: "scalp" | "trader";
  /** "swing" = opened by the Trades tab (held hours to days, own limits). Missing = the scalping engine's. */
  book?: "swing";
  /** What is lost if the stop is hit (swing trades). For Deriv multipliers plannedRisk is the stake, which is larger. */
  riskAtStop?: number;
  /** Swing trades: close at market after this time if neither stop nor target was hit. */
  holdUntil?: number;
  /** Deriv contracts: current profit and current sell value, refreshed while the contract is open. */
  livePnl?: number;
  liveValue?: number;
  /** Deriv contracts: the contract length that was actually bought (not every market offers 5 minutes). */
  durLabel?: string;
  /** AI scalp: profit level (in R) the AI chose for banking this trade. */
  aiQuickR?: number;
  /** AI scalp: the AI is managing this trade until this time. After it, the plain rules take over again. */
  aiUntil?: number;
  /** AI scalp: why the AI took this trade. Present means the AI approved the entry. */
  aiNote?: string;
  exit?: number;
  exitReason?: string;
  pnl?: number;
  closedAt?: number;
};

export const FEE = 0.001;
export const SLIP = 0.0002;

export function dayKey(t = Date.now()) {
  return new Date(t).toISOString().slice(0, 10);
}

export function freshAccount(equity = 10_000, now = Date.now()): BookAccount {
  return {
    cash: equity,
    locked: 0,
    startEquity: equity,
    dayStartEquity: equity,
    dayKey: dayKey(now),
    feesPaid: 0,
    realized: 0,
  };
}

export function fillPrice(side: Side, price: number, kind: "entry" | "exit") {
  const slip = kind === "entry" ? (side === "BUY" ? 1 + SLIP : 1 - SLIP) : side === "BUY" ? 1 - SLIP : 1 + SLIP;
  return price * slip;
}

export function unrealized(pos: BookPosition, mark: number) {
  const qty = pos.qty;
  return pos.side === "BUY" ? (mark - pos.entry) * qty : (pos.entry - mark) * qty;
}

export function equityOf(account: BookAccount, positions: BookPosition[], marks: Record<string, number>) {
  const open = positions.filter((p) => p.status === "open");
  const u = open.reduce((s, p) => s + unrealized(p, marks[p.symbol] ?? p.entry), 0);
  return account.cash + account.locked + u;
}

export function openPosition(
  account: BookAccount,
  pos: BookPosition,
): { account: BookAccount; position: BookPosition } | { error: string } {
  const notional = pos.qty * pos.entry;
  const fee = notional * FEE;
  if (account.cash < notional + fee - 1e-8) return { error: "Not enough free cash." };
  return {
    account: { ...account, cash: account.cash - notional - fee, locked: account.locked + notional, feesPaid: account.feesPaid + fee },
    position: { ...pos, fees: fee },
  };
}

export function closePosition(
  account: BookAccount,
  pos: BookPosition,
  exitRaw: number,
  reason: string,
  now: number,
  qty = pos.qty,
): { account: BookAccount; closed: BookPosition; remainder: BookPosition | null } {
  const q = Math.min(qty, pos.qty);
  const exit = fillPrice(pos.side, exitRaw, "exit");
  const notional = q * pos.entry;
  const fee = q * exit * FEE;
  const pnl = (pos.side === "BUY" ? (exit - pos.entry) * q : (pos.entry - exit) * q) - fee - pos.fees * (q / pos.qty);
  const next: BookAccount = {
    ...account,
    cash: account.cash + notional + (pos.side === "BUY" ? (exit - pos.entry) * q : (pos.entry - exit) * q) - fee,
    locked: account.locked - notional,
    feesPaid: account.feesPaid + fee,
    realized: account.realized + pnl,
  };
  const closed: BookPosition = {
    ...pos,
    qty: q,
    status: "closed",
    exit,
    exitReason: reason,
    pnl,
    closedAt: now,
    fees: pos.fees * (q / pos.qty) + fee,
  };
  if (q >= pos.qty - 1e-12) return { account: next, closed, remainder: null };
  return {
    account: next,
    closed,
    remainder: { ...pos, qty: pos.qty - q, fees: pos.fees * (1 - q / pos.qty), plannedRisk: pos.plannedRisk * (1 - q / pos.qty) },
  };
}

/** Risk per unit when the trade was opened. Stays fixed after the stop is moved, so R means the same all trade long. */
export function initialRisk(pos: BookPosition): number {
  return pos.plannedRisk > 0 && pos.qty > 0 ? pos.plannedRisk / pos.qty : Math.abs(pos.entry - pos.stop);
}

/** Local protective rules. A stop is never widened. If stop and target both print, the stop wins. */
export function protectiveIntent(
  pos: BookPosition,
  mark: number,
  candle: { h: number; l: number } | null,
  opts: { trail: boolean; now: number; maxHoldMin: number; scalp?: { quickR: number; lockR: number } },
):
  | { type: "close"; price: number; reason: string }
  | { type: "reduce"; price: number; qty: number; reason: string }
  | { type: "tighten"; stop: number }
  | null {
  if (pos.status !== "open" || pos.protection === "contract-stake") return null;
  const hi = candle ? Math.max(candle.h, mark) : mark;
  const lo = candle ? Math.min(candle.l, mark) : mark;
  const stopHit = pos.side === "BUY" ? lo <= pos.stop : hi >= pos.stop;
  const tgtHit = pos.side === "BUY" ? hi >= pos.target : lo <= pos.target;
  if (stopHit) return { type: "close", price: pos.stop, reason: "Stop — locally monitored, not a broker order unless confirmed" };
  if (tgtHit) return { type: "close", price: pos.target, reason: "Target — locally monitored, not a broker order unless confirmed" };
  const risk = opts.scalp ? initialRisk(pos) : Math.abs(pos.entry - pos.stop);
  const favorable = pos.side === "BUY" ? mark - pos.entry : pos.entry - mark;
  if (opts.scalp && risk > 0) {
    // Scalp: bank a small profit early, and lock breakeven plus fees on the way there.
    const cost = pos.entry * 2 * (FEE + SLIP);
    if (favorable >= Math.max(opts.scalp.quickR * risk, cost * 1.2)) {
      return { type: "close", price: mark, reason: `Quick profit (scalp, ${(favorable / risk).toFixed(2)}R)` };
    }
    if (favorable >= Math.max(opts.scalp.lockR * risk, cost * 1.1)) {
      const lock = pos.side === "BUY" ? pos.entry + cost : pos.entry - cost;
      const tighter = pos.side === "BUY" ? lock > pos.stop : lock < pos.stop;
      if (tighter) return { type: "tighten", stop: lock };
    }
  }
  if (opts.trail && risk > 0 && favorable >= risk && pos.stop !== pos.entry) {
    const tighter = pos.side === "BUY" ? Math.max(pos.stop, pos.entry) : Math.min(pos.stop, pos.entry);
    if (tighter !== pos.stop && (pos.side === "BUY" ? tighter >= pos.stop : tighter <= pos.stop)) {
      return { type: "tighten", stop: tighter };
    }
  }
  if (opts.trail && risk > 0 && favorable >= risk * 1.6 && pos.qty > 0) {
    return { type: "reduce", price: mark, qty: pos.qty / 2, reason: "Scale out half after 1.6R. Remainder stays locally monitored." };
  }
  if (opts.maxHoldMin > 0 && opts.now - pos.openedAt > opts.maxHoldMin * 60_000) {
    return { type: "close", price: mark, reason: "Time stop" };
  }
  return null;
}
