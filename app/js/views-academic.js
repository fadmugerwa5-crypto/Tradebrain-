/* ==========================================================================
   ClassPulse — views-academic.js
   Academics hub, syllabus & coverage, lesson plans, class lists, rules,
   calendar. Shared by the DOS, Head, Admin and Teacher platforms.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const A = CP.acad;
  const esc = CP.esc;

  /* ------------------------------------------------------------- helpers */
  const U = (CP.acadUI = {});
  const LEADER = ["dos", "head", "admin"];
  U.isLeader = (ctx) => ctx.role !== "teacher";
  U.pill = (cls, t) => `<span class="pill ${cls || ""}">${esc(t)}</span>`;
  U.bar = function (pct, exp) {
    const col = pct >= 75 ? "var(--ok)" : pct >= 40 ? "var(--accent-500)" : "var(--warn)";
    return `<div style="position:relative;height:8px;border-radius:99px;background:var(--bg-2);overflow:visible">
      <div style="height:100%;width:${Math.min(100, pct)}%;background:${col};border-radius:99px"></div>
      ${exp != null ? `<div title="Expected ${exp}%" style="position:absolute;top:-3px;left:${Math.min(100, exp)}%;width:2px;height:14px;background:var(--fg-1);opacity:.6"></div>` : ""}</div>`;
  };
  U.back = (ctx) => `<button class="btn xs ghost mb-3" data-go="academics">${CP.icon("chevron")} Academics</button>`;
  U.bindGo = function (root, ctx) {
    root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => CP.go("/" + ctx.role + "/" + b.dataset.go)));
  };
  U.opts = (list, sel) => list.map((o) => { const v = typeof o === "object" ? o.v : o; const l = typeof o === "object" ? o.l : o; return `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`; }).join("");
  U.combos = function (userId) {
    const seen = {}, out = [];
    (S.data.timetable || []).filter((r) => r.teacherId === userId && r.subject).forEach((r) => {
      const k = r.classId + "|" + r.subject;
      if (!seen[k]) { seen[k] = 1; out.push({ classId: r.classId, subject: r.subject }); }
    });
    return out.sort((a, b) => a.classId.localeCompare(b.classId) || a.subject.localeCompare(b.subject));
  };
  U.statusPill = function (s) {
    return ({ behind: U.pill("danger", "Behind"), ahead: U.pill("info", "Ahead"), "on-track": U.pill("ok", "On track"),
      unknown: U.pill("", "No term dates"), "no-syllabus": U.pill("", "No syllabus") })[s] || "";
  };
  U.topicPill = function (s) {
    return ({ completed: U.pill("ok", "Completed"), "in-progress": U.pill("info", "In progress"), "not-completed": U.pill("warn", "Not completed"), "not-started": U.pill("", "Not started") })[s] || "";
  };
  U.assessPill = function (s) {
    return ({ draft: U.pill("", "Draft"), submitted: U.pill("warn", "Awaiting approval"), approved: U.pill("ok", "Approved"), returned: U.pill("danger", "Returned") })[s] || "";
  };
  U.fileText = function (accept) {
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept || ".csv,text/csv,text/plain";
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => resolve(null);
        r.readAsText(f);
      };
      inp.click();
    });
  };
  U.termSeg = (cur) => CP.seg("term", [{ value: "1", label: "Term 1" }, { value: "2", label: "Term 2" }, { value: "3", label: "Term 3" }], cur);
  U.ctxState = (U.state = U.state || {});

  /* =============================================================== HUB */
  function hub(ctx) {
    const leader = U.isLeader(ctx);
    const me = ctx.me;
    const pendingMarks = A.list("assessments").filter((a) => a.status === "submitted").length;
    const pendingPlans = (S.data.plans || []).filter((p) => p.status === "submitted").length;
    const rows = leader ? A.coverageRows() : A.coverageRows().filter((r) => r.teacherId === me.id);
    const behind = rows.filter((r) => r.status === "behind").length;
    const myDraft = A.myAssessments(me.id).filter((a) => a.status === "draft" || a.status === "returned").length;
    const upcoming = A.upcoming(14).filter((x) => x.type !== "holiday" || leader).slice(0, 5);
    const notif = A.notifyState();
    const cards = leader ? [
      { id: "syllabus", icon: "book", t: "Syllabus & coverage", m: behind ? behind + " class/subject" + (behind > 1 ? "s" : "") + " behind schedule" : "Upload syllabus, track what is taught" },
      { id: "assess", icon: "chart", t: "Tests & examinations", m: pendingMarks ? pendingMarks + " awaiting your approval" : "Review, approve or return marks", badge: pendingMarks },
      { id: "plans", icon: "list", t: "Lesson plans", m: pendingPlans ? pendingPlans + " submitted for review" : "Review submitted plans", badge: pendingPlans },
      { id: "perf", icon: "zap", t: "Performance analysis", m: "Classes, subjects, trends, learners needing support" },
      { id: "workload", icon: "users", t: "Workload & timetable checks", m: A.timetableIssues().length ? A.timetableIssues().length + " timetable problem(s) found" : "Lessons, hours and free periods per teacher" },
      { id: "acreports", icon: "download", t: "Reports", m: "Attendance, punctuality, coverage, results — PDF and Excel" },
      { id: "roster", icon: "user", t: "Class lists", m: S.data.classes.length + " classes · " + A.list("students").length + " learners" },
      { id: "weekly", icon: "list", t: "Weekly summary", m: "Lateness, missed lessons, syllabus, marks waiting — one page" },
      { id: "calendar", icon: "calendar", t: "Academic calendar", m: "Terms, exams, meetings, holidays, deadlines" },
      { id: "rules", icon: "gear", t: "Grading & academic rules", m: "Pass mark, grade bands, alert thresholds" },
      { id: "assistant", icon: "sparkle", t: "AI teaching assistant (optional)", m: "Off unless the administrator turns it on" },
    ].concat(ctx.role === "admin" ? [{ id: "schoolsetup", icon: "gear", t: "School setup", m: "Checklist, classes, join code, term dates" }] : []) : [
      { id: "syllabus", icon: "book", t: "My syllabus coverage", m: behind ? behind + " behind schedule" : "Record what you have taught" },
      { id: "assess", icon: "chart", t: "My tests & marks", m: myDraft ? myDraft + " to finish or correct" : "Create tests, enter marks, submit", badge: A.myAssessments(me.id).filter((a) => a.status === "returned").length },
      { id: "plans", icon: "list", t: "My lesson plans", m: "Submit saved plans to the DOS" },
      { id: "perf", icon: "zap", t: "My class performance", m: "Averages, trends, learners needing support" },
      { id: "workload", icon: "users", t: "My workload", m: "Lessons, hours and free periods" },
      { id: "acreports", icon: "download", t: "My reports", m: "Print or export to Excel" },
      { id: "assistant", icon: "sparkle", t: "AI teaching assistant (optional)", m: "Extra help — never required" },
    ];
    return {
      title: "Academics", sub: leader ? "Syllabus, assessment and performance" : "Your teaching tools",
      html: `
        ${leader && A.timetableIssues().length ? CP.banner("warn", "Timetable needs attention", A.timetableIssues()[0].text + (A.timetableIssues().length > 1 ? " (+" + (A.timetableIssues().length - 1) + " more in Workload)" : "")) : ""}
        <div class="list">${cards.map((c) => CP.li({
          press: true, attr: `data-go="${c.id}"`,
          lead: `<span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);color:var(--brand-500)">${CP.icon(c.icon)}</span>`,
          name: esc(c.t), meta: esc(c.m),
          tail: c.badge ? `<span class="pill danger">${c.badge}</span>` : CP.icon("chevron"),
        })).join("")}</div>
        ${CP.section("Coming up")}
        <div class="card">${upcoming.length ? upcoming.map((x) => `<div class="row between t-sm" style="padding:6px 0"><span class="fw-6">${esc(x.name)}</span><span class="dim">${esc(x.date)}${x.end !== x.date ? " → " + esc(x.end) : ""} · ${esc(A.EVENT_TYPES[x.type] || (x.type === "holiday" ? "Holiday" : x.type))}</span></div>`).join("") : `<div class="t-sm muted">Nothing on the calendar for the next two weeks.</div>`}</div>
        ${!leader ? `${CP.section("Lesson reminders")}
        <div class="card"><div class="t-sm mb-3">You are reminded ${A.rules().academic.reminderMin} minutes before each lesson, in the app and on the Alerts tab.
          ${notif === "granted" ? "Phone notifications are on." : notif === "denied" ? "Phone notifications are blocked in your browser settings." : notif === "unsupported" ? "This browser cannot show phone notifications." : "Turn on phone notifications to see them with the screen off."}</div>
          <div class="t-xs dim mb-3">Reminders are produced by the app on your phone, so they appear while ClassPulse is open or running in the background. They are not sent from the server when the app is fully closed.</div>
          ${notif === "default" ? `<button class="btn primary block" data-enable-notif>${CP.icon("bell")} Turn on notifications</button>` : ""}</div>` : ""}`,
      after(root) {
        U.bindGo(root, ctx);
        const b = root.querySelector("[data-enable-notif]");
        if (b) b.onclick = () => A.enableNotifications().then(() => CP.render());
      },
    };
  }

  /* ============================================================ SYLLABUS */
  function syllabus(ctx) {
    const leader = U.isLeader(ctx);
    const st = U.state;
    st.term = st.term || A.currentTerm();
    st.sylTab = st.sylTab || "coverage";
    return leader ? syllabusLeader(ctx, st) : syllabusTeacher(ctx, st);
  }

  function syllabusLeader(ctx, st) {
    const term = st.term;
    const tab = st.sylTab;
    const tcs = A.teacherCoverage(term);
    const subjects = A.groupCoverage("subject", term);
    const classes = A.groupCoverage("classId", term);
    const behind = tcs.filter((t) => t.status === "behind");
    const ahead = tcs.filter((t) => t.status === "ahead");
    const topicsAll = A.list("syllabus");
    let body = "";
    if (tab === "coverage") {
      body = !topicsAll.length
        ? CP.empty("No syllabus uploaded yet", "Open “Manage syllabus” to add topics or import a CSV. Coverage is calculated from it.", "book")
        : `<div class="grid g2 mb-4">
            ${CP.stat({ k: "Teachers behind", v: behind.length, tone: behind.length ? "danger" : "ok", d: tcs.length + " teaching a syllabus subject" })}
            ${CP.stat({ k: "Teachers ahead", v: ahead.length, tone: "info" })}
          </div>
          ${!A.termWindow(term) ? CP.banner("info", "Set the term dates", "Expected progress and “behind schedule” need this term’s start and end dates in the Academic calendar.") : ""}
          ${CP.section("By teacher")}
          <div class="list">${tcs.map((t) => CP.li({
            press: true, attr: `data-teacher="${esc(t.teacherId)}"`,
            name: esc(t.teacherName),
            meta: `${t.done}/${t.units} units · ${t.expected === null ? "no expected figure" : "expected " + t.expected + "%"}`,
            tail: `<div style="min-width:90px;text-align:right"><div class="mono fw-6">${t.pct}%</div>${U.statusPill(t.status)}</div>`,
          })).join("") || `<div class="t-sm muted text-c" style="padding:14px">No teacher is timetabled for a subject that has a syllabus in this term.</div>`}</div>
          <div class="grid g2 mt-4">
            <div class="card"><div class="upper dim mb-3">By subject</div><div class="col gap-3">${subjects.map((s) => `<div><div class="row between t-sm mb-1"><span class="fw-6">${esc(s.key)}</span><span class="mono">${s.pct}%</span></div>${U.bar(s.pct)}</div>`).join("") || `<div class="t-sm muted">—</div>`}</div></div>
            <div class="card"><div class="upper dim mb-3">By class</div><div class="col gap-3">${classes.map((s) => `<div><div class="row between t-sm mb-1"><span class="fw-6">${esc(s.key)}</span><span class="mono">${s.pct}%</span></div>${U.bar(s.pct)}</div>`).join("") || `<div class="t-sm muted">—</div>`}</div></div>
          </div>`;
    } else {
      const f = { subject: st.fSubject || "", level: st.fLevel || "" };
      const subs = Array.from(new Set(S.subjects().concat(topicsAll.map((t) => t.subject)))).sort();
      const levels = Array.from(new Set(S.data.classes.map((c) => c.level).concat(topicsAll.map((t) => t.level)))).sort();
      const list = A.topics({ subject: f.subject, level: f.level, term });
      body = `<div class="grid g2 mb-3">
          <div class="field"><label>Subject</label><select class="select" data-f="fSubject"><option value="">All</option>${U.opts(subs, f.subject)}</select></div>
          <div class="field"><label>Class level</label><select class="select" data-f="fLevel"><option value="">All</option>${U.opts(levels, f.level)}</select></div></div>
        <div class="row gap-3 mb-3"><button class="btn primary grow" data-add-topic>${CP.icon("plus")} Add topic</button><button class="btn grow" data-import-syl>${CP.icon("download")} Import CSV</button></div>
        <div class="t-xs dim mb-3">CSV columns: Subject, Level, Term, Week, Topic, Subtopics, Objectives (separate several with “;”). Importing again updates topics with the same name.</div>
        <div class="list">${list.map((t) => CP.li({
          press: true, attr: `data-edit-topic="${esc(t.id)}"`,
          name: esc(t.topic),
          meta: `${esc(t.subject)} · ${esc(t.level)} · Term ${esc(t.term)}${t.week ? " · Week " + t.week : ""}${t.subtopics.length ? " · " + t.subtopics.length + " subtopics" : ""}`,
          tail: CP.icon("chevron"),
        })).join("") || `<div class="t-sm muted text-c" style="padding:14px">No topics for this filter.</div>`}</div>`;
    }
    return {
      title: "Syllabus & coverage", sub: "Term " + term,
      html: `${U.back(ctx)}${U.termSeg(term)}<div class="mt-3"></div>${CP.seg("syltab", [{ value: "coverage", label: "Coverage" }, { value: "manage", label: "Manage syllabus" }], tab)}<div class="mt-4">${body}</div>`,
      after(root) {
        U.bindGo(root, ctx);
        CP.bindSeg(root, "term", (v) => { st.term = v; CP.render(); });
        CP.bindSeg(root, "syltab", (v) => { st.sylTab = v; CP.render(); });
        root.querySelectorAll("[data-f]").forEach((el) => (el.onchange = () => { st[el.dataset.f] = el.value; CP.render(); }));
        root.querySelectorAll("[data-teacher]").forEach((b) => (b.onclick = () => teacherCoverageSheet(tcs.find((t) => t.teacherId === b.dataset.teacher))));
        const add = root.querySelector("[data-add-topic]");
        if (add) add.onclick = () => topicForm(null, st);
        root.querySelectorAll("[data-edit-topic]").forEach((b) => (b.onclick = () => topicForm(A.get("syllabus", b.dataset.editTopic), st)));
        const imp = root.querySelector("[data-import-syl]");
        if (imp) imp.onclick = async () => {
          const text = await U.fileText();
          if (text == null) return;
          const r = A.importSyllabus(text);
          CP.toast({ kind: r.added ? "ok" : "warn", msg: r.added + " topic(s) imported" + (r.bad.length ? ", " + r.bad.length + " skipped: " + r.bad.slice(0, 2).join("; ") : ""), ms: 6000 });
          CP.render();
        };
      },
    };
  }

  function teacherCoverageSheet(t) {
    if (!t) return;
    const body = t.rows.map((r) => `<div class="card flat mb-3"><div class="row between mb-2"><div class="fw-6">${esc(r.subject)} · ${esc(r.classId)}</div>${U.statusPill(r.status)}</div>
      ${U.bar(r.pct, r.expected)}<div class="t-xs dim mt-2">${r.done}/${r.units} units · ${r.pct}%${r.expected !== null ? " · expected " + r.expected + "%" : ""}</div>
      <div class="t-sm mt-2"><b>Current:</b> ${r.current ? esc(r.current.topic.topic) : "—"}</div>
      <div class="t-sm"><b>Covered:</b> ${r.covered.map((x) => esc(x.topic.topic)).join(", ") || "none yet"}</div>
      <div class="t-sm"><b>Remaining:</b> ${r.remaining.map((x) => esc(x.topic.topic)).join(", ") || "none"}</div>
      ${r.notCompleted.length ? `<div class="t-sm warn mt-1"><b>Not completed:</b> ${r.notCompleted.map((x) => esc(x.topic.topic) + " (" + esc((x.progress && x.progress.note) || "no reason") + ")").join("; ")}</div>` : ""}</div>`).join("");
    CP.sheet({ title: t.teacherName, body });
  }

  function topicForm(t, st) {
    const isNew = !t;
    t = t || { subject: st.fSubject || S.subjects()[0] || "", level: st.fLevel || (S.data.classes[0] || {}).level || "", term: st.term, week: "", topic: "", subtopics: [], objectives: [], units: 1 };
    const s = CP.sheet({
      title: isNew ? "Add syllabus topic" : "Edit topic",
      body: `<div class="grid g2 mb-3"><div class="field"><label>Subject</label><input class="input" data-k="subject" list="dl-subj" value="${esc(t.subject)}"><datalist id="dl-subj">${S.subjects().map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>
        <div class="field"><label>Class level</label><input class="input" data-k="level" list="dl-lvl" value="${esc(t.level)}" placeholder="e.g. S1"><datalist id="dl-lvl">${Array.from(new Set(S.data.classes.map((c) => c.level))).map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div></div>
        <div class="grid g2 mb-3"><div class="field"><label>Term</label><select class="select" data-k="term">${U.opts(["1", "2", "3"], t.term)}</select></div>
        <div class="field"><label>Week (optional)</label><input class="input" data-k="week" inputmode="numeric" value="${esc(t.week || "")}"></div></div>
        <div class="field mb-3"><label>Topic</label><input class="input" data-k="topic" value="${esc(t.topic)}"></div>
        <div class="field mb-3"><label>Subtopics (one per line)</label><textarea class="input" rows="3" data-k="subtopics">${esc(t.subtopics.join("\n"))}</textarea></div>
        <div class="field mb-3"><label>Learning objectives (one per line)</label><textarea class="input" rows="3" data-k="objectives">${esc(t.objectives.join("\n"))}</textarea></div>
        <div class="field mb-4"><label>Weight (units)</label><input class="input" data-k="units" inputmode="numeric" value="${esc(t.units || 1)}"></div>
        <div class="row gap-3">${isNew ? "" : `<button class="btn danger" data-del>${CP.icon("trash")}</button>`}<button class="btn primary grow" data-save>${CP.icon("check")} Save</button></div>`,
    });
    const val = (k) => s.body.querySelector(`[data-k="${k}"]`).value.trim();
    const lines = (k) => val(k).split(/\n/).map((x) => x.trim()).filter(Boolean);
    s.body.querySelector("[data-save]").onclick = () => {
      if (!val("subject") || !val("level") || !val("topic")) return CP.toast({ kind: "err", msg: "Subject, class level and topic are required." });
      const rec = { id: t.id || "sy_" + CP.uid("t").slice(2), subject: val("subject"), level: val("level").toUpperCase(), term: val("term"),
        week: Number(val("week")) || null, topic: val("topic"), subtopics: lines("subtopics"), objectives: lines("objectives"),
        units: Math.max(1, Math.min(10, Number(val("units")) || 1)), order: t.order || A.topics({ subject: val("subject"), level: val("level").toUpperCase(), term: val("term") }).length + 1 };
      A.save("syllabus", rec);
      s.close(); CP.toast({ kind: "ok", msg: "Topic saved." }); CP.render();
    };
    const del = s.body.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      if (!(await CP.confirm({ title: "Delete this topic?", msg: "Coverage records for it will no longer count.", danger: true, ok: "Delete" }))) return;
      A.remove("syllabus", t.id); s.close(); CP.render();
    };
  }

  function syllabusTeacher(ctx, st) {
    const me = ctx.me;
    const combos = U.combos(me.id);
    if (!combos.length) return { title: "My syllabus", html: U.back(ctx) + CP.empty("No lessons timetabled", "Coverage is tracked for the classes and subjects you are timetabled to teach.", "book") , after: (r) => U.bindGo(r, ctx) };
    const sel = combos.find((c) => c.classId + "|" + c.subject === st.combo) || combos[0];
    st.combo = sel.classId + "|" + sel.subject;
    const cv = A.coverage({ subject: sel.subject, classId: sel.classId, term: st.term });
    return {
      title: "My syllabus", sub: sel.subject + " · " + sel.classId,
      html: `${U.back(ctx)}<div class="field mb-3"><label>Class and subject</label><select class="select" data-combo>${combos.map((c) => `<option value="${esc(c.classId + "|" + c.subject)}" ${c === sel ? "selected" : ""}>${esc(c.subject)} — ${esc(c.classId)}</option>`).join("")}</select></div>
        ${U.termSeg(st.term)}
        <div class="card mt-3 mb-3"><div class="row between mb-2"><div class="fw-7">${cv.pct}% covered</div>${U.statusPill(cv.status)}</div>${U.bar(cv.pct, cv.expected)}
          <div class="t-xs dim mt-2">${cv.done} of ${cv.units} units completed${cv.expected !== null ? " · about " + cv.expected + "% expected by now (the line on the bar)" : ""}</div>
          ${cv.current ? `<div class="t-sm mt-2"><b>Current topic:</b> ${esc(cv.current.topic.topic)}</div>` : ""}</div>
        ${!cv.units ? CP.banner("info", "No syllabus for this class and term", "The Director of Studies uploads the official syllabus. Topics will appear here once it is added.") : ""}
        <div class="list">${cv.items.map((x) => CP.li({
          press: true, attr: `data-topic="${esc(x.topic.id)}"`,
          name: esc(x.topic.topic),
          meta: (x.topic.week ? "Week " + x.topic.week + " · " : "") + (x.progress && x.progress.note ? esc(x.progress.note) : x.topic.subtopics.slice(0, 3).map(esc).join(", ")),
          tail: U.topicPill(x.status) + (x.progress && x.progress.rejected ? " " + U.pill("danger", "Not saved") : ""),
        })).join("")}</div>`,
      after(root) {
        U.bindGo(root, ctx);
        root.querySelector("[data-combo]").onchange = (e) => { st.combo = e.target.value; CP.render(); };
        CP.bindSeg(root, "term", (v) => { st.term = v; CP.render(); });
        root.querySelectorAll("[data-topic]").forEach((b) => (b.onclick = () => progressSheet(A.get("syllabus", b.dataset.topic), sel, me)));
      },
    };
  }

  function progressSheet(topic, sel, me) {
    const cur = A.progressOf(topic.id, sel.classId);
    const status = cur ? cur.status : "not-started";
    const s = CP.sheet({
      title: topic.topic,
      body: `<div class="t-sm muted mb-3">${esc(sel.subject)} · ${esc(sel.classId)}${topic.subtopics.length ? "<br>" + topic.subtopics.map(esc).join(" · ") : ""}</div>
        ${topic.objectives.length ? `<div class="t-xs dim upper mb-1">Objectives</div><ul class="t-sm" style="margin:0 0 12px;padding-left:18px">${topic.objectives.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
        <div class="t-xs dim mb-2">Now: ${U.topicPill(status)}${cur && cur.rejected ? `<div class="danger mt-1">The server refused your last change: ${esc(cur.rejected)}</div>` : ""}</div>
        <div class="col gap-2 mb-3">
          <button class="btn block" data-set="in-progress">${CP.icon("timer")} Mark in progress</button>
          <button class="btn primary block" data-set="completed">${CP.icon("check")} Mark completed…</button>
          <button class="btn block" data-set="not-completed">${CP.icon("alert")} Could not complete…</button>
          ${cur ? `<button class="btn ghost block" data-set="not-started">Reset to not started</button>` : ""}
        </div><div data-extra></div>`,
    });
    const extra = s.body.querySelector("[data-extra]");
    const write = (rec) => {
      A.save("progress", Object.assign({ id: A.progressId(topic.id, sel.classId), topicId: topic.id, classId: sel.classId, subject: sel.subject, teacherId: me.id }, rec));
      s.close(); CP.toast({ kind: "ok", msg: "Saved." }); CP.render();
    };
    s.body.querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => {
      const v = b.dataset.set;
      if (v === "in-progress" || v === "not-started") return write({ status: v, note: "" });
      if (v === "completed") {
        extra.innerHTML = `<div class="banner warn"><div class="grow t-sm"><label class="row gap-3" style="align-items:flex-start"><input type="checkbox" data-confirm style="margin-top:3px"> <span>I confirm that <b>${esc(topic.topic)}</b> has been fully taught to ${esc(sel.classId)}.</span></label></div></div>
          <div class="field mt-3"><label>Date completed</label><input class="input" type="date" data-date value="${CP.time.dayKey(S.now())}"></div>
          <button class="btn primary block mt-3" data-go-save>${CP.icon("check")} Save as completed</button>`;
        extra.querySelector("[data-go-save]").onclick = () => {
          if (!extra.querySelector("[data-confirm]").checked) return CP.toast({ kind: "err", msg: "Tick the box to confirm." });
          write({ status: "completed", confirmed: true, completedOn: extra.querySelector("[data-date]").value, note: "" });
        };
      } else {
        extra.innerHTML = `<div class="field"><label>Why was it not completed?</label><textarea class="input" rows="3" data-reason placeholder="e.g. lost two lessons to a school event"></textarea></div>
          <button class="btn primary block mt-3" data-go-save>${CP.icon("check")} Save</button>`;
        extra.querySelector("[data-go-save]").onclick = () => {
          const r = extra.querySelector("[data-reason]").value.trim();
          if (!r) return CP.toast({ kind: "err", msg: "Please give a reason." });
          write({ status: "not-completed", note: r });
        };
      }
    }));
  }

  /* ============================================================== PLANS */
  function plans(ctx) {
    const leader = U.isLeader(ctx);
    const st = U.state;
    const me = ctx.me;
    const all = (S.data.plans || []).slice().sort((a, b) => (b.submittedAt || b.ts) - (a.submittedAt || a.ts));
    const list = leader ? all.filter((p) => (p.status || "draft") !== "draft") : all.filter((p) => p.by === me.id);
    const f = st.planFilter || (leader ? "submitted" : "all");
    const shown = list.filter((p) => f === "all" || (p.status || "draft") === f);
    const pill = (p) => ({ draft: U.pill("", "Draft"), submitted: U.pill("warn", "Submitted"), approved: U.pill("ok", "Approved"), returned: U.pill("danger", "Returned") })[p.status || "draft"];
    return {
      title: leader ? "Lesson plans" : "My lesson plans", sub: leader ? "Review what teachers submit" : "Save, then submit to the DOS",
      html: `${U.back(ctx)}${CP.seg("pf", (leader ? [["submitted", "To review"], ["returned", "Returned"], ["approved", "Approved"], ["all", "All"]] : [["all", "All"], ["draft", "Drafts"], ["submitted", "Submitted"], ["returned", "Returned"], ["approved", "Approved"]]).map((x) => ({ value: x[0], label: x[1] })), f)}
        ${!leader ? `<button class="btn primary block mt-3" data-from-syl>${CP.icon("plus")} New plan from the school syllabus</button><div class="t-xs dim mt-2">Topics, subtopics and objectives come from the syllabus your Director of Studies uploaded. You can also generate a plan from the national scheme under Lessons.</div>` : ""}
        <div class="list mt-3">${shown.map((p) => {
          const m = (p.plan && p.plan.meta) || {};
          const u = S.user(p.by);
          return CP.li({ press: true, attr: `data-plan="${esc(p.id)}"`, name: esc(m.topic || "Lesson plan"),
            meta: `${leader && u ? esc(u.name) + " · " : ""}${esc(m.subject || "")} · ${esc(m.class || "")} · ${esc(CP.time.dayKey(p.submittedAt || p.ts))}`, tail: pill(p) });
        }).join("") || `<div class="t-sm muted text-c" style="padding:16px">${leader ? "No plans in this list." : "No saved plans yet."}</div>`}</div>`,
      after(root) {
        U.bindGo(root, ctx);
        CP.bindSeg(root, "pf", (v) => { st.planFilter = v; CP.render(); });
        const fs = root.querySelector("[data-from-syl]");
        if (fs) fs.onclick = () => planFromSyllabus(me);
        root.querySelectorAll("[data-plan]").forEach((b) => (b.onclick = () => planSheet((S.data.plans || []).find((p) => p.id === b.dataset.plan), leader)));
      },
    };
  }

  function planFromSyllabus(me) {
    const combos = U.combos(me.id);
    const hasSyl = A.list("syllabus").length > 0;
    if (!combos.length) return CP.toast({ kind: "err", msg: "You are not timetabled to teach any class yet." });
    if (!hasSyl) return CP.toast({ kind: "err", msg: "No syllabus has been uploaded yet. Ask the Director of Studies.", ms: 5000 });
    const s = CP.sheet({
      title: "Plan from school syllabus",
      body: `<div class="field mb-3"><label>Class and subject</label><select class="select" data-cs>${combos.map((c, i) => `<option value="${i}">${esc(c.subject)} — ${esc(c.classId)}</option>`).join("")}</select></div>
        <div class="field mb-3"><label>Topic</label><select class="select" data-topic></select></div>
        <div class="field mb-3"><label>Subtopic</label><select class="select" data-sub></select></div>
        <div class="grid g2 mb-4"><div class="field"><label>Date</label><input class="input" type="date" data-date value="${CP.time.dayKey(S.now())}"></div>
        <div class="field"><label>Length</label><select class="select" data-len><option value="1">Single (40 min)</option><option value="2">Double (80 min)</option></select></div></div>
        <button class="btn primary block" data-make>${CP.icon("check")} Create plan</button>`,
    });
    const q = (x) => s.body.querySelector(x);
    const cur = () => combos[+q("[data-cs]").value];
    const topics = () => A.topics({ subject: cur().subject, level: S.classInfo(cur().classId).level });
    const fillTopics = () => {
      const ts = topics();
      q("[data-topic]").innerHTML = ts.length ? ts.map((t) => `<option value="${esc(t.id)}">Term ${esc(t.term)} · ${esc(t.topic)}</option>`).join("") : `<option value="">No syllabus topics for this class</option>`;
      fillSub();
    };
    const fillSub = () => {
      const t = A.get("syllabus", q("[data-topic]").value);
      q("[data-sub]").innerHTML = `<option value="">${t && t.subtopics.length ? "Whole topic" : "—"}</option>` + (t ? t.subtopics.map((x) => `<option>${esc(x)}</option>`).join("") : "");
    };
    fillTopics();
    q("[data-cs]").onchange = fillTopics;
    q("[data-topic]").onchange = fillSub;
    q("[data-make]").onclick = () => {
      const c = cur();
      const t = A.get("syllabus", q("[data-topic]").value);
      if (!t) return CP.toast({ kind: "err", msg: "Choose a topic." });
      const date = q("[data-date]").value;
      const slot = (S.data.timetable || []).find((r) => r.teacherId === me.id && r.classId === c.classId && r.subject === c.subject && r.day === (S.parseKey(date).getDay() || 7)) || {};
      const per = (S.data.settings.periods || []).find((x) => x.n === slot.period);
      const w = A.termWindow(t.term);
      const week = w && date >= w.start ? Math.floor((S.parseKey(date) - S.parseKey(w.start)) / 6048e5) + 1 : (CP.currentWeek ? CP.currentWeek() : "");
      const plan = CP.curriculum.lessonPlan({
        subject: c.subject, level: t.level, className: c.classId, topic: t.topic, subtopic: q("[data-sub]").value || t.subtopics[0] || t.topic,
        content: t.subtopics.join("; "), competences: t.objectives, periods: +q("[data-len]").value, teacherName: me.name,
        week: t.week || week, period: slot.period, time: per ? per.start + "–" + per.end : "", date, term: (S.data.school || {}).term,
      });
      const rec = { id: CP.uid("pl"), plan, text: CP.curriculum.planToText(plan), ts: Date.now(), by: me.id, pushed: false, source: "school-syllabus", topicId: t.id };
      S.data.plans = S.data.plans || [];
      S.data.plans.unshift(rec);
      S.save(true); S.emit("plan", rec);
      s.close(); CP.toast({ kind: "ok", msg: "Plan created from your school syllabus. Review and edit it." });
      planSheet(rec, false);
    };
  }

  function planSheet(p, leader) {
    if (!p) return;
    const m = (p.plan && p.plan.meta) || {};
    const status = p.status || "draft";
    const s = CP.sheet({
      title: m.topic || "Lesson plan",
      body: `<div class="row gap-2 wrap mb-3">${U.pill("brand", m.subject || "")}${U.pill("", m.class || "")}<span class="pill ${status === "approved" ? "ok" : status === "returned" ? "danger" : status === "submitted" ? "warn" : ""}">${esc(status)}</span></div>
        ${p.review && p.review.comment ? CP.banner(status === "returned" ? "warn" : "info", (p.review.byName || "Reviewer") + " said", p.review.comment) : ""}
        <pre class="t-xs" style="white-space:pre-wrap;max-height:42vh;overflow:auto;background:var(--bg-2);padding:10px;border-radius:10px">${esc(p.text || "")}</pre>
        <div class="col gap-2 mt-3">
          ${!leader && (status === "draft" || status === "returned") ? `<button class="btn block" data-edit>${CP.icon("gear")} Edit the text</button>` : ""}
          <button class="btn block" data-print>${CP.icon("download")} Print / save as PDF</button>
          ${!leader && (status === "draft" || status === "returned") ? `<button class="btn primary block" data-submit>${CP.icon("check")} Submit to the Director of Studies</button>` : ""}
          ${leader && status === "submitted" ? `<button class="btn primary block" data-approve>${CP.icon("check")} Approve</button><button class="btn block" data-return>${CP.icon("alert")} Return with a comment</button>` : ""}
        </div><div data-extra></div>`,
    });
    const q = (x) => s.body.querySelector(x);
    if (q("[data-edit]")) q("[data-edit]").onclick = () => {
      const pre = s.body.querySelector("pre");
      pre.outerHTML = `<textarea class="input" rows="14" data-text style="width:100%;font:12px/1.4 monospace">${esc(p.text || "")}</textarea>`;
      q("[data-edit]").outerHTML = `<button class="btn primary block" data-save-text>${CP.icon("check")} Save changes</button>`;
      q("[data-save-text]").onclick = () => {
        p.text = q("[data-text]").value; p.pushed = false; delete p.origin; p.ts = Date.now();
        S.save(true); S.emit("plan", p); s.close(); CP.toast({ kind: "ok", msg: "Plan saved." }); CP.render();
      };
    };
    q("[data-print]").onclick = () => CP.curriculum.printable("Lesson Plan — " + (m.topic || ""), p.text || "");
    if (q("[data-submit]")) q("[data-submit]").onclick = () => { A.submitPlan(p.id); s.close(); CP.toast({ kind: "ok", msg: "Submitted. The DOS has been notified." }); CP.render(); };
    if (q("[data-approve]")) q("[data-approve]").onclick = () => { A.reviewPlan(p.id, "approved", ""); s.close(); CP.render(); };
    if (q("[data-return]")) q("[data-return]").onclick = () => {
      q("[data-extra]").innerHTML = `<div class="field mt-3"><label>What should the teacher change?</label><textarea class="input" rows="3" data-c></textarea></div><button class="btn primary block mt-3" data-send>Send back</button>`;
      q("[data-send]").onclick = () => {
        if (!A.reviewPlan(p.id, "returned", q("[data-c]").value)) return CP.toast({ kind: "err", msg: "Write a comment first." });
        s.close(); CP.render();
      };
    };
  }

  /* ============================================================= ROSTER */
  function roster(ctx) {
    const st = U.state;
    const classes = S.data.classes.map((c) => c.id);
    st.rosterClass = classes.includes(st.rosterClass) ? st.rosterClass : classes[0];
    const cls = st.rosterClass;
    const list = A.list("students").filter((s) => s.classId === cls).sort((a, b) => a.name.localeCompare(b.name));
    return {
      title: "Class lists", sub: "Learners per class",
      html: `${U.back(ctx)}${!classes.length ? CP.empty("No classes yet", "Add classes in People/Settings first.", "users") : `
        <div class="field mb-3"><label>Class</label><select class="select" data-cls>${U.opts(classes, cls)}</select></div>
        <div class="row gap-3 mb-2"><button class="btn primary grow" data-add>${CP.icon("plus")} Add learner</button><button class="btn grow" data-import>${CP.icon("download")} Import CSV</button></div>
        <div class="t-xs dim mb-3">CSV columns: Name, Class, Admission No. Learners already in the class are skipped.</div>
        <div class="list">${list.map((s, i) => CP.li({ press: true, attr: `data-st="${esc(s.id)}"`, name: `${i + 1}. ${esc(s.name)}${s.active === false ? " (inactive)" : ""}`, meta: esc(s.admNo || "No admission number"), tail: CP.icon("chevron") })).join("") || `<div class="t-sm muted text-c" style="padding:16px">No learners in ${esc(cls)} yet.</div>`}</div>`}`,
      after(root) {
        U.bindGo(root, ctx);
        const c = root.querySelector("[data-cls]");
        if (c) c.onchange = () => { st.rosterClass = c.value; CP.render(); };
        const add = root.querySelector("[data-add]");
        if (add) add.onclick = () => learnerForm(null, cls);
        root.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => learnerForm(A.get("students", b.dataset.st), cls)));
        const imp = root.querySelector("[data-import]");
        if (imp) imp.onclick = async () => {
          const text = await U.fileText();
          if (text == null) return;
          const r = A.importStudents(text);
          CP.toast({ kind: r.added ? "ok" : "warn", msg: r.added + " learner(s) added" + (r.bad.length ? "; skipped: " + r.bad.slice(0, 2).join("; ") : ""), ms: 6000 });
          CP.render();
        };
      },
    };
  }
  function learnerForm(st, cls) {
    const isNew = !st;
    st = st || { name: "", admNo: "", classId: cls, active: true };
    const s = CP.sheet({
      title: isNew ? "Add learner" : "Edit learner",
      body: `<div class="field mb-3"><label>Full name</label><input class="input" data-n value="${esc(st.name)}"></div>
        <div class="field mb-3"><label>Admission number</label><input class="input" data-a value="${esc(st.admNo)}"></div>
        <div class="field mb-4"><label>Class</label><select class="select" data-c>${U.opts(S.data.classes.map((c) => c.id), st.classId)}</select></div>
        ${isNew ? "" : `<label class="row gap-3 mb-4"><input type="checkbox" data-act ${st.active !== false ? "checked" : ""}> Active in this class</label>`}
        <div class="row gap-3">${isNew ? "" : `<button class="btn danger" data-del>${CP.icon("trash")}</button>`}<button class="btn primary grow" data-save>${CP.icon("check")} Save</button></div>`,
    });
    const q = (x) => s.body.querySelector(x);
    q("[data-save]").onclick = () => {
      const name = q("[data-n]").value.trim();
      if (!name) return CP.toast({ kind: "err", msg: "Enter the learner’s name." });
      A.save("students", { id: st.id || "st_" + CP.uid("s").slice(2), name, admNo: q("[data-a]").value.trim(), classId: q("[data-c]").value, active: q("[data-act]") ? q("[data-act]").checked : true });
      s.close(); CP.render();
    };
    if (q("[data-del]")) q("[data-del]").onclick = async () => {
      if (!(await CP.confirm({ title: "Remove this learner?", msg: "Marks already entered for them stay in submitted results.", danger: true, ok: "Remove" }))) return;
      A.remove("students", st.id); s.close(); CP.render();
    };
  }

  /* ============================================================== RULES */
  function rules(ctx) {
    const R = A.rules();
    const g = R.grading, ac = R.academic;
    const bands = A.bands();
    return {
      title: "Grading & rules", sub: "Used by marks, reports and alerts",
      html: `${U.back(ctx)}
        <div class="card mb-3"><div class="fw-6 mb-3">Grading</div>
          <div class="field mb-3"><label>Pass mark (%)</label><input class="input" inputmode="numeric" data-pass value="${esc(g.passMark)}"></div>
          <div class="t-xs dim mb-2">Grade bands: a mark at or above “From %” gets that grade. One band must start at 0.</div>
          <div data-bands>${bands.map((b) => bandRow(b)).join("")}</div>
          <button class="btn xs mt-2" data-add-band>${CP.icon("plus")} Add band</button></div>
        <div class="card mb-3"><div class="fw-6 mb-3">Academic rules</div>
          ${[["reminderMin", "Lesson reminder (minutes before the bell)"], ["behindPct", "Syllabus “behind schedule” when this many points below expected"], ["aheadPct", "“Ahead” when this many points above expected"], ["maxLessonsPerDay", "Heavy workload: lessons in one day above"], ["maxLessonsPerWeek", "Heavy workload: lessons per week above"], ["supportBelow", "Learner needs support when average is below (%)"], ["trendDelta", "Improving / declining when change is at least (points)"]]
            .map(([k, l]) => `<div class="field mb-3"><label>${esc(l)}</label><input class="input" inputmode="numeric" data-ac="${k}" value="${esc(ac[k])}"></div>`).join("")}</div>
        <button class="btn primary block" data-save>${CP.icon("check")} Save rules</button>`,
      after(root) {
        U.bindGo(root, ctx);
        const wrap = root.querySelector("[data-bands]");
        root.querySelector("[data-add-band]").onclick = () => wrap.insertAdjacentHTML("beforeend", bandRow({ min: "", grade: "", label: "" }));
        wrap.addEventListener("click", (e) => { const d = e.target.closest("[data-rm]"); if (d) d.closest("[data-band]").remove(); });
        root.querySelector("[data-save]").onclick = () => {
          const nb = Array.from(wrap.querySelectorAll("[data-band]")).map((r) => ({ min: Number(r.querySelector("[data-min]").value), grade: r.querySelector("[data-grade]").value.trim(), label: r.querySelector("[data-label]").value.trim() }));
          const pm = Number(root.querySelector("[data-pass]").value);
          const err = A.validateBands(nb, pm);
          if (err) return CP.toast({ kind: "err", msg: err, ms: 5000 });
          const na = {};
          root.querySelectorAll("[data-ac]").forEach((i) => { const v = Number(i.value); if (isFinite(v) && v >= 0) na[i.dataset.ac] = v; });
          S.data.settings.grading = { passMark: pm, bands: nb };
          S.data.settings.academic = Object.assign({}, S.DEFAULT_SETTINGS.academic, na);
          S.save(true); S.emit("settings");
          S.audit(CP.me().id, "academic-rules-changed", { passMark: pm });
          CP.toast({ kind: "ok", msg: "Rules saved." });
        };
      },
    };
  }
  function bandRow(b) {
    return `<div class="row gap-2 mb-2" data-band><input class="input" style="width:80px" inputmode="numeric" placeholder="From %" data-min value="${esc(b.min)}"><input class="input" style="width:64px" placeholder="Grade" data-grade value="${esc(b.grade)}"><input class="input grow" placeholder="Label" data-label value="${esc(b.label || "")}"><button class="icon-btn" data-rm style="width:34px;height:34px">${CP.icon("trash")}</button></div>`;
  }

  /* ======================================================= CALENDAR EXTRAS */
  // Leaders other than the admin get the same calendar; this adds event types and terms.
  function calendarExtras() {
    const adminCal = CP.views.admin && CP.views.admin.calendar;
    if (!adminCal) return;
    const wrapped = function (ctx) {
      const out = adminCal(ctx);
      const cal = (S.data.calendar = S.data.calendar || { holidays: [], events: [] });
      cal.terms = cal.terms || [];
      const terms = [1, 2, 3].map((n) => cal.terms.find((t) => Number(t.n) === n) || { n, start: "", end: "" });
      const termHtml = `<div class="card mb-4"><div class="fw-6 mb-1">Terms</div><div class="t-xs dim mb-3">Opening and closing dates for each term. Syllabus “expected progress” and reminders use these.</div>
        ${terms.map((t) => `<div class="grid g2 mb-2" data-term="${t.n}"><div class="field"><label>Term ${t.n} opens</label><input class="input" type="date" data-ts value="${esc(t.start)}"></div><div class="field"><label>Term ${t.n} closes</label><input class="input" type="date" data-te value="${esc(t.end)}"></div></div>`).join("")}
        <button class="btn block" data-save-terms>${CP.icon("check")} Save terms</button></div>`;
      const evList = `<div class="card mb-4"><div class="row between mb-3"><div class="fw-6">Exams, meetings and deadlines</div><button class="btn xs" data-add-typed>${CP.icon("plus")} Add</button></div>
        <div class="list">${(cal.events || []).map((e, i) => `<div class="li"><span class="body"><span class="name">${esc(e.name)} ${U.pill("", A.EVENT_TYPES[e.type || "event"])}</span><span class="meta">${esc(e.date)}${e.end && e.end !== e.date ? " → " + esc(e.end) : ""}${e.note ? " · " + esc(e.note) : ""}</span></span></div>`).join("") || `<div class="t-sm muted text-c" style="padding:10px">None yet.</div>`}</div>
        <div class="t-xs dim mt-2">Exams, meetings and deadlines alert staff the day before.</div></div>`;
      const html = out.html;
      const hi = html.indexOf('<div class="fw-6">Holidays</div>');
      const at = hi >= 0 ? html.lastIndexOf('<div class="card mb-4">', hi) : -1;
      out.html = at >= 0 ? html.slice(0, at) + termHtml + evList + html.slice(at) : html + termHtml + evList;
      const prevAfter = out.after;
      out.after = function (root, c) {
        if (prevAfter) prevAfter(root, c);
        const q = (x) => root.querySelector(x);
        if (q("[data-save-terms]")) q("[data-save-terms]").onclick = () => {
          const next = [];
          for (const row of root.querySelectorAll("[data-term]")) {
            const s = row.querySelector("[data-ts]").value, e = row.querySelector("[data-te]").value;
            if (!s && !e) continue;
            if (!s || !e || e < s) return CP.toast({ kind: "err", msg: "Term " + row.dataset.term + ": the closing date must come after the opening date." });
            next.push({ n: Number(row.dataset.term), start: s, end: e });
          }
          for (let i = 1; i < next.length; i++) if (next[i].start <= next[i - 1].end) return CP.toast({ kind: "err", msg: "Terms must not overlap." });
          cal.terms = next; S.save(true); S.emit("settings"); CP.toast({ kind: "ok", msg: "Terms saved." }); CP.render();
        };
        if (q("[data-add-typed]")) q("[data-add-typed]").onclick = async () => {
          const type = await CP.pick({ title: "What is it?", options: ["exam", "meeting", "deadline", "event"].map((k) => ({ label: A.EVENT_TYPES[k], value: k })) });
          if (!type) return;
          const name = await CP.prompt({ title: "Name", label: type === "exam" ? "e.g. Mid-term examinations" : "e.g. Marks submission deadline" });
          if (!name) return;
          const date = await CP.prompt({ title: "Date", label: "YYYY-MM-DD", type: "date" });
          if (!date) return;
          const end = type === "exam" ? await CP.prompt({ title: "Last day (optional)", label: "YYYY-MM-DD, leave empty for one day", type: "date" }) : "";
          cal.events = cal.events || [];
          cal.events.push({ name, date, end: end && end >= date ? end : "", type, note: "" });
          S.save(true); S.emit("settings"); CP.render();
        };
      };
      return out;
    };
    CP.views.admin.calendar = wrapped;
    ["dos", "head"].forEach((r) => { CP.views[r] = CP.views[r] || {}; CP.views[r].calendar = wrapped; });
  }

  /* ============================================================ register */
  ["teacher", "dos", "head", "admin"].forEach((role) => {
    CP.views[role] = CP.views[role] || {};
    CP.views[role].academics = hub;
    CP.views[role].syllabus = syllabus;
    CP.views[role].plans = plans;
  });
  ["dos", "head", "admin"].forEach((role) => { CP.views[role].roster = roster; CP.views[role].rules = rules; });

  /* ===================================================== DASHBOARD WIDGETS */
  // Appended to the existing dashboards so the DOS and teachers see academics at a glance.
  function leaderWidget() {
    const pendingMarks = A.list("assessments").filter((a) => a.status === "submitted").length;
    const pendingPlans = (S.data.plans || []).filter((p) => p.status === "submitted").length;
    const tcs = A.teacherCoverage();
    const behind = tcs.filter((t) => t.status === "behind");
    const ahead = tcs.filter((t) => t.status === "ahead");
    const up = A.upcoming(14).slice(0, 3);
    return `<div class="card mt-5"><div class="row between mb-3"><div class="fw-7">Academic monitoring</div><button class="btn xs" data-go-ac>Open ${CP.icon("chevron")}</button></div>
      <div class="grid g2">
        ${CP.stat({ k: "Marks to approve", v: pendingMarks, tone: pendingMarks ? "warn" : "ok" })}
        ${CP.stat({ k: "Plans to review", v: pendingPlans, tone: pendingPlans ? "warn" : "ok" })}
        ${CP.stat({ k: "Behind schedule", v: behind.length, tone: behind.length ? "danger" : "ok", d: ahead.length + " ahead" })}
        ${CP.stat({ k: "Syllabus covered", v: tcs.length ? Math.round(tcs.reduce((a, t) => a + t.done, 0) / Math.max(1, tcs.reduce((a, t) => a + t.units, 0)) * 100) + "%" : "—", d: tcs.length + " teachers" })}
      </div>
      ${behind.length ? `<div class="t-sm mt-3"><b>Behind:</b> ${behind.slice(0, 3).map((t) => esc(t.teacherName) + " (" + t.pct + "% vs " + t.expected + "%)").join(", ")}</div>` : ""}
      ${up.length ? `<div class="t-sm mt-2 dim">${up.map((x) => esc(x.name) + " · " + esc(x.date)).join(" · ")}</div>` : ""}</div>`;
  }
  function teacherWidget(ctx) {
    const me = ctx.me;
    const k = CP.time.dayKey(S.now());
    const mine = S.instancesForDate(k).filter((i) => i.teacherId === me.id);
    const periods = (S.data.settings.periods || []).length;
    const count = (f) => mine.filter(f).length;
    const rows = A.coverageRows().filter((r) => r.teacherId === me.id);
    const as = A.myAssessments(me.id);
    const returned = as.filter((a) => a.status === "returned").length;
    const drafts = as.filter((a) => a.status === "draft").length;
    return `<div class="card mt-5"><div class="row between mb-3"><div class="fw-7">My teaching today</div><button class="btn xs" data-go-ac>Academics ${CP.icon("chevron")}</button></div>
      ${mine.length ? `<div class="row gap-2 wrap t-sm mb-3">${U.pill("ok", count((i) => ["on-time", "late", "covered"].includes(i.state)) + " completed")}${U.pill("info", count((i) => i.state === "pending") + " pending")}${U.pill(count((i) => ["missing", "absent"].includes(i.state)) ? "danger" : "", count((i) => ["missing", "absent"].includes(i.state)) + " missed")}${U.pill("", Math.max(0, periods - mine.length) + " free periods")}</div>` : `<div class="t-sm muted mb-3">No lessons today.</div>`}
      ${rows.map((r) => `<div class="mb-2"><div class="row between t-sm mb-1"><span class="fw-6">${esc(r.subject)} ${esc(r.classId)}</span><span class="mono">${r.pct}%</span></div>${U.bar(r.pct, r.expected)}</div>`).join("")}
      <div class="t-sm mt-2">${returned ? `<span class="danger fw-6">${returned} test(s) returned for correction.</span> ` : ""}${drafts ? drafts + " draft test(s) not yet submitted." : ""}${!returned && !drafts && rows.length === 0 ? "Syllabus progress and tests will appear here." : ""}</div></div>`;
  }
  function wrapWidget(role, tab, fn) {
    const base = CP.views[role] && CP.views[role][tab];
    if (!base) return;
    CP.views[role][tab] = function (ctx) {
      const out = base(ctx);
      let extra = "";
      try { extra = fn(ctx); } catch (e) { console.error("widget", e); }
      out.html = out.html + extra;
      const prev = out.after;
      out.after = function (root, c) {
        if (prev) prev(root, c);
        const b = root.querySelector("[data-go-ac]");
        if (b) b.onclick = () => CP.go("/" + ctx.role + "/academics");
      };
      return out;
    };
  }
  wrapWidget("dos", "pulse", leaderWidget);
  wrapWidget("head", "overview", leaderWidget);
  wrapWidget("teacher", "home", teacherWidget);
  calendarExtras();
  U.planSheet = planSheet;
})(window);
