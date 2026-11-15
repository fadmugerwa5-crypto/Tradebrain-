import type { MarketInfo } from "../market/types.ts";

// Deriv's current API (the old ws.derivws.com / app_id=1089 sockets no longer accept connections):
//  - public socket: market lists and candles, no login needed
//  - trading: REST (token + registered App ID) -> one-time password -> authenticated socket
const REST = "https://api.derivws.com";
const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";

type Waiter = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** A small request/response WebSocket. Reconnects by itself the next time something is requested. */
class Sock {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Waiter>();
  private queue: string[] = [];
  private req = 1;
  constructor(private url: string | (() => string)) {}

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (typeof WebSocket === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket(typeof this.url === "function" ? this.url() : this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const raw of this.queue.splice(0)) ws.send(raw);
    };
    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const w = this.pending.get(Number(msg.req_id));
      if (!w) return;
      clearTimeout(w.timer);
      this.pending.delete(Number(msg.req_id));
      if (msg.error) w.reject(new Error((msg.error as { message?: string }).message || "Deriv rejected the request"));
      else w.resolve(msg);
    };
    ws.onclose = () => {
      for (const [id, w] of this.pending) {
        clearTimeout(w.timer);
        w.reject(new Error("The Deriv connection closed. It will reconnect on the next request."));
        this.pending.delete(id);
      }
    };
  }

  request(payload: Record<string, unknown>, ms = 15_000) {
    this.connect();
    const req_id = this.req++;
    const raw = JSON.stringify({ ...payload, req_id });
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req_id);
        reject(new Error("Deriv did not answer in time."));
      }, ms);
      this.pending.set(req_id, { resolve, reject, timer });
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(raw);
      else this.queue.push(raw);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.queue = [];
  }
}

