import { useEffect, useMemo, useRef, useState } from "react";
import * as LC from "lightweight-charts";
import { snapshot } from "@/lib/market/analyze";
import { buildAnnotations, type ChartPlan } from "@/lib/market/annotate";
import { atrSeries, bollinger, ema, macdSeries, rsiSeries } from "@/lib/market/indicators";
import type { Candle } from "@/lib/market/types";
import { MODE_PROFILES } from "@/lib/market/types";
import type { BookPosition } from "@/lib/trade/account";
import type { Drawing, Settings } from "@/stores/brain";

export type DrawTool = "none" | "h" | "t";

type Props = {
  candles: Candle[];
  settings: Settings;
  positions: BookPosition[];
  symbol: string;
  plan: ChartPlan;
  drawings: Drawing[];
  tool: DrawTool;
  fullscreen: boolean;
  onDraw: (d: Drawing) => void;
};

const TONES: Record<string, string> = { up: "#3d9a78", down: "#c45c5c", accent: "#c5d0db", muted: "#7d8794", warn: "#d4a24c" };

/** Filled rectangles for zones, drawn as a series primitive. If the primitive API misbehaves, zones fall back to price lines. */
function zonePrimitive(boxes: { t: number; lo: number; hi: number; side: "BUY" | "SELL"; label: string }[]) {
  let chart: any;
  let series: any;
  const renderer = {
    draw(target: any) {
      try {
        target.useMediaCoordinateSpace((scope: any) => {
          const ctx = scope.context as CanvasRenderingContext2D;
          for (const z of boxes) {
            const y1 = series.priceToCoordinate(z.hi);
            const y2 = series.priceToCoordinate(z.lo);
            if (y1 == null || y2 == null) continue;
            const left = Math.max(0, chart.timeScale().timeToCoordinate(z.t) ?? 0);
            ctx.fillStyle = z.side === "BUY" ? "rgba(61,154,120,0.16)" : "rgba(196,92,92,0.16)";
            ctx.fillRect(left, Math.min(y1, y2), scope.mediaSize.width - left, Math.max(2, Math.abs(y2 - y1)));
            ctx.fillStyle = z.side === "BUY" ? "#3d9a78" : "#c45c5c";
            ctx.font = "11px sans-serif";
            ctx.fillText(z.label, left + 4, Math.min(y1, y2) + 12);
          }
        });
      } catch {
        /* drawing must never break the chart */
      }
    },
  };
  return {
    attached(p: any) {
      chart = p.chart;
      series = p.series;
    },
    detached() {},
    updateAllViews() {},
    paneViews() {
      return [{ zOrder: () => "bottom" as const, renderer: () => renderer }];
    },
  };
}

