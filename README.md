# ClassPulse

> Every lesson, accounted for.

ClassPulse is a small, self-hosted attendance and lesson-tracking app for a
school. Teachers sign in with a staff number and PIN, scan a QR code at the
gate when they arrive, and scan the classroom code when a lesson starts and
ends. The Director of Studies sees who is late, who is absent, and which
lessons were not covered.

It runs on one computer in the school. No cloud account is required, and no
app store is involved.

## What is in this folder

```
classpulse/
  server/server.cjs     The whole backend (one Node process, one SQLite file).
  app/                  The web app (PWA). Open it in a browser, add to home screen.
  tools/e2e.cjs         Server/API integration checks, including offline-sync recovery.
  tools/scan-test.cjs   21 checks — network, gate-first, replay, forgery rules.
  docs/DEPLOYMENT.md    How to give phones the https:// address the camera needs.
  docs/MAKE-APK.md      Turn the PWA into an installable Android APK (no coding).
```

## Running it locally

You need Node 22 or newer (the server uses the built-in SQLite).

```powershell
node server/server.cjs --port 8787
```

Then open `http://localhost:8787/` on the same computer, or the printed Wi-Fi
address on a phone on the same network. The first visit shows the setup wizard.

## Tests

Start a server on a free port, then run the scripts:

```powershell
node server/server.cjs --port 8791 --quiet --db server/test.db
node tools/e2e.cjs http://localhost:8791
node tools/scan-test.cjs        # starts its own server on 8790
```

## Offline-first synchronization

The phone keeps work locally while disconnected. When the network returns, it
retries pending records and downloads the current school snapshot. DOS, Head
Teacher and Admin devices also download the school-wide activity snapshot, so
they recover updates missed while offline. Teachers only download their own
permitted school setup and do not receive school-wide activity.

Synchronized information includes attendance and lesson events, gate records,
lesson overrides, alerts, cover assignments, leave records, lesson plans,
marks, audit entries, and the shared school calendar/configuration. Each phone
must be connected to the same school server URL. On a native APK, enter that
HTTPS server address on the sign-in screen under **School server**; do not use
`https://localhost` as the school's server address.

The server is the shared source of truth. It must remain running and reachable
for DOS devices to receive updates from other phones. Phones can continue
recording supported work offline and upload it when the connection returns.

## Important limitations to read before deploying

- A phone camera only works on `https://` (or `http://localhost`). See
  `docs/DEPLOYMENT.md`.
- "School Wi-Fi only" is enforced by the address the server sees the request
  coming from. It stops scanning from home and mobile data; it does not stop a
  teacher who is inside the school.
- A printed classroom code can be photographed. Use *Rolling display* on a spare
  screen where possible.

## Licence

Internal school use.


## v1.5.0 — Academics
Syllabus coverage, tests & marks with approval and audit trail, performance analysis, workload, reports (PDF/Excel), academic calendar, lesson-plan review, optional AI assistant. See `docs/ACADEMIC.md`.
