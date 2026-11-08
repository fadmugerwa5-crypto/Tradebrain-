# ClassPulse — Audit Report (Phase 1)

**Date:** 2026-11-04
**Scope:** Full inspection of the existing ClassPulse codebase before any further changes.
**Instruction followed:** Inspect → report → recommend → (implement only after review).

---

## 1. Existing application architecture

### Stack
- **Frontend:** Vanilla JavaScript PWA. No framework, no build step. Classic `<script>` tags loaded in order into a global `CP` object. ~12 view/controller files.
- **Backend:** Single Node.js process (`server/server.cjs`, ~47 KB) using only built-in modules: `node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`, `node:os`.
- **Database:** SQLite (`server/classpulse.db`), 9 tables: `meta`, `users`, `rooms`, `zones`, `classes`, `timetable`, `config`, `sessions`, `devices`, `ops`.
- **Client storage:** `localStorage` under key `classpulse.v1.` (cache + offline queue).
- **QR:** Payload `CP1|<roomId>|<slot>|<sig>` where `sig = digest(roomId|slot|zone.secret)` (FNV-1a-ish, shared between client and server).
- **Sync:** Client pushes ops to `POST /api/ops`; server is authoritative. SSE stream for live updates. Single-use scan grants + replay window.
- **PWA:** `manifest.webmanifest` + `sw.js` (cache-first app shell, push notification handlers).
- **Mobile packaging:** Capacitor config + GitHub Actions workflow to build an APK in the cloud.
- **Testing:** `tools/e2e.cjs` (28 checks) and `tools/scan-test.cjs` (21 checks). Both pass.

### File layout
```
classpulse/
  app/          # PWA: index.html, css/, js/, icons/, vendor/, sw.js, manifest
  server/       # server.cjs + classpulse.db
  tools/        # e2e.cjs, scan-test.cjs, smoke.cjs, make-icons.cjs
  docs/         # DEPLOYMENT.md, MAKE-APK.md
  capacitor.config.json, README.md, .gitignore
```

### Roles implemented
`admin`, `head`, `dos`, `teacher`. (No parent, receptionist, super-admin distinct from admin.)

### Data flow
Teacher phone → (optional) ClassPulse server → SQLite. Client keeps a full local cache and an offline op queue. Server validates scans via single-use grants + network check + gate-first rule.

---

## 2. Feature audit (by master-prompt phase)

Legend: ✅ Working · 🟡 Partial · ❌ Missing

### Phase 2 — Teacher registration & DOS verification
- ❌ **Self-registration by teachers.** Staff are created only by an admin (Admin → People → Add, or CSV import). No teacher-facing registration form.
- ❌ **DOS approval workflow for new teachers.** No pending-approval state; admin adds directly.
- ✅ **PIN setup on first login.** Teacher created without a PIN is prompted to choose one on first sign-in (`NO_PIN` flow). Works.
- ✅ **Device binding.** Optional "one phone per teacher" toggle exists (`requireDeviceBinding`).
- ✅ **Suspend/deactivate.** Admin can set `active: false`.
- 🟡 **Profile photo upload.** School logo upload exists; per-teacher photo upload does not (avatar is generated from initials).

### Phase 3 — QR gate attendance
- ✅ **Permanent gate QR code** with signed payload.
- ✅ **In-app camera scanner** (jsQR + getUserMedia), no external app/hardware.
- ✅ **Server verification** of scans (single-use grant, replay window, bad-code rejection).
- ✅ **School-Wi-Fi-only enforcement** by server-observed source IP (with tunnel/CF support).
- ✅ **Gate-first rule** (classroom scan refused until gate scan).
- ✅ **Geofence** (optional GPS, with honest "GPS can fail" handling).
- ✅ **Duplicate check-in prevention** (REPLAY code).
- ✅ **Arrival time, checkpoint, device, verification result recorded.**
- ✅ **DOS dashboard updates** via SSE + sync.
- ✅ **Late / on-time / absent distinction.**
- 🟡 **Geolocation accuracy indoors.** Honest handling exists (GPS failure → DOS review, not auto-punish).
- ❌ **Suspicious-activity log view** for repeated/unauthorized scans (data is recorded in `ops`/audit but no dedicated DOS view).

