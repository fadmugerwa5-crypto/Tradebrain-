// One AI key box. The provider and the model are worked out from the key itself, nothing to pick by hand.
export type AiProvider =
  | "gemini" | "xai" | "groq" | "openai" | "anthropic"
  | "deepseek" | "openrouter" | "mistral" | "cerebras" | "together" | "fireworks"
  | "nvidia" | "sambanova" | "huggingface" | "deepinfra" | "moonshot" | "qwen";

type Spec = {
  label: string;
  /** Key shape. A key is only ever sent to providers whose shape it matches. */
  match: RegExp;
  /** Providers whose keys have no prefix. They are the only ones tried for a key nobody recognises. */
  loose?: boolean;
  /** OpenAI-style base URL (all but Gemini and Claude). */
  base?: string;
  /** Some providers list models without a login, so the key is checked against this URL first. */
  checkUrl?: string;
  /** Newer OpenAI models want max_completion_tokens, everyone else max_tokens. */
  lengthKey?: "max_tokens" | "max_completion_tokens";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SPECS: Record<AiProvider, Spec> = {
  gemini: { label: "Google Gemini", match: /^(AIza|AQ\.)/ },
  anthropic: { label: "Anthropic Claude", match: /^sk-ant-/ },
  xai: { label: "xAI Grok", match: /^xai-/, base: "https://api.x.ai/v1" },
  groq: { label: "Groq", match: /^gsk_/, base: "https://api.groq.com/openai/v1" },
  openrouter: { label: "OpenRouter", match: /^sk-or-/, base: "https://openrouter.ai/api/v1", checkUrl: "https://openrouter.ai/api/v1/key" },
  cerebras: { label: "Cerebras", match: /^csk-/, base: "https://api.cerebras.ai/v1" },
  fireworks: { label: "Fireworks", match: /^fw_/, base: "https://api.fireworks.ai/inference/v1" },
  nvidia: { label: "NVIDIA NIM", match: /^nvapi-/, base: "https://integrate.api.nvidia.com/v1" },
  huggingface: { label: "Hugging Face", match: /^hf_/, base: "https://router.huggingface.co/v1" },
  deepseek: { label: "DeepSeek", match: /^sk-[a-f0-9]{32}$/i, base: "https://api.deepseek.com" },
  openai: { label: "OpenAI", match: /^sk-/, base: "https://api.openai.com/v1", lengthKey: "max_completion_tokens" },
  moonshot: { label: "Moonshot Kimi", match: /^sk-/, base: "https://api.moonshot.ai/v1" },
  qwen: { label: "Alibaba Qwen", match: /^sk-/, base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  together: { label: "Together AI", match: /^(tgp_v1_|[a-f0-9]{64}$)/, loose: true, base: "https://api.together.xyz/v1" },
  mistral: { label: "Mistral", match: /^[A-Za-z0-9]{32}$/, loose: true, base: "https://api.mistral.ai/v1" },
  deepinfra: { label: "DeepInfra", match: /^[A-Za-z0-9]{32}$/, loose: true, base: "https://api.deepinfra.com/v1/openai" },
  sambanova: { label: "SambaNova", match: UUID, loose: true, base: "https://api.sambanova.ai/v1" },
};

export const AI_LABEL = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, v.label])) as Record<AiProvider, string>;

/** Order matters: the first provider that matches is tried first. */
const ORDER: AiProvider[] = ["gemini", "anthropic", "openrouter", "xai", "groq", "cerebras", "fireworks", "nvidia", "huggingface", "deepseek", "openai", "moonshot", "qwen", "together", "mistral", "deepinfra", "sambanova"];

