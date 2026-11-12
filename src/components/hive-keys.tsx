import { useEffect, useMemo, useRef, useState } from "react";
import { cleanKey } from "@/lib/brokers/ai";
import { AGENTS } from "@/lib/hive/agents";
import { askProfile, detectProfile, type AgentKey } from "@/lib/hive/llm";
import { HIVE_DEFAULTS, type HiveConfig, type Style, type StyleCfg } from "@/lib/hive/types";
import type { Interval } from "@/lib/market/types";
import { KEY_SLOTS, profileOfSlot, slotFor, useHive, type KeySlot } from "@/stores/hive";
import { Num } from "./ui";

const sigOf = (k: AgentKey) => `${k.key}|${k.base}|${k.model}`;

/** Finds out which AI company a pasted key belongs to and which model to use. Nothing to pick by hand. */
async function check(slot: KeySlot) {
  const k = useHive.getState().keys[slot];
  const set = useHive.getState().setKeyState;
  if (!cleanKey(k.key)) {
    set(slot, { status: "idle", provider: "", label: "", model: "", note: "" });
    return;
  }
  set(slot, { status: "checking", note: "Finding out which AI this key belongs to…" });
  const sig = sigOf(k);
  const r = await detectProfile(k);
  // The box may have been edited while the check ran.
  if (sigOf(useHive.getState().keys[slot]) !== sig) return;
  if (r.ok) set(slot, { status: "ready", provider: r.profile.provider, label: r.profile.label, model: r.profile.model, note: "" });
  else set(slot, { status: "error", provider: "", label: "", model: "", note: r.error });
}

