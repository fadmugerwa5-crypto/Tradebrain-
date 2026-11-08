/* ==========================================================================
   ClassPulse — views-head.js
   Head Teacher: whole-school oversight, performance, reports.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const V = (CP.views.head = CP.views.head || {});

  V.overview = function (ctx) {
    const now = S.now();
    const dateKey = CP.time.dayKey(now);
    const per = S.periodAt(now);
    const today = S.dayStats(dateKey);
    const range = S.rangeStats(30);
    const covSeries = range.map((d) => d.coverage);
    const gateSeries = range.map((d) => d.gateOnTimeRate);
    const teachers = S.teachers().map((t) => ({ t, s: S.teacherStats(t.id, 30) }));
    const best = CP.sortBy(teachers, (x) => x.s.gatePunctuality, "desc").slice(0, 5);
    const watch = CP.sortBy(teachers, (x) => x.s.gatePunctuality).slice(0, 5);
    const deptMap = CP.by(teachers, (x) => x.t.dept);
    const deptRows = Object.keys(deptMap).map((d) => ({
      dept: d,
      gate: Math.round(CP.avg(deptMap[d], (x) => x.s.gatePunctuality)),
      cover: Math.round(CP.avg(deptMap[d], (x) => x.s.coverage)),
      n: deptMap[d].length,
    })).sort((a, b) => a.gate - b.gate);
    const alerts = S.alertsFor(ctx.me).slice(0, 4);

    return {
      title: "School overview",
      sub: S.data.school.name + " · " + S.data.school.term,
      html: `
        <div class="grid g2">
          <div class="card" style="display:flex;gap:16px;align-items:center">
            ${CP.charts.gauge(today.coverage, { size: 132, label: "Lessons today" })}
            <div class="grow">
              <div class="fw-7 t-md">Lesson delivery</div>
              <div class="t-sm muted mt-1">${today.taught} of ${today.countable} periods taught</div>
              <div class="divider mt-3"></div>
              <div class="kv"><span class="k">Not attended</span><span class="v danger">${today.missed}</span></div>
              <div class="kv"><span class="k">Started late</span><span class="v warn">${today.late}</span></div>
              <div class="kv"><span class="k">In session now</span><span class="v">${per.kind === "period" ? "Period " + per.n : per.label || "—"}</span></div>
            </div>
          </div>
          <div class="card" style="display:flex;gap:16px;align-items:center">
            ${CP.charts.gauge(today.gateOnTimeRate, { size: 132, label: "Staff on time" })}
            <div class="grow">
              <div class="fw-7 t-md">Staff punctuality</div>
              <div class="t-sm muted mt-1">${today.present} of ${today.gate.total} staff reported today</div>
              <div class="divider mt-3"></div>
              <div class="kv"><span class="k">Late arrivals</span><span class="v warn">${today.gate.late}</span></div>
              <div class="kv"><span class="k">Absent</span><span class="v danger">${today.gate.absent}</span></div>
              <div class="kv"><span class="k">Checked out</span><span class="v">${today.gate.out}</span></div>
            </div>
          </div>
        </div>

        <div class="grid g2 mt-4">
          <div class="card">
            <div class="row between mb-3"><div class="fw-6">Lesson coverage — 30 days</div>
              <span class="pill ${CP.avg(covSeries) >= 90 ? "ok" : "warn"}">avg ${Math.round(CP.avg(covSeries))}%</span></div>
            ${CP.charts.line([{ values: covSeries, color: "var(--accent-500)" }], { labels: range.map((r) => r.dateKey.slice(8)), height: 150 })}
          </div>
          <div class="card">
            <div class="row between mb-3"><div class="fw-6">Staff arriving on time — 30 days</div>
              <span class="pill ${CP.avg(gateSeries) >= 90 ? "ok" : "warn"}">avg ${Math.round(CP.avg(gateSeries))}%</span></div>
            ${CP.charts.line([{ values: gateSeries, color: "var(--brand-400)" }], { labels: range.map((r) => r.dateKey.slice(8)), height: 150 })}
          </div>
        </div>

        ${CP.section("By department")}
        <div class="card"><div class="grid g3">${deptRows.map((d) => `
          <div>
            <div class="row between t-sm mb-2"><span class="fw-6">${CP.esc(d.dept)}</span><span class="dim t-xs">${d.n} staff</span></div>
            <div class="t-xs dim">On time ${d.gate}% · Coverage ${d.cover}%</div>
            <div class="mt-2" style="height:7px;border-radius:99px;background:var(--bg-2);overflow:hidden">
              <div style="height:100%;width:${d.gate}%;background:${d.gate >= 90 ? "var(--ok)" : d.gate >= 75 ? "var(--warn)" : "var(--danger)"}"></div></div>
          </div>`).join("")}</div></div>

        <div class="grid g2 mt-4">
          <div class="card">
            <div class="fw-6 mb-3">${CP.icon("clock")} Most punctual this term</div>
            <div class="list">${best.map(({ t, s }) => CP.li({
              lead: CP.avatarHTML(t), press: true, attr: `data-teacher="${t.id}"`,
              name: CP.esc(t.name), meta: `${CP.esc(t.dept)} · ${s.present}/${s.workDays} days in`,
              tail: `<span class="pill ok">${s.gatePunctuality}%</span>`,
            })).join("")}</div>
          </div>
          <div class="card">
            <div class="fw-6 mb-3">${CP.icon("alert")} Needs a conversation</div>
            <div class="list">${watch.map(({ t, s }) => CP.li({
              lead: CP.avatarHTML(t), press: true, attr: `data-teacher="${t.id}"`,
              name: CP.esc(t.name), meta: `${s.lateGate} late · ${s.missedLessons} lessons missed`,
              tail: `<span class="pill ${s.gatePunctuality >= 75 ? "warn" : "danger"}">${s.gatePunctuality}%</span>`,
            })).join("")}</div>
          </div>
        </div>

        ${alerts.length ? CP.section("Escalations requiring you") + alerts.map(CP.alertCard).join("") : ""}

        <div class="grid g2 mt-5">
          <button class="card press col center gap-2" data-go="reports" style="padding:20px">
            ${CP.icon("list", ' style="width:26px;height:26px;color:var(--brand-400)"')}
            <span class="fw-6">Generate reports</span><span class="t-xs dim">Daily, weekly, per teacher, per department</span></button>
          <button class="card press col center gap-2" data-go="staff" style="padding:20px">
            ${CP.icon("users", ' style="width:26px;height:26px;color:var(--accent-500)"')}
            <span class="fw-6">Staff performance</span><span class="t-xs dim">Full punctuality and delivery record</span></button>
        </div>`,
      after(root) {
        root.querySelectorAll("[data-teacher]").forEach((b) => b.onclick = () => CP.openTeacher(b.dataset.teacher));
        root.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => CP.go("/head/" + b.dataset.go));
        root.querySelectorAll("[data-cover]").forEach((b) => b.onclick = () => CP.openCover(b.dataset.cover));
      },
    };
  };

  V.staff = function (ctx) {
    const days = ctx.days || 30;
    const sort = contextCache.hSort || "gate";
    const list = CP.sortBy(S.teachers().map((t) => ({ t, s: S.teacherStats(t.id, days) })), (x) => x.s[sort === "gate" ? "gatePunctuality" : sort === "cover" ? "coverage" : "attendanceRate"]);
    const now = S.now();
    const gate = S.gateSummary(CP.time.dayKey(now));

    return {
      title: "Staff performance",
      sub: S.teachers().length + " teachers · last " + days + " school days",
      html: `
        <div class="grid g4 mb-3">
          ${CP.stat({ k: "Avg attendance", v: Math.round(CP.avg(list, (x) => x.s.attendanceRate)) + "%", tone: "ok" })}
          ${CP.stat({ k: "Avg on time", v: Math.round(CP.avg(list, (x) => x.s.gatePunctuality)) + "%", tone: "warn" })}
          ${CP.stat({ k: "Avg coverage", v: Math.round(CP.avg(list, (x) => x.s.coverage)) + "%", tone: "ok" })}
          ${CP.stat({ k: "Missed lessons", v: CP.sum(list, (x) => x.s.missedLessons), tone: "danger" })}
        </div>
        ${CP.seg("hs", [
          { value: "gate", label: "Gate punctuality" },
          { value: "cover", label: "Lesson coverage" },
          { value: "attendanceRate", label: "Attendance" },
        ], sort)}
        <div class="list mt-3">${list.map(({ t, s }) => {
          const g = gate.log[t.id];
          return `<div class="li press" data-teacher="${t.id}" style="padding:10px 12px">
            ${CP.avatarHTML(t, "sm")}
            <div class="body" style="min-width:0">
              <div class="row between"><span class="name truncate" style="font-size:13.5px">${CP.esc(t.name)}</span>
                <span class="pill ${s.gatePunctuality >= 90 ? "ok" : s.gatePunctuality >= 75 ? "warn" : "danger"}" style="font-size:10.5px">${s.gatePunctuality}%</span></div>
              <div class="meta truncate" style="font-size:11.5px">${CP.esc(t.dept)} · ${g ? "in " + g.in : "not in"} · ${s.lateGate} late · ${s.missedLessons} missed · ${s.coverage}% cov</div>
            </div>
            ${CP.icon("chevron")}
          </div>`;
        }).join("")}</div>`,
      after(root) {
        CP.bindSeg(root, "hs", (v) => { contextCache.hSort = v; CP.render(); });
        root.querySelectorAll("[data-teacher]").forEach((b) => b.onclick = () => CP.openTeacher(b.dataset.teacher));
      },
    };
  };
  const contextCache = (CP._ctxHead = {});

  /* ================================================================ REPORTS */
  V.reports = function (ctx) {
    const kind = contextCache.repKind || "daily";
    const days = contextCache.repDays || 30;
    const now = S.now();

    return {
      title: "Reports",
      sub: "Print-ready evidence for the board, parents and the ministry",
      html: `
        ${CP.seg("rk", [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "teacher", label: "Per teacher" },
          { value: "dept", label: "Department" },
          { value: "missed", label: "Missed lessons" },
        ], kind)}
        <div class="row gap-3 mt-4 mb-4">
          <div class="field grow"><label>Period covered</label>
            <select class="select" data-days>
              ${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${d === days ? "selected" : ""}>Last ${d} school days</option>`).join("")}
            </select></div>
          <div class="field" style="justify-content:flex-end">
            <button class="btn primary" data-print>${CP.icon("print")} Print</button>
          </div>
          <div class="field" style="justify-content:flex-end">
            <button class="btn" data-csv>${CP.icon("download")} CSV</button>
          </div>
        </div>
        <div data-rep></div>`,
      after(root) {
        CP.bindSeg(root, "rk", (v) => { contextCache.repKind = v; CP.render(); });
        const sel = root.querySelector("[data-days]");
        sel.onchange = () => { contextCache.repDays = +sel.value; CP.render(); };
        const rep = buildReport(kind, days);
        root.querySelector("[data-rep]").innerHTML = rep.html;
        root.querySelector("[data-print]").onclick = () => CP.curriculum.printable(rep.title, rep.text);
        root.querySelector("[data-csv]").onclick = () => S.exportCsv(rep.rows, rep.file);
      },
    };
  };

  function buildReport(kind, days) {
    const S_ = S;
    const now = S_.now();
    const school = S_.data.school;

    if (kind === "daily") {
      const k = CP.time.dayKey(now);
      const d = S_.dayStats(k);
      const g = d.gate;
      const rows = S_.teachers().map((t) => {
        const gl = g.log[t.id];
        const mine = S_.instancesForDate(k).filter((i) => i.teacherId === t.id);
        const late = gl && gl.mins > CP.time.mins(S_.data.settings.lateAfter);
        return {
          teacher: t.name, staffNo: t.staffNo, dept: t.dept,
          gateIn: gl ? gl.in : "", gateOut: gl ? gl.out || "" : "",
          arrival: !gl ? "ABSENT" : late ? "LATE" : "ON TIME",
          lateByMin: late ? gl.mins - CP.time.mins(S_.data.settings.lateAfter) : 0,
          lessonsScheduled: mine.length,
          lessonsTaught: mine.filter((i) => ["on-time", "late", "covered"].includes(i.state)).length,
          lessonsMissed: mine.filter((i) => ["missing", "absent"].includes(i.state)).length,
        };
      });
      const html = `
        <div class="grid g4 mb-4">
          ${CP.stat({ k: "Staff present", v: (g.total - g.absent) + "/" + g.total, tone: "ok" })}
          ${CP.stat({ k: "On time", v: g.onTime, tone: g.onTime / g.total > .9 ? "ok" : "warn" })}
          ${CP.stat({ k: "Late", v: g.late, tone: "warn" })}
          ${CP.stat({ k: "Lessons missed", v: d.missed, tone: d.missed ? "danger" : "" })}
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Teacher</th><th>Dept</th><th>In</th><th>Out</th><th>Arrival</th><th>Late</th><th>Taught</th><th>Missed</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="fw-6">${CP.esc(r.teacher)}<div class="t-xs dim">${CP.esc(r.staffNo)}</div></td>
            <td class="t-xs">${CP.esc(r.dept)}</td><td class="mono">${r.gateIn || "—"}</td><td class="mono">${r.gateOut || "—"}</td>
            <td>${r.arrival === "ABSENT" ? '<span class="pill danger">absent</span>' : r.arrival === "LATE" ? '<span class="pill warn">late</span>' : '<span class="pill ok">on time</span>'}</td>
            <td class="mono">${r.lateByMin || "—"}</td><td class="mono">${r.lessonsTaught}</td>
            <td class="mono ${r.lessonsMissed ? "danger" : ""}">${r.lessonsMissed || "—"}</td></tr>`).join("")}</tbody>
        </table></div>`;
      const text = `DAILY STAFF & LESSON ATTENDANCE REPORT\n${school.name}\nDate: ${k} (${CP.time.dayName(now)})\n${"=".repeat(74)}\n\n` +
        `STAFF: present ${g.total - g.absent}/${g.total} | on time ${g.onTime} | late ${g.late} | absent ${g.absent}\nLESSONS: ${d.taught}/${d.countable} taught (${d.coverage}%) | missed ${d.missed} | started late ${d.late}\n\n` +
        rows.map((r) => `${(r.teacher + " ".repeat(30)).slice(0, 30)} in ${(r.gateIn || "--:--").padEnd(6)} ${r.arrival.padEnd(8)} late ${String(r.lateByMin).padEnd(4)} taught ${r.lessonsTaught}/${r.lessonsScheduled} missed ${r.lessonsMissed}`).join("\n") +
        `\n\nPrepared by ClassPulse for the Head Teacher.\n`;
      return { title: "Daily report " + k, html, text, rows, file: "daily-report-" + k + ".csv" };
    }

    if (kind === "weekly") {
      const rng = S_.rangeStats(days);
      const html = `
        <div class="card mb-4">${CP.charts.line([
          { values: rng.map((d) => d.coverage), color: "var(--accent-500)" },
          { values: rng.map((d) => d.gateOnTimeRate), color: "var(--brand-400)" },
        ], { labels: rng.map((d) => d.dateKey.slice(5)), height: 200 })}
        <div class="legend mt-3"><span><i style="background:var(--accent-500)"></i>Lesson coverage %</span><span><i style="background:var(--brand-400)"></i>Staff on time %</span></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Present</th><th>Late</th><th>Absent</th><th>Lessons</th><th>Taught</th><th>Missed</th><th>Coverage</th><th>On time</th></tr></thead>
          <tbody>${rng.map((d) => `<tr>
            <td class="mono">${d.dateKey}</td><td class="mono">${d.present}</td><td class="mono warn">${d.gate.late}</td><td class="mono danger">${d.gate.absent}</td>
            <td class="mono">${d.countable}</td><td class="mono ok">${d.taught}</td><td class="mono ${d.missed ? "danger" : ""}">${d.missed}</td>
            <td><span class="pill ${d.coverage >= 90 ? "ok" : "warn"}">${d.coverage}%</span></td>
            <td><span class="pill ${d.gateOnTimeRate >= 90 ? "ok" : "warn"}">${d.gateOnTimeRate}%</span></td></tr>`).join("")}</tbody>
        </table></div>`;
      const text = `ATTENDANCE & DELIVERY SUMMARY — LAST ${days} SCHOOL DAYS\n${school.name}\n${"=".repeat(74)}\n\n` +
        rng.map((d) => `${d.dateKey}  present ${String(d.present).padStart(3)}  late ${String(d.gate.late).padStart(2)}  absent ${String(d.gate.absent).padStart(2)}  taught ${String(d.taught).padStart(3)}/${String(d.countable).padEnd(3)} (${String(d.coverage).padStart(5)}%)  on-time ${d.gateOnTimeRate}%`).join("\n") +
        `\n\nAVERAGES: coverage ${Math.round(CP.avg(rng, (d) => d.coverage))}%  |  staff on time ${Math.round(CP.avg(rng, (d) => d.gateOnTimeRate))}%\n`;
      return { title: "Summary — last " + days + " days", html, text, rows: rng.map((d) => ({ date: d.dateKey, present: d.present, late: d.gate.late, absent: d.gate.absent, lessons: d.countable, taught: d.taught, missed: d.missed, coveragePct: d.coverage, onTimePct: d.gateOnTimeRate })), file: "summary-" + days + "d.csv" };
    }

    if (kind === "teacher") {
      const rows = S_.teachers().map((t) => {
        const s = S_.teacherStats(t.id, days);
        return {
          teacher: t.name, staffNo: t.staffNo, dept: t.dept,
          workDays: s.workDays, present: s.present, absent: s.absent,
          lateArrivals: s.lateGate, avgLateMin: s.avgLateBy, earlyOut: s.outEarly,
          lessonsTaught: s.taught, lessonsMissed: s.missedLessons,
          punctualityPct: s.gatePunctuality, coveragePct: s.coverage, coverPoints: s.points,
        };
      });
      const html = `<div class="table-wrap"><table>
        <thead><tr><th>Teacher</th><th>Dept</th><th>Days</th><th>Present</th><th>Absent</th><th>Late</th><th>Avg late</th><th>Taught</th><th>Missed</th><th>Punct.</th><th>Coverage</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="fw-6">${CP.esc(r.teacher)}</td><td class="t-xs">${CP.esc(r.dept)}</td>
          <td class="mono">${r.workDays}</td><td class="mono ok">${r.present}</td><td class="mono ${r.absent ? "danger" : "dim"}">${r.absent}</td>
          <td class="mono warn">${r.lateArrivals}</td><td class="mono">${r.avgLateMin || "—"}</td>
          <td class="mono">${r.lessonsTaught}</td><td class="mono ${r.lessonsMissed ? "danger" : "dim"}">${r.lessonsMissed}</td>
          <td><span class="pill ${r.punctualityPct >= 90 ? "ok" : r.punctualityPct >= 75 ? "warn" : "danger"}">${r.punctualityPct}%</span></td>
          <td><span class="pill ${r.coveragePct >= 90 ? "ok" : "warn"}">${r.coveragePct}%</span></td></tr>`).join("")}</tbody>
      </table></div>`;
      const text = `INDIVIDUAL PERFORMANCE — LAST ${days} SCHOOL DAYS\n${school.name}\n${"=".repeat(88)}\n\n` +
        rows.map((r) => `${(r.teacher + " ".repeat(28)).slice(0, 28)} present ${String(r.present).padStart(3)}/${String(r.workDays).padEnd(3)} late ${String(r.lateArrivals).padStart(2)}  punctuality ${String(r.punctualityPct).padStart(5)}%  coverage ${String(r.coveragePct).padStart(5)}%  missed ${r.lessonsMissed}`).join("\n");
      return { title: "Teacher performance", html, text, rows, file: "teacher-performance.csv" };
    }

    if (kind === "dept") {
      const map = CP.by(S_.teachers(), (t) => t.dept);
      const rows = Object.keys(map).map((d) => {
        const st = map[d].map((t) => S_.teacherStats(t.id, days));
        return {
          dept: d, staff: map[d].length,
          attendancePct: Math.round(CP.avg(st, (s) => s.attendanceRate)),
          punctualityPct: Math.round(CP.avg(st, (s) => s.gatePunctuality)),
          coveragePct: Math.round(CP.avg(st, (s) => s.coverage)),
          lateArrivals: CP.sum(st, (s) => s.lateGate),
          missedLessons: CP.sum(st, (s) => s.missedLessons),
        };
      }).sort((a, b) => a.punctualityPct - b.punctualityPct);
      const html = `<div class="card mb-4"><div class="col gap-3">${rows.map((r) => `
        <div><div class="row between t-sm mb-2"><span class="fw-6">${CP.esc(r.dept)} <span class="dim t-xs">(${r.staff})</span></span>
          <span class="mono">${r.punctualityPct}% on time · ${r.coveragePct}% coverage</span></div>
          <div style="display:flex;gap:3px;height:9px;border-radius:99px;overflow:hidden;background:var(--bg-2)">
            <div style="width:${r.punctualityPct}%;background:var(--brand-500)"></div>
            <div style="width:${100 - r.punctualityPct}%;background:var(--warn);opacity:.5"></div></div></div>`).join("")}</div>
        <div class="legend mt-3"><span><i style="background:var(--accent-500)"></i>On time</span><span><i style="background:var(--warn);opacity:.5"></i>Late</span></div></div>
        <div class="table-wrap"><table><thead><tr><th>Department</th><th>Staff</th><th>Attendance</th><th>Punctuality</th><th>Coverage</th><th>Late</th><th>Missed</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="fw-6">${CP.esc(r.dept)}</td><td class="mono">${r.staff}</td>
          <td class="mono">${r.attendancePct}%</td><td class="mono">${r.punctualityPct}%</td><td class="mono">${r.coveragePct}%</td>
          <td class="mono warn">${r.lateArrivals}</td><td class="mono danger">${r.missedLessons}</td></tr>`).join("")}</tbody></table></div>`;
      const text = `DEPARTMENT PERFORMANCE — LAST ${days} SCHOOL DAYS\n${school.name}\n${"=".repeat(74)}\n\n` +
        rows.map((r) => `${(r.dept + " ".repeat(16)).slice(0, 16)} staff ${r.staff}  attendance ${r.attendancePct}%  punctuality ${r.punctualityPct}%  coverage ${r.coveragePct}%  late ${r.lateArrivals}  missed ${r.missedLessons}`).join("\n");
      return { title: "Department report", html, text, rows, file: "department-report.csv" };
    }

    // missed lessons
    const recs = [];
    for (let i = 0; i < days; i++) {
      const dt = new Date(now); dt.setDate(dt.getDate() - i);
      const k = CP.time.dayKey(dt);
      S_.instancesForDate(k).filter((x) => ["missing", "absent"].includes(x.state)).forEach((x) => recs.push({
        date: k, period: x.period, time: x.start, class: x.classId, subject: x.subject,
        room: x.roomName, teacher: x.teacherName, reason: x.note || (x.state === "absent" ? "Teacher absent" : "Not attended"),
      }));
    }
    const byTeacher = CP.by(recs, (r) => r.teacher);
    const worst = Object.keys(byTeacher).map((t) => ({ teacher: t, n: byTeacher[t].length })).sort((a, b) => b.n - a.n);
    const html = `
      <div class="grid g3 mb-4">
        ${CP.stat({ k: "Total missed", v: recs.length, tone: "danger" })}
        ${CP.stat({ k: "Teachers involved", v: worst.length, tone: "warn" })}
        ${CP.stat({ k: "Per school day", v: (recs.length / Math.max(1, days / 7 * 5)).toFixed(1), d: "avg" })}
      </div>
      <div class="card mb-4"><div class="fw-6 mb-3">Most affected teachers</div>
      ${CP.charts.bars(worst.slice(0, 10).map((w) => ({ label: w.teacher.split(" ").slice(-1)[0].slice(0, 8), value: w.n, top: w.n, color: "var(--danger)" })))}</div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>P</th><th>Time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Reason</th></tr></thead>
      <tbody>${recs.slice(0, 120).map((r) => `<tr><td class="mono">${r.date.slice(5)}</td><td class="mono">${r.period}</td><td class="mono">${r.time}</td>
        <td class="fw-6">${CP.esc(r.class)}</td><td>${CP.esc(r.subject)}</td><td>${CP.esc(r.teacher)}</td><td class="t-xs">${CP.esc(r.room)}</td>
        <td class="t-xs dim">${CP.esc(r.reason)}</td></tr>`).join("")}</tbody></table></div>`;
    const text = `MISSED LESSONS REGISTER — LAST ${days} SCHOOL DAYS\n${school.name}\n${"=".repeat(96)}\n\n` +
      `Total missed: ${recs.length}\n\n` +
      recs.slice(0, 300).map((r) => `${r.date}  P${String(r.period).padEnd(2)} ${String(r.time).padEnd(6)} ${(r.class + " ".repeat(5)).slice(0, 5)} ${(r.subject + " ".repeat(14)).slice(0, 14)} ${(r.teacher + " ".repeat(26)).slice(0, 26)} ${r.reason}`).join("\n");
    return { title: "Missed lessons register", html, text, rows: recs, file: "missed-lessons.csv" };
  }
})(window);
