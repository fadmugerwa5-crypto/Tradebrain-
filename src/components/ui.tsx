import { useEffect, useRef, useState, type ReactNode } from "react";
import { DERIV_DEFAULTS, marketInfo } from "@/lib/market/types";
import { useBrain } from "@/stores/brain";

export function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "up" | "down" }) {
  return (
    <div className="tb-card p-3">
      <p className="text-xs text-faint">{label}</p>
      <p className={`mt-1 text-xl font-medium ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-fg"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-faint">
      {label}
      {children}
    </label>
  );
}

/**
 * Number box that lets you type anything: clear it, type 0.5, a lone minus, a trailing dot.
 * The text you type is kept as typed while the box is focused; the number is saved as soon as it is valid,
 * and the box shows the saved (and limited) value again when you leave it.
 */
export function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const shown = Number.isFinite(value) ? String(value) : "0";
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = (raw: string) => {
    const t = raw.trim().replace(",", ".");
    if (t === "" || t === "-" || t === "." || t === "-.") return;
    const n = Number(t);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const v = e.target.value;
          if (!/^-?\d*[.,]?\d*$/.test(v)) return;
          setText(v);
          commit(v);
        }}
        onBlur={() => {
          focused.current = false;
          setText(shown);
        }}
        className="h-11 rounded-md border border-line bg-elev-2 px-3 text-sm text-fg outline-none focus:border-accent"
      />
    </Field>
  );
}

export function Toggle({ on, label, set }: { on: boolean; label: string; set: (v: boolean) => void }) {
  return (
    <button type="button" className={`h-11 rounded-md border px-3 ${on ? "border-accent text-fg" : "border-line text-faint"}`} onClick={() => set(!on)}>
      {label}
    </button>
  );
}

export function labelOf(symbol: string) {
  return marketInfo(symbol)?.label ?? DERIV_DEFAULTS.find((d) => d.symbol === symbol)?.label ?? symbol;
}

export function NoBroker({ what }: { what: string }) {
  const setView = useBrain((s) => s.setView);
  const connecting = useBrain((s) => s.conn.binance.status === "connecting" || s.conn.deriv.status === "connecting");
  return (
    <div className="tb-card p-6 text-center">
      <h2 className="text-base font-medium">{connecting ? "Connecting to your broker…" : "No broker connected"}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        {connecting ? `${what} will appear as soon as the connection finishes.` : `${what} come from your connected broker. Connect Binance or Deriv and every market on the account loads by itself.`}
      </p>
      {!connecting && (
        <button type="button" className="mt-4 h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-fg" onClick={() => setView("connect")}>
          Connect a broker
        </button>
      )}
    </div>
  );
}
