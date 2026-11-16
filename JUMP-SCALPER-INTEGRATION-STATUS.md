# Jump Scalper integration checkpoint

This source is based on the previously deployed Jump Scalper live-tick checkpoint. Existing Binance and Deriv connection and credential flows have been retained.

## Added in this integration pass

- Dedicated Jump Scalper enable/disable switch and configuration controls.
- Dedicated execution branch in the central engine. When enabled, it bypasses the inherited candle planner so two strategies do not compete for entries.
- Candidate ranking from tick history, with historical win-rate adjustment after a minimum sample.
- Entry vetoes for disarmed state, disconnected broker, stale ticks, wide spreads, daily loss, position limits, market cooldown, live-money lock, and estimated costs not meeting the net target.
- Broker-specific routing through the existing paper, Binance, and Deriv order-opening functions.
- Independent monitoring for Jump positions, with net-target, stop and time exits. Deriv contract early-exit management is left to the Jump controller for positions tagged `JUMP_SCALPER`.
- Persistent local opportunity/trade memory and a recorded performance summary on the scanner dashboard.
- Legacy persisted settings are migrated with safe Jump defaults; Jump mode defaults OFF.
- Binance Jump close P&L now subtracts estimated round-trip fees. Actual broker statements remain authoritative.
- Tick-feed lifecycle fixes: starting after stop re-enables reconnects and Deriv reconnect uses the current subscription list.

## Verification performed

- Full existing Node test suite: **181 passed, 0 failed**.
- Jump-specific tests: **6 passed, 0 failed**.
- TypeScript/TSX syntax transpilation: **0 syntax diagnostics**.

## Not verified / limitations

- A full TypeScript typecheck and Vite production build were not possible in this environment because npm dependency installation timed out and `node_modules` is absent.
- No Android APK was built in this environment.
- Live Binance and Deriv market streams and real order execution were not exercised here. The user has previously confirmed their existing broker connections work; this pass does not claim a fresh live execution test.
- Deriv's public tick messages do not provide bid/ask in this adapter, so the scanner cannot independently measure a conventional bid/ask spread for those symbols. Do not infer zero transaction cost from a missing spread field.
- Existing Binance Futures one-way position handling intentionally prevents a second independent position on the same symbol because it could merge with the first and invalidate its protective orders. Broker/account mode limitations remain in force.
- Local scanner/position management runs while the app's engine is running. Android background execution is not proven to be reliable 24/7; only exchange-confirmed protective orders persist independently.
- Memory is local to this app installation (localStorage), not cloud-synchronized.
- Profit targets and win rate are configuration/measurement goals, not guarantees. Run demo/paper validation before real-money use.
