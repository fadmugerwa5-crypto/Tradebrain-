# Academic modules (v1.5.0)

Added on top of the existing attendance / QR / timetable system. Nothing existing was removed.
The older "Marks" panel is kept (Admin → Academics → hidden route `marks`) but the new
**Tests & examinations** module replaces it for real use.

Everything here is plain code and database records. **No AI is needed for any of it.**

## Where things are

| Spec module | Where | Status |
|---|---|---|
| 1–3, 5, 6, 18, 19 Gate/classroom QR, late detection, lesson start/finish, timetable, QR security, offline | already in the app | unchanged |
| 4 Lesson reminders | `academic.js` `checkReminders`, Alerts tab | **Done, with one limit** (below) |
| 7 Lesson plans from the school syllabus | Academics → Lesson plans → *New plan from the school syllabus*; edit, print/PDF, submit | **Done**; the template is fixed (not configurable per school) |
| 7 Plan submission & DOS review | Academics → Lesson plans | **Done** (approve / return with comment, teacher notified) |
| 8 Syllabus & coverage | Academics → Syllabus & coverage | **Done** |
| 9 Tests, marks, approval, audit | Academics → Tests & examinations | **Done** |
| 10 Performance analysis | Academics → Performance analysis | **Done** |
| 11/12 Dashboards | widgets on DOS Pulse, Head Overview, Teacher Home | **Done** (added cards; existing screens untouched) |
| 13 Optional AI assistant | Academics → AI teaching assistant | **Done, off by default; not tested against the live Anthropic API** (tested against a local stand-in) |
| 14 Reports | Academics → Reports (11 reports; Print/PDF, Excel, CSV; date/teacher/subject/class/term filters) | **Done** |
| 15 Workload | Academics → Workload & timetable checks | **Done** |
| 16 Academic calendar | Calendar (now also for DOS/Head): terms, exam / meeting / deadline events | **Done** |
| 17 Roles | server-enforced (`acadIngest`) | **Done** |
| 20 Database | academic records ride the existing operation log; no schema change | **Done** |

## Rules worth knowing

* **Syllabus** is uploaded by the DOS (form or CSV: `Subject, Level, Term, Week, Topic, Subtopics, Objectives`).
  Coverage % = completed units ÷ total units × 100. A teacher must tick a confirmation to mark a topic
  completed, and must give a reason for "could not complete". *Expected progress* uses the term dates
  (Calendar → Terms): by the topic's week if every topic has one, otherwise by school days elapsed.
  A class/subject more than **15 points** behind raises one alert per week to the DOS and Head.
* **Marks**: a teacher creates a test for a class/subject they are timetabled for, enters marks
  (or `AB`), saves drafts, and submits. Submitted/approved results are **locked** for the teacher.
  The DOS approves, or returns with a note; changing approved marks requires a reason.
  Every change is written to a server-side audit trail (who, when, old → new, reason).
* **Grading** (pass mark, grade bands) and alert thresholds are set in Academics → Grading & rules.
* **Performance** uses approved results only (a switch includes submitted ones). Trend = least-squares
  change across a learner's results; improving/declining at ±5 points (configurable).
* **Class lists** (learners) are managed by the DOS (form or CSV `Name, Class, Admission No`).
  Teachers only receive lists for classes they teach.
* **Privacy**: other teachers' marks, learners of classes you do not teach, and the audit trail are never
  sent to a teacher's phone (checked by `tools/academic-test.cjs`).

## Known limits (please read)

1. **Reminders are produced by the app on the phone.** They fire while ClassPulse is open or running in
   the background, and show as a phone notification if the person allowed it. With the app fully closed
   nothing is sent, because that needs a push service (VAPID keys) that this build does not include.
2. **AI**: needs an API key entered by the administrator; it is stored on the server only. Untested live.
3. The lesson-plan **template is not configurable** per school yet (sections are fixed).
4. Offline: academic records are queued and synchronised like other records. If the server refuses one
   (e.g. a locked assessment), the person is told and the work stays on the phone, flagged.
5. A teacher's phone clock cannot change recorded times of academic changes: the server stamps them.

## Tests

```
node tools/logic-test.cjs      # 89 checks: grades, stats, coverage, performance, workload, reminders, reports, xlsx
node tools/academic-test.cjs   # 63 checks against a real server: permissions, locking, audit, visibility, restart, AI isolation
node tools/scan-test.cjs       # original scan rules (21)
node server/server.cjs --port 8788 --quiet --db server/test.db &  node tools/e2e.cjs http://localhost:8788   # original (37)
python3 tools/ui-test.py       # 35 checks driving the real screens in a browser (needs playwright)
```
(`tools/smoke.cjs` expects a school that is already set up on port 8787.)

## Two existing bugs fixed on the way

* `CP.prompt` always returned nothing (the dialog closed before answering), so every prompt-based
  action — e.g. adding holidays — silently did nothing.
* The DOS "Coverage" teacher ranking showed `NaN` / `undefined missed`.
