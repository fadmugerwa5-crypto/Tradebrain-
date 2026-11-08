/* ==========================================================================
   ClassPulse — tools/scan-test.cjs
   Checks the anti-photo scan rules against a real server:
     • a code is verified by the server, not invented on the phone
     • a code can only be redeemed once per rotation window
     • school-network-only refuses traffic from outside
     • gate scan must happen before a classroom scan
     • a record without a server-issued grant is dropped
   Self-contained: starts its own server on port 8790, then shuts it down.
   Run:  node tools/scan-test.cjs
   ========================================================================== */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 8790;
const BASE = "http://localhost:" + PORT;
const DB = path.join(__dirname, "..", "server", "scan-test.db");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
async function call(method, p, body, token, headers) {
  const r = await fetch(BASE + p, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" },
      token ? { Authorization: "Bearer " + token } : {}, headers || {}),
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
function code(roomId, secret, slot) {
  const s = slot || 0;
  return "CP1|" + roomId + "|" + s + "|" + digest(roomId + "|" + s + "|" + secret);
}
function dayKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function rm(file) {
  for (const f of [file, file + "-wal", file + "-shm"]) {
    try { fs.unlinkSync(f); } catch (e) {}
  }
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

(async () => {
  console.log("\nClassPulse scan-integrity check\n");
  rm(DB);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.cjs"),
    "--port", String(PORT), "--quiet", "--db", DB], { stdio: "ignore" });
  let exitCode = 0;

  try {
    if (!(await waitForServer())) throw new Error("server did not start on " + PORT);

    const settings = {
      schoolStart: "07:30", lateAfter: "08:00", schoolEnd: "15:10",
      periods: [{ n: 1, start: "08:00", end: "08:40" }],
      rotateClassQR: false, rotateSec: 45,
      requireSchoolNetwork: true, schoolNetworks: [],
      requireGateFirst: true, requireGeofence: false,
      missingAfterMin: 5, escalationMin2: 10, escalationMin3: 15,
    };
    const doc = {
      school: { name: "Scan Test School", term: "Term I", centre: {} },
      settings,
      classes: [{ id: "S1A", level: "S1", stream: "A" }],
      rooms: [
        { id: "gate-main", name: "Main Gate", kind: "gate" },
        { id: "room-S1A", name: "S1A", kind: "class", classId: "S1A" },
      ],
      zones: [
        { roomId: "gate-main", label: "Main Gate", kind: "gate", code: "GATE", secret: "s-gate" },
        { roomId: "room-S1A", label: "S1A", kind: "class", code: "S1A", secret: "s-s1a" },
      ],
      subjects: ["Mathematics"],
      users: [{
        id: "u-admin", name: "Admin", role: "admin", staffNo: "ADM-001",
        active: true, pin: digest("1234"), subjects: [],
      }],
      timetable: [],
    };
    let r = await call("POST", "/api/setup", { data: doc });
    ok("setup creates the school", r.status === 200 && r.data.ok, r.data);
    const adminToken = r.data.token;

    // Teacher account, created by the office.
    r = await call("POST", "/api/users", {
      user: { id: "u-t1", name: "Teacher One", role: "teacher", staffNo: "T-001", active: true, pin: digest("1234") },
    }, adminToken);
    ok("office adds a teacher", r.status === 200 && r.data.ok, r.data);

    const t = await call("POST", "/api/login", { staffNo: "T-001", pin: "1234", device: "dev-t1" });
    ok("teacher signs in", t.status === 200 && !!t.data.token, t.data);
    const tToken = t.data.token;
    const dateKey = dayKey(new Date());

    // 1. A phone outside the school network cannot even read a code.
    r = await call("POST", "/api/scan",
      { roomId: "room-S1A", code: code("room-S1A", "s-s1a") }, tToken,
      { "X-Forwarded-For": "8.8.8.8" });
    ok("scan from outside the school network is refused", r.status === 403 && r.data.code === "OFF_NETWORK", r.data);

    // 2. No gate scan yet, so a classroom scan is refused.
    r = await call("POST", "/api/scan", { roomId: "room-S1A", code: code("room-S1A", "s-s1a") }, tToken);
    ok("classroom scan before gate is refused", r.status === 403 && r.data.code === "NO_GATE", r.data);

    // 3. Gate code is accepted and produces a grant.
    r = await call("POST", "/api/scan", { roomId: "gate-main", code: code("gate-main", "s-gate") }, tToken);
    ok("gate scan is accepted", r.status === 200 && r.data.ok && !!r.data.scanId, r.data);
    const gateGrant = r.data.scanId;

    // 4. The gate record only lands because it quotes that grant.
    r = await call("POST", "/api/ops", { ops: [{
      id: "gate-1", kind: "gate", dateKey, userId: "u-t1",
      data: { in: "07:45", mins: 465, method: "qr", scanId: gateGrant, zoneId: "gate-main" },
    }] }, tToken);
    ok("gate record with a real grant is stored", r.data.count === 1, r.data);

    // 5. A hand-written gate record without a grant is dropped.
    r = await call("POST", "/api/ops", { ops: [{
      id: "gate-forged", kind: "gate", dateKey, userId: "u-t1",
      data: { in: "08:30", mins: 510, method: "qr", zoneId: "gate-main" },
    }] }, tToken);
    ok("gate record without a grant is dropped", r.data.count === 0, r.data);

    // 6. Now the classroom scan is allowed.
    r = await call("POST", "/api/scan", { roomId: "room-S1A", code: code("room-S1A", "s-s1a") }, tToken);
    ok("classroom scan after arrival is accepted", r.status === 200 && !!r.data.scanId, r.data);
    const classGrant = r.data.scanId;

    // 7. The same code cannot be redeemed again in the same window.
    r = await call("POST", "/api/scan", { roomId: "room-S1A", code: code("room-S1A", "s-s1a") }, tToken);
    ok("replaying the same code is refused", r.status === 409 && r.data.code === "REPLAY", r.data);

    // 8. A made-up code is refused.
    r = await call("POST", "/api/scan",
      { roomId: "room-S1A", code: "CP1|room-S1A|0|deadbeefdeadbeef" }, tToken);
    ok("a made-up code is refused", r.status === 403 && r.data.code === "BAD_CODE", r.data);

    // 8b. The office can ask "which address do you see me from?" and gets a
    // straight answer: this one is inside the school.
    r = await call("GET", "/api/whoami");
    ok("whoami reports the caller's address", r.status === 200 && !!r.data.ip, r.data);
    ok("whoami says a school-side request is allowed", r.data.onSchoolNetwork === true, r.data);

    // 8c. The same question asked through a tunnel reports the phone's real
    // public address, and says it would be refused.
    r = await call("GET", "/api/whoami", null, null, { "CF-Connecting-IP": "8.8.8.8" });
    ok("whoami sees a public address through a tunnel", r.data.ip === "8.8.8.8", r.data);
    ok("whoami refuses a public address", r.data.onSchoolNetwork === false, r.data);

    // 9. The classroom record with the real grant is accepted and marked verified.
    r = await call("POST", "/api/ops", { ops: [{
      id: "ov-1", kind: "override", dateKey, key: "P1|S1A",
      data: { state: "on-time", inAt: "08:02", method: "qr", roomId: "room-S1A", scanId: classGrant },
    }] }, tToken);
    ok("classroom record with a real grant is accepted", r.data.count === 1, r.data);

    const st = await call("GET", "/api/state?date=" + dateKey, null, adminToken);
    const ov = st.data.overrides && st.data.overrides["P1|S1A"];
    ok("stored record is marked server-verified", !!(ov && ov.verified), ov);
    ok("gate log reached the server", !!(st.data.gateLog && st.data.gateLog["u-t1"] && st.data.gateLog["u-t1"].in), st.data.gateLog);

    // 10. A classroom record with no grant is dropped.
    r = await call("POST", "/api/ops", { ops: [{
      id: "ov-2", kind: "override", dateKey, key: "P1|S1B",
      data: { state: "on-time", inAt: "08:05", method: "qr", roomId: "room-S1A" },
    }] }, tToken);
    ok("classroom record without a grant is dropped", r.data.count === 0, r.data);

    // 11. A teacher cannot mark a lesson by hand.
    r = await call("POST", "/api/ops", { ops: [{
      id: "ov-3", kind: "override", dateKey, key: "P1|S1C",
      data: { state: "on-time", inAt: "08:05", method: "manual" },
    }] }, tToken);
    ok("teacher cannot mark a lesson by hand", r.data.count === 0, r.data);

    // 12. Only a leader may make that manual mark.
    r = await call("POST", "/api/ops", { ops: [{
      id: "ov-4", kind: "override", dateKey, key: "P1|S1D",
      data: { state: "on-time", inAt: "08:05", method: "manual" },
    }] }, adminToken);
    ok("a leader can mark a lesson by hand", r.data.count === 1, r.data);

  } catch (e) {
    fail++;
    exitCode = 1;
    console.log("  ERROR " + (e && e.message));
  } finally {
    try { child.kill(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
    rm(DB);
  }

  console.log("\n" + (fail ? "FAILED " + fail + " of " + (pass + fail) : "All " + pass + " checks passed") + "\n");
  process.exit(exitCode || (fail ? 1 : 0));
})();
