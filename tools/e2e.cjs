/* ==========================================================================
   ClassPulse — tools/e2e.cjs
   End-to-end check of the REAL server: setup wizard -> sign-in -> add staff
   -> build a timetable -> a teacher scans -> the DOS sees it.
   Run the server first:  node server/server.cjs --port 8788 --quiet --db server/test.db
   Then:                  node tools/e2e.cjs http://localhost:8788
   ========================================================================== */
const BASE = (process.argv[2] || "http://localhost:8788").replace(/\/+$/, "");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
async function call(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
  return { status: r.status, data };
}
function digest(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = "cp::" + String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

(async () => {
  console.log("\nClassPulse end-to-end — " + BASE + "\n");

  /* ---------------------------------------------------------------- health */
  let r = await call("GET", "/api/health");
  ok("health responds", r.status === 200 && r.data && r.data.ok, r.data);
  const startedEmpty = r.data && r.data.users === 0;

  /* ---------------------------------------------------------- setup wizard */
  if (startedEmpty) {
    const doc = {
      school: { name: "Test Secondary School", motto: "Strive", term: "Term I 2026", address: "Kampala" },
      settings: {
        schoolStart: "07:30", lateAfter: "08:00", schoolEnd: "15:10",
        periods: [{ n: 1, start: "08:00", end: "08:40" }, { n: 2, start: "08:45", end: "09:25" }],
        breaks: [{ label: "Break", start: "09:25", end: "09:50" }],
      },
      classes: [{ id: "S1A", level: "S1", stream: "A" }, { id: "S1B", level: "S1", stream: "B" }],
      rooms: [
        { id: "gate-main", name: "Main Gate", kind: "gate" },
        { id: "room-S1A", name: "S1A", kind: "class", classId: "S1A" },
        { id: "room-S1B", name: "S1B", kind: "class", classId: "S1B" },
      ],
      zones: [
        { roomId: "gate-main", label: "Main Gate", kind: "gate", code: "GATE", secret: "s-gate" },
        { roomId: "room-S1A", label: "S1A", kind: "class", code: "S1A", secret: "s-s1a" },
        { roomId: "room-S1B", label: "S1B", kind: "class", code: "S1B", secret: "s-s1b" },
      ],
      subjects: ["Mathematics", "English"],
      users: [{
        id: "u-admin", name: "Grace Nabatanzi", role: "admin", staffNo: "ADM-001",
        dept: "Administration", subjects: [], active: true, pin: digest("1234"),
        createdAt: Date.now(), device: null,
      }],
      timetable: [],
    };
    r = await call("POST", "/api/setup", { data: doc });
    ok("setup creates the school", r.status === 200 && r.data.ok, r.data);
    var adminToken = r.data && r.data.token;
    ok("setup returns a session token", !!adminToken);
    ok("setup returns the school", !!(r.data.snapshot && r.data.snapshot.school && r.data.snapshot.school.name));
    ok("setup does not leak PINs", (r.data.snapshot.users || []).every((u) => u.pin === undefined));
  } else {
    console.log("  ..   school already exists; signing in as the administrator");
    r = await call("POST", "/api/login", { staffNo: "ADM-001", pin: "1234" });
    ok("admin can sign in", r.status === 200 && !!r.data.token, r.data);
    var adminToken = r.data && r.data.token;
  }

  /* ------------------------------------------------ setup is now locked */
  r = await call("POST", "/api/setup", { data: { school: { name: "Hijack" } } });
  ok("setup refuses a second run", r.status === 403, r.status);

  /* ---------------------------------------------------------------- login */
  r = await call("POST", "/api/login", { staffNo: "ADM-001", pin: "9999" });
  ok("wrong PIN is rejected", r.status === 401, r.status);
  r = await call("POST", "/api/login", { staffNo: "NOPE", pin: "1234" });
  ok("unknown staff number is rejected", r.status === 401, r.status);

  /* ------------------------------------------------------- leaders: staff */
  r = await call("POST", "/api/users", { user: {
    id: "t-101", name: "Jane Nakato", role: "teacher", staffNo: "T-101",
    dept: "Mathematics", subjects: ["Mathematics"], phone: "", active: true, pin: digest("4821"),
  } }, adminToken);
  ok("admin can add a teacher", r.status === 200 && r.data.ok, r.data);
  r = await call("POST", "/api/users", { user: {
    id: "t-102", name: "Peter Okello", role: "teacher", staffNo: "T-102",
    dept: "Languages", subjects: ["English"], phone: "", active: true,
  } }, adminToken);
  ok("admin can add a teacher with no PIN yet", r.status === 200 && r.data.ok, r.data);
  r = await call("POST", "/api/users", { user: { id: "x", name: "Nobody", staffNo: "X-1" } });
  ok("staff cannot be added without a session", r.status === 401, r.status);

  /* ------------------------------------------------------- staff timetable */
  r = await call("POST", "/api/users", { user: {
    id: "t-103", name: "Sarah Anyango", role: "dos", staffNo: "DOS-001", dept: "Administration", active: true, pin: digest("2222"),
  } }, adminToken);
  ok("admin can add a DOS", r.status === 200, r.data);

  /* ------------------------------------------------------------ timetable */
  const day = ((new Date().getDay() + 6) % 7) + 1; // 1 = Monday
  const period = 1;
  r = await call("POST", "/api/config", { data: {
    timetable: [{ id: `tt-${day}-${period}-S1A`, day, period, classId: "S1A", teacherId: "t-101", subject: "Mathematics", roomId: "room-S1A" }],
  } }, adminToken);
  ok("admin can write the timetable", r.status === 200 && r.data.ok, r.data);
  ok("timetable comes back in the snapshot",
    (r.data.snapshot.timetable || []).some((x) => x.classId === "S1A" && x.teacherId === "t-101"));
  r = await call("POST", "/api/config", { data: { calendar: {
    academicYear: "2026", termStart: "2026-09-01", termEnd: "2026-12-01",
    holidays: [{ name: "Test holiday", date: "2026-11-10" }], events: [],
  } } }, adminToken);
  ok("school calendar is saved centrally", r.status === 200 && r.data.snapshot.calendar && r.data.snapshot.calendar.academicYear === "2026", r.data);

  /* ------------------------------------- teacher with no PIN sets their own */
  r = await call("POST", "/api/login", { staffNo: "T-102", pin: "5555" });
  ok("sign-in without a PIN asks them to choose one", r.status === 409 && r.data.code === "NO_PIN", r.data);
  r = await call("POST", "/api/login", { staffNo: "T-102", pin: "5555", setPin: true });
  ok("they can set their PIN on first sign-in", r.status === 200 && !!r.data.token, r.data);
  const t102 = r.data.token;
  r = await call("POST", "/api/login", { staffNo: "T-102", pin: "5555" });
  ok("and sign in with it afterwards", r.status === 200, r.status);

  /* ------------------------------------------------- teacher signing in */
  r = await call("POST", "/api/login", { staffNo: "t-101", pin: "4821" });
  ok("staff numbers are case-insensitive", r.status === 200 && !!r.data.token, r.data);
  const teacher = r.data.token;
  ok("teacher snapshot has no staff roster", r.data.snapshot.users === undefined);
  ok("teacher snapshot includes zones (needed to verify scans)", Array.isArray(r.data.snapshot.zones));

  /* --------------------------------------------------------- the DOS sees */
  r = await call("POST", "/api/login", { staffNo: "DOS-001", pin: "2222" });
  const dos = r.data.token;
  ok("DOS can sign in", r.status === 200 && !!dos);

  /* ------------------------------------------------------- a real scan */
  const d0 = new Date();
  const todayKey = d0.getFullYear() + "-" + String(d0.getMonth() + 1).padStart(2, "0") + "-" + String(d0.getDate()).padStart(2, "0");
  const evt = {
    id: "ev-1", kind: "class-in", ts: Date.now(), synced: true,
    userId: "t-101", roomId: "room-S1A", roomName: "S1A", period, classId: "S1A", subject: "Mathematics",
  };
  r = await call("POST", "/api/ops", { ops: [
    { kind: "event", id: "ev-1", data: evt },
    { kind: "override", id: todayKey + "|" + period + "|S1A", dateKey: todayKey, key: period + "|S1A", data: { state: "on-time", inAt: "08:02" } },
  ] }, teacher);
  ok("teacher can push a scan", r.status === 200 && r.data.count === 2, r.data);

  r = await call("POST", "/api/ops", { ops: [
    { kind: "plan", id: "pl-1", data: { id: "pl-1", ts: Date.now(), by: "t-101", text: "Offline lesson plan" } },
    { kind: "audit", id: "au-1", data: { id: "au-1", ts: Date.now(), actorId: "t-101", action: "saved-plan" } },
  ] }, teacher);
  ok("teacher lesson plans and audit entries sync", r.status === 200 && r.data.count === 2, r.data);
  r = await call("POST", "/api/ops", { ops: [
    { kind: "mark", id: "mk-op-1", data: { id: "mk-1", syncId: "mk-op-1", classId: "S1A", subject: "Mathematics", student: "Test Student", score: 80, outOf: 100 } },
  ] }, dos);
  ok("leader assessment marks sync", r.status === 200 && r.data.count === 1, r.data);

  // Retrying the same operation after a lost response must not duplicate it.
  r = await call("POST", "/api/ops", { ops: [
    { kind: "event", id: "ev-1", data: evt },
    { kind: "override", id: todayKey + "|" + period + "|S1A", dateKey: todayKey, key: period + "|S1A", data: { state: "on-time", inAt: "08:02" } },
  ] }, teacher);
  ok("retrying an accepted operation is idempotent", r.status === 200 && r.data.count === 0 && r.data.accepted.length === 2, r.data);

  r = await call("GET", "/api/activity", null, dos);
  ok("DOS can download the full activity snapshot", r.status === 200 &&
    (r.data.events || []).some((e) => e.id === "ev-1") &&
    !!(r.data.overrides[todayKey] || {})[period + "|S1A"] &&
    (r.data.plans || []).some((p) => p.id === "pl-1") &&
    (r.data.marks || []).some((m) => m.id === "mk-1") &&
    (r.data.audit || []).some((a) => a.id === "au-1"), r.data && Object.keys(r.data));
  r = await call("GET", "/api/activity", null, teacher);
  ok("teachers cannot download school-wide activity", r.status === 403, r.status);
  r = await call("POST", "/api/device", { device: "unclaimed-phone" });
  const deviceToken = r.data && r.data.token;
  ok("unclaimed phone can register a device token", r.status === 200 && !!deviceToken, r.data);
  r = await call("GET", "/api/bootstrap", null, deviceToken);
  ok("unclaimed devices do not download the staff roster", r.status === 200 && r.data.users === undefined, r.data && Object.keys(r.data));
  r = await call("GET", "/api/activity", null, deviceToken);
  ok("unclaimed devices cannot download school-wide activity", r.status === 403, r.status);

  r = await call("GET", "/api/state", null, dos);
  ok("DOS sees the scan in the day's events", (r.data.events || []).some((e) => e.id === "ev-1"), r.data.events && r.data.events.length);
  ok("DOS sees the lesson override", !!r.data.overrides[period + "|S1A"], Object.keys(r.data.overrides));

  /* ------------------------------------------------------- confidentiality */
  r = await call("GET", "/api/export", null, teacher);
  ok("teachers cannot export the school", r.status === 403, r.status);
  r = await call("GET", "/api/export", null, dos);
  ok("the DOS can export", r.status === 200, r.status);
  r = await call("GET", "/api/export", null, adminToken);
  ok("the administrator can export", r.status === 200, r.status);

  /* ------------------------------------------------------------ cleanup */
  if (process.env.KEEP !== "1") {
    r = await call("POST", "/api/users", { user: { id: "t-103" }, action: "delete" }, adminToken);
    ok("admin can delete a staff member", r.status === 200 && r.data.deleted === "t-103", r.data);
  }

  console.log("\n" + (fail ? "FAILED " : "PASSED ") + pass + " checks, " + fail + " failures\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\n  crash:", e); process.exit(2); });
