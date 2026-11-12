import { allowBackground, keepAliveAvailable } from "@/lib/keepalive";
import { MODE_PROFILES, type Mode } from "@/lib/market/types";
import { closePosition } from "@/lib/trade/account";
import { GOAL_DEFAULTS } from "@/lib/trade/goal";
import { SCALP_DEFAULTS } from "@/lib/trade/scalp";
import { RADAR_DEFAULTS } from "@/lib/trade/radar";
import { IND0, LAYERS0, PANELS0, mixByGroup, useBrain } from "@/stores/brain";
import { Field, Num, Toggle, labelOf } from "./ui";
import { ScalpStats } from "./scalp-stats";

const LAYER_LABELS: [keyof typeof LAYERS0, string][] = [
  ["plan", "Engine plan"],
  ["levels", "S/R"],
  ["zones", "FVG / OB"],
  ["structure", "BOS / CHoCH / swings"],
  ["trend", "Trendlines"],
  ["liquidity", "Liquidity"],
  ["prevDay", "Prev day H/L"],
  ["ema", "EMAs"],
  ["bb", "Bollinger"],
  ["vwap", "VWAP"],
];

export function Controls() {
  const settings = useBrain((s) => s.settings);
  const patch = useBrain((s) => s.patchSettings);
  const lossPause = useBrain((s) => s.lossPause);
  const goalBypass = useBrain((s) => s.goalBypass);
  const resetPaper = useBrain((s) => s.resetPaper);
  const markets = useBrain((s) => s.markets);
  const flattenArmed = useBrain((s) => s.flattenArmed);
  const log = useBrain((s) => s.log);
  const g = settings.goal;
  const setGoal = (p: Partial<typeof g>) => patch({ goal: { ...g, ...p } });
  const sc = settings.scalp;
  const aiSlots = useBrain((s) => s.ai);
  const aiReady = (["gemini", "grok", "other"] as const).filter((k) => aiSlots[k].status === "ready");
  const setScalp = (p: Partial<typeof sc>) => patch({ scalp: { ...sc, ...p } });
  const rd = settings.radar;
  const setRadar = (p: Partial<typeof rd>) => patch({ radar: { ...rd, ...p } });
  const radarRunning = (settings.mode === "aggressive" || (settings.mode === "normal" && sc.normalScalp)) && sc.enabled && rd.enabled;
  const setInd = (p: Partial<typeof settings.ind>) => patch({ ind: { ...settings.ind, ...p } });
  return (
    <section className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2">
        {(["normal", "aggressive", "mad"] as Mode[]).map((mode) => (
          <button key={mode} type="button" className={`h-11 rounded-md border text-sm ${settings.mode === mode ? "border-accent bg-elev-2 text-fg" : "border-line text-muted"}`} onClick={() => patch({ mode })}>
            {mode === "mad" ? "MADBOT" : mode[0]!.toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
      <p className="text-xs text-faint">
        {settings.mode}: score {MODE_PROFILES[settings.mode].minScore}, families {MODE_PROFILES[settings.mode].minFamilies}, cooldown {MODE_PROFILES[settings.mode].cooldownSec}s, up to {Math.min(MODE_PROFILES[settings.mode].maxPerSymbol, settings.maxPerSymbol)} per symbol. Hard loss limits still apply. No martingale.
      </p>

      <div>
        <h2 className="mb-2 text-sm font-medium">Risk limits</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Timeframe">
            <select className="h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={settings.interval} onChange={(e) => patch({ interval: e.target.value as typeof settings.interval })}>
              {["1m", "5m", "15m", "30m", "1h", "4h", "1d"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Num label="Risk per entry %" value={settings.riskPct} onChange={(riskPct) => patch({ riskPct })} />
          <Num label="Load size (Binance trade size, 1 = normal, 1.5 = 50% bigger)" value={settings.lotSize ?? 1} onChange={(n) => patch({ lotSize: Math.min(10, Math.max(0.1, n)) })} />
          <Num label="Max combined risk %" value={settings.maxOpenRiskPct} onChange={(maxOpenRiskPct) => patch({ maxOpenRiskPct })} />
          <Num label="Daily loss %" value={settings.dailyLossPct} onChange={(dailyLossPct) => patch({ dailyLossPct })} />
          <Num label="Max positions" value={settings.maxPositions} onChange={(maxPositions) => patch({ maxPositions })} />
          <Num label="Max per symbol" value={settings.maxPerSymbol} onChange={(maxPerSymbol) => patch({ maxPerSymbol })} />
          <Num label="Pause after losses" value={settings.consecLimit} onChange={(consecLimit) => patch({ consecLimit })} />
          <Num label="Max drawdown % (0 = off)" value={g.maxDrawdownPct} onChange={(maxDrawdownPct) => setGoal({ maxDrawdownPct })} />
        </div>
        <Field label="If an exchange stop/target cannot be confirmed after a fill">
          <select className="mt-2 h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={settings.onProtectFail} onChange={(e) => patch({ onProtectFail: e.target.value as "keep-local" | "close" })}>
            <option value="keep-local">Keep watching locally and stop new entries</option>
            <option value="close">Close the position at market</option>
          </select>
        </Field>
      </div>

      <div className="rounded-md border border-line p-3">
        <h2 className="text-sm font-medium">Scalp radar: scan every market, pick the best, scalp them</h2>
        <p className="mt-1 text-xs text-faint">
          After the markets load from your broker, the radar first waits until almost all of them have loaded (warm-up), then runs seven scalping strategies on every one of them, checks how each strategy did on that same market recently (after fees), ranks the live setups, asks the AI to choose the best, and then the bot scalps only those. The risk limits, goals and loss pauses still apply to every entry.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={`h-11 rounded-md border px-3 text-sm ${radarRunning ? "border-accent bg-elev-2 text-fg" : "border-line"}`}
            onClick={() =>
              patch({
                mode: "aggressive",
                scalp: { ...sc, enabled: true },
                radar: { ...rd, enabled: true },
                interval: ["1m", "5m", "15m"].includes(settings.interval) ? settings.interval : "5m",
              })
            }
          >
            {radarRunning ? "Scalp radar is running" : "Start scalp radar"}
          </button>
          <Toggle on={rd.enabled} label={rd.enabled ? "Radar: on" : "Radar: off (old per-market engine)"} set={(enabled) => setRadar({ enabled })} />
        </div>
        <p className="mt-2 text-xs text-faint">Scalping works best on 1m or 5m candles. Starting the radar sets Aggressive mode and moves a slower timeframe to 5m. It scans the markets switched on in the Markets tab (all open ones by default).</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Num label="Scalp at most this many markets at once" value={rd.top} onChange={(top) => setRadar({ top: Math.min(10, Math.max(1, Math.round(top))) })} />
          <Num label="Candidates the AI looks at" value={rd.aiList} onChange={(aiList) => setRadar({ aiList: Math.min(12, Math.max(2, Math.round(aiList))) })} />
          <Num label="Past trades needed to trust a strategy on a market" value={rd.minTrades} onChange={(minTrades) => setRadar({ minTrades: Math.min(30, Math.max(1, Math.round(minTrades))) })} />
          <Num label="Min average result per trade (R, after fees)" value={rd.minEdge} onChange={(minEdge) => setRadar({ minEdge })} />
          <Num label="Min score (0-100)" value={rd.minScore} onChange={(minScore) => setRadar({ minScore: Math.min(100, Math.max(0, minScore)) })} />
          <Num label="Most from one market group in the shortlist" value={rd.perGroup} onChange={(perGroup) => setRadar({ perGroup: Math.min(5, Math.max(1, Math.round(perGroup))) })} />
          <Num label="Warm-up: % of markets loaded before trading" value={rd.warmupPct} onChange={(warmupPct) => setRadar({ warmupPct: Math.min(100, Math.max(0, Math.round(warmupPct))) })} />
          <Num label="Warm-up longest wait (seconds)" value={rd.warmupMaxSec} onChange={(warmupMaxSec) => setRadar({ warmupMaxSec: Math.min(900, Math.max(30, Math.round(warmupMaxSec))) })} />
          <Num label="Skip markets it is not sure about: min confidence (0-100)" value={rd.minConfidence} onChange={(minConfidence) => setRadar({ minConfidence: Math.min(100, Math.max(0, Math.round(minConfidence))) })} />
          <Num label="Spike limit (how spiky a market may be)" value={rd.spikeMax} onChange={(spikeMax) => setRadar({ spikeMax: Math.min(60, Math.max(4, spikeMax)) })} />
          <Num label="Bench a market after this many losses in a row (0 = off)" value={rd.benchLosses} onChange={(benchLosses) => setRadar({ benchLosses: Math.min(10, Math.max(0, Math.round(benchLosses))) })} />
          <Num label="Benched for (minutes)" value={rd.benchMin} onChange={(benchMin) => setRadar({ benchMin: Math.min(1440, Math.max(5, Math.round(benchMin))) })} />
        </div>
        <button type="button" className="mt-2 h-11 rounded-md border border-line px-3 text-sm" onClick={() => patch({ radar: { ...RADAR_DEFAULTS } })}>
          Reset radar settings
        </button>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Scalp and compound (Aggressive mode only)</h2>
        <div className="flex flex-wrap gap-2">
          <Toggle on={sc.enabled} label={sc.enabled ? "Scalp rules: on" : "Scalp rules: off"} set={(enabled) => setScalp({ enabled })} />
          <Toggle on={sc.stepDown} label={sc.stepDown ? "Half size after 2 losses: on" : "Half size after 2 losses: off"} set={(stepDown) => setScalp({ stepDown })} />
        </div>
        <div className="mt-3 rounded-md border border-line p-3">
          <h3 className="text-sm font-medium">AI controls the scalping</h3>
          <p className="mt-1 text-xs text-faint">
            {aiReady.length ? `AI connected: ${aiReady.join(", ")}.` : "No AI connected, so the plain rules run. Add a key on the Connect tab."} The rules engine finds the setup and the risk limits stay in charge. The AI approves or skips, picks where to bank the profit, can shrink the size (never grow it), and watches open trades.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Toggle on={sc.aiEntry} label={sc.aiEntry ? "AI approves entries: on" : "AI approves entries: off"} set={(aiEntry) => setScalp({ aiEntry })} />
            <Toggle on={sc.aiManage} label={sc.aiManage ? "AI manages open trades: on" : "AI manages open trades: off"} set={(aiManage) => setScalp({ aiManage })} />
            <Toggle on={sc.stratGuard} label={sc.stratGuard ? "Strategy guard: on" : "Strategy guard: off"} set={(stratGuard) => setScalp({ stratGuard })} />
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Which AI">
              <select className="h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={sc.aiSlot} onChange={(e) => setScalp({ aiSlot: e.target.value as typeof sc.aiSlot })}>
                <option value="auto">First connected</option>
                <option value="gemini">Gemini slot</option>
                <option value="grok">Grok slot</option>
                <option value="other">Other slot</option>
              </select>
            </Field>
            <Field label="If the AI cannot answer, new entries">
              <select className="h-11 w-full rounded-md border border-line bg-elev px-2 text-sm" value={sc.aiOnFail} onChange={(e) => setScalp({ aiOnFail: e.target.value as typeof sc.aiOnFail })}>
                <option value="skip">Are skipped (safer)</option>
                <option value="rules">Follow the rules alone</option>
              </select>
            </Field>
            <Field label="How strict the AI is">
              <select className="h-11 w-full rounded-md border border-line bg-elev-2 px-2 text-sm" value={sc.aiStrict ?? "relaxed"} onChange={(e) => setScalp({ aiStrict: e.target.value as typeof sc.aiStrict })}>
                <option value="relaxed">Relaxed: takes most setups, vetoes only clear red flags</option>
                <option value="balanced">Balanced</option>
                <option value="strict">Strict: skips anything doubtful</option>
              </select>
            </Field>
            <Num label="Seconds to wait for the AI" value={sc.aiTimeoutSec} onChange={(aiTimeoutSec) => setScalp({ aiTimeoutSec: Math.min(20, Math.max(2, aiTimeoutSec)) })} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Num label="Take profit at R" value={sc.quickR} onChange={(quickR) => setScalp({ quickR })} />
          <Num label="Lock breakeven + fees at R" value={sc.lockR} onChange={(lockR) => setScalp({ lockR })} />
          <Num label="Profit must beat fees by (x)" value={sc.feeMult} onChange={(feeMult) => setScalp({ feeMult })} />
          <Num label="Stop for the day after giving back % (0 = off)" value={sc.givebackPct} onChange={(givebackPct) => setScalp({ givebackPct })} />
          <Num label="Symbol cool-off after a loss (min)" value={sc.lossCoolMin} onChange={(lossCoolMin) => setScalp({ lossCoolMin })} />
          <Num label="Max entries per hour" value={sc.maxEntriesHour} onChange={(maxEntriesHour) => setScalp({ maxEntriesHour })} />
          <Num label="Deriv: sell early at profit % of stake (0 = off)" value={sc.derivTakePct} onChange={(derivTakePct) => setScalp({ derivTakePct })} />
          <Num label="Deriv: sell early at loss % of stake (0 = off)" value={sc.derivCutPct} onChange={(derivCutPct) => setScalp({ derivCutPct })} />
          <Num label="Normal mode: sell at profit % of stake" value={sc.normalTakePct} onChange={(normalTakePct) => setScalp({ normalTakePct })} />
          <Num label="Normal mode: hard loss cap % of stake" value={sc.normalCutPct} onChange={(normalCutPct) => setScalp({ normalCutPct })} />
          <Num label="Normal mode: minimum hold seconds before early exits" value={sc.normalMinHoldSec} onChange={(normalMinHoldSec) => setScalp({ normalMinHoldSec: Math.max(0, Math.round(normalMinHoldSec)) })} />
          <Num label="Normal mode: after a dip of % , sell on bounce" value={sc.normalDipPct} onChange={(normalDipPct) => setScalp({ normalDipPct })} />
          <Num label="Normal mode: bounce counts at profit %" value={sc.normalRecoverPct} onChange={(normalRecoverPct) => setScalp({ normalRecoverPct })} />
          <Num label="Normal mode: time-based early sell (0 = off; default off)" value={sc.normalTimeFrac} onChange={(normalTimeFrac) => setScalp({ normalTimeFrac: Math.min(1, Math.max(0, normalTimeFrac)) })} />
          <Num label="Normal mode: new Deriv trades per scan" value={sc.normalMaxNew} onChange={(normalMaxNew) => setScalp({ normalMaxNew: Math.min(10, Math.max(1, Math.round(normalMaxNew))) })} />
        </div>
        <div className="mt-3">
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => patch({ scalp: { ...SCALP_DEFAULTS } })}>
            Reset scalp settings
          </button>
        </div>
        <ScalpStats />
        <p className="mt-2 text-xs text-faint">Banks small wins early, scans again right after a win, skips setups where fees would eat the profit, and never raises size after a loss. Set your daily goal in Profit goal below. Many small trades means many fees, so test on paper first.</p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Profit goal</h2>
        <div className="grid grid-cols-2 gap-2">
          {(["amount", "percent"] as const).map((b) => (
            <button key={b} type="button" className={`h-11 rounded-md border text-sm ${g.basis === b ? "border-accent bg-elev-2" : "border-line text-muted"}`} onClick={() => setGoal({ basis: b })}>
              {b === "amount" ? "Amount" : "% of starting equity"}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Num label={`Session target ${g.basis === "amount" ? "" : "%"}`} value={g.session} onChange={(session) => setGoal({ session })} />
          <Num label={`Daily target ${g.basis === "amount" ? "" : "%"}`} value={g.daily} onChange={(daily) => setGoal({ daily })} />
          <Num label={`Weekly target ${g.basis === "amount" ? "" : "%"}`} value={g.weekly} onChange={(weekly) => setGoal({ weekly })} />
          <Num label="Session hours (0 = no limit)" value={g.sessionHours} onChange={(sessionHours) => setGoal({ sessionHours })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => setGoal({ sessionStart: Date.now() })}>
            Start a new session now
          </button>
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => setGoal({ onReach: g.onReach === "stop-entries" ? "continue" : "stop-entries" })}>
            On reaching a target: {g.onReach === "stop-entries" ? "stop new entries" : "keep trading"}
          </button>
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => patch({ goal: { ...GOAL_DEFAULTS } })}>
            Reset goal
          </button>
        </div>
        <p className="mt-2 text-xs text-faint">Targets count realized results only, since the session start, UTC day start or Monday UTC. They never raise risk and never promise a result.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {lossPause && (
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => useBrain.setState({ lossPause: false })}>
            Resume after loss pause
          </button>
        )}
        <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => useBrain.setState({ goalBypass: !goalBypass })}>
          {goalBypass ? "Goal block is overridden" : "Allow entries after the goal"}
        </button>
        <button
          type="button"
          className="h-11 rounded-md border border-line px-3 text-sm"
          onClick={() => {
            if (!flattenArmed) {
              useBrain.setState({ flattenArmed: true });
              return;
            }
            const st = useBrain.getState();
            let account = st.account;
            let positions = [...st.positions];
            const paper = positions.filter((p) => p.status === "open" && p.venue === "paper");
            for (const p of paper) {
              const mark = st.quotes[p.symbol]?.last ?? p.entry;
              const result = closePosition(account, p, mark, "Manual flatten", Date.now());
              account = result.account;
              positions = positions.filter((x) => x.id !== p.id);
              positions.push(result.closed);
              if (result.remainder) positions.push(result.remainder);
            }
            useBrain.setState({ account, positions, flattenArmed: false, armed: false });
            log(`Flattened ${paper.length} paper position(s). Broker positions were left open.`, "warn");
          }}
        >
          {flattenArmed ? "Confirm paper flatten" : "Flatten paper"}
        </button>
        <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => resetPaper()}>
          Reset paper book
        </button>
        {keepAliveAvailable() && (
          <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => void allowBackground()}>
            Allow background running
          </button>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Markets the bot scans and trades</h2>
          {markets.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button type="button" aria-pressed={settings.autoAll} className={`h-9 rounded-md border px-3 ${settings.autoAll ? "border-accent text-fg" : "border-line text-muted"}`} onClick={() => patch({ autoAll: true, enabled: [...markets.filter((m) => m.open !== false)].map((m) => m.symbol) })}>
                All open
              </button>
              <button type="button" className="h-9 rounded-md border border-line px-3 text-muted" onClick={() => patch({ autoAll: false, enabled: mixByGroup(markets).slice(0, 40).map((m) => m.symbol) })}>
                Mixed 40
              </button>
              <button type="button" className="h-9 rounded-md border border-line px-3 text-muted" onClick={() => patch({ autoAll: false, enabled: [] })}>
                None
              </button>
            </div>
          )}
        </div>
        {markets.length > 0 && (
          <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
            {[...new Set(markets.map((m) => m.group))].map((g) => {
              const inGroup = markets.filter((m) => m.group === g);
              const onCount = inGroup.filter((m) => settings.enabled.includes(m.symbol)).length;
              const allOn = onCount === inGroup.length;
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={allOn}
                  className={`h-9 shrink-0 rounded-full border px-3 text-xs ${allOn ? "border-accent text-fg" : onCount ? "border-line text-fg" : "border-line text-faint"}`}
                  onClick={() => patch({ autoAll: false, enabled: allOn ? settings.enabled.filter((s) => !inGroup.some((m) => m.symbol === s)) : [...new Set([...settings.enabled, ...inGroup.map((m) => m.symbol)])] })}
                >
                  {g} {onCount}/{inGroup.length}
                </button>
              );
            })}
          </div>
        )}
        {markets.length === 0 ? (
          <p className="text-sm text-faint">Connect a broker and its markets appear here. Every market has a chart whether or not the bot trades it.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {markets.map((m) => {
              const on = settings.enabled.includes(m.symbol);
              return (
                <button key={m.symbol} type="button" aria-pressed={on} className={`h-10 rounded-md border px-3 text-sm ${on ? "border-accent text-fg" : "border-line text-faint"}`} onClick={() => patch({ autoAll: false, enabled: on ? settings.enabled.filter((s) => s !== m.symbol) : [...settings.enabled, m.symbol] })}>
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Chart layers</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {LAYER_LABELS.map(([k, label]) => (
            <Toggle key={k} on={settings.layers[k]} label={label} set={(v) => patch({ layers: { ...settings.layers, [k]: v } })} />
          ))}
          <Toggle on={settings.chartStyle === "line"} label="Line chart" set={(line) => patch({ chartStyle: line ? "line" : "candle" })} />
        </div>
        <h2 className="mb-2 mt-4 text-sm font-medium">Indicator panels</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {(["rsi", "macd", "volume", "atr"] as const).map((k) => (
            <Toggle key={k} on={settings.panels[k]} label={k.toUpperCase()} set={(v) => patch({ panels: { ...settings.panels, [k]: v } })} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Num label="EMA 1" value={settings.ind.ema1} onChange={(ema1) => setInd({ ema1 })} />
          <Num label="EMA 2" value={settings.ind.ema2} onChange={(ema2) => setInd({ ema2 })} />
          <Num label="EMA 3 (0 = off)" value={settings.ind.ema3} onChange={(ema3) => setInd({ ema3 })} />
          <Num label="RSI period" value={settings.ind.rsiPeriod} onChange={(rsiPeriod) => setInd({ rsiPeriod })} />
          <Num label="Bollinger period" value={settings.ind.bbPeriod} onChange={(bbPeriod) => setInd({ bbPeriod })} />
          <Num label="Bollinger width" value={settings.ind.bbK} onChange={(bbK) => setInd({ bbK })} />
          <Num label="MACD fast" value={settings.ind.macdFast} onChange={(macdFast) => setInd({ macdFast })} />
          <Num label="MACD slow" value={settings.ind.macdSlow} onChange={(macdSlow) => setInd({ macdSlow })} />
        </div>
        <button type="button" className="mt-3 h-11 rounded-md border border-line px-3 text-sm" onClick={() => patch({ ind: { ...IND0 }, layers: { ...LAYERS0 }, panels: { ...PANELS0 } })}>
          Reset chart settings
        </button>
      </div>
    </section>
  );
}
