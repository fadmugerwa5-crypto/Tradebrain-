import type { Plan, Side } from "../market/types.ts";

export type SizeInput = {
  equity: number;
  cash: number;
  riskPct: number;
  stopDist: number;
  price: number;
  step?: number;
  minNotional?: number;
  maxPosPct?: number;
};

export type SizeResult =
  | { ok: true; qty: number; notional: number; lossAtStop: number; riskCash: number }
  | { ok: false; why: string };

const decimals = (step: number) => {
  const s = String(step);
  return s.includes("e-") ? Number(s.split("e-")[1]) : (s.split(".")[1] || "").length;
};

export function floorToStep(qty: number, step: number): number {
  if (!(step > 0)) return qty;
  const n = Math.floor(qty / step + 1e-9) * step;
  return Number(n.toFixed(Math.min(12, decimals(step))));
}

/** Risk budget ÷ stop distance. Rounds down. Never raises size to satisfy a minimum. */
export function size(x: SizeInput): SizeResult {
  const step = x.step || 1e-6;
  const minNotional = x.minNotional || 0;
  const maxPosPct = x.maxPosPct ?? 25;
  if (!(x.equity > 0)) return { ok: false, why: "Equity is unknown or zero." };
  if (!(x.stopDist > 0) || !(x.price > 0)) return { ok: false, why: "No valid stop distance." };
  if (!(x.riskPct > 0)) return { ok: false, why: "Risk percent must be positive." };
  const riskCash = (x.equity * x.riskPct) / 100;
  const capQty = (x.equity * maxPosPct) / 100 / x.price;
  let qty = Math.min(riskCash / x.stopDist, capQty, x.cash / x.price);
  qty = floorToStep(qty, step);
  if (!(qty > 0)) return { ok: false, why: "Risk budget is smaller than one tradable unit. Size was not raised." };
  const notional = qty * x.price;
  if (notional + notional * 0.001 > x.cash + 1e-9) return { ok: false, why: "Not enough free cash for this size and the entry fee." };
  if (notional < minNotional) {
    return { ok: false, why: `Order value ${notional.toFixed(2)} is below the broker minimum ${minNotional}. Size was not raised.` };
  }
  return { ok: true, qty, notional, lossAtStop: qty * x.stopDist, riskCash };
}

export type RiskInput = {
  side: Side;
  price: number;
  plan: Plan | null;
  equity: number;
  cash: number;
  dayPnl: number;
  startEquity: number;
  riskPct: number;
  maxOpenRiskPct: number;
  dailyLossPct: number;
  maxPositions: number;
  maxPerSymbol: number;
  openPositions: number;
  sameSymbol: number;
  openRisk: number;
  halted: string | null;
  longOnly: boolean;
  spreadPct: number | null;
  maxSpreadPct: number;
  seen: boolean;
  cooldownMsLeft: number;
  entriesThisHour: number;
  maxEntriesHour: number;
  minRR: number;
  consecLosses: number;
  consecLimit: number;
  lossPause: boolean;
  goalReached: boolean;
  goalBlocks: boolean;
  ageMs: number | null;
  tfMs: number;
  regime: string;
  step?: number;
  minNotional?: number;
  duplicateSetup: boolean;
  /** The caller sizes the trade itself (Deriv multiplier contracts) and checks combined risk on its own. */
  skipSize?: boolean;
};

export type RiskReport = {
  ok: boolean;
  reasons: string[];
  checks: { name: string; ok: boolean; note: string }[];
  size: SizeResult | null;
};

export function checkRisk(x: RiskInput): RiskReport {
  const checks: { name: string; ok: boolean; note: string }[] = [];
  const add = (name: string, ok: boolean, note: string) => checks.push({ name, ok, note });
  const p = x.plan;
  add("Not halted", !x.halted, x.halted ?? "Running");
  add("Loss pause", !(x.lossPause && x.consecLosses >= x.consecLimit), `${x.consecLosses} consecutive losses`);
  add("Profit goal", !(x.goalReached && x.goalBlocks), x.goalReached ? "Target reached — new entries paused" : "Target still open");
  add("Equity known", x.equity > 0, x.equity > 0 ? "Known" : "Unknown");
  add(
    "Data age",
    x.ageMs != null && x.ageMs <= x.tfMs * 3,
    x.ageMs == null ? "Unknown" : `Newest candle closed ${Math.round(x.ageMs / 1000)}s ago`,
  );
  add("Regime", x.regime !== "Abnormal", x.regime);
  const sideOk = !!p && (x.side === "BUY" ? p.stop < p.entry && p.target > p.entry : p.stop > p.entry && p.target < p.entry);
  add("Stop and target sides", sideOk, sideOk && p ? `Stop ${p.stop.toPrecision(6)}, target ${p.target.toPrecision(6)}` : "Invalid plan");
  const rr = sideOk && p ? Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop) : 0;
  add("Reward to risk", rr + 1e-9 >= x.minRR, `${rr.toFixed(2)}R, needs ${x.minRR}`);
  if (x.spreadPct != null) add("Spread", x.spreadPct <= x.maxSpreadPct, `${x.spreadPct.toFixed(4)}%`);
  else add("Spread", true, "Not supplied by this feed");
  add("Direction allowed", !(x.longOnly && x.side === "SELL"), x.longOnly && x.side === "SELL" ? "This venue cannot open a short" : "Allowed");
  add("Not a duplicate candle", !x.seen, x.seen ? "This candle was already used" : "New");
  add("Not the same setup", !x.duplicateSetup, x.duplicateSetup ? "Price has not moved enough for a fresh entry" : "Fresh enough");
  add("Cooldown", x.cooldownMsLeft <= 0, x.cooldownMsLeft > 0 ? `${Math.ceil(x.cooldownMsLeft / 1000)}s left` : "Clear");
  add("Entries this hour", x.entriesThisHour < x.maxEntriesHour, `${x.entriesThisHour}/${x.maxEntriesHour}`);
  add("Open positions", x.openPositions < x.maxPositions, `${x.openPositions}/${x.maxPositions}`);
  add("Positions on this symbol", x.sameSymbol < x.maxPerSymbol, `${x.sameSymbol}/${x.maxPerSymbol}`);
  const dayLimit = -x.startEquity * (x.dailyLossPct / 100);
  add("Daily loss", x.dayPnl > dayLimit, `Day ${x.dayPnl >= 0 ? "+" : ""}${x.dayPnl.toFixed(2)} (lockout ${dayLimit.toFixed(2)})`);

  let sz: SizeResult | null = null;
  if (x.skipSize) add("Size", sideOk, sideOk ? "Sized by the contract planner" : "No valid plan");
  else if (sideOk && p) {
    sz = size({
      equity: x.equity,
      cash: x.cash,
      riskPct: x.riskPct,
      stopDist: Math.abs(p.entry - p.stop),
      price: x.price,
      step: x.step,
      minNotional: x.minNotional,
    });
    add("Size", sz.ok, sz.ok ? `${sz.qty} units, notional ${sz.notional.toFixed(2)}` : sz.why);
    if (sz.ok) {
      const aggCap = (x.equity * x.maxOpenRiskPct) / 100;
      add("Combined open risk", x.openRisk + sz.lossAtStop <= aggCap + 1e-9, `${(x.openRisk + sz.lossAtStop).toFixed(2)} vs cap ${aggCap.toFixed(2)}`);
    }
  } else add("Size", false, "No plan");

  const reasons = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.note}`);
  return { ok: reasons.length === 0 && (x.skipSize ? true : !!sz && sz.ok), reasons, checks, size: sz };
}
