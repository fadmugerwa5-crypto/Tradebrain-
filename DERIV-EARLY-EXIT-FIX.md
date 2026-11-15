# TradeBrain 1.0.391 — Deriv premature-close fix

## Cause found in the source
- Hive Deriv CALL/PUT positions were passed to the AI Executor without the candle-structure survival gate used for Binance positions. The Executor could therefore close a fixed-expiry Deriv contract on a brief negative mark.
- Normal-mode Deriv scalp defaults also included a 70%-of-contract-life time exit, which could sell a contract while it was still negative.

## Changes
- Hive Deriv contracts no longer ask the AI Executor to close while the contract mark is negative.
- A deterministic emergency loss guard remains: close only at or beyond 60% of stake loss, and only after 60 seconds, if Deriv allows a sale. Otherwise the contract continues to its own expiry.
- Normal-mode early exits now have a 60-second minimum hold, a 50% stake loss cap, and the default time-based early exit is disabled. Existing saved settings that still exactly match the old 70% time-stop / 35% cut defaults are migrated to the safer defaults.
- User-configurable normal-mode exit controls remain available.

## Verification
- Full repository test suite: 153 passed, 0 failed.
- Typecheck and production build are not verified in this environment because the repository dependencies/types are not installed.
- No Android APK is included; upload this source to the repository and let its Android workflow build it.

## Risk note
This does not guarantee a trade will recover. Deriv fixed-expiry contracts can still expire at a full stake loss. Keep testing on Deriv demo until forward testing validates the behaviour.
