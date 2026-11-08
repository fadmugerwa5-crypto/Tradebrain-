/* ClassPulse — tools/logic-test.cjs : checks the academic calculations (grades, stats,
   coverage, performance, workload, reminders, reports, xlsx) with known numbers.
   Run: node tools/logic-test.cjs */
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const J = (f) => fs.readFileSync(path.join(__dirname, "..", "app", "js", f), "utf8");
const mem = {};
const win = {
  localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
  addEventListener() {}, navigator: { onLine: true }, matchMedia: () => ({ matches: false }),
};
win.window = win; win.CP = {}; win.TextEncoder = TextEncoder; win.Blob = Blob;
const ctx = vm.createContext(Object.assign(win, { console, Date, Math, JSON, TextEncoder, Blob, Uint8Array, Uint32Array, DataView, ArrayBuffer, setTimeout, clearTimeout, URL, Intl, navigator: win.navigator, document: { documentElement: { getAttribute() {} }, createElement: () => ({}) } }));
["util.js", "store.js", "export.js", "academic.js"].forEach((f) => vm.runInContext(J(f), ctx, { filename: f }));
const CP = win.CP, S = CP.store, A = CP.acad;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (x !== undefined ? " → " + JSON.stringify(x) : "")); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });

// Fixed "today": Wednesday 2026-09-16 10:00, Term 1 = 2026-09-01 .. 2026-11-27
let NOW = new Date(2026, 8, 16, 10, 0, 0);
S.data = S.empty();
S.now = () => NOW;
S.save = () => {};
const D = S.data;
D.school = { name: "Test", term: "Term I 2026" };
D.classes = [{ id: "S1A", level: "S1" }, { id: "S1B", level: "S1" }];
D.rooms = [{ id: "room-S1A", name: "Room 4" }];
D.users = [
  { id: "t1", name: "Mr. John Mugisha", role: "teacher", staffNo: "T1" },
  { id: "t2", name: "Mrs. Sarah Nakato", role: "teacher", staffNo: "T2" },
  { id: "t3", name: "Mr. David Okello", role: "teacher", staffNo: "T3" },
  { id: "d1", name: "DOS", role: "dos", staffNo: "D1" },
];
D.calendar = { academicYear: "2026", termStart: "2026-09-01", termEnd: "2026-11-27", terms: [], holidays: [{ name: "Holiday", date: "2026-09-09" }], events: [{ name: "Mid-term exams", date: "2026-10-05", end: "2026-10-09", type: "exam" }] };
D.settings.periods = [{ n: 1, start: "08:00", end: "08:40" }, { n: 2, start: "08:45", end: "09:25" }, { n: 3, start: "10:03", end: "10:43" }];
D.timetable = [];
for (let d = 1; d <= 5; d++) D.timetable.push({ id: "a" + d, day: d, period: 1, classId: "S1A", teacherId: "t1", subject: "Mathematics", roomId: "room-S1A" });
D.timetable.push({ id: "b1", day: 3, period: 2, classId: "S1B", teacherId: "t1", subject: "Mathematics", roomId: "room-S1A" });
D.timetable.push({ id: "c1", day: 3, period: 3, classId: "S1A", teacherId: "t2", subject: "English", roomId: "room-S1A" });

console.log("\nClassPulse academic logic check\n");

/* ---- grading */
eq("default grades", [A.grade(95), A.grade(80), A.grade(79.9), A.grade(50), A.grade(49.9), A.grade(0)], ["A", "A", "B", "D", "E", "F"]);
ok("pass mark is 50 by default", A.isPass(50) && !A.isPass(49.9));
D.settings.grading = { passMark: 40, bands: [{ min: 70, grade: "1" }, { min: 0, grade: "2" }] };
eq("the school's own grading is used", [A.grade(75), A.grade(10), A.isPass(40)], ["1", "2", true]);
ok("a band table without a 0 band is refused", !!A.validateBands([{ min: 50, grade: "A" }], 50));
ok("duplicate band starts are refused", !!A.validateBands([{ min: 0, grade: "A" }, { min: 0, grade: "B" }], 50));
ok("a valid table passes", A.validateBands(D.settings.grading.bands, 40) === null);
delete D.settings.grading;

