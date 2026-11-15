# BRAIN ULTIMATE — spec audit and status

Stack found: TanStack Start + React 19 + Zustand + lightweight-charts 5 (web app, runs in a browser; data via server functions).
Traders Council: already absent from the code (only a comment says "not a voting council"). Nothing to remove.

Legend: **T** implemented and unit-tested · **M** tested only against an in-process fake exchange (request construction, not real Binance) · **U** implemented, never run (needs a browser build or real credentials) · **—** not implemented

## Fixed or added in this pass
| Item | Status |
|---|---|
| Binance orders were sent as GET (that is "query order", never trades). Now POST | M |
| Hidden characters / quotes / line breaks stripped from pasted keys (classic cause of -2015 with correct lengths) | T |
| -2015/-1022 diagnostic now probes live, demo and testnet and says which one accepts the key | M |
| Permissions step, key-format step, secret never echoed (masked as `ABCD…WXYZ (n chars)`) | T / M |
| "Validate order (no trade)" via Binance `/order/test` | M |
| Exchange-side stop+target (Spot OCO) after a BUY fill; "protected" only when Binance reports EXECUTING; cancel-before-close; fill detection with real average price; safe-response setting if protection fails | M (U in the UI loop) |
| Fees in base asset subtracted from sellable quantity | M |
| Real Binance balances used for sizing/goals on the Binance venue (previously the $10k paper book); stale/unknown balance blocks entries | U |
| Deriv real balance used for sizing/goals on the Deriv venue | U |
| Connect tab rebuilt: Show/Hide/Paste, masked preview, cleaning notice, Grok key + model, Gemini model, per-service Test buttons with stored result, status card | U (UI) |
| Grok key now comes from the Connect tab (server env var only a fallback); Gemini key moved from URL to header; provider error text surfaced | U |
| Profit goal: session / daily / weekly, amount or % of starting equity, session length, max drawdown, stop-or-continue on reach, realized-only | T |
| Drawdown / session-over hard halt wired into the risk engine | T |
| Chart: timeframe picker, MACD + Volume + ATR + RSI panes, Bollinger, configurable periods, FVG/OB zone boxes, BOS/CHoCH/sweep/HH-HL markers, trendlines, equal highs/lows, previous-day H/L, engine plan lines, your own horizontal/trend drawings (saved per symbol), full screen, zoom kept across refreshes, reason list for every overlay | annotation logic T · rendering U |
| Switching timeframe clears old candles, ignores in-flight old responses, loads immediately | U |
| Focused chart refreshes about every 5 s (polling) | U |
| Mission screen: environment, status text, exposure, goal rows, drawdown, fees | U |

## Already present before this pass
Fast single decision engine (no Council), 3 modes, risk engine with per-entry/combined/daily/drawdown-style limits, cooldowns, duplicate-setup detection, per-symbol limits, paper account, Deriv CALL/PUT contracts with settlement polling, journal basics, emergency stop, Gemini/Grok on demand only.

## Not implemented / limitations (be aware)
- Binance **Futures** demo/live, shorting on Binance (spot is long-only here), other brokers.
- Streaming prices: charts poll REST (~5 s focus, ~20 s others). No websocket feed.
- Controller runs only while the page is open. Android v24+: while auto-trading is armed a foreground service, a wake lock and keep-screen-on make the app far less likely to be paused in the background (best effort, Android can still stop it). No cloud runner. Only Binance-confirmed OCOs keep protecting when the page is closed.
- Keys live in browser storage on the device and are sent to this app's own server per request. A proper server-side credential vault is not built.
- Restart recovery: positions persist locally and OCOs are re-polled, but there is no full reconciliation against the broker's open orders/positions.
- Partial-fill handling is basic (executed quantity is tracked; no resting limit-order management).
- Deriv: no per-contract stop/TP; contracts are fixed 5-minute CALL/PUT. Stake is the max loss.
- Backtesting / out-of-sample promotion workflow and per-strategy/timeframe analytics beyond the existing Journal: not built.
- Zone rectangles use lightweight-charts' primitive API; if it misbehaves in your browser it falls back to dotted lines.
- Window VWAP is over the loaded candles, not a session VWAP.

