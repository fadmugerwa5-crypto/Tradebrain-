/* ==========================================================================
   ClassPulse — views-admin.js
   Administrator: system, people, timetable, QR posters, settings.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;
  const V = (CP.views.admin = CP.views.admin || {});
  const Ctx = (CP._ctxAdmin = { tab: "overview" });

  /* ================================================================ OVERVIEW */
  V.overview = function (ctx) {
    const dateKey = CP.time.dayKey(S.now());
    const stats = S.dayStats(dateKey);
    const online = CP.sync ? CP.sync.state() : { connected: false, mode: "local" };
    const storageKb = CP.storage.usage() / 1024;
    const critical = S.data.alerts.filter((a) => a.level === "danger").slice(0, 5);
    const teachers = S.teachers().length;
    const ready = teachers > 0 && S.data.timetable.length > 0;

    return {
      title: "System overview",
      sub: S.data.school.name + (S.data.school.term ? " · " + S.data.school.term : ""),
      html: `
        ${CP.banner(online.connected ? "info" : "warn",
          online.connected ? "Connected to the school server" : "Running on this device only",
          online.connected
            ? "Live data is shared with every staff phone. Last sync: " + (S.data.meta.lastSync ? CP.time.ago(S.data.meta.lastSync) : "just now") + "."
            : "Scans are saved on this phone and pushed to the server the moment it is reachable again.",
          online.connected ? "wifi" : "wifiOff")}

        ${!ready ? CP.section("Get the school running") + `
        <div class="col gap-3">
          ${!teachers ? `<button class="li press" data-goto="people">
            <span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);color:var(--brand-500)">${CP.icon("users")}</span>
            <span class="body"><span class="name">Add your teachers</span><span class="meta">Names, staff numbers and PINs — or import a spreadsheet.</span></span>
            ${CP.icon("chevron")}</button>` : ""}
          ${!S.data.timetable.length ? `<button class="li press" data-goto="timetable">
            <span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);color:var(--brand-500)">${CP.icon("calendar")}</span>
            <span class="body"><span class="name">Build the timetable</span><span class="meta">Type it in, auto-generate it, or import a CSV.</span></span>
            ${CP.icon("chevron")}</button>` : ""}
          <button class="li press" data-goto="qr">
            <span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);color:var(--brand-500)">${CP.icon("qr")}</span>
            <span class="body"><span class="name">Print the QR posters</span><span class="meta">One for the gate, one for every classroom door.</span></span>
            ${CP.icon("chevron")}</button>
        </div>` : ""}

        <div class="grid g4 mt-4">
          ${CP.stat({ k: "Teachers", v: teachers, d: S.data.users.filter((u) => u.role !== "teacher").length + " leaders" })}
          ${CP.stat({ k: "Classes", v: S.data.classes.length, d: S.data.rooms.filter((r) => r.kind === "class").length + " rooms" })}
          ${CP.stat({ k: "Timetable rows", v: S.data.timetable.length, d: (S.data.timetable.length / 5).toFixed(0) + " per day" })}
          ${CP.stat({ k: "Today's coverage", v: stats.coverage + "%", tone: stats.coverage >= 90 ? "ok" : "warn" })}
        </div>

        <div class="grid g2 mt-4">
          <div class="card">
            <div class="fw-6 mb-3">${CP.icon("layers")} This device</div>
            <div class="kv"><span class="k">Local storage</span><span class="v">${storageKb.toFixed(1)} KB</span></div>
            <div class="kv"><span class="k">Scan events stored</span><span class="v">${S.data.events.length}</span></div>
            <div class="kv"><span class="k">Pending sync</span><span class="v ${S.data.outbox.length ? "warn" : ""}">${S.data.outbox.length}</span></div>
            <div class="kv"><span class="k">Alerts</span><span class="v">${S.data.alerts.length}</span></div>
            <div class="kv"><span class="k">Audit entries</span><span class="v">${S.data.audit.length}</span></div>
            <div class="kv"><span class="k">Set up</span><span class="v">${S.data.meta.setupAt ? CP.time.pretty(S.data.meta.setupAt, true) : "—"}</span></div>
          </div>
          <div class="card">
            <div class="fw-6 mb-3">${CP.icon("gear")} Quick actions</div>
            <div class="col gap-3">
              <button class="btn block" data-import-staff>${CP.icon("download")} Import staff list (CSV)</button>
              <button class="btn block" data-import-tt>${CP.icon("calendar")} Import timetable (CSV)</button>
              <button class="btn block" data-backup>${CP.icon("download")} Export full backup (JSON)</button>
              <button class="btn block" data-restore>${CP.icon("refresh")} Restore from backup</button>
              <button class="btn block" data-tick>${CP.icon("zap")} Re-run escalation scan</button>
            </div>
          </div>
        </div>

        ${CP.section("Today at a glance")}
        <div class="grid g4">
          ${CP.stat({ k: "Present at gate", v: (stats.gate.total - stats.gate.absent) + "/" + stats.gate.total, tone: "ok" })}
          ${CP.stat({ k: "Late", v: stats.gate.late, tone: "warn" })}
          ${CP.stat({ k: "Absent", v: stats.gate.absent, tone: "danger" })}
          ${CP.stat({ k: "Lessons missed", v: stats.missed, tone: stats.missed ? "danger" : "" })}
        </div>

        ${critical.length ? CP.section("Critical alerts") + critical.map(CP.alertCard).join("") : ""}

        ${CP.section("Pointers for a smooth rollout")}
        <div class="col gap-3">
          ${CP.banner("info", "Print the QR posters first", "Admin → QR Codes → Print all. Stick the gate poster at the entrance and each classroom poster on the door. That is your entire hardware cost.")}
          ${CP.banner("warn", "A printed classroom code can be photographed", "A printed code never changes, so a photo of it can be scanned later. Keep the gate poster printed; for classrooms, use Rolling display on a spare phone where you have one, keep “Gate scan before class scan” and “School Wi-Fi only” on, and have the DOS walk round.")}
          ${CP.banner("info", "Bind each teacher to one phone", "Admin → People → open a teacher → Reset device. One phone per teacher stops proxy check-ins.")}
        </div>`,
      after(root) {
        root.querySelectorAll("[data-goto]").forEach((b) => (b.onclick = () => CP.go("/admin/" + b.dataset.goto)));
        root.querySelector("[data-import-staff]").onclick = importStaff;
        root.querySelector("[data-import-tt]").onclick = importTimetable;
        root.querySelector("[data-backup]").onclick = () => { S.exportJson("classpulse-backup-" + CP.time.dayKey(new Date()) + ".json"); CP.toast({ kind: "ok", msg: "Backup downloaded." }); };
        root.querySelector("[data-restore]").onclick = () => {
          const inp = document.createElement("input");
          inp.type = "file"; inp.accept = ".json";
          inp.onchange = () => {
            const f = inp.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => { try { S.importJson(r.result); CP.toast({ kind: "ok", msg: "Backup restored." }); CP.render(); } catch (e) { CP.toast({ kind: "err", msg: "That file is not a ClassPulse backup." }); } };
            r.readAsText(f);
          };
          inp.click();
        };
        root.querySelector("[data-tick]").onclick = () => { const n = S.tick(); CP.toast({ kind: n ? "warn" : "ok", msg: n ? n + " new escalation(s) raised." : "No new escalations." }); CP.render(); };
        root.querySelectorAll("[data-cover]").forEach((b) => b.onclick = () => CP.openCover(b.dataset.cover));
      },
    };
  };

  /* --------------------------------------------------- bulk data (CSV) */
  function readTextFile(accept) {
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept || ".csv,text/csv,.txt";
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.readAsText(f);
      };
      inp.click();
    });
  }

  function importStaff() {
    const sheet = CP.sheet({
      title: "Import your staff list",
      body: `<p class="muted t-sm mb-4">Paste rows from Excel, or choose a CSV file. The columns are
        <b>name, staffNo, role, department, subjects, phone, pin</b> — only <b>name</b> and
        <b>staffNo</b> are required. A blank PIN means the teacher sets their own on first sign-in.</p>
        <textarea class="textarea" data-csv rows="9" placeholder="name,staffNo,role,department,subjects,phone,pin&#10;Jane Nakato,T-101,teacher,Mathematics,Mathematics;Additional Maths,0770000001,4821"></textarea>
        <div class="row gap-3 mt-4">
          <button class="btn grow" data-file>${CP.icon("download")} Choose a CSV file</button>
          <button class="btn primary grow" data-import>${CP.icon("check")} Import</button>
        </div>
        <button class="btn ghost block mt-3" data-tpl>${CP.icon("list")} Download a template</button>`,
    });
    const el = sheet.el;
    el.querySelector("[data-tpl]").onclick = () => {
      S.download(new Blob(["\uFEFF" + S.staffTemplate()], { type: "text/csv" }), "classpulse-staff-template.csv");
    };
    el.querySelector("[data-file]").onclick = async () => {
      const txt = await readTextFile();
      if (txt) el.querySelector("[data-csv]").value = txt;
    };
    el.querySelector("[data-import]").onclick = () => {
      const txt = el.querySelector("[data-csv]").value.trim();
      if (!txt) return CP.toast({ kind: "warn", msg: "Nothing to import yet." });
      const res = S.importStaffCsv(txt);
      if (CP.sync && CP.sync._token) S.data.users.forEach((u) => CP.sync.pushUser(u));
      S.audit(CP.me().id, "import-staff", { added: res.added, updated: res.updated, errors: res.errors.length });
      sheet.close();
      CP.render();
      CP.toast({
        kind: res.errors.length ? "warn" : "ok",
        msg: `Staff import: ${res.added} added, ${res.updated} updated${res.errors.length ? ", " + res.errors.length + " skipped" : ""}.`,
      });
      if (res.errors.length) {
        CP.sheet({
          title: "Rows that were skipped",
          body: `<div class="col gap-2">${res.errors.map((e) => `<div class="t-sm">${CP.esc(e)}</div>`).join("")}</div>`,
        });
      }
    };
  }

  function importTimetable() {
    const first = (S.data.classes[0] || {}).id || "";
    const sheet = CP.sheet({
      title: "Import a timetable",
      body: `<p class="muted t-sm mb-4">Columns: <b>day, period, class, subject, teacher, room</b>.
        <b>day</b> can be 1–5 or Monday…Friday. <b>teacher</b> is a staff number. Every row that
        clashes with an existing one is reported, never silently overwritten.</p>
        <textarea class="textarea" data-csv rows="9" placeholder="day,period,class,subject,teacher,room&#10;1,1,${CP.esc(first)},Mathematics,T-101,${CP.esc(first)}"></textarea>
        <div class="row gap-3 mt-4">
          <button class="btn grow" data-file>${CP.icon("download")} Choose a CSV file</button>
          <button class="btn primary grow" data-import>${CP.icon("check")} Import</button>
        </div>
        <div class="list mt-4"><div class="li"><div class="body"><div class="name">Replace the whole timetable</div>
          <div class="meta">Clear what is there and use only these rows</div></div>
          <div class="switch" data-replace></div></div></div>
        <button class="btn ghost block mt-3" data-tpl>${CP.icon("list")} Download a template</button>`,
    });
    const el = sheet.el;
    let replace = false;
    el.querySelector("[data-tpl]").onclick = () =>
      S.download(new Blob(["\uFEFF" + S.timetableTemplate()], { type: "text/csv" }), "classpulse-timetable-template.csv");
    el.querySelector("[data-replace]").onclick = (e) => { replace = !replace; e.currentTarget.classList.toggle("on", replace); };
    el.querySelector("[data-file]").onclick = async () => {
      const txt = await readTextFile();
      if (txt) el.querySelector("[data-csv]").value = txt;
    };
    el.querySelector("[data-import]").onclick = () => {
      const txt = el.querySelector("[data-csv]").value.trim();
      if (!txt) return CP.toast({ kind: "warn", msg: "Nothing to import yet." });
      const res = S.importTimetableCsv(txt, { replace });
      S.audit(CP.me().id, "import-timetable", { rows: res.added, errors: res.errors.length, clashes: res.clashes.length });
      sheet.close();
      CP.render();
      const problems = res.errors.concat(res.clashes);
      CP.toast({
        kind: problems.length ? "warn" : "ok",
        msg: `Timetable import: ${res.added} rows read${problems.length ? ", " + problems.length + " to review" : ""}.`,
      });
      if (problems.length) {
        CP.sheet({
          title: "Rows that need a look",
          body: `<div class="col gap-2">${problems.map((e) => `<div class="t-sm">${CP.esc(e)}</div>`).join("")}</div>`,
        });
      }
    };
  }

  /* ================================================================== PEOPLE */
  V.people = function (ctx) {
    const q = (Ctx.q || "").toLowerCase();
    const role = Ctx.roleFilter || "all";
    let list = S.data.users.slice();
    if (role !== "all") list = list.filter((u) => u.role === role);
    if (q) list = list.filter((u) => (u.name + u.staffNo + (u.dept || "")).toLowerCase().includes(q));

    return {
      title: "People",
      sub: S.data.users.length + " accounts · " + S.teachers().length + " teachers",
      html: `
        <div class="row gap-3 mb-3">
          <div class="field grow"><input class="input" data-q placeholder="Search name, staff number, department…" value="${CP.esc(Ctx.q || "")}"></div>
          <button class="btn nowrap" data-import>${CP.icon("download")} Import</button>
          <button class="btn primary nowrap" data-add>${CP.icon("plus")} Add</button>
        </div>
        ${CP.seg("pr", [
          { value: "all", label: "All" }, { value: "teacher", label: "Teachers" },
          { value: "dos", label: "DOS" }, { value: "head", label: "Head" }, { value: "admin", label: "Admin" },
        ], role)}
        <div class="list mt-4">${list.map((u) => `
          <div class="li press" data-user="${u.id}">
            ${CP.avatarHTML(u)}
            <div class="body" style="min-width:0">
              <div class="name truncate">${CP.esc(u.name)}</div>
              <div class="meta truncate">${CP.esc(u.staffNo)} · ${CP.esc(u.dept || "—")}${u.subjects && u.subjects.length ? " · " + CP.esc(u.subjects.join(", ")) : ""}</div>
              <div class="row gap-2 mt-2 wrap">
                <span class="pill" style="color:${CP.ROLES[u.role].color}">${CP.icon(CP.ROLES[u.role].icon)} ${CP.esc(CP.ROLES[u.role].short)}</span>
                ${u.role === "teacher" ? `<span class="pill ${u.device ? "ok" : "warn"}">${u.device ? "device bound" : "no device"}</span>` : ""}
                ${u.status && u.status !== "approved" ? `<span class="pill ${u.status === "pending" ? "warn" : "danger"}">${CP.esc(u.status)}</span>` : ""}
                ${u.active === false ? `<span class="pill danger">disabled</span>` : ""}
              </div>
            </div>
            ${CP.icon("chevron")}
          </div>`).join("") || CP.empty("Nobody matches", "Try a different search.", "users")}</div>`,
      after(root) {
        const inp = root.querySelector("[data-q]");
        inp.oninput = CP.debounce(() => {
          Ctx.q = inp.value; CP.render();
          const el = document.querySelector("[data-q]");
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 300);
        CP.bindSeg(root, "pr", (v) => { Ctx.roleFilter = v; CP.render(); });
        root.querySelector("[data-add]").onclick = () => editUser(null);
        root.querySelector("[data-import]").onclick = importStaff;
        root.querySelectorAll("[data-user]").forEach((b) => b.onclick = () => editUser(b.dataset.user));
      },
    };
  };

  function editUser(id) {
    const isNew = !id;
    const depts = ["Administration", ...S.depts()].filter((v, i, a) => a.indexOf(v) === i);
    const u = isNew
      ? { id: null, name: "", role: "teacher", staffNo: "T-" + (100 + S.teachers().length + 1), dept: depts[1] || "Administration", subjects: [], phone: "", active: true, createdAt: Date.now(), device: null, hasPin: false }
      : Object.assign({}, S.user(id), { hasPin: !!S.user(id).pin });
    const sheet = CP.sheet({
      title: isNew ? "Add a staff member" : "Edit " + u.name,
      body: `
        <div class="field mb-3"><label>Full name</label><input class="input" data-f="name" value="${CP.esc(u.name)}" placeholder="e.g. Grace Nabatanzi"></div>
        <div class="grid g2 mb-3">
          <div class="field"><label>Role</label><select class="select" data-f="role">
            ${Object.keys(CP.ROLES).map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${CP.esc(CP.ROLES[r].label)}</option>`).join("")}
          </select></div>
          <div class="field"><label>Staff number</label><input class="input" data-f="staffNo" value="${CP.esc(u.staffNo)}"></div>
        </div>
        <div class="grid g2 mb-3">
          <div class="field"><label>Department</label><select class="select" data-f="dept">
            ${depts.map((d) => `<option ${u.dept === d ? "selected" : ""}>${CP.esc(d)}</option>`).join("")}
          </select></div>
          <div class="field"><label>Phone (SMS)</label><input class="input" data-f="phone" inputmode="tel" value="${CP.esc(u.phone || "")}" placeholder="+256…"></div>
        </div>
        <div class="field mb-3"><label>Subjects taught (comma separated)</label><input class="input" data-f="subjects" value="${CP.esc((u.subjects || []).join(", "))}" placeholder="Biology, Agriculture"></div>
        <div class="grid g2 mb-4">
          <div class="field"><label>${isNew ? "PIN (optional)" : "New PIN (blank = keep)"}</label>
            <input class="input" data-f="pin" inputmode="numeric" placeholder="4 digits"></div>
          <div class="field"><label>Status</label><select class="select" data-f="active">
            <option value="1" ${u.active !== false ? "selected" : ""}>Active</option>
            <option value="0" ${u.active === false ? "selected" : ""}>Disabled</option>
          </select></div>
        </div>
        <div class="t-xs dim mb-4">${isNew
          ? "Leave the PIN blank and the teacher chooses their own the first time they sign in."
          : (u.hasPin ? "This person already has a PIN. Type a new one only to reset it." : "No PIN yet — this person sets their own on first sign-in.")}</div>
        <button class="btn primary block mb-3" data-save>${CP.icon("check")} ${isNew ? "Create account" : "Save changes"}</button>
        ${!isNew ? `<div class="grid g2">
          <button class="btn" data-reset-pin>${CP.icon("key")} Set a new PIN</button>
          <button class="btn" data-unbind>${CP.icon("lock")} Reset device</button>
        </div>` : ""}
        ${!isNew && u.id !== CP.me().id ? `<button class="btn danger block mt-3" data-del>${CP.icon("trash")} Delete account</button>` : ""}
        ${!isNew ? `<div class="t-xs dim mt-4">Created ${CP.time.pretty(u.createdAt, true)} · device: ${CP.esc(u.device || "none")}</div>` : ""}`,
    });
    const el = sheet.el;
    const get = (k) => { const n = el.querySelector(`[data-f="${k}"]`); return n ? n.value : ""; };
    el.querySelector("[data-save]").onclick = () => {
      const name = get("name").trim();
      const staffNo = get("staffNo").trim();
      if (!name) return CP.toast({ kind: "err", msg: "A name is required." });
      if (!staffNo) return CP.toast({ kind: "err", msg: "A staff number is required — it is what they sign in with." });
      const taken = S.byStaffNo(staffNo);
      if (taken && taken.id !== u.id) return CP.toast({ kind: "err", msg: "“" + staffNo + "” already belongs to " + taken.name + "." });
      const pin = get("pin").trim();
      if (pin && !/^\d{4,8}$/.test(pin)) return CP.toast({ kind: "err", msg: "PINs are 4 to 8 digits." });
      const patch = {
        id: u.id || undefined,
        name, staffNo,
        role: get("role"),
        dept: get("dept"),
        phone: get("phone").trim(),
        subjects: get("subjects").split(",").map((s) => s.trim()).filter(Boolean),
        active: get("active") === "1",
      };
      if (pin) patch.pin = pin;
      const saved = S.saveUser(patch);
      S.audit(CP.me().id, isNew ? "create-user" : "edit-user", { userId: saved.id, name: saved.name, role: saved.role });
      CP.toast({ kind: "ok", msg: isNew ? "Account created." : "Saved." });
      sheet.close(); CP.render();
    };
    const rp = el.querySelector("[data-reset-pin]");
    if (rp) rp.onclick = async () => {
      const v = await CP.prompt({ title: "New PIN", label: "4–8 digits for " + u.name, inputmode: "numeric", value: "" });
      if (!v) return;
      if (!/^\d{4,8}$/.test(String(v))) return CP.toast({ kind: "err", msg: "PINs are 4 to 8 digits." });
      S.saveUser({ id: u.id, pin: String(v) });
      if (CP.sync && CP.sync._token) CP.sync.changePin(String(v), { userId: u.id });
      S.save(true); S.audit(CP.me().id, "reset-pin", { userId: u.id });
      CP.toast({ kind: "ok", msg: "PIN updated. Tell " + u.name.split(" ")[0] + " the new PIN." });
      sheet.close(); CP.render();
    };
    const ub = el.querySelector("[data-unbind]");
    if (ub) ub.onclick = () => {
      S.saveUser({ id: u.id, device: null });
      if (CP.sync && CP.sync._token) CP.sync.pushUser(S.user(u.id));
      CP.toast({ kind: "ok", msg: "Device unbound — they can bind a new phone at next sign-in." });
    };
    const del = el.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      if (await CP.confirm({ title: "Delete " + u.name + "?", msg: "Their scans and history stay in the records, but the account is removed and they can no longer sign in.", ok: "Delete", danger: true })) {
        const snapshot = S.user(u.id);
        if (!S.deleteUser(u.id)) return CP.toast({ kind: "err", msg: "That is the school's only administrator." });
        if (CP.sync && CP.sync._token) CP.sync.deleteUser(snapshot);
        S.audit(CP.me().id, "delete-user", { userId: u.id });
        sheet.close(); CP.render();
      }
    };
  }

  /* =============================================================== TIMETABLE */
  V.timetable = function (ctx) {
    if (!S.data.classes.length) {
      return {
        title: "Timetable setup",
        sub: "No classes yet",
        html: CP.empty("Add a class first", "Classes come from the setup wizard, and you can add more here later.", "calendar"),
      };
    }
    const cls = Ctx.ttClass && S.classInfo(Ctx.ttClass).id === Ctx.ttClass ? Ctx.ttClass : S.data.classes[0].id;
    const days = [1, 2, 3, 4, 5];
    const periods = S.data.settings.periods;
    const rows = S.data.timetable.filter((r) => r.classId === cls);
    return {
      title: "Timetable setup",
      sub: "Tap any slot to assign a teacher, subject and room",
      wide: true,
      html: `
        <div class="row gap-3 mb-4 wrap">
          <button class="btn grow" data-autott>${CP.icon("shuffle")} Auto-generate</button>
          <button class="btn grow" data-import>${CP.icon("download")} Import CSV</button>
          <button class="btn" data-clear>${CP.icon("trash")} Clear ${CP.esc(cls)}</button>
        </div>
        <div class="chips mb-4">${S.data.classes.map((c) => `<button class="chip ${c.id === cls ? "on" : ""}" data-class="${c.id}">${c.id}</button>`).join("")}
          <button class="chip" data-add-class>${CP.icon("plus")} Class</button></div>
        <div class="table-wrap"><table style="min-width:760px">
          <thead><tr><th>Period</th>${days.map((d) => `<th>${CP.time.dayShort(new Date(2024, 0, 1 + d))}</th>`).join("")}</tr></thead>
          <tbody>${periods.map((p) => `<tr>
            <td><b>P${p.n}</b><div class="t-xs dim mono">${p.start}–${p.end}</div></td>
            ${days.map((d) => {
              const r = rows.find((x) => x.day === d && x.period === p.n);
              const t = r ? S.user(r.teacherId) : null;
              return `<td><button class="btn xs ${r ? "" : "ghost"}" style="width:100%;text-align:left;min-height:52px;flex-direction:column;align-items:flex-start;gap:1px"
                data-slot="${d}-${p.n}">
                ${r ? `<span class="fw-6 t-xs">${CP.esc(r.subject)}</span>
                  <span class="t-xs dim">${CP.esc((t || {}).name || "—")}</span>
                  <span class="t-xs dim">${CP.esc((S.room(r.roomId) || {}).name || "")}</span>`
                : `<span class="t-xs dim">+ add</span>`}
              </button></td>`;
            }).join("")}
          </tr>`).join("")}</tbody></table></div>
        <div class="banner info mt-4"><span class="ic info">${CP.icon("info")}</span>
          <div class="grow t-sm">The timetable drives everything: who is expected in which room, which teacher is “free” for cover, and what the DOS sees when a class has no teacher. Keep it accurate and ClassPulse does the rest.</div></div>`,
      after(root) {
        root.querySelectorAll("[data-class]").forEach((b) => b.onclick = () => { Ctx.ttClass = b.dataset.class; CP.render(); });
        root.querySelector("[data-add-class]").onclick = async () => {
          const name = await CP.prompt({ title: "Add a class", label: "Class name, e.g. S5C", value: "" });
          if (!name) return;
          const id = String(name).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (!id) return CP.toast({ kind: "err", msg: "Use letters and numbers, e.g. S5C." });
          if (S.data.classes.some((c) => c.id === id)) return CP.toast({ kind: "warn", msg: id + " already exists." });
          S.saveClass({ id, level: id.replace(/\D+$/, ""), stream: id.replace(/^[A-Za-z]+/, "") });
          S.audit(CP.me().id, "add-class", { id });
          if (CP.sync && CP.sync._token) CP.sync.pushConfig();
          Ctx.ttClass = id;
          CP.toast({ kind: "ok", msg: id + " added, with its own room and QR code." });
          CP.render();
        };
        root.querySelectorAll("[data-slot]").forEach((b) => b.onclick = () => editSlot(cls, b.dataset.slot));
        root.querySelector("[data-import]").onclick = importTimetable;
        root.querySelector("[data-autott]").onclick = async () => {
          if (!S.teachers().length) return CP.toast({ kind: "warn", msg: "Add your teachers first — there is nobody to teach." });
          if (!(await CP.confirm({ title: "Generate a timetable?", msg: "ClassPulse will fill every class's week from your teachers' subjects and spread the load evenly. You can then edit any slot by hand.", ok: "Generate" }))) return;
          const rowsOut = S.buildTimetable(S.teachers(), S.data.classes, periods);
          S.replaceTimetable(rowsOut);
          S.audit(CP.me().id, "regenerate-timetable", { rows: rowsOut.length });
          CP.toast({ kind: "ok", msg: rowsOut.length + " lessons scheduled." }); CP.render();
        };
        root.querySelector("[data-clear]").onclick = async () => {
          if (!(await CP.confirm({ title: "Clear timetable for " + cls + "?", msg: "All lessons for this class will be removed.", ok: "Clear", danger: true }))) return;
          S.data.timetable = S.data.timetable.filter((r) => r.classId !== cls);
          S.save(true);
          if (CP.sync) CP.sync.broadcastTimetable();
          CP.toast({ kind: "ok", msg: cls + " cleared." }); CP.render();
        };
      },
    };
  };

  function editSlot(classId, key) {
    const [d, p] = key.split("-").map(Number);
    const cur = S.data.timetable.find((r) => r.classId === classId && r.day === d && r.period === p) || {};
    const teachers = S.teachers();
    const busy = new Set(S.data.timetable.filter((r) => r.day === d && r.period === p && r.classId !== classId).map((r) => r.teacherId));
    const rooms = S.data.rooms.filter((r) => r.kind === "class" || r.kind === "lab" || r.kind === "room");
    const sheet = CP.sheet({
      title: "P" + p + " · " + CP.time.dayName(new Date(2024, 0, 1 + d)) + " · " + classId,
      body: `
        <div class="field mb-3"><label>Subject</label><input class="input" data-s="subject" value="${CP.esc(cur.subject || "")}" placeholder="e.g. Biology"></div>
        <div class="field mb-3"><label>Teacher</label><select class="select" data-s="teacherId">
          <option value="">— none —</option>
          ${teachers.map((t) => `<option value="${t.id}" ${cur.teacherId === t.id ? "selected" : ""}>${CP.esc(t.name)}${busy.has(t.id) ? " (busy)" : ""}${t.dept ? " — " + CP.esc(t.dept) : ""}</option>`).join("")}
        </select></div>
        <div class="field mb-4"><label>Room</label><select class="select" data-s="roomId">
          ${rooms.map((r) => `<option value="${r.id}" ${(cur.roomId || "room-" + classId) === r.id ? "selected" : ""}>${CP.esc(r.name)}${r.building ? " — " + CP.esc(r.building) : ""}</option>`).join("")}
        </select></div>
        <div class="row gap-3">
          <button class="btn grow" data-clear-slot>Clear slot</button>
          <button class="btn primary grow" data-save>Save</button>
        </div>`,
    });
    const el = sheet.el;
    const g = (k) => el.querySelector(`[data-s="${k}"]`).value;
    el.querySelector("[data-save]").onclick = () => {
      const res = S.setTimetableRow({
        day: d, period: p, classId,
        subject: g("subject").trim() || "Free",
        teacherId: g("teacherId") || null,
        roomId: g("roomId"),
      });
      if (res && res.clash) {
        CP.toast({ kind: "err", msg: "That teacher or room is already booked in this period." });
        return;
      }
      if (CP.sync) CP.sync.broadcastTimetable();
      S.audit(CP.me().id, "edit-timetable", { classId, day: d, period: p });
      CP.toast({ kind: "ok", msg: "Slot saved." });
      sheet.close(); CP.render();
    };
    el.querySelector("[data-clear-slot]").onclick = () => {
      S.clearSlot(d, p, classId);
      if (CP.sync) CP.sync.broadcastTimetable();
      sheet.close(); CP.render();
    };
  }

  /* ================================================================ QR CODES */
  V.qr = function (ctx) {
    const zones = S.data.zones;
    const kind = Ctx.qrKind || "all";
    const list = zones.filter((z) => kind === "all" || z.kind === kind);
    const typeColor = (k) => k === "gate" ? "var(--ok)" : k === "staff" ? "var(--warn)" : "var(--brand-500)";
    const typeLabel = (k) => k === "gate" ? "Gate" : k === "staff" ? "Staff area" : "Classroom";
    return {
      title: "QR codes & posters",
      sub: "Print once, stick on the gate and classroom doors",
      html: `
        <div class="row gap-3 mb-4 wrap">
          <button class="btn primary grow" data-print-all>${CP.icon("print")} Print all posters</button>
          <button class="btn grow" data-rolling>${CP.icon("play")} Rolling display</button>
        </div>
        ${CP.seg("qk", [
          { value: "all", label: "All" }, { value: "gate", label: "Gate" },
          { value: "class", label: "Classrooms" }, { value: "staff", label: "Staff areas" },
        ], kind)}
        <div class="qr-grid mt-4">${list.map((z) => {
          const payload = S.qrPayload(z.roomId);
          const color = typeColor(z.kind);
          return `<div class="qr-tile">
            <div class="qr-tile-head">
              <span class="qr-tile-dot" style="background:${color}"></span>
              <span class="qr-tile-type">${CP.esc(typeLabel(z.kind))}</span>
            </div>
            <div class="qr-tile-code">${CP.esc(z.label)}</div>
            <div class="qr-tile-qr">${CP.qr.svg(payload, { cell: 6 })}</div>
            <div class="qr-tile-ref"><span class="mono">${CP.esc(z.code)}</span></div>
            <div class="qr-tile-actions">
              <button class="btn xs grow" data-copy="${CP.esc(z.code)}">${CP.icon("key")} Copy code</button>
              <button class="btn xs" data-print-one="${z.roomId}">${CP.icon("print")}</button>
            </div>
            ${z.kind === "class" ? `<div class="qr-tile-note">Rolling code available — show a fresh code every ${S.data.settings.rotateSec}s on a spare screen.</div>` : ""}
          </div>`;
        }).join("")}</div>
        <div class="t-xs dim mt-4" style="text-align:center">Paper and a printer is the whole hardware cost. Each poster carries a signed code the app verifies.</div>`,
      after(root) {
        CP.bindSeg(root, "qk", (v) => { Ctx.qrKind = v; CP.render(); });
        root.querySelector("[data-print-all]").onclick = printPosters;
        root.querySelector("[data-rolling]").onclick = rollingDisplay;
        root.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => {
          navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy);
          CP.toast({ kind: "ok", msg: "Code " + b.dataset.copy + " copied." });
        });
        root.querySelectorAll("[data-print-one]").forEach((b) => b.onclick = () => printPosters(b.dataset.printOne));
      },
    };
  };

  function printPosters(only) {
    const list = S.data.zones.filter((z) => !only || z.roomId === only);
    const html = list.map((z) => {
      const payload = S.qrPayload(z.roomId);
      const svg = CP.qr.svg(payload, { cell: 8 }).replace(/<svg /, '<svg width="320" height="320" ');
      return `<div class="poster">
        <div class="top">${CP.esc(S.data.school.name)}</div>
        <div class="ttl">${CP.esc(z.label)}</div>
        <div class="qr">${svg}</div>
        <div class="code">CODE: <b>${CP.esc(z.code)}</b></div>
        <div class="ins">Open ClassPulse → <b>Scan</b> → point at this code.<br>
          Teachers: scan the gate code on arrival, then your classroom code when the lesson starts and again when it ends.</div>
        <div class="foot">ClassPulse · ${CP.esc(S.data.school.term)}</div>
      </div>`;
    }).join("");
    const w = window.open("", "_blank");
    if (!w) return CP.toast({ kind: "err", msg: "Allow pop-ups to print posters." });
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ClassPulse QR posters</title>
      <style>
        *{box-sizing:border-box}
        body{font:13px/1.45 "Segoe UI",system-ui,sans-serif;margin:0;background:#fff;color:#111}
        .poster{width:210mm;min-height:140mm;padding:16mm;page-break-after:always;text-align:center;
          display:flex;flex-direction:column;align-items:center;justify-content:center;border-bottom:1px dashed #bbb}
        .top{font-weight:700;letter-spacing:.18em;font-size:12px;text-transform:uppercase;color:#444}
        .ttl{font-size:34px;font-weight:800;margin:6px 0 14px;letter-spacing:-.02em}
        .qr{border:6px solid #111;border-radius:16px;padding:14px;background:#fff}
        .code{margin-top:12px;font-size:18px;letter-spacing:.08em}
        .ins{margin-top:14px;font-size:14px;max-width:130mm;color:#333}
        .foot{margin-top:14px;font-size:11px;color:#777;letter-spacing:.06em}
        @media print{ @page{size:A4;margin:0} .poster{border:0} }
      </style></head><body>${html}
      <script>setTimeout(function(){window.print()},500)<\/script></body></html>`);
    w.document.close();
  }

  function rollingDisplay() {
    const classes = S.data.zones.filter((z) => z.kind === "class");
    CP.pick({
      title: "Rolling QR display",
      options: classes.map((z) => ({ label: z.label, sub: "classroom", value: z.roomId, icon: "qr", color: "var(--bg-2)" })),
    }).then((roomId) => {
      if (!roomId) return;
      const zone = S.zone(roomId);
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;inset:0;z-index:200;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center";
      document.body.appendChild(el);
      let left = 0;
      function draw() {
        const payload = S.qrPayload(zone.roomId);
        const left2 = S.data.settings.rotateSec - (Math.floor(Date.now() / 1000) % S.data.settings.rotateSec);
        left = left2;
        el.innerHTML = `
          <div style="font:700 12px/1.4 system-ui;letter-spacing:.2em;color:#444;text-transform:uppercase">${CP.esc(S.data.school.name)}</div>
          <div style="font:800 40px/1.1 system-ui;color:#0b1020;letter-spacing:-.02em">${CP.esc(zone.label)}</div>
          <div style="border:6px solid #0b1020;border-radius:18px;padding:14px;background:#fff">${CP.qr.svg(payload, { cell: 8 }).replace(/<svg /, '<svg width="300" height="300" ')}</div>
          <div style="font:600 15px/1.4 system-ui;color:#334155;max-width:420px">Teachers: open ClassPulse and scan this screen.<br>The code refreshes every ${S.data.settings.rotateSec} seconds.</div>
          <div style="font:800 15px system-ui;color:${left2 <= 10 ? "#dc2626" : "#0b1020"}">refreshing in ${left2}s</div>
          <button style="position:absolute;top:16px;right:16px;font:700 13px system-ui;padding:10px 16px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;color:#0b1020">Exit display</button>`;
        el.querySelector("button").onclick = () => { clearInterval(iv); el.remove(); };
      }
      draw();
      const iv = setInterval(draw, 1000);
    });
  }

  /* ================================================================ SETTINGS */
  V.settings = function (ctx) {
    const st = S.data.settings;
    const sch = S.data.school;
    return {
      title: "Settings",
      sub: "School day, rules, escalation and integrations",
      html: `
        ${CP.section("School")}
        <div class="card mb-4">
          <div class="field mb-3"><label>School name</label><input class="input" data-st="school.name" value="${CP.esc(sch.name)}"></div>
          <div class="field mb-3">
            <label>School logo</label>
            <div class="row gap-3">
              <div style="width:56px;height:56px;border-radius:12px;background:var(--bg-2);border:1px solid var(--line);display:grid;place-items:center;overflow:hidden;flex:0 0 auto">
                ${sch.logo ? `<img src="${CP.esc(sch.logo)}" alt="logo" style="width:100%;height:100%;object-fit:contain">` : CP.icon("building")}
              </div>
              <div class="grow">
                <input type="file" accept="image/*" data-logo class="input" style="padding:8px">
                <div class="t-xs dim mt-1">PNG or SVG, ideally square. Shown in the header and on printed posters.</div>
              </div>
            </div>
          </div>
          <div class="grid g2 mb-3">
            <div class="field"><label>Term</label><input class="input" data-st="school.term" value="${CP.esc(sch.term)}"></div>
            <div class="field"><label>Motto</label><input class="input" data-st="school.motto" value="${CP.esc(sch.motto || "")}"></div>
          </div>
          <div class="grid g2">
            <div class="field"><label>Latitude</label><input class="input" data-st="school.centre.lat" value="${sch.centre.lat == null ? "" : sch.centre.lat}" placeholder="optional"></div>
            <div class="field"><label>Longitude</label><input class="input" data-st="school.centre.lng" value="${sch.centre.lng == null ? "" : sch.centre.lng}" placeholder="optional"></div>
          </div>
          <div class="t-xs dim mt-3">Latitude and longitude let the app refuse scans taken away from the school. Leave them blank if you do not want that.</div>
        </div>

        ${CP.section("The school day")}
        <div class="card mb-4">
          <div class="grid g3 mb-4">
            <div class="field"><label>Expected arrival</label><input class="input" type="time" data-st="settings.schoolStart" value="${st.schoolStart}"></div>
            <div class="field"><label>Late after</label><input class="input" type="time" data-st="settings.lateAfter" value="${st.lateAfter}"></div>
            <div class="field"><label>School closes</label><input class="input" type="time" data-st="settings.schoolEnd" value="${st.schoolEnd}"></div>
          </div>
          <div class="t-xs dim upper mb-2">Periods</div>
          <div class="table-wrap mb-3"><table style="min-width:420px"><thead><tr><th>Period</th><th>Start</th><th>End</th></tr></thead>
            <tbody>${st.periods.map((p, i) => `<tr><td class="fw-6">P${p.n}</td>
              <td><input class="input" style="min-height:36px" type="time" data-per="${i}-start" value="${p.start}"></td>
              <td><input class="input" style="min-height:36px" type="time" data-per="${i}-end" value="${p.end}"></td></tr>`).join("")}</tbody>
          </table></div>
          <button class="btn sm" data-add-period>${CP.icon("plus")} Add a period</button>
        </div>

        ${CP.section("Rules & anti-cheating")}
        <div class="card mb-4">
          <div class="grid g3 mb-4">
            <div class="field"><label>Late into lesson after (min)</label><input class="input" type="number" data-st="settings.lateAfterLessonMin" value="${st.lateAfterLessonMin}"></div>
            <div class="field"><label>Alert DOS after (min)</label><input class="input" type="number" data-st="settings.missingAfterMin" value="${st.missingAfterMin}"></div>
            <div class="field"><label>Escalate to Head after (min)</label><input class="input" type="number" data-st="settings.escalationMin2" value="${st.escalationMin2}"></div>
          </div>
          <div class="grid g3 mb-4">
            <div class="field"><label>Mark critical after (min)</label><input class="input" type="number" data-st="settings.escalationMin3" value="${st.escalationMin3}"></div>
            <div class="field"><label>Rolling QR window (s)</label><input class="input" type="number" data-st="settings.rotateSec" value="${st.rotateSec}"></div>
            <div class="field"><label>Geofence radius (m)</label><input class="input" type="number" data-st="settings.geofenceMeters" value="${st.geofenceMeters}"></div>
          </div>
          <div class="list">
            ${swRow("rotateClassQR", "Rolling classroom codes", "Change the classroom code every " + st.rotateSec + " seconds")}
            ${swRow("requireGeofence", "Require GPS geofence", "Only allow scans within " + st.geofenceMeters + " m")}
            ${swRow("requireGateFirst", "Gate scan before class scan", "A classroom scan only counts after the gate check-in")}
            ${swRow("requireSchoolNetwork", "School Wi-Fi only", "The school server must see the scan coming from the school network")}
            ${swRow("requireDeviceBinding", "One phone per teacher", "Block scans from unbound devices")}
            ${swRow("allowManualMark", "Allow manual marking by DOS", "Every manual entry is audited")}
            ${swRow("autoEscalate", "Automatic escalation", "Move alerts up the chain of command")}
          </div>
          <div class="field mt-4">
            <label>School network addresses</label>
            <input class="input" data-networks value="${CP.esc((st.schoolNetworks || []).join(", "))}" placeholder="192.168.1.0/24, 41.90.12.34">
            <div class="row wrap gap-2 mt-2">
              <button class="btn ghost sm" data-detect-net>${CP.icon("wifi", ' style="width:15px;height:15px"')} Use this connection</button>
              <span class="t-xs dim" data-net-status>Checked from the phone or computer you are using now.</span>
            </div>
            <div class="t-xs dim mt-2">Leave blank on a school computer: it trusts its own Wi-Fi automatically. If the server is hosted online, add the school's public IP here — press the button while on the school Wi-Fi.</div>
          </div>
        </div>

        ${CP.section("SMS & notifications")}
        <div class="card mb-4">
          <div class="list mb-3">${swRow("smsEnabled", "Send SMS alerts", "For a DOS who does not always open the app")}</div>
          <div class="grid g2 mb-3">
            <div class="field"><label>Gateway</label><select class="select" data-st="settings.smsProvider">
              ${["africastalking", "twilio", "gsm-modem", "custom-http"].map((p) => `<option value="${p}" ${st.smsProvider === p ? "selected" : ""}>${p}</option>`).join("")}
            </select></div>
            <div class="field"><label>Sender ID</label><input class="input" data-st="settings.smsSender" value="${CP.esc(st.smsSender)}"></div>
          </div>
          <div class="grid g2">
            <div class="field"><label>DOS phone</label><input class="input" data-st="settings.dosPhone" inputmode="tel" value="${CP.esc(st.dosPhone || "")}"></div>
            <div class="field"><label>Head phone</label><input class="input" data-st="settings.headPhone" inputmode="tel" value="${CP.esc(st.headPhone || "")}"></div>
          </div>
        </div>

        ${CP.section("Server & sync")}
        <div class="card mb-4">
          <div class="field mb-3"><label>Server URL</label><input class="input" data-api placeholder="http://192.168.1.20:8787"></div>
          <div class="row gap-3">
            <button class="btn grow" data-sync-now>${CP.icon("refresh")} Sync now</button>
            <button class="btn grow" data-sync-test>${CP.icon("wifi")} Test connection</button>
          </div>
          <div class="t-xs dim mt-3" data-sync-status></div>
        </div>

        <button class="btn primary block mb-4" data-save-all>${CP.icon("check")} Save all settings</button>

        ${CP.section("My account")}
        <div class="card mb-4">
          <div class="row between mb-3"><div><div class="fw-6">${CP.esc(CP.me().name)}</div>
            <div class="t-sm muted">${CP.esc(CP.me().staffNo)} · ${CP.esc((CP.ROLES[CP.me().role] || {}).label || CP.me().role)}</div></div>
            ${CP.avatarHTML(CP.me())}</div>
          <button class="btn block" data-my-pin>${CP.icon("key")} Change my PIN</button>
        </div>

        ${CP.section("Danger zone")}
        <div class="card">
          <div class="row between mb-3"><div><div class="fw-6">Erase this device</div>
            <div class="t-sm muted">${CP.sync && CP.sync.state().server
              ? "Clears this phone completely. The school's own copy on the server is untouched, so it will sync back on next sign-in."
              : "Clears this phone completely. With no server connected, the school's data is gone — export a backup first."}</div></div>
            <button class="btn danger" data-reset>Erase</button></div>
        </div>`,
      after(root) {
        const api = root.querySelector("[data-api]");
        if (api) api.value = CP.storage.get("api", "");
        root.querySelectorAll("[data-s]").forEach((s) => {
          const key = s.dataset.s;
          s.onclick = () => { setPath(st, key, !getPath(st, key)); s.classList.toggle("on"); };
        });
        root.querySelector("[data-add-period]").onclick = () => {
          const last = st.periods[st.periods.length - 1];
          const n = last.n + 1;
          const start = CP.time.fromMins(CP.time.mins(last.end) + 5);
          st.periods.push({ n, start, end: CP.time.fromMins(CP.time.mins(start) + 40) });
          S.save(true); CP.render();
        };
        const detectBtn = root.querySelector("[data-detect-net]");
        if (detectBtn) {
          const netStatus = root.querySelector("[data-net-status]");
          if (netStatus && CP.sync && CP.sync.whoami) {
            CP.sync.whoami().then((r) => {
              if (!r || !r.ip) return;
              netStatus.textContent = r.onSchoolNetwork
                ? "This connection (" + r.ip + ") counts as the school network."
                : "This connection (" + r.ip + ") is NOT the school network — scans would be refused here.";
              netStatus.className = "t-xs " + (r.onSchoolNetwork ? "dim" : "");
              if (!r.onSchoolNetwork) netStatus.style.color = "var(--warn)";
            });
          }
          detectBtn.onclick = () => {
            const status = root.querySelector("[data-net-status]");
            const field = root.querySelector("[data-networks]");
            if (status) status.textContent = "Checking…";
            if (!CP.sync || !CP.sync.whoami) { if (status) status.textContent = "No server connected."; return; }
            CP.sync.whoami().then((r) => {
              if (!r || !r.ip) {
                if (status) status.textContent = "Could not reach the server. Check the address above.";
                return;
              }
              const list = String(field.value || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
              // /24 is the usual school Wi-Fi size; offer it so the whole Wi-Fi works.
              const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(r.ip);
              const offer = m ? [m[1], m[2], m[3], "0"].join(".") + "/24" : r.ip;
              if (!list.includes(offer) && !list.includes(r.ip)) list.push(offer);
              field.value = list.join(", ");
              if (status) status.textContent = "Added " + offer + " — press Save to apply.";
              CP.toast({ kind: "ok", msg: "Added this connection: " + offer });
            });
          };
        }
        const logoInput = root.querySelector("[data-logo]");
        if (logoInput) logoInput.onchange = () => {
          const f = logoInput.files && logoInput.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            S.data.school.logo = String(r.result || "");
            S.save(true);
            CP.toast({ kind: "ok", msg: "Logo updated." });
            CP.render();
          };
          r.readAsDataURL(f);
        };
        root.querySelector("[data-save-all]").onclick = () => {
          let changed = 0;
          root.querySelectorAll("[data-st]").forEach((el) => {
            const key = el.dataset.st;
            let v = el.value;
            if (el.type === "number") v = +v;
            if (el.type === "checkbox") v = el.checked;
            setPath({ school: S.data.school, settings: S.data.settings }, key, v);
            changed++;
          });
          st.periods.forEach((p, i) => {
            const s = root.querySelector(`[data-per="${i}-start"]`);
            const e = root.querySelector(`[data-per="${i}-end"]`);
            if (s) p.start = s.value;
            if (e) p.end = e.value;
          });
          const netEl = root.querySelector("[data-networks]");
          if (netEl) {
            st.schoolNetworks = netEl.value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
            changed++;
          }
          S.save(true);
          S.audit(CP.me().id, "update-settings", { fields: changed });
          const finish = () => {
            CP.toast({ kind: "ok", msg: "Settings saved." });
            CP.render();
          };
          if (api && CP.sync && api.value.trim() !== CP.sync.state().server) {
            CP.sync.setServer(api.value.trim()).then((ok) => {
              CP.toast({ kind: ok ? "ok" : "warn", msg: ok ? "Settings saved · server connected." : "Settings saved · server not reachable." });
              if (ok && CP.sync._token) CP.sync.broadcastSettings();
            });
          } else if (CP.sync && CP.sync._token) {
            CP.sync.broadcastSettings().then(finish);
          } else {
            finish();
          }
        };
        root.querySelector("[data-reset]").onclick = async () => {
          const hasServer = CP.sync && CP.sync.state().server;
          if (await CP.confirm({
            title: "Erase this device?",
            msg: hasServer
              ? "This phone will be wiped. The school's copy on the server stays, so the data comes back the next time you are online."
              : "This phone will be wiped and there is no server copy. Export a backup first. This cannot be undone.",
            ok: "Erase", danger: true,
          })) {
            S.reset();
            CP.toast({ kind: "ok", msg: "This device has been cleared." });
            if (hasServer) CP.sync.syncNow().then(() => CP.render());
            else CP.render();
          }
        };
        const mp = root.querySelector("[data-my-pin]");
        if (mp) mp.onclick = async () => {
          const p1 = await CP.prompt({ title: "New PIN", label: "4–8 digits for your account", inputmode: "numeric", value: "" });
          if (!p1) return;
          if (!/^\d{4,8}$/.test(String(p1))) return CP.toast({ kind: "err", msg: "PINs are 4 to 8 digits." });
          const p2 = await CP.prompt({ title: "Repeat the PIN", label: "Type it once more", inputmode: "numeric", value: "" });
          if (p1 !== p2) return CP.toast({ kind: "err", msg: "The PINs did not match." });
          S.saveUser({ id: CP.me().id, pin: String(p1) });
          if (CP.sync && CP.sync._token) await CP.sync.changePin(String(p1));
          CP.toast({ kind: "ok", msg: "Your PIN has been changed." });
        };
        const stEl = root.querySelector("[data-sync-status]");
        function show() {
          const s = CP.sync ? CP.sync.state() : { connected: false, mode: "local" };
          stEl.textContent = "Mode: " + s.mode + (s.connected ? " · connected" : " · not connected") + " · pending ops: " + S.data.outbox.length;
        }
        show();
        root.querySelector("[data-sync-now]").onclick = async () => { if (CP.sync) { await CP.sync.syncNow(); show(); } };
        root.querySelector("[data-sync-test]").onclick = async () => {
          if (!CP.sync) return;
          const ok = await CP.sync.test();
          CP.toast({ kind: ok ? "ok" : "err", msg: ok ? "Server reachable." : "Cannot reach the server at that address." });
          show();
        };
      },
    };
  };

  /* ================================================================ MARKS */
  V.marks = function (ctx) {
    const classes = S.data.classes || [];
    const cls = Ctx.marksClass || (classes[0] && classes[0].id) || "";
    const subjects = Array.from(new Set((S.data.timetable || []).filter((r) => r.classId === cls).map((r) => r.subject)));
    const subj = Ctx.marksSubject || (subjects[0] || "");
    const term = S.data.school.term || "Term I";
    const marks = (S.data.marks || []).filter((m) => m.classId === cls && m.subject === subj && m.term === term);
    const students = []; // placeholder roster
    return {
      title: "Marks entry",
      sub: "Enter and keep assessment marks per class",
      html: `
        ${CP.banner("info", "Marks panel", "Enter assessment marks per class, subject and term. Data is saved on this device. To pull marks from studykitug.com, configure the integration in Settings → Integrations (coming soon).")}
        <div class="row gap-3 mb-4 wrap">
          <div class="field grow"><label>Class</label><select class="select" data-marks-class>${classes.map((c) => `<option value="${c.id}" ${c.id === cls ? "selected" : ""}>${CP.esc(c.id)}</option>`).join("")}</select></div>
          <div class="field grow"><label>Subject</label><select class="select" data-marks-subject>${subjects.map((s) => `<option value="${CP.esc(s)}" ${s === subj ? "selected" : ""}>${CP.esc(s)}</option>`).join("") || `<option value="">— pick a class with a timetable —</option>`}</select></div>
          <div class="field grow"><label>Term</label><input class="input" data-marks-term value="${CP.esc(term)}"></div>
        </div>
        <div class="card mb-4">
          <div class="row between mb-3">
            <div class="fw-6">Marks for ${CP.esc(cls)} · ${CP.esc(subj || "—")} · ${CP.esc(term)}</div>
            <button class="btn xs" data-marks-add>${CP.icon("plus")} Add row</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Assessment</th><th>Score</th><th>Out of</th><th></th></tr></thead>
              <tbody data-marks-body>
                ${marks.map((m, i) => `<tr>
                  <td><input class="input" data-mk="student" data-i="${i}" value="${CP.esc(m.student)}" style="min-height:34px;padding:6px 8px"></td>
                  <td><input class="input" data-mk="assessment" data-i="${i}" value="${CP.esc(m.assessment)}" style="min-height:34px;padding:6px 8px"></td>
                  <td><input class="input" type="number" data-mk="score" data-i="${i}" value="${m.score}" style="min-height:34px;padding:6px 8px;width:70px"></td>
                  <td><input class="input" type="number" data-mk="outOf" data-i="${i}" value="${m.outOf}" style="min-height:34px;padding:6px 8px;width:70px"></td>
                  <td><button class="icon-btn" style="width:30px;height:30px" data-mk-del="${i}">${CP.icon("trash")}</button></td>
                </tr>`).join("") || `<tr><td colspan="5" class="t-sm muted text-c" style="padding:20px">No marks yet. Click “Add row”.</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="row gap-3 mt-4">
            <button class="btn primary grow" data-marks-save>${CP.icon("check")} Save marks</button>
            <button class="btn grow" data-marks-export>${CP.icon("download")} Export CSV</button>
          </div>
        </div>`,
      after(root) {
        root.querySelector("[data-marks-class]").onchange = (e) => { Ctx.marksClass = e.target.value; CP.render(); };
        root.querySelector("[data-marks-subject]").onchange = (e) => { Ctx.marksSubject = e.target.value; CP.render(); };
        const termEl = root.querySelector("[data-marks-term]");
        if (termEl) termEl.onchange = () => CP.render();
        root.querySelector("[data-marks-add]").onclick = () => {
          const list = S.data.marks = S.data.marks || [];
          list.push({ id: CP.uid("mk"), syncId: CP.uid("op"), pushed: false, classId: cls, subject: subj, term: termEl ? termEl.value : term, student: "", assessment: "End of term", score: 0, outOf: 100, ts: Date.now() });
          S.save(true);
          S.emit("marks");
          CP.render();
        };
        root.querySelectorAll("[data-mk-del]").forEach((b) => b.onclick = () => {
          const i = +b.dataset.mkDel;
          const filtered = (S.data.marks || []).filter((m) => !(m.classId === cls && m.subject === subj && m.term === term));
          // remove by index within filtered
          const all = S.data.marks || [];
          const target = marks[i];
          if (target) {
            const idx = all.findIndex((m) => m.id === target.id);
            if (idx >= 0) all.splice(idx, 1);
            S.data.markDeletes = S.data.markDeletes || [];
            S.data.markDeletes.push({ id: target.id, syncId: CP.uid("op"), deleted: true, pushed: false, ts: Date.now() });
          }
          S.save(true);
          S.emit("marks");
          CP.render();
        });
        root.querySelector("[data-marks-save]").onclick = () => {
          // collect from inputs
          const rows = root.querySelectorAll("[data-marks-body] tr");
          let i = 0;
          const current = (S.data.marks || []).filter((m) => m.classId === cls && m.subject === subj && m.term === (termEl ? termEl.value : term));
          root.querySelectorAll("[data-mk]").forEach((inp) => {
            const idx = +inp.dataset.i;
            const rec = current[idx];
            if (!rec) return;
            const field = inp.dataset.mk;
            if (field === "student") rec.student = inp.value;
            else if (field === "assessment") rec.assessment = inp.value;
            else if (field === "score") rec.score = +inp.value;
            else if (field === "outOf") rec.outOf = +inp.value;
            rec.term = termEl ? termEl.value : term;
            rec.syncId = CP.uid("op");
            rec.pushed = false;
          });
          S.save(true);
          S.emit("marks");
          CP.toast({ kind: "ok", msg: "Marks saved." });
        };
        root.querySelector("[data-marks-export]").onclick = () => {
          const rows = (S.data.marks || []).filter((m) => m.classId === cls && m.subject === subj);
          const csv = "Student,Assessment,Score,Out of,Term\\n" + rows.map((m) => `"${m.student}","${m.assessment}",${m.score},${m.outOf},"${m.term}"`).join("\\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = "marks-" + cls + "-" + subj + ".csv"; a.click();
          URL.revokeObjectURL(url);
          CP.toast({ kind: "ok", msg: "Marks exported." });
        };
      },
    };
  };

  /* ================================================================ CALENDAR */
  V.calendar = function (ctx) {
    const cal = S.data.calendar || { academicYear: "", termStart: "", termEnd: "", holidays: [], events: [] };
    const holidays = cal.holidays || [];
    const events = cal.events || [];
    return {
      title: "School calendar",
      sub: "Academic year, terms, holidays and events",
      html: `
        ${CP.banner("info", "Calendar drives attendance", "Gate scans on a holiday or weekend are flagged for review. Timetable and attendance calculations respect these dates.")}
        <div class="card mb-4">
          <div class="grid g2 mb-3">
            <div class="field"><label>Academic year</label><input class="input" data-cal="academicYear" value="${CP.esc(cal.academicYear)}" placeholder="e.g. 2026"></div>
            <div class="field"><label>Term</label><input class="input" data-cal="term" value="${CP.esc(S.data.school.term || "")}" placeholder="e.g. Term I 2026"></div>
          </div>
          <div class="grid g2 mb-3">
            <div class="field"><label>Term starts</label><input class="input" type="date" data-cal="termStart" value="${CP.esc(cal.termStart || "")}"></div>
            <div class="field"><label>Term ends</label><input class="input" type="date" data-cal="termEnd" value="${CP.esc(cal.termEnd || "")}"></div>
          </div>
          <div class="t-xs dim">Weekends (Sat/Sun) are treated as non-school days automatically.</div>
        </div>
        <div class="card mb-4">
          <div class="row between mb-3">
            <div class="fw-6">Holidays</div>
            <button class="btn xs" data-cal-add-holiday>${CP.icon("plus")} Add holiday</button>
          </div>
          <div class="list">${holidays.length ? holidays.map((h, i) => `
            <div class="li">
              <span class="body"><span class="name">${CP.esc(h.name)}</span><span class="meta">${CP.esc(h.date)}${h.note ? " · " + CP.esc(h.note) : ""}</span></span>
              <button class="icon-btn" style="width:30px;height:30px" data-cal-del-holiday="${i}">${CP.icon("trash")}</button>
            </div>`).join("") : `<div class="t-sm muted text-c" style="padding:12px">No holidays configured.</div>`}</div>
        </div>
        <div class="card mb-4">
          <div class="row between mb-3">
            <div class="fw-6">School events</div>
            <button class="btn xs" data-cal-add-event>${CP.icon("plus")} Add event</button>
          </div>
          <div class="list">${events.length ? events.map((e, i) => `
            <div class="li">
              <span class="body"><span class="name">${CP.esc(e.name)}</span><span class="meta">${CP.esc(e.date)}${e.note ? " · " + CP.esc(e.note) : ""}</span></span>
              <button class="icon-btn" style="width:30px;height:30px" data-cal-del-event="${i}">${CP.icon("trash")}</button>
            </div>`).join("") : `<div class="t-sm muted text-c" style="padding:12px">No events configured.</div>`}</div>
        </div>
        <button class="btn primary block" data-cal-save>${CP.icon("check")} Save calendar</button>`,
      after(root) {
        root.querySelector("[data-cal-save]").onclick = () => {
          const cal = S.data.calendar = S.data.calendar || { holidays: [], events: [] };
          cal.academicYear = root.querySelector('[data-cal="academicYear"]').value.trim();
          cal.termStart = root.querySelector('[data-cal="termStart"]').value;
          cal.termEnd = root.querySelector('[data-cal="termEnd"]').value;
          S.data.school.term = root.querySelector('[data-cal="term"]').value.trim() || S.data.school.term;
          S.save(true);
          S.emit("settings");
          CP.toast({ kind: "ok", msg: "Calendar saved." });
        };
        root.querySelector("[data-cal-add-holiday]").onclick = async () => {
          const name = await CP.prompt({ title: "Holiday name", label: "e.g. Independence Day" });
          if (!name) return;
          const date = await CP.prompt({ title: "Date", label: "YYYY-MM-DD" });
          if (!date) return;
          const cal = S.data.calendar = S.data.calendar || { holidays: [], events: [] };
          cal.holidays = cal.holidays || [];
          cal.holidays.push({ name, date, note: "" });
          S.save(true);
          S.emit("settings");
          CP.render();
        };
        root.querySelector("[data-cal-add-event]").onclick = async () => {
          const name = await CP.prompt({ title: "Event name", label: "e.g. Sports Day" });
          if (!name) return;
          const date = await CP.prompt({ title: "Date", label: "YYYY-MM-DD" });
          if (!date) return;
          const cal = S.data.calendar = S.data.calendar || { holidays: [], events: [] };
          cal.events = cal.events || [];
          cal.events.push({ name, date, note: "" });
          S.save(true);
          S.emit("settings");
          CP.render();
        };
        root.querySelectorAll("[data-cal-del-holiday]").forEach((b) => b.onclick = () => {
          const i = +b.dataset.calDelHoliday;
          const cal = S.data.calendar;
          if (cal && cal.holidays) cal.holidays.splice(i, 1);
          S.save(true);
          S.emit("settings");
          CP.render();
        });
        root.querySelectorAll("[data-cal-del-event]").forEach((b) => b.onclick = () => {
          const i = +b.dataset.calDelEvent;
          const cal = S.data.calendar;
          if (cal && cal.events) cal.events.splice(i, 1);
          S.save(true);
          S.emit("settings");
          CP.render();
        });
      },
    };
  };

  function swRow(key, title, sub) {
    const st = S.data.settings;
    return `<div class="li"><div class="body"><div class="name">${CP.esc(title)}</div>
      <div class="meta">${CP.esc(sub)}</div></div>
      <div class="switch ${st[key] ? "on" : ""}" data-s="${key}"></div></div>`;
  }
  function getPath(o, path) { return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, v) {
    const parts = path.split(".");
    const last = parts.pop();
    const t = parts.reduce((a, k) => (a[k] = a[k] || {}), o);
    t[last] = v;
  }
})(window);