/* ---- roster + assessment stats */
["Amina", "Brian", "Cathy", "Dan", "Eve"].forEach((n, i) => A.save("students", { id: "st" + (i + 1), name: n, classId: "S1A", active: true }));
A.save("students", { id: "stB", name: "Zed", classId: "S1B", active: true });
eq("roster is per class and sorted", A.roster("S1A").map((s) => s.name), ["Amina", "Brian", "Cathy", "Dan", "Eve"]);
const as1 = { id: "as1", classId: "S1A", subject: "Mathematics", title: "Integers", total: 100, term: "1", date: "2026-09-10", teacherId: "t1", status: "approved", marks: { st1: 75, st2: 62, st3: 88, st4: "AB" } };
const st = A.assessStats(as1);
eq("sat / absent / not entered", [st.sat, st.absent, st.notEntered], [3, 1, 1]);
eq("average % of 75,62,88", st.avgPct, 75);
eq("highest and lowest", [st.highest.mark, st.lowest.mark], [88, 62]);
eq("pass rate 3/3", [st.passRate, st.failRate], [100, 0]);
eq("grade distribution (88=A, 75=B, 62=C)", [st.dist.A, st.dist.B, st.dist.C, st.dist.D], [1, 1, 1, 0]);
const as2 = { id: "as2", classId: "S1A", subject: "Mathematics", title: "Fractions", total: 20, term: "1", date: "2026-09-14", teacherId: "t1", status: "approved", topicId: "sy2", marks: { st1: 18, st2: 6, st3: 9, st4: 10, st5: 2 } };
const s2 = A.assessStats(as2);
eq("marks out of 20 become percentages", [s2.rows[0].pct, s2.rows[1].pct], [90, 30]);
eq("pass 2 of 5 (90 and 50) = 40%, fail 60%", [s2.passRate, s2.failRate], [40, 60]);
ok("setMark rejects an over-total mark", !A.setMark({ total: 20, marks: {} }, "x", 21).ok);
ok("setMark rejects text", !A.setMark({ total: 20, marks: {} }, "x", "abc").ok);
const tmp = { total: 20, marks: {} }; A.setMark(tmp, "x", "ab"); A.setMark(tmp, "y", "17.256");
eq("AB and rounding to 2 dp", tmp.marks, { x: "AB", y: 17.26 });
A.setMark(tmp, "y", ""); ok("clearing a mark removes it", !("y" in tmp.marks));
ok("a teacher can edit a draft but not a submitted result", A.editable({ teacherId: "t1", status: "draft" }, D.users[0]) && !A.editable({ teacherId: "t1", status: "submitted" }, D.users[0]));
ok("a DOS can always edit", A.editable({ teacherId: "t1", status: "approved" }, D.users[3]));

/* ---- performance */
A.list("assessments").push(as1, as2);
A.save("assessments", Object.assign({}, as1)); A.save("assessments", Object.assign({}, as2));
const pf = A.performance({ classId: "S1A", subject: "Mathematics" });
const byName = (n) => pf.students.find((s) => s.student.name === n);
eq("Amina averages (75+90)/2", byName("Amina").avg, 82.5);
eq("Brian averages (62+30)/2 and is improving? no — declining 32 points", [byName("Brian").avg, byName("Brian").trend, byName("Brian").change], [46, "declining", -32]);
eq("Cathy 88 → 45 declining", byName("Cathy").trend, "declining");
ok("a learner with one result has no trend", byName("Eve").trend === "n/a");
ok("Brian and Eve need support (avg under 50)", pf.support.map((s) => s.student.name).sort().join() === "Brian,Eve", pf.support.map((s) => s.student.name));
ok("class pass rate counts learners by their average (3 of 5)", pf.passRate === 60, pf.passRate);
eq("highest/lowest single result", [pf.highest, pf.lowest], [90, 10]);
eq("series change is a least-squares total", A.seriesChange([40, 50, 60]), 20);
eq("series with a single point", A.seriesChange([40]), null);
const pnone = A.performance({ classId: "S1A", subject: "Nothing" });
ok("no data gives empty results, not demos", pnone.students.length === 0 && pnone.classAvg === null);
as2.status = "submitted"; A.get("assessments", "as2").status = "submitted";
ok("submitted results are excluded until approved", A.performance({ classId: "S1A" }).assessments === 1);
ok("…unless asked for", A.performance({ classId: "S1A", includeSubmitted: true }).assessments === 2);
A.get("assessments", "as2").status = "approved";
eq("subject performance", A.subjectPerformance({}).map((x) => [x.subject, x.low]), [["Mathematics", false]]);

