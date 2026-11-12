import { floorToStep } from "../trade/risk.ts";

export type HiveSizeInput = {
  venue: "paper" | "binance" | "deriv";
  equity: number;
  cash: number;
  riskPct: number;
  sizeMult: number;
  price: number;
  stop: number;
  step?: number;
  minNotional?: number;
  /** Largest position value the account can carry (cash for spot, cash x leverage for futures). */
  maxNotional: number;
};

export type HiveSize = { ok: true; qty: number; notional: number; lossAtStop: number } | { ok: false; why: string };

/** Risk budget divided by stop distance, rounded down to the exchange lot step. Never raised to meet a minimum. */
export function sizeHive(x: HiveSizeInput): HiveSize {
  const mult = Math.min(1, Math.max(0.1, x.sizeMult));
  const riskCash = (x.equity * x.riskPct * mult) / 100;
  if (!(riskCash > 0)) return { ok: false, why: "Risk budget is zero." };
  if (x.venue === "deriv") {
    // A Deriv CALL/PUT can lose at most its stake, so the stake is the risk.
    const stake = Math.min(Math.max(1, Math.round(riskCash * 100) / 100), Math.max(0, x.cash * 0.5));
    if (stake < 0.5) return { ok: false, why: "Deriv balance is too small for a contract." };
    return { ok: true, qty: 1, notional: stake, lossAtStop: stake };
  }
  const dist = Math.abs(x.price - x.stop);
  if (!(dist > 0) || !(x.price > 0)) return { ok: false, why: "Stop distance is zero." };
  let qty = riskCash / dist;
  qty = Math.min(qty, x.maxNotional / x.price);
  qty = floorToStep(qty, x.step ?? 1e-6);
  if (!(qty > 0)) return { ok: false, why: "Size rounds down to nothing at this risk." };
  const notional = qty * x.price;
  if (x.minNotional && notional < x.minNotional) return { ok: false, why: `Order value ${notional.toFixed(2)} is under the exchange minimum ${x.minNotional}.` };
  return { ok: true, qty, notional, lossAtStop: qty * dist };
}
