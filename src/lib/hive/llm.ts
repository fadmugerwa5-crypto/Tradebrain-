import { askAI, cleanKey, detectAI, SPECS, type AiProvider } from "../brokers/ai.ts";
import type { AgentId } from "./types.ts";
import type { Ask } from "./colony.ts";

/** What the person typed for one agent. Only the key is needed: the provider and the model are found out from it. */
export type AgentKey = {
  key: string;
  /** Advanced: any OpenAI-compatible endpoint (https://host/v1). Needed only for a provider the app does not know. */
  base: string;
  /** Advanced: force a model name. */
  model: string;
};
export const EMPTY_KEY: AgentKey = { key: "", base: "", model: "" };

export type Profile = { provider: AiProvider | "custom"; label: string; model: string; base?: string; key: string };

const cleanBase = (b: string) => String(b ?? "").trim().replace(/\/+$/, "");

async function getJson(url: string, headers: Record<string, string>, ms = 15_000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  let body: any = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/** Works out the provider and model from the key (or from the endpoint when one was given). */
export async function detectProfile(k: AgentKey): Promise<{ ok: true; profile: Profile } | { ok: false; error: string }> {
  const key = cleanKey(k.key);
  if (key.length < 8) return { ok: false, error: "That key is too short." };
  const base = cleanBase(k.base);
  if (base) {
    if (!/^https?:\/\//i.test(base)) return { ok: false, error: "The endpoint must start with https://" };
    let model = k.model.trim();
    try {
      if (!model) {
        const r = await getJson(`${base}/models`, { Authorization: `Bearer ${key}` });
        if (!r.ok) return { ok: false, error: `Endpoint answered ${r.status}. Type the model name under Advanced.` };
        const rows = (Array.isArray(r.body) ? r.body : (r.body?.data ?? [])) as { id?: string }[];
        model = String(rows.find((m) => m.id && !/(embed|whisper|tts|image|moderat)/i.test(m.id))?.id ?? "");
        if (!model) return { ok: false, error: "The endpoint lists no chat model. Type the model name under Advanced." };
      }
    } catch {
      return { ok: false, error: "The endpoint could not be reached." };
    }
    return { ok: true, profile: { provider: "custom", label: new URL(base).host, model, base, key } };
  }
  const d = await detectAI(key);
  if (!d.ok) return { ok: false, error: d.error };
  return { ok: true, profile: { provider: d.provider, label: SPECS[d.provider].label, model: k.model.trim() || d.model, key } };
}

type Answer = { ok: true; text: string } | { ok: false; error: string };

/** One question to one agent's model. */
export async function askProfile(p: Profile, system: string, user: string, ms = 25_000, maxTokens = 500): Promise<Answer> {
  if (p.provider !== "custom") return askAI({ brief: user, key: p.key, provider: p.provider, model: p.model, system, json: true, ms, maxTokens });
  try {
    const call = (json: boolean) =>
      fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model: p.model, max_tokens: Math.max(64, Math.min(2048, Math.floor(maxTokens))), ...(json ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "system", content: system }, { role: "user", content: user.slice(0, 6000) }] }),
        signal: AbortSignal.timeout(ms),
      });
    let res = await call(true);
    if (!res.ok && (res.status === 400 || res.status === 422)) res = await call(false);
    const body: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `${p.label} request failed (${res.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 120)}` : ""})` };
    const text = String(body?.choices?.[0]?.message?.content ?? "").trim();
    return text ? { ok: true, text } : { ok: false, error: `${p.label} returned an empty answer.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? `${p.label} timed out.` : `${p.label} could not be reached.` };
  }
}

/** Limits how many AI calls the colony makes per minute, and gives an agent a rest after a rate-limit answer. */
export class CallGate {
  private stamps: number[] = [];
  private rest = new Map<AgentId, number>();
  private perMin: number;
  private now: () => number;
  constructor(perMin: number, now: () => number = Date.now) {
    this.perMin = perMin;
    this.now = now;
  }
  setLimit(n: number) {
    this.perMin = Math.max(1, Math.floor(n));
  }
  take(): boolean {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.perMin) return false;
    this.stamps.push(t);
    return true;
  }
  used(): number {
    const t = this.now();
    return this.stamps.filter((s) => t - s < 60_000).length;
  }
  pause(agent: AgentId, ms: number) {
    this.rest.set(agent, this.now() + ms);
  }
  resting(agent: AgentId): number {
    return Math.max(0, (this.rest.get(agent) ?? 0) - this.now());
  }
}