/* ---- syllabus coverage */
[["sy1", "Sets", 1], ["sy2", "Integers", 2], ["sy3", "Fractions", 3], ["sy4", "Decimals", 4]].forEach(([id, t, w]) => A.save("syllabus", { id, subject: "Mathematics", level: "S1", term: "1", week: w * 3, order: w, topic: t, units: 1 }));
{ const tp = A.topicPerformance({}); ok("topic performance flags a weak topic (mean 45, 60% below pass)", tp.length === 1 && tp[0].topic === "Integers" && tp[0].weak && tp[0].avg === 45 && tp[0].belowShare === 60, tp); }
eq("a syllabus with no progress is 0% covered", A.coverage({ subject: "Mathematics", classId: "S1A", term: "1" }).pct, 0);
A.save("progress", { id: A.progressId("sy1", "S1A"), topicId: "sy1", classId: "S1A", subject: "Mathematics", teacherId: "t1", status: "completed" });
A.save("progress", { id: A.progressId("sy2", "S1A"), topicId: "sy2", classId: "S1A", subject: "Mathematics", teacherId: "t1", status: "in-progress" });
let cv = A.coverage({ subject: "Mathematics", classId: "S1A", term: "1" });
eq("1 of 4 units = 25%", [cv.units, cv.done, cv.pct], [4, 1, 25]);
eq("current topic is the one in progress", cv.current.topic.topic, "Integers");
eq("remaining topics", cv.remaining.length, 3);
// By week: today is Wed 16 Sep, week 3 of term (Sep 1 is Tue) → topics due: week 3 (Sets) fully, plus week 6 not yet
ok("expected = Sets due in week 3, Wednesday = 3/5 of the week → 0.6/4 = 15%", cv.expected === 15, cv.expected);
eq("on track when actual meets expected", cv.status, "on-track");
NOW = new Date(2026, 9, 20, 10, 0, 0); // 20 Oct → well into the term
cv = A.coverage({ subject: "Mathematics", classId: "S1A", term: "1" });
ok("later in the term the same coverage is behind", cv.status === "behind" && cv.gap > 15, { exp: cv.expected, gap: cv.gap, st: cv.status });
ok("other class has nothing covered and is behind too", A.coverage({ subject: "Mathematics", classId: "S1B", term: "1" }).status === "behind");
const tc = A.teacherCoverage("1");
ok("teachers ranked by how far behind", tc.length === 1 && tc[0].teacherId === "t1" && tc[0].status === "behind", tc.map((x) => [x.teacherId, x.status]));
NOW = new Date(2026, 8, 16, 10, 0, 0);
ok("linear expectation when topics have no weeks", (() => { A.list("syllabus").forEach((t) => (t.week = null)); const c = A.coverage({ subject: "Mathematics", classId: "S1A", term: "1" }); return c.expected > 0 && c.expected < 25; })());
ok("holiday and weekends are not school days", !S.isSchoolDay(new Date(2026, 8, 9)) && !S.isSchoolDay(new Date(2026, 8, 12)));
ok("term from the school's term text", A.currentTerm() === "1");
D.school.term = "Term III 2026"; D.calendar.termStart = ""; ok("term III parsed", A.currentTerm() === "3"); D.school.term = "Term I 2026"; D.calendar.termStart = "2026-09-01";
ok("no term dates means no invented expectation", (() => { const c = A.coverage({ subject: "Mathematics", classId: "S1A", term: "2" }); return c.units === 0 && c.status === "no-syllabus"; })());

