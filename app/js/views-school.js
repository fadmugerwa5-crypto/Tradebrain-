/* ==========================================================================
   ClassPulse — views-school.js
   School setup (checklist, bulk classes, class manager, term start, join code,
   starting-PIN sheet) and the weekly summary for the Director of Studies.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const A = CP.acad;
  const U = CP.acadUI;
  const X = CP.exp;
  const esc = CP.esc;
  const school = (CP.school = {});
  const ROMAN = { 1: "I", 2: "II", 3: "III" };

  /* ----------------------------------------------------------- join code */
  const isLocalHost = (u) => { try { const h = new URL(u).hostname; return h === "localhost" || h === "127.0.0.1" || h === "::1"; } catch (e) { return false; } };
  school.joinPayload = function () {
    const st = CP.sync && CP.sync.state ? CP.sync.state() : {};
    if (!st.server) return null;
    return "CPJOIN|" + st.server + "|" + String((S.data.school || {}).name || "").replace(/\|/g, " ");
  };
  school.parseJoin = function (text) {
    const m = /^CPJOIN\|([^|]+)\|?(.*)$/.exec(String(text || "").trim());
    if (!m) return null;
    let url = m[1].trim();
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; url = u.origin; } catch (e) { return null; }
    return { server: url, school: m[2].trim() };
  };
  school.applyJoin = function (text, done) {
    const j = school.parseJoin(text);
    if (!j) { CP.toast({ kind: "err", msg: "That is not a ClassPulse join code." }); return Promise.resolve(false); }
    CP.toast({ msg: "Connecting to " + (j.school || "the school") + "…" });
    return CP.sync.setServer(j.server, { forgetToken: true }).then((ok) => {
      if (!ok) { CP.toast({ kind: "err", msg: "Could not reach the school server. Check your internet or Wi-Fi." }); return false; }
      CP.toast({ kind: "ok", msg: "Connected" + (j.school ? " to " + j.school : "") + "." });
      return CP.sync.syncNow().then(() => { if (done) done(); else CP.render(); return true; });
    });
  };
  school.scanJoin = function (done) {
    const sheet = CP.sheet({
      title: "Scan the join code",
      body: `<div class="scanner mb-4"><video data-video playsinline muted></video><canvas data-canvas class="hidden"></canvas>
        <div class="reticle"><div class="frame"><i></i><i></i><i></i><i></i></div></div><div class="laser"></div><div class="off hidden" data-off></div></div>
        <p class="t-sm muted">On the administrator's phone: Admin → School setup → Show join code.</p>`,
    });
    const scanner = CP.qr.createScanner(sheet.body.querySelector("[data-video]"), sheet.body.querySelector("[data-canvas]"), (text) => {
      if (!school.parseJoin(text)) return;
      scanner.stop(); sheet.close();
      school.applyJoin(text, done);
    });
    const off = sheet.body.querySelector("[data-off]");
    scanner.start().catch((e) => {
      off.classList.remove("hidden");
      off.innerHTML = `<div class="fw-6">Camera not available</div><div class="t-sm muted mt-2">${esc(e.message || "Permission denied")}</div><div class="t-xs dim mt-2">You can type the server address instead.</div>`;
    });
    sheet._onCloseHook = () => { try { scanner.stop(); } catch (e) {} };
    const orig = sheet.close;
    sheet.close = function () { try { scanner.stop(); } catch (e) {} orig(); };
  };
  function joinSheet() {
    const payload = school.joinPayload();
    const st = CP.sync && CP.sync.state ? CP.sync.state() : {};
    if (!payload) {
      return CP.sheet({ title: "Join code", body: `<p class="t-sm">This phone is not connected to a school server, so there is nothing for other phones to join yet.</p>
        <p class="t-sm muted">Connect to your server first (sign-in screen → School server). After that, this screen shows a code that teachers scan once.</p>` });
    }
    CP.sheet({
      title: "Join code",
      body: `<div style="background:#fff;padding:14px;border-radius:16px;border:6px solid #0b1020;margin:0 auto 12px;max-width:300px">${CP.qr.svg(payload, { cell: 8 }).replace(/<svg /, '<svg style="width:100%;height:auto;display:block" ')}</div>
        <div class="t-sm text-c"><b>${esc((S.data.school || {}).name || "")}</b></div>
        <div class="t-xs dim text-c mono mt-1" style="word-break:break-all">${esc(st.server)}</div>
        ${isLocalHost(st.server) ? CP.banner("warn", "This address only works on this device", "“localhost” cannot be reached from other phones. Use the server's Wi-Fi or https address instead.") : ""}
        <p class="t-sm muted mt-3">Teachers install the app, tap <b>Scan the school's join code</b> on the sign-in screen and point the camera here. They do this once.</p>`,
    });
  }

  /* ------------------------------------------------------------ PIN sheet */
  school.showPinSheet = function (pins) {
    if (!pins || !pins.length) return CP.toast({ msg: "Nobody needed a starting PIN." });
    const st = CP.sync && CP.sync.state ? CP.sync.state() : {};
    const rows = pins.map((p) => [p.name, p.staffNo, (CP.ROLES[p.role] || {}).short || p.role, p.pin]);
    const sheet = CP.sheet({
      title: "Starting PINs",
      body: `${CP.banner("warn", "Shown only now", "PINs are stored scrambled, so this list cannot be shown again. Print it or save it, then hand each person their own line privately.")}
        <div class="table-wrap mt-3"><table><thead><tr><th>Name</th><th>Staff no.</th><th>PIN</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="mono">${esc(r[1])}</td><td class="mono fw-7">${esc(r[3])}</td></tr>`).join("")}</tbody></table></div>
        <div class="row gap-3 mt-4"><button class="btn primary grow" data-print>${CP.icon("download")} Print / PDF</button><button class="btn grow" data-xlsx>Excel</button></div>`,
    });
    const meta = ["Keep private — one line per person", st.server ? "School server: " + st.server : "School server: ask the administrator"];
    sheet.body.querySelector("[data-print]").onclick = () => X.print("Staff sign-in sheet", [{ columns: ["Name", "Staff no.", "Role", "Starting PIN"], rows, note: "Sign in with your staff number and this PIN. This sheet is confidential." }], meta);
    sheet.body.querySelector("[data-xlsx]").onclick = () => X.download(X.xlsxBlob([{ name: "Starting PINs", rows: [["Name", "Staff no.", "Role", "Starting PIN"]].concat(rows) }]), "classpulse-starting-pins.xlsx");
  };

  /* -------------------------------------------------------- setup checklist */
  school.checklist = function () {
    const teachers = S.teachers().length;
    const hasDos = S.data.users.some((u) => u.role === "dos" && u.active !== false);
    const cal = S.data.calendar || {};
    const termSet = (cal.terms || []).length > 0 || (cal.termStart && cal.termEnd);
    const conn = CP.sync && CP.sync.state ? CP.sync.state() : {};
    const items = [
      { id: "staff", done: teachers > 0, t: "Add the teachers", m: teachers ? teachers + " added" : "Import a staff list or add them one by one", go: "people" },
      { id: "dos", done: hasDos, t: "Add the Director of Studies", m: hasDos ? "Done" : "People → Add → Role: Director of Studies", go: "people" },
      { id: "classes", done: S.data.classes.length > 0, t: "Create the classes and streams", m: S.data.classes.length ? S.data.classes.length + " classes" : "S1–S6 with streams, in one go", act: "classes" },
      { id: "tt", done: S.data.timetable.length > 0, t: "Upload the timetable", m: S.data.timetable.length ? S.data.timetable.length + " lessons" : "Import a CSV or build it by hand", go: "timetable" },
      { id: "term", done: !!termSet, t: "Set the term dates", m: termSet ? "Done" : "Needed for reminders and syllabus progress", act: "term" },
      { id: "qr", done: !!(S.data.meta && S.data.meta.qrPrinted), t: "Print the QR posters", m: "Gate and every classroom door", go: "qr", optional: true },
      { id: "phones", done: !!conn.server, t: "Connect the phones", m: conn.server ? "Server connected — show the join code to teachers" : "Connect to your school server, then show the join code", act: "join" },
      { id: "learners", done: S.data.acad && (S.data.acad.students || []).length > 0, t: "Add learners (for marks)", m: "Academics → Class lists", go: "roster", optional: true },
      { id: "syllabus", done: S.data.acad && (S.data.acad.syllabus || []).length > 0, t: "Upload the syllabus", m: "Academics → Syllabus", go: "syllabus", optional: true },
    ];
    const required = items.filter((i) => !i.optional);
    return { items, doneCount: required.filter((i) => i.done).length, total: required.length };
  };

  /* ----------------------------------------------------------- bulk classes */
  function bulkClassesCard() {
    return `<div class="card mb-4"><div class="fw-7 mb-1">Create classes in one go</div>
      <div class="t-xs dim mb-3">Type a range or a list. Each class gets its own room and QR code. Classes that already exist are left alone.</div>
      <div class="grid g2 mb-3"><div class="field"><label>Levels</label><input class="input" data-lv placeholder="S1-S6" value="S1-S4"></div>
      <div class="field"><label>Streams (blank for none)</label><input class="input" data-st placeholder="A, B, C or A-D" value="A, B"></div></div>
      <div class="t-sm mb-3" data-prev></div>
      <button class="btn primary block" data-make>${CP.icon("plus")} Create classes</button></div>`;
  }

  function classManagerCard() {
    const list = S.data.classes.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return `<div class="card mb-4"><div class="fw-7 mb-3">Classes (${list.length})</div>
      <div class="list">${list.map((c) => { const u = S.classUsage(c.id); return CP.li({ press: true, attr: `data-cls="${esc(c.id)}"`, name: esc(c.id), meta: `${u.lessons} lessons · ${u.learners} learners`, tail: CP.icon("chevron") }); }).join("") || `<div class="t-sm muted text-c" style="padding:12px">No classes yet.</div>`}</div></div>`;
  }

  function classSheet(id) {
    const u = S.classUsage(id);
    const s = CP.sheet({
      title: "Class " + id,
      body: `<div class="t-sm mb-3">${u.lessons} lessons · ${u.learners} learners · ${u.assessments} assessments</div>
        <div class="field mb-3"><label>Rename to</label><input class="input" data-new value="${esc(id)}"></div>
        <button class="btn block mb-3" data-rename>${CP.icon("gear")} Rename</button>
        <div class="t-xs dim mb-3">Renaming moves its lessons. Its room gets a <b>new QR code</b>, so reprint that classroom's poster. A class with learners, marks or syllabus progress cannot be renamed.</div>
        <button class="btn danger block" data-del>${CP.icon("trash")} Delete class</button>`,
    });
    s.body.querySelector("[data-rename]").onclick = () => {
      const r = S.renameClass(id, s.body.querySelector("[data-new]").value);
      if (!r.ok) return CP.toast({ kind: "err", msg: r.reason, ms: 7000 });
      S.audit(CP.me().id, "rename-class", { from: id, to: r.id });
      if (CP.sync && CP.sync._token) CP.sync.pushConfig();
      s.close(); CP.toast({ kind: "ok", msg: id + " is now " + r.id + ". Reprint its QR poster." }); CP.render();
    };
    s.body.querySelector("[data-del]").onclick = async () => {
      const us = S.classUsage(id);
      if (us.assessments) return CP.toast({ kind: "err", msg: id + " has " + us.assessments + " assessment(s) with marks. Marks are never deleted with a class. Remove those first or keep the class.", ms: 7000 });
      const ok = await CP.confirm({
        title: "Delete " + id + "?",
        msg: `This removes its ${us.lessons} lessons, its room and its QR code (the printed poster stops working)${us.learners ? ", and its " + us.learners + " learners" : ""}. This cannot be undone.`,
        danger: true, ok: "Delete",
      });
      if (!ok) return;
      A.list("students").filter((x) => x.classId === id).forEach((x) => A.remove("students", x.id));
      A.list("progress").filter((x) => x.classId === id).forEach((x) => A.remove("progress", x.id));
      S.deleteClass(id);
      S.audit(CP.me().id, "delete-class", { id });
      if (CP.sync && CP.sync._token) CP.sync.pushConfig();
      s.close(); CP.toast({ kind: "ok", msg: id + " deleted." }); CP.render();
    };
  }

  /* ----------------------------------------------------------- start a term */
  function termSheet() {
    const cal = (S.data.calendar = S.data.calendar || { holidays: [], events: [] });
    const cur = A.currentTerm();
    const year = new Date().getFullYear();
    const s = CP.sheet({
      title: "Start a term",
      body: `<p class="t-sm muted mb-3">Sets this term's dates and the name shown across the app. <b>Nothing is deleted</b>: last term's records, marks and syllabus progress stay, and each term keeps its own syllabus topics.</p>
        <div class="grid g2 mb-3"><div class="field"><label>Term</label><select class="select" data-n>${U.opts(["1", "2", "3"], cur)}</select></div>
        <div class="field"><label>Year</label><input class="input" inputmode="numeric" data-y value="${year}"></div></div>
        <div class="grid g2 mb-4"><div class="field"><label>Opens</label><input class="input" type="date" data-s></div><div class="field"><label>Closes</label><input class="input" type="date" data-e></div></div>
        <button class="btn primary block" data-save>${CP.icon("check")} Start this term</button>`,
    });
    const q = (x) => s.body.querySelector(x);
    const fill = () => { const t = (cal.terms || []).find((x) => String(x.n) === q("[data-n]").value); q("[data-s]").value = t ? t.start : ""; q("[data-e]").value = t ? t.end : ""; };
    fill(); q("[data-n]").onchange = fill;
    q("[data-save]").onclick = () => {
      const n = Number(q("[data-n]").value), st = q("[data-s]").value, en = q("[data-e]").value, y = q("[data-y]").value.trim();
      if (!st || !en) return CP.toast({ kind: "err", msg: "Enter the opening and closing dates." });
      if (en <= st) return CP.toast({ kind: "err", msg: "The closing date must come after the opening date." });
      const others = (cal.terms || []).filter((t) => Number(t.n) !== n);
      const clash = others.find((t) => !(en < t.start || st > t.end));
      if (clash) return CP.toast({ kind: "err", msg: "These dates overlap Term " + clash.n + "." });
      cal.terms = others.concat([{ n, start: st, end: en }]).sort((a, b) => a.n - b.n);
      cal.termStart = st; cal.termEnd = en;
      S.data.school.term = "Term " + ROMAN[n] + (y ? " " + y : "");
      S.data.reminded = {};
      S.save(true); S.emit("settings");
      S.audit(CP.me().id, "start-term", { term: n, start: st, end: en });
      s.close(); CP.toast({ kind: "ok", msg: S.data.school.term + " started." }); CP.render();
    };
  }

  /* ------------------------------------------------------------ setup screen */
  function setup(ctx) {
    const cl = school.checklist();
    const pct = Math.round((cl.doneCount / cl.total) * 100);
    return {
      title: "School setup", sub: cl.doneCount + " of " + cl.total + " essentials done",
      html: `<div class="card mb-4"><div class="row between mb-2"><div class="fw-7">Setup checklist</div><div class="mono">${pct}%</div></div>${U.bar(pct)}
        <div class="list mt-3">${cl.items.map((i) => CP.li({
          press: true, attr: `data-item="${i.id}"`,
          lead: `<span style="width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:${i.done ? "var(--ok)" : "var(--bg-2)"};color:${i.done ? "#fff" : "var(--fg-3)"}">${i.done ? CP.icon("check") : ""}</span>`,
          name: esc(i.t) + (i.optional ? ` <span class="t-xs dim">(optional)</span>` : ""), meta: esc(i.m), tail: CP.icon("chevron"),
        })).join("")}</div></div>
        ${bulkClassesCard()}${classManagerCard()}
        <div class="card mb-4"><div class="fw-7 mb-3">More tools</div><div class="col gap-3">
          <button class="btn block" data-join>${CP.icon("qr")} Show join code for teachers</button>
          <button class="btn block" data-term>${CP.icon("calendar")} Start a new term</button>
          <button class="btn block" data-qr>${CP.icon("qr")} Print the QR posters</button>
          <button class="btn block" data-people>${CP.icon("key")} Staff and starting PINs</button></div></div>`,
      after(root) {
        const q = (x) => root.querySelector(x);
        root.querySelectorAll("[data-item]").forEach((b) => (b.onclick = () => {
          const i = cl.items.find((x) => x.id === b.dataset.item);
          if (i.go) CP.go("/" + ctx.role + "/" + i.go);
          else if (i.act === "classes") q("[data-lv]").scrollIntoView({ behavior: "smooth", block: "center" });
          else if (i.act === "term") termSheet();
          else if (i.act === "join") joinSheet();
        }));
        const prev = () => {
          const plan = S.planClasses(q("[data-lv]").value, q("[data-st]").value);
          const fresh = plan.filter((c) => !c.exists);
          q("[data-prev]").innerHTML = !plan.length ? `<span class="dim">Nothing to create yet.</span>` : `<b>${fresh.length}</b> new${plan.length - fresh.length ? ", " + (plan.length - fresh.length) + " already exist" : ""}: <span class="dim">${plan.slice(0, 24).map((c) => esc(c.id)).join(", ")}${plan.length > 24 ? "…" : ""}</span>`;
          return fresh;
        };
        q("[data-lv]").oninput = prev; q("[data-st]").oninput = prev; prev();
        q("[data-make]").onclick = () => {
          const fresh = prev();
          if (!fresh.length) return CP.toast({ kind: "warn", msg: "No new classes to create." });
          if (fresh.length > 80) return CP.toast({ kind: "err", msg: "That is too many classes at once." });
          fresh.forEach((c) => S.saveClass({ id: c.id, level: c.level, stream: c.stream }));
          S.audit(CP.me().id, "bulk-classes", { count: fresh.length });
          if (CP.sync && CP.sync._token) CP.sync.pushConfig();
          CP.toast({ kind: "ok", msg: fresh.length + " classes created, each with its own room and QR code." }); CP.render();
        };
        root.querySelectorAll("[data-cls]").forEach((b) => (b.onclick = () => classSheet(b.dataset.cls)));
        q("[data-join]").onclick = joinSheet;
        q("[data-term]").onclick = termSheet;
        q("[data-qr]").onclick = () => { S.data.meta.qrPrinted = true; S.save(); CP.go("/" + ctx.role + "/qr"); };
        q("[data-people]").onclick = () => CP.go("/" + ctx.role + "/people");
      },
    };
  }

  /* ----------------------------------------------------------- weekly summary */
  school.weeklyData = function (days) {
    days = days || 7;
    const teachers = S.teachers();
    const att = teachers.map((t) => {
      const s = S.teacherStats(t.id, days);
      return [t.name, s.present, s.absent, s.lateGate, s.lessons, s.missedLessons, s.lessons ? s.punctuality + "%" : "—"];
    });
    const missed = A.runReport("missed", { days, from: CP.time.dayKey(new Date(S.now().getTime() - (days - 1) * 864e5)), to: CP.time.dayKey(S.now()) });
    const behind = A.teacherCoverage().filter((t) => t.status === "behind").map((t) => [t.teacherName, t.pct + "%", t.expected === null ? "—" : t.expected + "%"]);
    const waitingMarks = A.list("assessments").filter((a) => a.status === "submitted").map((a) => { const u = S.user(a.teacherId); return [a.title, a.subject, a.classId, u ? u.name : ""]; });
    const waitingPlans = (S.data.plans || []).filter((p) => p.status === "submitted").map((p) => { const m = (p.plan && p.plan.meta) || {}; const u = S.user(p.by); return [m.topic || "Lesson plan", m.subject || "", m.class || "", u ? u.name : ""]; });
    const up = A.upcoming(days).map((x) => [x.name, x.date, A.EVENT_TYPES[x.type] || (x.type === "holiday" ? "Holiday" : x.type)]);
    return {
      days,
      tables: [
        { heading: "Teacher attendance and punctuality", columns: ["Teacher", "Days present", "Days absent", "Late arrivals", "Lessons", "Missed", "Lesson punctuality"], rows: att },
        { heading: "Missed lessons", columns: missed.columns, rows: missed.rows.slice(0, 40) },
        { heading: "Syllabus behind schedule", columns: ["Teacher", "Covered", "Expected"], rows: behind },
        { heading: "Marks waiting for approval", columns: ["Assessment", "Subject", "Class", "Teacher"], rows: waitingMarks },
        { heading: "Lesson plans waiting for review", columns: ["Topic", "Subject", "Class", "Teacher"], rows: waitingPlans },
        { heading: "Coming up", columns: ["Event", "Date", "Type"], rows: up },
      ],
    };
  };
  function weekly(ctx) {
    const st = U.state;
    const days = st.weekDays || 7;
    const d = school.weeklyData(days);
    return {
      title: "Weekly summary", sub: "Last " + days + " days", wide: true,
      html: `<button class="btn xs ghost mb-3" data-back>${CP.icon("chevron")} Academics</button>
        ${CP.seg("wd", [{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }], String(days))}
        <div class="row gap-3 mt-3 mb-4"><button class="btn primary grow" data-print>${CP.icon("download")} Print / PDF</button><button class="btn grow" data-xlsx>Excel</button></div>
        ${d.tables.map((t) => `<div class="fw-6 mt-4 mb-2">${esc(t.heading)} <span class="dim t-sm">· ${t.rows.length}</span></div>
          <div class="table-wrap"><table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v == null ? "" : v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${t.columns.length}" class="muted" style="padding:10px">Nothing to report.</td></tr>`}</tbody></table></div>`).join("")}`,
      after(root) {
        root.querySelector("[data-back]").onclick = () => CP.go("/" + ctx.role + "/academics");
        CP.bindSeg(root, "wd", (v) => { st.weekDays = Number(v); CP.render(); });
        const title = "Weekly summary — last " + days + " days";
        root.querySelector("[data-print]").onclick = () => X.print(title, d.tables, ["Period ending " + CP.time.dayKey(S.now())]);
        root.querySelector("[data-xlsx]").onclick = () => X.download(X.xlsxBlob(d.tables.map((t) => ({ name: t.heading.slice(0, 28), rows: [t.columns].concat(t.rows) }))), "classpulse-weekly-" + CP.time.dayKey(S.now()) + ".xlsx");
      },
    };
  }

  /* ----------------------------------------------------- admin overview card */
  const baseOverview = CP.views.admin && CP.views.admin.overview;
  if (baseOverview) {
    CP.views.admin.overview = function (ctx) {
      const out = baseOverview(ctx);
      const cl = school.checklist();
      const card = cl.doneCount < cl.total
        ? `<div class="card mb-4"><div class="row between mb-2"><div class="fw-7">Finish setting up your school</div><div class="mono">${cl.doneCount}/${cl.total}</div></div>${U.bar(Math.round((cl.doneCount / cl.total) * 100))}
            <div class="t-sm muted mt-2">Next: ${esc((cl.items.find((i) => !i.done && !i.optional) || {}).t || "")}</div><button class="btn primary block mt-3" data-open-setup>${CP.icon("check")} Open the checklist</button></div>`
        : `<button class="btn block mb-4" data-open-setup>${CP.icon("check")} School setup tools</button>`;
      out.html = card + out.html;
      const prev = out.after;
      out.after = function (root, c) {
        if (prev) prev(root, c);
        const b = root.querySelector("[data-open-setup]");
        if (b) b.onclick = () => CP.go("/admin/schoolsetup");
      };
      return out;
    };
  }

  CP.views.admin.schoolsetup = setup;
  ["dos", "head", "admin"].forEach((r) => { CP.views[r] = CP.views[r] || {}; CP.views[r].weekly = weekly; });
})(window);