/** Tidies a pasted key: removes quotes, spaces, line breaks, "Bearer " and "KEY=" prefixes. */
export function cleanKey(raw: string): string {
  let k = String(raw ?? "").trim().split(/\s+/).filter(Boolean).join(" ");
  k = k.replace(/^(export\s+)?[A-Z][A-Z0-9_]*API_?KEY\s*=\s*/i, "").replace(/^bearer\s+/i, "");
  return k.replace(/^["'`]+|["'`]+$/g, "").trim();
}

/** Providers worth trying for this key, most likely first. A key is only offered to providers whose key shape it fits. */
export function guessProviders(key: string): AiProvider[] {
  const k = cleanKey(key);
  const hits = ORDER.filter((p) => SPECS[p].match.test(k));
  return hits.length ? hits : ORDER.filter((p) => SPECS[p].loose);
}

async function jsonFetch(url: string, init: RequestInit, ms = 20_000): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  let body: any = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function reason(r: { status: number; body: any }): string {
  const b = r.body;
  const m = typeof b?.error === "string" ? b.error : (b?.error?.message ?? b?.message ?? "");
  return `${r.status}${m ? `: ${String(m).slice(0, 140)}` : ""}`;
}

function version(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

const NOT_CHAT = /(embed|rerank|whisper|tts|stt|transcri|speech|audio|image|imagine|video|vision|moderat|guard|ocr|dall|sora|realtime|playai|robotics|computer|learnlm|gemma)/i;
const first = (list: string[], res: RegExp[]) => {
  for (const re of res) {
    const hit = list.find((n) => re.test(n));
    if (hit) return hit;
  }
  return null;
};

export function pickModel(provider: AiProvider, ids: string[]): string | null {
  const list = ids.filter(Boolean);
  if (!list.length) return null;
  if (provider === "gemini") {
    const ok = list
      .map((n) => n.replace(/^models\//, ""))
      .filter((n) => /^gemini-/.test(n) && !/(image|tts|live|embedding|vision|thinking|exp|lite|audio|robotics|computer|learnlm|gemma)/.test(n));
    const flash = ok.filter((n) => /flash/.test(n));
    const pool = flash.length ? flash : ok;
    pool.sort((a, b) => Number(/preview/.test(a)) - Number(/preview/.test(b)) || version(b) - version(a) || a.length - b.length);
    return pool[0] ?? null;
  }
  if (provider === "xai") {
    const pool = list.filter((n) => /^grok-/.test(n) && !/(image|imagine|vision|video)/.test(n));
    pool.sort((a, b) => version(b) - version(a) || a.length - b.length);
    return pool[0] ?? null;
  }
  if (provider === "groq") {
    // Never pick a safety/guard classifier ("gpt-oss-safeguard"): it is not a chat model, answers empty and has tiny rate limits.
    const chat = list.filter((n) => !/(whisper|tts|guard|embed|playai|distil|orpheus|prompt-guard)/i.test(n));
    return chat.find((n) => n === "llama-3.3-70b-versatile") ?? chat.find((n) => /llama.*versatile/.test(n)) ?? chat.find((n) => /gpt-oss-120b/.test(n)) ?? chat.find((n) => /gpt-oss-20b/.test(n)) ?? chat.find((n) => /llama-3\.1-8b-instant/.test(n)) ?? chat[0] ?? null;
  }
  if (provider === "openai") {
    for (const re of [/^gpt-5(\.\d+)?-mini$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/, /^gpt-/]) {
      const hit = list.find((n) => re.test(n));
      if (hit) return hit;
    }
    return null;
  }
  if (provider === "anthropic") return list.find((n) => /haiku/.test(n)) ?? list.find((n) => /sonnet/.test(n)) ?? list[0] ?? null;
  const chat = list.filter((n) => !NOT_CHAT.test(n));
  const pool = chat.length ? chat : list;
  if (provider === "deepseek") return first(pool, [/^deepseek-chat$/, /flash/, /^deepseek-(?!reasoner|r1)/]) ?? pool[0] ?? null;
  if (provider === "openrouter") {
    // Free models first (this is the free-key use case), then a cheap well-known one.
    const free = pool.filter((n) => /:free$/.test(n));
    return first(free, [/llama-3\.3-70b/, /gpt-oss/, /(qwen|deepseek|mistral|gemma).*(instruct|chat|v3)/, /instruct|chat/]) ?? free[0] ?? first(pool, [/gpt-4o-mini/, /gemini.*flash/, /llama-3\.3/]) ?? pool[0] ?? null;
  }
  if (provider === "mistral") return first(pool, [/^mistral-small-latest$/, /^mistral-medium-latest$/, /small|medium/, /^mistral-large-latest$/]) ?? pool[0] ?? null;
  if (provider === "cerebras") return first(pool, [/gpt-oss/, /llama-?3\.3.*70b/, /llama/]) ?? pool[0] ?? null;
  if (provider === "moonshot") return first(pool, [/kimi-k2.*(instruct|turbo|preview)/, /kimi-k2/, /moonshot-v1-8k/]) ?? pool[0] ?? null;
  if (provider === "qwen") return first(pool, [/^qwen-?(plus|flash|turbo)$/, /^qwen3?.*(plus|flash|turbo)/, /^qwen/]) ?? pool[0] ?? null;
  // Together, Fireworks, NVIDIA, SambaNova, Hugging Face, DeepInfra host many open models: take a solid mid-size instruct one.
  return first(pool, [/llama-?3\.3.*70b.*instruct/i, /llama-?3\.3.*70b/i, /gpt-oss-120b/i, /gpt-oss/i, /qwen.*(instruct|chat)/i, /instruct|chat|turbo/i]) ?? pool[0] ?? null;
}

async function modelsFor(provider: AiProvider, key: string): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const spec = SPECS[provider];
  try {
    if (provider === "gemini") {
      const r = await jsonFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
      if (!r.ok) return { ok: false, error: reason(r) };
      const rows = (r.body?.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[];
      return { ok: true, ids: rows.filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m) => m.name) };
    }
    if (provider === "anthropic") {
      const r = await jsonFetch("https://api.anthropic.com/v1/models?limit=50", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
      if (!r.ok) return { ok: false, error: reason(r) };
      return { ok: true, ids: ((r.body?.data ?? []) as { id: string }[]).map((m) => m.id) };
    }
    const auth = { headers: { Authorization: `Bearer ${key}` } };
    if (spec.checkUrl) {
      const c = await jsonFetch(spec.checkUrl, auth);
      if (!c.ok) return { ok: false, error: reason(c) };
    }
    const r = await jsonFetch(`${spec.base}/models`, auth);
    if (!r.ok) return { ok: false, error: reason(r) };
    // Most answer { data: [...] }; Together answers a bare list and tags each model with its type.
    const rows = (Array.isArray(r.body) ? r.body : (r.body?.data ?? [])) as { id?: string; type?: string }[];
    const chatOnly = rows.some((m) => m.type) ? rows.filter((m) => !m.type || m.type === "chat") : rows;
    return { ok: true, ids: chatOnly.map((m) => String(m.id ?? "")).filter(Boolean) };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached" };
  }
}

/** Finds which provider owns the key and which of its models to use. */
export async function detectAI(rawKey: string, only?: AiProvider[]): Promise<{ ok: true; provider: AiProvider; model: string } | { ok: false; error: string }> {
  const key = cleanKey(rawKey);
  if (key.length < 16) return { ok: false, error: "That key is too short to be an AI key." };
  const tried: string[] = [];
  // Only providers whose key shape fits are tried, so a key is never sent to a provider it cannot belong to.
  for (const provider of only ?? guessProviders(key)) {
    const m = await modelsFor(provider, key);
    if (!m.ok) {
      tried.push(`${AI_LABEL[provider]} ${m.error}`);
      continue;
    }
    const model = pickModel(provider, m.ids);
    if (model) return { ok: true, provider, model };
    tried.push(`${AI_LABEL[provider]}: the key works but no chat model is available to it`);
  }
  return { ok: false, error: `No AI provider accepted this key (${tried.join("; ") || "unrecognised key format"}).` };
}

const REVIEW_PROMPT =
  "You are a trading analyst giving a second opinion on a setup produced by a rules engine. You do not place orders. In 3 short sentences: say whether you agree with the proposed action, name the biggest risk, and say what would invalidate it. Use only the numbers given. Do not invent prices. Never ask for API keys.";

export async function askAI(input: { brief: string; key: string; provider: AiProvider; model: string; test?: boolean; system?: string; json?: boolean; ms?: number; maxTokens?: number }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  // A saved Groq model that is a safety classifier (for example gpt-oss-safeguard) is replaced by a chat model.
  if (input.provider === "groq" && /(safeguard|guard)/i.test(input.model ?? "")) input = { ...input, model: "llama-3.3-70b-versatile" };
  const brief = input.test ? "Reply with the single word: ready" : String(input.brief ?? "").slice(0, input.system ? 12_000 : 2_400);
  const key = cleanKey(input.key);
  if (!key) return { ok: false, error: "No AI key saved. Add one on the Connect tab." };
  const name = AI_LABEL[input.provider];
  const system = input.system ?? REVIEW_PROMPT;
  const ms = input.ms ?? 20_000;
  try {
    if (input.provider === "gemini") {
      const r = await jsonFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${brief}` }] }], generationConfig: { maxOutputTokens: Math.max(64, Math.min(2048, Math.floor(input.maxTokens ?? 700))), ...(input.json ? { responseMimeType: "application/json" } : {}) } }),
      }, ms);
      if (!r.ok) return { ok: false, error: `${name} request failed (${reason(r)})` };
      const text = ((r.body?.candidates?.[0]?.content?.parts ?? []) as { text?: string }[]).map((p) => p.text ?? "").join("").trim();
      return text ? { ok: true, text } : { ok: false, error: `${name} returned an empty answer.` };
    }
    if (input.provider === "anthropic") {
      const r = await jsonFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: input.model, max_tokens: Math.max(64, Math.min(2048, Math.floor(input.maxTokens ?? 500))), system, messages: [{ role: "user", content: brief }] }),
      }, ms);
      if (!r.ok) return { ok: false, error: `${name} request failed (${reason(r)})` };
      const text = ((r.body?.content ?? []) as { text?: string }[]).map((p) => p.text ?? "").join("").trim();
      return text ? { ok: true, text } : { ok: false, error: `${name} returned an empty answer.` };
    }
    const spec = SPECS[input.provider];
    const lengthKey = spec.lengthKey ?? "max_tokens";
    const send = (withJson: boolean) =>
      jsonFetch(`${spec.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: input.model, [lengthKey]: Math.max(64, Math.min(2048, Math.floor(input.maxTokens ?? 600))), ...(withJson ? { response_format: { type: "json_object" } } : {}), ...(input.provider === "groq" && /gpt-oss/i.test(input.model) ? { reasoning_effort: "low" } : {}), messages: [{ role: "system", content: system }, { role: "user", content: brief }] }),
      }, ms);
    let r = await send(!!input.json);
    // Not every provider or model accepts JSON mode. The app reads JSON out of plain text anyway, so retry without it.
    if (!r.ok && input.json && (r.status === 400 || r.status === 422)) r = await send(false);
    if (!r.ok) return { ok: false, error: `${name} request failed (${reason(r)})` };
    const text = String(r.body?.choices?.[0]?.message?.content ?? "").trim();
    return text ? { ok: true, text } : { ok: false, error: `${name} returned an empty answer.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? `${name} timed out.` : `${name} could not be reached.` };
  }
}