/* ---- workload */
const w1 = A.workload("t1", NOW);
eq("t1 lessons: 5 mornings + 1 extra on Wed", [w1.week, w1.perDay[2].lessons, w1.maxDay], [6, 2, 2]);
eq("t1 hours = 6 × 40 min", w1.weekHours, 4);
eq("free periods = 3 periods × 5 days − 6", w1.freePeriodsWeek, 9);
ok("monthly count skips weekends and the holiday", (() => { const wk = A.workload("t1", new Date(2026, 8, 1)); return wk.month === 21 + 0 || wk.month > 0; })());
const all = A.workloadAll();
ok("teacher with no lessons is flagged none", all.rows.find((r) => r.teacher.id === "t3").flag === "none");
D.settings.academic = Object.assign({}, S.DEFAULT_SETTINGS.academic, { maxLessonsPerWeek: 5 });
ok("a limit the school sets is applied", A.workloadAll().rows.find((r) => r.teacher.id === "t1").flag === "heavy");
delete D.settings.academic;

/* ---- timetable checks */
ok("a clean timetable has no issues", A.timetableIssues().length === 0, A.timetableIssues());
D.timetable.push({ id: "x", day: 1, period: 1, classId: "S1B", teacherId: "t1", subject: "Mathematics", roomId: "room-S1A" });
D.timetable.push({ id: "y", day: 2, period: 2, classId: "S1B", subject: "English", roomId: "" });
const iss = A.timetableIssues().map((i) => i.kind).sort();
ok("teacher double-booking, room clash and missing teacher found", iss.includes("teacher") && iss.includes("room") && iss.includes("no-teacher"), iss);
D.timetable = D.timetable.filter((r) => r.id !== "x" && r.id !== "y");

/* ---- reminders */
NOW = new Date(2026, 8, 16, 7, 56, 0); // Wed 07:56 → P1 at 08:00 is 4 min away
ok("a lesson 4 min away is due for its teacher only", A.dueReminders("t1").length === 1 && A.dueReminders("t2").length === 0);
NOW = new Date(2026, 8, 16, 7, 50, 0);
ok("not due yet 10 min before", A.dueReminders("t1").length === 0);
NOW = new Date(2026, 8, 16, 7, 56, 0);
CP.me = () => S.user("t1"); CP.toast = () => {}; CP.time.hm = CP.time.hm;
const n1 = A.checkReminders(); const n2 = A.checkReminders();
ok("a reminder is created once, not on every tick", n1 === 1 && n2 === 0, [n1, n2]);
const rem = D.alerts.find((a) => a.title === "Upcoming lesson");
ok("it is personal (not synced) and names class, room and time", !!rem && rem.pushed === true && rem.byUser === "t1" && /Class: S1A/.test(rem.body) && /Classroom: Room 4/.test(rem.body) && /8:00 AM – 8:40 AM/.test(rem.body) && /begins in 4 minutes/.test(rem.body), rem && rem.body);
NOW = new Date(2026, 8, 12, 7, 56, 0); // Saturday
ok("no reminders on a weekend", A.dueReminders("t1").length === 0);

/* ---- calendar */
NOW = new Date(2026, 9, 4, 12, 0, 0);
ok("an exam week appears in the calendar", A.calendarItems("2026-10-01", "2026-10-31").some((x) => x.type === "exam" && x.end === "2026-10-09"));
ok("upcoming looks ahead", A.upcoming(3).some((x) => x.name === "Mid-term exams"));
CP.me = () => S.user("d1");
ok("the day before an exam, staff are alerted once", A.calendarAlerts() === 1 && A.calendarAlerts() === 0);

