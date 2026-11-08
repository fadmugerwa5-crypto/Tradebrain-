/* ==========================================================================
   ClassPulse — store.js
   Offline-first data layer. REAL DATA ONLY.

   Nothing in this file invents history. The school, its staff, rooms, classes,
   subjects and timetable are entered by the school at first run (setup wizard,
   admin screens, or CSV import). Every attendance state a leader sees is
   derived from a scan somebody actually made, in:
     data.gateLog[dateKey][userId]  -> gate in/out
     data.overrides[dateKey][key]   -> classroom in/out per lesson
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const S = (CP.store = {});

  /* ------------------------------------------------------------------ rng */
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rng(seedStr) {
    const r = mulberry32(hashStr(seedStr));
    return {
      next: r,
      int: (a, b) => a + Math.floor(r() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
      float: (a, b) => a + r() * (b - a),
    };
  }
  S.rng = rng;
  S.hashStr = hashStr;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  S.clone = clone;

  /* ------------------------------------------------------------- settings */
  const DEFAULT_SETTINGS = {
    timezone: "Africa/Kampala",
    schoolStart: "07:30",
    lateAfter: "08:00",        // arrival after this is "late"
    lateAfterLessonMin: 3,     // minutes into a lesson before "late"
    missingAfterMin: 5,        // minutes with no teacher before escalation
    escalationMin2: 10,        // -> head teacher
    escalationMin3: 15,        // -> critical
    schoolEnd: "15:10",
    rotateClassQR: true,       // rolling classroom tokens (anti photo-copy)
    rotateSec: 45,
    geofenceMeters: 250,
    requireGeofence: false,
    requireSchoolNetwork: true,  // scan only from the school's own network
    schoolNetworks: [],          // CIDRs / public IP added by the office
    requireGateFirst: true,    // must scan the gate before any classroom scan
    requireDeviceBinding: true,
    allowManualMark: true,
    coverPointsPerLesson: 2,
    latenessWeight: 1,
    smsEnabled: false,
    smsProvider: "africastalking",
    smsSender: "CLASSPULSE",
    dosPhone: "",
    headPhone: "",
    autoEscalate: true,
    soundAlerts: true,
    periods: [
      { n: 1, start: "08:00", end: "08:40" },
      { n: 2, start: "08:45", end: "09:25" },
      { n: 3, start: "09:50", end: "10:30" },
      { n: 4, start: "10:35", end: "11:15" },
      { n: 5, start: "11:20", end: "12:00" },
      { n: 6, start: "13:00", end: "13:40" },
      { n: 7, start: "13:45", end: "14:25" },
      { n: 8, start: "14:30", end: "15:10" },
    ],
    breaks: [
      { label: "Break", start: "09:25", end: "09:50" },
      { label: "Lunch", start: "12:00", end: "13:00" },
    ],
    holidays: [],
    // Academic rules the school can change (Academics → Rules).
    grading: {
      passMark: 50,
      bands: [
        { min: 80, grade: "A", label: "Distinction" },
        { min: 70, grade: "B", label: "Very good" },
        { min: 60, grade: "C", label: "Good" },
        { min: 50, grade: "D", label: "Pass" },
        { min: 40, grade: "E", label: "Weak pass" },
        { min: 0, grade: "F", label: "Fail" },
      ],
    },
    academic: {
      reminderMin: 5,        // lesson reminder, minutes before the bell
      behindPct: 15,         // syllabus this far behind schedule raises an alert
      aheadPct: 10,
      maxLessonsPerDay: 7,   // workload flags
      maxLessonsPerWeek: 30,
      supportBelow: 50,      // a learner averaging under this needs support
      trendDelta: 5,         // percentage points that count as improving / declining
    },
  };
  S.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  /* -------------------------------------------------- suggestion catalogs */
  // These are only *suggestions* the setup wizard and importers pre-fill.
  // They are never written into a school's data unless the school accepts them.
  const SUGGEST = {
    depts: ["Administration", "Sciences", "Mathematics", "Languages", "Humanities", "ICT", "Vocational"],
    subjects: {
      Sciences: ["Biology", "Chemistry", "Physics", "Agriculture"],
      Mathematics: ["Mathematics", "Additional Maths"],
      Languages: ["English", "Literature", "Kiswahili", "French"],
      Humanities: ["History", "Geography", "CRE", "IRE", "Entrepreneurship"],
      ICT: ["Computer Studies", "ICT", "Sub-ICT"],
      Vocational: ["Art & Design", "Music", "PE", "Technology"],
    },
    levels: ["S1", "S2", "S3", "S4", "S5", "S6"],
    streams: ["A", "B"],
  };
  SUGGEST.subjectList = (function () {
    const out = [];
    Object.keys(SUGGEST.subjects).forEach((d) =>
      SUGGEST.subjects[d].forEach((s) => { if (out.indexOf(s) < 0) out.push(s); }));
    return out;
  })();
  S.SUGGEST = SUGGEST;
  S.DEPTS = SUGGEST.depts;

  function defaultClasses() {
    const out = [];
    SUGGEST.levels.forEach((level) => SUGGEST.streams.forEach((stream) =>
      out.push({ id: level + stream, level, stream })));
    return out;
  }
  S.defaultClasses = defaultClasses;

  function defaultRooms(classes) {
    const rooms = [
      { id: "gate-main", name: "Main Gate", building: "Perimeter", kind: "gate" },
      { id: "staffroom", name: "Staff Room", building: "Admin Block", kind: "staff" },
    ];
    (classes || []).forEach((c) =>
      rooms.push({ id: "room-" + c.id, name: c.id, building: "Class Block", kind: "class", classId: c.id }));
    return rooms;
  }
  S.defaultRooms = defaultRooms;

  S.makeZone = function (room, secret) {
    const base = String(room.id).replace(/^room-/, "").toUpperCase();
    return {
      roomId: room.id,
      label: room.name + (room.kind === "gate" ? " — Staff Entry" : ""),
      kind: room.kind,
      secret: secret || CP.uid("zs"),
      active: true,
      code: room.kind === "gate" ? "GATE-" + base.replace(/^GATE-/, "").slice(0, 10)
        : room.kind === "staff" ? "STAFF" : base,
    };
  };

  /* ==================================================================== */
  /*  EMPTY SCHOOL + SETUP                                                 */
  /* ==================================================================== */

  S.empty = function () {
    return {
      version: 2,
      school: { name: "", motto: "", address: "", term: "", logo: "icons/school-logo.svg", centre: { lat: null, lng: null } },
      settings: clone(DEFAULT_SETTINGS),
      users: [],
      classes: [],
      rooms: [],
      zones: [],
      timetable: [],
      overrides: {},
      gateLog: {},
      events: [],
      alerts: [],
      leaves: [],
      covers: [],
      audit: [],
      outbox: [],
      marks: [],
      markDeletes: [],
      plans: [],
      acad: { students: [], syllabus: [], progress: [], assessments: [], markaudit: [], deletes: [] },
      reminded: {},
      calendar: { academicYear: "", termStart: "", termEnd: "", terms: [], holidays: [], events: [] },
      meta: { createdAt: Date.now(), setupAt: null, lastSync: null, secret: CP.uid("sk") },
    };
  };

  // Has the school been configured yet? (setup wizard gate)
  S.needsSetup = function () {
    return !(S.data && S.data.meta && S.data.meta.setupAt) || !(S.data.users || []).length;
  };

  /* cfg = {
       school: {name, motto, address, term, centre:{lat,lng}},
       admin:  {name, staffNo, pin},
       periods:[{n,start,end}], breaks:[{label,start,end}],
       schoolStart, schoolEnd, lateAfter,
       classes:[{id,level,stream}],
       rooms:[{id,name,building,kind,classId}],
       subjects:[names], depts:[names]
     } */
  S.setup = function (cfg) {
    cfg = cfg || {};
    const data = S.empty();
    const st = data.settings;

    Object.assign(data.school, cfg.school || {});
    if (!data.school.name) throw new Error("The school needs a name.");

    if (cfg.periods && cfg.periods.length) st.periods = clone(cfg.periods);
    if (cfg.breaks) st.breaks = clone(cfg.breaks);
    ["schoolStart", "schoolEnd", "lateAfter"].forEach((k) => {
      if (cfg[k]) st[k] = cfg[k];
    });
    if (cfg.settings) Object.assign(st, cfg.settings);

    data.classes = (cfg.classes && cfg.classes.length ? cfg.classes : defaultClasses())
      .map((c) => ({ id: String(c.id).trim(), level: c.level || String(c.id).replace(/\D+$/, ""), stream: c.stream || "" }))
      .filter((c) => c.id);

    data.rooms = (cfg.rooms && cfg.rooms.length ? cfg.rooms : defaultRooms(data.classes))
      .map((r) => ({ id: String(r.id), name: r.name || r.id, building: r.building || "", kind: r.kind || "class", classId: r.classId || null }));
    data.zones = data.rooms
      .filter((r) => r.kind === "gate" || r.kind === "class" || r.kind === "staff")
      .map((r) => S.makeZone(r));

    const a = cfg.admin || {};
    if (!a.name || !a.staffNo || !a.pin) throw new Error("The administrator needs a name, a staff number and a PIN.");
    const admin = {
      id: "u-" + String(a.staffNo).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: String(a.name).trim(),
      role: "admin",
      staffNo: String(a.staffNo).trim(),
      dept: "Administration",
      subjects: [],
      phone: a.phone || "",
      pin: CP.digest(String(a.pin)),
      active: true,
      status: "approved",
      createdAt: Date.now(),
      device: null,
    };
    data.users = [admin];

    data.meta.setupAt = Date.now();
    data.meta.subjects = clone(cfg.subjects || SUGGEST.subjectList);
    data.meta.depts = clone(cfg.depts || SUGGEST.depts);

    S.data = data;
    S.clearGateCache();
    S.save(true);
    S.emit("setup", data);
    return admin;
  };

  /* ---------------------------------------------------------------- registration */
  // Teacher self-registration. Creates a "pending" account locally; the DOS
  // approves it before the teacher can sign in.
  S.registerTeacher = function (cfg) {
    cfg = cfg || {};
    if (!cfg.name || !cfg.staffNo) throw new Error("Name and staff number are required.");
    if (S.data.users.some((u) => String(u.staffNo).toLowerCase() === String(cfg.staffNo).trim().toLowerCase())) {
      throw new Error("That staff number is already registered.");
    }
    const id = "u-" + String(cfg.staffNo).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const user = {
      id,
      name: String(cfg.name).trim(),
      role: "teacher",
      staffNo: String(cfg.staffNo).trim(),
      dept: cfg.dept || "",
      subjects: cfg.subjects || [],
      phone: cfg.phone || "",
      email: cfg.email || "",
      classes: cfg.classes || [],
      pin: cfg.pin ? CP.digest(String(cfg.pin)) : "",
      active: true,
      status: "pending",
      createdAt: Date.now(),
      device: null,
    };
    S.data.users.push(user);
    S.save(true);
    S.emit("users");
    if (CP.sync && CP.sync.pushUser) CP.sync.pushUser(user, "save");
    return user;
  };
  S.approveTeacher = function (id, approved) {
    const u = S.data.users.find((x) => x.id === id);
    if (!u) return false;
    u.status = approved ? "approved" : "rejected";
    S.save(true);
    S.emit("users");
    if (CP.sync && CP.sync.pushUser) CP.sync.pushUser(u, "save");
    return true;
  };
  S.pendingRegistrations = function () {
    return (S.data.users || []).filter((u) => u.status === "pending");
  };
    S.isSchoolDay = function (date) {
    const d = date ? new Date(date) : S.now();
    const day = d.getDay(); // 0 Sun, 6 Sat
    if (day === 0 || day === 6) return false;
    const cal = S.data.calendar || {};
    const key = CP.time.dayKey(d);
    if ((cal.holidays || []).some((h) => h.date === key)) return false;
    return true;
  };

  S.subjects = function () {
    if (S.data && S.data.meta && S.data.meta.subjects && S.data.meta.subjects.length) return S.data.meta.subjects;
    const seen = {};
    (S.data.users || []).forEach((u) => (u.subjects || []).forEach((s) => (seen[s] = 1)));
    (S.data.timetable || []).forEach((r) => { if (r.subject) seen[r.subject] = 1; });
    return Object.keys(seen).sort();
  };

  S.depts = function () {
    if (S.data && S.data.meta && S.data.meta.depts && S.data.meta.depts.length) return S.data.meta.depts;
    return S.DEPTS;
  };

  /* ==================================================================== */
  /*  PERSISTENCE                                                          */
  /* ==================================================================== */
  const KEY = "data";
  let saveTimer = null;
  S.save = function (immediate) {
    clearTimeout(saveTimer);
    const doIt = () => {
      const ok = CP.storage.set(KEY, S.data);
      if (!ok && CP.toast) CP.toast({ kind: "err", msg: "Storage is full — export a backup and reset." });
    };
    if (immediate) doIt();
    else saveTimer = setTimeout(doIt, 250);
  };

  S.load = function () {
    const d = CP.storage.get(KEY, null);
    if (d && d.users && d.settings && d.meta) {
      // forward-compatible: fill any field added since the school's last run
      const base = S.empty();
      return Object.assign(base, d, {
        settings: Object.assign(clone(DEFAULT_SETTINGS), d.settings || {}),
        meta: Object.assign(base.meta, d.meta || {}),
        school: Object.assign(base.school, d.school || {}),
      });
    }
    const blank = S.empty();
    CP.storage.set(KEY, blank);
    return blank;
  };

  S.reset = function () {
    CP.storage.del(KEY);
    S.data = S.load();
    S.clearGateCache();
    S.emit("reset");
  };

  /* ------------------------------------------------------------- emitter */
  const subs = {};
  S.on = function (evt, fn) {
    (subs[evt] = subs[evt] || []).push(fn);
    return () => { subs[evt] = subs[evt].filter((f) => f !== fn); };
  };
  S.emit = function (evt, payload) {
    (subs[evt] || []).forEach((f) => { try { f(payload); } catch (e) { console.error(e); } });
    (subs["*"] || []).forEach((f) => { try { f(evt, payload); } catch (e) {} });
  };

  /* ----------------------------------------------------------------- clock */
  // The real clock. Always. There is no virtual/demo time in ClassPulse.
  S.now = function () { return new Date(); };

  /* ------------------------------------------------------------- lookups */
  S.user = (id) => S.data.users.find((u) => u.id === id) || null;
  S.byStaffNo = function (no) {
    const n = String(no || "").trim().toLowerCase();
    if (!n) return null;
    return S.data.users.find((u) => String(u.staffNo).toLowerCase() === n) || null;
  };
  S.room = (id) => S.data.rooms.find((r) => r.id === id) || null;
  S.zone = (roomId) => S.data.zones.find((z) => z.roomId === roomId) || null;
  S.classInfo = (id) => S.data.classes.find((c) => c.id === id) || { id, level: String(id || "").replace(/\D+$/, "") };
  S.teachers = () => S.data.users.filter((u) => u.role === "teacher");
  S.staff = () => S.data.users.filter((u) => u.role !== "admin");

  S.lesson = function (dateKey, dayOfWeek, period, teacherId) {
    return S.data.timetable.find(
      (r) => r.period === period && r.teacherId === teacherId && r.day === dayOfWeek
    );
  };

  function weekdayNum(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    return wd === 0 ? 7 : wd; // 1=Mon..7=Sun
  }
  S.weekdayNum = weekdayNum;

  /* ==================================================================== */
  /*  LESSON INSTANCES — derived from the timetable + real scans only      */
  /* ==================================================================== */
  S.lk = (dateKey, period, classId) => dateKey + "#" + period + "#" + classId;

  S.instancesForDate = function (dateKey) {
    const wd = weekdayNum(dateKey);
    if (wd > 5) return []; // weekend
    const rows = S.data.timetable.filter((r) => r.day === wd);
    if (!rows.length) return [];

    const overrides = S.data.overrides[dateKey] || {};
    const dayGate = S.data.gateLog[dateKey] || {};
    const gateInUse = Object.keys(dayGate).length > 0;
    const st = S.data.settings;
    const todayKey = CP.time.dayKey(S.now());
    const now = S.now();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const isToday = dateKey === todayKey;
    const isPast = dateKey < todayKey;
    const graceEnd = 8; // minutes after the bell before a lesson is "over"

    return rows.map((r) => {
      const per = st.periods.find((p) => p.n === r.period) || { n: r.period, start: "00:00", end: "00:00" };
      const startM = CP.time.mins(per.start);
      const endM = CP.time.mins(per.end);
      const key = S.lk(dateKey, r.period, r.classId);
      const ov = overrides[key];
      const teacher = S.user(r.teacherId);
      const leave = teacher ? S.onLeave(teacher.id, dateKey) : null;

      const base = {
        key, dateKey, ...r,
        roomName: (S.room(r.roomId) || {}).name || r.roomId,
        teacherName: teacher ? teacher.name : "—",
        start: per.start, end: per.end, startM, endM,
        state: "pending", inAt: null, outAt: null, minsLate: 0,
        method: null, covered: false, coverBy: null, note: null,
        leave: leave ? leave.kind : null,
      };

      // 1. A recorded scan (or a leader's manual mark) always wins.
      if (ov && (ov.inAt || ov.outAt || ov.state)) {
        return Object.assign(base, ov, {
          teacherName: teacher ? teacher.name : "—",
          roomName: (S.room(ov.roomId || r.roomId) || {}).name || r.roomId,
          start: per.start, end: per.end, startM, endM,
        });
      }

      // 2. Approved leave.
      if (leave) { base.state = "leave"; return base; }

      // 3. No record yet — say exactly that, based on the clock.
      if (!isToday && !isPast) { base.state = "pending"; return base; } // future day

      const started = isPast || nowMins >= startM;
      const finished = isPast || nowMins > endM + graceEnd;
      const g = dayGate[r.teacherId];

      if (!started) { base.state = "pending"; return base; }

      if (!g) {
        base.state = gateInUse ? "absent" : "missing";
        base.note = gateInUse ? "No gate arrival recorded." : "No classroom scan recorded.";
        return base;
      }

      if (!finished && nowMins < startM + st.missingAfterMin) { base.state = "pending"; return base; }

      base.state = "missing";
      base.note = "No classroom scan recorded.";
      return base;
    }).sort((a, b) => a.startM - b.startM || String(a.classId).localeCompare(String(b.classId)));
  };

  /* ------------------------------------------------ real gate log only */
  S.dayGateLog = function (dateKey) {
    return Object.assign({}, S.data.gateLog[dateKey] || {});
  };
  S.clearGateCache = function () { /* kept for API compatibility */ };

  S.gateStatus = function (userId, dateKey) {
    return (S.data.gateLog[dateKey] || {})[userId] || null;
  };

  S.gateSummary = function (dateKey) {
    if (weekdayNum(dateKey) > 5) return { total: 0, onTime: 0, late: 0, absent: 0, out: 0, log: {} };
    const st = S.data.settings;
    const log = S.dayGateLog(dateKey);
    const all = S.staff();
    let onTime = 0, late = 0, absent = 0, out = 0;
    all.forEach((u) => {
      const g = log[u.id];
      if (!g) { absent++; return; }
      if (g.mins > CP.time.mins(st.lateAfter)) late++; else onTime++;
      if (g.out) out++;
    });
    return { total: all.length, onTime, late, absent, out, log };
  };

  S.onLeave = function (userId, dateKey) {
    return S.data.leaves.find(
      (l) => l.userId === userId && l.status === "approved" &&
        dateKey >= l.from && dateKey <= l.to
    ) || null;
  };

  /* ---------------------------------------------------------- period info */
  S.periodAt = function (d) {
    const st = S.data.settings;
    const m = d.getHours() * 60 + d.getMinutes();
    for (const b of st.breaks) {
      if (m >= CP.time.mins(b.start) && m < CP.time.mins(b.end)) return { kind: "break", label: b.label, start: b.start, end: b.end };
    }
    for (const p of st.periods) {
      if (m >= CP.time.mins(p.start) && m < CP.time.mins(p.end)) return { kind: "period", ...p };
    }
    return { kind: "off" };
  };
  S.nextPeriod = function (d) {
    const st = S.data.settings;
    const m = d.getHours() * 60 + d.getMinutes();
    return st.periods.find((p) => CP.time.mins(p.start) > m) || null;
  };

  /* ==================================================================== */
  /*  SCHOOL-DATA EDITING (leaders)                                        */
  /* ==================================================================== */

  S.saveUser = function (patch) {
    patch = patch || {};
    let u = patch.id ? S.user(patch.id) : null;
    if (!u) {
      u = {
        id: patch.id || "u-" + String(patch.staffNo || CP.uid("u")).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        createdAt: Date.now(), active: true, subjects: [], device: null,
      };
      S.data.users.push(u);
    }
    const pinRaw = patch.pin != null ? String(patch.pin) : null;
    Object.keys(patch).forEach((k) => { if (k !== "pin") u[k] = patch[k]; });
    if (pinRaw) u.pin = CP.digest(pinRaw);
    if (!u.role) u.role = "teacher";
    if (u.active == null) u.active = true;
    if (!Array.isArray(u.subjects)) u.subjects = [];
    S.save(); S.emit("users");
    if (CP.sync && CP.sync.broadcastUser) CP.sync.broadcastUser(u);
    return u;
  };

  S.deleteUser = function (id) {
    const u = S.user(id);
    if (!u) return false;
    if (u.role === "admin" && S.data.users.filter((x) => x.role === "admin").length <= 1) return false;
    S.data.users = S.data.users.filter((x) => x.id !== id);
    S.data.timetable = S.data.timetable.filter((r) => r.teacherId !== id);
    S.save(); S.emit("users"); S.emit("timetable");
    return true;
  };

  S.saveClass = function (patch) {
    patch = patch || {};
    const id = String(patch.id || "").trim().toUpperCase();
    if (!id) return null;
    let c = S.data.classes.find((x) => x.id === id);
    const isNew = !c;
    if (!c) { c = { id, level: patch.level || id.replace(/\D+$/, ""), stream: patch.stream || "" }; S.data.classes.push(c); }
    Object.assign(c, patch, { id });
    // keep a classroom for every class
    const roomId = "room-" + id;
    if (!S.room(roomId)) {
      S.data.rooms.push({ id: roomId, name: id, building: "Class Block", kind: "class", classId: id });
      const z = S.makeZone(S.room(roomId));
      S.data.zones.push(z);
    }
    S.save(); S.emit("classes");
    return { klass: c, isNew };
  };

  S.deleteClass = function (id) {
    if (!S.data.classes.some((c) => c.id === id)) return false;
    S.data.classes = S.data.classes.filter((c) => c.id !== id);
    const roomId = "room-" + id;
    S.data.rooms = S.data.rooms.filter((r) => r.id !== roomId);
    S.data.zones = S.data.zones.filter((z) => z.roomId !== roomId);
    S.data.timetable = S.data.timetable.filter((r) => r.classId !== id);
    S.save(); S.emit("classes"); S.emit("timetable");
    return true;
  };

  S.saveRoom = function (patch) {
    patch = patch || {};
    const id = String(patch.id || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!id) return null;
    let r = S.room(id);
    if (!r) {
      r = { id, name: patch.name || id, building: patch.building || "", kind: patch.kind || "class", classId: patch.classId || null };
      S.data.rooms.push(r);
    } else {
      Object.assign(r, patch, { id });
    }
    if ((r.kind === "gate" || r.kind === "class" || r.kind === "staff") && !S.zone(id)) {
      S.data.zones.push(S.makeZone(r));
    }
    S.save(); S.emit("rooms");
    return r;
  };

  S.deleteRoom = function (id) {
    if (!S.data.rooms.some((r) => r.id === id)) return false;
    S.data.rooms = S.data.rooms.filter((r) => r.id !== id);
    S.data.zones = S.data.zones.filter((z) => z.roomId !== id);
    S.data.timetable = S.data.timetable.filter((r) => r.roomId !== id);
    S.save(); S.emit("rooms"); S.emit("timetable");
    return true;
  };

  S.saveZone = function (zone) {
    const i = S.data.zones.findIndex((z) => z.roomId === zone.roomId);
    if (i >= 0) S.data.zones[i] = Object.assign(S.data.zones[i], zone);
    else S.data.zones.push(zone);
    S.save(); S.emit("zones");
    return zone;
  };

  S.setPeriods = function (periods, breaks) {
    S.data.settings.periods = clone(periods || []);
    if (breaks) S.data.settings.breaks = clone(breaks);
    S.save();
    S.emit("settings");
    if (CP.sync && CP.sync.broadcastSettings) CP.sync.broadcastSettings();
    return true;
  };

  S.saveSettings = function (patch) {
    Object.assign(S.data.settings, patch || {});
    S.save();
    S.emit("settings");
    if (CP.sync && CP.sync.broadcastSettings) CP.sync.broadcastSettings();
    return S.data.settings;
  };

  S.saveSchool = function (patch) {
    Object.assign(S.data.school, patch || {});
    S.save();
    S.emit("settings");
    if (CP.sync && CP.sync.broadcastSettings) CP.sync.broadcastSettings();
    return S.data.school;
  };

  /* ---------------------------------------------------------- timetable */
  S.setTimetableRow = function (row) {
    row = row || {};
    const day = Number(row.day), period = Number(row.period);
    const classId = String(row.classId || "");
    if (!day || !period || !classId) return null;
    const id = `tt-${day}-${period}-${classId}`;
    const i = S.data.timetable.findIndex((r) => r.id === id);
    const clean = {
      id, day, period, classId,
      teacherId: row.teacherId || null,
      subject: row.subject || "",
      roomId: row.roomId || "room-" + classId,
    };
    if (clean.teacherId && S.clash({ ...clean, id })) return { clash: S.clash({ ...clean, id }) };
    if (i >= 0) S.data.timetable[i] = clean;
    else S.data.timetable.push(clean);
    S.save(); S.emit("timetable");
    return clean;
  };

  S.clearSlot = function (day, period, classId) {
    const id = `tt-${day}-${period}-${classId}`;
    S.data.timetable = S.data.timetable.filter((r) => r.id !== id);
    S.save(); S.emit("timetable");
  };

  // Does this row double-book the teacher, or the room?
  S.clash = function (row) {
    const others = S.data.timetable.filter((r) => r.id !== row.id && r.day === row.day && r.period === row.period);
    for (const o of others) {
      if (row.teacherId && o.teacherId === row.teacherId) {
        return { kind: "teacher", with: S.classInfo(o.classId).id, user: S.user(o.teacherId) };
      }
      if (row.roomId && o.roomId === row.roomId && o.classId !== row.classId) {
        return { kind: "room", with: S.classInfo(o.classId).id, room: S.room(o.roomId) };
      }
    }
    return null;
  };

  S.replaceTimetable = function (rows) {
    S.data.timetable = (rows || []).map((r, i) => ({
      id: r.id || `tt-${r.day}-${r.period}-${r.classId}`,
      day: Number(r.day), period: Number(r.period), classId: String(r.classId),
      teacherId: r.teacherId || null, subject: r.subject || "", roomId: r.roomId || "room-" + r.classId,
    })).filter((r) => r.day && r.period && r.classId);
    S.save(true);
    S.emit("timetable");
    if (CP.sync && CP.sync.broadcastTimetable) CP.sync.broadcastTimetable();
    return S.data.timetable.length;
  };

  /* Auto-build a clash-free timetable from the school's real teachers and
     classes. This writes real rows the school can then edit by hand. */
  S.buildTimetable = function (teachers, classes, periods) {
    teachers = teachers || S.teachers();
    classes = classes || S.data.classes;
    periods = periods || S.data.settings.periods;
    if (!teachers.length || !classes.length || !periods.length) return [];
    const rows = [];
    const days = [1, 2, 3, 4, 5];
    const load = {};
    teachers.forEach((t) => (load[t.id] = 0));
    const totalSlots = days.length * periods.length * classes.length;
    const softCap = Math.max(1, Math.ceil(totalSlots / Math.max(1, teachers.length)));

    days.forEach((day) => {
      const busyTeacher = {};
      periods.forEach((p) => (busyTeacher[p.n] = new Set()));
      classes.forEach((cls) => {
        periods.forEach((p) => {
          const r = rng(`tt:${day}:${cls.id}:${p.n}`);
          let pool = teachers.filter((t) => t.active !== false && !busyTeacher[p.n].has(t.id) && load[t.id] < softCap);
          if (!pool.length) pool = teachers.filter((t) => !busyTeacher[p.n].has(t.id));
          if (!pool.length) return;
          const weighted = pool.map((t) => ({ t, w: softCap - load[t.id] + r.float(0, 2) }))
            .sort((a, b) => b.w - a.w);
          const t = weighted[Math.min(weighted.length - 1, Math.floor(r.float(0, Math.min(4, weighted.length))))].t;
          busyTeacher[p.n].add(t.id);
          load[t.id]++;
          const subs = (t.subjects && t.subjects.length) ? t.subjects : (SUGGEST.subjects[t.dept] || ["General"]);
          const subj = subs[Math.floor(r.float(0, subs.length))] || "General";
          rows.push({
            id: `tt-${day}-${p.n}-${cls.id}`,
            day, period: p.n, classId: cls.id,
            roomId: "room-" + cls.id, teacherId: t.id, subject: subj,
          });
        });
      });
    });
    return rows;
  };

  /* -------------------------------------------------------------- covers */
  S.freeTeachersNow = function (dateKey) {
    const wd = weekdayNum(dateKey);
    const now = S.now();
    const per = S.periodAt(now);
    if (per.kind !== "period") return [];
    const busy = new Set(
      S.data.timetable.filter((r) => r.day === wd && r.period === per.n).map((r) => r.teacherId)
    );
    const log = S.dayGateLog(dateKey);
    return S.teachers()
      .filter((t) => !busy.has(t.id) && log[t.id] && t.active)
      .map((t) => {
        const g = log[t.id];
        return { user: t, load: S.loadToday(t.id, dateKey).length, arrived: g.in, mins: g.mins };
      })
      .sort((a, b) => a.load - b.load);
  };

  S.loadToday = function (userId, dateKey) {
    const wd = weekdayNum(dateKey);
    const ovs = S.data.overrides[dateKey] || {};
    return S.data.timetable.filter((r) => r.day === wd &&
      (r.teacherId === userId || (ovs[S.lk(dateKey, r.period, r.classId)] || {}).coverBy === userId));
  };

  S.coverPoints = function (userId) {
    return CP.sum(S.data.covers.filter((c) => c.coverById === userId), (c) => c.points || 0);
  };

  /* ==================================================================== */
  /*  EVENTS / ALERTS / AUDIT                                              */
  /* ==================================================================== */

  S.setOverride = function (dateKey, key, patch) {
    const o = (S.data.overrides[dateKey] = S.data.overrides[dateKey] || {});
    o[key] = Object.assign({}, o[key] || {}, patch, { live: true, pushed: false, syncId: CP.uid("op") });
    S.save(); S.emit("lessons", dateKey);
  };

  S.pushEvent = function (evt) {
    evt.id = evt.id || CP.uid("ev");
    evt.ts = evt.ts || S.now().getTime();
    evt.synced = CP.online();
    S.data.events.unshift(evt);
    if (S.data.events.length > 800) S.data.events.length = 800;
    if (!evt.synced) S.data.outbox.push(evt.id);
    S.save();
    S.emit("event", evt);
    return evt;
  };

  S.pushAlert = function (alert) {
    const dup = alert.dedupeKey && S.data.alerts.find(
      (a) => a.dedupeKey === alert.dedupeKey && S.now().getTime() - a.ts < 6 * 36e5
    );
    if (dup) return dup;
    alert.id = alert.id || CP.uid("al");
    alert.ts = alert.ts || S.now().getTime();
    alert.read = {};
    S.data.alerts.unshift(alert);
    if (S.data.alerts.length > 300) S.data.alerts.length = 300;
    S.save();
    S.emit("alert", alert);
    return alert;
  };

  S.unreadAlerts = function (userId) {
    const u = S.user(userId);
    if (!u) return [];
    return S.data.alerts.filter(
      (a) => !(a.read || {})[userId] && ((a.audience || []).includes(u.role) || a.byUser === userId)
    );
  };

  S.alertsFor = function (user) {
    return S.data.alerts.filter((a) => (a.audience || []).includes(user.role) || a.byUser === user.id);
  };

  S.audit = function (actorId, action, detail) {
    const entry = { id: CP.uid("au"), ts: S.now().getTime(), actorId, action, detail, pushed: false };
    S.data.audit.unshift(entry);
    if (S.data.audit.length > 10000) S.data.audit.length = 10000;
    S.save();
    S.emit("audit", entry);
  };

  /* ================================================================== */
  /*  LIVE SCAN ACTIONS                                                 */
  /* ================================================================== */

  // Verify a scanned payload. Supports static and rolling tokens.
  // payload: "CP1|<roomId>|<slot>|<sig>"
  S.parseQr = function (raw) {
    const parts = String(raw || "").trim().split("|");
    if (parts[0] !== "CP1") return null;
    const zone = S.data.zones.find((z) => z.roomId === parts[1]);
    if (!zone) return null;
    const slot = parts.length >= 4 ? parseInt(parts[2], 10) : 0;
    const sig = parts.length >= 4 ? parts[3] : parts[2];
    const expect = (s) => CP.digest(zone.roomId + "|" + s + "|" + zone.secret);
    const okSlot = (sl) => sig === expect(String(sl));
    if (!okSlot(slot)) {
      if (!(zone.rotateSec && (okSlot(slot - 1) || okSlot(slot + 1)))) {
        return { zone, valid: false, reason: "Invalid or expired code" };
      }
    }
    return { zone, slot, valid: true };
  };

  S.qrPayload = function (roomId, when) {
    const zone = S.zone(roomId);
    if (!zone) return "";
    const d = when || S.now();
    const slot = zone.rotateSec ? Math.floor(d.getTime() / 1000 / zone.rotateSec) : 0;
    const sig = CP.digest(zone.roomId + "|" + slot + "|" + zone.secret);
    return "CP1|" + zone.roomId + "|" + slot + "|" + sig;
  };

  // Gate arrival / departure
  S.gateScan = function (userId, zone, opts) {
    opts = opts || {};
    const dateKey = CP.time.dayKey(S.now());
    const now = S.now();
    const mins = now.getHours() * 60 + now.getMinutes();
    const log = (S.data.gateLog[dateKey] = S.data.gateLog[dateKey] || {});
    const cur = log[userId];
    const st = S.data.settings;
    const lateAfter = CP.time.mins(st.lateAfter);
    const me = S.user(userId);

    let kind, res;
    if (!cur || !cur.in) {
      kind = "gate-in";
      log[userId] = {
        in: CP.time.fromMins(mins), mins, method: opts.method || "qr",
        lat: opts.lat || null, lng: opts.lng || null, offline: !!opts.offline,
        zoneId: zone.roomId, scanId: opts.scanId || null, pushed: false,
      };
      const late = mins > lateAfter;
      res = { kind, status: late ? "late" : "on-time", mins, lateBy: late ? mins - lateAfter : 0 };
      S.pushAlert({
        dedupeKey: "late:" + userId + ":" + dateKey,
        level: late ? "warn" : "info",
        audience: late ? ["dos", "head"] : [],
        title: late ? "Late arrival" : "Arrival",
        body: (me ? me.name : "Staff") + (late ? ` arrived ${mins - lateAfter} min late (${CP.time.ampm(now)}).` : ` checked in at ${CP.time.ampm(now)}.`),
        ref: { userId, dateKey },
      });
    } else if (!cur.out) {
      kind = "gate-out";
      cur.out = CP.time.fromMins(mins);
      cur.offline = cur.offline || !!opts.offline;
      cur.scanId = opts.scanId || cur.scanId || null;
      cur.pushed = false;
      const endM = CP.time.mins(st.schoolEnd);
      const early = mins < endM - 20;
      res = { kind, status: early ? "early" : "ok", mins };
      if (early) {
        S.pushAlert({
          dedupeKey: "earlyout:" + userId + ":" + dateKey,
          level: "warn", audience: ["dos", "head"],
          title: "Early departure",
          body: `${me ? me.name : "Staff"} checked out at ${CP.time.ampm(now)} — ${endM - mins} min before close.`,
          ref: { userId, dateKey },
        });
      }
    } else {
      return { kind: "dupe", status: "dupe", message: "You are already checked out for today." };
    }

    S.pushEvent({
      userId, kind, roomId: zone.roomId, roomName: zone.label,
      lat: opts.lat, lng: opts.lng, method: opts.method || "qr", offline: !!opts.offline,
      scanId: opts.scanId || null, verified: !!opts.scanId,
    });
    S.save();
    return res;
  };

  // Classroom in / out
  S.classScan = function (userId, zone, opts) {
    opts = opts || {};
    const now = S.now();
    const dateKey = opts.dateKey || CP.time.dayKey(now);
    const wd = weekdayNum(dateKey);
    const m = now.getHours() * 60 + now.getMinutes();
    const st = S.data.settings;
    const perMins = (n) => {
      const p = st.periods.find((x) => x.n === n);
      return p ? { start: CP.time.mins(p.start), end: CP.time.mins(p.end) } : null;
    };

    // Which lesson does this teacher own in this room right now?
    let row = S.data.timetable.find((r) => {
      if (r.day !== wd || r.teacherId !== userId || r.roomId !== zone.roomId) return false;
      const pm = perMins(r.period);
      return pm && m >= pm.start - 12 && m <= pm.end + 6;
    });
    if (!row) {
      row = S.data.timetable.find((r) => r.day === wd && r.teacherId === userId && r.roomId === zone.roomId);
    }
    if (!row) {
      return { ok: false, reason: "You have no lesson in " + zone.label + " right now.", code: "NO_LESSON" };
    }
    const pm = perMins(row.period) || { start: m, end: m };
    const startM = pm.start;
    const endM = pm.end;
    const key = S.lk(dateKey, row.period, row.classId);
    const ov = (S.data.overrides[dateKey] || {})[key] || {};
    const isIn = !!ov.inAt;
    const isOut = !!ov.outAt;

    if ((ov.state === "covered" || ov.coverBy) && !isIn && opts.method !== "manual") {
      return { ok: false, reason: "This lesson is covered by another teacher.", code: "COVERED" };
    }

    // Gate first: a classroom scan only counts once the person has checked in
    // at the gate today. A photo of the classroom poster cannot prove that.
    if (st.requireGateFirst && opts.method !== "manual" && opts.method !== "sim") {
      const gate = (S.data.gateLog[dateKey] || {})[userId];
      if (!gate || !gate.in) {
        return {
          ok: false,
          code: "NO_GATE",
          reason: "Scan the gate code first, then this classroom code.",
        };
      }
    }

    if (!isIn) {
      const lateBy = m - startM;
      const late = lateBy > st.lateAfterLessonMin;
      const inAt = CP.time.fromMins(m);
      S.setOverride(dateKey, key, {
        state: late ? "late" : "on-time", inAt, minsLate: late ? lateBy : 0,
        method: opts.method || "qr", covered: !!ov.covered, coverBy: ov.coverBy || null,
        note: null, roomId: zone.roomId, scanId: opts.scanId || null, verified: !!opts.scanId,
      });
      S.pushEvent({
        userId, kind: "class-in", roomId: zone.roomId, roomName: zone.label,
        period: row.period, classId: row.classId, subject: row.subject,
        lat: opts.lat, lng: opts.lng, method: opts.method || "qr", offline: !!opts.offline,
        scanId: opts.scanId || null, verified: !!opts.scanId,
      });
      if (late) {
        S.pushAlert({
          dedupeKey: "latelesson:" + key + ":" + userId,
          level: lateBy > 10 ? "danger" : "warn",
          audience: ["dos"],
          title: "Late into lesson",
          body: `${S.user(userId).name} started ${row.subject} for ${row.classId} ${lateBy} min late (P${row.period}, ${zone.label}).`,
          ref: { userId, dateKey, key },
        });
      }
      S.save();
      return { ok: true, kind: "class-in", period: row.period, classId: row.classId, subject: row.subject, status: late ? "late" : "on-time", lateBy: late ? lateBy : 0, at: inAt };
    }

    if (!isOut) {
      const early = m < endM - 5;
      S.setOverride(dateKey, key, { outAt: CP.time.fromMins(m), scanId: opts.scanId || null, verified: !!opts.scanId });
      S.pushEvent({
        userId, kind: "class-out", roomId: zone.roomId, roomName: zone.label,
        period: row.period, classId: row.classId, method: opts.method || "qr", offline: !!opts.offline,
        scanId: opts.scanId || null, verified: !!opts.scanId,
      });
      if (early && m < endM - 8) {
        S.pushAlert({
          dedupeKey: "abandon:" + key + ":" + userId,
          level: "warn", audience: ["dos"],
          title: "Lesson left early",
          body: `${S.user(userId).name} left ${row.classId} ${endM - m} min before the end of P${row.period}.`,
          ref: { userId, dateKey, key },
        });
      }
      S.save();
      return { ok: true, kind: "class-out", period: row.period, classId: row.classId, at: CP.time.fromMins(m), early };
    }
    return { ok: false, reason: "Already checked out of this lesson.", code: "DUP" };
  };

  S.manualMark = function (dateKey, key, patch, actorId) {
    S.setOverride(dateKey, key, Object.assign({}, patch, { method: "manual" }));
    S.audit(actorId, "manual-mark", { key, patch });
    S.emit("lessons", dateKey);
  };

  S.assignCover = function (dateKey, key, coverById, actorId) {
    const inst = S.instancesForDate(dateKey).find((i) => i.key === key);
    if (!inst) return null;
    const nowMins = S.now().getHours() * 60 + S.now().getMinutes();
    S.setOverride(dateKey, key, {
      state: "covered", covered: true, coverBy: coverById, coverAt: S.now().getTime(),
      inAt: CP.time.fromMins(Math.max(inst.startM, nowMins)),
      note: "Cover assigned", method: "manual",
    });
    S.data.covers.unshift({
      id: CP.uid("cv"), dateKey, key, roomId: inst.roomId, classId: inst.classId,
      period: inst.period, absentId: inst.teacherId, coverById,
      points: S.data.settings.coverPointsPerLesson, ts: S.now().getTime(), by: actorId,
    });
    S.audit(actorId, "assign-cover", { key, coverById });
    S.pushAlert({
      level: "info", audience: ["teacher"], byUser: coverById,
      title: "Cover duty assigned",
      body: `You are covering ${inst.subject} for ${inst.classId} (P${inst.period}) in ${inst.roomName}.`,
      ref: { key },
    });
    S.save();
    S.emit("lessons", dateKey);
    return true;
  };

  /* ---------------------------------------------------------- analytics -- */
  S.dayStats = function (dateKey) {
    const inst = S.instancesForDate(dateKey);
    const g = S.gateSummary(dateKey);
    const taught = inst.filter((i) => ["on-time", "late", "covered"].includes(i.state)).length;
    const missed = inst.filter((i) => i.state === "missing" || i.state === "absent").length;
    const late = inst.filter((i) => i.state === "late").length;
    const onTime = inst.filter((i) => i.state === "on-time").length;
    const countable = inst.filter((i) => i.state !== "leave").length;
    return {
      dateKey, gate: g, lessons: inst.length, countable,
      taught, missed, late, onTime,
      coverage: CP.pct(taught, countable),
      punctuality: CP.pct(onTime, Math.max(1, taught)),
      gateRate: CP.pct(g.total - g.absent, g.total),
      gateOnTimeRate: CP.pct(g.onTime, g.total),
      present: g.total - g.absent,
    };
  };

  S.rangeStats = function (days, endKey) {
    const out = [];
    const end = endKey ? parseKey(endKey) : S.now();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const k = CP.time.dayKey(d);
      if (weekdayNum(k) > 5) continue;
      out.push(S.dayStats(k));
    }
    return out;
  };

  S.teacherStats = function (userId, days) {
    days = days || 30;
    const end = S.now();
    const rows = [];
    let lateGate = 0, absent = 0, lessons = 0, onTime = 0, lateL = 0, missed = 0, taught = 0, outEarly = 0, totalLateMin = 0;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const k = CP.time.dayKey(d);
      if (weekdayNum(k) > 5) continue;
      const g = S.dayGateLog(k)[userId];
      const mine = S.instancesForDate(k).filter((x) => x.teacherId === userId && x.state !== "leave" && x.state !== "pending");
      lessons += mine.length;
      mine.forEach((l) => {
        if (l.state === "on-time") { onTime++; taught++; }
        else if (l.state === "late") { lateL++; taught++; }
        else if (l.state === "covered") taught++;
        else if (l.state === "missing" || l.state === "absent") missed++;
      });
      if (!g) {
        // No arrival at all. Only a work day if they had lessons that day.
        if (mine.length) { absent++; rows.push({ dateKey: k, state: "absent" }); }
        continue;
      }
      const lateBy = Math.max(0, g.mins - CP.time.mins(S.data.settings.lateAfter));
      if (lateBy > 0) { lateGate++; totalLateMin += lateBy; }
      if (g.out && CP.time.mins(g.out) < CP.time.mins(S.data.settings.schoolEnd) - 20) outEarly++;
      rows.push({ dateKey: k, gate: g, lateBy, state: lateBy ? "late" : "on-time" });
    }
    const workDays = rows.length;
    return {
      userId, days, workDays,
      present: workDays - absent, absent, lateGate, totalLateMin,
      avgLateBy: lateGate ? Math.round(totalLateMin / lateGate) : 0,
      outEarly, lessons, taught, onTime, lateLessons: lateL, missedLessons: missed,
      punctuality: CP.pct(onTime, Math.max(1, onTime + lateL)),
      coverage: CP.pct(taught, Math.max(1, taught + missed)),
      gatePunctuality: CP.pct(workDays - absent - lateGate, Math.max(1, workDays)),
      attendanceRate: CP.pct(workDays - absent, Math.max(1, workDays)),
      points: S.coverPoints(userId),
      daily: rows,
    };
  };

  function parseKey(k) {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  S.parseKey = parseKey;

  /* --------------------------------------------------- alert engine tick */
  S.tick = function () {
    const st = S.data.settings;
    const dateKey = CP.time.dayKey(S.now());
    const m = S.now().getHours() * 60 + S.now().getMinutes();
    const list = S.instancesForDate(dateKey);
    let created = 0;
    list.forEach((i) => {
      if (i.state !== "missing" && i.state !== "absent") return;
      const into = m - i.startM;
      if (into < st.missingAfterMin) return;
      const lvl = into >= st.escalationMin3 ? "danger" : into >= st.escalationMin2 ? "warn" : "info";
      const audience = into >= st.escalationMin2 ? ["dos", "head"] : ["dos"];
      const a = S.pushAlert({
        dedupeKey: "miss:" + i.key,
        level: lvl, audience,
        title: "No teacher in " + i.roomName,
        body: `${i.classId} · P${i.period} ${i.subject} — ${i.teacherName} has not been recorded. ${into} min into the lesson.`,
        ref: { key: i.key, userId: i.teacherId },
        actions: ["assign-cover"],
      });
      if (a && a.ts && S.now().getTime() - a.ts < 1000) created++;
    });
    if (created) S.emit("alerts-tick");
    return created;
  };

  /* -------------------------------------------------------- notification */
  S.markAlertsRead = function (userId) {
    const u = S.user(userId);
    if (!u) return;
    S.data.alerts.forEach((a) => {
      if ((a.audience || []).includes(u.role) || a.byUser === userId) a.read[userId] = true;
    });
    S.save(); S.emit("alerts");
  };

  /* ==================================================================== */
  /*  CSV / JSON                                                            */
  /* ==================================================================== */
  // Minimal, dependency-free CSV reader: handles quotes, commas, CRLF, BOM.
  S.parseCsv = function (text) {
    const s = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* ignore */ }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  };

  S.csvObjects = function (text) {
    const rows = S.parseCsv(text);
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((h) => String(h).trim());
    const out = rows.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, i) => (o[h] = r[i] != null ? String(r[i]).trim() : ""));
      return o;
    });
    return { headers, rows: out };
  };

  S.toCsv = function (rows) {
    if (!rows || !rows.length) return "";
    const heads = Object.keys(rows[0]);
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [heads.join(",")].concat(rows.map((r) => heads.map((h) => esc(r[h])).join(","))).join("\r\n");
  };

  const STAFF_TEMPLATE =
    "name,staffNo,role,department,subjects,phone,pin\n" +
    "Jane Nakato,T-101,teacher,Mathematics,Mathematics;Additional Maths,0770000001,4821\n" +
    "Peter Okello,DOS-002,dos,Sciences,Biology,0770000002,5190\n" +
    "Sarah Anyango,HT-002,head,Administration,,0770000003,7310\n";
  S.staffTemplate = () => STAFF_TEMPLATE;

  const TT_TEMPLATE =
    "day,period,class,subject,teacher,room\n" +
    "1,1,S1A,Mathematics,T-101,S1A\n" +
    "1,1,S1B,English,T-102,S1B\n" +
    "1,2,S1A,English,T-102,S1A\n";
  S.timetableTemplate = () => TT_TEMPLATE;

  // Roles accept friendly words as well as the internal keys.
  function normRole(r) {
    const s = String(r || "").trim().toLowerCase();
    if (s === "teacher" || s === "t" || s === "tr") return "teacher";
    if (s === "dos" || s === "director of studies") return "dos";
    if (s === "head" || s === "head teacher" || s === "headteacher" || s === "ht") return "head";
    if (s === "admin" || s === "administrator" || s === "ict") return "admin";
    return "teacher";
  }
  S.normRole = normRole;

  /* Import staff. Returns {added, updated, errors:[]} */
  S.importStaffCsv = function (text) {
    const { rows } = S.csvObjects(text);
    const res = { added: 0, updated: 0, errors: [] };
    rows.forEach((r, i) => {
      const line = i + 2;
      const name = r.name || r.Name || r["full name"] || r["Full Name"];
      const staffNo = r.staffNo || r["staff number"] || r.staffno || r["Staff No"] || r["staff no"];
      if (!name || !staffNo) { res.errors.push(`Line ${line}: needs at least name and staffNo.`); return; }
      const role = normRole(r.role || r.Role);
      const dept = r.department || r.dept || r.Department || "";
      const subs = String(r.subjects || r.Subjects || "").split(/[;,/]/).map((x) => x.trim()).filter(Boolean);
      const pin = String(r.pin || r.PIN || "").trim();
      if (pin && !/^\d{4,8}$/.test(pin)) { res.errors.push(`Line ${line}: PIN must be 4-8 digits.`); return; }
      const existing = S.byStaffNo(staffNo);
      const patch = {
        id: existing ? existing.id : undefined,
        name: String(name).trim(), staffNo: String(staffNo).trim(), role,
        dept: dept || (role === "teacher" ? "" : "Administration"),
        subjects: subs, phone: String(r.phone || r.Phone || "").trim(),
      };
      if (pin) patch.pin = pin;
      S.saveUser(patch);
      if (existing) res.updated++; else res.added++;
    });
    S.save(true);
    return res;
  };

  /* Import a timetable. day = 1..5 (Mon..Fri) or Mon..Fri text.
     teacher = staff number or id. class = class id. room = room id or name. */
  const DAYS = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5 };
  S.importTimetableCsv = function (text, opts) {
    opts = opts || {};
    const { rows } = S.csvObjects(text);
    const res = { added: 0, skipped: 0, errors: [], clashes: [] };
    const map = {};
    if (!opts.replace) S.data.timetable.forEach((r) => { map[r.id] = r; });

    rows.forEach((r, i) => {
      const line = i + 2;
      const dayRaw = String(r.day || r.Day || "").trim().toLowerCase();
      const day = /^\d+$/.test(dayRaw) ? Number(dayRaw) : DAYS[dayRaw];
      const period = Number(r.period || r.Period);
      const classId = String(r.class || r.Class || "").trim().toUpperCase();
      if (!day || !period || !classId) { res.errors.push(`Line ${line}: needs day, period and class.`); return; }
      if (!S.data.classes.some((c) => c.id === classId)) { res.errors.push(`Line ${line}: unknown class "${classId}".`); return; }
      const tRef = String(r.teacher || r.Teacher || "").trim();
      const teacher = S.byStaffNo(tRef) || S.user(tRef) || null;
      if (tRef && !teacher) { res.errors.push(`Line ${line}: unknown teacher "${tRef}".`); return; }
      const roomRef = String(r.room || r.Room || "").trim();
      const room = roomRef
        ? (S.room(roomRef) || S.data.rooms.find((x) => x.name.toLowerCase() === roomRef.toLowerCase()) || null)
        : null;
      const id = `tt-${day}-${period}-${classId}`;
      const row = {
        id, day, period, classId,
        teacherId: teacher ? teacher.id : null,
        subject: String(r.subject || r.Subject || "").trim(),
        roomId: room ? room.id : "room-" + classId,
      };
      const clash = S.clash(row);
      if (clash) res.clashes.push(`Line ${line}: ${teacher ? teacher.name : "teacher"} / ${clash.kind} clash with ${clash.with}.`);
      map[id] = row;
      res.added++;
    });

    const clean = Object.keys(map).map((k) => map[k]);
    if (!opts.dryRun) S.replaceTimetable(clean);
    return res;
  };

  S.exportCsv = function (rows, filename) {
    if (!rows || !rows.length) return;
    download(new Blob(["\uFEFF" + S.toCsv(rows)], { type: "text/csv;charset=utf-8" }), filename || "classpulse.csv");
  };

  S.exportJson = function (filename) {
    download(new Blob([JSON.stringify(S.data, null, 2)], { type: "application/json" }), filename || "classpulse-backup.json");
  };

  S.importJson = function (text) {
    const d = JSON.parse(text);
    if (!d || !d.settings || !Array.isArray(d.users)) throw new Error("Not a ClassPulse backup");
    S.data = Object.assign(S.empty(), d);
    S.clearGateCache();
    S.save(true);
    S.emit("reset");
    return true;
  };

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  S.download = download;
})(window);