/** Per-agent policy and usage accessors supplied by the persisted Hive store. */
export type AskBudgetPolicy = { enabled: boolean; dailyCalls: number; perMinute: number; cooldownSec: number; cacheSec: number; maxInputChars: number; maxOutputTokens: number };
export type AskBudgetUsage = { day: string; calls: number; cached: number; blocked: number; errors: number; stamps: number[]; lastAt: number };

const answerCache = new Map<string, { until: number; text: string }>();
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

/**
 * Every brain retains its own profile/key. This layer only controls when that brain may call its own provider.
 * Successful identical prompts may be reused briefly; risk and executor replies default to no caching.
 */
export function makeAsk(deps: {
  profile: (a: AgentId) => Profile | null;
  gate: CallGate;
  ask?: typeof askProfile;
  onCall?: (a: AgentId, ok: boolean, error?: string) => void;
  budget?: {
    policy: (a: AgentId) => AskBudgetPolicy;
    usage: (a: AgentId) => AskBudgetUsage;
    record: (a: AgentId, kind: "call" | "cached" | "blocked" | "error", at: number) => void;
  };
  now?: () => number;
}): Ask {
  const send = deps.ask ?? askProfile;
  const now = deps.now ?? Date.now;
  return async (agent, system, user) => {
    const p = deps.profile(agent);
    if (!p) return { ok: false, error: "No working AI key for this agent." };
    const policy = deps.budget?.policy(agent);
    const u = deps.budget?.usage(agent);
    const t = now();
    const day = new Date(t).toISOString().slice(0, 10);
    const usage = u?.day === day ? u : { day, calls: 0, cached: 0, blocked: 0, errors: 0, stamps: [], lastAt: 0 };
    const cacheSec = Math.max(0, policy?.cacheSec ?? 0);
    const cacheKey = `${agent}|${p.provider}|${p.model}|${hash(p.key)}|${hash(system + "\n" + user)}`;
    const cached = cacheSec > 0 ? answerCache.get(cacheKey) : undefined;
    if (cached && cached.until > t) {
      deps.budget?.record(agent, "cached", t);
      return { ok: true, text: cached.text };
    }
    if (cached) answerCache.delete(cacheKey);
    const block = (reason: string) => { deps.budget?.record(agent, "blocked", t); return { ok: false as const, error: reason }; };
    if (policy && !policy.enabled) return block("AI calls are disabled for this brain in its budget settings.");
    const daily = Math.max(0, Math.floor(policy?.dailyCalls ?? 0));
    if (daily > 0 && usage.calls >= daily) return block(`This brain reached its daily API limit (${daily}). It will reset at the next UTC day.`);
    const perMinute = Math.max(0, Math.floor(policy?.perMinute ?? 0));
    const stamps = usage.stamps.filter((x) => t - x < 60_000);
    if (perMinute > 0 && stamps.length >= perMinute) return block(`This brain reached its own per-minute limit (${perMinute}).`);
    const cooldown = Math.max(0, policy?.cooldownSec ?? 0) * 1000;
    if (cooldown > 0 && usage.lastAt > 0 && t - usage.lastAt < cooldown) return block(`This brain is cooling down for ${Math.ceil((cooldown - (t - usage.lastAt)) / 1000)}s.`);
    const wait = deps.gate.resting(agent);
    if (wait > 0) return block(`Resting for ${Math.ceil(wait / 1000)}s after a provider rate limit.`);
    if (!deps.gate.take()) return block("The colony-wide calls-per-minute safety limit was reached.");
    const maxChars = Math.max(500, Math.min(6_000, policy?.maxInputChars ?? 4_200));
    deps.budget?.record(agent, "call", t);
    const r = await send(p, system, user.slice(0, maxChars), 25_000, policy?.maxOutputTokens ?? 500);
    if (r.ok) {
      if (cacheSec > 0) {
        if (answerCache.size > 600) answerCache.clear();
        answerCache.set(cacheKey, { until: t + cacheSec * 1000, text: r.text });
      }
    } else {
      deps.budget?.record(agent, "error", now());
      if (/\b429\b|rate.?limit|quota|too many/i.test(r.error)) deps.gate.pause(agent, 60_000);
    }
    deps.onCall?.(agent, r.ok, r.ok ? undefined : r.error);
    return r;
  };
}