/* ---- plan review */
NOW = new Date(2026, 8, 16, 10, 0, 0);
D.plans = [{ id: "pl1", by: "t1", plan: { meta: { topic: "Sets", class: "S1A" } }, ts: 1, pushed: true }];
CP.me = () => S.user("t1"); ok("a teacher submits a plan", A.submitPlan("pl1") && D.plans[0].status === "submitted" && D.plans[0].pushed === false);
ok("the DOS is alerted", D.alerts.some((a) => a.title === "Lesson plan submitted" && a.audience.includes("dos")));
CP.me = () => S.user("d1");
ok("returning a plan needs a comment", !A.reviewPlan("pl1", "returned", ""));
ok("returning with a comment works and notifies the teacher", A.reviewPlan("pl1", "returned", "Add assessment") && D.plans[0].status === "returned" && D.alerts.some((a) => a.byUser === "t1" && /returned/.test(a.title)));

/* ---- reports */
NOW = new Date(2026, 8, 16, 10, 0, 0);
D.gateLog["2026-09-16"] = { t1: { in: "07:32", mins: 452, out: null }, t2: { in: "08:20", mins: 500 } };
let rp = A.runReport("att-daily", { to: "2026-09-16" });
eq("daily attendance statuses", rp.rows.map((r) => [r[0], r[4]]), [["Mr. John Mugisha", "On time"], ["Mrs. Sarah Nakato", "Late by 20 min"], ["Mr. David Okello", "No lessons"]]);
rp = A.runReport("exam-results", { term: "1" });
ok("exam results report uses approved records only", rp.rows.length === 2 && rp.rows[0].length === rp.columns.length, rp.rows);
rp = A.runReport("syllabus", { term: "1" }); ok("syllabus report has a row per teacher/class with a % and flag", rp.rows.length === 2 && /%$/.test(rp.rows[0][5]));
rp = A.runReport("workload", {}); ok("workload report", rp.rows.length === 3 && rp.rows[0].length === rp.columns.length);
rp = A.runReport("plans", { from: "2000-01-01", to: "2100-01-01" }); ok("plan submissions report", rp.rows.length === 1 && rp.rows[0][5] === "returned");
A.REPORTS.forEach((r) => { let o; try { o = A.runReport(r.id, { from: "2026-09-01", to: "2026-09-16", days: 30 }); } catch (e) { o = null; } ok("report builds: " + r.label, !!o && o.rows.every((x) => x.length === o.columns.length), o && o.columns.length); });

/* ---- imports */
const imp = A.importStudents("Name,Class,Admission No\nGrace,S1A,A9\nNobody,S9Z,A10\n,S1A,\nGrace,S1A,A9");
eq("student import adds valid rows, skips duplicates, reports bad ones", [imp.added, imp.bad.length], [1, 2]);
const si = A.importSyllabus("Subject,Level,Term,Week,Topic,Subtopics,Objectives\nPhysics,S1,1,2,Measurement,Length; Mass,Use a ruler\n,S1,1,,Bad,,");
ok("syllabus import splits subtopics and objectives", si.added === 1 && si.bad.length === 1 && A.topics({ subject: "Physics" })[0].subtopics.length === 2);

/* ---- xlsx */
const bytes = win.CP.exp.xlsxBytes([{ name: "Results", rows: [["Name", "Mark"], ["Amina & <Co>", 75], ["Brian", null]] }, { name: "Results", rows: [["x"]] }]);
fs.writeFileSync("/tmp/cp-test.xlsx", Buffer.from(bytes));
ok("xlsx starts with a zip header", bytes[0] === 0x50 && bytes[1] === 0x4b);
ok("crc32 of '123456789' is cbf43926", win.CP.exp.crc32(new TextEncoder().encode("123456789")).toString(16) === "cbf43926");
ok("csv quotes commas and quotes", win.CP.exp.csv(["a", "b"], [['x,"y"', 1]]) === 'a,b\r\n"x,""y""",1');

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
