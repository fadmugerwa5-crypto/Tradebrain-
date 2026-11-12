# TradeBrain v39 — Watchtower + Radar preservation build

This is a source-code upgrade of the existing TradeBrain v38.4 project, not a replacement application. The original non-AI Scalp Radar remains a separate market discovery/ranking system. A new persistent Opportunity Watchtower is added alongside it.

## Changes implemented in this source package

- Corrected product branding from **SwarmDesk** to **TradeBrain** in the application header, HTML title, Android app name, Android artifact name, Windows product metadata, and build workflow artifact labels. The Android package ID remains `com.tradebrain.app`.
- Fixed the shipped-interface visibility issue in the source: the existing `RadarPanel` was implemented in `mission.tsx` but not mounted in the actual Home/Hive screen. It is now mounted on Home without replacing its original scanner logic.
- Added a separate **Opportunity Watchtower** navigation destination and screen.
- Added persistent opportunity records in browser local storage, deduplication, status history, expiry, trigger proximity monitoring, invalidation monitoring, source tagging and bounded storage.
- Connected qualifying Radar candidates to the Watchtower without removing them from Radar's own shortlist or scanner.
- Connected valid Hive multi-agent WAIT decisions to Watchtower collection when a BUY/SELL direction can be inferred from the agent tally. A WAIT does not authorize an order.
- Added Watchtower unit tests and included them in `npm test`.

## Verification performed here

- `npm test`: **151 tests passed, 0 failed** (including the 3 new Watchtower tests).
- `node --experimental-strip-types --test src/lib/trade/watchtower.test.ts`: **3 passed**.
- `npm run typecheck`: **not completed** because dependencies could not be installed in this environment (`@types/node` and `vite/client` were unavailable).
- `npm run build`: **not completed** for the same dependency-install limitation.
- Android APK / Windows EXE: **not built in this environment**. The GitHub Actions workflows have been renamed to produce TradeBrain-labelled artifacts, but they must run in GitHub to confirm a real APK/EXE.

## Important scope limitation

This is a real source-code implementation of the branding/build correction, original Radar restoration in the actual Home screen, and a first integrated persistent Watchtower. It is **not yet the entirety of every v39 item** in the master specification. In particular, the complete AI per-tranche quantity/stake allocation engine, staged-entry execution state machine, full correlated message/communication trace across every agent, and full counterfactual opportunity-learning pipeline still require further implementation and testing. No claim is made that those unfinished items are complete.

## Install and test

```bash
npm install
npm run typecheck
npm test
npm run build
```

Keep trading in paper/demo mode. Live trading remains subject to the existing lock and Risk Guard. A passing test suite does not establish profitability.
