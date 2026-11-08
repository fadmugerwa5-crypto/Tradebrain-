/* ==========================================================================
   ClassPulse — views-common.js
   Login, scanner, alerts inbox, "Me" tab, shared widgets.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;

  /* ====================================================== SIGN IN SCREEN */
  // Real sign-in: staff number + the person's own PIN. No role picker, no
  // sample accounts. The school's server, when configured, is the authority;
  // if it cannot be reached the phone checks its own copy so a class can
  // still be recorded offline.
  CP.views.login = function () {
    let step = "id";        // id | pin | setpin
    let picked = null;
    let pin = "";
    let pin2 = "";
    let fails = 0;
    let lockUntil = 0;
    let lockTimer = null;

    const wrap = document.createElement("div");
    wrap.className = "login";
    document.getElementById("app").appendChild(wrap);

    function server() {
      return (CP.sync && CP.sync.state().server) || "";
    }

    function shake(el) {
      if (!el) return;
      CP.haptic([20, 40, 20]);
      const host = el.closest(".card") || el;
      host.classList.add("shake");
      setTimeout(() => host.classList.remove("shake"), 480);
    }

    function logo() {
      return `<div class="col center text-c gap-3" style="margin-bottom:26px">
        ${CP.logoMark(64)}
        <div><h1 style="font-size:26px;letter-spacing:-.035em">ClassPulse</h1>
        <div class="t-sm muted">${CP.esc(S.data.school.name || "Every lesson, accounted for")}</div></div>
      </div>`;
    }

    function drawId() {
      wrap.innerHTML = `
        ${logo()}
        <div class="card">
          <div class="t-xs dim upper mb-3">Sign in</div>
          <div class="field mb-4"><label>Staff number</label>
            <input class="input" data-staff autocomplete="username" inputmode="text"
              placeholder="e.g. T-101" value="">
          </div>
          <button class="btn primary block lg" data-go>Continue ${CP.icon("arrowRight")}</button>
        </div>
        <div class="t-sm muted text-c mt-5">Use the staff number your school gave you.
          ${server() ? `Connected to the school server.` : ""}</div>
        <div class="row center mt-4"><button class="btn ghost sm" data-register>${CP.icon("userPlus")} New teacher? Register here</button></div>
        ${!server() ? `<div class="card flat mt-5">
          <div class="row between mb-3"><div><div class="fw-6 t-sm">School server</div>
            <div class="t-xs dim">Optional on this device</div></div>
            <span class="pill ${CP.online() ? "info" : "warn"}">${CP.online() ? "online" : "offline"}</span></div>
          <div class="row gap-2">
            <input class="input" data-api placeholder="https://your-school.example.com">
            <button class="btn" data-connect>${CP.icon("wifi")}</button>
          </div>
          <div class="t-xs dim mt-2">Leave blank to keep everything on this phone.</div>
        </div>` : ""}`;

      const input = wrap.querySelector("[data-staff]");
      setTimeout(() => input.focus(), 120);
      wrap.querySelector("[data-go]").onclick = () => submitId();
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitId(); });
      const regBtn = wrap.querySelector("[data-register]");
      if (regBtn) regBtn.onclick = () => openRegisterSheet();

      const api = wrap.querySelector("[data-api]");
      if (api) {
        api.value = CP.storage.get("api", "") || "";
        wrap.querySelector("[data-connect]").onclick = () => {
          const url = api.value.trim();
          if (!url) { CP.sync.setServer("", {}); CP.toast({ msg: "Staying on this phone only." }); draw(); return; }
          CP.toast({ msg: "Checking the server…" });
          CP.sync.setServer(url, { forgetToken: true }).then((ok) => {
            if (!ok) { CP.toast({ kind: "err", msg: "Could not reach that server." }); return; }
            CP.toast({ kind: "ok", msg: "Connected." });
            return CP.sync.syncNow().then(() => { CP.render(); });
          });
        };
      }
    }

    function submitId() {
      const el = wrap.querySelector("[data-staff]");
      const v = (el.value || "").trim();
      if (!v) { shake(el); return; }
      const u = S.byStaffNo(v);
      const local = u && u.active !== false ? u : null;
      if (!server()) {
        if (!local) return notFound(v);
        picked = local; pin = ""; step = local.pin ? "pin" : "setpin"; draw(); return;
      }
      // With a server we let the server tell us who this is: ask for the PIN
      // straight away and verify on submit.
      picked = local || { name: v, staffNo: v, id: null, role: "teacher" };
      pin = ""; step = "pin"; draw();
    }

    function notFound(v) {
      CP.haptic([30, 50, 30]);
      const card = wrap.querySelector(".card");
      card.classList.add("shake");
      setTimeout(() => card.classList.remove("shake"), 480);
      CP.toast({ kind: "err", msg: `No staff number “${v}” on this phone. Check it, or ask your administrator.` });
    }

    function drawPin() {
      wrap.innerHTML = `
        <div class="row between mb-5">
          <button class="icon-btn" data-back>${CP.icon("chevron", ' style="transform:rotate(180deg)"')}</button>
          <span class="pill brand">${CP.esc(picked.staffNo)}</span>
        </div>
        <div class="col center gap-3 mb-5" style="text-align:center">
          ${CP.avatarHTML(picked, "xl")}
          <div><div class="fw-7 t-lg">${CP.esc(picked.name)}</div>
          <div class="t-sm muted">${CP.esc((CP.ROLES[picked.role] || {}).label || "Staff")}${picked.role === "teacher" ? " · " + CP.esc(picked.staffNo) : ""}</div></div>
        </div>
        <div class="pindots mb-5" data-dots>
          ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<span class="pindot ${i < pin.length ? "on" : ""}"></span>`).join("")}
        </div>
        <div class="t-sm muted text-c mb-4" data-hint>Enter your PIN (4–8 digits)</div>
        ${padHTML()}
        <div class="row center mt-5"><button class="btn ghost sm" data-help>Forgotten your PIN?</button></div>`;
      bindPad();
      wrap.querySelector("[data-back]").onclick = () => { step = "id"; pin = ""; draw(); };
      wrap.querySelector("[data-help]").onclick = () =>
        CP.toast({ msg: "Ask your administrator — they reset PINs in Admin → People → the staff member → Set a new PIN." });
    }

    function drawSetPin() {
      wrap.innerHTML = `
        <div class="row between mb-5">
          <button class="icon-btn" data-back>${CP.icon("chevron", ' style="transform:rotate(180deg)"')}</button>
          <span class="pill brand">First time here</span>
        </div>
        <div class="col center gap-3 mb-4" style="text-align:center">
          ${CP.avatarHTML(picked, "xl")}
          <div><div class="fw-7 t-lg">${CP.esc(picked.name)}</div>
          <div class="t-sm muted">${CP.esc(picked.staffNo)}</div></div>
        </div>
        <div class="t-sm muted text-c mb-4">${pin2 ? "Repeat the same PIN to confirm" : "Choose a PIN for your account"}<br>
          <b>${pin.replace(/./g, "•")}</b></div>
        <div class="pindots mb-5">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<span class="pindot ${i < pin.length ? "on" : ""}"></span>`).join("")}</div>
        ${padHTML()}
        <div class="t-xs dim text-c mt-4">Nobody sees your PIN — it is stored scrambled.</div>`;
      bindPad();
      wrap.querySelector("[data-back]").onclick = () => { step = "id"; pin = ""; pin2 = ""; draw(); };
    }

    function padHTML() {
      return `<div class="pinpad" data-pad>
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}
        <button data-k="del" style="font-size:15px">${CP.icon("x")}</button>
        <button data-k="0">0</button>
        <button data-k="ok" style="color:var(--ok)">${CP.icon("check")}</button>
      </div>`;
    }

    function bindPad() {
      wrap.querySelector("[data-pad]").onclick = (e) => {
        const b = e.target.closest("[data-k]");
        if (!b) return;
        press(b.dataset.k);
      };
      wrap.querySelectorAll("[data-k]").forEach((b, i) => {
        b.style.animation = `riseIn .34s var(--ease) both`;
        b.style.animationDelay = i * 18 + "ms";
      });
    }

    function paint() {
      wrap.querySelectorAll(".pindot").forEach((d, i) => d.classList.toggle("on", i < pin.length));
    }

    function press(k) {
      if (Date.now() < lockUntil) { toastLock(); return; }
      CP.haptic(8);
      if (k === "del") { pin = pin.slice(0, -1); paint(); return; }
      if (k === "ok") return step === "setpin" ? confirmSetPin() : attempt();
      if (pin.length >= 8) return;
      pin += k;
      paint();
    }

    function lockdown() {
      fails++;
      if (fails < 5) return;
      fails = 0;
      lockUntil = Date.now() + 30000;
      clearInterval(lockTimer);
      const hint = wrap.querySelector("[data-hint]");
      lockTimer = setInterval(() => {
        const left = Math.ceil((lockUntil - Date.now()) / 1000);
        const h = wrap.querySelector("[data-hint]");
        if (!h) { clearInterval(lockTimer); return; }
        if (left <= 0) { clearInterval(lockTimer); h.textContent = "Enter your PIN"; return; }
        h.innerHTML = `<span class="danger">Too many attempts — wait ${left}s</span>`;
      }, 250);
      if (hint) hint.innerHTML = `<span class="danger">Too many attempts — wait 30s</span>`;
    }
    function toastLock() {
      CP.haptic([20, 40, 20]);
      CP.toast({ kind: "warn", msg: "Please wait before trying again." });
    }

    function wrong(msg) {
      CP.haptic([40, 60, 40]);
      const dots = wrap.querySelector(".pindots");
      if (dots) { dots.classList.add("shake"); setTimeout(() => dots.classList.remove("shake"), 500); }
      pin = ""; paint();
      CP.toast({ kind: "err", msg: msg || "Wrong PIN. Try again." });
      lockdown();
    }

    function success(offline) {
      CP.login(picked.id, {});
      CP.toast({ kind: "ok", msg: "Welcome, " + String(picked.name).split(" ")[0] + "." + (offline ? " (offline)" : "") });
      const role = CP.activeRole() || picked.role;
      location.hash = "#/" + role + "/" + (CP.NAV[role] ? CP.NAV[role][0].id : "home");
      CP.render();
    }

    function attempt() {
      if (pin.length < 4) { CP.toast({ msg: "PINs have at least 4 digits." }); return; }
      const localOk = (picked.pinHash && picked.pinHash === CP.digest(pin)) ||
                      (picked.pin && picked.pin === CP.digest(pin));
      if (!server()) {
        if (!picked.pin && !picked.pinHash) {
          pin2 = ""; step = "setpin"; draw(); return;
        }
        if (localOk) return success();
        return wrong();
      }
      CP.toast({ msg: "Checking…" });
      CP.sync.login(picked.staffNo, pin).then((ok) => {
        if (ok) {
          // The server knows who this is; adopt the record it returned.
          const fresh = S.byStaffNo(picked.staffNo);
          if (fresh) picked = fresh;
          return success();
        }
        if (CP.sync._code === "NO_PIN") {
          // This account has never had a PIN. Let them choose one now.
          pin = ""; pin2 = ""; step = "setpin";
          CP.toast({ msg: "Choose a PIN for your account." });
          return draw();
        }
        if (CP.sync._code === "PENDING") {
          wrong("Your registration is awaiting approval by the Director of Studies.");
          return;
        }
        if (CP.sync._code === "REJECTED") {
          wrong("Your registration was not approved. Contact the school office.");
          return;
        }
        const st = CP.sync.state();
        const offline = !st.connected;
        if (offline && localOk) return success(true);
        wrong(offline ? "The server could not be reached and this phone cannot verify that PIN." : "Wrong PIN. Try again.");
      });
    }

    function confirmSetPin() {
      if (pin.length < 4) { CP.toast({ kind: "warn", msg: "Choose at least 4 digits." }); return; }
      if (!pin2) { pin2 = pin; pin = ""; draw(); return; }
      if (pin2 !== pin) {
        pin2 = ""; pin = "";
        CP.haptic([40, 60, 40]);
        const d = wrap.querySelector(".pindots");
        if (d) { d.classList.add("shake"); setTimeout(() => d.classList.remove("shake"), 500); }
        CP.toast({ kind: "err", msg: "The PINs did not match. Start again." });
        draw();
        return;
      }
      const raw = pin;
      pin = ""; pin2 = "";
      if (server()) {
        // The school's server records the PIN, so it works on any phone.
        CP.toast({ msg: "Saving your PIN…" });
        CP.sync.login(picked.staffNo, raw, { setPin: true }).then((ok) => {
          if (ok) {
            const fresh = S.byStaffNo(picked.staffNo);
            if (fresh) picked = fresh;
            return success();
          }
          CP.toast({ kind: "err", msg: CP.sync._lastError || "Could not save your PIN. Ask your administrator." });
          step = "id"; draw();
        });
        return;
      }
      if (!picked.id) { step = "id"; return draw(); }
      S.saveUser({ id: picked.id, pin: raw });
      picked = S.user(picked.id);
      CP.toast({ kind: "ok", msg: "PIN saved." });
      success();
    }

    function draw() {
      if (step === "id") return drawId();
      if (step === "setpin") return drawSetPin();
      return drawPin();
    }
    draw();
    return wrap;
  };

  /* ============================================================== SCANNER */
  function geo() {
    return new Promise((resolve) => {
      if (!navigator.geolocation || !CP.secureContext()) return resolve({ lat: null, lng: null });
      const t = setTimeout(() => resolve({ lat: null, lng: null }), 3500);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(t); resolve({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }); },
        () => { clearTimeout(t); resolve({ lat: null, lng: null }); },
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 20000 }
      );
    });
  }
  CP.geo = geo;

  CP.openScanner = function (opts) {
    opts = opts || {};
    const me = CP.me();
    // Only leaders get the manual / test paths. A teacher must point the camera
    // at the real code: the typed-code and "simulate" shortcuts let anyone mint
    // a valid code for any room without being there.
    const leader = !!me && ["dos", "head", "admin"].includes(me.role);
    const needNet = !!(S.data.settings && S.data.settings.requireSchoolNetwork);
    const sheet = CP.sheet({
      title: opts.title || "Scan a ClassPulse code",
      body: `
        <div data-stage>
          <div class="scanner mb-4">
            <video data-video playsinline muted></video>
            <canvas data-canvas class="hidden"></canvas>
            <div class="reticle"><div class="frame"><i></i><i></i><i></i><i></i></div></div>
            <div class="laser"></div>
            <div class="off hidden" data-off></div>
          </div>
          <div class="row between mb-3">
            <span class="pill live ${CP.online() ? "ok" : "warn"}"><span class="dt"></span>${CP.online() ? "Online" : needNet ? "No school Wi-Fi — scans blocked" : "Offline — will sync"}</span>
            <span class="pill">${CP.esc(S.now().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
          </div>
          <p class="t-sm muted mb-4">Point the camera at the code on the gate or classroom door. Scanning the same room twice checks you <b>in</b>, then <b>out</b>. You must scan the gate before a classroom code will count.${needNet ? " This phone must be on the school Wi-Fi." : ""}</p>
          ${leader ? `<div class="row gap-3">
            <button class="btn grow" data-manual>${CP.icon("key")} Enter code</button>
            <button class="btn grow" data-sim>${CP.icon("play")} Test scan</button>
          </div>` : ""}
        </div>
        <div data-result class="hidden"></div>`,
    });

    const video = sheet.body.querySelector("[data-video]");
    const canvas = sheet.body.querySelector("[data-canvas]");
    const off = sheet.body.querySelector("[data-off]");
    const scanner = CP.qr.createScanner(video, canvas, (text) => handle(text));
    let alive = true;

    scanner.start().catch((e) => {
      off.classList.remove("hidden");
      off.innerHTML = `<div>${CP.icon("camera", ' style="width:40px;height:40px;opacity:.6;margin:0 auto 10px"')}
        <div class="fw-6">Camera not available</div>
        <div class="t-sm muted mt-2">${CP.esc(e.message || "Permission denied")}</div>
        <div class="t-xs dim mt-2">${leader ? "You can still enter the room code below." : "Allow camera access for this site, then try again. A code cannot be typed in: that would let someone check in from anywhere."}</div></div>`;
    });

    const manualBtn = sheet.body.querySelector("[data-manual]");
    if (manualBtn) manualBtn.onclick = async () => {
      const v = await CP.prompt({ title: "Enter room code", label: "Type the code shown under the QR poster", placeholder: "e.g. S2B-7F", inputmode: "text" });
      if (v) handleManual(v);
    };
    const simBtn = sheet.body.querySelector("[data-sim]");
    if (simBtn) simBtn.onclick = async () => {
      const zones = S.data.zones.map((z) => ({
        label: z.label, sub: z.kind === "gate" ? "Gate · staff entry" : z.kind === "staff" ? "Staff area" : "Classroom",
        value: z.roomId, icon: z.kind === "gate" ? "door" : "qr", color: "var(--bg-2)",
      }));
      const roomId = await CP.pick({ title: "Test a scan (leaders only)", options: zones });
      if (roomId) handle(S.qrPayload(roomId), { sim: true });
    };

    function handleManual(v) {
      const zone = S.data.zones.find((z) => (z.code || "").toUpperCase() === String(v).trim().toUpperCase()) ||
        S.data.zones.find((z) => z.roomId.replace(/^room-/, "").toUpperCase() === String(v).trim().toUpperCase());
      if (!zone) return fail("That room code was not recognised.");
      handle(S.qrPayload(zone.roomId), { sim: true });
    }

    function fail(msg, code) {
      CP.burst({ kind: "err", title: code || "Could not record", sub: msg });
    }

    async function handle(raw, meta) {
      if (!alive) return;
      const parsed = S.parseQr(raw);
      if (!parsed) return fail("This is not a ClassPulse code.", "Not recognised");
      if (!parsed.valid) return fail(parsed.reason || "Code rejected.", "Expired code");
      const zone = parsed.zone;

      // geofence (optional)
      let g = { lat: null, lng: null };
      if (S.data.settings.requireGeofence && meta && !meta.sim) g = await geo();

      // The school server decides whether this code counts. With "school
      // Wi-Fi only" on, a phone that cannot reach the server cannot record.
      let grant = { ok: true, local: true };
      if (!(meta && meta.sim) && CP.sync && CP.sync.verifyScan) {
        grant = await CP.sync.verifyScan(zone.roomId, raw, g);
        if (!grant.ok) {
          const title =
            grant.code === "NO_GATE" ? "Gate first" :
            grant.code === "REPLAY" ? "Already used" :
            grant.code === "BAD_CODE" ? "Expired code" :
            grant.code === "OFF_NETWORK" || grant.code === "OFFLINE" ? "School Wi-Fi only" :
            "Not recorded";
          return fail(grant.reason || "Scan refused.", title);
        }
      }

      if (zone.kind === "gate" || zone.kind === "staff") {
        const res = S.gateScan(me.id, zone, { method: meta && meta.sim ? "sim" : "qr", lat: g.lat, lng: g.lng, offline: !CP.online(), scanId: grant.scanId });
        if (res.kind === "dupe") return fail(res.message, "Already done");
        const late = res.status === "late";
        CP.burst({
          title: res.kind === "gate-in" ? (late ? "Arrived late" : "Welcome — arrival recorded") : "Departure recorded",
          sub: `${CP.time.ampm(S.now())} · ${zone.label}` + (late ? ` · ${res.lateBy} min after ${S.data.settings.lateAfter}` : ""),
          kind: late ? "err" : "ok",
          extra: late ? `<span class="pill warn">DOS notified</span>` : `<span class="pill ok">On time</span>`,
        });
      } else {
        const res = S.classScan(me.id, zone, { method: meta && meta.sim ? "sim" : "qr", lat: g.lat, lng: g.lng, offline: !CP.online(), scanId: grant.scanId });
        if (!res.ok) return fail(res.reason, res.code === "COVERED" ? "Covered lesson" : res.code === "NO_LESSON" ? "No lesson here" : res.code === "NO_GATE" ? "Gate first" : "Not recorded");
        CP.burst({
          title: res.kind === "class-in" ? (res.status === "late" ? `In class ${res.lateBy} min late` : "Lesson started") : "Lesson ended",
          sub: `${res.subject || ""} · ${res.classId || ""} · P${res.period} · ${CP.esc(zone.label)}`,
          kind: res.kind === "class-out" && res.early ? "err" : "ok",
          extra: `<span class="pill ${res.status === "late" ? "warn" : "ok"}">${CP.esc(res.at || "")}</span>`,
        });
      }
      // refresh scanning state
      if (CP.sync) CP.sync.pushLocal();
      setTimeout(() => { if (alive) sheet.close(); }, 1500);
    }

    sheet._onCloseHook = () => { alive = false; scanner.stop(); };
    return { close: sheet.close };
  };

  // keep the scanner alive while the sheet is open
  const _sheet = CP.sheet;
  CP.sheet = function (o) {
    const s = _sheet(o);
    const orig = s.close;
    s.close = function () { if (s._onCloseHook) { try { s._onCloseHook(); } catch (e) {} } orig(); };
    return s;
  };

  /* ============================================== TEACHER: SCAN TAB (also) */
  CP.scanPanel = function (ctx) {
    const me = ctx.me;
    const now = S.now();
    const per = S.periodAt(now);
    const gate = S.gateStatus(me.id, CP.time.dayKey(now));
    const myNext = myUpcoming(me.id, now);
    const isLeader = ["dos", "head", "admin"].includes(me.role);
    return {
      title: "Scan",
      sub: gate ? (gate.out ? "Checked out at " + gate.out : "Checked in at " + gate.in) : "Not checked in yet",
      html: `
        ${statusHero(me, now, per, gate)}
        <div class="grid g2 mt-4">
          <button class="card press col center gap-3" data-action="open-scan" style="padding:22px 16px">
            <span style="width:56px;height:56px;border-radius:20px;display:grid;place-items:center;background:var(--brand-500);color:#fff;box-shadow:var(--shadow-brand)">${CP.icon("scan", ' style="width:28px;height:28px"')}</span>
            <span class="fw-6">Open scanner</span>
            <span class="t-xs dim">Gate · classroom · staff room</span>
          </button>
          ${isLeader ? `<button class="card press col center gap-3" data-action="open-manual" style="padding:22px 16px">
            <span style="width:56px;height:56px;border-radius:20px;display:grid;place-items:center;background:var(--bg-2);border:1px solid var(--line)">${CP.icon("key", ' style="width:26px;height:26px"')}</span>
            <span class="fw-6">Enter code</span>
            <span class="t-xs dim">Leader test · no camera</span>
          </button>` : `<div class="card col center gap-3" style="padding:22px 16px">
            <span style="width:56px;height:56px;border-radius:20px;display:grid;place-items:center;background:var(--bg-2);border:1px solid var(--line)">${CP.icon("qr", ' style="width:26px;height:26px"')}</span>
            <span class="fw-6">Damaged poster?</span>
            <span class="t-xs dim">Ask the office to reprint it. Codes are never typed in.</span>
          </div>`}
        </div>
        ${myNext ? CP.section("Next lesson") + lessonRow(myNext, me) : ""}
        ${CP.section("Today's scans")}
        <div class="timeline">${myEvents(me.id, 12)}</div>
        ${myAnomalies(me.id)}`,
      after(root) {
        root.querySelectorAll('[data-action="open-scan"]').forEach((b) => b.onclick = () => CP.openScanner());
        root.querySelectorAll('[data-action="open-manual"]').forEach((b) => b.onclick = async () => {
          if (!isLeader) return;
          const v = await CP.prompt({ title: "Enter room code", label: "Room / gate code" });
          if (!v) return;
          const zone = S.data.zones.find((z) => (z.code || "").toUpperCase() === v.trim().toUpperCase()) ||
            S.data.zones.find((z) => z.roomId.replace(/^room-/, "").toUpperCase() === v.trim().toUpperCase());
          if (!zone) return CP.toast({ kind: "err", msg: "Unknown code." });
          const c = S.parseQr(S.qrPayload(zone.roomId));
          if (zone.kind === "gate") { const r = S.gateScan(me.id, zone, { method: "manual", offline: !CP.online() }); CP.burst({ title: r.kind === "gate-in" ? "Arrival recorded" : "Departure recorded", sub: zone.label, kind: "ok" }); }
          else { const r = S.classScan(me.id, zone, { method: "manual", offline: !CP.online() }); CP.burst({ title: r.ok ? "Lesson " + (r.kind === "class-in" ? "started" : "ended") : "Not recorded", sub: r.ok ? r.classId + " · P" + r.period : r.reason, kind: r.ok ? "ok" : "err" }); }
          if (CP.sync) CP.sync.pushLocal();
          setTimeout(() => CP.render(), 1200);
        });
      },
    };
  };

  function statusHero(me, now, per, gate) {
    const late = gate && gate.mins > CP.time.mins(S.data.settings.lateAfter);
    const state = !gate ? "absent" : late ? "late" : "on-time";
    return `<div class="hero">
      <div class="row between mb-4">
        <div>
          <div class="upper dim">${CP.esc(CP.time.dayName(now))} · ${CP.esc(CP.time.dayKey(now))}</div>
          <div class="t-3xl fw-7 mono" style="letter-spacing:-.04em">${CP.time.hms(now)}</div>
        </div>
        <div class="text-right">
          ${CP.pill(state, !gate ? "Not checked in" : late ? "Late" : "Present")}
          <div class="t-xs dim mt-2">${per.kind === "period" ? "Period " + per.n + " · till " + per.end : per.kind === "break" ? per.label + " till " + per.end : "Outside lessons"}</div>
        </div>
      </div>
      <div class="row gap-4">
        <div class="grow">
          <div class="t-xs dim upper mb-1">${gate ? "Gate in / out" : "Your arrival is not recorded"}</div>
          <div class="t-xl fw-7 mono">${gate ? gate.in + (gate.out ? " → " + gate.out : " → —") : "— : —"}</div>
        </div>
        ${!gate ? `<button class="btn primary" data-action="open-scan">${CP.icon("door")} Check in now</button>` :
          !gate.out ? `<button class="btn" data-action="open-scan">${CP.icon("logout")} Check out</button>` : ""}
      </div>
    </div>`;
  }

  /* ------------------------------------------------------ shared widgets */
  function myUpcoming(userId, now) {
    const list = S.instancesForDate(CP.time.dayKey(now)).filter((i) => i.teacherId === userId && i.state === "pending");
    return list[0] || null;
  }
  CP.myUpcoming = myUpcoming;

  function lessonRow(inst, me) {
    const m = CP.stateMeta(inst.state);
    return `<div class="li left ${m.cls}" data-lesson="${inst.key}">
      <div class="text-c" style="width:52px;flex:0 0 auto">
        <div class="fw-7 mono">${inst.start}</div>
        <div class="t-xs dim">P${inst.period}</div>
      </div>
      <div class="body">
        <div class="name truncate">${CP.esc(inst.subject)} · ${CP.esc(inst.classId)}</div>
        <div class="meta truncate">${CP.icon("map", ' style="width:12px;height:12px;vertical-align:-2px"')} ${CP.esc(inst.roomName)} ${inst.covered ? "· cover by " + CP.esc((S.user(inst.coverBy) || {}).name || "") : ""}</div>
      </div>
      <div class="tail">
        ${CP.pill(inst.state)}
        ${inst.inAt ? `<div class="t-xs dim mt-1 mono">${inst.inAt}${inst.outAt ? "→" + inst.outAt : ""}</div>` : ""}
      </div>
    </div>`;
  }
  CP.lessonRow = lessonRow;

  function myEvents(userId, limit) {
    const evs = S.data.events.filter((e) => e.userId === userId).slice(0, limit || 10);
    if (!evs.length) return CP.empty("No scans yet today", "Your gate and classroom scans will appear here.", "scan");
    return evs.map((e) => `<div class="tl-item ${e.kind === "gate-out" ? "warn" : "ok"}">
      <div class="row between"><span class="fw-6 t-sm">${CP.esc(labelOfEvent(e.kind))}</span>
        <span class="t-xs dim mono">${CP.time.hm(e.ts)}</span></div>
      <div class="t-sm muted">${CP.esc(e.roomName || "")}${e.classId ? " · " + CP.esc(e.classId) + " P" + e.period : ""}
        ${e.offline ? ' · <span class="warn">offline</span>' : ""}</div>
    </div>`).join("");
  }
  function labelOfEvent(k) {
    return { "gate-in": "Arrival at gate", "gate-out": "Departure", "class-in": "Entered classroom", "class-out": "Left classroom" }[k] || k;
  }
  CP.labelOfEvent = labelOfEvent;

  function myAnomalies(userId) {
    const st = S.teacherStats(userId, 30);
    const out = [];
    if (st.lateGate >= 3) out.push(["warn", "Frequent late arrivals", st.lateGate + " late arrivals in the last " + st.workDays + " school days (avg " + st.avgLateBy + " min)."]);
    if (st.missedLessons >= 3) out.push(["danger", "Lessons not attended", st.missedLessons + " lessons have no attendance record this period."]);
    if (st.outEarly >= 2 && !out.length) out.push(["info", "Early departures", st.outEarly + " early check-outs recorded."]);
    if (!out.length) return "";
    return CP.section("Patterns worth your attention") +
      out.map(([k, t, b]) => CP.banner(k, t, b)).join("");
  }

  /* ==================================================== TEACHER: HOME TAB */
  CP.views.teacher = CP.views.teacher || {};
  CP.views.teacher.home = function (ctx) {
    const me = ctx.me;
    const now = S.now();
    const dateKey = CP.time.dayKey(now);
    const per = S.periodAt(now);
    const gate = S.gateStatus(me.id, dateKey);
    const mine = S.instancesForDate(dateKey).filter((i) => i.teacherId === me.id || i.coverBy === me.id);
    const done = mine.filter((i) => ["on-time", "late", "covered"].includes(i.state)).length;
    const upcoming = mine.filter((i) => i.state === "pending");
    const stats = S.teacherStats(me.id, 30);
    const alerts = S.alertsFor(me).slice(0, 3);
    const series = S.rangeStats(14).map((d) => d.coverage);

    return {
      title: "My day",
      sub: CP.time.dayName(now) + " · " + (per.kind === "period" ? "Period " + per.n : per.kind === "break" ? per.label : "Outside lessons"),
      html: `
        ${statusHero(me, now, per, gate)}
        <div class="grid g3 mt-4">
          ${CP.stat({ k: "Lessons today", v: mine.length, d: done + " done · " + upcoming.length + " ahead", tone: "" })}
          ${CP.stat({ k: "Punctuality", v: stats.punctuality + "%", d: "last 30 days", tone: stats.punctuality >= 90 ? "ok" : stats.punctuality >= 75 ? "warn" : "danger" })}
          ${CP.stat({ k: "Cover points", v: stats.points, d: "helping colleagues", tone: "ok", spark: CP.charts.spark(series) })}
        </div>
        ${upcoming.length ? `<div class="card mt-4" style="background:var(--ok-soft);border-color:rgba(16,185,129,.3)">
            <div class="row between">
              <div><div class="t-xs dim upper">Up next</div>
                <div class="fw-7 t-lg mt-1">${CP.esc(upcoming[0].subject)} · ${CP.esc(upcoming[0].classId)}</div>
                <div class="t-sm muted">${CP.esc(upcoming[0].roomName)} · P${upcoming[0].period} · ${upcoming[0].start}–${upcoming[0].end}</div></div>
              <button class="btn accent" data-action="open-scan">${CP.icon("scan")} Scan in</button>
            </div>
          </div>` : ""}
        ${!gate ? `<div class="mt-4">${CP.banner("warn", "Not checked in at the gate", "Scan the gate code when you arrive — the DOS sees it immediately.")}</div>` : ""}
        <div class="grid g2 mt-4">
          <button class="card press col center gap-2" data-action="nav:lessons" style="padding:18px">
            ${CP.icon("book", ' style="width:26px;height:26px;color:var(--accent-500)"')}
            <span class="fw-6 t-sm">Lesson plans</span><span class="t-xs dim">Auto-generated, NCDC</span></button>
          <button class="card press col center gap-2" data-action="nav:alerts" style="padding:18px">
            ${CP.icon("bell", ' style="width:26px;height:26px;color:var(--warn)"')}
            <span class="fw-6 t-sm">Alerts</span><span class="t-xs dim">${alerts.length} recent</span></button>
        </div>
        ${CP.section("Today's timetable", `<button class="btn xs ghost" data-action="nav:lessons">All plans ${CP.icon("chevron")}</button>`)}
        <div class="list">${mine.length ? mine.map((i) => lessonRow(i, me)).join("") : CP.empty("No lessons today")}</div>
        ${alerts.length ? CP.section("Latest notices") + alerts.map(alertCard).join("") : ""}`,
      after(root) {
        root.querySelectorAll("[data-action^='open-scan']").forEach((b) => b.onclick = () => CP.openScanner());
        root.querySelectorAll("[data-action^='nav:']").forEach((b) => b.onclick = () => CP.go("/teacher/" + b.dataset.action.split(":")[1]));
      },
    };
  };

  CP.views.teacher.scan = (ctx) => CP.scanPanel(ctx);

  /* ================================================= TEACHER: LESSONS TAB */
  CP.views.teacher.lessons = function (ctx) {
    const me = ctx.me;
    const tab = contextCache.lessonsTab || "today";
    const mine = S.data.timetable.filter((r) => r.teacherId === me.id);
    const subjects = Array.from(new Set(mine.map((r) => r.subject)));
    const classes = Array.from(new Set(mine.map((r) => r.classId)));
    const now = S.now();

    let body = "";
    if (tab === "today") {
      const list = S.instancesForDate(CP.time.dayKey(now)).filter((i) => i.teacherId === me.id);
      body = `<div class="list">${list.map((i) => lessonRow(i, me)).join("") || CP.empty("Free day", "No lessons on your timetable today.")}</div>`;
    } else if (tab === "plan") {
      body = planBuilder(me, subjects, classes);
    } else if (tab === "scheme") {
      body = schemeBuilder(me, subjects, classes);
    } else if (tab === "resources") {
      body = resourcesPanel(subjects);
    } else if (tab === "record") {
      body = recordOfWork(me);
    }

    return {
      title: "Teaching",
      sub: "Plans, schemes, resources and record of work",
      html: `
        ${CP.seg("ltab", [
          { value: "today", label: "My week" },
          { value: "plan", label: "Lesson plan" },
          { value: "scheme", label: "Scheme of work" },
          { value: "record", label: "Record of work" },
          { value: "resources", label: "e-Resources" },
        ], tab)}
        <div class="mt-4" data-body>${body}</div>`,
      after(root) {
        CP.bindSeg(root, "ltab", (v) => { contextCache.lessonsTab = v; CP.render(); });
        bindPlanBuilder(root, me);
        bindSchemeBuilder(root, me);
      },
    };
  };

  const contextCache = {};

  function planBuilder(me, subjects, classes) {
    const mine = S.data.timetable.filter((r) => r.teacherId === me.id);
    const subj = contextCache.planSubject || subjects[0] || "Mathematics";
    const cls = contextCache.planClass || classes[0] || "S1A";
    const level = (S.classInfo(cls) || {}).level || cls.slice(0, 2);
    const topics = CP.curriculum.topics(subj, level);
    const topicName = contextCache.planTopic || (topics[0] || {}).topic || "";
    const topic = topics.find((t) => t.topic === topicName) || topics[0] || { content: "" };
    const slots = mine.filter((r) => r.subject === subj && r.classId === cls);
    const slot = slots[contextCache.planSlot || 0] || slots[0] || { period: 1, day: 1 };

    return `
      <div class="card mb-4">
        <div class="t-xs dim upper mb-3">Generate a lesson plan</div>
        <div class="grid g2 mb-3">
          <div class="field"><label>Subject</label><select class="select" data-pl="subject">${subjects.map((s) => `<option ${s === subj ? "selected" : ""}>${CP.esc(s)}</option>`).join("")}</select></div>
          <div class="field"><label>Class</label><select class="select" data-pl="class">${classes.map((c) => `<option ${c === cls ? "selected" : ""}>${CP.esc(c)}</option>`).join("")}</select></div>
        </div>
        <div class="field mb-3"><label>Topic (NCDC ${CP.esc(level)} — ${level})</label>
          <select class="select" data-pl="topic">${topics.map((t) => `<option ${t.topic === topicName ? "selected" : ""} value="${CP.esc(t.topic)}">${CP.esc(t.topic)} (${t.periods}p)</option>`).join("")}</select></div>
        <div class="grid g2 mb-4">
          <div class="field"><label>Lesson slot</label><select class="select" data-pl="slot">${slots.map((s, i) => `<option value="${i}" ${i === (contextCache.planSlot || 0) ? "selected" : ""}>${CP.time.dayShort(new Date(2024, 0, 1 + s.day))} P${s.period} · ${CP.esc(S.room(s.roomId) ? S.room(s.roomId).name : "")}</option>`).join("") || `<option>Any</option>`}</select></div>
          <div class="field"><label>Date</label><input class="input" type="date" data-pl="date" value="${CP.time.dayKey(S.now())}"></div>
        </div>
        <button class="btn primary block" data-pl-gen>${CP.icon("zap")} Generate NCDC lesson plan</button>
      </div>
      <div class="banner info mb-4"><span class="ic info">${CP.icon("info")}</span>
        <div class="grow t-sm">Content is pre-filled from the NCDC competency-based syllabus and edited by you. Always check it against your subject Teacher's Guide before submission.</div></div>
      <div data-pl-out></div>`;
  }

  function bindPlanBuilder(root, me) {
    const gen = root.querySelector("[data-pl-gen]");
    if (!gen) return;
    const get = (k) => { const el = root.querySelector(`[data-pl="${k}"]`); return el ? el.value : ""; };
    root.querySelectorAll("[data-pl]").forEach((el) => el.onchange = () => {
      contextCache.planSubject = get("subject");
      contextCache.planClass = get("class");
      contextCache.planTopic = get("topic");
      contextCache.planSlot = +get("slot") || 0;
      CP.render();
    });
    gen.onclick = () => {
      const subj = get("subject"), cls = get("class"), topicName = get("topic");
      const level = (S.classInfo(cls) || {}).level || cls.slice(0, 2);
      const t = CP.curriculum.topics(subj, level).find((x) => x.topic === topicName) || {};
      const slots = S.data.timetable.filter((r) => r.teacherId === me.id && r.subject === subj && r.classId === cls);
      const slot = slots[+get("slot") || 0] || {};
      const per = S.data.settings.periods.find((p) => p.n === slot.period);
      const plan = CP.curriculum.lessonPlan({
        subject: subj, level, className: cls, topic: t.topic, content: t.content,
        competences: t.comps, periods: 1, teacherName: me.name,
        week: currentWeek(), period: slot.period, time: per ? per.start + "–" + per.end : "",
        date: get("date"), term: S.data.school.term, periodNo: slot.period,
      });
      renderPlanOutput(root, plan);
      CP.toast({ kind: "ok", msg: "Lesson plan generated — review and edit." });
    };
  }

  function currentWeek() {
    const start = new Date(S.now().getFullYear(), 0, 6);
    const wk = Math.ceil((S.now() - start) / 6048e5);
    return ((wk - 1) % 12) + 1;
  }
  CP.currentWeek = currentWeek;

  function renderPlanOutput(root, plan) {
    const out = root.querySelector("[data-pl-out]");
    const text = CP.curriculum.planToText(plan);
    out.innerHTML = `
      <div class="card">
        <div class="row between mb-4">
          <div><div class="upper dim">Lesson plan</div>
          <div class="fw-7 t-lg">${CP.esc(plan.meta.topic)}</div>
          <div class="t-sm muted">${CP.esc(plan.meta.subject)} · ${CP.esc(plan.meta.class)} · ${CP.esc(plan.meta.date)}</div></div>
          <div class="row gap-2">
            <button class="icon-btn" data-print title="Print">${CP.icon("print")}</button>
            <button class="icon-btn" data-down title="Download">${CP.icon("download")}</button>
            <button class="icon-btn" data-save title="Save plan">${CP.icon("check")}</button>
          </div>
        </div>
        ${block("Subject competences", ul(plan.competences))}
        ${block("Learning outcomes", `
          ${sub("Knowledge", plan.outcomes.knowledge)}${sub("Skills", plan.outcomes.skills)}${sub("Values / attitudes", plan.outcomes.values)}`)}
        ${block("Pre-requisite knowledge & skills", ul(plan.prerequisites))}
        ${block("Instructional materials", chips(plan.materials))}
        ${block("Methods / techniques", chips(plan.method))}
        ${block("Life skills", chips(plan.lifeSkills))}
        ${block("Lesson procedure", plan.steps.map((s) => `
          <div class="card flat mb-3">
            <div class="row between"><b class="t-sm">${CP.esc(s.phase)}</b><span class="pill">${s.minutes} min</span></div>
            <div class="grid g2 mt-3">
              <div><div class="t-xs dim upper mb-2">Teacher</div>${ul(s.teacher)}</div>
              <div><div class="t-xs dim upper mb-2">Learners</div>${ul(s.learner)}</div>
            </div>
          </div>`).join(""))}
        ${block("Assessment", `
          <div class="kv"><span class="k">Strategies</span><span class="v">${CP.esc(plan.assessment.strategies.join(", "))}</span></div>
          <div class="kv"><span class="k">Criteria</span><span class="v">${CP.esc(plan.assessment.criteria)}</span></div>
          <div class="kv"><span class="k">Rationale</span><span class="v">${CP.esc(plan.assessment.rationale)}</span></div>`)}
        ${block("Differentiation", ul(plan.differential))}
        ${block("e-Resources", plan.eResources.map((r) => `<a class="kv" href="${CP.esc(r.url)}" target="_blank" rel="noopener"><span class="k">${CP.esc(r.label)}</span><span class="v">${CP.icon("arrowRight", ' style="width:14px"')}</span></a>`).join(""))}
        ${block("Homework", `<div class="t-sm muted">${CP.esc(plan.homework)}</div>`)}
        <div class="banner info mt-3"><span class="ic info">${CP.icon("info")}</span>
          <div class="grow t-xs">${CP.esc(CP.curriculum.NCDC_NOTE)}</div></div>
      </div>`;
    out.querySelector("[data-print]").onclick = () => CP.curriculum.printable("Lesson Plan — " + plan.meta.topic, text);
    out.querySelector("[data-down]").onclick = () => {
      S.download(new Blob([text], { type: "text/plain" }), "lesson-plan-" + plan.meta.topic.replace(/\W+/g, "-") + ".txt");
    };
    const saveBtn = out.querySelector("[data-save]");
    if (saveBtn) saveBtn.onclick = () => {
      S.data.plans = S.data.plans || [];
      const savedPlan = { id: CP.uid("pl"), plan, text, ts: Date.now(), by: CP.me().id, pushed: false };
      S.data.plans.unshift(savedPlan);
      S.save(true);
      S.emit("plan", savedPlan);
      CP.toast({ kind: "ok", msg: "Lesson plan saved." });
    };
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function block(title, inner) {
    return `<div class="mb-4"><div class="t-xs dim upper mb-2">${CP.esc(title)}</div>${inner}</div>`;
  }
  function ul(items) { return `<ul style="margin:0;padding-left:18px" class="t-sm">${items.map((i) => `<li>${CP.esc(i)}</li>`).join("")}</ul>`; }
  function sub(t, items) { return `<div class="mb-2"><span class="pill">${CP.esc(t)}</span><div class="mt-2">${ul(items)}</div></div>`; }
  function chips(items) { return `<div class="row wrap gap-2">${items.map((i) => `<span class="chip" style="pointer-events:none">${CP.esc(i)}</span>`).join("")}</div>`; }

  function schemeBuilder(me, subjects, classes) {
    const subj = contextCache.schSubject || subjects[0] || "Mathematics";
    const cls = contextCache.schClass || classes[0] || "S1A";
    const level = (S.classInfo(cls) || {}).level || cls.slice(0, 2);
    const perWeek = S.data.timetable.filter((r) => r.teacherId === me.id && r.subject === subj && r.classId === cls).length || 4;
    return `
      <div class="card mb-4">
        <div class="t-xs dim upper mb-3">Generate a scheme of work</div>
        <div class="grid g2 mb-3">
          <div class="field"><label>Subject</label><select class="select" data-sc="subject">${subjects.map((s) => `<option ${s === subj ? "selected" : ""}>${CP.esc(s)}</option>`).join("")}</select></div>
          <div class="field"><label>Class</label><select class="select" data-sc="class">${classes.map((c) => `<option ${c === cls ? "selected" : ""}>${CP.esc(c)}</option>`).join("")}</select></div>
        </div>
        <div class="grid g3 mb-4">
          <div class="field"><label>Weeks</label><input class="input" type="number" min="4" max="14" value="${contextCache.schWeeks || 9}" data-sc="weeks"></div>
          <div class="field"><label>Revision weeks</label><input class="input" type="number" min="0" max="3" value="${contextCache.schRev == null ? 1 : contextCache.schRev}" data-sc="rev"></div>
          <div class="field"><label>Periods / week</label><input class="input" type="number" min="1" max="8" value="${perWeek}" data-sc="per"></div>
        </div>
        <button class="btn primary block" data-sc-gen>${CP.icon("zap")} Generate scheme of work</button>
      </div>
      <div data-sc-out></div>`;
  }

  function bindSchemeBuilder(root, me) {
    const gen = root.querySelector("[data-sc-gen]");
    if (!gen) return;
    const get = (k) => { const el = root.querySelector(`[data-sc="${k}"]`); return el ? el.value : ""; };
    root.querySelectorAll("[data-sc]").forEach((el) => el.onchange = () => {
      contextCache.schSubject = get("subject"); contextCache.schClass = get("class");
      contextCache.schWeeks = +get("weeks"); contextCache.schRev = +get("rev"); CP.render();
    });
    gen.onclick = () => {
      const subj = get("subject"), cls = get("class");
      const level = (S.classInfo(cls) || {}).level || cls.slice(0, 2);
      const scheme = CP.curriculum.scheme({
        subject: subj, level, className: cls, teacherName: me.name,
        weeks: +get("weeks"), periodsPerWeek: +get("per"), revisionWeeks: +get("rev"),
        term: S.data.school.term, year: S.now().getFullYear(),
      });
      const out = root.querySelector("[data-sc-out]");
      out.innerHTML = `
        <div class="card">
          <div class="row between mb-4">
            <div><div class="upper dim">Scheme of work</div>
            <div class="fw-7 t-lg">${CP.esc(subj)} · ${CP.esc(cls)}</div>
            <div class="t-sm muted">${CP.esc(S.data.school.term)} · ${scheme.rows.length} weeks · ${CP.esc(me.name)}</div></div>
            <div class="row gap-2">
              <button class="icon-btn" data-print>${CP.icon("print")}</button>
              <button class="icon-btn" data-csv>${CP.icon("download")}</button>
            </div>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Wk</th><th>Periods</th><th>Topic / sub-topics</th><th>Competences & outcomes</th><th>Methods & materials</th><th>Assessment</th></tr></thead>
            <tbody>${scheme.rows.map((r) => `<tr>
              <td class="fw-7">${r.week}${r.span > 1 ? "–" + (r.week + r.span - 1) : ""}</td>
              <td class="mono">${r.periods}</td>
              <td><b>${CP.esc(r.topic)}</b><div class="t-xs dim mt-1">${CP.esc(r.subtopics)}</div></td>
              <td class="t-xs">${r.competences.map(CP.esc).join("<br>")}<div class="dim mt-1">K: ${CP.esc(r.outcomes.knowledge[0])}<br>S: ${CP.esc(r.outcomes.skills[0])}</div></td>
              <td class="t-xs">${CP.esc(r.methods.join(", "))}<div class="dim mt-1">${CP.esc(r.materials.join(", "))}</div></td>
              <td class="t-xs">${CP.esc(r.assessment.join(", "))}<div class="dim mt-1">Life skills: ${CP.esc(r.lifeSkills.join(", "))}</div></td>
            </tr>`).join("")}</tbody>
          </table></div>
        </div>`;
      const text = CP.curriculum.schemeToText(scheme);
      out.querySelector("[data-print]").onclick = () => CP.curriculum.printable("Scheme of Work — " + subj + " " + cls, text);
      out.querySelector("[data-csv]").onclick = () => S.exportCsv(scheme.rows.map((r) => ({
        week: r.week, periods: r.periods, topic: r.topic, subtopics: r.subtopics,
        competences: r.competences.join("; "), knowledge: r.outcomes.knowledge.join("; "),
        skills: r.outcomes.skills.join("; "), values: r.outcomes.values.join("; "),
        methods: r.methods.join("; "), materials: r.materials.join("; "),
        lifeSkills: r.lifeSkills.join("; "), assessment: r.assessment.join("; "),
      })), "scheme-" + subj + "-" + cls + ".csv");
      CP.toast({ kind: "ok", msg: "Scheme generated for " + scheme.rows.length + " weeks." });
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function resourcesPanel(subjects) {
    const subj = contextCache.resSubject || subjects[0] || "Mathematics";
    const list = CP.curriculum.eResources(subj, "");
    return `
      <div class="chips mb-4">${subjects.map((s) => `<button class="chip ${s === subj ? "on" : ""}" data-res="${CP.esc(s)}">${CP.esc(s)}</button>`).join("")}</div>
      <div class="list">${list.map((r) => `<a class="li" href="${CP.esc(r.url)}" target="_blank" rel="noopener">
        <span style="width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:var(--bg-2)">${CP.icon("layers")}</span>
        <span class="body"><span class="name">${CP.esc(r.label)}</span><span class="meta">${CP.esc(r.url.replace(/^https?:\/\//, "").slice(0, 46))}</span></span>
        ${CP.icon("chevron")}</a>`).join("")}</div>
      <div class="banner info mt-4"><span class="ic info">${CP.icon("info")}</span>
        <div class="grow t-sm">Resources are free and work on a phone. Where a school has no internet in class, install <b>Kolibri</b> on one laptop and share it over the local Wi-Fi — thousands of lessons offline.</div></div>`;
  }

  function recordOfWork(me) {
    const now = S.now();
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const k = CP.time.dayKey(d);
      S.instancesForDate(k).filter((x) => x.teacherId === me.id).forEach((x) => rows.push(Object.assign({ date: k }, x)));
    }
    const rec = CP.curriculum.recordOfWork(rows);
    // syllabus coverage for this teacher
    const mine = S.data.timetable.filter((r) => r.teacherId === me.id);
    const pairs = Array.from(new Set(mine.map((r) => r.subject + "|" + r.classId)));
    const covRows = pairs.slice(0, 8).map((p) => {
      const [subj, cls] = p.split("|");
      const delivered = rows.filter((r) => r.subject === subj && r.classId === cls && ["on-time", "late", "covered"].includes(r.state));
      const total = rows.filter((r) => r.subject === subj && r.classId === cls).length;
      return { subject: subj, class: cls, pct: CP.pct(delivered.length, Math.max(1, total)), n: delivered.length, total };
    });
    return `
      ${CP.section("Record of work — last 14 days")}
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Date</th><th>P</th><th>Class</th><th>Subject</th><th>Remarks</th></tr></thead>
        <tbody>${rec.slice(0, 40).map((r) => `<tr>
          <td class="dim">${r.no}</td><td class="mono">${r.date.slice(5)}</td><td class="mono">${r.period}</td>
          <td>${CP.esc(r.class)}</td><td>${CP.esc(r.subject)}</td>
          <td class="t-xs">${CP.esc(r.remarks)}</td></tr>`).join("")}</tbody>
      </table></div>
      <button class="btn block mt-3" data-rec-csv>${CP.icon("download")} Export record of work (CSV)</button>
      ${CP.section("Teaching activity by subject/class")}
      <div class="col gap-3">${covRows.map((r) => `
        <div><div class="row between t-sm mb-2"><span class="fw-6">${CP.esc(r.subject)} · ${CP.esc(r.class)}</span>
          <span class="mono dim">${r.n}/${r.total} lessons</span></div>
          <div style="height:8px;border-radius:99px;background:var(--bg-2);overflow:hidden">
            <div style="height:100%;width:${r.pct}%;background:var(--brand-500)"></div></div></div>`).join("")}</div>`;
  }

  /* ============================================================ ALERTS TAB */
  function alertCard(a) {
    const tone = a.level === "danger" ? "danger" : a.level === "warn" ? "warn" : "info";
    const me = CP.me();
    return `<div class="card flat" style="${me && !a.read[me.id] ? "border-color:var(--line-strong)" : "opacity:.82"}">
      <div class="row between mb-2">
        <span class="pill ${tone}"><span class="dt"></span>${CP.esc(a.level)}</span>
        <span class="t-xs dim mono">${CP.time.ago(a.ts)}</span>
      </div>
      <div class="fw-6">${CP.esc(a.title)}</div>
      <div class="t-sm muted mt-1">${CP.esc(a.body)}</div>
      ${a.actions && a.actions.indexOf("assign-cover") >= 0 && a.ref && a.ref.key ? `<button class="btn sm mt-3" data-cover="${CP.esc(a.ref.key)}">${CP.icon("swap")} Assign cover</button>` : ""}
    </div>`;
  }
  CP.alertCard = alertCard;

  function alertsPanel(ctx) {
    const me = ctx.me;
    const filter = contextCache.alertFilter || "all";
    let list = S.alertsFor(me);
    if (filter === "unread") list = list.filter((a) => !a.read[me.id]);
    if (filter === "critical") list = list.filter((a) => a.level === "danger" || a.level === "warn");
    return {
      title: "Alerts",
      sub: S.unreadAlerts(me.id).length + " unread",
      html: `
        ${CP.seg("af", [
          { value: "all", label: "All" },
          { value: "unread", label: "Unread" },
          { value: "critical", label: "Escalations" },
        ], filter)}
        <div class="row gap-2 mt-3 mb-4">
          <button class="btn sm grow" data-mark>${CP.icon("check")} Mark all read</button>
          <button class="btn sm grow" data-sms>${CP.icon("phone")} Send SMS digest</button>
        </div>
        <div class="list">${list.length ? list.map(alertCard).join("") : CP.empty("Nothing here", "You are all caught up.", "checkCircle")}</div>`,
      after(root) {
        CP.bindSeg(root, "af", (v) => { contextCache.alertFilter = v; CP.render(); });
        root.querySelector("[data-mark]").onclick = () => { S.markAlertsRead(me.id); CP.toast({ kind: "ok", msg: "All marked read." }); CP.render(); };
        root.querySelector("[data-sms]").onclick = () => sendSmsDigest(me);
        root.querySelectorAll("[data-cover]").forEach((b) => b.onclick = () => CP.openCover(b.dataset.cover));
      },
    };
  }
  CP.views.teacher.alerts = alertsPanel;
  CP.views.head.alerts = alertsPanel;
  CP.views.dos.alerts = alertsPanel;

  function sendSmsDigest(me) {
    const st = S.data.settings;
    if (!st.smsEnabled) {
      CP.sheet({
        title: "SMS alerts are switched off",
        body: `<p class="t-sm muted mb-4">ClassPulse can send the same alerts as SMS so a DOS without a smartphone still gets them. Set it up under <b>Me → Notification settings</b>, or connect a cheap SMS gateway (Africa's Talking, Twilio, or a local GSM modem) in <b>Admin → Settings</b>.</p>
          <div class="card flat"><div class="t-xs dim upper mb-2">Message that would be sent</div>
          <div class="t-sm mono" style="white-space:pre-wrap">${CP.esc(smsDigestText())}</div></div>`,
      });
      return;
    }
    CP.toast({ kind: "ok", msg: "Digest queued on " + st.smsProvider + " → DOS / Head." });
    S.audit(me.id, "sms-digest", {});
  }

  function smsDigestText() {
    const st = S.data.settings;
    const dateKey = CP.time.dayKey(S.now());
    const g = S.gateSummary(dateKey);
    const d = S.dayStats(dateKey);
    return `CLASS PULSE ${dateKey}\n` +
      `Present ${g.total - g.absent}/${g.total} | Late ${g.late} | Absent ${g.absent}\n` +
      `Lesson coverage ${d.coverage}% | Missed ${d.missed}\n` +
      `Uncovered now: ${S.instancesForDate(dateKey).filter((i) => i.state === "missing" && S.periodAt(S.now()).n === i.period).map((i) => i.classId).join(", ") || "none"}`;
  }
  CP.smsDigestText = smsDigestText;

  /* ============================================================= COVER FLOW */
  CP.openCover = function (key) {
    const dateKey = CP.time.dayKey(S.now());
    const inst = S.instancesForDate(dateKey).find((i) => i.key === key);
    if (!inst) return CP.toast({ kind: "err", msg: "Lesson not found." });
    const free = S.freeTeachersNow(dateKey);
    const sheet = CP.sheet({
      title: "Assign cover",
      body: `
        <div class="card flat mb-4">
          <div class="row between"><div>
            <div class="fw-7">${CP.esc(inst.subject)} · ${CP.esc(inst.classId)}</div>
            <div class="t-sm muted">${CP.esc(inst.roomName)} · P${inst.period} · ${inst.start}–${inst.end}</div>
            <div class="t-sm danger mt-1">Absent: ${CP.esc(inst.teacherName)}</div>
          </div>${CP.pill(inst.state)}</div>
        </div>
        <div class="t-xs dim upper mb-3">Free teachers this period (sorted by lightest load)</div>
        <div class="list">${free.length ? free.map((f) => `<button class="li press" data-cover-pick="${f.user.id}">
          ${CP.avatarHTML(f.user)}
          <span class="body"><span class="name">${CP.esc(f.user.name)}</span>
            <span class="meta">${CP.esc(f.user.dept)} · arrived ${f.arrived} · ${f.load} lesson(s) today</span></span>
          <span class="pill ok">${CP.icon("swap")} Assign</span></button>`).join("")
          : CP.empty("Nobody is free this period", "Every available teacher is already teaching.")}</div>`,
    });
    sheet.body.querySelectorAll("[data-cover-pick]").forEach((b) => b.onclick = () => {
      S.assignCover(dateKey, key, b.dataset.coverPick, CP.me().id);
      CP.toast({ kind: "ok", msg: "Cover assigned and the teacher notified." });
      sheet.close(); CP.render();
    });
  };

  /* ================================================================= ME TAB */
  CP.mePanel = function (ctx) {
    const me = ctx.me;
    const role = ctx.own;
    const st = role === "teacher" ? S.teacherStats(me.id, 30) : null;
    const audit = S.data.audit.filter((a) => a.actorId === me.id).slice(0, 6);
    return {
      title: "Me",
      sub: CP.ROLES[role].label + " · " + me.staffNo,
      html: `
        <div class="card">
          <div class="row gap-4">
            ${CP.avatarHTML(me, "lg")}
            <div class="grow" style="min-width:0">
              <div class="fw-7 t-lg truncate">${CP.esc(me.name)}</div>
              <div class="t-sm muted">${CP.esc(me.staffNo)} · ${CP.esc(me.dept || "")}</div>
              <div class="row gap-2 mt-2 wrap">
                <span class="pill" style="color:${CP.ROLES[role].color}">${CP.icon(CP.ROLES[role].icon)} ${CP.esc(CP.ROLES[role].short)}</span>
                <span class="pill ${me.device ? "ok" : "warn"}">${me.device ? "Device bound" : "No device bound"}</span>
              </div>
            </div>
          </div>
        </div>
        ${st ? `<div class="grid g3 mt-4">
          ${CP.stat({ k: "Attendance", v: st.attendanceRate + "%", d: st.present + "/" + st.workDays + " days" })}
          ${CP.stat({ k: "Gate punctuality", v: st.gatePunctuality + "%", d: st.lateGate + " late arrivals" })}
          ${CP.stat({ k: "Lesson coverage", v: st.coverage + "%", d: st.missedLessons + " missed" })}
        </div>` : ""}
        ${CP.section("Account")}
        <div class="list">
          ${meRow("user", "Edit profile", "Name, phone, department", "profile")}
          ${meRow("bell", "Notifications & devices", "SMS, escalation, device binding", "notify")}
          ${meRow(CP.storage.get("theme", "dark") === "dark" ? "sun" : "moon", "Appearance", "Light or dark theme", "theme")}
          ${meRow("phone", "Install on this phone", "Works like a normal app", "install")}
          ${meRow("info", "Help & how it works", "Roles, QR codes, escalation", "help")}
        </div>
        ${audit.length ? CP.section("My recent activity") + `<div class="list">${audit.map((a) => `<div class="li">
          <span style="width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:var(--bg-2)">${CP.icon("list")}</span>
          <span class="body"><span class="name">${CP.esc(a.action)}</span><span class="meta">${CP.time.ago(a.ts)}</span></span></div>`).join("")}</div>` : ""}
        ${CP.section("Session")}
        <button class="btn danger block" data-action="logout">${CP.icon("logout")} Sign out</button>
        <div class="t-xs dim text-c mt-4">ClassPulse v1.0 · ${CP.esc(S.data.school.name)}<br>Local store: ${(CP.storage.usage() / 1024).toFixed(1)} KB · ${S.data.timetable.length} timetable rows</div>`,
      after(root) {
        root.querySelectorAll("[data-me]").forEach((b) => b.onclick = () => {
          const a = b.dataset.me;
          if (a === "install") return CP.openInstall();
          if (a === "help") return CP.openHelp();
          if (a === "theme") { CP.theme(); CP.render(); return; }
          if (a === "profile") return CP.openProfile();
          if (a === "notify") return CP.openNotify();
        });
        const lo = root.querySelector("[data-action='logout']");
        if (lo) lo.onclick = () => CP.logout();
      },
    };
  };
  function meRow(icon, title, sub, action) {
    return `<button class="li press" data-me="${action}">
      <span style="width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:var(--bg-2)">${CP.icon(icon)}</span>
      <span class="body"><span class="name">${CP.esc(title)}</span><span class="meta">${CP.esc(sub)}</span></span>
      ${CP.icon("chevron")}</button>`;
  }

  /* ================================================================ TEACHER SELF-REGISTRATION */
  function openRegisterSheet() {
    const depts = S.depts();
    const subjects = S.SUGGEST.subjectList;
    const classes = S.data.classes.map((c) => c.id);
    const body = `
      <div class="col gap-3">
        <div class="field"><label>Full name</label><input class="input" data-r="name" placeholder="e.g. Grace Nabatanzi"></div>
        <div class="field"><label>Staff number</label><input class="input" data-r="staffNo" placeholder="e.g. T-101"></div>
        <div class="field"><label>Email</label><input class="input" type="email" data-r="email" placeholder="optional"></div>
        <div class="field"><label>Phone</label><input class="input" type="tel" data-r="phone" placeholder="optional"></div>
        <div class="field"><label>Department</label><select class="select" data-r="dept">${depts.map((d) => `<option>${CP.esc(d)}</option>`).join("")}</select></div>
        <div class="field"><label>Subjects (comma separated)</label><input class="input" data-r="subjects" placeholder="e.g. Mathematics, Physics"></div>
        <div class="field"><label>Classes (comma separated)</label><input class="input" data-r="classes" placeholder="e.g. S1A, S2B"></div>
        <div class="field"><label>Choose a PIN (4–8 digits)</label><input class="input" type="password" inputmode="numeric" data-r="pin" placeholder="4–8 digits"></div>
        <div class="t-xs dim">Your registration will be reviewed by the Director of Studies. You will be able to sign in only after approval.</div>
        <button class="btn primary block lg" data-r-submit>Submit registration</button>
      </div>`;
    const sh = CP.sheet({ title: "Register as a teacher", body });
    const g = (k) => sh.body.querySelector(`[data-r="${k}"]`);
    sh.body.querySelector("[data-r-submit]").onclick = () => {
      const cfg = {
        name: g("name").value.trim(),
        staffNo: g("staffNo").value.trim(),
        email: g("email").value.trim(),
        phone: g("phone").value.trim(),
        dept: g("dept").value,
        subjects: g("subjects").value.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        classes: g("classes").value.split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean),
        pin: g("pin").value.trim(),
      };
      if (!cfg.name || !cfg.staffNo) { CP.toast({ kind: "err", msg: "Name and staff number are required." }); return; }
      if (cfg.pin && !/^\d{4,8}$/.test(cfg.pin)) { CP.toast({ kind: "err", msg: "PIN must be 4–8 digits." }); return; }
      try {
        S.registerTeacher(cfg);
        CP.toast({ kind: "ok", msg: "Registration submitted. The DOS will review it." });
        sh.close();
      } catch (e) {
        CP.toast({ kind: "err", msg: e.message || "Registration failed." });
      }
    };
  }

  CP.views.teacher.me = CP.mePanel;
  CP.views.dos.me = CP.mePanel;
  CP.views.head.me = CP.mePanel;
  CP.views.admin.me = CP.mePanel;
})(window);