## Tests
`npm test` now runs engine.test.ts (11), features.test.ts (13) and binance.test.ts (16): 40/40 passing in this environment.
Could NOT be done here: `npm install`, `vite build`, full `tsc`, browser run, real Binance/Deriv/Gemini/Grok calls (no network).

## First things to do on your machine
1. `npm install && npm run typecheck && npm test && npm run dev`
2. Connect tab → pick the environment that matches where you created the key → Test connection. If it says the key works on a different environment, switch to that one.
3. Validate order (no trade) → then Paper venue first, Binance demo second. Live stays locked.

## Builds (GitHub Actions)
- Windows .exe: Electron shell + the built web server (Nitro `node-server` preset, chosen with `NITRO_PRESET`; default stays `vercel`). The workflow smoke-tests the server (must answer HTTP) before packaging.
- Android .apk: Capacitor launcher that opens the server address (default http://localhost:8080 = Termux). Debug-signed. It does NOT contain the server.
- Not run in the authoring environment (no network): `npm install`, `vite build`, Electron/Gradle packaging. The first Actions run is the first real build. If a step fails, the log shows which one.
- Windows app stores keys/journal in the window's browser storage, tied to port 18787. If that port is busy the app uses the next free one and saved settings will look empty.

## v12: standalone rewrite
- The web server is gone. All broker/AI calls now run inside the app (src/lib/brokers/api.ts calls market.ts directly). Same screens, same engine, same features.
- Android: Capacitor shell with the built app bundled in the APK; CapacitorHttp (native HTTP) is on so Binance and AI calls are not blocked by CORS.
- Windows: Electron window serving the bundled app on 127.0.0.1:18787 (fixed so saved keys/journal persist).
- Binance signing now uses WebCrypto (verified against the official Binance HMAC vector in the tests).
- Not tested in a real build or on a real device before this version: the Vite bundle, the Android build, the Electron build. Logic tests (40) pass.

## v13
- Connect tab rebuilt: broker-first, Binance Demo/Live/Testnet x Spot/Futures (demo-api / demo-fapi hosts), Deriv token only, one auto-detected AI key.
- Markets come only from the connected broker (Binance top USDT markets by volume, all open Deriv markets). No broker = no markets, no charts.
- Binance Futures: leverage/isolated setup, long and short market orders, exchange-side stop/target via the Algo Order API, fill detection. Never run against a real Binance here (no network): test on Futures Demo first.
- Wrong-environment keys are detected and the app switches to the matching environment.
- Deriv reconnects and re-authorizes itself after a socket drop.

## v14
- Deriv moved to the current API (REST + OTP socket; the old socket is dead). Charts via public feed; orders need token + App ID.
- Three AI key boxes (Gemini, Grok, other). Button-style tabs. Arm banner on Mission.

## v18: AI-controlled scalping (Aggressive mode)
| Item | Status |
|---|---|
| Fix: after the breakeven lock, R was measured from the moved stop, so trades closed at about 1.2x fees. R now stays fixed at the original stop distance | T |
| AI entry gate: rules engine proposes, AI answers TAKE/SKIP + profit level + size (never larger). Strict JSON, every field validated and clamped, fee floor enforced | parsing T · live calls U |
| AI trade management: HOLD / EXIT / TIGHTEN on open scalps. Stop moves must tighten and stay behind price. 45s lease, then the plain rules resume | parsing T · live calls U |
| AI down or too slow: open trades fall back to the rules; new entries skip (or follow rules, setting) | U |
| Strategy guard: blocks a strategy whose last 20 aggressive trades lost money (needs 10) | T |
| Results table: all / aggressive / AI approved / rules only | T (maths) · U (UI) |

## v19: close from the app, Deriv accounting
| Item | Status |
|---|---|
| Close now button on every open position (two taps). Close all. Deriv contracts are sold at the current price | rule T · live sell U |
| Deriv scalp: sell early at a % of stake profit (default 35); optional cut-loss % (default off) | T (rule) · U (live) |
| Open Deriv profit now comes from the contract's real value, not index points | U |
| Equity on Deriv includes open contracts at current value (opening a trade no longer looks like a loss; drawdown no longer trips on stakes) | U |
| Mission: "Realized today" (was all-time) and a "not in the app's records" line when the balance moved more than the app recorded | U |
| Exposure for Deriv contracts = stake, not index price | U |
| Closed markets are skipped; Deriv markets scanned per cycle 3 / 5 / 8 (normal / aggressive / mad) | U |
| Fee gate no longer applies to Deriv contracts; loss pause now updates after Deriv results | T / U |

## v20: scan and trade every market
| Item | Status |
|---|---|
| Root cause of "only Volatility": default scan list and "Top 40" took the first markets in Deriv's list (synthetics). Default is now every open market, mixed across groups; new "All open" mode keeps it that way (turns off when you switch one market by hand) | U |
| Controls: All open / Mixed 40 / None, plus one chip per group (Forex, Stock indices, Commodities, Synthetic...) with on/total counts | U |
| Scan speed: markets per cycle 8/12/16 (or list/5 if larger), fetched 6 at a time instead of one by one, refetch 15 s. 89 markets covered in about 5 cycles | U |
| Closed markets are not fetched; Deriv open/closed flags refreshed every 10 minutes | U |
| Deriv contracts: not every market sells a 5-minute CALL/PUT. Tries 5m, 10m, 15m, 30m, 1h, 2h, 4h, 1d until Deriv accepts; remembers the working length; markets Deriv refuses are skipped 10-30 minutes. The Book shows the real length | U |
| Entries: up to 1/2/3 new Deriv contracts per cycle (normal/aggressive/mad), at most half the position limit in one market group | U |
| Feed note shows how many scanned markets have enough candles ("ready") | U |
Syntax-checked only here (no npm install / build / network). First real build is the GitHub Actions run.

## v21
- Root cause of "still only Volatility": the planner spent the limits (positions, open risk, entries per hour) on setups in list order, and Volatility indices come first and signal constantly. Setups are now ranked by quality, with an 8-point penalty per extra pick from the same market group, so forex / indices / commodities / crypto get entries too

## v22
- Fix: v20 fetched up to 16 markets of candle history at once and Deriv answered "rate limit for ticks_history_expensive", so many markets (forex...) never loaded and only synthetics were scored. History is now paced (6 per cycle, 1.2 s apart, markets with no candles first, then the stalest; refetch every 90 s), and a rate-limit answer pauses candle loading for 60 s

## v23: scalp radar (scan every market, rank, AI picks, scalp the best)
| Item | Status |
|---|---|
| Strategy library (src/lib/market/strategies.ts): EMA pullback, VWAP reclaim, squeeze breakout, RSI(2) snap-back, range breakout, liquidity-sweep reversal, MACD burst. Pure functions of the candles up to the bar they judge (no look-ahead, tested) | T |
| Per market and strategy "recent record": the same signals replayed over the loaded history, traded with the real scalp exits (stop 1R, breakeven lock, bank at quickR, time stop), fees and slippage subtracted, small samples pulled toward zero | T (logic) |
| Radar (src/lib/trade/radar.ts): scans every tradable market on the last CLOSED candle, drops setups price already ran from, setups fees would eat, strategies with a weak or thin record; ranks by signal strength 40% + recent record 40% + fee room/spread 20%; cached per closed bar | T |
| AI shortlist: top candidates go to the AI in one call; it lists every id TAKE/SKIP, may lower the size and pick the bank level (0.4-1.0R), never add markets or raise size; answer is validated and clamped; runs in the background so exits are never delayed | parsing T · live calls U |
| Planner: in radar mode only radar picks are traded, one per market; the risk engine, goals, cooldowns, loss pause and strategy guard still apply to every entry | T |
| Loading: in radar mode 24 Binance markets are fetched per sweep (was 5) so all markets are covered in about a minute | U |
| Screens: Controls "Scalp radar" section (Start button, on/off, limits), Mission "Scalp radar" panel with the shortlist, each pick's record, and a 3-line how-to-scalp | U (UI) |
| Runner targets of the strategies are 1.5R or more, because the risk engine rejects anything under 1.4R | T |
Radar needs Aggressive mode with scalp rules on (the Start button sets this and moves a slower timeframe to 5m). Tests: npm test now also runs radar.test.ts (7 tests: strategies, no look-ahead, exits, AI answer parsing, radar ranking, planner).
Not done here: npm install / vite build / real broker or AI calls (no network). The first Actions run is the first real build.

## v28: relaxed AI, working inputs, Close ALL fix, Signal-style Mission
- AI strictness setting (Controls > Scalp): Relaxed (default) / Balanced / Strict. Relaxed prompts default to TAKE and only veto clear red flags; the radar no longer drops candidates the AI simply did not list while there is room in the top-N. If the AI cannot answer, the rules now decide (aiOnFail = rules) and the wait is 10 s. Older saves are moved to these values once.
- Number boxes: type anything (clear it, 0.5, trailing dot). Saved as soon as valid, limits applied when you leave the box. Leverage box uses the same input.
- Close ALL: confirm sheet (no 4-second timer), every position is closed on its own so one failure cannot stop the rest, a scan that was mid-AI-call can no longer open a trade after you press Close ALL or Stop, missing Binance key now logs instead of doing nothing, result message when finished. Header buttons are a 3-column row so none are squeezed off the phone screen.
- Mission opens with a Signal analyzer: market picker, "Analyzing..." ring, eight real readings (trend, support, move, momentum, session, EMA 50/200, price at level, RSI) ticking off with a progress bar, then the engine's verdict (BUY/SELL/WAIT, score, entry/stop/target). Readings come from the loaded candles (src/lib/market/readings.ts, tested). Strategy, scoring and risk logic untouched.
- New look: orange accent theme, card style, icon bottom menu.
- Not run here: vite build, tsc, a browser (no network). 73/73 unit tests pass.

## v31: Trades tab (real swing trades, not scalping)
A new bottom-menu tab, "Trades". Separate engine, separate switch ("Start swing trading"), separate limits. The scalper never manages these trades and their wins/losses do not feed the scalper's loss pause.

| Item | Status |
|---|---|
| Strategy library (src/lib/trade/swing.ts): opening-range breakout, previous-day high/low sweep fade, sigma breakout, anchored-VWAP trend, multi-day trend breakout. Pure functions of the candles up to the bar judged | T (no look-ahead test) |
| Ports from the Roboquant presets: ORB family, PDH/PDL sweep fade, Sigma Breakout, Daily Anchored VWAP. NOT ported: London IFVG, Williams %R (20k-trade scalper), Friday/Monday revisit and T-Mean (62 and 164 trades, weekend-gap logic that crypto lacks), anything with a 0.3x target against a 2.2x stop. Trend breakout is a classic, not a preset | design |
| Record gate: each strategy is replayed over the market's last ~1000 candles with real exits and round-trip fees + slippage; it may trade that market only with >= N past trades and >= X R average after costs (defaults 10 and 0.10). On pure random data every strategy loses about 0.36R per trade after costs, so noise is not approved | T |
| Planner: sizing and all hard checks reuse risk.ts (stop/target sides, reward:risk, spread, size, daily loss, combined risk, positions). Own limits: risk per trade (0.5%), max open (3), combined risk (1.5%), 4 entries/hour, pause 24 h after N losses in a row | T |
| Orders go through the same path as the scalper (same live-money lock, same exchange-side stop+target on Binance after the fill) and are tagged book="swing" with a time limit | M / U |
| Exits: exchange holds stop+target when Binance confirms them. The time limit (and, for paper or unconfirmed protection, stop/target) run in the app, from 15m candles since entry plus the live price. Stop wins a tie | T (rule) / U (live) |
| Safety: Deriv venue is refused (fixed-length contracts, no resting stop). Live Binance still needs the LIVE unlock; arming live takes a second tap. Stop button, Close ALL, emergency, uncertain execution and protection failure all switch swing entries off too. Android keep-alive also runs while swing is armed | U |
| Klines request accepts a limit (50 to 1000, default 300 so nothing else changes) | U |

Limits to know about:
- Showcase numbers in the Roboquant list are in-sample, per-market, on index futures. They do not transfer. Only the logic was ported, and each port has to prove itself per market after fees.
- 1h candles x 1000 = ~41 days of history. The previous-day sweep fade is rare, so on 1h it will often have fewer than 10 past trades and be held back; use 4h, or lower "Past trades needed", knowing the record is then thinner.
- The Trades loop only runs while the app is open. Exchange-held stop/target keep working when it is closed; the time limit does not.
- Spot is long-only; shorts need Binance Futures.
- No live strategy guard yet (the scalper has one). No AI gate on swing entries.
- Not run here: npm install, vite build, a browser, any broker. 83/83 logic tests pass; the new screens and loop were only checked with a stub-typed tsc.

## v32: all markets, Deriv swing trades, signals to copy, charts, TradFi agreement
| Item | Status |
|---|---|
| Trades tab scans Binance (top N by volume, default 20, up to 120) AND Deriv (open markets mixed across groups, default 30, up to 120): forex, gold, silver, indices, synthetics. One setting picks Binance, Deriv or both | M / U |
| Binance discovery now keeps PERPETUAL and TRADIFI_PERPETUAL contracts (gold XAUUSDT, silver XAGUSDT, other non-crypto perps), always includes them whatever their volume, raised the cap from 60 to 250 (max 400) and the price-quote cap from 80 to 400 symbols. Markets tab group "Metals & TradFi (Binance)" | U (needs a live exchangeInfo to confirm the contract-type string) |
| Button on the Trades tab signs Binance's TradFi-Perps agreement (POST /fapi/v1/stock/contract, documented by Binance). Two taps, user-initiated, never automatic. Futures env only, not portfolio margin | U |
| Deriv swing trades = MULTUP / MULTDOWN multiplier contracts with stop_loss and take_profit inside the contract (Deriv holds them). Sizing: stake = risk / (multiplier x stop %), largest multiplier whose stop stays inside 60% of the stake, never raised to reach a minimum stake. Multipliers on offer read from contracts_for per market (cached 6 h); markets with none stay signal-only | T (sizing, routing) / U (live API: field names taken from Deriv's docs, not exercised) |
| Orders go to the broker chosen as Order execution (Simulated, Binance, Deriv). Markets of the other broker show as "Signal only". Trading both brokers with real money at once is not supported | T |
| Signals: every actionable signal has Copy and Share (plain text with entry, stop, target, size rule, record). Last 60 are saved in "Saved signals" | T (text) |
| Scalper: two new radar strategies, failed-breakout return (DTR-style, rolling range) and previous-day high/low sweep. Both pass through the same per-market record gate as the others. The previous-day one needs a whole previous day in the loaded candles, so it only fires on 15m and slower | T |
| Charts: static import of the chart library; candles sorted and de-duplicated before drawing; every optional layer is guarded so one bad overlay cannot blank the chart; any problem is printed under the chart; the chart loads its own candles for the market on screen (Binance or Deriv) instead of waiting in the scalper's queue; chart no longer rebuilds on every store update | U (cause of the blank chart was not reproduced here) |

Not ported from the Roboquant list for scalping: NQ Precision Bot (0.3x ATR target is smaller than round-trip fees on crypto 1m), Williams %R (PF 1.07), Continuation Havoc (thin payoff). Deriv's multiplier commission was not confirmed; the planner assumes the same 0.24% round trip as Binance, which is cautious.

## v33: more swing strategies, stricter record checks
| Item | Status |
|---|---|
| Four new swing strategies: trend pullback (20 EMA reclaim in a 50/200 EMA trend), RSI(2) mean reversion (with 200 EMA trend), narrow-range (NR7) breakout, previous-WEEK high/low sweep fade. Nine in total. None is a Roboquant preset; sources are named in the app | T (fire on crafted patterns; no look-ahead test covers all nine) |
| Daily-trend filter (default ON): longs only when the daily trend is up (last daily close > 10-day EMA > 20-day EMA, completed days only), shorts only when down. Applied inside the signal AND inside the record measurement. Does not judge when under ~25 days of candles | T (no look-ahead, only removes signals) |
| Steady-record rule (default ON): a strategy's past trades on that market are split in time order; both halves must average above 0R (needs 6+ trades) | T |
| Defaults raised to 15 past trades and +0.15R (was 10 and +0.10R). On 540 random market/strategy pairs the old gate approved 9, the new rules approve 1. Saves that still hold the old defaults and the original five strategies are moved to the new settings automatically | T (simulation, not real markets) |

Honest limit: with ~50 markets x 9 strategies scanned there are ~450 pairs, so a few chance approvals are still possible at any time; the stricter gate cuts this, it cannot remove it. Nothing here proves a strategy has an edge on a real market.

## v34: Self-Learning AI (Learning Brain)
Built from the "TradeBrain v34 Self-Learning AI Blueprint". Everything is read-only toward trading except two things it may do, both after your approval or your own switch: remove a setup, or rank it lower. It has no way to change risk %, stake, leverage, limits or stops (no such field exists in its types; a test checks this).

| Blueprint part | Where | Status |
|---|---|---|
| Trade memory: every closed trade stored with entry/stop/target/exit, fees, R, session, venue and mode, AI-reviewed or rules-only, config version, and the market facts at entry | `lib/learn/watch.ts`, Learn > Journal | T (logic) · U (live wiring) |
| Market regime detector (trend up/down, range, squeeze, volatility expansion, unclear), closed candles only, ATR judged as % of price | `lib/learn/regime.ts` | T |
| 15m bias from 5m/1m candles (clock-aligned resample, complete bars only); on 15m+ charts it uses 4x the timeframe | `lib/learn/regime.ts` | T |
| Loss/win analyzer: hypotheses with evidence, "unknown" when nothing stands out | `lib/learn/analyzer.ts` | T |
| Strategy health by strategy, market, regime, session, direction, venue, with win-rate and expectancy intervals and confidence labels (under 30 trades = low) | Learn > Strategy health | T |
| Pattern learner with clustered entries counted once | `lib/learn/learn.ts` | T |
| Candidate changes: found on the earlier 60% of trades, must hold on the later 40%, then a shadow test on new trades, then YOUR approval | `lib/learn/learn.ts`, Learn > Overview | T |
| Strategy selector: gate in the radar and in the Trades planner (block or lower rank; shown in the radar rows and as the blocked reason) | `lib/learn/rules.ts` | T (with the real radar and swing planner) |
| Entry filters you can switch on: block against the 15m bias, stand aside in unclear/volatile markets, max spread | Learn > Settings | T |
| Config versions, change history, one-tap restore, learning log | Learn > Change history | T |
| Backtest lab: chronological train/validation/holdout, costs charged, baseline vs 15m-filter, by strategy and regime | `lib/learn/backtest.ts`, Learn > Backtest lab | T |
| Mind: first-person lessons from its own records, mistake register (habits with 10+ cases and clearly worse results), "still repeating" check, one-tap guard | `lib/learn/reflection.ts`, Learn > Mind | T |
| Controls: pause learning, pause new signals, emergency stop; backup/import (JSON), CSV copy | Learn > Overview, Settings | U |

Not built, on purpose: any claim of awareness; automatic approval of changes; learning that touches position size or risk.
All new filters and rules default to OFF/empty, so v34 trades exactly like v33 until you change something. Trades are stored on this device; use Settings > Copy backup now and then.

## v35: HIVE (AI colony), now v36 SwarmDesk (below)

- New home screen "Hive": 10 agents (Scout, Trend, Scalper, Regime, Pulse, Risk Guard, Watchdog, Executor, Journal, Coach). Nine use an AI key; the Watchdog is code.
- Each agent has its own key box. The provider and model are detected from the key itself (17 known providers, any OpenAI-compatible endpoint through "Unknown provider?"). A shared key fills in for agents without their own.
- A round: Scout picks a market, Trend/Scalper/Regime/Pulse vote, enough must agree, Risk Guard may veto or shrink, Executor makes the final call. The Executor then watches open trades and may close early.
- Orders use the same paths as the scalper (paper, Binance demo, Deriv demo) and the same live-money lock. Stops/targets are watched every 2 s even while the AI is thinking.
- Limits (settings, not strategy): risk per trade, max open trades, daily loss lock, wait after a loss, AI calls per minute.
- Tests: src/lib/hive/hive.test.ts (logic, parsing, consensus, sizing, fake-model rounds, key detection with a mocked network).
- Not verified here: the screens were type-checked against stand-in types but not built or run on a device (no network in the build sandbox).


## v36: SwarmDesk

- Renamed (app name, titles, release files). The Android package id stays com.tradebrain.app so it installs over the old app.
- New light, frosted-glass design. The hive is a honeycomb: each agent is an ant in its own chamber, the Queen's chamber in the middle shows the decision, ants walk the tunnels, and a messenger ant carries each fresh vote to the Queen.
- One desk per connected broker. Deriv connected = a Scalp desk. Binance connected = a Trader desk (ordinary trading on hourly candles, wider stops, bigger reward-to-risk, rounds every 5 minutes). Both connected = both run, one round at a time. Binance can be switched to Scalp; Deriv always scalps (fixed-duration contracts). Each desk can be set to Practice (simulated orders on real prices).
- Learning: every closed trade is measured (best and worst price while open, price a while after the exit), tagged (exited early, stopped then reversed, wrong from the start...), turned into a lesson, and each analyst is graded. Lessons that fit a market are shown to all agents before each round. Votes are weighted by hit rate once an agent has 10 graded trades.
- Old app: Mission, Trades, Book and Controls tabs are hidden (their code is still in the repo, no longer reachable). Next pass deletes it.
- Tests: hive.test.ts (logic, learning). Not run on a device: screens were type-checked against stand-in types and the loop was run against a fake AI and fake broker (single desk, trader style, and Deriv + Binance together).

## v37
- Radar warm-up: no trading until ~85% of open markets have loaded (max 5 min), then all markets are ranked together.
- Shortlist of 5 across groups (max 2 per group, one per cluster of markets that move together), AI picks the best 3.
- Boom/Crash stay in but must show 1.5x the trades and 2x the edge; spiky markets are penalised or dropped.
- Markets the radar is not sure about (confidence below 45) are skipped.
- Learning from losses: a market with 2 losses in a row is benched for 90 min (doubles at 4 losses).
- New "Load size" setting multiplies Binance entry size (default 1).


## v38: Ultimate Hybrid Intelligence (this upgrade)

| Item | Status |
|---|---|
| Master Intelligence agent with its own key slot; independent final review can veto but cannot modify levels or raise size | Logic tested |
| Per-agent AI Budget Manager: daily request cap, per-minute cap, cooldown, identical-prompt cache, input/output limits | Logic tested |
| Per-agent usage counters: calls, cache hits, blocked requests, errors; UTC daily rollover | Logic tested |
| Independent brain memory derived from each agent's graded closed-trade decisions | Store/UI added |
| Intelligence Command screen: market pipeline, radar shortlist, per-brain budget controls, scoreboard, memory and decision audit trail | UI added; browser build not run |
| Existing individual agent key slots and optional shared fallback preserved; no key consolidation | Preserved |
| Existing Radar, strategy engine, Learning Brain, chronological train/validation/holdout lab, chart and broker workflows retained | Preserved |
| Full test suite | 142/142 passing |
| Vite build / typecheck / APK / EXE | Not verified here: dependency installation timed out |

Budget defaults are conservative starting controls, not provider quota guarantees. Provider quotas vary by model and account. The Master brain is optional: without a configured Master key, the prior colony flow continues; once configured, an explicit approval is required for a trade.


## v38.1: Adaptive Trade Management (ATM) / Trade Survival

| Item | Status |
|---|---|
| Pullback-aware monitor for Binance and its practice desk | Implemented; uses completed candles only |
| Distinguishes ordinary adverse movement from confirmed structure invalidation | Implemented in `src/lib/trade/survival.ts` |
| EMA21 slope + two completed closes beyond recent swing structure required before an invalidation review | Implemented |
| Profit giveback review when a trade reached at least +1R and gives back to +0.15R or less with two opposite candles | Implemented |
| Negative floating P&L alone never authorizes Executor to close a Binance/practice trade | Implemented |
| No Executor API call during ordinary pullbacks or intact setups | Implemented; conserves each brain's own API quota |
| Recheck the deterministic market evidence after the Executor responds; stale close recommendation is rejected | Implemented |
| Original hard stop and target remain authoritative; stop is never widened by ATM | Preserved |
| Stop-width-vs-ATR diagnostic | Implemented; informational only, no post-entry stop widening |
| Per-trade management state, reason, excursions and blocked early-exit count | Stored in receipt and shown in Intelligence Command |
| Recovery / after-exit learning | Existing post-exit price check and `stopped-out-then-reversed` learning retained |
| Deriv fixed-duration contract path | Existing behaviour retained; ATM structure gate is applied to Binance and its practice desk |
| New survival tests | Added for pullback, insufficient data, invalidation and single-candle noise |

Safety note: ATM does not promise to avoid every stop-out or improve profitability. A valid stop can still be hit before a market reverses. The upgrade is designed to stop discretionary AI early-closes on ordinary pullbacks; it does not override exchange-side or local protective stops.