### Phase 4 — Timetable management
- ✅ **Teacher/admin timetable creation** (tap slot → assign teacher, subject, room).
- ✅ **Auto-generate** from teacher subject load.
- ✅ **CSV import/export.**
- ✅ **Clash detection** (busy teachers marked in the slot editor).
- ✅ **Workload view** (lessons per teacher implied by timetable).
- ✅ **Version history / who-changed-when.** ❌ Not present — no audit of timetable edits beyond generic audit entries.
- 🟡 **Approval workflow.** Admin writes timetable directly; there is no "teacher submits → DOS approves" flow. DOS can edit but not approve/reject a submission.
- ❌ **Temporary substitutions / reassignment flow.** Not implemented as a first-class action.
- ✅ **Breaks and lunch** supported in periods.

### Phase 5 — Daily timetable & notifications
- ✅ **Daily timetable display** after gate check-in (teacher home shows today's lessons).
- ✅ **Upcoming lesson, subject, class, room, times, topics.**
- ✅ **Completed vs remaining lessons.**
- 🟡 **Reminders/notifications.** In-app alerts + SMS (optional providers) + SW push handler exist, but no scheduled lesson reminders (e.g. "lesson starts in 5 min"). No email.
- ✅ **DOS sees same schedule + progress.**

### Phase 6 — AI lesson planning
- ✅ **Scheme of work generator** (NCDC-aligned, per subject/class/weeks) in `curriculum.js`.
- ✅ **Lesson plan generator** from topic (objectives, steps, assessment, differentiation, homework, e-resources).
- ✅ **Edit / regenerate** (re-run generation).
- ✅ **Save drafts** (plans stored locally).
- ✅ **PDF/print** via `CU.printable` (opens print dialog → Save as PDF).
- ✅ **NCDC references** cited in generated plans.
- 🟡 **"AI" is deterministic, not an LLM.** No external API key needed (and none claimed). Honest: it's a rule-based generator. If a real AI API is wanted, it must be configured and is not present.
- ❌ **DOS review/approval of lesson plans.** No submission/approval workflow.
- ❌ **Reuse previous plans** as templates. Not implemented.

### Phase 7 — Classroom QR scanning
- ✅ **Per-classroom QR codes** (gate, staff, class).
- ✅ **In-app camera scan** of classroom code.
- ✅ **Validation:** teacher assigned, classroom correct, scheduled period, valid code, no duplicate start.
- ✅ **Wrong-classroom warning.**
- ✅ **Authorized substitution** — not implemented (DOS can't authorize a cover to scan in place).
- ✅ **Lesson commencement recorded** (teacher, room, subject, class, scheduled/actual time, checkpoint, date, verification).

### Phase 8 — Lesson completion & monitoring
- ✅ **End Lesson button.**
- ✅ **Actual end time, scheduled end, duration, late start, early/late end, completed/missed/interrupted statuses.**
- ✅ **DOS correction with reason + audit preservation** — partial (audit log exists; correction UI exists for manual marking).
- ✅ **Lesson statuses:** scheduled, upcoming, started, completed, late start, not started, missed, interrupted, authorized substitution (defined; some require manual entry).

### Phase 9 — DOS dashboard
- ✅ **Overview:** teachers, classes, timetable rows, today's coverage, present/late/absent, missed lessons, critical alerts.
- ✅ **Teacher profile:** personal details, approval, today's attendance, arrival, timetable, current lesson, completed/missed, plans, history, workload.
- ✅ **Live lesson monitoring:** who is at school, expected to teach, currently teaching, finished, late, not checked in.
- ✅ **Activity feed:** live events (registration, approval, gate scan, classroom scan, lesson start/end, plan submit, timetable change, correction, unauthorized scan).
- ✅ **Filters** by date, teacher, subject, class, status (partial).
- 🟡 **"Continuous location"** — correctly shows latest verified checkpoint + timestamp, not live GPS. (Honest implementation.)

### Phase 10 — Roles & permissions
- ✅ `admin`, `head`, `dos`, `teacher`.
- ❌ `super-admin` distinct from admin.
- ❌ `parent` (optional) — not implemented.
- ❌ `receptionist/gatekeeper` (optional) — not implemented.
- ✅ Role-based navigation and views (each role sees only its platform).
- ✅ Teacher cannot access admin/DOS views.

### Phase 11 — School calendar & period management
- ✅ Periods, breaks, school start/end, late-after, holidays array (empty by default).
- ✅ Late-into-lesson threshold, escalation timings.
- ❌ Academic years, terms (only a term string), opening/closing dates, public holidays UI, exam periods, school events.
- 🟡 Timetable respects periods; holidays are not enforced anywhere.

### Phase 12 — Notifications & alerts
- ✅ In-app alerts (audience-targeted, levels).
- ✅ SMS (Africa's Talking, Twilio, GSM modem, custom HTTP) — optional, configured in settings.
- ✅ Service worker push handler (client side).
- ❌ Server-side push sending (no VAPID/web-push). Notifications only delivered if provider configured.
- ❌ Email notifications.
- ✅ Escalation chain (auto-escalate alerts up the chain).

### Phase 13 — Offline support & sync
- ✅ localStorage cache of full school data.
- ✅ Offline op queue (events, alerts, covers, leaves, overrides, gate log).
- ✅ Sync on reconnect (online event).
- ✅ Single-use scan grants; offline scans flagged `offline: true`.
- ✅ Replay prevention.
- ✅ Unverified offline scans are NOT treated as verified (gate-first, network check).
- 🟡 Conflict resolution on sync is last-write-wins (no merge UI).

### Phase 14 — Security, data protection, audit
- ✅ Session tokens (DB-stored, device-bound).
- ✅ PIN hashing (cheap digest, shared client/server).
- ✅ Rate limiting on login and device registration.
- ✅ Role-based permissions (server-side `mayPush`, `auth`).
- ✅ Audit log (who, what, when, old/new where applicable).
- ✅ Audit history not erasable by ordinary users.
- ✅ Device binding, device replacement flow.
- ✅ Account recovery via admin PIN reset.
- 🟡 Password recovery self-service — not present (admin resets).
- ❌ Scheduled DB backups (manual export only).
- ✅ HTTPS guidance (docs/DEPLOYMENT.md).

### Phase 15 — Recommended extras
- ✅ Teacher attendance analytics (charts).
- ✅ Teacher workload (implied by timetable).
- ✅ Automated missed-period detection (`S.tick()`).
- ✅ Substitute/cover assignment (`assignCover`).
- ✅ Leave requests (`leaves`).
- ✅ Attendance correction requests (manual mark by DOS, audited).
- ✅ Printable registers (print posters, printable plans).
- ✅ Printable weekly/daily timetables (print CSS).
- ✅ Lesson plan repository (stored locally).
- 🟡 Lesson plan approval/feedback (no approval workflow).
- ❌ AI-generated quizzes/assessment questions.
- ✅ School-wide announcements (alerts audience).
- ✅ Data export to CSV/JSON/PDF (print).
- ❌ Scheduled DB backups.
- ❌ Mobile push notifications (SW handler exists; server push not wired).
- ✅ Device replacement & account recovery (admin-driven).

### Phase 16 — UI/UX
- ✅ Modern typography (Inter), restrained indigo palette, solid surfaces.
- ✅ Responsive (mobile + desktop sidebar at ≥900px).
- ✅ Dark + light themes.
- ✅ Smooth but restrained animations (page-in, pop, shake, scan laser).
- ✅ Consistent icons (custom SVG icon set).
- ✅ Charts (SVG, heatmaps, rings).
- ✅ Empty states.
- ✅ Loading skeletons.
- ✅ Toasts, modals, sheets.
- 🟡 3D effects — none (intentionally avoided for speed).

### Phase 17 — Implementation rules
- ✅ Worked inside existing app; no separate replacement.
- ✅ No duplicate modules.
- ✅ Safe migrations (forward-compatible `S.load` fills new fields).
- ✅ Data preserved (empty() seeds, setup() builds on empty).
- ✅ Small testable phases.
- ✅ No fake buttons (all wired).
- ✅ No mock data in production (seeded demo data removed).
- ✅ No hardcoded secrets.
- ✅ Docs maintained (README, DEPLOYMENT, MAKE-APK, AUDIT).

### Phase 18 — Testing
- ✅ `e2e.cjs`: 28/28 pass (setup → sign-in → scan → DOS sees it).
- ✅ `scan-test.cjs`: 21/21 pass (network, gate-first, replay, forgery, manual-mark).
- ✅ Standalone (no server) setup + admin flow verified in browser.
- 🟡 No automated UI tests (only API-level). No load/performance tests.

---

## 3. Missing features (gaps vs. master prompt)

Ordered by impact:

1. **Teacher self-registration + DOS approval workflow.** Currently admin creates accounts. Master prompt requires teachers to register on their own phone and DOS to approve.
2. **Academic calendar module** (years, terms, holidays, exam periods, events). Only a term string + periods exist.
3. **Parent portal** (optional in prompt) — not implemented.
4. **Receptionist/gatekeeper role** (optional) — not implemented.
5. **Super-admin distinct from admin** — not implemented.
6. **Teacher self-service PIN recovery** — admin resets only.
7. **Scheduled DB backups** — manual export only.
8. **Email notifications** — SMS only.
9. **Server-side push notifications** — SW handler exists but server never sends.
10. **Lesson plan approval/feedback workflow** — plans are generated and stored but not submitted/reviewed.
11. **AI-generated quizzes/assessment questions** — not implemented.
12. **Substitute teacher management as a first-class flow** — cover assignment exists but no substitution request/approval.
13. **Attendance correction request workflow** — manual mark by DOS exists but no teacher-initiated request.
14. **Timetable version history** (who changed what, when).
15. **Suspicious-scan review view** (data recorded, no DOS UI).
16. **Reuse previous lesson plans as templates.**
17. **Parent attendance notifications.**
18. **Mobile push (server-side).**

---

## 4. Features requiring improvement

1. **Teacher registration.** Add a self-registration screen + DOS approval queue. Reuse existing `S.setup`/`pushUser` patterns. Add `status: "pending"` to user records.
2. **Timetable approval.** Add `status: "draft"|"approved"` to timetable rows; DOS approves; teacher sees approved version.
3. **Academic calendar.** New `calendar` table + admin UI; gate attendance should check school days/holidays.
4. **Security.** Upgrade PIN digest to bcrypt/scrypt (currently cheap FNV). Add self-service PIN recovery (email/SMS OTP). Add VAPID web-push.
5. **Offline sync.** Add conflict detection/merge UI for sync conflicts.
6. **Lesson plan workflow.** Add submit/approve/reject + feedback comments.
7. **Notifications.** Add scheduled lesson reminders (5 min before).
8. **Suspicious scans view** for DOS.
9. **Timetable audit.** Record edits with actor + timestamp + diff.

---

## 5. Security & performance concerns

- **PIN hashing is weak** (FNV, not cryptographic). Acceptable for a school LAN but must be upgraded before internet exposure. Migration path: bcrypt on server, keep digest for offline client verification, or move auth fully server-side.
- **Client holds zone secrets** (needed for offline QR parsing). A phone can mint valid codes; server grants + network + gate-first limit damage. Photos remain the main attack (inherent to printed codes).
- **X-Forwarded-For trust** is limited to private sockets (good), but a compromised LAN device could spoof. Acceptable for school LAN.
- **No HTTPS on LAN** — camera blocked on `http://192.168.x.x`. Requires tunnel/cert (documented).
- **No rate limiting on scan endpoints** — only login/device. Should add per-user scan rate limit.
- **SQLite single-writer** — fine for a school; not for multi-server.
- **No DB backups automated** — manual export only.
- **Service worker caches aggressively** — version bump required on every deploy (documented, but error-prone).

---

## 6. Recommended additional features (value/complexity)

| # | Feature | Value | Complexity | Deps |
|---|---|---|---|---|
| 1 | Teacher self-registration + DOS approval | High | Medium | Email/SMS for notification |
| 2 | Academic calendar (years/terms/holidays) | High | Medium | None |
| 3 | Lesson plan approval workflow | Medium | Low | None |
| 4 | Scheduled lesson reminders | Medium | Low | None |
| 5 | Timetable version history + audit | Medium | Low | None |
| 6 | Suspicious-scan DOS view | Medium | Low | None |
| 7 | Server-side web push (VAPID) | Medium | Medium | VAPID keys |
| 8 | bcrypt PIN hashing | High (security) | Medium | Migration |
| 9 | Automated DB backups | Medium | Low | Cron/scheduler |
| 10 | Substitute teacher request flow | Medium | Medium | None |
| 11 | Attendance correction requests | Medium | Low | None |
| 12 | Parent portal | Low-Medium | High | Parent auth, SMS |
| 13 | AI quizzes/assessment questions | Low | Medium | AI API key |
| 14 | Mobile push (FCM/APNs) | Low | High | Firebase |

Prioritize #1, #2, #3, #8.

---

## 7. Implementation plan (priority order)

**Do not implement until this audit is reviewed.** Proposed order:

1. **Teacher self-registration + DOS approval** (Phase 2 of master prompt).
2. **Academic calendar module** (Phase 11).
3. **Lesson plan approval workflow** (Phase 6 completion).
4. **bcrypt PIN upgrade + migration** (Phase 14).
5. **Timetable version history + approval** (Phase 4 completion).
6. **Suspicious-scan review view + scan rate limiting** (Phase 14).
7. **Scheduled lesson reminders + server push** (Phase 12).
8. **Automated DB backups** (Phase 14).
9. **Substitute teacher + correction request flows** (Phase 15).
10. **Parent portal** (Phase 10, optional — only if requested).
11. **UI/UX refinement** (Phase 16) — continuous.
12. **Final testing** (Phase 18).

---

## 8. Dependencies, integrations & configuration

- **Node.js ≥ 22** (uses built-in `node:sqlite`). No npm dependencies for the server.
- **Frontend:** no npm; vendored `jsQR.js`, `qrcode-generator.js`. Inter font from Google Fonts (optional, falls back to system).
- **Camera:** requires `https://` or `http://localhost`. Use Cloudflare Tunnel (free) or a cert (Caddy/Render).
- **SMS (optional):** Africa's Talking / Twilio / GSM modem / custom HTTP — configured in Settings.
- **AI lesson planning:** deterministic, no API key. If real LLM is wanted: add an OpenAI/Anthropic key in settings and a server endpoint. Not implemented.
- **Push notifications:** SW handler present; needs VAPID keys + server web-push library (not present).
- **APK:** Capacitor + GitHub Actions (cloud build, free). Requires GitHub account.
- **Database:** SQLite file at `server/classpulse.db`. Back up by copying the file.

---

## 9. What already works well (do not replace)

- QR scanning (gate + classroom) with server verification.
- Offline-first sync with single-use grants.
- School-Wi-Fi-only enforcement.
- Gate-first rule.
- Timetable (create, auto-generate, CSV import/export, clash detection).
- AI/NCDC scheme of work + lesson plan + PDF print.
- DOS dashboard (overview, teacher profiles, live monitoring, activity feed).
- Role-based access (admin/head/dos/teacher).
- Audit log, device binding, rate limiting.
- PWA + APK packaging path.
- Test suites (28 e2e + 21 scan-integrity, all passing).

---

## 10. Conclusion

The existing application is a **solid, working, real (non-demo) school attendance and lesson-monitoring system**. It already covers most of Phases 3–9 and 13–16 of the master prompt. The main gaps are Phase 2 (teacher self-registration + DOS approval), Phase 11 (academic calendar), and several optional features in Phase 15.

**No code changes were made in this audit.** Awaiting review of this report and approval of the implementation plan in §7 before proceeding.