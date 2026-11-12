// Connecting a broker or the AI helper. Each connect call checks the credentials, then loads everything the account can trade.
import { BINANCE_HOSTS, envAccount, isFuturesEnv, type MarketInfo } from "@/lib/market/types";
import { AI_SLOTS, CONN0, useBrain, type AiSlot, type AiState } from "@/stores/brain";
import { AI_LABEL, type AiProvider } from "./ai";
import { askAI, binanceBalances, binanceDiagnose, binanceDiscover, binanceProbe, detectAI } from "./api";
import { deriv } from "./deriv";

const found: { binance: MarketInfo[]; deriv: MarketInfo[] } = { binance: [], deriv: [] };

function publish() {
  useBrain.getState().setMarkets([...found.binance, ...found.deriv]);
}

/** Re-reads Deriv's market list (open/closed flags change through the day and week, new markets appear). */
export async function refreshDerivMarkets() {
  if (useBrain.getState().conn.deriv.status !== "connected") return;
  try {
    const list = await deriv.markets();
    if (list.length) {
      found.deriv = list;
      publish();
    }
  } catch {
    /* keep the old list; the next refresh tries again */
  }
}

function clearFeed(broker: "binance" | "deriv") {
  const names = new Set(found[broker].map((m) => m.symbol));
  found[broker] = [];
  publish();
  useBrain.setState((s) => {
    const drop = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => !names.has(k))) as Record<string, T>;
    return { candles: drop(s.candles), quotes: drop(s.quotes), decisions: drop(s.decisions), filters: broker === "binance" ? {} : s.filters };
  });
}

export async function connectBinance(opts: { silent?: boolean } = {}): Promise<boolean> {
  const st = useBrain.getState();
  const { binanceKey: apiKey, binanceSecret: secret } = st.secrets;
  const fail = (error: string) => {
    useBrain.getState().patchConn("binance", { status: "error", error });
    useBrain.getState().log(`Binance: ${error}`, "warn");
    return false;
  };
  if (!apiKey || !secret) return fail("Enter the API key and the API secret first.");
  let env = st.settings.binanceEnv;
  st.patchConn("binance", { status: "connecting", label: BINANCE_HOSTS[env].label, demo: !BINANCE_HOSTS[env].live, error: "" });
  try {
    let res = await binanceDiagnose({ data: { env, apiKey, secret } });
    useBrain.setState({ diag: res });
    if (!res.ready && res.steps.some((s) => !s.ok && (s.code === -2015 || s.code === -2014 || s.code === -1022))) {
      // The key is real but belongs to another Binance environment (a Spot key on Futures, a Demo key on Live, and so on). Find which one accepts it.
      const accepted = await binanceProbe({ data: { apiKey, secret } });
      const pick = accepted.find((e) => envAccount(e) === envAccount(env)) ?? accepted[0];
      if (pick && pick !== env) {
        env = pick;
        useBrain.getState().patchSettings({ binanceEnv: env, liveUnlock: false });
        useBrain.getState().log(`These keys belong to ${BINANCE_HOSTS[env].label}. Switched the connection to match.`);
        useBrain.getState().patchConn("binance", { label: BINANCE_HOSTS[env].label, demo: !BINANCE_HOSTS[env].live });
        res = await binanceDiagnose({ data: { env, apiKey, secret } });
        useBrain.setState({ diag: res });
      }
    }
    if (!res.ready) {
      const bad = res.steps.find((s) => !s.ok && s.name !== "Clock");
      return fail(`${bad?.name ?? "Check"}: ${bad?.detail ?? "the account could not be read."}`);
    }
    const disc = await binanceDiscover({ data: { env } });
    found.binance = disc.markets;
    useBrain.setState({ filters: disc.filters });
    publish();
    let balance = 0;
    const b = await binanceBalances({ data: { env, apiKey, secret } });
    if (b.ok) {
      const usdt = b.balances.filter((x) => x.asset === "USDT" || x.asset === "USDC");
      balance = usdt.reduce((sum, x) => sum + x.free + x.locked, 0);
    }
    const live = BINANCE_HOSTS[env].live;
    useBrain.getState().patchConn("binance", {
      status: "connected",
      label: BINANCE_HOSTS[env].label,
      demo: !live,
      account: isFuturesEnv(env) ? "USDⓈ-M Futures" : "Spot",
      balance,
      currency: "USDT",
      at: Date.now(),
      markets: disc.markets.length,
      error: "",
    });
    useBrain.getState().log(`Binance connected: ${BINANCE_HOSTS[env].label}, ${disc.markets.length} markets loaded.`);
    if (!opts.silent && !live && useBrain.getState().settings.venue === "paper") useBrain.getState().patchSettings({ venue: "binance" });
    return true;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Unexpected error while connecting.");
  }
}

export function disconnectBinance() {
  useBrain.getState().patchSecrets({ binanceKey: "", binanceSecret: "" });
  useBrain.getState().patchConn("binance", { ...CONN0 });
  useBrain.setState({ diag: null, broker: null });
  clearFeed("binance");
  if (useBrain.getState().settings.venue === "binance") useBrain.getState().patchSettings({ venue: "paper" });
  useBrain.getState().setArmed(false);
}

