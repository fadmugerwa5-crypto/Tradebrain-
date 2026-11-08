/* ==========================================================================
   ClassPulse — academic.js : the academic rules, in plain code.
   Syllabus coverage, grading, assessment statistics, performance analysis,
   workload, lesson reminders, plan review and reports.
   Everything here is arithmetic over the school's own records. No AI, no
   network, nothing invented: with no data you get empty results, not demos.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const A = (CP.acad = {});
  const COLS = ["students", "syllabus", "progress", "assessments", "markaudit"];
  const r1 = (n) => Math.round(n * 10) / 10;
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  /* ------------------------------------------------------------- storage */
  A.ensure = function () {
    const a = (S.data.acad = S.data.acad || {});
    COLS.concat(["deletes"]).forEach((c) => { if (!Array.isArray(a[c])) a[c] = []; });
    S.data.reminded = S.data.reminded || {};
    return a;
  };
  A.list = (col) => A.ensure()[col];
  A.get = (col, id) => A.list(col).find((x) => x.id === id) || null;

  // Save locally first; the sync layer sends it and the server has the last word.
  A.save = function (col, rec) {
    const list = A.list(col);
    rec.col = col;
    rec.syncId = CP.uid("op");
    rec.pushed = false;
    delete rec.origin; delete rec.rejected;
    rec.ts = S.now().getTime();
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = Object.assign(list[i], rec); else list.unshift(rec);
    const saved = list.find((x) => x.id === rec.id);
    // A local edit must be sent even if the record first arrived from the server.
    delete saved.origin; delete saved.rejected;
    S.save();
    S.emit("acad", saved);
    return saved;
  };
  A.remove = function (col, id) {
    const a = A.ensure();
    const rec = A.get(col, id);
    a[col] = a[col].filter((x) => x.id !== id);
    if (rec && rec.pushed) a.deletes.push({ col, id, syncId: CP.uid("op"), deleted: true, pushed: false });
    S.save();
    S.emit("acad");
  };

  /* ------------------------------------------------------------- rules */
  A.rules = function () {
    const st = S.data.settings || {};
    const D = S.DEFAULT_SETTINGS;
    return {
      grading: Object.assign({}, D.grading, st.grading || {}),
      academic: Object.assign({}, D.academic, st.academic || {}),
    };
  };
  A.passMark = () => Number(A.rules().grading.passMark) || 50;
  A.bands = function () {
    const b = (A.rules().grading.bands || []).slice();
    return b.sort((x, y) => y.min - x.min);
  };
  A.grade = function (pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return "";
    const b = A.bands().find((x) => pct >= x.min);
    return b ? b.grade : "";
  };
  A.isPass = (pct) => pct >= A.passMark();
  A.markPct = (mark, total) => (total > 0 ? r1((mark / total) * 100) : 0);
  // Validate a band table typed by an administrator.
  A.validateBands = function (bands, passMark) {
    if (!Array.isArray(bands) || !bands.length) return "Add at least one grade.";
    const seen = new Set();
    for (const b of bands) {
      if (!b.grade || !String(b.grade).trim()) return "Every band needs a grade letter.";
      if (!isFinite(b.min) || b.min < 0 || b.min > 100) return "Band minimums must be between 0 and 100.";
      if (seen.has(b.min)) return "Two bands start at the same mark.";
      seen.add(b.min);
    }
    if (!seen.has(0)) return "One band must start at 0 so every mark gets a grade.";
    if (!isFinite(passMark) || passMark < 1 || passMark > 100) return "Pass mark must be between 1 and 100.";
    return null;
  };

  /* ------------------------------------------------------------- roster */
  A.roster = (classId) =>
    A.list("students").filter((s) => s.classId === classId && s.active !== false)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  /* ----------------------------------------------- assessment statistics */
  A.assessStats = function (as) {
    const roster = A.roster(as.classId);
    const marks = as.marks || {};
    const rows = roster.map((st) => {
      const v = marks[st.id];
      const has = typeof v === "number";
      const absent = v === "AB";
      const pct = has ? A.markPct(v, as.total) : null;
      return { student: st, mark: has ? v : null, absent, entered: has || absent, pct, grade: has ? A.grade(pct) : absent ? "AB" : "" };
    });
    const sat = rows.filter((r) => r.pct !== null);
    const passed = sat.filter((r) => A.isPass(r.pct)).length;
    const hi = sat.reduce((m, r) => (!m || r.mark > m.mark ? r : m), null);
    const lo = sat.reduce((m, r) => (!m || r.mark < m.mark ? r : m), null);
    const dist = {};
    A.bands().forEach((b) => (dist[b.grade] = 0));
    sat.forEach((r) => { dist[r.grade] = (dist[r.grade] || 0) + 1; });
    return {
      rows, roster: roster.length, sat: sat.length,
      absent: rows.filter((r) => r.absent).length,
      notEntered: rows.filter((r) => !r.entered).length,
      totalMarks: r1(sat.reduce((a, r) => a + r.mark, 0)),
      avgMark: sat.length ? r1(mean(sat.map((r) => r.mark))) : null,
      avgPct: sat.length ? r1(mean(sat.map((r) => r.pct))) : null,
      highest: hi, lowest: lo,
      passed, failed: sat.length - passed,
      passRate: sat.length ? r1((passed / sat.length) * 100) : null,
      failRate: sat.length ? r1(((sat.length - passed) / sat.length) * 100) : null,
      dist,
    };
  };

  /* ------------------------------------------------------------- terms */
  const WORDS = { one: "1", two: "2", three: "3", i: "1", ii: "2", iii: "3", "1": "1", "2": "2", "3": "3" };
  A.currentTerm = function (asOf) {
    const cal = S.data.calendar || {};
    const k = CP.time.dayKey(asOf || S.now());
    const hit = (cal.terms || []).find((t) => t.start && t.end && k >= t.start && k <= t.end);
    if (hit) return String(hit.n);
    const m = /\b(iii|ii|i|one|two|three|1|2|3)\b/i.exec(String((S.data.school || {}).term || ""));
    return m ? WORDS[m[1].toLowerCase()] : "1";
  };
  A.termWindow = function (term) {
    const cal = S.data.calendar || {};
    const t = (cal.terms || []).find((x) => String(x.n) === String(term));
    if (t && t.start && t.end) return { start: t.start, end: t.end };
    if (cal.termStart && cal.termEnd && String(term) === A.currentTerm()) return { start: cal.termStart, end: cal.termEnd };
    return null;
  };
  function schoolDaysBetween(startKey, endKey) {
    let n = 0;
    const d = S.parseKey(startKey), end = S.parseKey(endKey);
    for (; d <= end; d.setDate(d.getDate() + 1)) if (S.isSchoolDay(d)) n++;
    return n;
  }
  A.schoolDaysBetween = schoolDaysBetween;

  /* ----------------------------------------------------------- syllabus */
  A.topics = function (f) {
    f = f || {};
    return A.list("syllabus").filter((t) =>
      (!f.subject || t.subject === f.subject) && (!f.level || t.level === f.level) && (!f.term || String(t.term) === String(f.term)))
      .sort((a, b) => (Number(a.term) - Number(b.term)) || ((a.order || 0) - (b.order || 0)) || ((a.week || 99) - (b.week || 99)) || String(a.topic).localeCompare(b.topic));
  };
  A.progressId = (topicId, classId) => "pg|" + topicId + "|" + classId;
  A.progressOf = (topicId, classId) => A.get("progress", A.progressId(topicId, classId));
  A.statusOf = (topicId, classId) => { const p = A.progressOf(topicId, classId); return p ? p.status : "not-started"; };

  // Expected % of the syllabus that should be done by now.
  A.expected = function (topics, term, asOf) {
    const w = A.termWindow(term);
    if (!w || !topics.length) return null;
    const today = CP.time.dayKey(asOf || S.now());
    if (today < w.start) return 0;
    if (today > w.end) return 100;
    const total = schoolDaysBetween(w.start, w.end);
    const elapsed = schoolDaysBetween(w.start, today);
    if (!total) return null;
    const units = topics.reduce((a, t) => a + (t.units || 1), 0);
    if (topics.every((t) => t.week)) {
      const dayN = Math.floor((S.parseKey(today) - S.parseKey(w.start)) / 864e5);
      const curWeek = Math.floor(dayN / 7) + 1;
      const wd = S.parseKey(today).getDay();
      const frac = wd === 0 || wd === 6 ? 1 : wd / 5;
      let due = 0;
      topics.forEach((t) => { if (t.week < curWeek) due += t.units || 1; else if (t.week === curWeek) due += (t.units || 1) * frac; });
      return r1(Math.min(100, (due / units) * 100));
    }
    return r1(Math.min(100, (elapsed / total) * 100));
  };

  A.coverage = function (o) {
    const level = S.classInfo(o.classId).level;
    const topics = A.topics({ subject: o.subject, level, term: o.term });
    let units = 0, done = 0, prog = 0;
    const items = topics.map((t) => {
      const u = t.units || 1;
      const p = A.progressOf(t.id, o.classId);
      const status = p ? p.status : "not-started";
      units += u;
      if (status === "completed") done += u; else if (status === "in-progress") prog += u;
      return { topic: t, status, progress: p };
    });
    const pct = units ? r1((done / units) * 100) : 0;
    const exp = A.expected(topics, o.term, o.asOf);
    const gap = exp === null ? null : r1(exp - pct);
    const R = A.rules().academic;
    const status = !units ? "no-syllabus" : exp === null ? "unknown" : gap > R.behindPct ? "behind" : gap < -R.aheadPct ? "ahead" : "on-track";
    const remaining = items.filter((x) => x.status !== "completed");
    const current = items.find((x) => x.status === "in-progress") || remaining.find((x) => x.status === "not-started") || null;
    return {
      subject: o.subject, classId: o.classId, level, term: o.term,
      units, done, inProgress: prog, pct, expected: exp, gap, status,
      items, remaining, current,
      covered: items.filter((x) => x.status === "completed"),
      notCompleted: items.filter((x) => x.status === "not-completed"),
    };
  };

  // One row per (teacher, class, subject) in the real timetable.
  A.coverageRows = function (term) {
    term = term || A.currentTerm();
    const seen = new Set();
    const out = [];
    (S.data.timetable || []).forEach((r) => {
      if (!r.teacherId || !r.subject) return;
      const k = r.teacherId + "|" + r.classId + "|" + r.subject;
      if (seen.has(k)) return;
      seen.add(k);
      const c = A.coverage({ subject: r.subject, classId: r.classId, term });
      if (!c.units) return;
      const t = S.user(r.teacherId);
      out.push(Object.assign(c, { teacherId: r.teacherId, teacherName: t ? t.name : "—" }));
    });
    return out;
  };
  A.teacherCoverage = function (term) {
    const rows = A.coverageRows(term);
    const by = {};
    rows.forEach((r) => { (by[r.teacherId] = by[r.teacherId] || []).push(r); });
    const R = A.rules().academic;
    return Object.keys(by).map((id) => {
      const rs = by[id];
      const units = rs.reduce((a, r) => a + r.units, 0);
      const done = rs.reduce((a, r) => a + r.done, 0);
      const pct = r1((done / units) * 100);
      const withExp = rs.filter((r) => r.expected !== null);
      const exp = withExp.length ? r1(mean(withExp.map((r) => r.expected))) : null;
      const gap = exp === null ? null : r1(exp - pct);
      return { teacherId: id, teacherName: rs[0].teacherName, rows: rs, units, done, pct, expected: exp, gap,
        status: exp === null ? "unknown" : gap > R.behindPct ? "behind" : gap < -R.aheadPct ? "ahead" : "on-track" };
    }).sort((a, b) => (b.gap || 0) - (a.gap || 0));
  };
  A.groupCoverage = function (key, term) {
    const rows = A.coverageRows(term);
    const by = {};
    rows.forEach((r) => { (by[r[key]] = by[r[key]] || []).push(r); });
    return Object.keys(by).sort().map((k) => {
      const rs = by[k];
      const units = rs.reduce((a, r) => a + r.units, 0);
      const done = rs.reduce((a, r) => a + r.done, 0);
      return { key: k, units, done, pct: r1((done / units) * 100) };
    });
  };

  // Leaders' devices raise one alert per class/subject per week.
  A.syllabusAlerts = function () {
    const me = CP.me && CP.me();
    if (!me || !["dos", "head", "admin"].includes(me.role)) return 0;
    const wk = CP.time.dayKey(CP.time.weekStart(S.now()));
    let n = 0;
    A.coverageRows().forEach((r) => {
      if (r.status !== "behind") return;
      const id = "al-syl-" + r.classId + "-" + r.subject.replace(/\W+/g, "") + "-" + wk;
      if (S.data.alerts.some((a) => a.id === id)) return;
      S.pushAlert({
        id, level: "warn", audience: ["dos", "head"],
        title: "Syllabus behind schedule",
        body: `${r.teacherName} · ${r.subject} ${r.classId}: ${r.pct}% covered, about ${r.expected}% expected by now.`,
        ref: { userId: r.teacherId },
      });
      n++;
    });
    return n;
  };

  /* --------------------------------------------------------- plan review */
  A.plansFor = (userId) => (S.data.plans || []).filter((p) => p.by === userId);
  A.planStatus = (p) => p.status || "draft";
  A.submitPlan = function (id) {
    const p = (S.data.plans || []).find((x) => x.id === id);
    const me = CP.me();
    if (!p || !me) return false;
    p.status = "submitted"; p.submittedAt = S.now().getTime(); p.teacherId = me.id;
    p.review = null; p.pushed = false; delete p.origin;
    S.save(true);
    S.emit("plan", p);
    const m = p.plan && p.plan.meta ? p.plan.meta : {};
    S.pushAlert({
      level: "info", audience: ["dos"], title: "Lesson plan submitted",
      body: `${me.name} submitted “${m.topic || "a lesson plan"}”${m.class ? " (" + m.class + ")" : ""} for review.`,
      ref: { userId: me.id },
    });
    return true;
  };
  A.reviewPlan = function (id, decision, comment) {
    const p = (S.data.plans || []).find((x) => x.id === id);
    const me = CP.me();
    if (!p || !me || !["approved", "returned"].includes(decision)) return false;
    if (decision === "returned" && !String(comment || "").trim()) return false;
    p.status = decision;
    p.review = { by: me.id, byName: me.name, at: S.now().getTime(), comment: String(comment || "").trim() };
    p.pushed = false; delete p.origin;
    S.save(true);
    S.emit("plan", p);
    const m = p.plan && p.plan.meta ? p.plan.meta : {};
    S.pushAlert({
      level: decision === "approved" ? "info" : "warn", audience: [], byUser: p.by,
      title: decision === "approved" ? "Lesson plan approved" : "Lesson plan returned",
      body: `“${m.topic || "Your lesson plan"}” was ${decision}${comment ? ": " + comment : "."}`,
    });
    return true;
  };

  /* ------------------------------------------------ assessment workflow */
  A.myAssessments = (userId) => A.list("assessments").filter((a) => a.teacherId === userId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  A.setMark = function (as, studentId, raw) {
    as.marks = as.marks || {};
    const s = String(raw == null ? "" : raw).trim();
    if (s === "" ) { delete as.marks[studentId]; return { ok: true }; }
    if (/^ab$/i.test(s)) { as.marks[studentId] = "AB"; return { ok: true }; }
    const n = Number(s);
    if (!isFinite(n)) return { ok: false, reason: "Marks must be numbers (or AB for absent)." };
    if (n < 0 || n > as.total) return { ok: false, reason: "A mark must be between 0 and " + as.total + "." };
    as.marks[studentId] = Math.round(n * 100) / 100;
    return { ok: true };
  };
  A.editable = function (as, user) {
    if (!as || !user) return false;
    if (["dos", "head", "admin"].includes(user.role)) return true;
    return as.teacherId === user.id && (as.status === "draft" || as.status === "returned");
  };
  A.submitAssessment = function (id) {
    const as = A.get("assessments", id);
    const me = CP.me();
    if (!as || !me) return { ok: false, reason: "Not found." };
    if (!Object.keys(as.marks || {}).length) return { ok: false, reason: "Enter at least one mark first." };
    as.status = "submitted";
    A.save("assessments", as);
    S.pushAlert({
      level: "info", audience: ["dos"], title: "Marks submitted",
      body: `${me.name} submitted ${as.title} (${as.subject}, ${as.classId}) for approval.`,
      ref: { userId: me.id },
    });
    return { ok: true };
  };
  A.reviewAssessment = function (id, decision, note, reason) {
    const as = A.get("assessments", id);
    if (!as) return { ok: false, reason: "Not found." };
    if (decision === "returned" && !String(note || "").trim()) return { ok: false, reason: "Say what needs correcting." };
    as.status = decision;
    if (decision === "returned") as.returnNote = String(note).trim();
    A.save("assessments", as);
    S.pushAlert({
      level: decision === "approved" ? "info" : "warn", audience: [], byUser: as.teacherId,
      title: decision === "approved" ? "Marks approved" : "Marks returned for correction",
      body: `${as.title} (${as.subject}, ${as.classId})` + (decision === "returned" ? ": " + as.returnNote : " was approved."),
    });
    return { ok: true };
  };

  /* ------------------------------------------------ performance analysis */
  function pickAssessments(f) {
    f = f || {};
    const ok = f.includeSubmitted ? ["approved", "submitted"] : ["approved"];
    return A.list("assessments").filter((a) =>
      ok.includes(a.status) &&
      (!f.classId || a.classId === f.classId) && (!f.subject || a.subject === f.subject) &&
      (!f.term || String(a.term) === String(f.term)) && (!f.teacherId || a.teacherId === f.teacherId))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  A.pickAssessments = pickAssessments;

  // Total change over a series of percentages (least-squares slope × steps).
  A.seriesChange = function (vals) {
    const n = vals.length;
    if (n < 2) return null;
    if (n === 2) return r1(vals[1] - vals[0]);
    const xm = (n - 1) / 2, ym = mean(vals);
    let num = 0, den = 0;
    vals.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) * (i - xm); });
    return r1((num / den) * (n - 1));
  };

  A.performance = function (f) {
    const list = pickAssessments(f);
    const R = A.rules().academic;
    const byStudent = {};
    const allPcts = [];
    list.forEach((as) => {
      Object.keys(as.marks || {}).forEach((sid) => {
        const v = as.marks[sid];
        if (typeof v !== "number") return;
        const pct = A.markPct(v, as.total);
        allPcts.push(pct);
        (byStudent[sid] = byStudent[sid] || []).push({ pct, date: as.date, title: as.title, subject: as.subject, topicId: as.topicId, assessId: as.id });
      });
    });
    const students = Object.keys(byStudent).map((sid) => {
      const st = A.get("students", sid) || { id: sid, name: "Unknown learner", classId: "" };
      const series = byStudent[sid];
      const avg = r1(mean(series.map((x) => x.pct)));
      const change = A.seriesChange(series.map((x) => x.pct));
      const trend = change === null ? "n/a" : change >= R.trendDelta ? "improving" : change <= -R.trendDelta ? "declining" : "steady";
      return { student: st, results: series.length, avg, grade: A.grade(avg), change, trend, needsSupport: avg < R.supportBelow, pass: A.isPass(avg) };
    }).sort((a, b) => b.avg - a.avg);
    const avgs = students.map((s) => s.avg);
    return {
      assessments: list.length, results: allPcts.length, students,
      classAvg: avgs.length ? r1(mean(avgs)) : null,
      highest: allPcts.length ? Math.max.apply(null, allPcts) : null,
      lowest: allPcts.length ? Math.min.apply(null, allPcts) : null,
      passRate: students.length ? r1((students.filter((s) => s.pass).length / students.length) * 100) : null,
      failRate: students.length ? r1((students.filter((s) => !s.pass).length / students.length) * 100) : null,
      support: students.filter((s) => s.needsSupport),
      improving: students.filter((s) => s.trend === "improving"),
      declining: students.filter((s) => s.trend === "declining"),
    };
  };

  A.subjectPerformance = function (f) {
    const by = {};
    pickAssessments(f).forEach((as) => {
      Object.keys(as.marks || {}).forEach((sid) => {
        if (typeof as.marks[sid] !== "number") return;
        (by[as.subject] = by[as.subject] || []).push(A.markPct(as.marks[sid], as.total));
      });
    });
    return Object.keys(by).map((s) => ({ subject: s, avg: r1(mean(by[s])), results: by[s].length, low: mean(by[s]) < A.passMark() }))
      .sort((a, b) => a.avg - b.avg);
  };
  A.classPerformance = function (f) {
    const by = {};
    pickAssessments(f).forEach((as) => {
      Object.keys(as.marks || {}).forEach((sid) => {
        if (typeof as.marks[sid] !== "number") return;
        (by[as.classId] = by[as.classId] || []).push(A.markPct(as.marks[sid], as.total));
      });
    });
    return Object.keys(by).sort().map((c) => ({ classId: c, avg: r1(mean(by[c])), results: by[c].length }));
  };
  A.termPerformance = function (f) {
    const by = {};
    pickAssessments(Object.assign({}, f, { term: null })).forEach((as) => {
      Object.keys(as.marks || {}).forEach((sid) => {
        if (typeof as.marks[sid] !== "number") return;
        (by[as.term] = by[as.term] || []).push(A.markPct(as.marks[sid], as.total));
      });
    });
    return Object.keys(by).sort().map((t) => ({ term: t, avg: r1(mean(by[t])), results: by[t].length }));
  };
  // Topics where learners score poorly (needs assessments linked to a syllabus topic).
  A.topicPerformance = function (f) {
    const by = {};
    pickAssessments(f).forEach((as) => {
      if (!as.topicId) return;
      const g = (by[as.topicId] = by[as.topicId] || { pcts: [], assessments: 0, classes: {} });
      g.assessments++;
      g.classes[as.classId] = 1;
      Object.keys(as.marks || {}).forEach((sid) => {
        if (typeof as.marks[sid] === "number") g.pcts.push(A.markPct(as.marks[sid], as.total));
      });
    });
    const pass = A.passMark();
    return Object.keys(by).map((tid) => {
      const t = A.get("syllabus", tid);
      const g = by[tid];
      const below = g.pcts.filter((p) => p < pass).length;
      return {
        topicId: tid, topic: t ? t.topic : "(removed topic)", subject: t ? t.subject : "", level: t ? t.level : "",
        avg: g.pcts.length ? r1(mean(g.pcts)) : null, results: g.pcts.length, assessments: g.assessments,
        belowShare: g.pcts.length ? r1((below / g.pcts.length) * 100) : 0,
        weak: g.pcts.length > 0 && (mean(g.pcts) < pass || below / g.pcts.length >= 0.5),
      };
    }).filter((x) => x.results).sort((a, b) => a.avg - b.avg);
  };

  /* ------------------------------------------------------------ workload */
  A.periodMins = function (n) {
    const p = (S.data.settings.periods || []).find((x) => x.n === n);
    return p ? CP.time.mins(p.end) - CP.time.mins(p.start) : 40;
  };
  A.workload = function (userId, ref) {
    ref = ref || S.now();
    const rows = (S.data.timetable || []).filter((r) => r.teacherId === userId);
    const periodsPerDay = (S.data.settings.periods || []).length;
    const perDay = [1, 2, 3, 4, 5].map((d) => {
      const rs = rows.filter((r) => r.day === d);
      const mins = rs.reduce((a, r) => a + A.periodMins(r.period), 0);
      return { day: d, lessons: rs.length, mins, free: rs.length ? Math.max(0, periodsPerDay - rs.length) : periodsPerDay };
    });
    const week = perDay.reduce((a, d) => a + d.lessons, 0);
    const weekMins = perDay.reduce((a, d) => a + d.mins, 0);
    // Month: the school days actually left in this calendar month's timetable (holidays removed).
    let month = 0, monthMins = 0;
    const d = new Date(ref.getFullYear(), ref.getMonth(), 1);
    while (d.getMonth() === ref.getMonth()) {
      const wd = d.getDay();
      if (wd >= 1 && wd <= 5 && S.isSchoolDay(d)) { month += perDay[wd - 1].lessons; monthMins += perDay[wd - 1].mins; }
      d.setDate(d.getDate() + 1);
    }
    // This week's progress, from real records.
    const ws = CP.time.weekStart(ref);
    let taught = 0, missed = 0, pending = 0, covered = 0;
    for (let i = 0; i < 5; i++) {
      const dd = new Date(ws); dd.setDate(ws.getDate() + i);
      S.instancesForDate(CP.time.dayKey(dd)).filter((x) => x.teacherId === userId).forEach((x) => {
        if (x.state === "on-time" || x.state === "late") taught++;
        else if (x.state === "missing" || x.state === "absent") missed++;
        else if (x.state === "covered") covered++;
        else if (x.state === "pending") pending++;
      });
    }
    return {
      userId, perDay, week, weekHours: r1(weekMins / 60), month, monthHours: r1(monthMins / 60),
      freePeriodsWeek: perDay.reduce((a, x) => a + x.free, 0),
      maxDay: Math.max.apply(null, perDay.map((x) => x.lessons)),
      taught, missed, pending, covered,
    };
  };
  A.workloadAll = function () {
    const R = A.rules().academic;
    const rows = S.teachers().map((t) => Object.assign({ teacher: t }, A.workload(t.id)));
    const loaded = rows.filter((r) => r.week > 0);
    const avg = loaded.length ? mean(loaded.map((r) => r.week)) : 0;
    rows.forEach((r) => {
      const why = [];
      if (r.week === 0) r.flag = "none";
      else {
        if (r.week > R.maxLessonsPerWeek) why.push(`${r.week} lessons a week (limit ${R.maxLessonsPerWeek})`);
        if (r.maxDay > R.maxLessonsPerDay) why.push(`${r.maxDay} lessons in one day (limit ${R.maxLessonsPerDay})`);
        if (loaded.length >= 3 && r.week > avg * 1.3 && !why.length) why.push(`well above the school average of ${r1(avg)}`);
        r.flag = why.length ? "heavy" : (loaded.length >= 3 && r.week < avg * 0.5) ? "light" : "ok";
        if (r.flag === "light") why.push(`well below the school average of ${r1(avg)}`);
      }
      r.why = why;
    });
    return { rows, avg: r1(avg) };
  };

  // Timetable integrity: conflicts and gaps in the approved timetable.
  A.timetableIssues = function () {
    const tt = S.data.timetable || [];
    const issues = [];
    const key = (a, b, c) => a + "|" + b + "|" + c;
    const t = {}, rm = {}, cl = {};
    tt.forEach((r) => {
      if (r.teacherId) (t[key(r.teacherId, r.day, r.period)] = t[key(r.teacherId, r.day, r.period)] || []).push(r);
      if (r.roomId) (rm[key(r.roomId, r.day, r.period)] = rm[key(r.roomId, r.day, r.period)] || []).push(r);
      (cl[key(r.classId, r.day, r.period)] = cl[key(r.classId, r.day, r.period)] || []).push(r);
      if (!r.teacherId) issues.push({ kind: "no-teacher", text: `${r.classId} ${r.subject || "lesson"} (day ${r.day}, period ${r.period}) has no teacher.` });
    });
    const day = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
    Object.values(t).filter((g) => g.length > 1).forEach((g) => {
      const u = S.user(g[0].teacherId);
      issues.push({ kind: "teacher", text: `${u ? u.name : g[0].teacherId} is double-booked ${day[g[0].day] || g[0].day} P${g[0].period}: ${g.map((x) => x.classId).join(" and ")}.` });
    });
    Object.values(rm).filter((g) => g.length > 1 && new Set(g.map((x) => x.classId)).size > 1).forEach((g) => {
      const r = S.room(g[0].roomId);
      issues.push({ kind: "room", text: `${r ? r.name : g[0].roomId} is booked twice ${day[g[0].day] || g[0].day} P${g[0].period}: ${g.map((x) => x.classId).join(" and ")}.` });
    });
    Object.values(cl).filter((g) => g.length > 1).forEach((g) => {
      issues.push({ kind: "class", text: `${g[0].classId} has ${g.length} lessons at once on ${day[g[0].day] || g[0].day} P${g[0].period}.` });
    });
    return issues;
  };

  /* ------------------------------------------------------------ reminders */
  A.reminderText = function (me, i, minsLeft) {
    return [
      `Dear ${me.name},`,
      `Your ${i.subject} lesson begins in ${minsLeft} minute${minsLeft === 1 ? "" : "s"}.`,
      `Class: ${i.classId}`,
      `Classroom: ${i.roomName}`,
      `Time: ${CP.time.ampm(new Date(2000, 0, 1, 0, i.startM))} – ${CP.time.ampm(new Date(2000, 0, 1, 0, i.endM))}`,
      "Please prepare to enter the classroom.",
    ].join("\n");
  };
  A.dueReminders = function (userId, now) {
    now = now || S.now();
    const min = Number(A.rules().academic.reminderMin) || 5;
    const nowM = now.getHours() * 60 + now.getMinutes();
    const dateKey = CP.time.dayKey(now);
    if (!S.isSchoolDay(now)) return [];
    return S.instancesForDate(dateKey).filter((i) =>
      i.teacherId === userId && i.state === "pending" && i.startM - nowM >= 0 && i.startM - nowM <= min && !S.data.reminded[i.key]);
  };
  A.checkReminders = function () {
    const me = CP.me && CP.me();
    if (!me || !S.data.users.length) return 0;
    A.ensure();
    const today = CP.time.dayKey(S.now());
    Object.keys(S.data.reminded).forEach((k) => { if (k.slice(0, 10) !== today) delete S.data.reminded[k]; });
    const nowM = S.now().getHours() * 60 + S.now().getMinutes();
    let n = 0;
    A.dueReminders(me.id).forEach((i) => {
      S.data.reminded[i.key] = S.now().getTime();
      const left = Math.max(1, i.startM - nowM);
      const body = A.reminderText(me, i, left);
      const al = S.pushAlert({ id: "al-rem-" + i.key.replace(/\W+/g, "-"), level: "info", audience: [], byUser: me.id, title: "Upcoming lesson", body, ref: { key: i.key } });
      if (al) al.pushed = true; // a personal reminder stays on this phone
      A.notify("Upcoming lesson · " + i.subject + " " + i.classId, `Begins in ${left} min · ${i.roomName}`);
      if (CP.toast) CP.toast({ kind: "warn", msg: `${i.subject} ${i.classId} begins in ${left} min · ${i.roomName}`, ms: 8000 });
      n++;
    });
    if (n) { S.save(); S.emit("alerts-tick"); }
    return n;
  };
  A.notify = function (title, body) {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: "icons/icon-192.png", tag: "cp-" + title })).catch(() => {});
        return true;
      }
      new Notification(title, { body });
      return true;
    } catch (e) { return false; }
  };
  A.notifyState = function () {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  };
  A.enableNotifications = function () {
    if (typeof Notification === "undefined") return Promise.resolve("unsupported");
    return Notification.requestPermission();
  };

  /* ------------------------------------------------------------- calendar */
  A.EVENT_TYPES = { event: "Academic event", exam: "Examination", meeting: "Staff meeting", deadline: "Deadline", opening: "Opening day", closing: "Closing day" };
  A.calendarItems = function (fromKey, toKey) {
    const cal = S.data.calendar || {};
    const out = [];
    (cal.events || []).forEach((e) => {
      const end = e.end || e.date;
      if (end >= fromKey && e.date <= toKey) out.push({ date: e.date, end, name: e.name, type: e.type || "event", note: e.note || "" });
    });
    (cal.holidays || []).forEach((h) => { if (h.date >= fromKey && h.date <= toKey) out.push({ date: h.date, end: h.date, name: h.name, type: "holiday", note: h.note || "" }); });
    (cal.terms || []).forEach((t) => {
      if (t.start && t.start >= fromKey && t.start <= toKey) out.push({ date: t.start, end: t.start, name: "Term " + t.n + " opens", type: "opening", note: "" });
      if (t.end && t.end >= fromKey && t.end <= toKey) out.push({ date: t.end, end: t.end, name: "Term " + t.n + " closes", type: "closing", note: "" });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  };
  A.upcoming = function (days) {
    const from = CP.time.dayKey(S.now());
    const to = new Date(S.now()); to.setDate(to.getDate() + (days || 14));
    return A.calendarItems(from, CP.time.dayKey(to));
  };
  // Tomorrow's exams, meetings and deadlines reach staff the day before.
  A.calendarAlerts = function () {
    const me = CP.me && CP.me();
    if (!me || !["dos", "head", "admin"].includes(me.role)) return 0;
    const t = new Date(S.now()); t.setDate(t.getDate() + 1);
    const k = CP.time.dayKey(t);
    let n = 0;
    A.calendarItems(k, k).filter((x) => ["exam", "meeting", "deadline"].includes(x.type) && x.date === k).forEach((x) => {
      const id = "al-cal-" + k + "-" + x.name.replace(/\W+/g, "").slice(0, 24);
      if (S.data.alerts.some((a) => a.id === id)) return;
      S.pushAlert({ id, level: "info", audience: ["teacher", "dos", "head"], title: (A.EVENT_TYPES[x.type] || "Event") + " tomorrow", body: `${x.name} — ${k}${x.note ? " · " + x.note : ""}` });
      n++;
    });
    return n;
  };

  /* -------------------------------------------------------------- reports */
  const fmtT = (v) => (v ? CP.time.ampm(new Date(2000, 0, 1, 0, CP.time.mins(v))) : "—");
  function datesBetween(from, to) {
    const out = [];
    const d = S.parseKey(from), end = S.parseKey(to);
    for (; d <= end && out.length < 400; d.setDate(d.getDate() + 1)) if (d.getDay() >= 1 && d.getDay() <= 5) out.push(CP.time.dayKey(d));
    return out;
  }
  const teacherPool = (f) => S.teachers().filter((t) => !f.teacherId || t.id === f.teacherId);
  const STATE_TXT = { "on-time": "Taught on time", late: "Taught late", covered: "Covered by another teacher", missing: "Missed", absent: "Missed (teacher absent)", pending: "Not yet due", leave: "Teacher on leave", cancelled: "Cancelled" };

  A.REPORTS = [
    { id: "att-daily", label: "Daily teacher attendance", needs: ["date"], build(f) {
      const k = f.to || CP.time.dayKey(S.now());
      const rows = teacherPool(f).map((t) => {
        const g = S.dayGateLog(k)[t.id];
        const mine = S.instancesForDate(k).filter((x) => x.teacherId === t.id);
        const lateBy = g ? Math.max(0, g.mins - CP.time.mins(S.data.settings.lateAfter)) : 0;
        const leave = S.onLeave(t.id, k);
        const status = g ? (lateBy ? `Late by ${lateBy} min` : "On time") : leave ? "On leave" : mine.length ? "Absent" : "No lessons";
        return [t.name, t.staffNo || "", fmtT(g && g.in), fmtT(g && g.out), status, mine.length, mine.filter((x) => x.state === "on-time" || x.state === "late").length];
      });
      return { title: "Daily teacher attendance — " + k, columns: ["Teacher", "Staff no.", "Arrived", "Left", "Status", "Lessons", "Taught"], rows };
    } },
    { id: "att-monthly", label: "Monthly teacher attendance", needs: ["range"], build(f) {
      const rows = teacherPool(f).map((t) => {
        const st = S.teacherStats(t.id, f.days || 30);
        return [t.name, t.staffNo || "", st.workDays, st.present, st.absent, st.lateGate, st.totalLateMin, st.attendanceRate + "%"];
      });
      return { title: "Teacher attendance — last " + (f.days || 30) + " days", columns: ["Teacher", "Staff no.", "Work days", "Present", "Absent", "Late arrivals", "Minutes late", "Attendance"], rows };
    } },
    { id: "punctuality", label: "Teacher punctuality", needs: ["range"], build(f) {
      const rows = teacherPool(f).map((t) => {
        const st = S.teacherStats(t.id, f.days || 30);
        return [t.name, st.lessons, st.onTime, st.lateLessons, st.missedLessons, st.punctuality + "%", st.gatePunctuality + "%", st.avgLateBy ? st.avgLateBy + " min" : "—"];
      });
      return { title: "Teacher punctuality — last " + (f.days || 30) + " days", columns: ["Teacher", "Lessons due", "On time", "Late", "Missed", "Lesson punctuality", "Arrival punctuality", "Avg. lateness"], rows, note: "Lesson punctuality = lessons started on time ÷ lessons taught." };
    } },
    { id: "lessons", label: "Lessons conducted", needs: ["range"], build(f) { return lessonReport(f, (x) => x.state === "on-time" || x.state === "late", "Lessons conducted"); } },
    { id: "missed", label: "Missed lessons", needs: ["range"], build(f) { return lessonReport(f, (x) => x.state === "missing" || x.state === "absent", "Missed lessons"); } },
    { id: "workload", label: "Teacher workload", needs: [], build(f) {
      const rows = A.workloadAll().rows.filter((r) => !f.teacherId || r.teacher.id === f.teacherId).map((r) => [r.teacher.name, r.week, r.weekHours, r.month, r.monthHours, r.freePeriodsWeek, r.taught, r.pending, r.missed, r.flag === "heavy" ? "Heavy" : r.flag === "light" ? "Light" : r.flag === "none" ? "No lessons" : "Balanced"]);
      return { title: "Teacher workload", columns: ["Teacher", "Lessons / week", "Hours / week", "Lessons this month", "Hours this month", "Free periods / week", "Taught this week", "Pending this week", "Missed this week", "Load"], rows };
    } },
    { id: "syllabus", label: "Syllabus coverage", needs: ["term"], build(f) {
      const rows = A.coverageRows(f.term).filter((r) => (!f.teacherId || r.teacherId === f.teacherId) && (!f.subject || r.subject === f.subject) && (!f.classId || r.classId === f.classId))
        .map((r) => [r.teacherName, r.subject, r.classId, r.units, r.done, r.pct + "%", r.expected === null ? "—" : r.expected + "%", r.status === "behind" ? "Behind" : r.status === "ahead" ? "Ahead" : r.status === "on-track" ? "On track" : "—", r.current ? r.current.topic.topic : "—"]);
      return { title: "Syllabus coverage — Term " + (f.term || A.currentTerm()), columns: ["Teacher", "Subject", "Class", "Units", "Completed", "Covered", "Expected", "Schedule", "Current topic"], rows, note: "Covered = completed units ÷ total units × 100." };
    } },
    { id: "exam-results", label: "Examination results", needs: ["term"], build(f) {
      const list = A.pickAssessments({ classId: f.classId, subject: f.subject, term: f.term, teacherId: f.teacherId });
      const rows = [];
      list.forEach((as) => { const s = A.assessStats(as); const t = S.user(as.teacherId); rows.push([as.title, as.subject, as.classId, t ? t.name : "", as.date, as.total, s.sat, s.avgPct === null ? "—" : s.avgPct + "%", s.highest ? s.highest.mark : "—", s.lowest ? s.lowest.mark : "—", s.passRate === null ? "—" : s.passRate + "%"]); });
      return { title: "Examination results (approved)", columns: ["Assessment", "Subject", "Class", "Teacher", "Date", "Out of", "Sat", "Average", "Highest", "Lowest", "Pass rate"], rows, note: "Only results approved by the Director of Studies are included." };
    } },
    { id: "class-perf", label: "Class performance", needs: ["term"], build(f) {
      const rows = A.classPerformance({ term: f.term, subject: f.subject }).filter((c) => !f.classId || c.classId === f.classId).map((c) => { const p = A.performance({ classId: c.classId, subject: f.subject, term: f.term }); return [c.classId, p.students.length, c.avg + "%", p.passRate === null ? "—" : p.passRate + "%", p.support.length, p.improving.length, p.declining.length]; });
      return { title: "Class performance", columns: ["Class", "Learners assessed", "Average", "Pass rate", "Need support", "Improving", "Declining"], rows };
    } },
    { id: "subject-perf", label: "Subject performance", needs: ["term"], build(f) {
      const rows = A.subjectPerformance({ term: f.term, classId: f.classId, teacherId: f.teacherId }).filter((s) => !f.subject || s.subject === f.subject).map((s) => [s.subject, s.results, s.avg + "%", s.low ? "Below pass mark" : "OK"]);
      return { title: "Subject performance", columns: ["Subject", "Results", "Average", "Flag"], rows };
    } },
    { id: "plans", label: "Lesson-plan submissions", needs: ["range"], build(f) {
      const from = f.from ? S.parseKey(f.from).getTime() : 0;
      const to = f.to ? S.parseKey(f.to).getTime() + 864e5 : Infinity;
      const rows = (S.data.plans || []).filter((p) => (p.status || "draft") !== "draft" && (!f.teacherId || p.by === f.teacherId) && (p.submittedAt || p.ts) >= from && (p.submittedAt || p.ts) < to)
        .map((p) => { const m = (p.plan && p.plan.meta) || {}; const u = S.user(p.by); return [u ? u.name : "", m.subject || "", m.classId || m.class || "", m.topic || "", CP.time.dayKey(p.submittedAt || p.ts), p.status, (p.review && p.review.comment) || ""]; })
        .filter((r) => (!f.subject || r[1] === f.subject) && (!f.classId || r[2] === f.classId));
      return { title: "Lesson-plan submissions", columns: ["Teacher", "Subject", "Class", "Topic", "Submitted", "Status", "Reviewer comment"], rows };
    } },
  ];
  function lessonReport(f, pred, title) {
    const to = f.to || CP.time.dayKey(S.now());
    const from = f.from || CP.time.dayKey(new Date(S.parseKey(to).getTime() - 29 * 864e5));
    const rows = [];
    datesBetween(from, to).forEach((k) => {
      S.instancesForDate(k).filter((x) => pred(x) && (!f.teacherId || x.teacherId === f.teacherId) && (!f.subject || x.subject === f.subject) && (!f.classId || x.classId === f.classId))
        .forEach((x) => rows.push([k, "P" + x.period, fmtT(x.start), x.teacherName, x.subject, x.classId, x.inAt ? fmtT(CP.time.hm(x.inAt)) : "—", STATE_TXT[x.state] || x.state]));
    });
    return { title: title + " — " + from + " to " + to, columns: ["Date", "Period", "Scheduled", "Teacher", "Subject", "Class", "Started", "Outcome"], rows };
  }
  A.runReport = function (id, f) {
    const rep = A.REPORTS.find((r) => r.id === id);
    if (!rep) return null;
    f = Object.assign({}, f || {});
    if (!f.term) f.term = A.currentTerm();
    const out = rep.build(f);
    out.id = id;
    return out;
  };
  A.reportSheets = (rep) => [{ name: rep.title.slice(0, 31), rows: [rep.columns].concat(rep.rows) }];

  /* ------------------------------------------------------- CSV import */
  // Learners:  name, class [, admission no]      Syllabus: subject, level, term, week, topic, subtopics (; separated), objectives (; separated)
  function csvRows(text) {
    return S.csvObjects(text).rows.map((r) => {
      const o = {};
      Object.keys(r).forEach((k) => { o[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = r[k]; });
      return o;
    });
  }
  A.importStudents = function (text) {
    const rows = csvRows(text);
    let added = 0; const bad = [];
    rows.forEach((r, i) => {
      const name = String(r.name || r.learner || r.student || "").trim();
      const cls = String(r.class || r.classid || "").trim().toUpperCase();
      if (!name || !S.data.classes.some((c) => c.id === cls)) { bad.push("Row " + (i + 2) + (name ? ": unknown class “" + cls + "”" : ": no name")); return; }
      const adm = String(r.admno || r.admission || r.adm || r.admissionno || r.admissionnumber || "").trim();
      const dup = A.list("students").find((s) => s.classId === cls && s.name.toLowerCase() === name.toLowerCase());
      if (dup) return;
      A.save("students", { id: "st_" + CP.uid("s").slice(2), name, admNo: adm, classId: cls, active: true });
      added++;
    });
    return { added, bad };
  };
  A.importSyllabus = function (text) {
    const rows = csvRows(text);
    let added = 0; const bad = [];
    const split = (v) => String(v || "").split(/[;|]/).map((x) => x.trim()).filter(Boolean);
    rows.forEach((r, i) => {
      const subject = String(r.subject || "").trim();
      const level = String(r.level || r.class || "").trim().toUpperCase();
      const topic = String(r.topic || "").trim();
      if (!subject || !level || !topic) { bad.push("Row " + (i + 2) + ": subject, level and topic are required"); return; }
      const term = String(r.term || "1").replace(/\D/g, "") || "1";
      const dup = A.list("syllabus").find((t) => t.subject === subject && t.level === level && String(t.term) === term && t.topic.toLowerCase() === topic.toLowerCase());
      const order = A.topics({ subject, level, term }).length + 1;
      A.save("syllabus", {
        id: dup ? dup.id : "sy_" + CP.uid("t").slice(2), subject, level, term: ["1", "2", "3"].includes(term) ? term : "1",
        week: Number(r.week) || null, order: dup ? dup.order : order, topic, units: Number(r.units) || 1,
        subtopics: split(r.subtopics || r.subtopic), objectives: split(r.objectives || r.objective),
      });
      added++;
    });
    return { added, bad };
  };

  A.init = function () {
    A.ensure();
    S.on("tick", () => {});
  };
})(window);
