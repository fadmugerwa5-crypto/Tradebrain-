# TradeBrain v38 — Ultimate Hybrid Intelligence

This is an additive upgrade on top of v37. The existing visual language, broker setup, trading controls, market engines, individual AI-key slots and existing workflows are retained.

## 1. Market discovery and ranking

The v37 market warm-up and Radar remain the discovery layer: the Radar waits for broad market-data coverage, evaluates the available strategies locally, applies market quality / edge / fee / stale-data / confidence / loss-bench / diversification filters, and ranks a shortlist. The Intelligence screen exposes the live coverage, rejection counts and current candidates. Ordinary indicator and strategy scanning does not call an LLM.

The existing Hive Scout still selects from its own shortlist. Specialist agents then analyse the selected market. The main engine's separate Scalp Radar AI remains separate from the Hive agent-key system.

## 2. Independent AI brains and keys

All existing agents remain. A new optional **Master Intelligence** brain has been added with its own key slot and model/provider detection. It runs after the other agents and may approve or veto only. It cannot change entry/stop/target levels or increase risk. If a Master key is configured, a valid explicit approval is required; if no Master key is configured, the existing colony flow is unchanged.

The existing per-agent key boxes and optional shared fallback are not merged or replaced. Each agent continues to resolve its own configured key first.

## 3. AI Budget Manager

Every keyed Hive brain has an independent policy:

- Daily API-call ceiling (0 = no daily ceiling).
- Per-minute call ceiling (0 = no per-agent RPM ceiling).
- Cooldown between real requests.
- Cache lifetime for an identical prompt (0 = no cache).
- Maximum input characters.
- Maximum output tokens.
- Enable / disable AI requests for that brain.

The manager tracks real requests, cache hits, blocked requests and errors per brain. Counters persist locally and use UTC day boundaries. The original colony-wide calls-per-minute limit remains active as a second safety layer.

Caching is keyed by brain, provider, model, a one-way key fingerprint and exact prompt. Only successful answers are cached. Risk Guard, Executor and Master have caching disabled by default so approvals are not replayed from cache.

Provider free-tier quotas vary and change; the local caps are user-configurable controls, not a promise that a provider will never return a quota error.

## 4. Independent learning memory and performance

When a closed trade is graded, each brain that participated receives its own memory entry recording the market, outcome, R result and lesson. The Intelligence screen shows per-brain memories, calls/errors and a historical performance scoreboard. The existing Learning Brain continues to grade agents and use its established sample-size safeguards.

## 5. Strategy research and replay

The existing strategy library and Learning Brain remain the strategy laboratory. It already has chronological train / validation / holdout testing, strategy health, mistake analysis, change proposals and user approval before learning changes affect live rules. The new Intelligence screen adds a decision audit/replay view showing saved trade receipts, plus a local multi-market holdout research sweep, agent votes, proposed levels and actual outcomes. This is an audit replay of stored decision facts, not a tick-by-tick historical chart reconstruction.

## 6. Safety and execution

Existing deterministic risk controls, broker-side protection, emergency stop, duplicate-order prevention, loss limits and demo/paper modes are retained. Master Intelligence is an additional veto, not a replacement for Risk Guard or deterministic controls.

## 7. Validation

The automated logic test suite passes **142/142 tests** in the authoring environment, including the new Master veto and per-brain budget/cache tests. Dependency installation timed out in this environment, so a full `npm run typecheck`, Vite production build, Android APK build and Windows executable build have not been verified here. Run those checks on the target machine or GitHub Actions before using the app.

## 8. Important caveats

- AI output is not proof of a profitable edge. Backtest results are historical evidence, not a guarantee.
- Use Paper and broker Demo first. Keep live trading locked until all broker and device behaviours are tested.
- Existing API-key persistence is intentionally unchanged in this upgrade. Keys remain in the app's current local storage mechanism; protect the device and never commit or share app storage containing credentials.
- Android background execution remains best-effort and the app still requires the controller to be active for local decision loops. Exchange-side protection is the only protection that can persist independently of the app where supported and confirmed by the broker.
