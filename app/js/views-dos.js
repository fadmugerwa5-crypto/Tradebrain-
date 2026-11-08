/* ==========================================================================
   ClassPulse — views-dos.js
   Director of Studies: live pulse board, staff, timetable, coverage.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const V = (CP.views.dos = CP.views.dos || {});

  /* ============================================================ LIVE PULSE */
  V.pulse = function (ctx) {
    const now = S.now();
    const dateKey = CP.time.dayKey(now);
    const per = S.periodAt(now);
    const d = S.dayStats(dateKey);
    const inst = S.instancesForDate(dateKey);
    const current = per.kind === "period" ? inst.filter((i) => i.period === per.n) : [];
    const uncovered = current.filter((i) => i.state === "missing" || i.state === "absent");
    const ok = current.filter((i) => i.state === "on-time" || i.state === "covered");
    const late = current.filter((i) => i.state === "late");
    const pending = current.filter((i) => i.state === "pending");
    const gate = S.gateSummary(dateKey);
    const gToday = inst.filter((i) => ["on-time", "late", "covered"].includes(i.state)).length;
    const series = S.rangeStats(14).map((x) => x.coverage);
    const lateList = S.teachers().filter((t) => { const g = gate.log[t.id]; return g && g.mins > CP.time.mins(S.data.settings.lateAfter); })
      .sort((a, b) => gate.log[b.id].mins - gate.log[a.id].mins);
    const notIn = S.teachers().filter((t) => !gate.log[t.id]);

    return {
      title: "Live pulse",
      sub: CP.time.dayName(now) + " · " + (per.kind === "period" ? "Period " + per.n + " until " + per.end : per.kind === "break" ? per.label : "Outside lessons") + " · " + CP.time.hm(now),
      html: `
        <div class="hero">
          <div class="row between mb-4">
            <div>
              <div class="upper dim">Right now</div>
              <div class="t-2xl fw-7" style="letter-spacing:-.035em">
                ${per.kind === "period" ? ok.length + " / " + current.length + " classes covered" : "No lesson in session"}
              </div>
              <div class="t-sm muted mt-1">${uncovered.length ? uncovered.length + " class" + (uncovered.length === 1 ? "" : "es") + " without a teacher" : "Every class has a teacher"}</div>
            </div>
            ${CP.charts.ring(CP.pct(ok.length + late.length, Math.max(1, current.length)), { size: 96, stroke: 9, label: "coverage" })}
          </div>
          <div class="grid g4">
            ${miniStat("Present at gate", (gate.total - gate.absent) + "/" + gate.total, "ok")}
            ${miniStat("Late", gate.late, gate.late ? "warn" : "")}
            ${miniStat("Not arrived", gate.absent, gate.absent ? "danger" : "")}
            ${miniStat("Lessons done", gToday, "")}
          </div>
        </div>

        ${uncovered.length ? `<div class="card mt-4" style="border-color:rgba(220,38,38,.4);background:var(--danger-soft)">
          <div class="row between mb-3">
            <div class="row gap-2"><span class="danger">${CP.icon("alert")}</span><b>Action needed — no teacher in class</b></div>
            <span class="pill danger live"><span class="dt"></span>${uncovered.length} room${uncovered.length === 1 ? "" : "s"}</span>
          </div>
          <div class="list">${uncovered.map((i) => `<div class="li left danger">
            <div class="text-c" style="width:46px;flex:0 0 auto"><div class="fw-7">${CP.esc(i.classId)}</div><div class="t-xs dim">P${i.period}</div></div>
            <div class="body"><div class="name">${CP.esc(i.subject)}</div>
              <div class="meta">Expected: ${CP.esc(i.teacherName)} · ${CP.esc(i.roomName)} · ${minsInto(now, i)} min in</div></div>
            <button class="btn sm danger" data-cover="${CP.esc(i.key)}">${CP.icon("swap")} Cover</button>
          </div>`).join("")}</div>
        </div>` : ""}

        ${pending.length ? `<div class="mt-4">${CP.banner("warn", pending.length + " class" + (pending.length === 1 ? "" : "es") + " not yet scanned in", "Give it a moment — teachers may be moving between rooms.")}</div>` : ""}

        ${current.length ? CP.section("Classroom pulse — period " + per.n) + `
          <div class="pulse-grid">${current.map(pulseCard).join("")}</div>` : ""}

        <div class="grid g2 mt-5">
          <div class="card">
            <div class="fw-6 mb-3">${CP.icon("clock")} Late arrivals today</div>
            ${lateList.length ? `<div class="list">${lateList.slice(0, 6).map((t) => {
              const g = gate.log[t.id];
              return CP.li({
                lead: CP.avatarHTML(t), press: true, attr: `data-teacher="${t.id}"`,
                name: CP.esc(t.name),
                meta: `${CP.esc(t.dept)} · in at ${g.in}`,
                tail: `<span class="pill warn">${g.mins - CP.time.mins(S.data.settings.lateAfter)} min</span>`,
              });
            }).join("")}</div>` : CP.empty("No late arrivals", "Everyone was in before " + S.data.settings.lateAfter + ".", "checkCircle")}
          </div>
          <div class="card">
            <div class="fw-6 mb-3">${CP.icon("xCircle")} Not arrived at all</div>
            ${notIn.length ? `<div class="list">${notIn.map((t) => CP.li({
              lead: CP.avatarHTML(t), press: true, attr: `data-teacher="${t.id}"`,
              name: CP.esc(t.name), meta: CP.esc(t.dept),
              tail: `<span class="pill danger">absent</span>`,
            })).join("")}</div>` : CP.empty("All staff accounted for", "", "checkCircle")}
          </div>
        </div>

        ${CP.section("Coverage trend — last 14 school days", `<span class="pill">avg ${Math.round(CP.avg(series))}%</span>`)}
        <div class="card">${CP.charts.line([{ values: series, color: "var(--accent-500)" }], { labels: S.rangeStats(14).map((x) => x.dateKey.slice(8)) })}</div>

        ${CP.section("Free right now", `<span class="pill">${S.freeTeachersNow(dateKey).length} available</span>`)}
        <div class="row wrap gap-2">${S.freeTeachersNow(dateKey).slice(0, 14).map((f) => `<span class="pill">${CP.esc(f.user.name)}</span>`).join("") || CP.empty("Nobody free")}</div>`,
      after(root) {
        root.querySelectorAll("[data-cover]").forEach((b) => b.onclick = () => CP.openCover(b.dataset.cover));
        root.querySelectorAll("[data-teacher]").forEach((b) => b.onclick = () => openTeacher(b.dataset.teacher));
        root.querySelectorAll("[data-pulse]").forEach((b) => b.onclick = () => openLesson(b.dataset.pulse));
      },
    };
  };

  function miniStat(k, v, tone) {
    return `<div class="stat accentbar ${tone}" style="padding:10px 12px">
      <div class="k">${CP.esc(k)}</div><div class="v t-xl">${v}</div></div>`;
  }
  function minsInto(now, i) { return Math.max(0, now.getHours() * 60 + now.getMinutes() - i.startM); }

  function pulseCard(i) {
    const cls = i.state === "on-time" || i.state === "covered" ? "s-ok" : i.state === "late" ? "s-warn" : i.state === "pending" ? "s-pending" : "s-danger";
    const now = S.now();
    const into = minsInto(now, i);
    return `<button class="pulse ${cls}" data-pulse="${CP.esc(i.key)}" style="text-align:left">
      <div class="row between">
        <div><div class="room">${CP.esc(i.classId)}</div><div class="lbl">${CP.esc(i.roomName)} · P${i.period}</div></div>
        ${i.state === "missing" || i.state === "absent" ? `<span class="countdown danger">${into}′</span>` : ""}
      </div>
      <div class="who">${CP.dotState(i.state)}<span class="truncate">${CP.esc(i.subject)}</span></div>
      <div class="t-xs dim truncate mt-1">${CP.esc(i.teacherName)}${i.covered ? " → " + CP.esc((S.user(i.coverBy) || {}).name || "") : ""}</div>
      <div class="bar"></div>
    </button>`;
  }
  CP.dotState = function (state) {
    return `<i style="width:8px;height:8px;border-radius:50%;background:${CP.dotColor(state)};display:inline-block;flex:0 0 auto"></i>`;
  };

  /* ------------------------------------------------------------- lesson sheet */
  function openLesson(key) {
    const dateKey = CP.time.dayKey(S.now());
    const i = S.instancesForDate(dateKey).find((x) => x.key === key);
    if (!i) return;
    const t = S.user(i.teacherId);
    CP.sheet({
      title: i.classId + " · " + i.subject,
      body: `
        <div class="row between mb-4">
          ${CP.pill(i.state)}
          <span class="pill">P${i.period} · ${i.start}–${i.end}</span>
        </div>
        <div class="card flat mb-4">
          <div class="kv"><span class="k">Room</span><span class="v">${CP.esc(i.roomName)}</span></div>
          <div class="kv"><span class="k">Expected teacher</span><span class="v">${CP.esc(i.teacherName)}</span></div>
          <div class="kv"><span class="k">Scanned in</span><span class="v mono">${i.inAt || "—"}</span></div>
          <div class="kv"><span class="k">Scanned out</span><span class="v mono">${i.outAt || "—"}</span></div>
          <div class="kv"><span class="k">Method</span><span class="v">${CP.esc(i.method || "—")}</span></div>
          ${i.note ? `<div class="kv"><span class="k">Note</span><span class="v">${CP.esc(i.note)}</span></div>` : ""}
          ${i.covered ? `<div class="kv"><span class="k">Covered by</span><span class="v">${CP.esc((S.user(i.coverBy) || {}).name || "—")}</span></div>` : ""}
        </div>
        ${S.data.settings.allowManualMark ? `<div class="t-xs dim upper mb-2">Manual entry (logged with your name)</div>
        <div class="grid g2 mb-3">
          <button class="btn" data-mm="on-time">${CP.icon("check")} Mark attended</button>
          <button class="btn" data-mm="missing">${CP.icon("x")} Mark not attended</button>
        </div>
        <button class="btn warn block mb-3" data-mm="late">${CP.icon("clock")} Mark late (add minutes)</button>` : ""}
        <div class="grid g2">
          <button class="btn primary" data-cover="${CP.esc(i.key)}">${CP.icon("swap")} Assign cover</button>
          <button class="btn" data-open-teacher="${t.id}">${CP.icon("user")} Teacher profile</button>
        </div>
        <div class="banner info mt-4"><span class="ic info">${CP.icon("info")}</span>
          <div class="grow t-xs">Manual entries are recorded in the audit trail with your name and the reason, so no one can quietly fix a record.</div></div>`,
    });
    const body = document.querySelector(".sheet");
    body.querySelector("[data-cover]").onclick = () => { body.closest(".scrim").remove(); CP.openCover(i.key); };
    body.querySelectorAll("[data-open-teacher]").forEach((b) => b.onclick = () => { body.closest(".scrim").remove(); openTeacher(t.id); });
    body.querySelectorAll("[data-mm]").forEach((b) => b.onclick = async () => {
      const v = b.dataset.mm;
      if (v === "late") {
        const m = await CP.prompt({ title: "Minutes late", label: "How late did the lesson start?", type: "number", value: "6", inputmode: "numeric" });
        if (m == null) return;
        S.manualMark(dateKey, i.key, { state: "late", inAt: CP.time.fromMins(i.startM + (+m || 0)), minsLate: +m || 0, method: "manual", note: "Manual entry by " + CP.me().name }, CP.me().id);
      } else {
        S.manualMark(dateKey, i.key, { state: v, inAt: v === "on-time" ? CP.time.fromMins(i.startM) : null, minsLate: 0, method: "manual", note: "Manual entry by " + CP.me().name }, CP.me().id);
      }
      CP.toast({ kind: "ok", msg: "Record updated and audited." });
      body.closest(".scrim").remove();
      CP.render();
    });
  }
  CP.openLesson = openLesson;

  /* =================================================================== STAFF */
  V.scans = function (ctx) {
    const events = (S.data.events || []).filter((e) => e.kind === "gate-in" || e.kind === "gate-out" || e.kind === "class-in" || e.kind === "class-out").slice(0, 80);
    const suspicious = events.filter((e) => e.offline || !e.verified);
    return {
      title: "Scan review",
      sub: events.length + " recent scans · " + suspicious.length + " needing review",
      html: `
        ${suspicious.length ? CP.banner("warn", suspicious.length + " scan(s) need review", "These were recorded offline or without server verification. Review before they count.") : CP.banner("ok", "All scans verified", "Every recorded scan was verified by the server.")}
        <div class="card mt-4">
          <div class="fw-6 mb-3">Recent scans</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Teacher</th><th>Kind</th><th>Room</th><th>Status</th></tr></thead>
              <tbody>${events.map((e) => {
                const u = S.user(e.userId);
                const status = e.verified ? `<span class="pill ok">verified</span>` : e.offline ? `<span class="pill warn">offline</span>` : `<span class="pill">local</span>`;
                return `<tr>
                  <td class="mono t-xs">${CP.time.hm(new Date(e.ts || Date.now()))}</td>
                  <td>${CP.esc((u || {}).name || e.userId || "—")}</td>
                  <td>${CP.esc(e.kind)}</td>
                  <td>${CP.esc(e.roomName || e.roomId || "—")}</td>
                  <td>${status}</td>
                </tr>`;
              }).join("") || `<tr><td colspan="5" class="t-sm muted text-c" style="padding:20px">No scans yet.</td></tr>`}</tbody>
            </table>
          </div>
        </div>`,
    };
  };

  V.staff = function (ctx) {
    const now = S.now();
    const dateKey = CP.time.dayKey(now);
    const gate = S.gateSummary(dateKey);
    const q = (contextCache.staffQ || "").toLowerCase();
    const filter = contextCache.staffFilter || "all";
    let list = S.teachers();
    if (filter === "late") list = list.filter((t) => { const g = gate.log[t.id]; return g && g.mins > CP.time.mins(S.data.settings.lateAfter); });
    if (filter === "absent") list = list.filter((t) => !gate.log[t.id]);
    if (filter === "in") list = list.filter((t) => gate.log[t.id]);
    if (q) list = list.filter((t) => (t.name + t.staffNo + t.dept).toLowerCase().includes(q));
    list = CP.sortBy(list, (t) => (gate.log[t.id] ? gate.log[t.id].mins : 9999));

    return {
      title: "Staff",
      sub: S.teachers().length + " teachers · " + (gate.total - gate.absent) + " in today",
      html: `
        ${S.pendingRegistrations().length ? CP.section("Pending registrations") + `
        <div class="list mb-4">${S.pendingRegistrations().map((u) => `
          <div class="li left warn">
            <span style="width:40px;height:40px;border-radius:13px;display:grid;place-items:center;background:var(--warn-soft);color:var(--warn);flex:0 0 auto">${CP.icon("user")}</span>
            <span class="body"><span class="name">${CP.esc(u.name)}</span>
              <span class="meta">${CP.esc(u.staffNo)} · ${CP.esc(u.dept || "—")} · ${CP.esc((u.subjects || []).join(", ") || "no subjects")}</span></span>
            <span class="tail row gap-2">
              <button class="btn xs ok" data-approve="${u.id}">${CP.icon("check")} Approve</button>
              <button class="btn xs danger" data-reject="${u.id}">${CP.icon("x")} Reject</button>
            </span>
          </div>`).join("")}</div>` : ""}
        <div class="grid g4 mb-4">
          ${CP.stat({ k: "Present", v: gate.total - gate.absent, tone: "ok" })}
          ${CP.stat({ k: "Late", v: gate.late, tone: gate.late ? "warn" : "" })}
          ${CP.stat({ k: "Absent", v: gate.absent, tone: gate.absent ? "danger" : "" })}
          ${CP.stat({ k: "Checked out", v: gate.out })}
        </div>
        <div class="field mb-3"><input class="input" data-q placeholder="Search teachers…" value="${CP.esc(contextCache.staffQ || "")}"></div>
        ${CP.seg("sf", [
          { value: "all", label: "All" }, { value: "in", label: "In school" },
          { value: "late", label: "Late" }, { value: "absent", label: "Absent" },
        ], filter)}
        <div class="list mt-4">${list.map((t) => {
          const g = gate.log[t.id];
          const late = g && g.mins > CP.time.mins(S.data.settings.lateAfter);
          const cur = S.instancesForDate(dateKey).find((i) => i.teacherId === t.id && i.state === "pending" && i.startM <= now.getHours() * 60 + now.getMinutes());
          return CP.li({
            lead: CP.avatarHTML(t), press: true, attr: `data-teacher="${t.id}"`,
            left: !g ? "danger" : late ? "warn" : "ok",
            name: CP.esc(t.name),
            meta: `${CP.esc(t.dept)} · ${CP.esc(t.staffNo)} · ${g ? "in at " + g.in + (g.out ? " → " + g.out : "") : "not arrived"}`,
            tail: `${CP.pill(!g ? "absent" : late ? "late" : "present")}${cur ? `<div class="t-xs dim mt-1">in ${CP.esc(cur.classId)}?</div>` : ""}`,
          });
        }).join("") || CP.empty("No teachers match")}</div>`,
      after(root) {
        const inp = root.querySelector("[data-q]");
        inp.oninput = CP.debounce(() => { contextCache.staffQ = inp.value; CP.render(); const el = document.querySelector("[data-q]"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 320);
        CP.bindSeg(root, "sf", (v) => { contextCache.staffFilter = v; CP.render(); });
        root.querySelectorAll("[data-teacher]").forEach((b) => b.onclick = () => openTeacher(b.dataset.teacher));
        root.querySelectorAll("[data-approve]").forEach((b) => b.onclick = () => { S.approveTeacher(b.dataset.approve, true); CP.toast({ kind: "ok", msg: "Teacher approved." }); CP.render(); });
        root.querySelectorAll("[data-reject]").forEach((b) => b.onclick = () => { S.approveTeacher(b.dataset.reject, false); CP.toast({ kind: "warn", msg: "Registration rejected." }); CP.render(); });
      },
    };
  };

  function openTeacher(id) {
    const u = S.user(id);
    if (!u) return;
    const st = S.teacherStats(id, 30);
    const dateKey = CP.time.dayKey(S.now());
    const g = S.gateStatus(id, dateKey);
    const todayLessons = S.instancesForDate(dateKey).filter((i) => i.teacherId === id);
    const spark = st.daily.slice(-14).map((d) => (d.state === "on-time" ? 100 : d.state === "late" ? 50 : 0));
    const sheet = CP.sheet({
      title: u.name,
      body: `
        <div class="row gap-4 mb-4">
          ${CP.avatarHTML(u, "lg")}
          <div class="grow">
            <div class="t-sm muted">${CP.esc(u.staffNo)} · ${CP.esc(u.dept)}</div>
            <div class="t-xs dim mt-1">${CP.esc((u.subjects || []).join(", "))}</div>
            <div class="mt-2">${CP.pill(!g ? "absent" : (g.mins > CP.time.mins(S.data.settings.lateAfter) ? "late" : "on-time"))}
              ${u.device ? `<span class="pill ok">device bound</span>` : `<span class="pill warn">no device</span>`}</div>
          </div>
        </div>
        <div class="grid g2 mb-4">
          ${CP.stat({ k: "Attendance", v: st.attendanceRate + "%", d: st.present + "/" + st.workDays + " days", spark: CP.charts.spark(spark) })}
          ${CP.stat({ k: "Gate on time", v: st.gatePunctuality + "%", d: st.lateGate + " late · avg " + st.avgLateBy + " min", tone: st.gatePunctuality >= 90 ? "ok" : st.gatePunctuality >= 75 ? "warn" : "danger" })}
          ${CP.stat({ k: "Lessons attended", v: st.coverage + "%", d: st.taught + " of " + (st.taught + st.missed) })}
          ${CP.stat({ k: "Abandoned early", v: st.outEarly, d: "left before close", tone: st.outEarly > 2 ? "warn" : "" })}
        </div>
        ${CP.section("Today")}
        <div class="card flat mb-4">
          <div class="kv"><span class="k">Gate in / out</span><span class="v mono">${g ? g.in + " → " + (g.out || "—") : "not recorded"}</span></div>
          <div class="kv"><span class="k">Lessons today</span><span class="v">${todayLessons.length}</span></div>
          <div class="kv"><span class="k">Cover points (30d)</span><span class="v">${st.points}</span></div>
        </div>
        <div class="list mb-4">${todayLessons.slice(0, 8).map((i) => CP.lessonRow(i, u)).join("") || CP.empty("No lessons scheduled")}</div>
        ${CP.section("Last 14 school days")}
        <div class="heat mb-4" style="grid-template-columns:repeat(14,1fr)">${st.daily.slice(-14).map((d) => {
          const c = d.state === "absent" ? "var(--danger)" : d.lateBy ? "var(--warn)" : "var(--ok)";
          return `<div class="cell" style="background:${c};opacity:${d.state === "absent" ? .35 : 1}" title="${d.dateKey}: ${d.state}${d.lateBy ? " +" + d.lateBy + "min" : ""}"></div>`;
        }).join("")}</div>
        ${CP.section("Actions")}
        <div class="grid g2">
          <button class="btn" data-note>${CP.icon("edit")} Add a note</button>
          <button class="btn" data-call>${CP.icon("phone")} Call / SMS</button>
          <button class="btn" data-unbind>${CP.icon("lock")} Reset device</button>
          <button class="btn" data-pin>${CP.icon("key")} Reset PIN</button>
        </div>`,
    });
    const body = document.querySelector(".sheet");
    body.querySelector("[data-note]").onclick = async () => {
      const v = await CP.prompt({ title: "Note about " + u.name, label: "Recorded in the audit trail" });
      if (!v) return;
      S.audit(CP.me().id, "teacher-note", { teacherId: id, note: v });
      CP.toast({ kind: "ok", msg: "Note saved." });
    };
    body.querySelector("[data-call]").onclick = () => {
      if (!u.phone) return CP.toast({ kind: "warn", msg: "No phone number on file." });
      location.href = "tel:" + u.phone;
    };
    body.querySelector("[data-unbind]").onclick = () => { u.device = null; S.save(true); CP.toast({ kind: "ok", msg: "Device unbound — teacher can bind a new phone." }); };
    body.querySelector("[data-pin]").onclick = async () => {
      const v = await CP.prompt({ title: "New PIN for " + u.name, label: "4 digits", inputmode: "numeric", value: "3001" });
      if (!v) return;
      u.pin = CP.digest(String(v).slice(0, 6));
      S.save(true); S.audit(CP.me().id, "reset-pin", { teacherId: id });
      CP.toast({ kind: "ok", msg: "PIN reset." });
    };
  }
  CP.openTeacher = openTeacher;

  /* =============================================================== TIMETABLE */
  V.timetable = function (ctx) {
    const view = contextCache.ttView || "class";
    const dateKey = CP.time.dayKey(S.now());
    const wd = S.weekdayNum(dateKey);
    const days = [1, 2, 3, 4, 5];
    const periods = S.data.settings.periods;
    const all = S.data.timetable;

    let html = `
      ${CP.seg("tv", [
        { value: "class", label: "By class" },
        { value: "teacher", label: "By teacher" },
        { value: "free", label: "Free slots" },
        { value: "issues", label: "Clashes" },
      ], view)}`;

    if (view === "class") {
      const sel = contextCache.ttClass || "S2B";
      html += `<div class="chips mt-4 mb-3">${S.data.classes.map((c) => `<button class="chip ${c.id === sel ? "on" : ""}" data-class="${c.id}">${c.id}</button>`).join("")}</div>`;
      html += grid(all.filter((r) => r.classId === sel), days, periods, (r) => ({ t: r.subject, s: (S.user(r.teacherId) || {}).name, room: (S.room(r.roomId) || {}).name }), true);
    } else if (view === "teacher") {
      const sel = contextCache.ttTeacher || S.teachers()[0].id;
      html += `<div class="field mt-4 mb-3"><select class="select" data-tteach>${S.teachers().map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${CP.esc(t.name)} — ${CP.esc(t.dept)}</option>`).join("")}</select></div>`;
      html += grid(all.filter((r) => r.teacherId === sel), days, periods, (r) => ({ t: r.subject, s: r.classId, room: (S.room(r.roomId) || {}).name }), false);
    } else if (view === "free") {
      const per = S.periodAt(S.now());
      html += `<div class="mt-4">${CP.banner("info", "Free teachers this period", per.kind === "period" ? "Period " + per.n : "Currently " + (per.label || "outside lessons"))}</div>`;
      html += `<div class="list mt-3">${S.freeTeachersNow(dateKey).map((f) => CP.li({
        lead: CP.avatarHTML(f.user), name: CP.esc(f.user.name),
        meta: `${CP.esc(f.user.dept)} · arrived ${f.arrived} · ${f.load} lesson(s) today`,
        tail: `<span class="pill ok">free</span>`,
      })).join("") || CP.empty("Nobody free right now")}</div>`;
      html += CP.section("Used today as cover") + `<div class="list">${S.data.covers.filter((c) => c.dateKey === dateKey).map((c) => CP.li({
        lead: CP.avatarHTML(S.user(c.coverById) || { name: "?" }), name: CP.esc((S.user(c.coverById) || {}).name || ""),
        meta: `covering ${CP.esc(c.classId)} P${c.period} for ${CP.esc((S.user(c.absentId) || {}).name || "")}`,
        tail: `<span class="pill info">+${c.points}</span>`,
      })).join("") || CP.empty("No cover assigned yet")}</div>`;
    } else {
      const clashes = findClashes(all);
      html += `<div class="mt-4">${clashes.length ? CP.banner("danger", clashes.length + " clash" + (clashes.length === 1 ? "" : "es") + " in the timetable", "A teacher or room is double-booked. Fix it in Admin → Timetable.") : CP.banner("ok", "No clashes detected", "Every teacher and room is booked once per period.", "checkCircle")}</div>`;
      html += `<div class="list mt-3">${clashes.map((c) => CP.li({
        name: CP.esc(c.what), meta: CP.esc(c.detail), tail: `<span class="pill danger">clash</span>`,
      })).join("")}</div>`;
    }

    return {
      title: "Timetable",
      sub: "Periods " + periods[0].start + "–" + periods[periods.length - 1].end + " · " + all.length + " lesson slots per week",
      html,
      wide: true,
      after(root) {
        CP.bindSeg(root, "tv", (v) => { contextCache.ttView = v; CP.render(); });
        root.querySelectorAll("[data-class]").forEach((b) => b.onclick = () => { contextCache.ttClass = b.dataset.class; CP.render(); });
        const ts = root.querySelector("[data-tteach]");
        if (ts) ts.onchange = () => { contextCache.ttTeacher = ts.value; CP.render(); };
      },
    };
  };

  function grid(rows, days, periods, fmt, showTeacher) {
    return `<div class="table-wrap"><table style="min-width:720px">
      <thead><tr><th>Period</th>${days.map((d) => `<th>${CP.time.dayShort(new Date(2024, 0, 1 + d))}</th>`).join("")}</tr></thead>
      <tbody>${periods.map((p) => `<tr>
        <td><b>P${p.n}</b><div class="t-xs dim mono">${p.start}</div></td>
        ${days.map((d) => {
          const r = rows.find((x) => x.day === d && x.period === p.n);
          if (!r) return `<td class="dim t-xs">—</td>`;
          const f = fmt(r);
          return `<td><div class="fw-6 t-sm">${CP.esc(f.t)}</div>
            <div class="t-xs dim">${CP.esc(f.s || "")}</div>
            <div class="t-xs dim">${CP.esc(f.room || "")}</div></td>`;
        }).join("")}
      </tr>`).join("")}</tbody></table></div>`;
  }

  const contextCache = (CP._ctx = CP._ctx || {});

  function findClashes(all) {
    const out = [];
    const byTeacher = CP.by(all, (r) => r.day + "#" + r.period + "#" + r.teacherId);
    Object.keys(byTeacher).forEach((k) => {
      if (byTeacher[k].length > 1) {
        const [d, p, tid] = k.split("#");
        out.push({ what: (S.user(tid) || {}).name, detail: `double-booked on ${CP.time.dayShort(new Date(2024, 0, 1 + +d))} P${p}: ${byTeacher[k].map((r) => r.classId).join(", ")}` });
      }
    });
    const byRoom = CP.by(all, (r) => r.day + "#" + r.period + "#" + r.roomId);
    Object.keys(byRoom).forEach((k) => {
      if (byRoom[k].length > 1) {
        const [d, p, rid] = k.split("#");
        out.push({ what: (S.room(rid) || {}).name, detail: `double-booked on ${CP.time.dayShort(new Date(2024, 0, 1 + +d))} P${p}: ${byRoom[k].map((r) => r.classId).join(", ")}` });
      }
    });
    return out.slice(0, 30);
  }

  /* ================================================================ COVERAGE */
  V.coverage = function (ctx) {
    const now = S.now();
    const days = 14;
    const pairs = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const k = CP.time.dayKey(d);
      S.instancesForDate(k).forEach((x) => {
        const key = x.subject + "|" + x.classId;
        pairs[key] = pairs[key] || { subject: x.subject, classId: x.classId, total: 0, taught: 0, missed: 0, late: 0 };
        pairs[key].total++;
        if (["on-time", "covered"].includes(x.state)) pairs[key].taught++;
        if (x.state === "late") { pairs[key].taught++; pairs[key].late++; }
        if (["missing", "absent"].includes(x.state)) pairs[key].missed++;
      });
    }
    const rows = Object.values(pairs).map((r) => ({ ...r, pct: CP.pct(r.taught, r.total) })).sort((a, b) => a.pct - b.pct);
    const risk = rows.filter((r) => r.pct < 80);
    const bySubject = CP.by(Object.values(pairs), (r) => r.subject);
    const subjRows = Object.keys(bySubject).map((s) => {
      const list = bySubject[s];
      const total = CP.sum(list, (x) => x.total), taught = CP.sum(list, (x) => x.taught);
      return { subject: s, pct: CP.pct(taught, total), total, missed: CP.sum(list, (x) => x.missed) };
    }).sort((a, b) => a.pct - b.pct);

    return {
      title: "Syllabus coverage",
      sub: "How much teaching actually happened — last " + days + " days",
      html: `
        <div class="grid g2 mb-4">
          <div class="card">
            <div class="upper dim mb-3">Lesson coverage by subject</div>
            <div class="col gap-3">${subjRows.map((r) => `
              <div><div class="row between t-sm mb-2"><span class="fw-6">${CP.esc(r.subject)}</span>
              <span class="mono ${r.pct < 80 ? "danger" : "dim"}">${r.pct}%</span></div>
              <div style="height:8px;border-radius:99px;background:var(--bg-2);overflow:hidden">
                <div style="height:100%;width:${r.pct}%;background:${r.pct >= 90 ? "var(--ok)" : r.pct >= 75 ? "var(--accent-500)" : r.pct >= 60 ? "var(--warn)" : "var(--danger)"}"></div></div></div>`).join("")}</div>
          </div>
          <div class="card">
            <div class="upper dim mb-3">Teacher coverage ranking</div>
            <div class="list">${CP.sortBy(S.teachers().map((t) => ({ t, s: S.teacherStats(t.id, days) })), (x) => x.s.coverage).slice(0, 8).map(({ t, s }) => CP.li({
              lead: CP.avatarHTML(t), name: CP.esc(t.name), meta: `${s.taught}/${s.taught + s.missedLessons} lessons • ${s.missedLessons} missed`,
              tail: `<span class="pill ${s.coverage >= 90 ? "ok" : s.coverage >= 75 ? "warn" : "danger"}">${s.coverage}%</span>`,
            })).join("")}</div>
          </div>
        </div>
        ${risk.length ? CP.banner("warn", risk.length + " class/subject combinations below 80%", "These are the classes where learners are losing the most teaching time.") : CP.banner("ok", "Teaching delivery is healthy", "Every class/subject is above 80% coverage.", "checkCircle")}
        ${CP.section("Class × subject detail")}
        <div class="table-wrap"><table>
          <thead><tr><th>Subject</th><th>Class</th><th>Lessons</th><th>Taught</th><th>Missed</th><th>Late</th><th>Coverage</th></tr></thead>
          <tbody>${rows.slice(0, 60).map((r) => `<tr>
            <td>${CP.esc(r.subject)}</td><td class="fw-6">${CP.esc(r.classId)}</td><td class="mono">${r.total}</td>
            <td class="mono ok">${r.taught}</td><td class="mono ${r.missed ? "danger" : "dim"}">${r.missed}</td><td class="mono ${r.late ? "warn" : "dim"}">${r.late}</td>
            <td><span class="pill ${r.pct >= 90 ? "ok" : r.pct >= 75 ? "warn" : "danger"}">${r.pct}%</span></td></tr>`).join("")}</tbody>
        </table></div>
        <button class="btn block mt-4" data-cov-csv>${CP.icon("download")} Export coverage report (CSV)</button>
        ${CP.section("NCDC scheme of work")}
        <div class="card flat">
          <p class="t-sm muted mb-3">Generate the official scheme of work for any subject and class in your timetable — aligned to the NCDC competency-based curriculum, ready to print and sign.</p>
          <button class="btn primary block" data-action="nav:/teacher/lessons">${CP.icon("book")} Open the teaching planner</button>
        </div>`,
      after(root) {
        const b = root.querySelector("[data-cov-csv]");
        if (b) b.onclick = () => S.exportCsv(rows.map((r) => ({ subject: r.subject, class: r.classId, lessons: r.total, taught: r.taught, missed: r.missed, late: r.late, coveragePct: r.pct })), "coverage-report.csv");
        const n = root.querySelector("[data-action='nav:/teacher/lessons']");
        if (n) n.onclick = () => CP.go("/teacher/lessons");
      },
    };
  };
})(window);
