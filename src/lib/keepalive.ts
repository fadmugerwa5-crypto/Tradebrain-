/** Android only: foreground service + keep-screen-on while auto-trading is armed. Does nothing in a browser or on Windows. */
type KeepAlive = {
  start: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  batteryExemption: () => Promise<{ granted?: boolean }>;
};

function plugin(): KeepAlive | null {
  const c = (globalThis as { Capacitor?: { Plugins?: { KeepAlive?: KeepAlive } } }).Capacitor;
  return c?.Plugins?.KeepAlive ?? null;
}

export function keepAliveAvailable() {
  return plugin() !== null;
}

export async function setKeepAlive(on: boolean) {
  try {
    const p = plugin();
    if (p) await (on ? p.start() : p.stop());
  } catch {
    /* the app keeps working without it */
  }
}

/** Opens Android's battery setting. Returns true if the app is already exempt. */
export async function allowBackground(): Promise<boolean> {
  try {
    const p = plugin();
    if (!p) return false;
    return Boolean((await p.batteryExemption()).granted);
  } catch {
    return false;
  }
}
