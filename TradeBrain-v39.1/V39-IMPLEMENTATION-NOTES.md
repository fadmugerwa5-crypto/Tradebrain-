# TradeBrain v39 implementation notes

## Root cause of SwarmDesk branding
The v38.4 source itself contained the old product label in `src/components/terminal.tsx`, `index.html`, `android-shell/capacitor.config.json`, the Android workflow artifact name, and Windows desktop metadata. The Android workflow explicitly copied the built APK to `SwarmDesk.apk` and uploaded it as `SwarmDesk-Android`. Those settings explain why a successful build could still install and display SwarmDesk. They are corrected in this source package.

## Radar preservation
The existing non-AI scanner remains in `src/lib/trade/radar.ts`, and the existing UI remains in `src/components/radar-panel.tsx`. The panel was not mounted in the active Home/Hive screen; it is now mounted in `src/components/hive-tab.tsx`. Watchtower has a separate route in `src/components/terminal.tsx` and separate implementation in `src/lib/trade/watchtower.ts` and `src/components/watchtower-tab.tsx`.

## Watchtower collection
Radar shortlist candidates are persisted by `saveRadarOpportunity`. Hive WAIT results are persisted by `saveHiveWait` when a directional majority can be inferred. The UI monitors the latest available quote, marks opportunities approaching a stored trigger (within 0.2%), expires old records, and marks records invalidated when price crosses a stored stop/invalidation level. This is monitoring and research only: it does not place orders or bypass Master Intelligence/Risk Guard.

## Validation
The full existing Node test suite plus the new Watchtower tests passed: 151/151. Dependency installation timed out in this environment, so typecheck and frontend production build could not be run here. Android/Windows artifacts must be verified by GitHub Actions after upload.
