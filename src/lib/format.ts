export function px(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, d), maximumFractionDigits: d });
}

export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ago(ts: number | null): string {
  if (!ts) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
