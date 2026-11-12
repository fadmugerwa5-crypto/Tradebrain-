import { useEffect, useRef, useState, type ReactNode } from "react";
import { binanceTestOrder } from "@/lib/brokers/api";
import { cleanCredential, maskCredential } from "@/lib/brokers/creds";
import { connectAI, connectBinance, connectDeriv, disconnectAI, disconnectBinance, disconnectDeriv } from "@/lib/brokers/connect";
import { BINANCE_HOSTS, binanceEnvOf, envAccount, isFuturesEnv, type BinanceAccountType, type BinanceKind } from "@/lib/market/types";
import { money } from "@/lib/format";
import { useBrain, type AiSlot, type BrokerConn } from "@/stores/brain";
import { Num } from "./ui";

const ACCOUNT_HELP: Record<BinanceAccountType, string> = {
  demo: "Create the key inside Binance Demo Trading (demo.binance.com, Profile, API management). It is a separate key from your live key. If the key belongs to the other market type, the app switches to it for you.",
  live: "Real money. Use a key with trading permission only and never enable withdrawals. Orders stay locked until you type LIVE below.",
  testnet: "Testnet keys come from the Binance testnet site and only work on the testnet hosts. For paper trading, Demo is the better choice.",
};

const btn = "h-11 rounded-sm border border-line px-3 text-sm disabled:opacity-40";
const primary = "h-12 w-full rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