async function restJson(path: string, token: string, appId: string, method: "GET" | "POST" = "GET") {
  let res: Response;
  try {
    res = await fetch(`${REST}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Deriv-App-ID": appId, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("Could not reach Deriv (api.derivws.com). Check the internet connection.");
  }
  let body: any = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  if (!res.ok) {
    const m = body?.error?.message ?? body?.message ?? body?.errors?.[0]?.message ?? "";
    if (res.status === 401) throw new Error(`Deriv did not accept the token${m ? ` (${String(m).slice(0, 120)})` : ""}. Create a new token with the Trade scope.`);
    if (res.status === 403) throw new Error(`Deriv refused the request${m ? ` (${String(m).slice(0, 120)})` : ""}. Check the App ID matches the app the token was made for.`);
    throw new Error(`Deriv answered HTTP ${res.status}${m ? `: ${String(m).slice(0, 120)}` : ""}.`);
  }
  return body;
}

export class DerivClient {
  private pub = new Sock(PUBLIC_WS);
  private auth: Sock | null = null;
  private token = "";
  private appId = "";
  private authing: Promise<boolean> | null = null;
  authorized = false;
  currency = "USD";
  balance: number | null = null;
  loginid = "";
  virtual = true;

  get hasAuth() {
    return !!this.token && !!this.appId;
  }

  /** Token + registered App ID -> account list -> one-time password -> authenticated socket. */
  async authorize(token: string, appId: string) {
    this.token = token;
    this.appId = appId;
    const list = await restJson("/trading/v1/options/accounts", token, appId);
    const rows = (Array.isArray(list) ? list : (list?.data ?? list?.accounts ?? [])) as Record<string, any>[];
    if (!rows.length) throw new Error("This token has no Deriv Options account. Create one in Deriv first.");
    const isDemo = (a: Record<string, any>) => /demo|virtual/i.test(String(a.account_type ?? a.type ?? "")) || a.is_virtual === 1 || a.is_virtual === true || /^VR|^DOT9/i.test(String(a.account_id ?? a.id ?? a.loginid ?? ""));
    const acc = rows.find(isDemo) ?? rows[0]!;
    const id = String(acc.account_id ?? acc.id ?? acc.loginid ?? "");
    if (!id) throw new Error("Deriv returned an account without an id.");
    const otp = await restJson(`/trading/v1/options/accounts/${encodeURIComponent(id)}/otp`, token, appId, "POST");
    const url = String(otp?.data?.url ?? otp?.url ?? "");
    if (!url.startsWith("wss://")) throw new Error("Deriv did not return a trading socket address.");
    this.auth?.close();
    this.auth = new Sock(url);
    this.loginid = id;
    this.virtual = isDemo(acc);
    this.currency = String(acc.currency ?? "USD");
    this.balance = acc.balance != null ? Number(acc.balance) : null;
    try {
      const b = (await this.auth.request({ balance: 1 })).balance as { balance?: number; currency?: string } | undefined;
      if (b?.balance != null) this.balance = Number(b.balance);
      if (b?.currency) this.currency = b.currency;
    } catch {
      /* the account object already carried a balance */
    }
    this.authorized = true;
    return { balance: this.balance ?? 0, currency: this.currency, loginid: this.loginid, virtual: this.virtual };
  }

  /** The one-time password works once, so a dropped trading socket needs a full re-authorization. */
  async ensure(): Promise<boolean> {
    if (!this.hasAuth) return false;
    if (this.authorized && this.auth?.isOpen) return true;
    if (!this.authing) {
      this.authing = this.authorize(this.token, this.appId)
        .then(() => true)
        .catch(() => {
          this.authorized = false;
          return false;
        })
        .finally(() => {
          this.authing = null;
        });
    }
    return this.authing;
  }

  disconnect() {
    this.token = "";
    this.appId = "";
    this.authorized = false;
    this.balance = null;
    this.loginid = "";
    this.auth?.close();
    this.auth = null;
    this.pub.close();
  }

  /** Every market Deriv offers (forex, commodities, indices, synthetic indices, crypto). Public, no login. */
  async markets(): Promise<MarketInfo[]> {
    const msg = await this.pub.request({ active_symbols: "brief" }, 20_000);
    const rows = (msg.active_symbols as Record<string, any>[] | undefined) ?? [];
    return rows
      .map((r) => ({ symbol: String(r.underlying_symbol ?? r.symbol ?? ""), r }))
      .filter((x) => x.symbol && x.r.is_trading_suspended !== 1)
      .map(({ symbol, r }) => ({
        symbol,
        label: String(r.underlying_symbol_name ?? r.display_name ?? symbol),
        group: String(r.market_display_name ?? r.market ?? "Deriv"),
        broker: "deriv" as const,
        open: r.exchange_is_open !== 0,
      }));
  }

  async candles(symbol: string, granularity: number, count = 250) {
    const msg = await this.pub.request({ ticks_history: symbol, adjust_start_time: 1, count: Math.min(5000, Math.max(50, Math.round(count))), end: "latest", start: 1, style: "candles", granularity }, count > 500 ? 30_000 : 15_000);
    const rows = (msg.candles as { epoch: number; open: number; high: number; low: number; close: number }[] | undefined) ?? [];
    return rows.map((c) => ({ t: c.epoch * 1000, o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: 0 }));
  }

  private multOpts = new Map<string, { at: number; opts: number[] | null }>();

  /** Multipliers Deriv offers on this market (MULTUP / MULTDOWN), or null when it offers none. Cached for 6 hours. */
  async multiplierOptions(symbol: string): Promise<number[] | null> {
    const hit = this.multOpts.get(symbol);
    if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.opts;
    const msg = await this.pub.request({ contracts_for: symbol }, 20_000);
    const list = ((msg.contracts_for as { available?: Record<string, unknown>[] } | undefined)?.available ?? []) as Record<string, unknown>[];
    const mult = list.filter((c) => c.contract_type === "MULTUP" || c.contract_type === "MULTDOWN");
    let opts: number[] | null = null;
    if (mult.length) {
      const fromApi = mult.flatMap((c) => (Array.isArray(c.multiplier_range) ? (c.multiplier_range as unknown[]).map(Number) : [])).filter((n) => Number.isFinite(n) && n > 0);
      opts = [...new Set(fromApi.length ? fromApi : DEFAULT_MULTIPLIERS)].sort((a, b) => a - b);
    }
    this.multOpts.set(symbol, { at: Date.now(), opts });
    return opts;
  }

  /**
   * Opens a multiplier contract (MULTUP = long, MULTDOWN = short) with a stop loss and a take profit that Deriv itself holds,
   * so they keep working with the app closed. Profit and loss are in account money: stake x multiplier x price change.
   */
  async multiplier(symbol: string, side: "BUY" | "SELL", stake: number, currency: string, multiplier: number, stopLoss: number, takeProfit: number) {
    if (!this.auth || !this.authorized) throw new Error("Deriv trading is not authorized. Add the App ID on the Connect tab.");
    const proposal = await this.auth.request({
      proposal: 1,
      amount: Math.round(stake * 100) / 100,
      basis: "stake",
      contract_type: side === "BUY" ? "MULTUP" : "MULTDOWN",
      currency,
      multiplier,
      underlying_symbol: symbol,
      limit_order: { stop_loss: Math.round(stopLoss * 100) / 100, take_profit: Math.round(takeProfit * 100) / 100 },
    });
    const p = proposal.proposal as { id?: string; ask_price?: number } | undefined;
    if (!p?.id) throw new Error("Deriv did not return a multiplier proposal.");
    const bought = await this.auth.request({ buy: p.id, price: p.ask_price });
    const buy = bought.buy as { contract_id?: number; buy_price?: number } | undefined;
    if (!buy?.contract_id) throw new Error("Deriv did not confirm the multiplier purchase.");
    if (this.balance != null && buy.buy_price) this.balance -= buy.buy_price;
    return { contractId: String(buy.contract_id), buyPrice: Number(buy.buy_price ?? p.ask_price ?? stake), label: `Multiplier x${multiplier}` };
  }

  /** Symbols Deriv would not give a CALL/PUT for, skipped until the timestamp so one bad market cannot stall the scan. */
  private blocked = new Map<string, number>();
  /** Duration that worked last time for a symbol, so the next order does not repeat the search. */
  private goodDur = new Map<string, number>();

  isBlocked(symbol: string) {
    const until = this.blocked.get(symbol);
    if (until == null) return false;
    if (Date.now() > until) {
      this.blocked.delete(symbol);
      return false;
    }
    return true;
  }

  /** Not every Deriv market sells a 5-minute CALL/PUT (forex, indices and stocks differ). Try the shortest duration that works. */
  async contract(symbol: string, side: "BUY" | "SELL", stake: number, currency: string) {
    if (!this.auth || !this.authorized) throw new Error("Deriv trading is not authorized. Add the App ID on the Connect tab.");
    const start = this.goodDur.get(symbol) ?? 0;
    let proposal: Record<string, unknown> | null = null;
    let used: (typeof DERIV_DURATIONS)[number] = DERIV_DURATIONS[0];
    let lastErr = "";
    for (let i = start; i < DERIV_DURATIONS.length; i++) {
      const d = DERIV_DURATIONS[i]!;
      try {
        proposal = await this.auth.request({
          proposal: 1,
          amount: Math.max(0.5, Math.round(stake * 100) / 100),
          basis: "stake",
          contract_type: side === "BUY" ? "CALL" : "PUT",
          currency,
          duration: d.n,
          duration_unit: d.unit,
          underlying_symbol: symbol,
        });
        used = d;
        this.goodDur.set(symbol, i);
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "Deriv rejected the proposal";
        // Problems that a different duration cannot fix: stop at once.
        if (/balance|insufficient|authori[sz]|token|login|rate limit|too many/i.test(lastErr)) throw new Error(lastErr);
        if (/closed|suspended|not open|unavailable/i.test(lastErr)) {
          this.blocked.set(symbol, Date.now() + 10 * 60_000);
          throw new Error(`${symbol}: ${lastErr}. Skipped for 10 minutes.`);
        }
      }
    }
    if (!proposal) {
      this.blocked.set(symbol, Date.now() + 30 * 60_000);
      throw new Error(`${symbol}: Deriv sells no CALL/PUT here (${lastErr.slice(0, 100)}). Skipped for 30 minutes.`);
    }
    const p = proposal.proposal as { id?: string; ask_price?: number } | undefined;
    if (!p?.id) throw new Error("Deriv did not return a proposal.");
    const bought = await this.auth.request({ buy: p.id, price: p.ask_price });
    const buy = bought.buy as { contract_id?: number; buy_price?: number; payout?: number } | undefined;
    if (!buy?.contract_id) throw new Error("Deriv did not confirm the purchase.");
    if (this.balance != null && buy.buy_price) this.balance -= buy.buy_price;
    return { contractId: String(buy.contract_id), buyPrice: Number(buy.buy_price ?? p.ask_price ?? stake), payout: Number(buy.payout ?? 0), durLabel: used.label };
  }

  async contractStatus(contractId: string) {
    if (!this.auth) return null;
    const msg = await this.auth.request({ proposal_open_contract: 1, contract_id: Number(contractId) });
    return (msg.proposal_open_contract as { is_sold?: number; is_expired?: number; profit?: number; sell_price?: number; status?: string; bid_price?: number; buy_price?: number; is_valid_to_sell?: number; date_start?: number; date_expiry?: number; current_spot_time?: number } | undefined) ?? null;
  }

  /** Every contract that is open on the Deriv account right now, including ones this app has no record of. */
  async openContracts(): Promise<{ id: string; buyPrice: number }[]> {
    if (!this.auth || !this.authorized) throw new Error("Deriv trading is not authorized.");
    const msg = await this.auth.request({ portfolio: 1 });
    const list = ((msg.portfolio as { contracts?: { contract_id?: number; buy_price?: number }[] } | undefined)?.contracts ?? []);
    return list.filter((c) => c.contract_id).map((c) => ({ id: String(c.contract_id), buyPrice: Number(c.buy_price ?? 0) }));
  }

  /** Sells an open contract at Deriv's current price. Throws if Deriv will not sell it right now. */
  async sell(contractId: string) {
    if (!this.auth || !this.authorized) throw new Error("Deriv trading is not authorized.");
    const msg = await this.auth.request({ sell: Number(contractId), price: 0 });
    const s = msg.sell as { sold_for?: number; balance_after?: number } | undefined;
    if (!s || s.sold_for == null) throw new Error("Deriv did not confirm the sale.");
    if (s.balance_after != null) this.balance = Number(s.balance_after);
    return { soldFor: Number(s.sold_for) };
  }
}

/** Used only when contracts_for does not list the multiplier range. A wrong value is refused by Deriv, never silently accepted. */
const DEFAULT_MULTIPLIERS = [5, 10, 20, 30, 50, 100];

const DERIV_DURATIONS = [
  { n: 5, unit: "m", label: "5-minute" },
  { n: 10, unit: "m", label: "10-minute" },
  { n: 15, unit: "m", label: "15-minute" },
  { n: 30, unit: "m", label: "30-minute" },
  { n: 1, unit: "h", label: "1-hour" },
  { n: 2, unit: "h", label: "2-hour" },
  { n: 4, unit: "h", label: "4-hour" },
  { n: 1, unit: "d", label: "1-day" },
] as const;

export const deriv = new DerivClient();

export const DERIV_GRANULARITY: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
