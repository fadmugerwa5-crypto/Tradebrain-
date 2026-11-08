/* ==========================================================================
   ClassPulse — views-setup.js
   First-run setup wizard. Runs once, before anybody can sign in, and writes
   the school's REAL configuration: name, term, bell schedule, classes,
   subjects and the first administrator account. Nothing is pre-filled with
   fake staff or fake history.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;

  const STEPS = ["School", "Administrator", "School day", "Classes", "Review"];

  CP.views.setup = function () {
    const D = S.DEFAULT_SETTINGS;
    const st = {
      step: 0,
      school: { name: "", motto: "", address: "", term: "" },
      admin: { name: "", staffNo: "ADM-001", pin: "", pin2: "", phone: "" },
      day: {
        schoolStart: D.schoolStart, lateAfter: D.lateAfter, schoolEnd: D.schoolEnd,
        periods: D.periods.map((p) => ({ ...p })),
        breaks: D.breaks.map((b) => ({ ...b })),
      },
      classes: S.defaultClasses().map((c) => c.id).join(" "),
      subjects: S.SUGGEST.subjectList.join(", "),
      error: "",
    };

    const wrap = document.createElement("div");
    wrap.className = "setup";
    wrap.style.cssText =
      "min-height:100vh;display:flex;flex-direction:column;padding:calc(var(--safe-t) + 22px) 18px calc(var(--safe-b) + 26px);max-width:620px;margin:0 auto;position:relative;z-index:2";
    document.getElementById("app").appendChild(wrap);

    /* ------------------------------------------------------------- pieces */
    function classList() {
      return String(st.classes).split(/[\s,;]+/).map((x) => x.trim().toUpperCase())
        .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    }
    function subjectList() {
      return String(st.subjects).split(/[,\n;]+/).map((x) => x.trim())
        .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    }
    function validPin(p) { return /^\d{4,8}$/.test(String(p || "")); }

    function validate() {
      if (st.step === 1) {
        if (!st.school.name.trim()) return "Enter the school's name.";
        if (!st.school.term.trim()) return "Enter the current term, e.g. “Term I 2026”.";
      }
      if (st.step === 2) {
        if (!st.admin.name.trim()) return "Enter the administrator's full name.";
        if (!st.admin.staffNo.trim()) return "Enter a staff number for the administrator.";
        if (!validPin(st.admin.pin)) return "Choose a PIN of 4–8 digits.";
        if (st.admin.pin !== st.admin.pin2) return "The two PINs do not match.";
      }
      if (st.step === 3) {
        const ps = st.day.periods;
        if (!ps.length) return "Add at least one period to the school day.";
        for (let i = 0; i < ps.length; i++) {
          if (!ps[i].start || !ps[i].end) return `Period ${i + 1} needs a start and end time.`;
          if (CP.time.mins(ps[i].end) <= CP.time.mins(ps[i].start)) return `Period ${i + 1} ends before it starts.`;
        }
      }
      if (st.step === 4) {
        if (!classList().length) return "Add at least one class, e.g. S1A.";
        if (!subjectList().length) return "Add at least one subject.";
      }
      return "";
    }

    function head() {
      const pct = Math.round((st.step / STEPS.length) * 100);
      const label = st.step === 0 ? "Welcome" : STEPS[st.step - 1];
      return `<div class="row gap-3 mb-4">
          ${CP.logoMark(42)}
          <div class="grow" style="min-width:0">
            <h1 style="font-size:21px;letter-spacing:-.03em">Set up ClassPulse</h1>
            <div class="t-sm muted">${CP.esc(label)}${st.step ? ` · step ${st.step} of ${STEPS.length}` : ""}</div>
          </div>
        </div>
        <div class="prog-track mb-5"><div class="prog-fill" style="width:${Math.max(8, pct)}%"></div></div>`;
    }

    function stepDots() {
      return `<div class="row gap-2 mb-5 wrap">${STEPS.map((s, i) =>
        `<span class="pill ${i === st.step - 1 ? "brand" : i < st.step - 1 ? "ok" : ""}" style="${i === st.step - 1 ? "" : "opacity:.6"}">
          ${i < st.step - 1 ? CP.icon("check") : ""}${CP.esc(s)}</span>`).join("")}</div>`;
    }

    function nav() {
      const last = st.step === STEPS.length;
      return `<div class="row gap-3 mt-6" style="margin-top:auto;padding-top:22px">
        ${st.step > 0 ? `<button class="btn" data-back>${CP.icon("chevron", ' style="transform:rotate(180deg)"')} Back</button>` : ""}
        <button class="btn ${last ? "accent" : "primary"} grow lg" data-next>
          ${last ? CP.icon("check") + " Create my school" : "Continue " + CP.icon("arrowRight")}
        </button>
      </div>`;
    }

    function errorBox() {
      return st.error ? `<div class="banner danger mt-4"><span class="ic danger">${CP.icon("alert")}</span>
        <div class="grow t-sm">${CP.esc(st.error)}</div></div>` : "";
    }

    function field(label, inner, hint) {
      return `<div class="field mb-4"><label>${CP.esc(label)}</label>${inner}
        ${hint ? `<div class="t-xs dim">${CP.esc(hint)}</div>` : ""}</div>`;
    }
    function input(name, ph, value, extra) {
      return `<input class="input" data-f="${name}" placeholder="${CP.esc(ph || "")}" value="${CP.esc(value || "")}" ${extra || ""}>`;
    }

    /* -------------------------------------------------------------- views */
    function drawWelcome() {
      wrap.innerHTML = `
        <div class="col center text-c" style="flex:1;justify-content:center;gap:16px">
          ${CP.logoMark(84)}
          <h1 style="font-size:30px;letter-spacing:-.035em">ClassPulse</h1>
          <p class="muted" style="max-width:34ch">Every lesson, accounted for. Let's set up your
            school. This takes about two minutes and you can change everything later.</p>
          <div class="card col gap-3 mt-4" style="text-align:left;width:100%">
            ${[["building", "Your school", "Name, term and the school day"],
               ["key", "Your administrator account", "The account that adds everyone else"],
               ["users", "Staff, classes and subjects", "By hand or from a spreadsheet"],
               ["qr", "QR codes for the gate", "Print and stick up at the gate and each room"]]
              .map(([ic, t, s]) => `<div class="row gap-3">
                <span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);color:var(--brand-500);flex:0 0 auto">${CP.icon(ic)}</span>
                <span class="grow"><b>${CP.esc(t)}</b><span class="t-sm muted" style="display:block">${CP.esc(s)}</span></span>
              </div>`).join("")}
          </div>
        </div>
        <button class="btn primary block lg mt-6" data-next>Begin setup ${CP.icon("arrowRight")}</button>
        <button class="btn ghost block mt-3" data-restore>${CP.icon("download")} Restore an existing backup</button>
        <input type="file" accept=".json,application/json" data-file class="hidden">`;
    }

    function drawSchool() {
      wrap.innerHTML = `
        ${head()}
        <div class="card">
          ${field("School name", input("school.name", "e.g. Kira Secondary School", st.school.name))}
          ${field("Motto or tagline", input("school.motto", "optional", st.school.motto))}
          ${field("Address / location", input("school.address", "optional", st.school.address))}
          ${field("Current term", input("school.term", "e.g. Term I 2026", st.school.term))}
        </div>${errorBox()}${nav()}`;
    }

    function drawAdmin() {
      wrap.innerHTML = `
        ${head()}
        <div class="banner info mb-4"><span class="ic info">${CP.icon("shield")}</span>
          <div class="grow t-sm">This is <b>your</b> account. It creates staff, builds the timetable
            and prints the QR codes. Keep this PIN private — anyone with it controls the school's data.</div></div>
        <div class="card">
          ${field("Full name", input("admin.name", "e.g. Grace Nabatanzi", st.admin.name, 'autocomplete="off"'))}
          ${field("Staff number", input("admin.staffNo", "e.g. ADM-001", st.admin.staffNo), "This is what you type to sign in.")}
          <div class="row gap-3">
            <div class="grow">${field("Choose a PIN", input("admin.pin", "4–8 digits", "", 'inputmode="numeric" autocomplete="new-password" type="password"'))}</div>
            <div class="grow">${field("Repeat the PIN", input("admin.pin2", "again", "", 'inputmode="numeric" autocomplete="new-password" type="password"'))}</div>
          </div>
          ${field("Mobile number", input("admin.phone", "optional", st.admin.phone, 'inputmode="tel"'), "Used for SMS alerts on this phone's network, if you enable them.")}
        </div>${errorBox()}${nav()}`;
    }

    function drawDay() {
      wrap.innerHTML = `
        ${head()}
        <div class="card mb-4">
          <div class="t-xs dim upper mb-3">The school day</div>
          <div class="row gap-3">
            <div class="grow">${field("School opens", `<input class="input" type="time" data-f="day.schoolStart" value="${st.day.schoolStart}">`)}</div>
            <div class="grow">${field("Late after", `<input class="input" type="time" data-f="day.lateAfter" value="${st.day.lateAfter}">`)}</div>
            <div class="grow">${field("Closes", `<input class="input" type="time" data-f="day.schoolEnd" value="${st.day.schoolEnd}">`)}</div>
          </div>
        </div>
        <div class="card mb-4">
          <div class="row between mb-3"><div class="t-xs dim upper">Lesson periods</div>
            <button class="btn xs" data-add-period>${CP.icon("plus")} Add</button></div>
          <div class="col gap-3" data-periods>
            ${st.day.periods.map((p, i) => `<div class="row gap-2" data-prow="${i}">
              <span class="pill" style="min-width:40px;justify-content:center">P${i + 1}</span>
              <input class="input" type="time" data-pstart="${i}" value="${p.start}" style="flex:1">
              <input class="input" type="time" data-pend="${i}" value="${p.end}" style="flex:1">
              <button class="icon-btn" data-del-period="${i}" title="Remove">${CP.icon("trash")}</button>
            </div>`).join("")}
          </div>
        </div>
        <div class="card">
          <div class="t-xs dim upper mb-3">Breaks</div>
          <div class="col gap-3">
            ${st.day.breaks.map((b, i) => `<div class="row gap-2">
              <input class="input" data-blabel="${i}" value="${CP.esc(b.label)}" style="flex:1.2">
              <input class="input" type="time" data-bstart="${i}" value="${b.start}" style="flex:1">
              <input class="input" type="time" data-bend="${i}" value="${b.end}" style="flex:1">
            </div>`).join("")}
          </div>
        </div>${errorBox()}${nav()}`;
    }

    function drawClasses() {
      const cls = classList();
      wrap.innerHTML = `
        ${head()}
        <div class="card mb-4">
          ${field("Classes", `<textarea class="textarea" data-f="classes" rows="3">${CP.esc(st.classes)}</textarea>`,
            "Separate with spaces or commas. Each one gets its own room and QR code.")}
          <div class="chips">${cls.slice(0, 24).map((c) => `<span class="chip on">${CP.esc(c)}</span>`).join("")}</div>
        </div>
        <div class="card">
          ${field("Subjects taught", `<textarea class="textarea" data-f="subjects" rows="3">${CP.esc(st.subjects)}</textarea>`,
            "Comma or new line separated. Used by the lesson-plan and scheme-of-work builder.")}
        </div>${errorBox()}${nav()}`;
    }

    function drawReview() {
      const cls = classList(), subs = subjectList();
      const per = st.day.periods;
      const row = (k, v) => `<div class="kv"><span class="k">${CP.esc(k)}</span><span class="v">${v}</span></div>`;
      wrap.innerHTML = `
        ${head()}
        ${stepDots()}
        <div class="card mb-4">
          ${row("School", `<b>${CP.esc(st.school.name)}</b>`)}
          ${st.school.motto ? row("Motto", CP.esc(st.school.motto)) : ""}
          ${row("Term", CP.esc(st.school.term))}
          ${row("Administrator", CP.esc(st.admin.name) + " · " + CP.esc(st.admin.staffNo))}
          ${row("School day", `${st.day.schoolStart} – ${st.day.schoolEnd}`)}
          ${row("Periods", per.length + " · first " + per[0].start + ", last " + per[per.length - 1].end)}
          ${row("Classes", cls.length + (cls.length ? " — " + cls.slice(0, 6).map(CP.esc).join(", ") + (cls.length > 6 ? "…" : "") : ""))}
          ${row("Subjects", subs.length)}
          ${row("Rooms & QR zones", cls.length + 2)}
        </div>
        <div class="banner info mb-2"><span class="ic info">${CP.icon("info")}</span>
          <div class="grow t-sm">After this you'll add your <b>real staff</b> and build the
            <b>real timetable</b>. You can import both from a spreadsheet.</div></div>
        ${errorBox()}${nav()}`;
    }

    function draw() {
      if (st.step === 0) return drawWelcome();
      if (st.step === 1) return drawSchool();
      if (st.step === 2) return drawAdmin();
      if (st.step === 3) return drawDay();
      if (st.step === 4) return drawClasses();
      return drawReview();
    }

    /* ------------------------------------------------------------ binding */
    function readInputs() {
      wrap.querySelectorAll("[data-f]").forEach((el) => {
        const path = el.dataset.f.split(".");
        if (path.length === 1) st[path[0]] = el.value;
        else st[path[0]][path[1]] = el.value;
      });
      wrap.querySelectorAll("[data-pstart]").forEach((el) => { st.day.periods[+el.dataset.pstart].start = el.value; });
      wrap.querySelectorAll("[data-pend]").forEach((el) => { st.day.periods[+el.dataset.pend].end = el.value; });
      wrap.querySelectorAll("[data-blabel]").forEach((el) => { st.day.breaks[+el.dataset.blabel].label = el.value; });
      wrap.querySelectorAll("[data-bstart]").forEach((el) => { st.day.breaks[+el.dataset.bstart].start = el.value; });
      wrap.querySelectorAll("[data-bend]").forEach((el) => { st.day.breaks[+el.dataset.bend].end = el.value; });
      st.admin.pin = (wrap.querySelector('[data-f="admin.pin"]') || {}).value || st.admin.pin || "";
      st.admin.pin2 = (wrap.querySelector('[data-f="admin.pin2"]') || {}).value || st.admin.pin2 || "";
    }

    function finish() {
      readInputs();
      let admin;
      try {
        admin = S.setup({
          school: st.school,
          admin: st.admin,
          periods: st.day.periods,
          breaks: st.day.breaks,
          schoolStart: st.day.schoolStart,
          schoolEnd: st.day.schoolEnd,
          lateAfter: st.day.lateAfter,
          classes: classList().map((id) => ({ id, level: id.replace(/\D+$/, ""), stream: id.replace(/^[A-Za-z]+/, "") })),
          subjects: subjectList(),
        });
      } catch (e) {
        st.error = e.message;
        draw();
        return;
      }
      CP.login(admin.id, {});
      CP.toast({ kind: "ok", msg: "School created. Welcome, " + admin.name.split(" ")[0] + "." });
      location.hash = "#/admin/overview";
      CP.render();
      setTimeout(() => {
        const s = CP.sheet({
          title: "Your school is ready",
          body: `<p class="muted t-sm mb-5">Three quick jobs before teachers can scan:</p>
            <div class="col gap-3">
              ${[["users", "Add your staff", "Names, staff numbers, departments and PINs — or import a spreadsheet.", "people"],
                 ["calendar", "Build the timetable", "Type it in, auto-generate it, or import a CSV.", "timetable"],
                 ["qr", "Print the QR codes", "One poster for the gate, one per classroom.", "qr"]]
                .map(([ic, t, sub, tab]) => `<button class="li press" data-goto="${tab}">
                  <span style="width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);color:var(--brand-500)">${CP.icon(ic)}</span>
                  <span class="body"><span class="name">${CP.esc(t)}</span><span class="meta">${CP.esc(sub)}</span></span>
                  ${CP.icon("chevron")}</button>`).join("")}
            </div>`,
        });
        s.body.querySelectorAll("[data-goto]").forEach((b) =>
          (b.onclick = () => { const t = b.dataset.goto; s.close(); CP.go("/admin/" + t); }));
      }, 280);
    }

    function step(dir) {
      readInputs();
      if (dir > 0) {
        const err = validate();
        if (err) { st.error = err; draw(); return; }
      }
      st.error = "";
      st.step = Math.max(0, Math.min(STEPS.length, st.step + dir));
      draw();
    }

    function bind() {
      const next = wrap.querySelector("[data-next]");
      if (next) next.onclick = () => { CP.haptic(10); (st.step === STEPS.length ? finish() : step(1)); };
      const back = wrap.querySelector("[data-back]");
      if (back) back.onclick = () => step(-1);

      const restore = wrap.querySelector("[data-restore]");
      const file = wrap.querySelector("[data-file]");
      if (restore && file) {
        restore.onclick = () => file.click();
        file.onchange = () => {
          const f = file.files && file.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try {
              S.importJson(r.result);
              if (S.needsSetup()) throw new Error("That backup has no users.");
              CP.toast({ kind: "ok", msg: "Backup restored — sign in with your staff number." });
              CP.render();
            } catch (e) { CP.toast({ kind: "err", msg: e.message || "Not a ClassPulse backup." }); }
          };
          r.readAsText(f);
        };
      }

      const addP = wrap.querySelector("[data-add-period]");
      if (addP) addP.onclick = () => {
        readInputs();
        const last = st.day.periods[st.day.periods.length - 1];
        const start = last ? last.end : "08:00";
        const end = CP.time.fromMins(CP.time.mins(start) + 40);
        st.day.periods.push({ n: st.day.periods.length + 1, start, end });
        draw();
      };
      wrap.querySelectorAll("[data-del-period]").forEach((b) => (b.onclick = () => {
        readInputs();
        st.day.periods.splice(+b.dataset.delPeriod, 1);
        st.day.periods.forEach((p, i) => (p.n = i + 1));
        draw();
      }));
      wrap.querySelectorAll("[data-f]").forEach((el) => {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && el.tagName !== "TEXTAREA") { e.preventDefault(); step(1); }
        });
      });
    }

    const _draw = draw;
    draw = function () { _draw(); bind(); wrap.scrollTop = 0; window.scrollTo(0, 0); };
    draw();
    return wrap;
  };
})(window);
