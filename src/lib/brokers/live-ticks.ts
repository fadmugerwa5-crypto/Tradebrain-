import type { BinanceEnv } from "../market/types.ts";
import { assessJump, type Tick, type JumpAssessment } from "../trade/jump-scalper.ts";

export type LiveTick = Tick & { symbol: string; venue: "binance" | "deriv" };
export type TickFeedStatus = { venue: "binance" | "deriv"; connected: boolean; subscribed: string[]; lastMessageAt: number; error: string };
type Listener = (tick: LiveTick) => void;

/** Browser-side public market-data feeds. This service never places orders. */
export class LiveTickHub {
  private sockets = new Map<string, WebSocket>();
  private listeners = new Set<Listener>();
  private buffers = new Map<string, LiveTick[]>();
  private status: Record<"binance" | "deriv", TickFeedStatus> = {
    binance: { venue: "binance", connected: false, subscribed: [], lastMessageAt: 0, error: "" },
    deriv: { venue: "deriv", connected: false, subscribed: [], lastMessageAt: 0, error: "" },
  };
  private retry = new Map<string, number>();
  private stopped = false;

  onTick(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getStatus() { return { binance: { ...this.status.binance }, deriv: { ...this.status.deriv } }; }
  getTicks(venue: "binance" | "deriv", symbol: string) { return [...(this.buffers.get(`${venue}:${symbol}`) ?? [])]; }
  assess(venue: "binance" | "deriv", symbol: string): JumpAssessment { return assessJump(this.getTicks(venue, symbol)); }

  startBinance(env: BinanceEnv, symbols: string[]) {
    this.stopped = false;
    const valid = [...new Set(symbols.map(s => s.toLowerCase()).filter(s => /^[a-z0-9]{5,20}$/.test(s)))];
    if (!valid.length) return;
    // Binance public market-data streams are shared across demo/live account environments.
    const futures = env.startsWith("fut-");
    const base = futures ? "wss://fstream.binance.com/stream?streams=" : "wss://stream.binance.com:9443/stream?streams=";
    const streams = valid.flatMap(s => [`${s}@trade`, `${s}@bookTicker`]);
    const key = `binance:${env}`;
    const existing = this.sockets.get(key);
    const signature = valid.join(",");
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING) && this.status.binance.subscribed.join(",") === signature) return;
    if (existing) { try { existing.close(); } catch { /* no-op */ } this.sockets.delete(key); }
    this.connect(key, `${base}${streams.join("/")}`, "binance", valid);
  }

  startDeriv(symbols: string[]) {
    this.stopped = false;
    const valid = [...new Set(symbols.filter(Boolean))];
    if (!valid.length) return;
    const key = `deriv:public`;
    const existing = this.sockets.get(key);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      const added = valid.filter(symbol => !this.status.deriv.subscribed.includes(symbol));
      this.status.deriv.subscribed = [...new Set([...this.status.deriv.subscribed, ...valid])];
      if (existing.readyState === WebSocket.OPEN) for (const symbol of added) existing.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      return;
    }
    this.status.deriv.subscribed = valid;
    const ws = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
    this.sockets.set(key, ws);
    ws.onopen = () => {
      this.status.deriv = { ...this.status.deriv, connected: true, subscribed: valid, error: "" };
      for (const symbol of this.status.deriv.subscribed) ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    };
    ws.onmessage = ev => {
      this.status.deriv.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(String(ev.data));
        const q = msg?.tick;
        if (q?.symbol && Number(q.quote) > 0) this.emit({ venue: "deriv", symbol: String(q.symbol), at: Number(q.epoch ?? Date.now() / 1000) * 1000, price: Number(q.quote) });
      } catch { /* ignore malformed public feed message */ }
    };
    ws.onerror = () => { this.status.deriv.error = "Deriv public tick socket error"; };
    ws.onclose = () => { this.status.deriv.connected = false; this.scheduleReconnect(key, () => this.startDeriv(this.status.deriv.subscribed.length ? this.status.deriv.subscribed : valid)); };
  }

  stop() {
    this.stopped = true;
    for (const ws of this.sockets.values()) { try { ws.close(); } catch { /* no-op */ } }
    this.sockets.clear();
    for (const t of this.retry.values()) clearTimeout(t);
    this.retry.clear();
    this.status.binance.connected = false;
    this.status.deriv.connected = false;
  }

  private connect(key: string, url: string, venue: "binance", symbols: string[]) {
    if (this.sockets.get(key)?.readyState === WebSocket.OPEN || this.sockets.get(key)?.readyState === WebSocket.CONNECTING) return;
    const ws = new WebSocket(url);
    this.sockets.set(key, ws);
    this.status.binance = { ...this.status.binance, connected: false, subscribed: symbols, error: "" };
    ws.onopen = () => { this.status.binance.connected = true; this.status.binance.error = ""; };
    ws.onmessage = ev => {
      this.status.binance.lastMessageAt = Date.now();
      try {
        const outer = JSON.parse(String(ev.data));
        const d = outer.data ?? outer;
        const symbol = String(d.s ?? "");
        if (!symbol) return;
        const prior = this.buffers.get(`binance:${symbol}`)?.at(-1);
        if (d.e === "trade" && Number(d.p) > 0) this.emit({ venue, symbol, at: Number(d.T ?? Date.now()), price: Number(d.p), bid: prior?.bid, ask: prior?.ask });
        else if (d.u != null && Number(d.b) > 0 && Number(d.a) > 0) {
          const price = prior?.price ?? (Number(d.b) + Number(d.a)) / 2;
          this.emit({ venue, symbol, at: Date.now(), price, bid: Number(d.b), ask: Number(d.a) });
        }
      } catch { /* ignore malformed feed message */ }
    };
    ws.onerror = () => { this.status.binance.error = "Binance public tick socket error"; };
    ws.onclose = () => { this.status.binance.connected = false; this.scheduleReconnect(key, () => this.connect(key, url, venue, symbols)); };
  }

  private emit(tick: LiveTick) {
    const key = `${tick.venue}:${tick.symbol}`;
    const rows = this.buffers.get(key) ?? [];
    rows.push(tick);
    if (rows.length > 160) rows.splice(0, rows.length - 160);
    this.buffers.set(key, rows);
    for (const listener of this.listeners) listener(tick);
  }
  private scheduleReconnect(key: string, fn: () => void) {
    if (this.stopped || this.retry.has(key)) return;
    const timer = setTimeout(() => { this.retry.delete(key); if (!this.stopped) fn(); }, 2500);
    this.retry.set(key, timer);
  }
}

export const liveTicks = new LiveTickHub();
