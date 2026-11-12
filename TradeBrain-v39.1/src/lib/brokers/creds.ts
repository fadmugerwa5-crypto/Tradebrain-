// Client-safe helpers (no node:crypto) shared by the Connect tab and the server code.
/**
 * Pasted keys often carry invisible characters (zero-width spaces, line breaks, smart quotes,
 * a leading "key:" label). Those make a correct key fail with -2015 or -1022 while the length still looks right.
 */
export function cleanCredential(raw: string): { value: string; removed: number } {
  const value = String(raw ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00A0]/g, "")
    .replace(/[\s"'\u2018\u2019\u201C\u201D`]/g, "");
  return { value, removed: String(raw ?? "").length - value.length };
}

export function credentialShape(key: string, secret: string): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!key) notes.push("API key is empty.");
  if (!secret) notes.push("API secret is empty.");
  if (key && !/^[A-Za-z0-9]+$/.test(key)) notes.push("API key has characters Binance keys never contain.");
  if (secret && !/^[A-Za-z0-9]+$/.test(secret)) notes.push("API secret has characters Binance secrets never contain.");
  if (key && secret && key === secret) notes.push("Key and secret are identical. The secret was probably pasted into both boxes.");
  if (key && (key.length < 32 || key.length > 128)) notes.push(`API key length ${key.length} is unusual.`);
  if (secret && (secret.length < 32 || secret.length > 128)) notes.push(`API secret length ${secret.length} is unusual.`);
  return { ok: notes.length === 0, notes };
}

export function maskCredential(v: string): string {
  if (!v) return "empty";
  if (v.length <= 8) return `${"•".repeat(v.length)} (${v.length})`;
  return `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)`;
}

export function roundToTick(price: number, tick: number, dir: "down" | "up" | "nearest" = "nearest"): number {
  if (!(tick > 0)) return price;
  const q = price / tick;
  const n = dir === "down" ? Math.floor(q + 1e-9) : dir === "up" ? Math.ceil(q - 1e-9) : Math.round(q);
  const s = String(tick);
  const dec = s.includes("e-") ? Number(s.split("e-")[1]) : (s.split(".")[1] || "").length;
  return Number((n * tick).toFixed(Math.min(12, dec)));
}
