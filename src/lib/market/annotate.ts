import type { Snapshot } from "./analyze.ts";
import { equalLevels, lineAt, previousDayLevels, swingLabels, trendlines } from "./layers.ts";
import type { Candle } from "./types.ts";

export type LayerFlags = {
  plan: boolean;
  trend: boolean;
  ema: boolean;
  bb: boolean;
  vwap: boolean;
  levels: boolean;
  zones: boolean;
  structure: boolean;
  liquidity: boolean;
  prevDay: boolean;
};

export type ChartPlan = { action: string; entry: number; stop: number; target: number } | null;
type Tone = "up" | "down" | "accent" | "muted" | "warn";

export type Annotations = {
  lines: { price: number; tone: Tone; label: string; layer: keyof LayerFlags; dashed: boolean }[];
  boxes: { t: number; lo: number; hi: number; side: "BUY" | "SELL"; label: string }[];
  markers: { t: number; above: boolean; text: string; tone: Tone }[];
  trend: { kind: "support" | "resistance"; a: { t: number; p: number }; b: { t: number; p: number } }[];
  notes: { layer: keyof LayerFlags; label: string; why: string }[];
};

const sec = (c: Candle) => Math.floor(c.t / 1000);

/**
 * Every annotation here comes from a calculation on the loaded candles (or from the engine's own plan).
 * Nothing is drawn for decoration: each entry carries the reason it exists.
 */
export function buildAnnotations(candles: Candle[], snap: Snapshot | null, layers: LayerFlags, plan: ChartPlan): Annotations {
  const out: Annotations = { lines: [], boxes: [], markers: [], trend: [], notes: [] };
  if (!snap || candles.length < 60) return out;
  const price = snap.price;
  const last = candles.length - 1;

  if (layers.levels) {
    for (const lv of snap.levels.filter((l) => Math.abs(l.p - price) / price < 0.03).slice(-8)) {
      const label = lv.n > 1 ? `S/R ×${lv.n}` : lv.p >= price ? "Resistance" : "Support";
      out.lines.push({ price: lv.p, tone: lv.p >= price ? "down" : "up", label, layer: "levels", dashed: true });
      out.notes.push({ layer: "levels", label: `${label} ${lv.p.toPrecision(6)}`, why: `${lv.n} confirmed swing point(s) clustered within about half an ATR of this price.` });
    }
  }

  if (layers.zones) {
    for (const z of snap.zones.slice(-6)) {
      const c = candles[z.i];
      if (!c) continue;
      const label = `${z.kind === "ob" ? "OB" : "FVG"} ${z.side === "BUY" ? "demand" : "supply"}`;
      out.boxes.push({ t: sec(c), lo: z.lo, hi: z.hi, side: z.side, label });
      out.notes.push({
        layer: "zones",
        label: `${label} ${z.lo.toPrecision(6)}–${z.hi.toPrecision(6)}`,
        why:
          z.kind === "ob"
            ? "Order block: last opposite-body candle before a move of at least 1.6 ATR within 3 closes. Removed once price closes through it."
            : "Fair value gap: candle i-2 and candle i leave a gap of at least 0.3 ATR. Removed once price closes through it.",
      });
    }
  }

  if (layers.structure) {
    for (const ev of snap.structure.filter((e) => e.kind !== "sweep").slice(-6)) {
      const c = candles[ev.i];
      if (!c) continue;
      out.markers.push({ t: sec(c), above: ev.side === "SELL", text: ev.kind, tone: ev.kind === "CHoCH" ? "warn" : ev.side === "BUY" ? "up" : "down" });
      out.notes.push({ layer: "structure", label: `${ev.kind} ${ev.side === "BUY" ? "bullish" : "bearish"} @ ${ev.price.toPrecision(6)}`, why: ev.why });
    }
    for (const s of swingLabels(snap.piv).slice(-6)) {
      const c = candles[s.i];
      if (!c) continue;
      out.markers.push({ t: sec(c), above: s.high, text: s.label, tone: "muted" });
    }
    if (swingLabels(snap.piv).length) {
      out.notes.push({ layer: "structure", label: "Swing labels HH / HL / LH / LL", why: "Each confirmed swing compared with the previous swing of the same kind (3 bars each side)." });
    }
  }

  if (layers.trend) {
    for (const t of trendlines(snap.piv)) {
      const a = candles[t.a.i];
      const l = candles[last];
      if (!a || !l) continue;
      out.trend.push({ kind: t.kind, a: { t: sec(a), p: t.a.p }, b: { t: sec(l), p: lineAt(t, last) } });
      out.notes.push({ layer: "trend", label: `${t.kind === "support" ? "Rising support" : "Falling resistance"} trendline`, why: t.why });
    }
  }

  if (layers.liquidity) {
    const tol = Math.max((snap.atr ?? 0) * 0.25, price * 0.0008);
    const eq = equalLevels(snap.piv, tol);
    for (const h of eq.highs.slice(-3)) {
      out.lines.push({ price: h.price, tone: "warn", label: `Equal highs ×${h.n}`, layer: "liquidity", dashed: true });
      out.notes.push({ layer: "liquidity", label: `Equal highs ${h.price.toPrecision(6)}`, why: `${h.n} swing highs within ${tol.toPrecision(3)} of each other: resting stops often sit above them.` });
    }
    for (const l of eq.lows.slice(-3)) {
      out.lines.push({ price: l.price, tone: "warn", label: `Equal lows ×${l.n}`, layer: "liquidity", dashed: true });
      out.notes.push({ layer: "liquidity", label: `Equal lows ${l.price.toPrecision(6)}`, why: `${l.n} swing lows within ${tol.toPrecision(3)} of each other: resting stops often sit below them.` });
    }
    for (const ev of snap.structure.filter((e) => e.kind === "sweep").slice(-4)) {
      const c = candles[ev.i];
      if (!c) continue;
      out.markers.push({ t: sec(c), above: ev.side === "SELL", text: "Sweep", tone: "warn" });
      out.notes.push({ layer: "liquidity", label: `Liquidity sweep @ ${ev.price.toPrecision(6)}`, why: ev.why });
    }
  }

  if (layers.prevDay) {
    const pd = previousDayLevels(candles);
    if (pd) {
      out.lines.push({ price: pd.high, tone: "muted", label: "PDH", layer: "prevDay", dashed: true });
      out.lines.push({ price: pd.low, tone: "muted", label: "PDL", layer: "prevDay", dashed: true });
      out.notes.push({ layer: "prevDay", label: `Previous day ${pd.low.toPrecision(6)}–${pd.high.toPrecision(6)}`, why: `High and low of ${pd.day} (UTC) from the candles loaded.` });
    } else {
      out.notes.push({ layer: "prevDay", label: "Previous day high/low unavailable", why: "The loaded candles do not contain a complete previous UTC day, so none is drawn." });
    }
  }

  if (layers.plan && plan && (plan.action === "BUY" || plan.action === "SELL")) {
    out.lines.push({ price: plan.entry, tone: "accent", label: `Plan ${plan.action} entry`, layer: "plan", dashed: false });
    out.lines.push({ price: plan.stop, tone: "down", label: "Plan stop", layer: "plan", dashed: false });
    out.lines.push({ price: plan.target, tone: "up", label: "Plan target", layer: "plan", dashed: false });
    out.notes.push({ layer: "plan", label: `Engine ${plan.action} candidate`, why: "Entry, stop and target from the decision engine's current plan. These are calculations, not broker orders." });
  }
  out.markers.sort((a, b) => a.t - b.t);
  return out;
}