function KeyRow({ slot, title, sub, color }: { slot: KeySlot; title: string; sub: string; color: string }) {
  const k = useHive((s) => s.keys[slot]);
  const ks = useHive((s) => s.keyState[slot]);
  const setKey = useHive((s) => s.setKey);
  const [show, setShow] = useState(false);
  const [adv, setAdv] = useState(!!k.base);
  const [test, setTest] = useState("");
  const [testing, setTesting] = useState(false);
  const sig = sigOf(k);
  const last = useRef(ks.status === "ready" ? sig : "");
  useEffect(() => {
    if (last.current === sig) return;
    const t = window.setTimeout(
      () => {
        last.current = sig;
        void check(slot);
      },
      cleanKey(k.key) ? 800 : 0,
    );
    return () => window.clearTimeout(t);
  }, [sig]);

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setKey(slot, { key: t });
    } catch {
      setTest("Paste was blocked by the phone. Long-press the box and choose Paste.");
    }
  };
  const runTest = async () => {
    setTesting(true);
    setTest("");
    last.current = sig;
    await check(slot);
    const p = profileOfSlot(useHive.getState(), slot);
    if (!p) {
      setTest(useHive.getState().keyState[slot].note || "This key was not accepted.");
    } else {
      const r = await askProfile(p, "Reply with one JSON object and nothing else.", 'Reply with {"ok":true}', 20_000);
      setTest(r.ok ? `Works: ${p.label} answered.` : r.error);
    }
    setTesting(false);
  };
  const badge =
    ks.status === "ready" ? { text: `${ks.label} · ${ks.model}`, cls: "border-up/50 text-up" } : ks.status === "checking" ? { text: "Checking…", cls: "border-line text-warn hive-blink" } : ks.status === "error" ? { text: ks.note || "Not accepted", cls: "border-down/50 text-down" } : { text: cleanKey(k.key) ? "Not checked" : "No key", cls: "border-line text-faint" };

  return (
    <div className="rounded-2xl border border-line bg-bg/50 p-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color }}>
          {title}
        </span>
        <span className="truncate text-[10px] text-faint">{sub}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type={show ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={k.key}
          placeholder="Paste any AI API key"
          onChange={(e) => setKey(slot, { key: e.target.value })}
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-elev-2 px-3 font-mono text-xs text-fg outline-none focus:border-accent"
        />
        <button type="button" className="h-11 rounded-md border border-line px-3 text-xs text-muted" onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
        <button type="button" className="h-11 rounded-md border border-line px-3 text-xs text-muted" onClick={() => void paste()}>
          Paste
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] ${badge.cls}`}>
          <span className="truncate">{badge.text}</span>
        </span>
        <button type="button" disabled={testing || !cleanKey(k.key)} className="h-8 rounded-md border border-line px-3 text-xs text-muted disabled:opacity-40" onClick={() => void runTest()}>
          {testing ? "Testing…" : "Test"}
        </button>
        {k.key && (
          <button type="button" className="h-8 rounded-md border border-line px-3 text-xs text-faint" onClick={() => setKey(slot, { key: "", base: "", model: "" })}>
            Clear
          </button>
        )}
        <button type="button" className="ml-auto text-[11px] text-faint underline underline-offset-2" onClick={() => setAdv(!adv)}>
          {adv ? "Hide advanced" : "Unknown provider?"}
        </button>
      </div>
      {test && <p className="mt-2 text-xs leading-relaxed text-muted">{test}</p>}
      {adv && (
        <div className="mt-2 grid gap-2">
          <p className="text-[11px] leading-relaxed text-faint">Keys from the well-known AI companies are recognised on their own. For any other provider, paste its OpenAI-compatible address (it ends in /v1) and, if it does not list its models, the model name.</p>
          <input value={k.base} onChange={(e) => setKey(slot, { base: e.target.value })} placeholder="https://api.example.com/v1" autoCapitalize="off" spellCheck={false} className="h-11 rounded-md border border-line bg-elev-2 px-3 font-mono text-xs text-fg outline-none focus:border-accent" />
          <input value={k.model} onChange={(e) => setKey(slot, { model: e.target.value })} placeholder="Model name (optional)" autoCapitalize="off" spellCheck={false} className="h-11 rounded-md border border-line bg-elev-2 px-3 font-mono text-xs text-fg outline-none focus:border-accent" />
        </div>
      )}
    </div>
  );
}

export function AgentKeys() {
  const keys = useHive((s) => s.keys);
  const keyState = useHive((s) => s.keyState);
  const awake = useMemo(() => AGENTS.filter((a) => a.kind !== "builtin" && slotFor({ keys, keyState }, a.id)).length, [keys, keyState]);
  return (
    <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-elev p-4">
      <div>
        <h3 className="text-base font-medium">Agent keys</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {awake} of 10 AI agents awake. Paste a key and the app finds out whose it is and picks the model by itself. Any provider works. Keys stay on this device. The Watchdog is built in and needs no key.
        </p>
      </div>
      <KeyRow slot="shared" title="One key for every agent (optional)" sub="Used by any agent that has no key of its own" color="#a3abb5" />
      {KEY_SLOTS.filter((s) => s !== "shared").map((slot) => {
        const a = AGENTS.find((x) => x.id === slot)!;
        return <KeyRow key={slot} slot={slot} title={a.name} sub={a.role} color={a.color} />;
      })}
    </section>
  );
}

type NumKey = Exclude<keyof StyleCfg, "interval">;
const STYLE_FIELDS: { key: NumKey; label: string; min: number; max: number; help: string }[] = [
  { key: "roundSec", label: "Seconds between rounds", min: 10, max: 3600, help: "Each round costs AI calls. Faster costs more." },
  { key: "manageSec", label: "Executor checks open trades every (s)", min: 5, max: 3600, help: "" },
  { key: "riskPct", label: "Risk per trade (% of equity)", min: 0.01, max: 5, help: "The Risk Guard can shrink this, never raise it." },
  { key: "maxOpen", label: "Most open trades on the desk", min: 1, max: 20, help: "" },
  { key: "minAgree", label: "Analysts that must agree", min: 1, max: 5, help: "With fewer keys this shrinks to the analysts that have one." },
  { key: "minConfidence", label: "Minimum confidence (0 to 100)", min: 0, max: 100, help: "Average confidence of the agreeing analysts." },
  { key: "cooldownSec", label: "Wait after a loss (s)", min: 0, max: 86400, help: "" },
  { key: "defaultRR", label: "Reward to risk when no target is given", min: 0.5, max: 6, help: "" },
];
const GLOBAL_FIELDS: { key: "shortlist" | "dailyLossPct" | "callsPerMin"; label: string; min: number; max: number; help: string }[] = [
  { key: "shortlist", label: "Markets the Scout sees", min: 1, max: 10, help: "" },
  { key: "dailyLossPct", label: "Daily loss lock per desk (%)", min: 0.1, max: 50, help: "The Watchdog pauses that desk after this loss." },
  { key: "callsPerMin", label: "AI calls per minute, all agents", min: 1, max: 600, help: "A hard cost cap." },
];
const INTERVAL_CHOICES: Record<Style, Interval[]> = { scalp: ["1m", "5m"], trader: ["15m", "1h", "4h"] };

function StyleBox({ style, title }: { style: Style; title: string }) {
  const cfg = useHive((s) => s.config[style]);
  const patch = useHive((s) => s.patchConfig);
  const set = (p: Partial<StyleCfg>) => patch({ [style]: { ...cfg, ...p } } as Partial<HiveConfig>);
  return (
    <div className="rounded-2xl border border-line bg-bg/40 p-3">
      <p className="text-sm font-medium">{title}</p>
      <label className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
        Candle timeframe
        <select value={cfg.interval} onChange={(e) => set({ interval: e.target.value as Interval })} className="h-10 rounded-xl border border-line bg-elev-2 px-2 text-sm text-fg">
          {INTERVAL_CHOICES[style].map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {STYLE_FIELDS.map((f) => (
          <div key={f.key}>
            <Num label={f.label} value={cfg[f.key]} onChange={(n) => set({ [f.key]: Math.min(f.max, Math.max(f.min, n)) } as Partial<StyleCfg>)} />
            {f.help && <p className="mt-1 text-[10px] leading-snug text-faint">{f.help}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HiveSettings() {
  const config = useHive((s) => s.config);
  const patch = useHive((s) => s.patchConfig);
  return (
    <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-elev p-4">
      <div>
        <h3 className="text-base font-medium">Colony settings</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">These are limits, not strategy. The agents decide what to trade and when. The numbers only cap how much they can risk and spend.</p>
      </div>
      <StyleBox style="scalp" title="Scalp (Deriv, or Binance if you switch it)" />
      <StyleBox style="trader" title="Trader (Binance, normal trading)" />
      <div className="grid grid-cols-2 gap-3">
        {GLOBAL_FIELDS.map((f) => (
          <div key={f.key}>
            <Num label={f.label} value={config[f.key]} onChange={(n) => patch({ [f.key]: Math.min(f.max, Math.max(f.min, n)) } as Partial<HiveConfig>)} />
            {f.help && <p className="mt-1 text-[10px] leading-snug text-faint">{f.help}</p>}
          </div>
        ))}
      </div>
      <button type="button" className="h-10 self-start rounded-full border border-line px-4 text-xs text-muted" onClick={() => patch({ ...HIVE_DEFAULTS, scalp: { ...HIVE_DEFAULTS.scalp }, trader: { ...HIVE_DEFAULTS.trader } })}>
        Reset to defaults
      </button>
    </section>
  );
}
