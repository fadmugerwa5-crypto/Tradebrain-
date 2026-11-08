/* ==========================================================================
   ClassPulse — app.js : shell, session, router, live ticker
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;

  /* ------------------------------------------------------------------ nav */
  const NAV = {
    teacher: [
      { id: "scan", label: "Scan", icon: "scan", primary: true },
      { id: "home", label: "My Day", icon: "home" },
      { id: "lessons", label: "Lessons", icon: "book" },
      { id: "alerts", label: "Alerts", icon: "bell", badge: true },
      { id: "academics", label: "Academics", icon: "sparkle" },
      { id: "me", label: "Me", icon: "user" },
      { id: "syllabus", label: "syllabus", icon: "book", hidden: true, parent: "academics" },
      { id: "assess", label: "assess", icon: "book", hidden: true, parent: "academics" },
      { id: "plans", label: "plans", icon: "book", hidden: true, parent: "academics" },
      { id: "perf", label: "perf", icon: "book", hidden: true, parent: "academics" },
      { id: "workload", label: "workload", icon: "book", hidden: true, parent: "academics" },
      { id: "acreports", label: "acreports", icon: "book", hidden: true, parent: "academics" },
      { id: "assistant", label: "assistant", icon: "book", hidden: true, parent: "academics" },
    ],
    dos: [
      { id: "pulse", label: "Live Pulse", icon: "zap", badge: true },
      { id: "staff", label: "Staff", icon: "users" },
      { id: "scans", label: "Scans", icon: "scan" },
      { id: "timetable", label: "Timetable", icon: "calendar" },
      { id: "coverage", label: "Coverage", icon: "book" },
      { id: "academics", label: "Academics", icon: "sparkle" },
      { id: "me", label: "Me", icon: "user" },
      { id: "syllabus", label: "syllabus", icon: "book", hidden: true, parent: "academics" },
      { id: "assess", label: "assess", icon: "book", hidden: true, parent: "academics" },
      { id: "plans", label: "plans", icon: "book", hidden: true, parent: "academics" },
      { id: "perf", label: "perf", icon: "book", hidden: true, parent: "academics" },
      { id: "workload", label: "workload", icon: "book", hidden: true, parent: "academics" },
      { id: "acreports", label: "acreports", icon: "book", hidden: true, parent: "academics" },
      { id: "assistant", label: "assistant", icon: "book", hidden: true, parent: "academics" },
      { id: "roster", label: "roster", icon: "book", hidden: true, parent: "academics" },
      { id: "rules", label: "rules", icon: "book", hidden: true, parent: "academics" },
      { id: "calendar", label: "calendar", icon: "book", hidden: true, parent: "academics" },
    ],
    head: [
      { id: "overview", label: "Overview", icon: "chart" },
      { id: "staff", label: "Staff", icon: "users" },
      { id: "reports", label: "Reports", icon: "list" },
      { id: "alerts", label: "Alerts", icon: "bell", badge: true },
      { id: "academics", label: "Academics", icon: "sparkle" },
      { id: "me", label: "Me", icon: "user" },
      { id: "syllabus", label: "syllabus", icon: "book", hidden: true, parent: "academics" },
      { id: "assess", label: "assess", icon: "book", hidden: true, parent: "academics" },
      { id: "plans", label: "plans", icon: "book", hidden: true, parent: "academics" },
      { id: "perf", label: "perf", icon: "book", hidden: true, parent: "academics" },
      { id: "workload", label: "workload", icon: "book", hidden: true, parent: "academics" },
      { id: "acreports", label: "acreports", icon: "book", hidden: true, parent: "academics" },
      { id: "assistant", label: "assistant", icon: "book", hidden: true, parent: "academics" },
      { id: "roster", label: "roster", icon: "book", hidden: true, parent: "academics" },
      { id: "rules", label: "rules", icon: "book", hidden: true, parent: "academics" },
      { id: "calendar", label: "calendar", icon: "book", hidden: true, parent: "academics" },
    ],
    admin: [
      { id: "overview", label: "Overview", icon: "shield" },
      { id: "people", label: "People", icon: "users" },
      { id: "timetable", label: "Timetable", icon: "calendar" },
      { id: "qr", label: "QR Codes", icon: "qr" },
      { id: "academics", label: "Academics", icon: "sparkle" },
      { id: "marks", label: "Marks (older panel)", icon: "chart", hidden: true, parent: "academics" },
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "settings", label: "Settings", icon: "gear" },
      { id: "me", label: "Me", icon: "user" },
      { id: "syllabus", label: "syllabus", icon: "book", hidden: true, parent: "academics" },
      { id: "assess", label: "assess", icon: "book", hidden: true, parent: "academics" },
      { id: "plans", label: "plans", icon: "book", hidden: true, parent: "academics" },
      { id: "perf", label: "perf", icon: "book", hidden: true, parent: "academics" },
      { id: "workload", label: "workload", icon: "book", hidden: true, parent: "academics" },
      { id: "acreports", label: "acreports", icon: "book", hidden: true, parent: "academics" },
      { id: "assistant", label: "assistant", icon: "book", hidden: true, parent: "academics" },
      { id: "roster", label: "roster", icon: "book", hidden: true, parent: "academics" },
      { id: "rules", label: "rules", icon: "book", hidden: true, parent: "academics" },
    ],
  };
  CP.NAV = NAV;

  /* -------------------------------------------------------------- session */
  CP.session = CP.session || null;

  function loadSession() {
    const s = CP.storage.get("session", null);
    if (!s || !s.userId) return null;
    if (!S.user(s.userId)) return null;
    return s;
  }

  CP.login = function (userId, opts) {
    const u = S.user(userId);
    if (!u) return false;
    CP.session = {
      userId, role: u.role, viewAs: u.role,
      token: (opts && opts.token) || null,
      at: Date.now(),
    };
    CP.storage.set("session", CP.session);
    S.audit(userId, "login", { role: u.role });
    return true;
  };

  CP.logout = function () {
    if (CP.session) S.audit(CP.session.userId, "logout", {});
    CP.session = null;
    CP.storage.del("session");
    if (CP.sync) CP.sync.disconnect();
    location.hash = "";
    render();
  };

  CP.me = () => (CP.session ? S.user(CP.session.userId) : null);
  CP.activeRole = () =>
    CP.session && CP.session.viewAs ? CP.session.viewAs : CP.session ? CP.session.role : null;

  CP.viewAs = function (role) {
    if (!CP.session) return;
    // only admin/head may inspect other platforms
    const own = S.user(CP.session.userId).role;
    if (own === "admin" || own === "head" || role === own) {
      CP.session.viewAs = role;
      CP.storage.set("session", CP.session);
      location.hash = "#/" + role + "/" + (NAV[role][0].id);
      render();
    }
  };

  /* ----------------------------------------------------------------- theme */
  CP.theme = function (t) {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = t || (cur === "dark" ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", next);
    CP.storage.set("theme", next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#070b18" : "#eef1f8");
    return next;
  };

  /* -------------------------------------------------------------- registry */
  CP.views = CP.views || {};
  CP.view = function (role, tab, fn) {
    CP.views[role] = CP.views[role] || {};
    CP.views[role][tab] = fn;
  };

  /* --------------------------------------------------------------- routing */
  function parseHash() {
    const h = (location.hash || "").replace(/^#\/?/, "");
    const parts = h.split("/").filter(Boolean);
    const role = parts[0];
    const tab = parts[1];
    return { role, tab };
  }

  CP.go = function (path) {
    // Resolve bare tab ids (e.g. "/people") to the active role's route so the
    // bottom nav and any other shortcut actually lands on the right view.
    const segs = String(path || "").replace(/^\/+/, "").split("/").filter(Boolean);
    if (segs.length === 1 && CP.views && CP.views[segs[0]] === undefined && CP.activeRole) {
      try { path = "/" + CP.activeRole() + "/" + segs[0]; } catch (e) {}
    }
    if (location.hash === "#" + path) render();
    else location.hash = "#" + path;
  };

  /* ---------------------------------------------------------------- render */
  let mounted = null;

  function render() {
    const app = document.getElementById("app");
    if (!app) return;
    // During first-run setup, never tear down the in-memory wizard: re-creating
    // it resets the step back to the welcome page.
    if (S.needsSetup() && mounted && mounted._isSetup) return;
    if (mounted && mounted.destroy) { try { mounted.destroy(); } catch (e) {} }
    mounted = null;

    if (S.needsSetup()) {
      CP.session = null;
      app.innerHTML = "";
      const node = CP.views.setup ? CP.views.setup() : '<div class="p-5">Loading…</div>';
      if (node && (node.nodeType || node.node)) {
        const el = node.node || node;
        el._isSetup = true;
        mounted = el;
      }
      app.appendChild(node.node || node);
      return;
    }

    if (!CP.session || !CP.me()) {
      app.innerHTML = "";
      const node = CP.views.login ? CP.views.login() : "<div class='p-5'>Loading…</div>";
      app.appendChild(node.node || node);
      return;
    }

    const role = CP.activeRole();
    const nav = NAV[role] || NAV.teacher;
    let { role: r, tab } = parseHash();
    if (!r || !CP.views[r]) { location.hash = "#/" + role + "/" + nav[0].id; return; }
    if (r !== role && !(S.user(CP.session.userId).role === "admin")) {
      location.hash = "#/" + role + "/" + nav[0].id; return;
    }
    if (!tab || !nav.find((n) => n.id === tab)) tab = nav[0].id;

    const fn = (CP.views[r] || {})[tab];
    if (!fn) { app.innerHTML = CP.empty("Coming soon"); return; }

    const me = CP.me();
    const ctx = { role: r, own: S.user(CP.session.userId).role, tab, me, isDesktop: window.innerWidth >= 900 };
    let out;
    try {
      out = fn(ctx);
    } catch (e) {
      console.error(e);
      out = { title: "Error", html: CP.banner("danger", "Something went wrong", String(e && e.message || e)) };
    }
    if (typeof out === "string") out = { html: out };

    const unread = S.unreadAlerts(me.id).length;
    const shell = document.createElement("div");
    shell.className = "shell";
    shell.innerHTML = `
      ${sideNav(role, (nav.find((n) => n.id === tab) || {}).parent || tab, r, unread, me)}
      <div>
        <header class="appbar">
          <button class="avatar-btn" data-menu>${CP.avatarHTML(me)}</button>
          <div class="grow" style="min-width:0">
            <h1 class="truncate">${CP.esc(out.title || (CP.ROLES[role] || {}).label || "ClassPulse")}</h1>
            <div class="sub truncate">${CP.esc(out.sub || "")}</div>
          </div>
          <button class="icon-btn" data-theme-toggle title="Theme">${CP.icon(document.documentElement.getAttribute("data-theme") === "light" ? "moon" : "sun")}</button>
        </header>
        <main class="page ${out.wide ? "wide" : ""}" data-view></main>
      </div>
    `;
    app.innerHTML = "";
    app.appendChild(shell);

    const view = shell.querySelector("[data-view]");
    view.innerHTML = out.html;
    if (out.after) { try { out.after(view, ctx); } catch (e) { console.error(e); } }

    shell.querySelectorAll("[data-menu]").forEach((b) => b.onclick = menuSheet);
    shell.querySelectorAll("[data-theme-toggle]").forEach((b) => b.onclick = () => { CP.theme(); render(); });
    shell.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => CP.go("/" + b.dataset.nav)));
    shell.querySelectorAll("[data-action]").forEach((b) => (b.onclick = () => runAction(b.dataset.action)));
    window.scrollTo(0, 0);
  }
  CP.render = render;

  function sideNav(role, tab, r, unread, me) {
    const items = (NAV[r] || []).filter((n) => !n.hidden).map((n) => navItem(n, tab, unread)).join("");
    return `<nav class="nav">
      <div class="brand row gap-3">
        ${logoMark(30)}
        <div class="grow" style="min-width:0">
          <div class="fw-7 truncate" style="letter-spacing:-.02em">ClassPulse</div>
          <div class="t-xs dim truncate">${CP.esc(S.data.school.name)}</div>
        </div>
      </div>
      ${items}
      <div class="spacer"></div>
      ${roleSwitchChip(role, r, me)}
    </nav>`;
  }

  function navItem(n, tab, unread) {
    const on = n.id === tab;
    return `<button class="item ${on ? "on" : ""} ${n.primary ? "primary" : ""}" data-nav="${n.id}">
      <span class="ic">${CP.icon(n.icon)}</span>
      <span>${CP.esc(n.label)}</span>
      ${n.badge && unread ? `<span class="badge">${unread > 9 ? "9+" : unread}</span>` : ""}
    </button>`;
  }

  function roleSwitchChip(role, active, me) {
    if (!(me.role === "admin" || me.role === "head")) return "";
    const opts = Object.keys(NAV).filter((k) => k !== role);
    return `<div class="roleswitch card tight flat">
      <div class="t-xs dim upper mb-2">View platform as</div>
      <div class="row gap-2 wrap">
        <span class="pill brand">${CP.esc((CP.ROLES[role] || {}).short || role)}</span>
        ${opts.map((k) => `<button class="chip" data-action="view-as:${k}">${CP.esc((CP.ROLES[k] || {}).short || k)}</button>`).join("")}
      </div>
    </div>`;
  }

  function logoMark(size) {
    const s = size || 34;
    const logo = (S && S.data && S.data.school && S.data.school.logo) ? S.data.school.logo : null;
    if (logo) {
      return `<span style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.32)}px;display:grid;place-items:center;flex:0 0 auto;overflow:hidden;background:var(--bg-2);border:1px solid var(--line)">
        <img src="${CP.esc(logo)}" alt="logo" style="width:100%;height:100%;object-fit:contain"></span>`;
    }
    return `<span style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.32)}px;display:grid;place-items:center;flex:0 0 auto;background:var(--brand-500);color:#fff;box-shadow:var(--shadow-brand)">
      <svg viewBox="0 0 24 24" width="${s * 0.62}" height="${s * 0.62}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 13.5 9 8l3.2 3.6L15 7l5 5.5"/><path d="M4 19h16"/></svg>
    </span>`;
  }
  CP.logoMark = logoMark;

  /* --------------------------------------------------------------- actions */
  function runAction(a) {
    const [cmd, arg] = a.split(":");
    if (cmd === "goto") { CP.go("/" + arg); return; }
    if (cmd === "view-as") { CP.viewAs(arg); return; }
    if (cmd === "goto") { CP.go(arg); return; }
    if (cmd === "logout") { CP.logout(); return; }
    if (cmd === "toggle") {
      const el = document.querySelector('[data-action="' + a + '"]');
      if (el) el.classList.toggle("on");
      return;
    }
    if (CP.actions && CP.actions[cmd]) { CP.actions[cmd](arg); return; }
  }
  CP.runAction = runAction;
  CP.actions = CP.actions || {};

  /* ------------------------------------------------------------ menu sheet */
  CP.openProfile = openProfile;
  CP.openNotify = openNotify;
  CP.openHelp = openHelp;
  CP.openInstall = openInstall;

  function menuSheet() {
    const me = CP.me();
    const role = CP.activeRole();
    const s = CP.sheet({
      title: "Account",
      body: `
        <div class="row gap-4 mb-5">
          ${CP.avatarHTML(me, "lg")}
          <div class="grow" style="min-width:0">
            <div class="fw-7 t-lg truncate">${CP.esc(me.name)}</div>
            <div class="t-sm muted">${CP.esc(me.staffNo)} · ${CP.esc(me.dept || "")}</div>
            <div class="mt-2"><span class="pill" style="color:${CP.ROLES[me.role].color}">${CP.icon(CP.ROLES[me.role].icon)} ${CP.esc(CP.ROLES[me.role].label)}</span>
            ${CP.session.viewAs !== me.role ? `<span class="pill info">viewing: ${CP.esc(CP.ROLES[CP.session.viewAs].label)}</span>` : ""}</div>
          </div>
        </div>
        <div class="list">
          <button class="li press" data-a="profile"><span class="body"><span class="name">My profile & device</span><span class="meta">Name, phone, device binding</span></span>${CP.icon("chevron")}</button>
          <button class="li press" data-a="alerts"><span class="body"><span class="name">Notification settings</span><span class="meta">In-app, SMS, escalation</span></span>${CP.icon("chevron")}</button>
          <button class="li press" data-a="theme"><span class="body"><span class="name">Switch theme</span><span class="meta">Light / dark</span></span>${CP.icon("chevron")}</button>
          <button class="li press" data-a="install"><span class="body"><span class="name">Install on this phone</span><span class="meta">Add to home screen</span></span>${CP.icon("chevron")}</button>
          <button class="li press" data-a="help"><span class="body"><span class="name">Help & how it works</span><span class="meta">Roles, QR codes, escalation</span></span>${CP.icon("chevron")}</button>
          <button class="li press" data-a="logout" style="color:var(--danger)"><span class="body"><span class="name">Sign out</span><span class="meta">${CP.esc(me.staffNo)}</span></span>${CP.icon("logout")}</button>
        </div>`,
    });
    s.body.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => {
      const a = b.dataset.a;
      if (a === "logout") { s.close(); runAction("logout"); return; }
      if (a === "theme") { CP.theme(); CP.render(); s.close(); return; }
      if (a === "profile") { s.close(); openProfile(); return; }
      if (a === "alerts") { s.close(); openNotify(); return; }
      if (a === "help") { s.close(); openHelp(); return; }
      if (a === "install") { s.close(); openInstall(); return; }
    });
  }

  function openProfile() {
    const me = CP.me();
    CP.sheet({
      title: "My profile",
      body: `
        <div class="field mb-3"><label>Full name</label><input class="input" id="pf-name" value="${CP.esc(me.name)}"></div>
        <div class="field mb-3"><label>Phone (for SMS alerts)</label><input class="input" id="pf-phone" inputmode="tel" value="${CP.esc(me.phone || "")}" placeholder="+256 7xx xxx xxx"></div>
        <div class="field mb-3"><label>Staff number</label><input class="input" value="${CP.esc(me.staffNo)}" disabled></div>
        <div class="field mb-3"><label>Department</label><input class="input" id="pf-dept" value="${CP.esc(me.dept || "")}"></div>
        <div class="card flat mb-4">
          <div class="row between"><div><div class="fw-6">Device binding</div>
          <div class="t-sm muted">Lock scans to this phone to stop proxy check-ins.</div></div>
            <div class="switch ${me.device ? "on" : ""}" data-dev></div></div>
          <div class="t-xs dim mt-2">${me.device ? "Bound to: " + CP.esc(String(me.device).slice(0, 22)) : "Not bound"}</div>
        </div>
        <button class="btn primary block" id="pf-save">Save changes</button>`,
      after: undefined,
    });
    const sheetEl = document.querySelector(".sheet");
    const dev = sheetEl.querySelector("[data-dev]");
    dev.onclick = () => {
      if (me.device) { me.device = null; dev.classList.remove("on"); }
      else { me.device = (navigator.userAgent || "device").slice(0, 42); dev.classList.add("on"); }
      S.save(true);
    };
    sheetEl.querySelector("#pf-save").onclick = () => {
      me.name = sheetEl.querySelector("#pf-name").value.trim() || me.name;
      me.phone = sheetEl.querySelector("#pf-phone").value.trim();
      me.dept = sheetEl.querySelector("#pf-dept").value.trim();
      S.save(true);
      CP.toast({ kind: "ok", msg: "Profile updated." });
      sheetEl.closest(".scrim").remove();
      CP.render();
    };
  }

  function openNotify() {
    const st = S.data.settings;
    function row(k, label, sub) {
      return `<div class="li"><div class="body"><div class="name">${CP.esc(label)}</div>
        <div class="meta">${CP.esc(sub)}</div></div>
        <div class="switch ${st[k] ? "on" : ""}" data-t="${k}"></div></div>`;
    }
    CP.sheet({
      title: "Notifications & escalation",
      body: `
        <div class="list mb-4">
          ${row("autoEscalate", "Automatic escalation", "5 min: DOS · 10 min: Head Teacher · 15 min: critical")}
          ${row("soundAlerts", "Sound & vibration", "Audible alert on this device")}
          ${row("smsEnabled", "SMS alerts", st.smsProvider + " · sender " + st.smsSender)}
          ${row("requireGeofence", "Require GPS geofence", "Staff must be within " + st.geofenceMeters + " m of school")}
          ${row("requireDeviceBinding", "Require device binding", "One phone per teacher")}
          ${row("rotateClassQR", "Rolling classroom QR codes", "Windows change every " + st.rotateSec + " s")}
        </div>
        <div class="field mb-3"><label>DOS phone (SMS)</label><input class="input" data-txt="dosPhone" value="${CP.esc(st.dosPhone || "")}" placeholder="+256..."></div>
        <div class="field mb-4"><label>Head Teacher phone (SMS)</label><input class="input" data-txt="headPhone" value="${CP.esc(st.headPhone || "")}" placeholder="+256..."></div>
        <button class="btn primary block" id="nf-save">Save</button>`,
    });
    const el = document.querySelector(".sheet");
    el.querySelectorAll("[data-t]").forEach((s) => s.onclick = () => { st[s.dataset.t] = !st[s.dataset.t]; s.classList.toggle("on"); });
    el.querySelector("#nf-save").onclick = () => {
      el.querySelectorAll("[data-txt]").forEach((i) => (st[i.dataset.txt] = i.value.trim()));
      S.save(true);
      CP.toast({ kind: "ok", msg: "Notification settings saved." });
      el.closest(".scrim").remove();
    };
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });

  function openInstall() {
    if (CP.isStandalone()) {
      CP.toast({ kind: "ok", msg: "ClassPulse is already installed on this device." });
      return;
    }
    CP.sheet({
      title: "Install ClassPulse",
      body: `<p class="t-sm muted mb-4">Install it like a normal app — no Play Store, no fees.</p>
        <div class="list mb-4">
          <div class="li"><span style="width:34px">${CP.icon("phone")}</span><span class="body"><span class="name">Android · Chrome</span><span class="meta">Menu ⋮ → “Add to Home screen” / “Install app”</span></span></div>
          <div class="li"><span style="width:34px">${CP.icon("phone")}</span><span class="body"><span class="name">iPhone · Safari</span><span class="meta">Share → “Add to Home Screen”</span></span></div>
        </div>
        <button class="btn primary block" id="inst-now">${deferredPrompt ? "Install now" : "Show me how"}</button>`,
    });
    const el = document.querySelector(".sheet");
    el.querySelector("#inst-now").onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const r = await deferredPrompt.userChoice;
        CP.toast({ kind: r.outcome === "accepted" ? "ok" : "warn", msg: r.outcome === "accepted" ? "Installing…" : "Install cancelled." });
        deferredPrompt = null;
      } else {
        CP.toast({ msg: "Use your browser menu → Add to Home screen." });
      }
      el.closest(".scrim").remove();
    };
  }

  function openHelp() {
    CP.sheet({
      title: "How ClassPulse works",
      wide: true,
      body: `
        <div class="col gap-4">
          <div class="card flat">
            <div class="fw-7 mb-2">${CP.icon("door")} 1 · Arrival at the gate</div>
            <p class="t-sm muted">A QR poster is stuck at the gate. The teacher opens the app, taps <b>Scan</b> and points the camera at it. The arrival time is recorded instantly and the DOS sees it live. No hardware, no biometric machine, no signing a paper register for a colleague.</p>
          </div>
          <div class="card flat">
            <div class="fw-7 mb-2">${CP.icon("qr")} 2 · Inside the classroom</div>
            <p class="t-sm muted">Each classroom has its own QR poster. On smartphones the code <b>changes every ${S.data.settings.rotateSec} seconds</b> (shown on a spare phone or tablet in the room, or by the class captain). That means a teacher cannot photograph the code and scan it from home.</p>
          </div>
          <div class="card flat">
            <div class="fw-7 mb-2">${CP.icon("swap")} 3 · Out of lesson</div>
            <p class="t-sm muted">Scanning the same class code again closes the lesson and records the time out. Leaving more than 8 minutes early raises a “lesson left early” flag to the DOS.</p>
          </div>
          <div class="card flat">
            <div class="fw-7 mb-2">${CP.icon("zap")} 4 · Escalation ladder</div>
            <p class="t-sm muted">If a class has no teacher after 5 minutes the DOS is alerted; 10 minutes, the Head Teacher; 15 minutes it becomes a critical disruption entry on the record. Teachers who are free in that period appear in the DOS “assign cover” list.</p>
          </div>
          <div class="card flat">
            <div class="fw-7 mb-2">${CP.icon("book")} 5 · Teaching support</div>
            <p class="t-sm muted">Teachers get auto-generated NCDC schemes of work and lesson plans, record of work, and e-resource links — all tied to what they actually taught, so the DOS can see syllabus coverage per class.</p>
          </div>
          <div class="card flat">
            <div class="fw-7 mb-2">${CP.icon("wifiOff")} 6 · When the network dies</div>
            <p class="t-sm muted">Scans are stored on the phone and pushed to the server the moment the network returns, marked “offline” so nobody is cheated and nobody is blamed unfairly.</p>
          </div>
        </div>`,
    });
  }
  CP.menuSheet = menuSheet;

  /* ------------------------------------------------------------------ boot */
  function boot() {
    document.documentElement.setAttribute("data-theme", CP.storage.get("theme", "dark"));
    S.data = S.load();
    if (CP.sync) CP.sync.init();
    CP.session = loadSession();
    if (CP.session) S.audit(CP.session.userId, "resume-session", {});
    window.addEventListener("hashchange", render);

    // live ticker: derive alerts, refresh live views
    setInterval(() => {
      if (!CP.session) return;
      const n = S.tick();
      academicTick();
      S.emit("tick");
      const role = CP.activeRole();
      const live = { dos: ["pulse"], head: ["overview"], admin: ["overview"], teacher: ["home"] };
      if (n > 0 && CP.session) {
        const me = CP.me();
        const unread = S.unreadAlerts(me.id).length;
        const badge = document.querySelector(".badge");
        if (badge) badge.textContent = unread > 9 ? "9+" : unread;
      }
      if ((live[role] || []).indexOf(parseHash().tab) >= 0) render();
    }, 20000);

    S.tick();
    academicTick();
    render();
  }

  // Lesson reminders, syllabus-behind alerts and tomorrow's calendar alerts.
  // Plain timers and arithmetic; none of it needs the network or any AI.
  let lastSlow = 0;
  function academicTick() {
    if (!CP.session || !CP.acad) return;
    try {
      CP.acad.checkReminders();
      if (Date.now() - lastSlow > 10 * 60 * 1000) {
        lastSlow = Date.now();
        CP.acad.syllabusAlerts();
        CP.acad.calendarAlerts();
      }
    } catch (e) { console.error("academic tick", e); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
