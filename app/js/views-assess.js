/* ==========================================================================
   ClassPulse — views-assess.js
   Tests & marks, performance analysis, workload, reports, AI assistant.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const A = CP.acad;
  const U = CP.acadUI;
  const X = CP.exp;
  const esc = CP.esc;
  const fmtDate = (k) => { try { return S.parseKey(k).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return k; } };

  /* ============================================================ ASSESSMENTS */
  function assess(ctx) {
    const st = U.state;
    const as = st.assessOpen && A.get("assessments", st.assessOpen);
    if (as) return editor(ctx, as);
    st.assessOpen = null;
    return U.isLeader(ctx) ? assessLeader(ctx, st) : assessTeacher(ctx, st);
  }

  function assessRow(a, leader) {
    const t = S.user(a.teacherId);
    const s = A.assessStats(a);
    return CP.li({
      press: true, attr: `data-as="${esc(a.id)}"`,
      name: esc(a.title),
      meta: `${esc(a.subject)} · ${esc(a.classId)} · ${esc(fmtDate(a.date))}${leader && t ? " · " + esc(t.name) : ""}${s.avgPct !== null ? " · avg " + s.avgPct + "%" : ""}`,
      tail: U.assessPill(a.status) + (a.rejected ? " " + U.pill("danger", "Not saved") : ""),
    });
  }

  function assessTeacher(ctx, st) {
    const me = ctx.me;
    const list = A.myAssessments(me.id);
    return {
      title: "My tests & marks", sub: list.length + " assessment" + (list.length === 1 ? "" : "s"),
      html: `${U.back(ctx)}<button class="btn primary block mb-3" data-new>${CP.icon("plus")} New test or examination</button>
        ${list.some((a) => a.status === "returned") ? CP.banner("warn", "Marks returned for correction", "Open the assessment marked “Returned” to see what the DOS asked you to change.") : ""}
        <div class="list">${list.map((a) => assessRow(a, false)).join("") || `<div class="t-sm muted text-c" style="padding:16px">No assessments yet. Create one, enter marks, then submit to the Director of Studies.</div>`}</div>`,
      after(root) {
        U.bindGo(root, ctx);
        root.querySelector("[data-new]").onclick = () => newAssessment(me);
        root.querySelectorAll("[data-as]").forEach((b) => (b.onclick = () => { st.assessOpen = b.dataset.as; CP.render(); }));
      },
    };
  }

  function newAssessment(me) {
    const combos = U.combos(me.id);
    if (!combos.length) return CP.toast({ kind: "err", msg: "You are not timetabled to teach any class yet." });
    const s = CP.sheet({
      title: "New assessment",
      body: `<div class="field mb-3"><label>Class and subject</label><select class="select" data-cs>${combos.map((c, i) => `<option value="${i}">${esc(c.subject)} — ${esc(c.classId)}</option>`).join("")}</select></div>
        <div class="field mb-3"><label>Title</label><input class="input" data-title placeholder="e.g. Integers test"></div>
        <div class="grid g2 mb-3"><div class="field"><label>Type</label><select class="select" data-kind>${U.opts([{ v: "test", l: "Test" }, { v: "exam", l: "Examination" }, { v: "quiz", l: "Quiz" }, { v: "assignment", l: "Assignment" }, { v: "practical", l: "Practical" }], "test")}</select></div>
        <div class="field"><label>Total marks</label><input class="input" inputmode="numeric" data-total value="100"></div></div>
        <div class="grid g2 mb-3"><div class="field"><label>Term</label><select class="select" data-term>${U.opts(["1", "2", "3"], A.currentTerm())}</select></div>
        <div class="field"><label>Date</label><input class="input" type="date" data-date value="${CP.time.dayKey(S.now())}"></div></div>
        <div class="field mb-4"><label>Syllabus topic (optional — lets reports find weak topics)</label><select class="select" data-topic></select></div>
        <button class="btn primary block" data-create>${CP.icon("check")} Create</button>`,
    });
    const q = (x) => s.body.querySelector(x);
    const fillTopics = () => {
      const c = combos[+q("[data-cs]").value];
      const level = S.classInfo(c.classId).level;
      const ts = A.topics({ subject: c.subject, level });
      q("[data-topic]").innerHTML = `<option value="">No specific topic</option>` + ts.map((t) => `<option value="${esc(t.id)}">Term ${esc(t.term)} · ${esc(t.topic)}</option>`).join("");
    };
    fillTopics();
    q("[data-cs]").onchange = fillTopics;
    q("[data-create]").onclick = () => {
      const c = combos[+q("[data-cs]").value];
      const title = q("[data-title]").value.trim();
      const total = Number(q("[data-total]").value);
      if (!title) return CP.toast({ kind: "err", msg: "Give the assessment a title." });
      if (!isFinite(total) || total < 1 || total > 1000) return CP.toast({ kind: "err", msg: "Total marks must be between 1 and 1000." });
      const rec = A.save("assessments", { id: "as_" + CP.uid("a").slice(2), teacherId: me.id, classId: c.classId, subject: c.subject, title, kind: q("[data-kind]").value, term: q("[data-term]").value, date: q("[data-date]").value, total, topicId: q("[data-topic]").value || null, status: "draft", marks: {}, createdAt: S.now().getTime() });
      U.state.assessOpen = rec.id; s.close(); CP.render();
    };
  }

  function assessLeader(ctx, st) {
    const tab = st.assessTab || "review";
    const all = A.list("assessments").slice().sort((a, b) => (b.submittedAt || b.ts || 0) - (a.submittedAt || a.ts || 0));
    const review = all.filter((a) => a.status === "submitted");
    let body = "";
    if (tab === "review") body = `<div class="list">${review.map((a) => assessRow(a, true)).join("") || `<div class="t-sm muted text-c" style="padding:16px">Nothing is waiting for approval.</div>`}</div>`;
    else if (tab === "all") {
      const f = { classId: st.aClass || "", subject: st.aSubject || "" };
      const subs = Array.from(new Set(all.map((a) => a.subject))).sort();
      const rows = all.filter((a) => (!f.classId || a.classId === f.classId) && (!f.subject || a.subject === f.subject));
      body = `<div class="grid g2 mb-3"><div class="field"><label>Class</label><select class="select" data-af="aClass"><option value="">All</option>${U.opts(S.data.classes.map((c) => c.id), f.classId)}</select></div>
        <div class="field"><label>Subject</label><select class="select" data-af="aSubject"><option value="">All</option>${U.opts(subs, f.subject)}</select></div></div>
        <div class="list">${rows.map((a) => assessRow(a, true)).join("") || `<div class="t-sm muted text-c" style="padding:16px">No assessments.</div>`}</div>`;
    } else {
      const au = A.list("markaudit").slice().sort((a, b) => b.ts - a.ts).slice(0, 150);
      const LBL = { created: "created the assessment", "marks-changed": "changed marks", submitted: "submitted for approval", approved: "approved", returned: "returned for correction", "edited-after-approval": "corrected approved marks" };
      body = `<div class="t-xs dim mb-3">Every change to marks, recorded by the server with who made it and when. It cannot be edited.</div>
        <div class="list">${au.map((e) => `<div class="li" ${e.changes && e.changes.length ? `data-au="${esc(e.id)}" style="cursor:pointer"` : ""}><div class="body"><div class="name">${esc(e.byName || e.by)} ${esc(LBL[e.action] || e.action)}</div>
          <div class="meta">${esc(e.title)} · ${esc(e.subject)} ${esc(e.classId)} · ${esc(new Date(e.ts).toLocaleString())}${e.changes && e.changes.length ? " · " + e.changes.length + " mark(s)" : ""}${e.reason ? " · “" + esc(e.reason) + "”" : ""}</div></div></div>`).join("") || `<div class="t-sm muted text-c" style="padding:16px">No changes recorded yet.</div>`}</div>`;
    }
    return {
      title: "Tests & examinations", sub: review.length ? review.length + " awaiting approval" : "Review and approve marks",
      html: `${U.back(ctx)}${CP.seg("atab", [{ value: "review", label: "To review" + (review.length ? " (" + review.length + ")" : "") }, { value: "all", label: "All results" }, { value: "audit", label: "Audit trail" }], tab)}<div class="mt-4">${body}</div>`,
      after(root) {
        U.bindGo(root, ctx);
        CP.bindSeg(root, "atab", (v) => { st.assessTab = v; CP.render(); });
        root.querySelectorAll("[data-as]").forEach((b) => (b.onclick = () => { st.assessOpen = b.dataset.as; CP.render(); }));
        root.querySelectorAll("[data-af]").forEach((el) => (el.onchange = () => { st[el.dataset.af] = el.value; CP.render(); }));
        root.querySelectorAll("[data-au]").forEach((el) => (el.onclick = () => {
          const e = A.list("markaudit").find((x) => x.id === el.dataset.au);
          if (!e) return;
          CP.sheet({ title: e.title, body: `<div class="t-sm mb-3">${esc(e.byName)} · ${esc(new Date(e.ts).toLocaleString())}${e.reason ? "<br>Reason: " + esc(e.reason) : ""}</div>` + e.changes.map((c) => { const stu = A.get("students", c.studentId); return `<div class="row between t-sm" style="padding:5px 0"><span>${esc(stu ? stu.name : c.studentId)}</span><span class="mono">${c.from == null ? "—" : esc(c.from)} → ${c.to == null ? "—" : esc(c.to)}</span></div>`; }).join("") });
        }));
      },
    };
  }

  function editor(ctx, as) {
    const me = ctx.me;
    const leader = U.isLeader(ctx);
    const can = A.editable(as, me);
    const roster = A.roster(as.classId);
    const teacher = S.user(as.teacherId);
    const drawStats = (a) => {
      const s = A.assessStats(a);
      return `<div class="grid g2"><div class="stat"><div class="k">Class average</div><div class="v">${s.avgPct === null ? "—" : s.avgPct + "%"}</div></div>
        <div class="stat"><div class="k">Pass rate</div><div class="v">${s.passRate === null ? "—" : s.passRate + "%"}</div><div class="d">fail ${s.failRate === null ? "—" : s.failRate + "%"}</div></div>
        <div class="stat"><div class="k">Highest</div><div class="v">${s.highest ? s.highest.mark + "/" + a.total : "—"}</div><div class="d">${s.highest ? esc(s.highest.student.name) : ""}</div></div>
        <div class="stat"><div class="k">Lowest</div><div class="v">${s.lowest ? s.lowest.mark + "/" + a.total : "—"}</div><div class="d">${s.lowest ? esc(s.lowest.student.name) : ""}</div></div></div>
        <div class="t-xs dim mt-2">${s.sat} sat · ${s.absent} absent · ${s.notEntered} not entered · total marks ${s.totalMarks}</div>`;
    };
    return {
      title: as.title, sub: `${as.subject} · ${as.classId} · out of ${as.total}`,
      html: `<button class="btn xs ghost mb-3" data-close-as>${CP.icon("chevron")} Back</button>
        <div class="row between mb-3"><div>${U.assessPill(as.status)}${teacher && leader ? ` <span class="t-sm dim">${esc(teacher.name)}</span>` : ""}</div><div class="t-xs dim">${esc(fmtDate(as.date))} · Term ${esc(as.term)}</div></div>
        ${as.status === "returned" && as.returnNote ? CP.banner("warn", "Returned for correction", as.returnNote) : ""}
        ${as.rejected ? CP.banner("danger", "The server did not accept your last save", as.rejected) : ""}
        ${!roster.length ? CP.banner("warn", "No class list for " + as.classId, "The Director of Studies adds learners under Academics → Class lists. Marks can only be entered for learners on the list.") : ""}
        ${!can && !leader ? CP.banner("info", as.status === "approved" ? "Approved" : "Submitted", "These results are locked while the Director of Studies reviews them.") : ""}
        <div class="card mb-3" data-stats>${drawStats(as)}</div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Learner</th><th style="width:96px">Mark /${as.total}</th><th>%</th><th>Grade</th></tr></thead>
        <tbody>${roster.map((s, i) => { const v = (as.marks || {})[s.id]; return `<tr data-row="${esc(s.id)}"><td>${i + 1}</td><td>${esc(s.name)}<div class="t-xs dim">${esc(s.admNo || "")}</div></td>
          <td><input class="input" data-m="${esc(s.id)}" inputmode="decimal" ${can ? "" : "disabled"} value="${v === undefined ? "" : esc(v)}" placeholder="AB = absent" style="min-height:34px;padding:6px 8px;width:92px"></td>
          <td class="mono" data-p>${typeof v === "number" ? A.markPct(v, as.total) + "%" : ""}</td><td data-g>${typeof v === "number" ? esc(A.grade(A.markPct(v, as.total))) : v === "AB" ? "AB" : ""}</td></tr>`; }).join("")}</tbody></table></div>
        <div class="col gap-2 mt-4">
          ${can ? `<button class="btn ${leader ? "primary" : ""} block" data-save>${CP.icon("check")} ${leader && as.status === "approved" ? "Save correction" : "Save as draft"}</button>` : ""}
          ${!leader && can ? `<button class="btn primary block" data-submit>${CP.icon("check")} Submit to the Director of Studies</button>` : ""}
          ${leader && as.status === "submitted" ? `<div class="row gap-3"><button class="btn primary grow" data-approve>${CP.icon("check")} Approve</button><button class="btn grow" data-return>${CP.icon("alert")} Return</button></div>` : ""}
          ${leader && as.status === "approved" ? `<button class="btn block" data-return>${CP.icon("alert")} Return to teacher</button>` : ""}
          <div class="row gap-3"><button class="btn grow" data-print>${CP.icon("download")} Print / PDF</button><button class="btn grow" data-xlsx>${CP.icon("download")} Excel</button></div>
          ${leader && as.status !== "approved" ? `<button class="btn ghost danger block" data-del>${CP.icon("trash")} Delete assessment</button>` : ""}
        </div>`,
      after(root) {
        const q = (x) => root.querySelector(x);
        q("[data-close-as]").onclick = () => { U.state.assessOpen = null; CP.render(); };
        const working = () => {
          const copy = Object.assign({}, as, { marks: Object.assign({}, as.marks) });
          let bad = null;
          root.querySelectorAll("[data-m]").forEach((inp) => {
            const r = A.setMark(copy, inp.dataset.m, inp.value);
            inp.style.borderColor = r.ok ? "" : "var(--danger)";
            if (!r.ok && !bad) bad = r.reason;
          });
          return { copy, bad };
        };
        root.querySelectorAll("[data-m]").forEach((inp) => (inp.oninput = () => {
          const { copy } = working();
          const row = inp.closest("tr"), v = copy.marks[inp.dataset.m];
          row.querySelector("[data-p]").textContent = typeof v === "number" ? A.markPct(v, as.total) + "%" : "";
          row.querySelector("[data-g]").textContent = typeof v === "number" ? A.grade(A.markPct(v, as.total)) : v === "AB" ? "AB" : "";
          q("[data-stats]").innerHTML = drawStats(copy);
        }));
        const persist = async () => {
          const { copy, bad } = working();
          if (bad) { CP.toast({ kind: "err", msg: bad }); return null; }
          const rec = { id: as.id, marks: copy.marks };
          if (leader && as.status === "approved") {
            const reason = await CP.prompt({ title: "Why are you changing approved marks?", label: "Reason (kept in the audit trail)" });
            if (!reason || !reason.trim()) { CP.toast({ kind: "err", msg: "A reason is required." }); return null; }
            rec.reason = reason.trim();
          }
          return A.save("assessments", Object.assign({}, as, rec));
        };
        if (q("[data-save]")) q("[data-save]").onclick = async () => { if (await persist()) { CP.toast({ kind: "ok", msg: "Saved." }); CP.render(); } };
        if (q("[data-submit]")) q("[data-submit]").onclick = async () => {
          const { copy, bad } = working();
          if (bad) return CP.toast({ kind: "err", msg: bad });
          const missing = roster.filter((s) => copy.marks[s.id] === undefined).length;
          if (!Object.keys(copy.marks).length) return CP.toast({ kind: "err", msg: "Enter at least one mark first." });
          if (!(await CP.confirm({ title: "Submit these results?", msg: (missing ? missing + " learner(s) have no mark yet. " : "") + "You cannot edit them again unless the Director of Studies returns them.", ok: "Submit" }))) return;
          const rec = await persist();
          if (!rec) return;
          const r = A.submitAssessment(as.id);
          CP.toast({ kind: r.ok ? "ok" : "err", msg: r.ok ? "Submitted. The DOS has been notified." : r.reason }); CP.render();
        };
        if (q("[data-approve]")) q("[data-approve]").onclick = async () => {
          if (!(await CP.confirm({ title: "Approve these results?", msg: "They will count in performance reports.", ok: "Approve" }))) return;
          A.reviewAssessment(as.id, "approved"); CP.toast({ kind: "ok", msg: "Approved." }); U.state.assessOpen = null; CP.render();
        };
        if (q("[data-return]")) q("[data-return]").onclick = async () => {
          const note = await CP.prompt({ title: "Return for correction", label: "What should the teacher check?" });
          if (note == null) return;
          const r = A.reviewAssessment(as.id, "returned", note);
          if (!r.ok) return CP.toast({ kind: "err", msg: r.reason });
          CP.toast({ kind: "ok", msg: "Returned to the teacher." }); U.state.assessOpen = null; CP.render();
        };
        if (q("[data-del]")) q("[data-del]").onclick = async () => {
          if (!(await CP.confirm({ title: "Delete this assessment?", msg: "Its marks are removed.", danger: true, ok: "Delete" }))) return;
          A.remove("assessments", as.id); U.state.assessOpen = null; CP.render();
        };
        const sheet = () => {
          const s = A.assessStats(as);
          const head = [["Subject", as.subject], ["Class", as.classId], ["Assessment", as.title], ["Date", as.date], ["Term", as.term], ["Teacher", teacher ? teacher.name : ""], ["Status", as.status]];
          const cols = ["#", "Learner", "Adm. no.", "Mark /" + as.total, "%", "Grade"];
          const rows = s.rows.map((r, i) => [i + 1, r.student.name, r.student.admNo || "", r.mark === null ? (r.absent ? "AB" : "") : r.mark, r.pct === null ? "" : r.pct, r.grade]);
          const sum = [["Learners sat", s.sat], ["Absent", s.absent], ["Total marks", s.totalMarks], ["Class average (%)", s.avgPct === null ? "" : s.avgPct], ["Highest", s.highest ? s.highest.mark : ""], ["Lowest", s.lowest ? s.lowest.mark : ""], ["Pass rate (%)", s.passRate === null ? "" : s.passRate], ["Failure rate (%)", s.failRate === null ? "" : s.failRate]];
          return { head, cols, rows, sum };
        };
        q("[data-print]").onclick = () => { const d = sheet(); X.print("Mark sheet — " + as.title, [{ columns: d.cols, rows: d.rows }, { heading: "Summary", columns: ["Measure", "Value"], rows: d.sum }], d.head.map((h) => h[0] + ": " + h[1])); };
        q("[data-xlsx]").onclick = () => { const d = sheet(); X.download(X.xlsxBlob([{ name: "Marks", rows: [d.cols].concat(d.rows) }, { name: "Summary", rows: [["Measure", "Value"]].concat(d.head, d.sum) }]), "marks-" + as.classId + "-" + as.subject.replace(/\W+/g, "-") + "-" + as.title.replace(/\W+/g, "-") + ".xlsx"); };
      },
    };
  }

  /* ============================================================ PERFORMANCE */
  function perf(ctx) {
    const st = U.state;
    const leader = U.isLeader(ctx);
    const me = ctx.me;
    st.pTerm = st.pTerm || "";
    const base = leader ? {} : { teacherId: me.id };
    const classes = leader ? S.data.classes.map((c) => c.id) : Array.from(new Set(U.combos(me.id).map((c) => c.classId)));
    const subs = leader ? S.subjects() : Array.from(new Set(U.combos(me.id).map((c) => c.subject)));
    const f = Object.assign({}, base, { classId: st.pClass || "", subject: st.pSubject || "", term: st.pTerm, includeSubmitted: !!st.pSub });
    const p = A.performance(f);
    const tp = A.topicPerformance(f).filter((t) => t.weak);
    const sp = A.subjectPerformance(f);
    const cp = A.classPerformance(f);
    const arrow = (t) => ({ improving: `<span class="ok">▲ improving</span>`, declining: `<span class="danger">▼ declining</span>`, steady: `<span class="dim">● steady</span>`, "n/a": `<span class="dim">—</span>` })[t];
    return {
      title: leader ? "Performance analysis" : "My class performance", sub: p.assessments + " approved assessment" + (p.assessments === 1 ? "" : "s"),
      html: `${U.back(ctx)}<div class="grid g3 mb-3">
          <div class="field"><label>Class</label><select class="select" data-pf="pClass"><option value="">All</option>${U.opts(classes, f.classId)}</select></div>
          <div class="field"><label>Subject</label><select class="select" data-pf="pSubject"><option value="">All</option>${U.opts(subs, f.subject)}</select></div>
          <div class="field"><label>Term</label><select class="select" data-pf="pTerm"><option value="">All</option>${U.opts(["1", "2", "3"], f.term)}</select></div></div>
        <label class="row gap-3 t-sm mb-4"><input type="checkbox" data-sub ${st.pSub ? "checked" : ""}> Also include results still awaiting approval</label>
        ${!p.students.length ? CP.empty("No results to analyse", "Analysis uses approved assessments with marks. Once results are approved they appear here.", "chart") : `
        <div class="grid g2 mb-4">
          ${CP.stat({ k: "Class average", v: p.classAvg + "%", tone: p.classAvg >= A.passMark() ? "ok" : "danger", d: "of each learner’s average" })}
          ${CP.stat({ k: "Pass rate", v: p.passRate + "%", tone: p.passRate >= 50 ? "ok" : "warn", d: "fail rate " + p.failRate + "%" })}
          ${CP.stat({ k: "Highest / lowest", v: p.highest + "% / " + p.lowest + "%", d: "single results" })}
          ${CP.stat({ k: "Need support", v: p.support.length, tone: p.support.length ? "danger" : "ok", d: "average below " + A.rules().academic.supportBelow + "%" })}
        </div>
        ${p.support.length ? `${CP.section("Learners needing academic support")}<div class="card"><div class="col gap-2">${p.support.map((s) => `<div class="row between t-sm"><span class="fw-6">${esc(s.student.name)} <span class="dim">${esc(s.student.classId)}</span></span><span class="mono danger">${s.avg}%</span></div>`).join("")}</div></div>` : ""}
        <div class="grid g2 mt-4">
          <div class="card"><div class="upper dim mb-2">Improving (${p.improving.length})</div>${p.improving.map((s) => `<div class="t-sm row between"><span>${esc(s.student.name)}</span><span class="ok mono">+${s.change}</span></div>`).join("") || `<div class="t-sm muted">None yet</div>`}</div>
          <div class="card"><div class="upper dim mb-2">Declining (${p.declining.length})</div>${p.declining.map((s) => `<div class="t-sm row between"><span>${esc(s.student.name)}</span><span class="danger mono">${s.change}</span></div>`).join("") || `<div class="t-sm muted">None</div>`}</div>
        </div>
        ${sp.length > 1 || cp.length > 1 ? `<div class="grid g2 mt-4">
          ${sp.length ? `<div class="card"><div class="upper dim mb-2">Subjects</div>${sp.map((s) => `<div class="row between t-sm" style="padding:3px 0"><span>${esc(s.subject)}</span><span class="mono ${s.low ? "danger" : ""}">${s.avg}%${s.low ? " ⚠" : ""}</span></div>`).join("")}</div>` : ""}
          ${cp.length ? `<div class="card"><div class="upper dim mb-2">Classes</div>${cp.map((c) => `<div class="row between t-sm" style="padding:3px 0"><span>${esc(c.classId)}</span><span class="mono">${c.avg}%</span></div>`).join("")}</div>` : ""}</div>` : ""}
        ${tp.length ? `${CP.section("Topics where learners struggle")}<div class="card"><div class="col gap-2">${tp.map((t) => `<div class="row between t-sm"><span><span class="fw-6">${esc(t.topic)}</span> <span class="dim">${esc(t.subject)} ${esc(t.level)}</span></span><span class="mono danger">${t.avg}% · ${t.belowShare}% below pass</span></div>`).join("")}</div></div>` : `<div class="t-xs dim mt-3">Link assessments to a syllabus topic when you create them, and weak topics will be listed here.</div>`}
        ${CP.section("Every learner")}
        <div class="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Results</th><th>Average</th><th>Grade</th><th>Trend</th></tr></thead>
        <tbody>${p.students.map((s) => `<tr><td>${esc(s.student.name)}</td><td>${esc(s.student.classId)}</td><td class="mono">${s.results}</td><td class="mono ${s.needsSupport ? "danger" : ""}">${s.avg}%</td><td>${esc(s.grade)}</td><td>${arrow(s.trend)}</td></tr>`).join("")}</tbody></table></div>`}`,
      after(root) {
        U.bindGo(root, ctx);
        root.querySelectorAll("[data-pf]").forEach((el) => (el.onchange = () => { st[el.dataset.pf] = el.value; CP.render(); }));
        root.querySelector("[data-sub]").onchange = (e) => { st.pSub = e.target.checked; CP.render(); };
      },
    };
  }

  /* ============================================================== WORKLOAD */
  const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];
  function workload(ctx) {
    const leader = U.isLeader(ctx);
    if (!leader) {
      const w = A.workload(ctx.me.id);
      return { title: "My workload", sub: w.week + " lessons a week", html: U.back(ctx) + workloadCard(w), after: (r) => U.bindGo(r, ctx) };
    }
    const all = A.workloadAll();
    const issues = A.timetableIssues();
    return {
      title: "Workload & timetable", sub: "School average " + all.avg + " lessons a week",
      html: `${U.back(ctx)}
        ${issues.length ? CP.banner("warn", issues.length + " timetable problem" + (issues.length > 1 ? "s" : ""), "Fix these in Timetable — notifications and monitoring rely on a clean timetable.") + `<div class="card flat mb-4">${issues.slice(0, 12).map((i) => `<div class="t-sm" style="padding:4px 0">• ${esc(i.text)}</div>`).join("")}${issues.length > 12 ? `<div class="t-xs dim">+ ${issues.length - 12} more</div>` : ""}</div>` : CP.banner("info", "Timetable checks passed", "No double-booked teachers, rooms or classes, and no lessons without a teacher.")}
        <div class="table-wrap"><table><thead><tr><th>Teacher</th><th>Lessons/wk</th><th>Hours/wk</th><th>Free/wk</th><th>Load</th></tr></thead>
        <tbody>${all.rows.map((r) => `<tr data-w="${esc(r.teacher.id)}" style="cursor:pointer"><td>${esc(r.teacher.name)}</td><td class="mono">${r.week}</td><td class="mono">${r.weekHours}</td><td class="mono">${r.freePeriodsWeek}</td><td>${r.flag === "heavy" ? U.pill("danger", "Heavy") : r.flag === "light" ? U.pill("info", "Light") : r.flag === "none" ? U.pill("", "No lessons") : U.pill("ok", "Balanced")}</td></tr>`).join("")}</tbody></table></div>`,
      after(root) {
        U.bindGo(root, ctx);
        root.querySelectorAll("[data-w]").forEach((tr) => (tr.onclick = () => {
          const r = all.rows.find((x) => x.teacher.id === tr.dataset.w);
          CP.sheet({ title: r.teacher.name, body: (r.why.length ? CP.banner(r.flag === "heavy" ? "warn" : "info", r.flag === "heavy" ? "Heavy workload" : "Light workload", r.why.join("; ")) : "") + workloadCard(r) });
        }));
      },
    };
  }
  function workloadCard(w) {
    const max = Math.max(1, A.rules().academic.maxLessonsPerDay);
    return `<div class="grid g2 mb-3">${CP.stat({ k: "This week", v: w.week + " lessons", d: w.weekHours + " teaching hours" })}${CP.stat({ k: "This month", v: w.month + " lessons", d: w.monthHours + " hours (holidays removed)" })}
      ${CP.stat({ k: "Free periods / week", v: w.freePeriodsWeek })}${CP.stat({ k: "Progress this week", v: w.taught + " taught", d: w.pending + " pending · " + w.missed + " missed" + (w.covered ? " · " + w.covered + " covered" : ""), tone: w.missed ? "warn" : "ok" })}</div>
      <div class="card"><div class="upper dim mb-3">Daily workload</div>${w.perDay.map((d) => `<div class="mb-2"><div class="row between t-sm mb-1"><span class="fw-6">${DAYS[d.day]}</span><span class="mono dim">${d.lessons} lessons · ${r1(d.mins / 60)} h · ${d.free} free</span></div>${U.bar(Math.min(100, (d.lessons / max) * 100))}</div>`).join("")}</div>`;
  }
  const r1 = (n) => Math.round(n * 10) / 10;

  /* =============================================================== REPORTS */
  function acreports(ctx) {
    const st = U.state;
    const leader = U.isLeader(ctx);
    const me = ctx.me;
    const allowed = leader ? A.REPORTS : A.REPORTS.filter((r) => ["lessons", "missed", "workload", "syllabus", "exam-results", "plans", "subject-perf", "class-perf"].includes(r.id));
    st.repId = allowed.some((r) => r.id === st.repId) ? st.repId : allowed[0].id;
    const today = CP.time.dayKey(S.now());
    const f = { from: st.rFrom || CP.time.dayKey(new Date(S.now().getTime() - 29 * 864e5)), to: st.rTo || today, teacherId: leader ? st.rTeacher || "" : me.id, subject: st.rSubject || "", classId: st.rClass || "", term: st.rTerm || A.currentTerm() };
    f.days = Math.max(1, Math.min(400, Math.round((S.parseKey(f.to) - S.parseKey(f.from)) / 864e5) + 1));
    const rep = A.runReport(st.repId, f);
    const def = A.REPORTS.find((r) => r.id === st.repId);
    const needs = def.needs;
    return {
      title: leader ? "Reports" : "My reports", sub: "Built from real records", wide: true,
      html: `${U.back(ctx)}
        <div class="field mb-3"><label>Report</label><select class="select" data-rep>${U.opts(allowed.map((r) => ({ v: r.id, l: r.label })), st.repId)}</select></div>
        <div class="grid g3 mb-3">
          ${needs.includes("range") || needs.includes("date") ? `<div class="field"><label>${needs.includes("date") ? "Date" : "From"}</label><input class="input" type="date" data-rf="${needs.includes("date") ? "rTo" : "rFrom"}" value="${esc(needs.includes("date") ? f.to : f.from)}"></div>${needs.includes("range") ? `<div class="field"><label>To</label><input class="input" type="date" data-rf="rTo" value="${esc(f.to)}"></div>` : ""}` : ""}
          ${needs.includes("term") ? `<div class="field"><label>Term</label><select class="select" data-rf="rTerm">${U.opts(["1", "2", "3"], f.term)}</select></div>` : ""}
          ${leader ? `<div class="field"><label>Teacher</label><select class="select" data-rf="rTeacher"><option value="">All</option>${U.opts(S.teachers().map((t) => ({ v: t.id, l: t.name })), f.teacherId)}</select></div>` : ""}
          <div class="field"><label>Subject</label><select class="select" data-rf="rSubject"><option value="">All</option>${U.opts(S.subjects(), f.subject)}</select></div>
          <div class="field"><label>Class</label><select class="select" data-rf="rClass"><option value="">All</option>${U.opts(S.data.classes.map((c) => c.id), f.classId)}</select></div>
        </div>
        <div class="row gap-3 mb-3"><button class="btn primary grow" data-print>${CP.icon("download")} Print / PDF</button><button class="btn grow" data-xlsx>${CP.icon("download")} Excel</button><button class="btn grow" data-csv>CSV</button></div>
        <div class="fw-6 mb-2">${esc(rep.title)} <span class="dim t-sm">· ${rep.rows.length} row${rep.rows.length === 1 ? "" : "s"}</span></div>
        <div class="table-wrap"><table><thead><tr>${rep.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rep.rows.slice(0, 300).map((r) => `<tr>${r.map((v) => `<td>${esc(v == null ? "" : v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${rep.columns.length}" class="muted text-c" style="padding:16px">No records for these filters.</td></tr>`}</tbody></table></div>
        ${rep.rows.length > 300 ? `<div class="t-xs dim mt-2">Showing 300 of ${rep.rows.length}. Print or export for the full report.</div>` : ""}
        ${rep.note ? `<div class="t-xs dim mt-2">${esc(rep.note)}</div>` : ""}`,
      after(root) {
        U.bindGo(root, ctx);
        root.querySelector("[data-rep]").onchange = (e) => { st.repId = e.target.value; CP.render(); };
        root.querySelectorAll("[data-rf]").forEach((el) => (el.onchange = () => { st[el.dataset.rf] = el.value; CP.render(); }));
        const meta = ["Filters: " + [needs.includes("range") ? f.from + " to " + f.to : needs.includes("date") ? f.to : "", f.teacherId ? (S.user(f.teacherId) || {}).name : "", f.subject, f.classId, needs.includes("term") ? "Term " + f.term : ""].filter(Boolean).join(", ")];
        const file = "classpulse-" + rep.id + "-" + today;
        root.querySelector("[data-print]").onclick = () => X.print(rep.title, [{ columns: rep.columns, rows: rep.rows, note: rep.note }], meta);
        root.querySelector("[data-xlsx]").onclick = () => X.download(X.xlsxBlob(A.reportSheets(rep)), file + ".xlsx");
        root.querySelector("[data-csv]").onclick = () => X.download(new Blob(["\uFEFF" + X.csv(rep.columns, rep.rows)], { type: "text/csv" }), file + ".csv");
      },
    };
  }

  /* ============================================================ AI ASSISTANT */
  function assistant(ctx) {
    const st = U.state;
    const admin = ctx.own === "admin";
    const api = CP.sync && CP.sync.request;
    const online = !!(CP.sync && CP.sync._server && CP.sync._token);
    st.ai = st.ai || { status: null, loading: false, result: "", err: "" };
    const ai = st.ai;
    const topics = A.list("syllabus").slice().sort((a, b) => a.subject.localeCompare(b.subject) || a.level.localeCompare(b.level) || Number(a.term) - Number(b.term) || (a.order || 0) - (b.order || 0));
    if (online && ai.status === null && !ai.loading) {
      ai.loading = true;
      api("GET", "/api/ai/status").then((r) => { ai.status = r; }).catch(() => { ai.status = { enabled: false, unreachable: true }; }).finally(() => { ai.loading = false; if (location.hash.indexOf("/assistant") > 0) CP.render(); });
    }
    const on = ai.status && ai.status.enabled;
    return {
      title: "AI teaching assistant", sub: "Optional — nothing else depends on it",
      html: `${U.back(ctx)}${CP.banner("info", "Optional extra", "The school runs fully without this. Attendance, timetables, syllabus, marks and reports never call it.")}
        ${!online ? `<div class="card mt-3"><div class="t-sm">The assistant runs on the school server. Connect to the school server to use it.</div></div>` : ai.status === null ? `<div class="t-sm muted mt-3">Checking…</div>` : !on ? `<div class="card mt-3"><div class="fw-6 mb-1">The assistant is switched off</div><div class="t-sm muted">${ai.status.unreachable ? "The server could not be reached." : admin ? "Enter an API key below to turn it on." : "Ask the system administrator if the school wants to enable it."}</div></div>` : `
        <div class="card mt-3"><div class="field mb-3"><label>What do you need?</label><select class="select" data-task>${U.opts([{ v: "explain", l: "Explain the topic with examples" }, { v: "notes", l: "Teaching notes" }, { v: "questions", l: "Examination questions" }, { v: "exercises", l: "Exercises" }, { v: "methods", l: "Teaching methods" }, { v: "revision", l: "Revision material" }], st.aiTask || "explain")}</select></div>
          <div class="field mb-3"><label>Syllabus topic</label><select class="select" data-topic>${topics.length ? topics.map((t) => `<option value="${esc(t.id)}" ${t.id === st.aiTopic ? "selected" : ""}>${esc(t.subject)} · ${esc(t.level)} · ${esc(t.topic)}</option>`).join("") : `<option value="">No syllabus topics uploaded</option>`}</select></div>
          <div class="field mb-3"><label>Anything to add? (optional)</label><textarea class="input" rows="2" data-note placeholder="e.g. class is weak on fractions"></textarea></div>
          <button class="btn primary block" data-ask ${topics.length ? "" : "disabled"}>${CP.icon("sparkle")} Ask</button></div>
        ${ai.err ? CP.banner("warn", "No answer", ai.err) : ""}
        ${ai.result ? `<div class="card mt-3"><pre style="white-space:pre-wrap;font:inherit" class="t-sm">${esc(ai.result)}</pre><div class="row gap-3 mt-3"><button class="btn grow" data-copy>Copy</button><button class="btn grow" data-print>Print</button></div><div class="t-xs dim mt-2">Written by an AI from your school’s syllabus entry. Check it before using it with learners.</div></div>` : ""}`}
        ${admin && online && ai.status ? `<div class="card mt-4"><div class="fw-6 mb-2">Administrator settings</div>
          <div class="t-xs dim mb-3">The key is kept on the school server and is never sent to phones. ${ai.status.hasKey ? "A key is saved." : "No key saved."}</div>
          <div class="field mb-3"><label>API key</label><input class="input" type="password" data-key placeholder="${ai.status.hasKey ? "Leave empty to keep the saved key" : "Paste key"}" autocomplete="off"></div>
          <div class="grid g2 mb-3"><div class="field"><label>Model</label><input class="input" data-model value="${esc(ai.status.model || "claude-sonnet-5-5")}"></div><div class="field"><label>Daily limit per teacher</label><input class="input" inputmode="numeric" data-limit value="${esc(ai.status.dailyLimit || 30)}"></div></div>
          <label class="row gap-3 mb-3"><input type="checkbox" data-en ${ai.status.enabled ? "checked" : ""}> Assistant enabled</label>
          <div class="row gap-3"><button class="btn primary grow" data-cfg>Save</button>${ai.status.hasKey ? `<button class="btn danger" data-clear>Remove key</button>` : ""}</div></div>` : ""}`,
      after(root) {
        U.bindGo(root, ctx);
        const q = (x) => root.querySelector(x);
        const rerender = () => { ai.status = null; CP.render(); };
        if (q("[data-ask]")) q("[data-ask]").onclick = () => {
          st.aiTask = q("[data-task]").value; st.aiTopic = q("[data-topic]").value;
          q("[data-ask]").disabled = true; q("[data-ask]").textContent = "Thinking…";
          api("POST", "/api/ai/ask", { task: st.aiTask, topicId: st.aiTopic, prompt: q("[data-note]").value }, { timeout: 40000 })
            .then((r) => { ai.result = r.text; ai.err = ""; }).catch((e) => { ai.result = ""; ai.err = e.message || "The assistant could not be reached."; }).finally(() => CP.render());
        };
        if (q("[data-copy]")) q("[data-copy]").onclick = () => { try { navigator.clipboard.writeText(ai.result); CP.toast({ kind: "ok", msg: "Copied." }); } catch (e) { CP.toast({ kind: "err", msg: "Could not copy." }); } };
        if (q("[data-print]")) q("[data-print]").onclick = () => CP.curriculum.printable("Teaching material", ai.result);
        if (q("[data-cfg]")) q("[data-cfg]").onclick = () => {
          const body = { enabled: q("[data-en]").checked, model: q("[data-model]").value, dailyLimit: Number(q("[data-limit]").value) };
          if (q("[data-key]").value.trim()) body.apiKey = q("[data-key]").value.trim();
          api("POST", "/api/ai/config", body).then(() => { CP.toast({ kind: "ok", msg: "Saved." }); rerender(); }).catch((e) => CP.toast({ kind: "err", msg: e.message }));
        };
        if (q("[data-clear]")) q("[data-clear]").onclick = () => api("POST", "/api/ai/config", { clearKey: true }).then(() => { CP.toast({ kind: "ok", msg: "Key removed. Assistant is off." }); rerender(); });
      },
    };
  }

  ["teacher", "dos", "head", "admin"].forEach((role) => {
    CP.views[role] = CP.views[role] || {};
    Object.assign(CP.views[role], { assess, perf, workload, acreports, assistant });
  });
})(window);