export function ChartView({ candles, settings, positions, symbol, plan, drawings, tool, fullscreen, onDraw }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<{ key: string; r: { from: number; to: number } } | null>(null);
  const pending = useRef<{ t: number; p: number } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const drawRef = useRef(onDraw);
  drawRef.current = onDraw;
  const [problem, setProblem] = useState("");
  const profile = MODE_PROFILES[settings.mode];
  // The chart library throws on repeated or out-of-order times. A feed hiccup must never leave the chart blank, so the series is cleaned first.
  const clean = useMemo(() => {
    const ok = candles.filter((c) => Number.isFinite(c.t) && Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c)).sort((a, b) => a.t - b.t);
    return ok.filter((c, i) => i === 0 || Math.floor(c.t / 1000) > Math.floor(ok[i - 1]!.t / 1000));
  }, [candles]);
  const snap = useMemo(() => snapshot(clean, profile.minRR), [clean, profile.minRR]);
  const ann = useMemo(() => buildAnnotations(clean, snap, settings.layers, plan), [clean, snap, settings.layers, plan]);
  const mine = useMemo(() => positions.filter((p) => p.symbol === symbol && p.status === "open"), [positions, symbol]);
  const mineKey = mine.map((p) => `${p.id}:${p.entry}:${p.stop}:${p.target}:${p.protection}`).join("|");
  const mineRef = useRef(mine);
  mineRef.current = mine;

  useEffect(() => {
    const el = ref.current;
    if (!el || clean.length < 2) return;
    const candles = clean;
    let dead = false;
    let cleanup = () => {};
    const problems: string[] = [];
    /** An optional layer (an overlay, a pane, an annotation) that fails is skipped and reported. The candles always draw. */
    const safe = (name: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        problems.push(`${name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    };
    void (async () => {
      const lc = LC;
      if (dead || !ref.current) return;
      let created: ReturnType<typeof LC.createChart> | null = null;
      try {
      const css = getComputedStyle(document.documentElement);
      const pick = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
      const bg = pick("--color-bg", "#0c0e12");
      const fg = pick("--color-muted", "#9aa3ad");
      const line = pick("--color-line", "#2a313b");
      const up = pick("--color-up", "#3d9a78");
      const down = pick("--color-down", "#c45c5c");
      const accent = pick("--color-accent", "#c5d0db");
      const tone = (n: string) => (n === "up" ? up : n === "down" ? down : n === "accent" ? accent : (TONES[n] ?? fg));
      const chart = lc.createChart(ref.current, {
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: bg }, textColor: fg, fontFamily: "IBM Plex Sans, sans-serif", panes: { separatorColor: line } } as never,
        grid: { vertLines: { color: line }, horzLines: { color: line } },
        crosshair: { mode: lc.CrosshairMode.Normal },
        rightPriceScale: { borderColor: line },
        timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
      });
      created = chart;
      const T = (c: Candle) => Math.floor(c.t / 1000) as never;
      const data = candles.map((c) => ({ time: T(c), open: c.o, high: c.h, low: c.l, close: c.c }));
      const main =
        settings.chartStyle === "line"
          ? chart.addSeries(lc.LineSeries, { color: accent, lineWidth: 2 })
          : chart.addSeries(lc.CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
      if (settings.chartStyle === "line") main.setData(data.map((d) => ({ time: d.time, value: d.close })));
      else main.setData(data);

      const closes = candles.map((c) => c.c);
      const toLine = (arr: Array<number | null>) => arr.flatMap((v, i) => (v == null ? [] : [{ time: T(candles[i]!), value: v }]));
      const overlay = (arr: Array<number | null>, color: string, style?: number) =>
        chart.addSeries(lc.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, ...(style != null ? { lineStyle: style } : {}) }).setData(toLine(arr));
      const L = settings.layers;
      const I = settings.ind;
      safe("moving averages", () => {
        if (!L.ema) return;
        if (I.ema1 > 1) overlay(ema(closes, I.ema1), accent);
        if (I.ema2 > 1) overlay(ema(closes, I.ema2), fg);
        if (I.ema3 > 1) overlay(ema(closes, I.ema3), TONES.warn!);
      });
      safe("bollinger", () => {
        if (!L.bb) return;
        const b = bollinger(closes, Math.max(2, I.bbPeriod), I.bbK);
        overlay(b.up, TONES.muted!, lc.LineStyle.Dotted);
        overlay(b.mid, TONES.muted!, lc.LineStyle.Dashed);
        overlay(b.lo, TONES.muted!, lc.LineStyle.Dotted);
      });
      safe("vwap", () => {
        if (L.vwap && snap && snap.vwap.length === candles.length) overlay(snap.vwap, up, lc.LineStyle.Dotted);
      });

      // Annotations from the pure builder
      safe("levels", () => {
        for (const l of ann.lines) {
          if (!Number.isFinite(l.price)) continue;
          main.createPriceLine({ price: l.price, color: tone(l.tone), lineWidth: 1, lineStyle: l.dashed ? lc.LineStyle.Dashed : lc.LineStyle.Solid, title: l.label, axisLabelVisible: true });
        }
      });
      if (ann.boxes.length) {
        try {
          (main as any).attachPrimitive(zonePrimitive(ann.boxes));
        } catch {
          for (const z of ann.boxes) {
            for (const price of [z.lo, z.hi]) main.createPriceLine({ price, color: z.side === "BUY" ? up : down, lineWidth: 1, lineStyle: lc.LineStyle.Dotted, title: z.label, axisLabelVisible: false });
          }
        }
      }
      for (const t of ann.trend) {
        safe("trend line", () => {
          if (!(t.b.t > t.a.t)) return;
          chart
            .addSeries(lc.LineSeries, { color: t.kind === "support" ? up : down, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
            .setData([
              { time: t.a.t as never, value: t.a.p },
              { time: t.b.t as never, value: t.b.p },
            ]);
        });
      }
      safe("markers", () => {
        if (!ann.markers.length || typeof (lc as any).createSeriesMarkers !== "function") return;
        const sorted = [...ann.markers].sort((a, b) => a.t - b.t);
        (lc as any).createSeriesMarkers(
          main,
          sorted.map((m) => ({ time: m.t, position: m.above ? "aboveBar" : "belowBar", color: tone(m.tone), shape: "circle", text: m.text, size: 0.5 })),
        );
      });

      // Open positions: real entry, stop, target and size for this symbol only
      for (const pos of mineRef.current) {
        const tag = `${pos.side} ${pos.qty}`;
        main.createPriceLine({ price: pos.entry, color: accent, lineWidth: 2, lineStyle: lc.LineStyle.Solid, title: `Entry ${tag}`, axisLabelVisible: true });
        main.createPriceLine({ price: pos.stop, color: down, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, title: pos.protection === "broker-confirmed" ? "Stop (broker)" : "Stop (local)", axisLabelVisible: true });
        main.createPriceLine({ price: pos.target, color: up, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, title: pos.protection === "contract-stake" ? "Contract ref" : pos.protection === "broker-confirmed" ? "Target (broker)" : "Target (local)", axisLabelVisible: true });
      }

      // User drawings, kept per symbol
      for (const d of drawings) {
        if (d.kind === "h") main.createPriceLine({ price: d.a.p, color: TONES.warn!, lineWidth: 1, lineStyle: lc.LineStyle.Solid, title: "Mine", axisLabelVisible: true });
        else if (d.b && d.a.t !== d.b.t) {
          const [p, q] = d.a.t < d.b.t ? [d.a, d.b] : [d.b, d.a];
          chart.addSeries(lc.LineSeries, { color: TONES.warn!, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData([
            { time: p.t as never, value: p.p },
            { time: q.t as never, value: q.p },
          ]);
        }
      }

      // Indicator panes (one chart, shared time axis)
      let pane = 1;
      const P = settings.panels;
      const place = (fn: (idx: number) => void) => {
        const idx = pane;
        safe(`pane ${idx}`, () => fn(idx));
        pane++;
      };
      if (P.volume)
        place((i) => {
          const s = chart.addSeries(lc.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, i);
          s.setData(candles.map((c) => ({ time: T(c), value: c.v, color: c.c >= c.o ? `${up}99` : `${down}99` })));
        });
      if (P.rsi)
        place((i) => {
          const s = chart.addSeries(lc.LineSeries, { color: accent, lineWidth: 1, priceLineVisible: false }, i);
          s.setData(toLine(rsiSeries(closes, Math.max(2, I.rsiPeriod))));
          s.createPriceLine({ price: 70, color: down, lineStyle: lc.LineStyle.Dotted, lineWidth: 1, title: "70" });
          s.createPriceLine({ price: 30, color: up, lineStyle: lc.LineStyle.Dotted, lineWidth: 1, title: "30" });
        });
      if (P.macd)
        place((i) => {
          const m = macdSeries(closes, I.macdFast, I.macdSlow, I.macdSignal);
          const h = chart.addSeries(lc.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, i);
          h.setData(m.hist.flatMap((v, k) => (v == null ? [] : [{ time: T(candles[k]!), value: v, color: v >= 0 ? `${up}99` : `${down}99` }])));
          chart.addSeries(lc.LineSeries, { color: accent, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, i).setData(toLine(m.line));
          chart.addSeries(lc.LineSeries, { color: TONES.warn!, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, i).setData(toLine(m.signal));
        });
      if (P.atr)
        place((i) => {
          chart.addSeries(lc.LineSeries, { color: fg, lineWidth: 1, priceLineVisible: false }, i).setData(toLine(atrSeries(candles)));
        });
      try {
        const panes = chart.panes();
        panes.forEach((p: any, k: number) => {
          if (k > 0 && typeof p.setHeight === "function") p.setHeight(fullscreen ? 140 : 96);
        });
      } catch {
        /* pane sizing is cosmetic */
      }

      // Drawing tools
      const onClick = (param: any) => {
        const mode = toolRef.current;
        if (mode === "none" || !param?.point || param.time == null) return;
        const price = main.coordinateToPrice(param.point.y);
        if (price == null) return;
        const here = { t: Number(param.time), p: Number(price) };
        if (mode === "h") drawRef.current({ id: crypto.randomUUID(), kind: "h", a: here });
        else if (!pending.current) pending.current = here;
        else {
          drawRef.current({ id: crypto.randomUUID(), kind: "t", a: pending.current, b: here });
          pending.current = null;
        }
      };
      chart.subscribeClick(onClick);

      // Keep the user's zoom/pan across data refreshes of the same market and timeframe
      const key = `${symbol}|${settings.interval}`;
      const ts = chart.timeScale();
      if (range.current?.key === key) ts.setVisibleLogicalRange(range.current.r);
      else ts.fitContent();
      const save = (r: { from: number; to: number } | null) => {
        if (r) range.current = { key, r };
      };
      ts.subscribeVisibleLogicalRangeChange(save);
      cleanup = () => {
        ts.unsubscribeVisibleLogicalRangeChange(save);
        chart.unsubscribeClick(onClick);
        chart.remove();
      };
      setProblem(problems.length ? `Some chart layers were skipped: ${problems.join("; ")}` : "");
      } catch (err) {
        try {
          created?.remove();
        } catch {
          /* already gone */
        }
        if (!dead) setProblem(`The chart could not be drawn: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, [clean, snap, ann, settings.chartStyle, settings.layers, settings.panels, settings.ind, settings.interval, settings.mode, mineKey, symbol, drawings, fullscreen]);

  if (clean.length < 2) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-line bg-elev px-6 text-center text-sm text-muted">
        No candles for {symbol} yet. If this is a Deriv forex symbol, authorize a Deriv token on the Connect tab first. Nothing is drawn from made-up prices.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className={`w-full overflow-hidden rounded-lg border border-line bg-bg ${fullscreen ? "h-[calc(100vh-9rem)]" : "h-[520px]"}`} />
      {problem && <p className="text-xs text-warn">{problem}</p>}
      {snap == null && <p className="text-xs text-faint">Analysis overlays need at least 60 candles. {clean.length} loaded.</p>}
      {ann.notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {ann.notes.map((n, i) => (
            <li key={`${n.layer}-${i}`}>
              <span className="text-fg">{n.label}</span> · {n.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