function Badge({ tone, children }: { tone: "up" | "down" | "warn" | "idle"; children: ReactNode }) {
  const cls = tone === "up" ? "border-up/50 text-up" : tone === "down" ? "border-down/50 text-down" : tone === "warn" ? "border-warn/50 text-warn" : "border-line text-faint";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${cls}`}>{children}</span>;
}

function connBadge(c: BrokerConn) {
  if (c.status === "connected") return <Badge tone={c.demo ? "up" : "warn"}>Connected · {c.demo ? "demo" : "real money"}</Badge>;
  if (c.status === "connecting") return <Badge tone="idle">Connecting…</Badge>;
  if (c.status === "error") return <Badge tone="down">Not connected</Badge>;
  return <Badge tone="idle">Not connected</Badge>;
}

function Card({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-elev p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; text: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="grid gap-1 rounded-sm border border-line bg-bg p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`h-10 rounded-sm text-sm ${value === o.id ? "bg-elev-2 font-medium text-fg" : "text-muted"}`} onClick={() => onChange(o.id)}>
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function SecretInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  const [note, setNote] = useState("");
  const accept = (raw: string) => {
    const c = cleanCredential(raw);
    setNote(c.removed > 0 ? `Removed ${c.removed} stray character(s): spaces, line breaks or quotes.` : "");
    onChange(c.value);
  };
  return (
    <div className="flex flex-col gap-1">
      <Field label={label}>
        <div className="flex gap-2">
          <input
            type={show ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            placeholder={placeholder}
            onChange={(e) => accept(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-sm border border-line bg-bg px-3 text-sm text-fg"
          />
          <button type="button" className="h-11 rounded-sm border border-line px-3 text-xs text-muted" onClick={() => setShow(!show)}>
            {show ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            className="h-11 rounded-sm border border-line px-3 text-xs text-muted"
            onClick={() => {
              void navigator.clipboard
                ?.readText()
                .then(accept)
                .catch(() => setNote("This device blocked clipboard access. Long-press the box and paste instead."));
            }}
          >
            Paste
          </button>
        </div>
      </Field>
      <p className="text-xs text-faint">
        {value ? `Saved on this device: ${maskCredential(value)}.` : "Nothing entered yet."} {note}
      </p>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-sm border border-line bg-bg p-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ErrorBox({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-sm border border-down/40 bg-down/10 p-3 text-sm leading-relaxed text-fg">
      {text}
    </p>
  );
}

function BinanceCard() {
  const settings = useBrain((s) => s.settings);
  const secrets = useBrain((s) => s.secrets);
  const conn = useBrain((s) => s.conn.binance);
  const diag = useBrain((s) => s.diag);
  const markets = useBrain((s) => s.markets);
  const patch = useBrain((s) => s.patchSettings);
  const patchSecrets = useBrain((s) => s.patchSecrets);
  const [orderNote, setOrderNote] = useState("");
  const [busy, setBusy] = useState(false);
  const env = settings.binanceEnv;
  const account = envAccount(env);
  const kind: BinanceKind = isFuturesEnv(env) ? "futures" : "spot";
  const connected = conn.status === "connected";
  const connecting = conn.status === "connecting";
  const pick = (a: BinanceAccountType, k: BinanceKind) => patch({ binanceEnv: binanceEnvOf(a, k), liveUnlock: false });
  const sample = markets.find((m) => m.broker === "binance")?.symbol ?? "BTCUSDT";

  return (
    <Card title="Binance" sub={connected ? `${conn.label} · ${conn.account}` : "Spot and USDⓈ-M Futures, demo or live"} right={connBadge(conn)}>
      <Segmented
        label="Account"
        value={account}
        options={[
          { id: "demo", text: "Demo" },
          { id: "live", text: "Live" },
          { id: "testnet", text: "Testnet" },
        ]}
        onChange={(a) => pick(a, kind)}
      />
      <Segmented
        label="Market"
        value={kind}
        options={[
          { id: "spot", text: "Spot" },
          { id: "futures", text: "Futures" },
        ]}
        onChange={(k) => pick(account, k)}
      />
      <p className="text-xs leading-relaxed text-muted">
        Connects to <span className="font-mono text-fg">{BINANCE_HOSTS[env].rest.replace("https://", "")}</span>. {ACCOUNT_HELP[account]}
      </p>
      <SecretInput label="API key" value={secrets.binanceKey} onChange={(binanceKey) => patchSecrets({ binanceKey })} />
      <SecretInput label="API secret" value={secrets.binanceSecret} onChange={(binanceSecret) => patchSecrets({ binanceSecret })} />
      <button type="button" className={primary} disabled={connecting || !secrets.binanceKey || !secrets.binanceSecret} onClick={() => void connectBinance()}>
        {connecting ? "Connecting and loading markets…" : connected ? "Reconnect and refresh markets" : "Connect Binance"}
      </button>
      {conn.status === "error" && <ErrorBox text={conn.error} />}
      {connected && (
        <>
          <Facts
            rows={[
              ["Balance", conn.balance != null ? `${money(conn.balance).replace("$", "")} ${conn.currency}` : "—"],
              ["Markets loaded", String(conn.markets)],
              ["Connected", new Date(conn.at).toLocaleTimeString()],
              ["Environment", conn.demo ? "Demo (no real money)" : "Live (real money)"],
            ]}
          />
          <details className="rounded-sm border border-line">
            <summary className="cursor-pointer px-3 py-3 text-sm text-muted">Connection details</summary>
            <div className="flex flex-col gap-3 border-t border-line p-3">
              {diag && (
                <ul className="flex flex-col gap-2 text-sm">
                  {diag.steps.map((step) => (
                    <li key={step.name}>
                      <span className={step.ok ? "text-up" : "text-down"}>{step.ok ? "Pass" : "Fail"}</span> {step.name}
                      {step.http ? ` · HTTP ${step.http}` : ""}
                      {step.code ? ` · code ${step.code}` : ""}
                      <span className="mt-1 block text-xs text-faint">{step.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              {kind === "spot" ? (
                <>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await binanceTestOrder({ data: { env, apiKey: secrets.binanceKey, secret: secrets.binanceSecret, symbol: sample } });
                        setOrderNote(res.ok ? res.note : `${res.error}${"code" in res && res.code ? ` (code ${res.code})` : ""}`);
                      } catch (err) {
                        setOrderNote(err instanceof Error ? err.message : "Order check failed.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Checking…" : `Validate a ${sample} order (nothing is traded)`}
                  </button>
                  {orderNote && <p className="text-xs text-muted">{orderNote}</p>}
                </>
              ) : (
                <p className="text-xs text-faint">Binance Futures has no order test endpoint. Orders are checked when the first trade is placed.</p>
              )}
            </div>
          </details>
          <button type="button" className={`${btn} text-down`} onClick={() => disconnectBinance()}>
            Disconnect and forget these keys
          </button>
        </>
      )}
    </Card>
  );
}

function DerivCard() {
  const secrets = useBrain((s) => s.secrets);
  const conn = useBrain((s) => s.conn.deriv);
  const patchSecrets = useBrain((s) => s.patchSecrets);
  const connected = conn.status === "connected";
  const connecting = conn.status === "connecting";
  return (
    <Card title="Deriv" sub={connected ? `${conn.account} · ${conn.label}` : "Forex, commodities, indices, synthetic indices, crypto"} right={connBadge(conn)}>
      <SecretInput label="API token (Personal Access Token)" value={secrets.derivToken} onChange={(derivToken) => patchSecrets({ derivToken })} />
      <Field label="App ID (needed only to place orders)">
        <input inputMode="numeric" autoComplete="off" value={secrets.derivAppId} onChange={(e) => patchSecrets({ derivAppId: e.target.value.replace(/[^A-Za-z0-9]/g, "") })} placeholder="Leave empty for charts only" className="h-11 rounded-sm border border-line bg-bg px-3 text-sm text-fg" />
      </Field>
      <p className="text-xs leading-relaxed text-muted">Deriv replaced its old connection. Markets and charts load from the token alone. To place orders, Deriv now requires an App ID: register a free app at developers.deriv.com and paste its number here, with a token that has the Trade scope.</p>
      <button type="button" className={primary} disabled={connecting || !secrets.derivToken} onClick={() => void connectDeriv()}>
        {connecting ? "Connecting and loading markets…" : connected ? "Reconnect and refresh markets" : "Connect Deriv"}
      </button>
      {conn.status === "error" && <ErrorBox text={conn.error} />}
      {connected && (
        <>
          <Facts
            rows={[
              ["Balance", conn.balance != null ? `${conn.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${conn.currency}` : "—"],
              ["Markets loaded", String(conn.markets)],
              ["Account", conn.account],
              ["Type", conn.demo ? "Demo (no real money)" : "Real money"],
            ]}
          />
          <button type="button" className={`${btn} text-down`} onClick={() => disconnectDeriv()}>
            Disconnect and forget this token
          </button>
        </>
      )}
    </Card>
  );
}

const SLOT_INFO: Record<AiSlot, { title: string; label: string; hint: string; key: "geminiKey" | "grokKey" | "otherKey" }> = {
  gemini: { title: "AI key 1", label: "API key", hint: "Paste any AI key (Gemini, Groq, OpenRouter, DeepSeek, OpenAI, Claude, Grok, Mistral, Cerebras, Together and more). It is detected automatically.", key: "geminiKey" },
  grok: { title: "AI key 2", label: "API key", hint: "Optional. Any provider, detected automatically.", key: "grokKey" },
  other: { title: "AI key 3", label: "API key", hint: "Optional. Any provider, detected automatically.", key: "otherKey" },
};

function AiKeyBox({ slot }: { slot: AiSlot }) {
  const info = SLOT_INFO[slot];
  const key = useBrain((s) => s.secrets[info.key]);
  const ai = useBrain((s) => s.ai[slot]);
  const patchSecrets = useBrain((s) => s.patchSecrets);
  const timer = useRef<number>(0);
  // The key is checked by itself a moment after it stops changing.
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!key || key.length < 20) return;
    if (useBrain.getState().ai[slot].status !== "idle") return;
    timer.current = window.setTimeout(() => void connectAI(slot), 700);
    return () => window.clearTimeout(timer.current);
  }, [key, slot]);
  return (
    <Card
      title={info.title}
      sub={ai.status === "ready" ? ai.note : info.hint}
      right={ai.status === "ready" ? <Badge tone="up">Ready</Badge> : ai.status === "checking" ? <Badge tone="idle">Checking…</Badge> : ai.status === "error" ? <Badge tone="down">Not accepted</Badge> : <Badge tone="idle">Off</Badge>}
    >
      <SecretInput
        label={info.label}
        value={key}
        onChange={(v) => {
          useBrain.setState((s) => ({ ai: { ...s.ai, [slot]: { status: "idle", provider: null, model: "", note: "" } } }));
          patchSecrets({ [info.key]: v });
        }}
      />
      {ai.status === "error" && <ErrorBox text={ai.note} />}
      {key && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btn} disabled={ai.status === "checking"} onClick={() => void connectAI(slot)}>
            Check again
          </button>
          <button type="button" className={`${btn} text-down`} onClick={() => disconnectAI(slot)}>
            Remove key
          </button>
        </div>
      )}
    </Card>
  );
}

function AiCard() {
  return (
    <>
      <div>
        <h2 className="text-lg font-medium">AI analysts</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">Optional second opinions on a chart setup. The AI only sees a short text summary when you press Ask, never your exchange keys or balances.</p>
      </div>
      <AiKeyBox slot="gemini" />
      <AiKeyBox slot="grok" />
      <AiKeyBox slot="other" />
    </>
  );
}

function OrdersCard() {
  const settings = useBrain((s) => s.settings);
  const conn = useBrain((s) => s.conn);
  const patch = useBrain((s) => s.patchSettings);
  const [phrase, setPhrase] = useState("");
  const env = settings.binanceEnv;
  const binOn = conn.binance.status === "connected";
  const derOn = conn.deriv.status === "connected";
  const needsUnlock = (settings.venue === "binance" && BINANCE_HOSTS[env].live) || (settings.venue === "deriv" && derOn && !conn.deriv.demo);
  const venues: { id: "paper" | "binance" | "deriv"; text: string; on: boolean }[] = [
    { id: "paper", text: "Simulated", on: binOn || derOn },
    { id: "binance", text: binOn ? conn.binance.label : "Binance", on: binOn },
    { id: "deriv", text: derOn ? conn.deriv.label : "Deriv", on: derOn },
  ];
  return (
    <Card title="Order execution" sub="Where trades are sent when entries are armed">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {venues.map((v) => (
          <button key={v.id} type="button" disabled={!v.on} className={`h-11 rounded-sm border px-2 text-sm disabled:opacity-40 ${settings.venue === v.id ? "border-accent bg-elev-2" : "border-line text-muted"}`} onClick={() => patch({ venue: v.id, liveUnlock: false })}>
            {v.text}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {!binOn && !derOn
          ? "Connect a broker first. Without one there are no markets to trade."
          : settings.venue === "paper"
            ? "Simulated: fills are calculated on the connected broker's real prices. No order reaches the broker."
            : settings.venue === "binance"
              ? `Orders are sent to ${BINANCE_HOSTS[env].rest.replace("https://", "")} with an exchange-side stop and target${isFuturesEnv(env) ? ", and can go long or short" : " (spot is long only)"}.`
              : "Deriv contracts are bought on the connected account."}{" "}
        Auto-trading starts only when you press Arm entries at the top of the screen.
      </p>
      {isFuturesEnv(env) && (
        <div className="grid grid-cols-2 gap-3">
          <Num label="Leverage (applied per symbol, 1 to 125)" value={settings.leverage} onChange={(n) => patch({ leverage: Math.min(125, Math.max(1, Math.round(n) || 1)) })} />
          <Field label="Margin type">
            <select className="h-11 rounded-sm border border-line bg-bg px-2 text-sm text-fg" value={settings.isolated ? "iso" : "cross"} onChange={(e) => patch({ isolated: e.target.value === "iso" })}>
              <option value="iso">Isolated</option>
              <option value="cross">Cross</option>
            </select>
          </Field>
        </div>
      )}
      {needsUnlock && (
        <div className="rounded-sm border border-down/40 p-3">
          <p className="text-sm">Real-money orders are locked. Type LIVE to allow them for this session.</p>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="h-11 rounded-sm border border-line bg-bg px-3 text-sm" placeholder="Type LIVE" />
            <button type="button" disabled={phrase !== "LIVE"} className={btn} onClick={() => patch({ liveUnlock: true })}>
              {settings.liveUnlock ? "Unlocked" : "Unlock"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Connect() {
  const conn = useBrain((s) => s.conn);
  const markets = useBrain((s) => s.markets);
  const n = (conn.binance.status === "connected" ? 1 : 0) + (conn.deriv.status === "connected" ? 1 : 0);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Connections</h2>
        <p className="mt-1 text-sm text-muted">
          {n === 0 ? "Connect a broker to load its markets and charts. Nothing is shown until one is connected." : `${n} broker${n > 1 ? "s" : ""} connected · ${markets.length} markets loaded. Markets and charts come only from the connected brokers.`}
        </p>
      </div>
      <BinanceCard />
      <DerivCard />
      <AiCard />
      <OrdersCard />
      <p className="text-xs leading-relaxed text-faint">Keys are saved on this device only and are sent only to the broker or AI provider they belong to. Use trade-only keys and never enable withdrawals.</p>
    </section>
  );
}
