# Jump Scalper rebuild notes

This package starts the product refactor from TradeBrain v39.2 into **Jump Scalper**.

## UI changes made
- Renamed the visible app/header and Android display name to Jump Scalper.
- Replaced the AI Hive home screen with the non-AI Mission/scanner dashboard.
- Reduced primary navigation to Scanner, Markets, Chart, Positions, Settings, and Connect.
- Removed Learn, Intelligence, Watchtower, and Hive from the reachable application navigation and render tree.
- Removed AI provider key-entry cards from Connect.
- Removed AI entry/management controls from Settings.
- Kept Binance and Deriv connection screens and the existing order execution/risk controls.
- Kept the Android application ID `com.tradebrain.app` so an installed prior build can be updated rather than becoming a separate Android app.

## Important implementation status
This is a UI/product cleanup and branding pass, not yet the complete live-candle oscillation scalper described in the project brief. The inherited radar still evaluates its existing candle-based strategies. It has not yet been replaced with a tick-by-tick oscillation detector, rapid market rotation scheduler, per-position micro-profit collector, or a fully tested multi-market concurrent execution state machine. Those must be implemented and tested before enabling automated live trading.

The existing Binance/Deriv connectors and risk locks are retained. Use demo/paper execution while developing. A successful compile or test does not establish profitability.
