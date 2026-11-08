/* ==========================================================================
   ClassPulse — sync.js
   Server-backed school. When a ClassPulse server is configured (which is the
   normal case: the server is what your phone downloaded the app from) it is
   the authority for people, classes, the timetable and settings. Scans and
   alerts travel both ways, and every phone converges live over SSE.

   When the server cannot be reached the app keeps working: scans queue in
   data.outbox and are flushed as soon as the school's server is back.

   Protocol (see server/server.cjs):
     POST /api/setup   { data:{school,users,classes,rooms,zones,timetable} }
     POST /api/login   { staffNo, pin }       -> { token, user, snapshot }
     GET  /api/bootstrap                      -> the whole school
     POST /api/config  { data:{school,settings,classes,rooms,zones,timetable} }
     POST /api/users   { user }               -> add / update / remove staff
     POST /api/ops     { ops:[…] }            -> { accepted:[ids] }
     GET  /api/stream  ?token=…&device=…      -> SSE: hello | ops | config | users
     GET  /api/health                         -> { ok, name, version, time }
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = CP.store;

  const RETRY_MIN = 3000;
  const RETRY_MAX = 60000;

  const sync = (CP.sync = {
    _server: "",
    _token: null,
    _connected: false,
    _mode: "local",
    _es: null,
    _retry: RETRY_MIN,
    _retryTimer: null,
    _pushTimer: null,
    _lastSync: null,
    _lastError: null,
    _pushing: false,
    _devices: null,
  });

  /* ------------------------------------------------------------- helpers */
  function normalise(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }
  function fromServerBase() {
    // When the whole app is served by the ClassPulse server, default to it.
    try {
      // Capacitor's WebView uses https://localhost as its local asset origin;
    // that is not the school's backend. Native installs must enter the real
    // school server URL on the sign-in screen.
    if (global.Capacitor && typeof global.Capacitor.isNativePlatform === "function" && global.Capacitor.isNativePlatform()) return "";
    if (location.protocol === "http:" || location.protocol === "https:") {
        const same = location.origin;
        if (same && /^https?:/.test(same)) return same;
      }
    } catch (e) {}
    return "";
  }

  function req(method, path, body, opts) {
    opts = opts || {};
    const url = sync._server + path;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const to = setTimeout(() => ctrl && ctrl.abort(), opts.timeout || 8000);
    const headers = { "Content-Type": "application/json" };
    if (sync._token) headers.Authorization = "Bearer " + sync._token;
    if (opts.time) headers["X-ClassPulse-Client-Time"] = String(Date.now());
    return fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      cache: "no-store",
    })
      .then((r) =>
        r.text().then((txt) => {
          let data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
          if (!r.ok) {
            const err = new Error((data && data.error) || "HTTP " + r.status);
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        })
      )
      .finally(() => clearTimeout(to));
  }

  /* --------------------------------------------------- pending op queue */
  // A local record is "pending" until the server confirms it. Remote records
  // are marked pushed + origin:"remote" so they are never echoed back.
  function pending() {
    const out = [];
    (S.data.events || []).forEach((e) => {
      if (!e.pushed && e.origin !== "remote") out.push({ kind: "event", id: e.id, data: e });
    });
    (S.data.alerts || []).forEach((a) => {
      if (!a.pushed && a.origin !== "remote") out.push({ kind: "alert", id: a.id, data: a });
    });
    Object.keys(S.data.overrides || {}).forEach((dateKey) => {
      const day = S.data.overrides[dateKey];
      Object.keys(day).forEach((key) => {
        const o = day[key];
        if (!o.pushed && o.origin !== "remote") {
          out.push({ kind: "override", id: o.syncId || (dateKey + "|" + key), dateKey, key, data: o });
        }
      });
    });
    (S.data.covers || []).forEach((c) => {
      if (!c.pushed && c.origin !== "remote") out.push({ kind: "cover", id: c.id, data: c });
    });
    (S.data.leaves || []).forEach((l) => {
      if (!l.pushed && l.origin !== "remote") out.push({ kind: "leave", id: l.id, data: l });
    });
    (S.data.plans || []).forEach((p) => {
      if (!p.pushed && p.origin !== "remote") out.push({ kind: "plan", id: p.id, data: p });
    });
    (S.data.marks || []).forEach((m) => {
      if (!m.pushed && m.origin !== "remote") out.push({ kind: "mark", id: m.syncId || m.id, data: m });
    });
    (S.data.markDeletes || []).forEach((m) => {
      if (!m.pushed) out.push({ kind: "mark", id: m.syncId, data: m });
    });
    (S.data.audit || []).forEach((a) => {
      if (!a.pushed && a.origin !== "remote") out.push({ kind: "audit", id: a.id, data: a });
    });
    // Academic records: students first, then syllabus, coverage, assessments.
    const ac = S.data.acad || {};
    ["students", "syllabus", "progress", "assessments"].forEach((col) => {
      (ac[col] || []).forEach((r) => {
        if (!r.pushed && r.origin !== "remote" && r.syncId) out.push({ kind: "acad", id: r.syncId, data: r });
      });
    });
    (ac.deletes || []).forEach((d) => { if (!d.pushed) out.push({ kind: "acad", id: d.syncId, data: d }); });
    Object.keys(S.data.gateLog || {}).forEach((dateKey) => {
      const day = S.data.gateLog[dateKey];
      Object.keys(day).forEach((userId) => {
        const g = day[userId];
        if (g && !g.pushed && !g.origin) {
          out.push({ kind: "gate", id: dateKey + "|" + userId + (g.out ? "|out" : "|in"), dateKey, userId, data: g });
        }
      });
    });
    return out;
  }

  function markPushed(op) {
    if (op.kind === "override") {
      const o = S.data.overrides[op.dateKey] && S.data.overrides[op.dateKey][op.key];
      if (o && (o.syncId || (op.dateKey + "|" + op.key)) === op.id) o.pushed = true;
      return;
    }
    if (op.kind === "gate") {
      const g = S.data.gateLog[op.dateKey] && S.data.gateLog[op.dateKey][op.userId];
      const currentId = op.dateKey + "|" + op.userId + (g && g.out ? "|out" : "|in");
      if (g && currentId === op.id) g.pushed = true;
      return;
    }
    if (op.kind === "acad") {
      const ac = S.data.acad || {};
      const col = op.data && op.data.col;
      const rec = (op.data && op.data.deleted ? ac.deletes : ac[col] || []).find((x) => x.syncId === op.id);
      if (rec) { rec.pushed = true; rec.synced = true; }
      return;
    }
    const list =
      op.kind === "event" ? S.data.events :
      op.kind === "alert" ? S.data.alerts :
      op.kind === "cover" ? S.data.covers :
      op.kind === "leave" ? S.data.leaves :
      op.kind === "plan" ? S.data.plans :
      op.kind === "mark" ? (op.data && op.data.deleted ? S.data.markDeletes : S.data.marks) :
      op.kind === "audit" ? S.data.audit : null;
    if (!list) return;
    const rec = list.find((x) => (x.syncId || x.id) === op.id || x.id === op.id);
    if (rec) { rec.pushed = true; rec.synced = true; }
  }

  /* --------------------------------------------- academic record merge */
  // The server's copy wins for anything already synchronised. A local edit that
  // has not reached the server yet is never overwritten.
  function mergeAcadRecords(recs) {
    const ac = (S.data.acad = S.data.acad || {});
    ["students", "syllabus", "progress", "assessments", "markaudit", "deletes"].forEach((c) => { if (!Array.isArray(ac[c])) ac[c] = []; });
    recs.forEach((d) => {
      if (!d || !d.col || !d.id || !Array.isArray(ac[d.col]) || d.col === "deletes") return;
      const list = ac[d.col];
      const i = list.findIndex((x) => x.id === d.id);
      if (d.deleted) { if (i >= 0 && list[i].pushed !== false) list.splice(i, 1); return; }
      if (i >= 0 && list[i].pushed === false && !list[i].rejected) return; // unsent local edit wins for now
      const rec = Object.assign({}, d, { pushed: true, synced: true, origin: "remote" });
      delete rec.rejected;
      if (i >= 0) list[i] = rec; else list.unshift(rec);
    });
    S.save();
    S.emit("acad-sync");
  }
  function mergeAcadSnapshot(snap) {
    if (!snap) return;
    const ac = (S.data.acad = S.data.acad || {});
    ["students", "syllabus", "progress", "assessments", "markaudit", "deletes"].forEach((c) => { if (!Array.isArray(ac[c])) ac[c] = []; });
    ["students", "syllabus", "progress", "assessments"].forEach((col) => {
      const remote = Array.isArray(snap[col]) ? snap[col] : [];
      const ids = new Set(remote.map((r) => r.id));
      // Records the server no longer has, which we had already synchronised, were deleted there.
      ac[col] = ac[col].filter((x) => ids.has(x.id) || x.pushed === false || x.rejected);
      mergeAcadRecords(remote.map((r) => Object.assign({ col }, r)));
    });
    if (Array.isArray(snap.markaudit)) ac.markaudit = snap.markaudit.map((a) => Object.assign({}, a, { col: "markaudit" }));
    S.save();
  }
  sync.mergeAcadSnapshot = mergeAcadSnapshot;
  sync.request = function (method, path, body, opts) { return req(method, path, body, opts); };

  /* ------------------------------------------------ apply remote ops */
  function applyOp(op) {
    if (!op || !op.kind || !op.data) return;
    const d = op.data;
    if (op.kind === "event") {
      if (!S.data.events.some((e) => e.id === d.id)) {
        d.pushed = true; d.synced = true; d.origin = "remote";
        S.data.events.unshift(d);
        if (S.data.events.length > 800) S.data.events.length = 800;
      }
    } else if (op.kind === "alert") {
      if (!S.data.alerts.some((a) => a.id === d.id)) {
        d.pushed = true; d.origin = "remote";
        d.read = d.read || {};
        S.data.alerts.unshift(d);
        if (S.data.alerts.length > 300) S.data.alerts.length = 300;
        S.emit("alert", d);
      }
    } else if (op.kind === "override") {
      const day = (S.data.overrides[op.dateKey] = S.data.overrides[op.dateKey] || {});
      day[op.key] = Object.assign({}, day[op.key] || {}, d, { live: true, pushed: true, origin: "remote" });
      S.emit("lessons", op.dateKey);
    } else if (op.kind === "gate") {
      const day = (S.data.gateLog[op.dateKey] = S.data.gateLog[op.dateKey] || {});
      day[op.userId] = Object.assign({}, day[op.userId] || {}, d, { pushed: true, origin: "remote" });
    } else if (op.kind === "cover") {
      if (!S.data.covers.some((c) => c.id === d.id)) { d.pushed = true; d.origin = "remote"; S.data.covers.unshift(d); }
    } else if (op.kind === "leave") {
      const i = S.data.leaves.findIndex((l) => l.id === d.id);
      d.pushed = true; d.origin = "remote";
      if (i >= 0) Object.assign(S.data.leaves[i], d);
      else S.data.leaves.unshift(d);
    } else if (op.kind === "plan") {
      const i = S.data.plans.findIndex((p) => p.id === d.id);
      d.pushed = true; d.origin = "remote";
      if (i >= 0) Object.assign(S.data.plans[i], d); else S.data.plans.unshift(d);
    } else if (op.kind === "mark") {
      const i = S.data.marks.findIndex((m) => m.id === d.id);
      if (d.deleted) { if (i >= 0) S.data.marks.splice(i, 1); }
      else { d.pushed = true; d.origin = "remote"; if (i >= 0) Object.assign(S.data.marks[i], d); else S.data.marks.unshift(d); }
    } else if (op.kind === "acad") {
      mergeAcadRecords([d]);
    } else if (op.kind === "audit") {
      if (!S.data.audit.some((a) => a.id === d.id)) { d.pushed = true; d.origin = "remote"; S.data.audit.unshift(d); }
      if (S.data.audit.length > 10000) S.data.audit.length = 10000;
    } else if (op.kind === "user") {
      const i = S.data.users.findIndex((u) => u.id === d.id);
      if (i >= 0) Object.assign(S.data.users[i], d);
      else if (d.id) S.data.users.push(d);
    } else if (op.kind === "timetable") {
      if (d.reset) S.data.timetable = [];
      if (Array.isArray(d.rows)) S.data.timetable = d.rows;
    } else if (op.kind === "settings") {
      if (d.settings) Object.assign(S.data.settings, d.settings);
      if (d.school) Object.assign(S.data.school, d.school);
    } else {
      return;
    }
    S.save();
    S.emit("sync", op);
    S.emit("tick");
  }

  /* ------------------------------------------------------------- login */
  // Sign in against the school's server. On success we remember a scrambled
  // copy of the PIN on this device so the teacher can still sign in offline.
  sync.login = function (staffNo, pin, opts) {
    opts = opts || {};
    if (!sync._server) return Promise.resolve(false);
    const body = { staffNo: String(staffNo || ""), pin: String(pin || ""), device: sync.deviceId() };
    if (opts.setPin) body.setPin = true;
    if (!body.staffNo) body.userId = String(staffNo || "");
    return req("POST", "/api/login", body)
      .then((res) => {
        if (res && res.token) {
          sync._token = res.token;
          sync._code = null;
          CP.storage.set("token", res.token);
          CP.storage.set("staffNo", body.staffNo || "");
          if (res.user) {
            const local = S.user(res.user.id);
            if (local) Object.assign(local, res.user, { pin: local.pin, pinHash: CP.digest(body.pin) });
            else S.data.users.push(Object.assign({}, res.user, { pinHash: CP.digest(body.pin) }));
          }
          if (res.snapshot) mergeSnapshot(res.snapshot);
          S.save(true);
          sync.setMode("server");
          sync.connect();
          return true;
        }
        return false;
      })
      .catch((e) => {
        sync._lastError = e.message;
        sync._code = (e.data && e.data.code) || null;
        return false;
      });
  };

  // A leader changes their own PIN (or an admin resets somebody else's).
  sync.changePin = function (pin, opts) {
    opts = opts || {};
    if (!sync._server || !sync._token) return Promise.resolve(false);
    return req("POST", "/api/pin", { pin: String(pin || ""), oldPin: opts.oldPin ? String(opts.oldPin) : "", userId: opts.userId })
      .then((r) => !!(r && r.ok))
      .catch((e) => { sync._lastError = e.message; return false; });
  };

  // First-run: hand the whole school to the server. Only works while the
  // server's database is empty; after that it is refused.
  sync.setup = function (doc) {
    if (!sync._server) return Promise.resolve({ ok: false, local: true });
    return req("POST", "/api/setup", { data: doc, device: sync.deviceId() }, { timeout: 15000 })
      .then((res) => {
        if (res && res.token) {
          sync._token = res.token;
          CP.storage.set("token", res.token);
          if (res.snapshot) mergeSnapshot(res.snapshot);
          sync.connect();
        }
        return { ok: !!(res && res.ok), local: false };
      })
      .catch((e) => { sync._lastError = e.message; return { ok: false, local: false, error: e.message }; });
  };

  // Leaders write the school's configuration (people, rooms, timetable…).
  sync.pushConfig = function (opts) {
    opts = opts || {};
    if (!sync._server || !sync._token) return Promise.resolve(false);
    const doc = opts.data || {
      school: S.data.school,
      settings: S.data.settings,
      subjects: S.data.meta.subjects,
      classes: S.data.classes,
      rooms: S.data.rooms,
      zones: S.data.zones,
      timetable: opts.timetable === false ? undefined : S.data.timetable,
      calendar: S.data.calendar,
    };
    return req("POST", "/api/config", { data: doc }, { timeout: 15000 })
      .then((res) => { if (res && res.snapshot) mergeSnapshot(res.snapshot); return !!(res && res.ok); })
      .catch((e) => { sync._lastError = e.message; return false; });
  };

  sync.pushUser = function (user, action) {
    if (!sync._server || !sync._token) return Promise.resolve(false);
    const pub = Object.assign({}, user);
    delete pub.pinHash;
    const body = { user: pub }; // `pin` is already the scrambled value the server stores
    if (action === "delete") body.action = "delete";
    return req("POST", "/api/users", body)
      .then((res) => !!(res && res.ok))
      .catch((e) => { sync._lastError = e.message; return false; });
  };

  // Ask the server to accept a code before it is recorded. The server checks
  // that the code is current, unused, that the phone is on the school network
  // and that the person checked in at the gate. A refusal is final when the
  // school has turned on "school network only".
  sync.verifyScan = function (roomId, code, meta) {
    meta = meta || {};
    const st = S.data.settings || {};
    const required = !!st.requireSchoolNetwork;
    if (!sync._server) return Promise.resolve({ ok: true, local: true });
    if (!sync._token) {
      return Promise.resolve(required
        ? { ok: false, code: "NO_SESSION", reason: "Sign in again to record a scan." }
        : { ok: true, local: true });
    }
    if (!CP.online()) {
      return Promise.resolve(required
        ? { ok: false, code: "OFFLINE", reason: "Connect to the school Wi-Fi to record this scan." }
        : { ok: true, local: true });
    }
    return req("POST", "/api/scan", { roomId, code, lat: meta.lat, lng: meta.lng }, { timeout: 8000 })
      .then((r) => (r && r.ok)
        ? { ok: true, scanId: r.scanId }
        : { ok: false, code: "REFUSED", reason: "The server did not accept that scan." })
      .catch((e) => {
        if (e && e.data && e.data.code) {
          return { ok: false, code: e.data.code, reason: e.data.error || "Scan refused." };
        }
        return required
          ? { ok: false, code: "OFFLINE", reason: "Cannot reach the school server. Connect to the school Wi-Fi." }
          : { ok: true, local: true };
      });
  };

  // Anonymous device registration — lets a phone push scans even before a
  // leader has signed in on it (teacher phones only ever push).
  sync.registerDevice = function () {
    if (!sync._server || sync._token) return Promise.resolve(!!sync._token);
    return req("POST", "/api/device", { device: sync.deviceId(), label: navigator.userAgent.slice(0, 120) })
      .then((res) => {
        if (res && res.token) { sync._token = res.token; CP.storage.set("token", res.token); }
        return !!(res && res.token);
      })
      .catch(() => false);
  };

  sync.deviceId = function () {
    let id = CP.storage.get("deviceId", null);
    if (!id) { id = CP.uid("dev"); CP.storage.set("deviceId", id); }
    return id;
  };

  sync.setMode = function (m) {
    sync._mode = m;
    S.emit("sync-state", sync.state());
  };

  sync.state = function () {
    return {
      server: sync._server,
      connected: sync._connected,
      mode: sync._mode,
      token: !!sync._token,
      pending: pending().length,
      outgoing: (S.data.outbox || []).length,
      lastSync: sync._lastSync,
      error: sync._lastError,
    };
  };

  /* --------------------------------------------------------- snapshots */
  // The server is the school's authority. When it has a school we adopt its
  // people, classes, rooms, zones and timetable — but we never let it wipe
  // the scrambled PIN copies this phone already holds, because those are what
  // let a teacher carry on when the network drops.
  function mergeSnapshot(snap) {
    if (!snap) return;
    const serverHasSchool =
      (Array.isArray(snap.users) && snap.users.length > 0) ||
      !!(snap.school && snap.school.name);

    if (snap.school && snap.school.name) Object.assign(S.data.school, snap.school);
    if (snap.settings) Object.assign(S.data.settings, snap.settings);
    if (snap.calendar) S.data.calendar = Object.assign({}, S.data.calendar || {}, snap.calendar);
    if (Array.isArray(snap.subjects) && snap.subjects.length) S.data.meta.subjects = snap.subjects;
    if (snap.setupAt) {
      const t = new Date(snap.setupAt).getTime();
      if (t) S.data.meta.setupAt = t;
    }

    if (Array.isArray(snap.users) && snap.users.length) {
      const byId = {};
      S.data.users.forEach((u) => (byId[u.id] = u));
      S.data.users = snap.users.map((u) => {
        const local = byId[u.id] || {};
        return Object.assign({}, u, { pin: local.pin, pinHash: local.pinHash });
      });
    }

    if (serverHasSchool) {
      if (Array.isArray(snap.classes)) S.data.classes = snap.classes;
      if (Array.isArray(snap.rooms)) S.data.rooms = snap.rooms;
      if (Array.isArray(snap.zones) && snap.zones.length) S.data.zones = snap.zones;
      if (Array.isArray(snap.timetable)) S.data.timetable = snap.timetable;
      if (!S.data.meta.setupAt) S.data.meta.setupAt = Date.now();
    }

    S.data.meta.lastSync = Date.now();
    S.data.meta.serverVersion = snap.version || null;
    if (snap.serverTime) S.data.meta.serverTime = snap.serverTime;
    S.save(true);
    S.emit("sync-state", sync.state());
  }
  sync.mergeSnapshot = mergeSnapshot;
  sync.pullSnapshot = mergeSnapshot;

  // Merge the school's complete activity history into this leader device.
  // Keep unacknowledged local writes until the server confirms them; the
  // server copy wins for records already synchronized.
  function mergeActivity(activity) {
    if (!activity) return;
    const mergeList = (local, remote, limit) => {
      const byId = new Map();
      (remote || []).forEach((item) => {
        if (!item || !item.id) return;
        byId.set(item.id, Object.assign({}, item, { pushed: true, synced: true, origin: "remote" }));
      });
      (local || []).forEach((item) => {
        if (!item || !item.id) return;
        if (!item.pushed && item.origin !== "remote" && !byId.has(item.id)) byId.set(item.id, item);
      });
      return Array.from(byId.values()).sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0)).slice(0, limit);
    };

    S.data.events = mergeList(S.data.events, activity.events, 25000);
    S.data.alerts = mergeList(S.data.alerts, activity.alerts, 10000);
    S.data.covers = mergeList(S.data.covers, activity.covers, 25000);
    S.data.leaves = mergeList(S.data.leaves, activity.leaves, 25000);
    S.data.plans = mergeList(S.data.plans, activity.plans, 25000);
    S.data.marks = mergeList(S.data.marks, activity.marks, 50000);
    const pendingMarkDeletes = new Set((S.data.markDeletes || []).filter((m) => !m.pushed).map((m) => m.id));
    if (pendingMarkDeletes.size) S.data.marks = S.data.marks.filter((m) => !pendingMarkDeletes.has(m.id));
    S.data.audit = mergeList(S.data.audit, activity.audit, 10000);

    const remoteOverrides = activity.overrides || {};
    Object.keys(remoteOverrides).forEach((dateKey) => {
      const localDay = S.data.overrides[dateKey] || {};
      const remoteDay = remoteOverrides[dateKey] || {};
      const mergedDay = Object.assign({}, remoteDay);
      Object.keys(localDay).forEach((key) => {
        const local = localDay[key];
        if (local && !local.pushed && local.origin !== "remote") mergedDay[key] = local;
        else if (mergedDay[key]) mergedDay[key] = Object.assign({}, local || {}, mergedDay[key], { pushed: true, origin: "remote" });
        else if (local) mergedDay[key] = local;
      });
      S.data.overrides[dateKey] = mergedDay;
    });

    const remoteGate = activity.gateLog || {};
    Object.keys(remoteGate).forEach((dateKey) => {
      const localDay = S.data.gateLog[dateKey] || {};
      const remoteDay = remoteGate[dateKey] || {};
      const mergedDay = Object.assign({}, remoteDay);
      Object.keys(localDay).forEach((userId) => {
        const local = localDay[userId];
        if (local && !local.pushed && local.origin !== "remote") mergedDay[userId] = local;
        else if (mergedDay[userId]) mergedDay[userId] = Object.assign({}, local || {}, mergedDay[userId], { pushed: true, origin: "remote" });
        else if (local) mergedDay[userId] = local;
      });
      S.data.gateLog[dateKey] = mergedDay;
    });

    S.data.meta.lastActivitySync = Date.now();
    S.save(true);
    S.emit("sync");
    S.emit("tick");
  }
  sync.mergeActivity = mergeActivity;

  /* ------------------------------------------------------------ bootstrap */
  sync.bootstrap = function () {
    if (!sync._server) return Promise.resolve(false);
    return req("GET", "/api/bootstrap", null, { timeout: 10000 })
      .then((snap) => {
        mergeSnapshot(snap);
        // Teachers are intentionally not permitted to download school-wide
        // activity. A 403 here is expected for teacher accounts.
        return req("GET", "/api/activity", null, { timeout: 15000 })
          .then((activity) => { mergeActivity(activity); return true; })
          .catch((e) => { if (e.status !== 403) sync._lastError = e.message; return true; })
          .then(() => req("GET", "/api/acad", null, { timeout: 15000 }))
          .then((acad) => { mergeAcadSnapshot(acad); return true; })
          .catch(() => true);
      })
      .catch((e) => { sync._lastError = e.message; return false; });
  };

  /* ------------------------------------------------------------- push */
  sync.flush = function () {
    if (!sync._server || !sync._token || sync._pushing) return Promise.resolve(0);
    const ops = pending();
    if (!ops.length) return Promise.resolve(0);
    sync._pushing = true;
    return req("POST", "/api/ops", { device: sync.deviceId(), ops })
      .then((res) => {
        const accepted = new Set((res && Array.isArray(res.accepted)) ? res.accepted : []);
        ops.forEach((op) => { if (accepted.has(op.id)) markPushed(op); });
        // The server may refuse an academic record (wrong class, locked, bad mark).
        // Keep the work on this phone, flag it, and tell the person why.
        ((res && res.rejected) || []).forEach((rj) => {
          const op = ops.find((o) => o.id === rj.id);
          if (!op) return;
          const ac = S.data.acad || {};
          const rec = (op.data.deleted ? ac.deletes : ac[op.data.col] || []).find((x) => x.syncId === op.id);
          if (rec) { rec.pushed = true; rec.rejected = rj.reason || "Refused by the server."; }
          if (CP.toast) CP.toast({ kind: "err", msg: "Not saved: " + (rj.reason || "refused by the server"), ms: 6000 });
        });
        // Server-stamped copies (status, times) replace the local ones.
        if (res && Array.isArray(res.acad)) mergeAcadRecords(res.acad);
        // Keep unacknowledged event IDs in the retry queue. Never discard a
        // local record merely because the server returned HTTP 200.
        S.data.outbox = (S.data.outbox || []).filter((id) => !accepted.has(id));
        sync._lastSync = Date.now();
        S.data.meta.lastSync = sync._lastSync;
        S.save();
        sync._lastError = accepted.size === ops.length ? null : "Some records were not accepted; they remain queued for retry.";
        S.emit("sync-state", sync.state());
        return accepted.size;
      })
      .catch((e) => { sync._lastError = e.message; S.emit("sync-state", sync.state()); return 0; })
      .finally(() => { sync._pushing = false; });
  };

  // Called right after a local write; pushes soon, but never blocks the UI.
  sync.pushLocal = function () {
    if (!sync._server || !sync._token) return;
    clearTimeout(sync._pushTimer);
    sync._pushTimer = setTimeout(() => sync.flush(), 1200);
  };

  sync.syncNow = function () {
    if (!sync._server) return Promise.resolve(false);
    if (!sync._token) {
      return sync.registerDevice().then((ok) => {
        if (!ok) return false;
        return sync.flush().then(() => sync.bootstrap()).then(() => true);
      });
    }
    return sync.flush().then(() => sync.bootstrap()).then(() => true);
  };

  sync.test = function () {
    if (!sync._server) return Promise.resolve(false);
    return req("GET", "/api/health", null, { timeout: 5000 })
      .then(() => { sync._lastError = null; return true; })
      .catch((e) => { sync._lastError = e.message; return false; });
  };

  // Which address does the server see this phone coming from? Used by the
  // office to add the school network without knowing what a CIDR is.
  sync.whoami = function () {
    if (!sync._server) return Promise.resolve(null);
    return req("GET", "/api/whoami", null, { timeout: 6000 }).catch(() => null);
  };

  /* --------------------------------------------------------------- stream */
  function streamPath() {
    const q = "?device=" + encodeURIComponent(sync.deviceId()) + (sync._token ? "&token=" + encodeURIComponent(sync._token) : "");
    return "/api/stream" + q;
  }

  sync.connect = function () {
    if (!sync._server || typeof EventSource === "undefined") return;
    if (sync._es) { try { sync._es.close(); } catch (e) {} sync._es = null; }
    clearTimeout(sync._retryTimer);
    let es;
    try { es = new EventSource(sync._server + streamPath()); }
    catch (e) { sync._scheduleRetry(); return; }
    sync._es = es;

    es.onopen = () => {
      sync._connected = true;
      sync._retry = RETRY_MIN;
      sync._lastError = null;
      sync.setMode("server");
      sync.syncNow().then(() => { if (CP.render) CP.render(); });
    };
    es.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg) return;
      if (msg.type === "op" || msg.type === "ops") {
        (msg.ops || [msg.op]).forEach(applyOp);
        if (CP.session) S.tick();
        if (CP.render && ["pulse", "overview", "home", "staff", "assess", "syllabus", "academics"].indexOf((location.hash || "").split("/")[2]) >= 0) CP.render();
      } else if (msg.type === "hello") {
        if (msg.serverTime) S.data.meta.serverTime = msg.serverTime;
      } else if (msg.type === "config" || msg.type === "setup") {
        // The school's shape changed (timetable, classes, rooms…). Pull it.
        sync.bootstrap().then(() => { if (CP.render) CP.render(); });
      } else if (msg.type === "users") {
        if (msg.action === "delete" && msg.id) {
          S.data.users = S.data.users.filter((u) => u.id !== msg.id);
          S.save();
        } else if (msg.user) {
          const i = S.data.users.findIndex((u) => u.id === msg.user.id);
          if (i >= 0) Object.assign(S.data.users[i], msg.user, { pin: S.data.users[i].pin, pinHash: S.data.users[i].pinHash });
          else S.data.users.push(msg.user);
          S.save();
        }
        if (CP.render) CP.render();
      }
    };
    es.onerror = () => {
      sync._connected = false;
      try { es.close(); } catch (e) {}
      sync._es = null;
      sync.setMode(sync._token ? "offline" : "local");
      sync._scheduleRetry();
    };
  };

  sync._scheduleRetry = function () {
    if (!sync._server) return;
    clearTimeout(sync._retryTimer);
    sync._retryTimer = setTimeout(() => {
      sync._retry = Math.min(RETRY_MAX, Math.round(sync._retry * 1.7));
      sync.connect();
    }, sync._retry);
  };

  sync.disconnect = function () {
    clearTimeout(sync._retryTimer);
    clearTimeout(sync._pushTimer);
    if (sync._es) { try { sync._es.close(); } catch (e) {} sync._es = null; }
    sync._connected = false;
    sync.setMode("local");
  };

  /* ----------------------------------------------------------------- init */
  sync.init = function () {
    sync._server = normalise(CP.storage.get("api", "") || fromServerBase());
    sync._token = CP.storage.get("token", null);

    window.addEventListener("online", () => { if (sync._server) { sync.connect(); sync.syncNow().then(() => { if (CP.render) CP.render(); }); } });
    window.addEventListener("offline", () => {
      sync._connected = false;
      sync.setMode(sync._token ? "offline" : "local");
      S.emit("sync-state", sync.state());
    });

    // Push on every meaningful local write.
    ["event", "alert", "lessons", "reset", "audit", "plan", "marks", "acad"].forEach((evt) => S.on(evt, () => sync.pushLocal()));
    S.on("settings", () => sync.broadcastSettings());

    if (sync._server) {
      sync.test().then((ok) => {
        if (!ok) {
          // Not a real ClassPulse server (static host, native wrapper, etc.).
          // Drop it and run fully local so the app works standalone.
          sync._server = "";
          CP.storage.del("api");
          sync._token = null;
          CP.storage.del("token");
          sync.setMode("local");
          S.emit("sync-state", sync.state());
          if (CP.render) CP.render();
          return;
        }
        sync.setMode(sync._token ? "offline" : "local");
        if (sync._token) sync.connect();
        else sync.registerDevice().then((r) => { if (r) sync.connect(); });
        sync.syncNow().then(() => { if (CP.render) CP.render(); });
      }).catch(() => {
        sync._server = "";
        CP.storage.del("api");
        sync.setMode("local");
        S.emit("sync-state", sync.state());
      });
    } else {
      sync.setMode("local");
    }
  };

  sync.setServer = function (url, opts) {
    sync._server = normalise(url);
    CP.storage.set("api", sync._server);
    if (opts && opts.forgetToken) { sync._token = null; CP.storage.del("token"); }
    sync.disconnect();
    if (!sync._server) { sync.setMode("local"); return Promise.resolve(true); }
    return sync.test().then((ok) => {
      if (!ok) { sync.setMode("local"); return false; }
      return (sync._token ? Promise.resolve(true) : sync.registerDevice()).then((got) => {
        if (got) { sync.connect(); sync.syncNow(); }
        return got;
      });
    });
  };

  /* ---------------------------------------------------- leader edits out */
  // Leaders' edits go through the server's own endpoints so the database and
  // every other phone agree. If there is no server the app is simply local.
  sync.sendOps = function (ops) {
    if (!sync._server || !sync._token || !ops || !ops.length) return Promise.resolve(false);
    return req("POST", "/api/ops", { device: sync.deviceId(), ops })
      .then(() => { sync._lastSync = Date.now(); S.data.meta.lastSync = sync._lastSync; S.save(); return true; })
      .catch((e) => { sync._lastError = e.message; return false; });
  };

  sync.broadcastSettings = function () {
    if (!sync._server || !sync._token) return Promise.resolve(false);
    return sync.pushConfig({ timetable: false });
  };

  sync.broadcastTimetable = function () {
    if (!sync._server || !sync._token) return Promise.resolve(false);
    return sync.pushConfig({ data: { timetable: S.data.timetable } });
  };

  sync.broadcastUser = function (user) {
    if (!sync._server || !sync._token) return Promise.resolve(false);
    return sync.pushUser(user);
  };

  sync.deleteUser = function (user) {
    if (!sync._server || !sync._token) return Promise.resolve(false);
    return sync.pushUser(user, "delete");
  };

  /* --------------------------------------------------------------- ui hook */
  // Small status dot reused by the shell header.
  sync.badge = function () {
    const st = sync.state();
    if (!st.server) return { tone: "dim", label: "local", title: "This phone only" };
    if (st.connected) return { tone: "ok", label: "live", title: "Connected · " + st.server };
    return { tone: "warn", label: "offline", title: "Server unreachable — scans are queued" };
  };
})(window);
