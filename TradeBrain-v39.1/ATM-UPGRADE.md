# TradeBrain v38.4 — Adaptive Trade Management (ATM)

## The problem this addresses
A trade can move temporarily against its entry, trigger an AI Executor close, and then resume in the originally expected direction. The old Executor prompt allowed early closing based on a vague judgement that the trade reason had gone. That can confuse a normal pullback with a true invalidation.

## What changed

### 1. Pullback detection
`src/lib/trade/survival.ts` evaluates completed candles, the 21 EMA, ATR, recent swing structure, current R, and the best/worst price observed while the position is open.

A normal losing fluctuation is classified as `NORMAL_PULLBACK` when the original thesis has not been invalidated. An intact trade is `THESIS_INTACT`. Neither state triggers an Executor API call.

### 2. Confirmed thesis invalidation
For a BUY, the monitor requires two completed closes below a recent swing-low level, both closes below EMA21, and EMA21 turning down. SELL logic mirrors this. Only then does it ask Executor to review an early exit.

### 3. Profit giveback protection
If a trade previously reached at least +1R, then falls to +0.15R or less while two completed candles move against the position, ATM requests an Executor review. This is a review trigger, not an automatic close.

### 4. AI request conservation
Executor is not called for ordinary pullbacks or intact setups. This avoids spending the Executor brain's separate API quota on repeated, low-value checks. Each brain retains its own API key and independent budget.

### 5. Recheck after the model response
Before any AI-recommended early close, the app reads the latest price and candles and runs the deterministic monitor again. If the evidence no longer supports an exit, the close is rejected and recorded.

### 6. Stop and target authority
The original hard stop and target remain authoritative. ATM does not widen a stop, move it farther away, disable it, or increase position size. A valid stop may still be hit before a market later reverses; no algorithm can guarantee otherwise.

### 7. Stop-width diagnostic
The monitor compares the original stop distance with ATR and records a note when the stop looks unusually tight for the style. This is diagnostic only; it does not widen an open trade's stop. Position sizing must continue to reflect the actual stop risk.

### 8. Learning and audit
The Intelligence Command screen shows current management state, the reason, excursion in R, and rejected early-close count. Closed-trade recovery tags and the existing after-exit price measurement remain in the decision audit trail.

## Scope
The new completed-candle structure gate applies to Binance HIVE positions and Binance practice positions. Deriv fixed-duration contracts retain their existing contract-management path because their contract mechanics and early-sale behaviour differ.

## Tests
`src/lib/trade/survival.test.ts` covers ordinary pullbacks, insufficient history, stop preservation, confirmed structure breaks, and one-candle noise. The full project test suite currently reports 147 passing tests.

## Limitations
The new logic is deterministic protection around the existing AI Executor, not proof of profitability. It can still exit late, stop out, or miss a valid early exit. It must be tested in paper/demo mode with realistic fees, spread, slippage, and different market regimes before any live deployment.