export async function connectDeriv(opts: { silent?: boolean } = {}): Promise<boolean> {
  const { derivToken: token, derivAppId } = useBrain.getState().secrets;
  const appId = derivAppId.trim();
  const fail = (error: string) => {
    useBrain.getState().patchConn("deriv", { status: "error", error });
    useBrain.setState((s) => ({ derivStatus: { ...s.derivStatus, status: "error", error } }));
    useBrain.getState().log(`Deriv: ${error}`, "warn");
    return false;
  };
  if (!token) return fail("Enter the Deriv API token first.");
  useBrain.getState().patchConn("deriv", { status: "connecting", label: "Deriv", error: "" });
  try {
    // Markets and charts come from Deriv's public feed. Trading needs the token plus a registered App ID.
    const list = await deriv.markets();
    if (!list.length) throw new Error("Deriv returned no markets.");
    found.deriv = list;
    publish();
    const auth = appId ? await deriv.authorize(token, appId) : null;
    useBrain.setState({ derivStatus: { status: "open", balance: auth?.balance ?? null, currency: auth?.currency ?? "USD", loginid: auth?.loginid ?? "", virtual: auth?.virtual ?? null, error: "" } });
    useBrain.getState().patchConn("deriv", {
      status: "connected",
      label: !auth ? "Deriv (charts only)" : auth.virtual ? "Deriv demo" : "Deriv real",
      demo: auth?.virtual ?? true,
      account: auth?.loginid ?? "No App ID",
      balance: auth?.balance ?? null,
      currency: auth?.currency ?? "USD",
      at: Date.now(),
      markets: list.length,
      error: "",
    });
    useBrain.getState().log(auth ? `Deriv connected: ${auth.loginid} (${auth.virtual ? "demo" : "REAL"}), ${list.length} markets loaded.` : `Deriv charts loaded (${list.length} markets). Orders need an App ID.`);
    if (!opts.silent && auth?.virtual && useBrain.getState().settings.venue === "paper") useBrain.getState().patchSettings({ venue: "deriv" });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error while connecting.";
    clearFeed("deriv");
    return fail(msg);
  }
}

export function disconnectDeriv() {
  deriv.disconnect();
  useBrain.getState().patchSecrets({ derivToken: "", derivAppId: "" });
  useBrain.getState().patchConn("deriv", { ...CONN0 });
  useBrain.setState({ derivStatus: { status: "off", balance: null, currency: "USD", loginid: "", virtual: null, error: "" } });
  clearFeed("deriv");
  if (useBrain.getState().settings.venue === "deriv") useBrain.getState().patchSettings({ venue: "paper" });
}

const KEY_OF = { gemini: "geminiKey", grok: "grokKey", other: "otherKey" } as const;
const ONLY: Record<AiSlot, AiProvider[] | undefined> = { gemini: undefined, grok: undefined, other: undefined };
const aiRun: Record<AiSlot, number> = { gemini: 0, grok: 0, other: 0 };

function setAi(slot: AiSlot, v: AiState) {
  useBrain.setState((s) => ({ ai: { ...s.ai, [slot]: v } }));
}

/** Checks one AI key and finds the model to use. The Gemini and Grok slots are fixed; every slot detects the provider from the key itself. */
export async function connectAI(slot: AiSlot): Promise<boolean> {
  const key = useBrain.getState().secrets[KEY_OF[slot]];
  const run = ++aiRun[slot];
  if (!key) {
    setAi(slot, { status: "idle", provider: null, model: "", note: "" });
    return false;
  }
  setAi(slot, { status: "checking", provider: null, model: "", note: "Checking the key…" });
  const found = await detectAI(key, ONLY[slot]);
  if (run !== aiRun[slot]) return false;
  if (!found.ok) {
    setAi(slot, { status: "error", provider: null, model: "", note: found.error });
    return false;
  }
  const test = await askAI({ brief: "", key, provider: found.provider, model: found.model, test: true });
  if (run !== aiRun[slot]) return false;
  if (!test.ok) {
    setAi(slot, { status: "error", provider: found.provider, model: found.model, note: test.error });
    return false;
  }
  setAi(slot, { status: "ready", provider: found.provider, model: found.model, note: `${AI_LABEL[found.provider]} · ${found.model}` });
  return true;
}

export function disconnectAI(slot: AiSlot) {
  aiRun[slot]++;
  useBrain.getState().patchSecrets({ [KEY_OF[slot]]: "" });
  setAi(slot, { status: "idle", provider: null, model: "", note: "" });
  useBrain.setState({ aiText: "" });
}

/** On app start: reconnect everything that has saved credentials. */
export function autoReconnect() {
  const s = useBrain.getState();
  if (s.secrets.binanceKey && s.secrets.binanceSecret) void connectBinance({ silent: true });
  if (s.secrets.derivToken) void connectDeriv({ silent: true });
  for (const slot of AI_SLOTS) if (s.secrets[KEY_OF[slot]] && s.ai[slot].status !== "ready") void connectAI(slot);
}
