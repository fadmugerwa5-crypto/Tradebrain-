/* ==========================================================================
   ClassPulse — server/server.cjs
   A small, zero-dependency school server:
     • serves the ClassPulse PWA (../app) over plain HTTP
     • keeps users, rooms, zones and the timetable in SQLite (node:sqlite)
     • accepts scan/alert ops from phones and fans them out live over SSE
     • needs no build step, no framework and no native modules

   Run:      node server/server.cjs
   Options:  --port 8787  --host 0.0.0.0  --db path  --reseed  --quiet

   Security note: this server is designed for a school LAN or a small VPS.
   PINs are matched with the same fast digest the offline app uses, which is
   fine for low-stakes attendance but is NOT strong authentication. Put the
   server behind HTTPS (see docs/DEPLOYMENT.md) before exposing it to the
   public internet.
   ========================================================================== */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

/* ----------------------------------------------------------------- config */
const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf("--" + name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const PORT = Number(process.env.PORT || process.env.CLASSPULSE_PORT || flag("port", 8787));
const HOST = String(process.env.CLASSPULSE_HOST || flag("host", "0.0.0.0"));
const QUIET = !!flag("quiet", false);
const WIPE = !!flag("wipe", false);
const HERE = __dirname;
const APP_DIR = path.resolve(HERE, "..", "app");
const DB_PATH = path.resolve(String(process.env.CLASSPULSE_DB || flag("db", path.join(HERE, "classpulse.db"))));
const VERSION = "1.5.0";
const STARTED = Date.now();

/* ------------------------------------------------------------------ utils */
function log(...a) { if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); }

// Identical to CP.digest() in app/js/util.js so a PIN hashed on a phone
// matches the value stored here. Deliberately cheap; see the note above.
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
function token() { return crypto.randomBytes(24).toString("hex"); }
function now() { return Date.now(); }

/* ------------------------------------------------ school-network checks */
// The phone's own Wi-Fi name cannot be read by a web app, so the only honest
// test is where the request comes from. A scan is accepted only if the server
// sees it arriving from the school's own network.
function isPrivateIp(ip) {
  return ip === "127.0.0.1" || ip === "::1" || /^10\./.test(ip) ||
    /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip); // Tailscale / CGNAT
}
function socketIp(req) {
  let ip = String((req.socket && req.socket.remoteAddress) || "");
  return ip.replace(/^::ffff:/, "");
}
function clientIp(req) {
  const sock = socketIp(req);
  // A tunnel (cloudflared, ngrok, a reverse proxy) connects from this machine
  // or from the local network. Only then do we believe the forwarded client
  // address. - Cloudflare puts the real phone address in CF-Connecting-IP.
  if (isPrivateIp(sock)) {
    const cf = String(req.headers["cf-connecting-ip"] || "").trim();
    if (cf) return cf.replace(/^::ffff:/, "");
    const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (xf) return xf.replace(/^::ffff:/, "");
  }
  if (sock === "::1") return "127.0.0.1";
  return sock;
}
function ip4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || "").trim());
  if (!m) return null;
  return (((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + (+m[4])) >>> 0;
}
function inCidr(ip, cidr) {
  const raw = String(cidr || "").trim();
  if (!raw) return false;
  const slash = raw.indexOf("/");
  const base = slash < 0 ? raw : raw.slice(0, slash);
  const a = ip4ToInt(ip), b = ip4ToInt(base);
  if (a == null || b == null) return false;
  const bits = slash < 0 ? 32 : parseInt(raw.slice(slash + 1), 10);
  if (!isFinite(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}
function activeNetworks(st) {
  const list = [];
  if (Array.isArray(st && st.schoolNetworks)) list.push(...st.schoolNetworks);
  if (st && st.schoolPublicIp) list.push(st.schoolPublicIp);
  return list.filter(Boolean);
}
function onSchoolNetwork(req, st) {
  if (!st || !st.requireSchoolNetwork) return true;
  const ip = clientIp(req);
  if (ip === "127.0.0.1") return true; // the office computer itself
  const configured = activeNetworks(st);
  if (configured.length) return configured.some((c) => inCidr(ip, c));
  // No list configured: the server is on the school's own network, so any
  // device that can reach it over a private address is on that network.
  return isPrivateIp(ip);
}
function metresBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// One successful scan per person per room per rotation window, plus a
// short-lived grant that the pushed record must quote. A photo copied to
// another phone cannot be redeemed twice, and a record cannot be invented.
const scanWindows = new Map(); // person|room|window -> ts
const scanGrants = new Map();  // scanId -> { userId, roomId, kind, ts, used }
function pruneScans() {
  const cut = now() - 5 * 60 * 1000;
  for (const [k, ts] of scanWindows) if (ts < cut) scanWindows.delete(k);
  for (const [k, g] of scanGrants) if (g.ts < cut) scanGrants.delete(k);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/* --------------------------------------------------------------- database */
// --wipe starts a completely fresh school (used when re-deploying). There is
// no sample data in ClassPulse: an empty database means the first person to
// open the app gets the setup wizard.
if (WIPE && fs.existsSync(DB_PATH)) {
  fs.rmSync(DB_PATH);
  log("removed the existing database (--wipe)");
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 4000;

  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    role     TEXT NOT NULL,
    staffNo  TEXT,
    dept     TEXT,
    phone    TEXT,
    pin      TEXT NOT NULL,
    active   INTEGER NOT NULL DEFAULT 1,
    json     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id   TEXT PRIMARY KEY,
    kind TEXT,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS zones (
    roomId TEXT PRIMARY KEY,
    kind   TEXT,
    code   TEXT,
    secret TEXT,
    json   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS classes (
    id   TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS timetable (
    id        TEXT PRIMARY KEY,
    day       INTEGER NOT NULL,
    period    INTEGER NOT NULL,
    classId   TEXT NOT NULL,
    teacherId TEXT,
    subject   TEXT,
    roomId    TEXT,
    json      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tt_teacher ON timetable (teacherId, day, period);
  CREATE INDEX IF NOT EXISTS tt_class   ON timetable (classId, day, period);

  CREATE TABLE IF NOT EXISTS config (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    role      TEXT NOT NULL,
    device    TEXT,
    createdAt INTEGER NOT NULL,
    lastSeen  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    id        TEXT PRIMARY KEY,
    label     TEXT,
    token     TEXT UNIQUE NOT NULL,
    createdAt INTEGER NOT NULL,
    lastSeen  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ops (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    id      TEXT,
    ts      INTEGER NOT NULL,
    serverTs INTEGER NOT NULL,
    device  TEXT,
    actorId TEXT,
    kind    TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ops_kind_ts ON ops (kind, ts DESC);
`);

/* --------------------------------------------------- the school, written */
// Everything a school consists of is written from one JSON document. The
// setup wizard and the admin screens both end up here, so the database and
// every phone agree on exactly one version of the truth.
function isEmptySchool() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0;
}

function writeSchool(doc, opts) {
  opts = opts || {};
  doc = doc || {};
  db.exec("BEGIN");
  try {
    if (opts.replaceTimetable !== false && Array.isArray(doc.timetable)) {
      db.exec("DELETE FROM timetable");
      const insTt = db.prepare(
        "INSERT INTO timetable (id,day,period,classId,teacherId,subject,roomId,json) VALUES (?,?,?,?,?,?,?,?)"
      );
      doc.timetable.forEach((r) => insTt.run(
        r.id, r.day, r.period, r.classId, r.teacherId || null,
        r.subject || "", r.roomId || "", JSON.stringify(r)));
    }
    if (Array.isArray(doc.classes)) {
      db.exec("DELETE FROM classes");
      const ins = db.prepare("INSERT OR REPLACE INTO classes (id,json) VALUES (?,?)");
      doc.classes.forEach((c) => ins.run(c.id, JSON.stringify(c)));
    }
    if (Array.isArray(doc.rooms)) {
      db.exec("DELETE FROM rooms");
      const ins = db.prepare("INSERT OR REPLACE INTO rooms (id,kind,json) VALUES (?,?,?)");
      doc.rooms.forEach((r) => ins.run(r.id, r.kind || "", JSON.stringify(r)));
    }
    if (Array.isArray(doc.zones)) {
      db.exec("DELETE FROM zones");
      const ins = db.prepare("INSERT OR REPLACE INTO zones (roomId,kind,code,secret,json) VALUES (?,?,?,?,?)");
      doc.zones.forEach((z) => ins.run(z.roomId, z.kind || "", z.code || "", z.secret || "", JSON.stringify(z)));
    }
    if (Array.isArray(doc.users)) {
      if (opts.replaceUsers) db.exec("DELETE FROM users");
      doc.users.forEach((u) => upsertUserFromDoc(u));
    }
    if (doc.school) setConfig("school", doc.school);
    if (doc.settings) setConfig("settings", doc.settings);
    if (doc.calendar) setConfig("calendar", doc.calendar);
    if (Array.isArray(doc.subjects)) setConfig("subjects", doc.subjects);
    if (doc.meta && doc.meta.setupAt) setConfig("setupAt", new Date(doc.meta.setupAt).toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return true;
}

function upsertUserFromDoc(u) {
  if (!u || !u.id) return;
  const pub = Object.assign({}, u);
  delete pub.pin;
  delete pub.pinHash;
  // No PIN yet means "this person chooses one on first sign-in" — never a
  // shared default.
  const pin = u.pin ? String(u.pin) : (u.pinRaw ? digest(String(u.pinRaw)) : "");
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(u.id);
  if (existing) {
    db.prepare("UPDATE users SET name=?,role=?,staffNo=?,dept=?,phone=?,active=?,json=? WHERE id=?")
      .run(u.name || "", u.role || "teacher", u.staffNo || "", u.dept || "", u.phone || "",
        u.active === false ? 0 : 1, JSON.stringify(pub), u.id);
    if (u.pin || u.pinRaw) db.prepare("UPDATE users SET pin=? WHERE id=?").run(pin, u.id);
  } else {
    db.prepare("INSERT INTO users (id,name,role,staffNo,dept,phone,pin,active,json) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(u.id, u.name || "", u.role || "teacher", u.staffNo || "", u.dept || "", u.phone || "",
        pin, u.active === false ? 0 : 1, JSON.stringify(pub));
  }
}

function userByStaffNo(no) {
  const s = String(no || "").trim().toLowerCase();
  if (!s) return null;
  return db.prepare("SELECT * FROM users WHERE lower(staffNo) = ?").get(s) || null;
}

function userDelete(id) {
  const u = userById(id);
  if (!u) return false;
  if (u.role === "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (admins <= 1) return false;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  db.prepare("DELETE FROM timetable WHERE teacherId = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE userId = ?").run(id);
  return true;
}

log(isEmptySchool() ? "database is empty — waiting for first-run setup" : "school loaded");


function getConfig(k, fallback) {
  const row = db.prepare("SELECT v FROM config WHERE k = ?").get(k);
  if (!row) return fallback;
  try { return JSON.parse(row.v); } catch (e) { return fallback; }
}
function setConfig(k, v) {
  db.prepare("INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .run(k, JSON.stringify(v === undefined ? null : v));
}

/* ------------------------------------- server-side view of live activity */
// Rebuilt from the append-only op log at boot, then kept in memory. The op
// log is the durable record; these views make "what happened today" fast.
const live = { events: [], alerts: [], overrides: {}, gateLog: {}, covers: [], leaves: [], plans: [], marks: [], audit: [],
  // Academic records (students, syllabus, progress, assessments + marks, mark audit trail).
  acad: { students: {}, syllabus: {}, progress: {}, assessments: {}, markaudit: [] } };
const ACAD_COLS = new Set(["students", "syllabus", "progress", "assessments", "markaudit"]);
const MAX_EVENTS = 25000;
const MAX_ALERTS = 10000;

function applyOp(op, persist) {
  if (!op || !op.kind) return;
  const d = op.data || {};
  switch (op.kind) {
    case "event":
      live.events.unshift(d);
      if (live.events.length > MAX_EVENTS) live.events.length = MAX_EVENTS;
      break;
    case "alert":
      if (!live.alerts.some((a) => a.id === d.id)) live.alerts.unshift(d);
      if (live.alerts.length > MAX_ALERTS) live.alerts.length = MAX_ALERTS;
      break;
    case "override":
      if (op.dateKey && op.key) {
        const day = (live.overrides[op.dateKey] = live.overrides[op.dateKey] || {});
        day[op.key] = Object.assign({}, day[op.key] || {}, d);
      }
      break;
    case "gate":
      if (op.dateKey && op.userId) {
        const day = (live.gateLog[op.dateKey] = live.gateLog[op.dateKey] || {});
        day[op.userId] = Object.assign({}, day[op.userId] || {}, d);
      }
      break;
    case "cover":
      if (!live.covers.some((c) => c.id === d.id)) live.covers.unshift(d);
      break;
    case "leave": {
      const i = live.leaves.findIndex((l) => l.id === d.id);
      if (i >= 0) Object.assign(live.leaves[i], d); else live.leaves.unshift(d);
      break;
    }
    case "plan": {
      const i = live.plans.findIndex((p) => p.id === d.id);
      if (i >= 0) Object.assign(live.plans[i], d); else live.plans.unshift(d);
      if (live.plans.length > 25000) live.plans.length = 25000;
      break;
    }
    case "mark": {
      const i = live.marks.findIndex((m) => m.id === d.id);
      if (d.deleted) { if (i >= 0) live.marks.splice(i, 1); }
      else if (i >= 0) Object.assign(live.marks[i], d); else live.marks.unshift(d);
      if (live.marks.length > 50000) live.marks.length = 50000;
      break;
    }
    case "acad": {
      if (!d.col || !ACAD_COLS.has(d.col) || !d.id) break;
      if (d.col === "markaudit") {
        if (!live.acad.markaudit.some((a) => a.id === d.id)) live.acad.markaudit.unshift(d);
        if (live.acad.markaudit.length > 50000) live.acad.markaudit.length = 50000;
      } else if (d.deleted) {
        delete live.acad[d.col][d.id];
      } else {
        live.acad[d.col][d.id] = Object.assign({}, live.acad[d.col][d.id] || {}, d);
      }
      break;
    }
    case "audit":
      if (!live.audit.some((a) => a.id === d.id)) live.audit.unshift(d);
      if (live.audit.length > 10000) live.audit.length = 10000;
      break;
    case "user":
      upsertUserFromOp(d);
      break;
    case "timetable":
      if (Array.isArray(d.rows)) replaceTimetable(d.rows);
      break;
    case "settings":
      if (d.settings) setConfig("settings", d.settings);
      if (d.school) setConfig("school", d.school);
      break;
    default:
      break;
  }
  if (persist) {
    db.prepare(
      "INSERT INTO ops (id,ts,serverTs,device,actorId,kind,payload) VALUES (?,?,?,?,?,?,?)"
    ).run(
      op.id || null, Number(op.ts) || now(), now(), op.device || null,
      op.actorId || null, op.kind, JSON.stringify(op)
    );
  }
}

function upsertUserFromOp(u) {
  if (!u || !u.id) return;
  const existing = db.prepare("SELECT pin FROM users WHERE id = ?").get(u.id);
  const pub = Object.assign({}, u);
  delete pub.pin;
  if (existing) {
    db.prepare("UPDATE users SET name=?, role=?, staffNo=?, dept=?, phone=?, active=?, json=? WHERE id=?")
      .run(u.name || "", u.role || "teacher", u.staffNo || "", u.dept || "", u.phone || "",
        u.active === false ? 0 : 1, JSON.stringify(pub), u.id);
    if (u.pin) db.prepare("UPDATE users SET pin = ? WHERE id = ?").run(u.pin, u.id);
  } else {
    db.prepare("INSERT INTO users (id,name,role,staffNo,dept,phone,pin,active,json) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(u.id, u.name || "", u.role || "teacher", u.staffNo || "", u.dept || "", u.phone || "",
        u.pin || "", u.active === false ? 0 : 1, JSON.stringify(pub));
  }
}

function replaceTimetable(rows) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM timetable");
    const ins = db.prepare(
      "INSERT INTO timetable (id,day,period,classId,teacherId,subject,roomId,json) VALUES (?,?,?,?,?,?,?,?)"
    );
    rows.forEach((r) =>
      ins.run(r.id, r.day, r.period, r.classId, r.teacherId || null, r.subject || "", r.roomId || "", JSON.stringify(r)));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// Replay the durable log so a restart keeps the school's history.
(function replay() {
  const rows = db.prepare("SELECT payload FROM ops ORDER BY seq ASC").all();
  rows.forEach((r) => {
    try { applyOp(JSON.parse(r.payload), false); } catch (e) {}
  });
  log("replayed", rows.length, "ops ·", live.events.length, "events ·", live.alerts.length, "alerts");
})();

/* ------------------------------------------------------------- snapshot */
function publicUsers() {
  return db.prepare("SELECT json FROM users").all().map((r) => {
    try { return JSON.parse(r.json); } catch (e) { return null; }
  }).filter(Boolean);
}
function bootstrapPayload() {
  return {
    version: VERSION,
    serverTime: now(),
    serverTimezoneOffsetMin: new Date().getTimezoneOffset(),
    school: getConfig("school", null),
    settings: getConfig("settings", null),
    calendar: getConfig("calendar", null),
    subjects: getConfig("subjects", null),
    setupAt: getConfig("setupAt", null),
    users: publicUsers(),
    classes: db.prepare("SELECT json FROM classes").all().map((r) => JSON.parse(r.json)),
    rooms: db.prepare("SELECT json FROM rooms").all().map((r) => JSON.parse(r.json)),
    zones: db.prepare("SELECT json FROM zones").all().map((r) => JSON.parse(r.json)),
    timetable: db.prepare("SELECT json FROM timetable").all().map((r) => JSON.parse(r.json)),
  };
}

/* -------------------------------------------------------------- http glue */
function send(res, code, body, headers) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Powered-By": "ClassPulse",
  }, corsHeaders(), headers || {}));
  res.end(payload);
}
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > (limit || 2 * 1024 * 1024)) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}
function bearer(req) {
  const h = req.headers.authorization || "";
  if (/^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();
  const u = new URL(req.url, "http://x");
  return u.searchParams.get("token") || null;
}
function clientDevice(req) {
  const u = new URL(req.url, "http://x");
  return u.searchParams.get("device") || req.headers["x-classpulse-device"] || null;
}
function auth(req) {
  const tok = bearer(req);
  if (!tok) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(tok);
  if (s) {
    db.prepare("UPDATE sessions SET lastSeen = ? WHERE token = ?").run(now(), tok);
    return { kind: "session", token: tok, userId: s.userId, role: s.role, device: s.device };
  }
  const d = db.prepare("SELECT * FROM devices WHERE token = ?").get(tok);
  if (d) {
    db.prepare("UPDATE devices SET lastSeen = ? WHERE id = ?").run(now(), d.id);
    return { kind: "device", token: tok, userId: null, role: "device", device: d.id };
  }
  return null;
}
function userById(id) { return db.prepare("SELECT * FROM users WHERE id = ?").get(id); }

/* ------------------------------------------------------------ rate limit */
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const t = now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

/* ------------------------------------------------------------- SSE hub */
const clients = new Set(); // { res, device, role }

function broadcast(msg, exceptDevice) {
  const line = "data: " + JSON.stringify(msg) + "\n\n";
  for (const c of clients) {
    if (exceptDevice && c.device === exceptDevice) continue;
    try { c.res.write(line); } catch (e) { clients.delete(c); }
  }
}
setInterval(() => {
  for (const c of clients) { try { c.res.write(": ping\n\n"); } catch (e) { clients.delete(c); } }
}, 25000).unref();

/* ------------------------------------------------------------- op policy */
const DEVICE_KINDS = new Set(["event", "alert", "override", "gate", "cover", "leave", "plan", "audit"]);
const LEADER_KINDS = new Set(["event", "alert", "override", "gate", "cover", "leave", "plan", "mark", "audit", "user", "timetable", "settings"]);
const LEADER_ROLES = new Set(["dos", "head", "admin"]);

function mayPush(who, op) {
  if (!who) return false;
  if (op.kind === "acad") return who.kind === "session" && !!who.userId; // never anonymous devices
  if (who.kind === "session" && LEADER_ROLES.has(who.role)) return LEADER_KINDS.has(op.kind);
  return DEVICE_KINDS.has(op.kind); // teacher phones and anonymous devices
}


/* ======================================================================= */
/*  ACADEMIC RECORDS — students, syllabus, coverage, assessments + marks    */
/*  Every write is validated here. A phone can ask; the server decides.     */
/* ======================================================================= */
const ACAD_ID = /^[A-Za-z0-9_.:|\-]{3,120}$/;
const PROGRESS_STATUS = new Set(["not-started", "in-progress", "completed", "not-completed"]);
const ASSESS_STATUS = new Set(["draft", "submitted", "approved", "returned"]);
const ASSESS_KINDS = new Set(["test", "exam", "quiz", "assignment", "practical"]);

function cleanStr(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max || 200); }
function cleanList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanStr(x, maxLen || 200)).filter(Boolean).slice(0, maxItems || 40);
}
function levelOfClass(classId) {
  const r = db.prepare("SELECT json FROM classes WHERE id = ?").get(String(classId || ""));
  if (!r) return null;
  try { const c = JSON.parse(r.json); return c.level || String(classId).replace(/\D+$/, ""); } catch (e) { return null; }
}
function teachesClassSubject(userId, classId, subject) {
  return !!db.prepare("SELECT 1 FROM timetable WHERE teacherId = ? AND classId = ? AND subject = ? LIMIT 1").get(userId, classId, subject);
}
function teachesClass(userId, classId) {
  return !!db.prepare("SELECT 1 FROM timetable WHERE teacherId = ? AND classId = ? LIMIT 1").get(userId, classId);
}
function rosterOf(classId) {
  return Object.values(live.acad.students).filter((s) => s.classId === classId && s.active !== false);
}
// Marks are { studentId: number | "AB" }. Anything else is dropped or refused.
function cleanMarks(raw, total, classId) {
  const out = {};
  if (raw == null) return { ok: true, marks: out };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "Marks must be an object." };
  const roster = new Set(rosterOf(classId).map((s) => s.id));
  const keys = Object.keys(raw);
  if (keys.length > 500) return { ok: false, reason: "Too many marks." };
  for (const k of keys) {
    const v = raw[k];
    if (v === null || v === "" || v === undefined) continue;
    if (!roster.has(k)) return { ok: false, reason: "A mark refers to a learner who is not on the class list." };
    if (v === "AB") { out[k] = "AB"; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > total) return { ok: false, reason: "A mark is outside 0–" + total + "." };
    out[k] = Math.round(n * 100) / 100;
  }
  return { ok: true, marks: out };
}
function marksDiff(oldM, newM) {
  const ids = new Set(Object.keys(oldM || {}).concat(Object.keys(newM || {})));
  const out = [];
  ids.forEach((id) => {
    const a = oldM && oldM[id] !== undefined ? oldM[id] : null;
    const b = newM && newM[id] !== undefined ? newM[id] : null;
    if (a !== b) out.push({ studentId: id, from: a, to: b });
  });
  return out;
}
let auditSeq = 0;
function mkAuditOp(op, who, rec, action, extra) {
  const t = now();
  auditSeq += 1;
  const u = userById(who.userId);
  return {
    kind: "acad", id: (op.id || "op") + "|a" + auditSeq, ts: t, device: op.device, actorId: who.userId,
    data: Object.assign({
      col: "markaudit", id: "ma-" + t.toString(36) + "-" + auditSeq + "-" + Math.random().toString(36).slice(2, 6),
      ts: t, by: who.userId, byName: u ? u.name : "", byRole: who.role,
      assessId: rec.id, title: rec.title, classId: rec.classId, subject: rec.subject, action,
    }, extra || {}),
  };
}

// Returns { ok:true, ops:[...] } (the record plus any audit entries), or { ok:false, reason }.
function acadIngest(who, op) {
  const d = op.data || {};
  const col = String(d.col || "");
  if (!who || who.kind !== "session" || !who.userId) return { ok: false, reason: "Sign in first." };
  if (!ACAD_COLS.has(col) || col === "markaudit") return { ok: false, reason: "Unknown record type." };
  const id = String(d.id || "");
  if (!ACAD_ID.test(id)) return { ok: false, reason: "Bad record id." };
  const isLeader = LEADER_ROLES.has(who.role);
  const t = now();
  const existing = live.acad[col][id] || null;
  const wrap = (data, extra) => [Object.assign({}, op, { data })].concat(extra || []);

  if (d.deleted) {
    if (!isLeader) return { ok: false, reason: "Only the Director of Studies can delete this." };
    if (col === "assessments" && existing && existing.status === "approved") return { ok: false, reason: "Approved results cannot be deleted." };
    return { ok: true, ops: wrap({ col, id, deleted: true, ts: t, updatedBy: who.userId }) };
  }

  /* ---- students (roster) — leaders only ---------------------------- */
  if (col === "students") {
    if (!isLeader) return { ok: false, reason: "Only the Director of Studies can edit class lists." };
    const name = cleanStr(d.name, 80);
    if (!name) return { ok: false, reason: "Learner name is required." };
    if (levelOfClass(d.classId) === null) return { ok: false, reason: "Unknown class." };
    return { ok: true, ops: wrap({ col, id, name, admNo: cleanStr(d.admNo, 30), classId: String(d.classId), active: d.active !== false, ts: t, updatedBy: who.userId }) };
  }

  /* ---- syllabus topics — leaders only ------------------------------ */
  if (col === "syllabus") {
    if (!isLeader) return { ok: false, reason: "Only the Director of Studies can change the syllabus." };
    const topic = cleanStr(d.topic, 160);
    const subject = cleanStr(d.subject, 60);
    const level = cleanStr(d.level, 12);
    if (!topic || !subject || !level) return { ok: false, reason: "Subject, class level and topic are required." };
    const term = ["1", "2", "3"].includes(String(d.term)) ? String(d.term) : "1";
    const units = CLAMP(Number(d.units) || 1, 1, 10);
    const week = d.week === null || d.week === "" || d.week === undefined ? null : CLAMP(Math.round(Number(d.week) || 1), 1, 20);
    return { ok: true, ops: wrap({
      col, id, subject, level, term, week, topic, units,
      order: Number.isFinite(Number(d.order)) ? Number(d.order) : 0,
      subtopics: cleanList(d.subtopics, 40, 160), objectives: cleanList(d.objectives, 20, 240),
      ts: t, updatedBy: who.userId,
    }) };
  }

  /* ---- coverage progress ------------------------------------------- */
  if (col === "progress") {
    const topic = live.acad.syllabus[String(d.topicId || "")];
    if (!topic) return { ok: false, reason: "That topic is not in the syllabus." };
    const classId = String(d.classId || "");
    const subject = topic.subject;
    if (levelOfClass(classId) !== topic.level) return { ok: false, reason: "That topic is not taught in this class." };
    if (id !== "pg|" + topic.id + "|" + classId) return { ok: false, reason: "Bad record id." };
    const teacherId = isLeader ? (cleanStr(d.teacherId, 60) || null) : who.userId;
    if (!isLeader && !teachesClassSubject(who.userId, classId, subject)) return { ok: false, reason: "You are not timetabled to teach this subject in this class." };
    if (!isLeader && existing && existing.teacherId && existing.teacherId !== who.userId) {
      // Another teacher recorded this class/topic; the current teacher may continue it if they teach it (checked above).
    }
    const status = String(d.status || "");
    if (!PROGRESS_STATUS.has(status)) return { ok: false, reason: "Bad status." };
    const note = cleanStr(d.note, 400);
    if (status === "not-completed" && !note) return { ok: false, reason: "Say why the topic was not completed." };
    const rec = { col, id, topicId: topic.id, classId, subject, teacherId, status, note, ts: t, updatedBy: who.userId };
    if (status === "completed") {
      if (d.confirmed !== true) return { ok: false, reason: "Confirm the topic was completed before saving." };
      rec.completedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(d.completedOn || "")) ? d.completedOn : new Date(t).toISOString().slice(0, 10);
      rec.confirmedBy = who.userId; rec.confirmedAt = t;
    } else { rec.completedOn = null; rec.confirmedBy = null; rec.confirmedAt = null; }
    return { ok: true, ops: wrap(rec) };
  }

  /* ---- assessments + marks ------------------------------------------ */
  if (col === "assessments") {
    const base = existing || {};
    const classId = String(existing ? existing.classId : d.classId || "");
    const subject = cleanStr(existing ? existing.subject : d.subject, 60);
    if (levelOfClass(classId) === null) return { ok: false, reason: "Unknown class." };
    if (!subject) return { ok: false, reason: "Subject is required." };
    const title = cleanStr(d.title !== undefined ? d.title : base.title, 120);
    if (!title) return { ok: false, reason: "Give the assessment a title." };
    const total = Number(d.total !== undefined ? d.total : base.total);
    if (!Number.isFinite(total) || total < 1 || total > 1000) return { ok: false, reason: "Total marks must be between 1 and 1000." };
    const teacherId = existing ? existing.teacherId : (isLeader ? cleanStr(d.teacherId, 60) : who.userId);
    if (!teacherId) return { ok: false, reason: "An assessment needs a teacher." };

    if (!isLeader) {
      if (existing && existing.teacherId !== who.userId) return { ok: false, reason: "This assessment belongs to another teacher." };
      if (!teachesClassSubject(who.userId, classId, subject)) return { ok: false, reason: "You are not timetabled to teach this subject in this class." };
      if (existing && existing.status !== "draft" && existing.status !== "returned") return { ok: false, reason: "Submitted or approved results are locked. Ask the Director of Studies to return them." };
    }

    let status = String(d.status || base.status || "draft");
    if (!ASSESS_STATUS.has(status)) return { ok: false, reason: "Bad status." };
    if (!isLeader && status !== "draft" && status !== "submitted") status = "draft"; // teachers cannot approve/return

    const m = cleanMarks(d.marks !== undefined ? d.marks : base.marks, total, classId);
    if (!m.ok) return { ok: false, reason: m.reason };
    if (status === "submitted" && !Object.keys(m.marks).length) return { ok: false, reason: "Enter at least one mark before submitting." };
    if ((status === "approved" || status === "returned") && !isLeader) return { ok: false, reason: "Only the Director of Studies can review results." };
    const returnNote = cleanStr(d.returnNote, 400);
    if (isLeader && status === "returned" && !returnNote) return { ok: false, reason: "Say what needs correcting." };

    const prevStatus = existing ? existing.status : null;
    const diff = marksDiff(existing ? existing.marks : {}, m.marks);
    const reason = cleanStr(d.reason, 300);
    if (isLeader && existing && prevStatus === "approved" && status === "approved" && diff.length && !reason) {
      return { ok: false, reason: "Give a reason for changing approved marks." };
    }

    const rec = Object.assign({}, existing || {}, {
      col, id, teacherId, classId, subject, title, total,
      kind: ASSESS_KINDS.has(String(d.kind)) ? String(d.kind) : (base.kind || "test"),
      term: ["1", "2", "3"].includes(String(d.term !== undefined ? d.term : base.term)) ? String(d.term !== undefined ? d.term : base.term) : "1",
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || base.date || "")) ? (d.date || base.date) : new Date(t).toISOString().slice(0, 10),
      topicId: d.topicId !== undefined ? (cleanStr(d.topicId, 120) || null) : (base.topicId || null),
      note: d.note !== undefined ? cleanStr(d.note, 400) : (base.note || ""),
      marks: m.marks, status, ts: t, updatedBy: who.userId,
      createdAt: base.createdAt || t,
    });
    if (status === "submitted") { rec.submittedAt = t; rec.returnNote = ""; }
    if (status === "approved") { rec.reviewedBy = who.userId; rec.reviewedAt = t; rec.returnNote = ""; }
    if (status === "returned") { rec.reviewedBy = who.userId; rec.reviewedAt = t; rec.returnNote = returnNote; }

    const extra = [];
    if (!existing) extra.push(mkAuditOp(op, who, rec, "created", {}));
    if (diff.length) extra.push(mkAuditOp(op, who, rec, isLeader && prevStatus === "approved" ? "edited-after-approval" : "marks-changed", { changes: diff.slice(0, 500), reason }));
    if (existing && status !== prevStatus && ["submitted", "approved", "returned"].includes(status)) {
      extra.push(mkAuditOp(op, who, rec, status, { reason: status === "returned" ? returnNote : "" }));
    }
    return { ok: true, ops: wrap(rec, extra) };
  }
  return { ok: false, reason: "Unsupported." };
}
function CLAMP(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Who may see which academic record on the live stream / snapshot.
function acadVisible(client, o) {
  if (LEADER_ROLES.has(client.role)) return true;
  if (!client.userId) return false;
  const d = (o && o.data) || {};
  if (d.col === "syllabus") return true;
  if (d.col === "markaudit") return false;
  if (d.col === "students") return teachesClass(client.userId, d.classId);
  return d.teacherId === client.userId;
}
function broadcastAcad(ops, exceptDevice) {
  for (const c of clients) {
    if (exceptDevice && c.device === exceptDevice) continue;
    const mine = ops.filter((o) => acadVisible(c, o));
    if (!mine.length) continue;
    try { c.res.write("data: " + JSON.stringify({ type: "ops", ops: mine, serverTime: now() }) + "\n\n"); } catch (e) { clients.delete(c); }
  }
}
function acadSnapshotFor(who) {
  const A = live.acad;
  if (LEADER_ROLES.has(who.role)) {
    return { students: Object.values(A.students), syllabus: Object.values(A.syllabus), progress: Object.values(A.progress),
      assessments: Object.values(A.assessments), markaudit: A.markaudit };
  }
  const myClasses = new Set(db.prepare("SELECT DISTINCT classId FROM timetable WHERE teacherId = ?").all(who.userId).map((r) => r.classId));
  return {
    students: Object.values(A.students).filter((s) => myClasses.has(s.classId)),
    syllabus: Object.values(A.syllabus),
    progress: Object.values(A.progress).filter((x) => x.teacherId === who.userId),
    assessments: Object.values(A.assessments).filter((x) => x.teacherId === who.userId),
    markaudit: [],
  };
}


/* ======================================================================= */
/*  OPTIONAL AI TEACHING ASSISTANT                                          */
/*  Off by default. Nothing else in ClassPulse calls it or waits for it.    */
/*  The API key lives only on this server; phones never see it.             */
/* ======================================================================= */
const AI_TASKS = {
  explain: "Explain the topic clearly for the class level, with two worked examples.",
  notes: "Prepare concise teaching notes the teacher can read out or write on the board.",
  questions: "Write 10 examination-style questions with a short marking guide.",
  exercises: "Write a graded exercise: 5 easy, 5 medium and 3 challenging items, with answers.",
  methods: "Suggest 4 practical teaching methods or activities for this topic, with timing for a single lesson.",
  revision: "Write a one-page revision summary with key points and 5 self-check questions.",
};
const aiUse = new Map();
function aiConfig() {
  const c = getConfig("ai", null) || {};
  return {
    enabled: !!c.enabled && !!c.apiKey,
    apiKey: c.apiKey || "",
    model: c.model || "claude-sonnet-5-5",
    endpoint: c.endpoint || "https://api.anthropic.com/v1/messages",
    dailyLimit: Number(c.dailyLimit) > 0 ? Number(c.dailyLimit) : 30,
  };
}
function aiEndpointOk(u) {
  try {
    const x = new URL(u);
    if (x.protocol === "https:") return true;
    return x.protocol === "http:" && (x.hostname === "localhost" || x.hostname === "127.0.0.1");
  } catch (e) { return false; }
}
async function aiAsk(who, body) {
  const cfg = aiConfig();
  if (!cfg.enabled) return { status: 503, data: { error: "The AI assistant is switched off. Everything else in ClassPulse works without it.", code: "AI_OFF" } };
  const dayKey = new Date().toISOString().slice(0, 10);
  const uk = who.userId + "|" + dayKey;
  const used = aiUse.get(uk) || 0;
  if (used >= cfg.dailyLimit) return { status: 429, data: { error: "Daily AI limit reached for your account.", code: "AI_LIMIT" } };
  const task = AI_TASKS[String(body.task || "")];
  if (!task) return { status: 400, data: { error: "Choose what you want the assistant to do." } };
  const topic = body.topicId ? live.acad.syllabus[String(body.topicId)] : null;
  const subject = cleanStr(topic ? topic.subject : body.subject, 60);
  const level = cleanStr(topic ? topic.level : body.level, 12);
  const topicName = cleanStr(topic ? topic.topic : body.topic, 160);
  if (!subject || !topicName) return { status: 400, data: { error: "Pick a subject and topic from the syllabus." } };
  const ref = topic
    ? "School syllabus entry — Subject: " + topic.subject + "; Class: " + topic.level + "; Term: " + topic.term + "; Topic: " + topic.topic +
      (topic.subtopics.length ? "; Subtopics: " + topic.subtopics.join(", ") : "") +
      (topic.objectives.length ? "; Learning objectives: " + topic.objectives.join(" | ") : "")
    : "No syllabus entry was selected; the teacher typed the topic.";
  const system =
    "You are a teaching assistant inside a school management app. Stay within the school's syllabus entry given below. " +
    "Do not invent official curriculum requirements; if you add material beyond the entry, label it 'Suggestion'. " +
    "Write plainly for a teacher, with no preamble. " + ref;
  const extra = cleanStr(body.prompt, 600);
  const userMsg = task + "\nSubject: " + subject + (level ? "\nClass level: " + level : "") + "\nTopic: " + topicName + (extra ? "\nTeacher's note: " + extra : "");
  aiUse.set(uk, used + 1);
  try {
    const r = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1400, system, messages: [{ role: "user", content: userMsg }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { aiUse.set(uk, used); return { status: 502, data: { error: "The AI service refused the request (HTTP " + r.status + ").", code: "AI_UPSTREAM" } }; }
    const j = await r.json();
    const text = (Array.isArray(j.content) ? j.content : []).map((b) => (b && b.type === "text" ? b.text : "")).join("\n").trim();
    if (!text) { aiUse.set(uk, used); return { status: 502, data: { error: "The AI service returned no text.", code: "AI_EMPTY" } }; }
    return { status: 200, data: { ok: true, text, remainingToday: Math.max(0, cfg.dailyLimit - used - 1) } };
  } catch (e) {
    aiUse.set(uk, used);
    return { status: 502, data: { error: "The AI service could not be reached. You can keep working without it.", code: "AI_DOWN" } };
  }
}

/* ---------------------------------------------------------------- routes */
const server = http.createServer(async (req, res) => {
  // Refuse traversal in the raw request line — lit also covers percent-encoded
  // ".." before any URL normalisation can quietly resolve it away.
  const rawPath = String(req.url || "").split("?")[0];
  let rawDecoded = rawPath;
  try { rawDecoded = decodeURIComponent(rawPath); } catch (e) { /* keep raw */ }
  if (rawPath.indexOf("..") >= 0 || rawDecoded.indexOf("..") >= 0) {
    return send(res, 403, { error: "Forbidden" });
  }
  if (rawDecoded.indexOf("\0") >= 0) {
    return send(res, 400, { error: "Bad request" });
  }

  let url;
  try { url = new URL(req.url, "http://" + (req.headers.host || "localhost")); }
  catch (e) { return send(res, 400, { error: "Bad request" }); }
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  /* ------------------------------------------------------------ API */
  if (p.startsWith("/api/")) {
    try {
      // ---- health (public) ---------------------------------------------
      if (p === "/api/health" && req.method === "GET") {
        return send(res, 200, {
          ok: true, name: "ClassPulse", version: VERSION,
          time: now(), uptimeSec: Math.round((Date.now() - STARTED) / 1000),
          users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
          timetableRows: db.prepare("SELECT COUNT(*) AS n FROM timetable").get().n,
          ops: db.prepare("SELECT COUNT(*) AS n FROM ops").get().n,
          clients: clients.size,
        });
      }

      // ---- "what address do you see me from?" (public) -----------------
      // Lets the office add the right network without understanding IPs:
      // they stand in the school with a phone, press the button, done.
      if (p === "/api/whoami" && req.method === "GET") {
        const st = getConfig("settings", {}) || {};
        return send(res, 200, {
          ip: clientIp(req),
          onSchoolNetwork: onSchoolNetwork(req, st),
          requireSchoolNetwork: !!st.requireSchoolNetwork,
        });
      }

      // ---- teacher self-registration (public) ----------------------------
      if (p === "/api/register" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "?";
        if (rateLimited("register:" + ip, 10, 60_000)) return send(res, 429, { error: "Too many requests. Wait a minute." });
        const body = await readJson(req, 64 * 1024);
        const u = body.user || body;
        if (!u || !u.name || !u.staffNo) return send(res, 400, { error: "Name and staff number are required." });
        // Staff number must be unique.
        const existing = userByStaffNo(u.staffNo);
        if (existing) return send(res, 409, { error: "That staff number is already registered.", code: "DUPLICATE" });
        // New registrations are always pending until a DOS approves them.
        const pub = Object.assign({}, u, { status: "pending", role: "teacher", active: true });
        delete pub.pin; delete pub.pinHash;
        const pin = u.pin ? digest(String(u.pin)) : "";
        const id = u.id || ("u-" + String(u.staffNo).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        db.prepare("INSERT INTO users (id,name,role,staffNo,dept,phone,pin,active,json) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(id, u.name, "teacher", u.staffNo, u.dept || "", u.phone || "", pin, 1, JSON.stringify(pub));
        log("teacher registered (pending):", id);
        // Notify DOS/admin via SSE.
        broadcast({ type: "registration", user: JSON.parse(db.prepare("SELECT json FROM users WHERE id=?").get(id).json), serverTime: now() }, null);
        return send(res, 200, { ok: true, status: "pending", message: "Registration submitted. The Director of Studies will review and approve your account." });
      }

      // ---- device registration (public) --------------------------------
      if (p === "/api/device" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "?";
        if (rateLimited("device:" + ip, 60, 60_000)) return send(res, 429, { error: "Too many requests" });
        const body = await readJson(req, 8 * 1024);
        const id = String(body.device || "").slice(0, 80) || "dev-" + crypto.randomBytes(6).toString("hex");
        const t = token();
        db.prepare(
          `INSERT INTO devices (id,label,token,createdAt,lastSeen) VALUES (?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET label = excluded.label, token = excluded.token, lastSeen = excluded.lastSeen`
        ).run(id, String(body.label || "").slice(0, 160), t, now(), now());
        log("device registered", id);
        return send(res, 200, { device: id, token: t, server: { name: "ClassPulse", version: VERSION } });
      }

      // ---- first-run setup (public while the school is empty) ----------
      // The setup wizard in the app writes the school here once. After that
      // the school's own leaders manage everything through the signed-in
      // endpoints below; this one closes itself off.
      if (p === "/api/setup" && req.method === "POST") {
        const body = await readJson(req, 4 * 1024 * 1024);
        if (!isEmptySchool()) return send(res, 403, { error: "This school is already set up." });
        const doc = body.data || body;
        if (!doc || !doc.school || !doc.school.name) return send(res, 400, { error: "The school needs a name." });
        const admins = (doc.users || []).filter((u) => u.role === "admin");
        if (!admins.length) return send(res, 400, { error: "The setup needs one administrator account." });
        try {
          writeSchool(doc, { replaceUsers: true, replaceTimetable: true });
        } catch (e) {
          log("setup failed:", e && e.message);
          return send(res, 400, { error: "Could not save the school: " + (e && e.message) });
        }
        const u = userById(admins[0].id);
        const t = token();
        db.prepare("INSERT INTO sessions (token,userId,role,device,createdAt,lastSeen) VALUES (?,?,?,?,?,?)")
          .run(t, u.id, u.role, String(body.device || clientDevice(req) || "").slice(0, 80) || null, now(), now());
        log("school set up:", doc.school.name, "· admin", u.id);
        broadcast({ type: "setup", school: getConfig("school", null), serverTime: now() });
        return send(res, 200, { ok: true, token: t, user: JSON.parse(u.json), role: u.role, snapshot: bootstrapPayload() });
      }

      // ---- login -------------------------------------------------------
      if (p === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "?";
        if (rateLimited("login:" + ip, 12, 60_000)) return send(res, 429, { error: "Too many attempts. Wait a minute." });
        const body = await readJson(req, 8 * 1024);
        const u = body.staffNo ? userByStaffNo(body.staffNo) : userById(String(body.userId || ""));
        if (!u || u.active === 0) return send(res, 401, { error: "Unknown or disabled account" });
        // Parse the full user record to check approval status.
        let urec = {};
        try { urec = JSON.parse(u.json || "{}"); } catch (e) {}
        if (urec.status === "pending") return send(res, 403, { error: "Your registration is awaiting approval by the Director of Studies.", code: "PENDING" });
        if (urec.status === "rejected") return send(res, 403, { error: "Your registration was not approved. Contact the school office.", code: "REJECTED" });
        const pin = String(body.pin || "");
        if (!/^\d{4,8}$/.test(pin)) return send(res, 401, { error: "PINs are 4 to 8 digits." });
        if (!u.pin) {
          // First ever sign-in for this account: they choose their own PIN now.
          if (!body.setPin) return send(res, 409, { error: "No PIN set for this account yet.", code: "NO_PIN" });
          db.prepare("UPDATE users SET pin = ? WHERE id = ?").run(digest(pin), u.id);
          u.pin = digest(pin);
          log("first PIN set for", u.id);
        } else if (digest(pin) !== u.pin) {
          log("failed login for", u.id, "from", ip);
          return send(res, 401, { error: "Wrong PIN", code: "BAD_PIN" });
        }
        const t = token();
        db.prepare("INSERT INTO sessions (token,userId,role,device,createdAt,lastSeen) VALUES (?,?,?,?,?,?)")
          .run(t, u.id, u.role, String(body.device || clientDevice(req) || "").slice(0, 80) || null, now(), now());
        log("login", u.id, "(" + u.role + ")");
        return send(res, 200, {
          token: t,
          user: JSON.parse(u.json),
          role: u.role,
          serverTime: now(),
          snapshot: u.role === "teacher" ? teacherSnapshot() : bootstrapPayload(),
        });
      }

      // ---- public-ish snapshot for a signed-in device ------------------
      const who = auth(req);
      if (!who) return send(res, 401, { error: "Sign in first" });

      if (p === "/api/bootstrap" && req.method === "GET") {
        const leader = who.kind === "session" && LEADER_ROLES.has(who.role);
        return send(res, 200, leader ? bootstrapPayload() : teacherSnapshot());
      }

      // Full activity snapshot for DOS/head/admin devices. SSE keeps the
      // dashboard live while connected; this endpoint fills any gap after a
      // phone has been offline or the app has been closed.
      if (p === "/api/activity" && req.method === "GET") {
        if (!(who.kind === "session" && LEADER_ROLES.has(who.role))) {
          return send(res, 403, { error: "Leaders only" });
        }
        return send(res, 200, {
          serverTime: now(),
          events: live.events,
          alerts: live.alerts,
          overrides: live.overrides,
          gateLog: live.gateLog,
          covers: live.covers,
          leaves: live.leaves,
          plans: live.plans,
          marks: live.marks,
          audit: live.audit,
        });
      }

      // ---- optional AI assistant ----------------------------------------------
      if (p === "/api/ai/status" && req.method === "GET") {
        if (!who || who.kind !== "session" || !who.userId) return send(res, 401, { error: "Sign in first" });
        const c = aiConfig();
        const out = { enabled: c.enabled };
        if (LEADER_ROLES.has(who.role)) Object.assign(out, { hasKey: !!c.apiKey, model: c.model, endpoint: c.endpoint, dailyLimit: c.dailyLimit });
        return send(res, 200, out);
      }
      if (p === "/api/ai/config" && req.method === "POST") {
        if (!who || who.kind !== "session" || who.role !== "admin") return send(res, 403, { error: "Only the system administrator can configure the AI assistant." });
        const body = await readJson(req, 16 * 1024);
        const cur = getConfig("ai", null) || {};
        const next = Object.assign({}, cur);
        if (body.enabled !== undefined) next.enabled = !!body.enabled;
        if (typeof body.apiKey === "string" && body.apiKey.trim()) next.apiKey = body.apiKey.trim().slice(0, 300);
        if (body.clearKey === true) { next.apiKey = ""; next.enabled = false; }
        if (typeof body.model === "string" && body.model.trim()) next.model = body.model.trim().slice(0, 80);
        if (typeof body.endpoint === "string" && body.endpoint.trim()) {
          if (!aiEndpointOk(body.endpoint.trim())) return send(res, 400, { error: "The endpoint must be an https:// address." });
          next.endpoint = body.endpoint.trim();
        }
        if (Number(body.dailyLimit) > 0) next.dailyLimit = Math.min(500, Math.round(Number(body.dailyLimit)));
        setConfig("ai", next);
        const c = aiConfig();
        return send(res, 200, { ok: true, enabled: c.enabled, hasKey: !!c.apiKey, model: c.model, endpoint: c.endpoint, dailyLimit: c.dailyLimit });
      }
      if (p === "/api/ai/ask" && req.method === "POST") {
        if (!who || who.kind !== "session" || !who.userId) return send(res, 401, { error: "Sign in first" });
        if (rateLimited("ai:" + who.userId, 6, 60_000)) return send(res, 429, { error: "Slow down a little.", code: "RATE_LIMIT" });
        const body = await readJson(req, 16 * 1024);
        const r = await aiAsk(who, body);
        return send(res, r.status, r.data);
      }

      // ---- academic records, filtered to what this person may see ----------
      if (p === "/api/acad" && req.method === "GET") {
        if (!who || who.kind !== "session" || !who.userId) return send(res, 401, { error: "Sign in first" });
        return send(res, 200, Object.assign({ serverTime: now() }, acadSnapshotFor(who)));
      }

      // ---- leaders: manage the school's own configuration ---------------
      // School, settings, classes, rooms, zones and the timetable are written
      // by an admin/dos/head. Teachers never touch these.
      if (p === "/api/config" && req.method === "POST") {
        if (!(who.kind === "session" && LEADER_ROLES.has(who.role))) return send(res, 403, { error: "Leaders only" });
        const body = await readJson(req, 4 * 1024 * 1024);
        const doc = body.data || body;
        try {
          writeSchool(doc, {
            replaceUsers: false,
            replaceTimetable: doc.timetable !== undefined,
          });
        } catch (e) {
          log("config write failed:", e && e.message);
          return send(res, 400, { error: "Could not save: " + (e && e.message) });
        }
        broadcast({ type: "config", serverTime: now() }, who.device);
        return send(res, 200, { ok: true, snapshot: bootstrapPayload() });
      }

      // ---- leaders: add / update / remove staff -------------------------
      if (p === "/api/users" && req.method === "POST") {
        if (!(who.kind === "session" && LEADER_ROLES.has(who.role))) return send(res, 403, { error: "Leaders only" });
        const body = await readJson(req, 64 * 1024);
        const u = body.user || body;
        if (!u || !u.id) return send(res, 400, { error: "A staff member needs an id." });
        if (body.action === "delete") {
          if (!userDelete(u.id)) return send(res, 400, { error: "Cannot delete the only administrator." });
          broadcast({ type: "users", action: "delete", id: u.id, serverTime: now() }, who.device);
          return send(res, 200, { ok: true, deleted: u.id });
        }
        if (!u.name) return send(res, 400, { error: "A staff member needs a name." });
        upsertUserFromDoc(u);
        const saved = JSON.parse(userById(u.id).json);
        log("user saved:", u.id, "(" + (u.role || "teacher") + ")");
        broadcast({ type: "users", action: "save", user: saved, serverTime: now() }, who.device);
        return send(res, 200, { ok: true, user: saved });
      }

      // ---- teachers: set / change their own PIN (first sign-in) ---------
      if (p === "/api/pin" && req.method === "POST") {
        const body = await readJson(req, 8 * 1024);
        // A leader may reset somebody else's PIN by naming them; everybody
        // else can only ever change their own.
        const leader = who.kind === "session" && LEADER_ROLES.has(who.role);
        const uid = (leader && body.userId ? String(body.userId) : who.userId) || String(body.userId || "");
        if (!uid) return send(res, 401, { error: "Sign in first" });
        const pin = String(body.pin || "");
        if (!/^\d{4,8}$/.test(pin)) return send(res, 400, { error: "PINs are 4–8 digits." });
        const u = userById(uid);
        if (!u) return send(res, 404, { error: "Unknown account" });
        if (who.kind === "session" && u.pin && digest(String(body.oldPin || "")) !== u.pin && !LEADER_ROLES.has(who.role)) {
          return send(res, 403, { error: "Wrong current PIN." });
        }
        db.prepare("UPDATE users SET pin = ? WHERE id = ?").run(digest(pin), uid);
        log("pin changed for", uid);
        return send(res, 200, { ok: true });
      }

      // ---- push ops ----------------------------------------------------
      if (p === "/api/ops" && req.method === "POST") {
        const body = await readJson(req, 2 * 1024 * 1024);
        const ops = Array.isArray(body.ops) ? body.ops : [];
        if (!ops.length) return send(res, 200, { accepted: [], count: 0 });
        const device = String(who.device || body.device || "") || null;
        const accepted = [];
        const rejected = [];
        const forwarded = [];
        const forwardedAcad = [];
        const st = getConfig("settings", {}) || {};
        const enforceScans = !!st.requireSchoolNetwork;
        const isLeader = who.kind === "session" && LEADER_ROLES.has(who.role);
        for (const raw of ops) {
          const op = Object.assign({}, raw, {
            ts: Number(raw.ts) || now(),
            device,
            actorId: who.userId || raw.actorId || null,
          });
          if (!mayPush(who, op)) continue;
          // A client may retry after a timeout even though the server committed
          // the first request. Treat the same operation ID from the same device
          // as accepted without writing or broadcasting it a second time.
          if (op.id && db.prepare("SELECT 1 FROM ops WHERE id = ? AND (device = ? OR (device IS NULL AND ? IS NULL)) LIMIT 1").get(op.id, device, device)) {
            accepted.push(op.id);
            continue;
          }
          // Academic records: the server validates, stamps and audits them.
          if (op.kind === "acad") {
            const r = acadIngest(who, op);
            if (!r.ok) { rejected.push({ id: op.id || null, reason: r.reason }); continue; }
            r.ops.forEach((o) => { applyOp(o, true); forwardedAcad.push(o); });
            accepted.push(op.id || null);
            continue;
          }
          // Lesson plans: a teacher can save and submit, never review. The
          // reviewer's decision and comment are the Director of Studies' alone.
          if (op.kind === "plan" && !isLeader) {
            const pd = op.data || {};
            const cur = live.plans.find((x) => x.id === pd.id);
            if (!who.userId || (cur && cur.by && cur.by !== who.userId)) { rejected.push({ id: op.id || null, reason: "That lesson plan belongs to another teacher." }); continue; }
            if (cur && cur.status === "approved") { rejected.push({ id: op.id || null, reason: "Approved plans are locked." }); continue; }
            pd.by = who.userId;
            if (pd.status !== "submitted") pd.status = "draft";
            delete pd.review;
            op.data = pd;
          }
          // A record that claims a scan must quote the grant the server issued
          // when the code was read. Without it, a hand-built record is dropped.
          const d = op.data || {};
          if (op.kind === "override" || op.kind === "gate") {
            const method = String(d.method || "");
            if (method === "manual" || method === "sim") {
              if (!isLeader) continue; // only a leader may mark a lesson by hand
            } else if (enforceScans) {
              const grant = scanGrants.get(String(d.scanId || ""));
              const roomOk = !d.roomId || (grant && grant.roomId === d.roomId);
              const kindOk = grant && (op.kind === "gate" ? grant.kind !== "class" : grant.kind === "class");
              if (!grant || grant.used || grant.userId !== who.userId || !roomOk || !kindOk) {
                log("dropped unverified", op.kind, "from", who.userId || device);
                continue;
              }
              grant.used = true;
              op.data = Object.assign({}, d, { verified: true, ip: clientIp(req) });
            }
          }
          applyOp(op, true);
          accepted.push(op.id || null);
          forwarded.push(op);
        }
        if (forwarded.length) broadcast({ type: "ops", ops: forwarded, from: device, serverTime: now() }, device);
        if (forwardedAcad.length) broadcastAcad(forwardedAcad, device);
        log("ops from", who.userId || device || who.kind, "→", forwarded.length + forwardedAcad.length, "accepted", rejected.length ? "· " + rejected.length + " refused" : "");
        // The submitting device also needs server-stamped copies (status, timestamps, audit).
        const echo = forwardedAcad.filter((o) => o.data && o.data.col !== "markaudit" && acadVisible({ role: who.role, userId: who.userId }, o)).map((o) => o.data);
        return send(res, 200, { accepted, rejected, acad: echo, count: forwarded.length + forwardedAcad.length, serverTime: now() });
      }

      // ---- verify a live scan ------------------------------------------
      // The phone sends the code it just read. The server — not the phone —
      // decides whether that code is current, whether it has already been
      // used, whether the request came from the school network, and whether
      // the teacher checked in at the gate first.
      if (p === "/api/scan" && req.method === "POST") {
        if (!who || !who.userId) return send(res, 401, { error: "Sign in first", code: "NO_SESSION" });
        // Rate limit scans per user (30 per minute).
        if (rateLimited("scan:" + who.userId, 30, 60_000)) return send(res, 429, { error: "Too many scans. Wait a moment.", code: "RATE_LIMIT" });
        const body = await readJson(req, 64 * 1024);
        const roomId = String(body.roomId || "");
        const code = String(body.code || "").trim();
        const row = db.prepare("SELECT json FROM zones WHERE roomId = ?").get(roomId);
        if (!row) return send(res, 404, { error: "Unknown room", code: "NO_ZONE" });
        let zone = {};
        try { zone = JSON.parse(row.json); } catch (e) {}
        const st = getConfig("settings", {}) || {};

        const parts = code.split("|");
        let slot = 0, sig = "";
        if (parts[0] === "CP1" && parts[1] === roomId && parts.length >= 4) {
          slot = parseInt(parts[2], 10) || 0;
          sig = parts[3];
        } else if (parts[0] === "CP1" && parts[1] === roomId && parts.length === 3) {
          sig = parts[2];
        }
        const secret = String(zone.secret || "");
        const expect = (s) => digest(roomId + "|" + s + "|" + secret);
        const rotating = !!(zone.rotateSec || st.rotateClassQR);
        const ok = sig && (sig === expect(String(slot)) ||
          (rotating && (sig === expect(String(slot - 1)) || sig === expect(String(slot + 1)))));
        if (!ok) return send(res, 403, { error: "That code is not valid or has expired", code: "BAD_CODE" });

        if (!onSchoolNetwork(req, st)) {
          return send(res, 403, { error: "Connect to the school Wi-Fi to record a scan", code: "OFF_NETWORK" });
        }

        if (st.requireGeofence) {
          const centre = (getConfig("school", {}) || {}).centre || {};
          const lat = Number(body.lat), lng = Number(body.lng);
          if (centre.lat != null && centre.lng != null) {
            if (!isFinite(lat) || !isFinite(lng)) {
              return send(res, 403, { error: "Turn location on and try again", code: "NO_GPS" });
            }
            const d = metresBetween(lat, lng, Number(centre.lat), Number(centre.lng));
            if (d > (Number(st.geofenceMeters) || 250)) {
              return send(res, 403, { error: "You are outside the school grounds", code: "OFF_CAMPUS" });
            }
          }
        }

        if (st.requireGateFirst && zone.kind === "class") {
          const gate = (live.gateLog[localDay(new Date())] || {})[who.userId];
          if (!gate || !gate.in) {
            return send(res, 403, { error: "Scan the gate code first", code: "NO_GATE" });
          }
        }

        const rot = Number(zone.rotateSec || st.rotateSec) || 45;
        const win = Math.floor(Date.now() / 1000 / rot);
        const winKey = who.userId + "|" + roomId + "|" + win;
        if (scanWindows.has(winKey)) {
          return send(res, 409, { error: "That code was already used. Wait for the screen to refresh.", code: "REPLAY" });
        }
        pruneScans();
        scanWindows.set(winKey, now());
        const scanId = token();
        scanGrants.set(scanId, {
          userId: who.userId, roomId, kind: zone.kind || "class", ts: now(), used: false,
        });
        return send(res, 200, { ok: true, scanId, roomId, at: now() });
      }

      // ---- day view / reports -----------------------------------------
      if (p === "/api/state" && req.method === "GET") {
        const date = url.searchParams.get("date") || localDay(new Date());
        const dayStart = new Date(date + "T00:00:00").getTime();
        const dayEnd = dayStart + 86400000;
        return send(res, 200, {
          date,
          gateLog: live.gateLog[date] || {},
          events: live.events.filter((e) => e.ts >= dayStart && e.ts < dayEnd),
          alerts: live.alerts.filter((a) => a.ts >= dayStart && a.ts < dayEnd),
          overrides: live.overrides[date] || {},
          covers: live.covers.filter((c) => !c.ts || (c.ts >= dayStart && c.ts < dayEnd)),
        });
      }

      // ---- full export (leaders only) ----------------------------------
      if (p === "/api/export" && req.method === "GET") {
        if (!(who.kind === "session" && LEADER_ROLES.has(who.role))) return send(res, 403, { error: "Leaders only" });
        res.writeHead(200, Object.assign({
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="classpulse-server-export.json"',
        }, corsHeaders()));
        return res.end(JSON.stringify({
          exportedAt: new Date().toISOString(),
          version: VERSION,
          school: getConfig("school", null),
          settings: getConfig("settings", null),
          calendar: getConfig("calendar", null),
          users: publicUsers(),
          zones: db.prepare("SELECT json FROM zones").all().map((r) => JSON.parse(r.json)),
          timetable: db.prepare("SELECT json FROM timetable").all().map((r) => JSON.parse(r.json)),
          activity: {
            events: live.events, alerts: live.alerts, overrides: live.overrides,
            gateLog: live.gateLog, covers: live.covers, leaves: live.leaves,
            plans: live.plans, marks: live.marks, audit: live.audit,
          },
          academic: {
            students: Object.values(live.acad.students), syllabus: Object.values(live.acad.syllabus),
            progress: Object.values(live.acad.progress), assessments: Object.values(live.acad.assessments),
            markAudit: live.acad.markaudit,
          },
          ops: db.prepare("SELECT payload FROM ops ORDER BY seq ASC").all().map((r) => JSON.parse(r.payload)),
        }, null, 2));
      }

      // ---- statistics --------------------------------------------------
      if (p === "/api/stats" && req.method === "GET") {
        const rows = db.prepare(
          `SELECT kind, COUNT(*) AS n FROM ops GROUP BY kind ORDER BY n DESC`
        ).all();
        const perDay = db.prepare(
          `SELECT date(serverTs/1000,'unixepoch','localtime') AS day, COUNT(*) AS n
             FROM ops GROUP BY day ORDER BY day DESC LIMIT 30`
        ).all();
        return send(res, 200, {
          byKind: rows, perDay,
          clients: clients.size,
          sessions: db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
          devices: db.prepare("SELECT COUNT(*) AS n FROM devices").get().n,
          uptimeSec: Math.round((Date.now() - STARTED) / 1000),
        });
      }

      // ---- live stream --------------------------------------------------
      if (p === "/api/stream" && req.method === "GET") {
        res.writeHead(200, Object.assign({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        }, corsHeaders()));
        res.write("retry: 3000\n\n");
        res.write("data: " + JSON.stringify({
          type: "hello", version: VERSION, serverTime: now(),
          clients: clients.size + 1,
        }) + "\n\n");
        const entry = { res, device: String(clientDevice(req) || who.device || "") || null, role: who.role, userId: who.userId || null };
        clients.add(entry);
        log("stream open ·", clients.size, "client(s)");
        const bye = () => { clients.delete(entry); log("stream closed ·", clients.size, "client(s)"); };
        req.on("close", bye);
        req.on("error", bye);
        return;
      }

      return send(res, 404, { error: "No such endpoint: " + p });
    } catch (e) {
      log("api error", p, e.message);
      return send(res, 400, { error: e.message || "Bad request" });
    }
  }

  /* --------------------------------------------------------- static files */
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { error: "Method not allowed" });
    }
    let rel = decodeURIComponent(p);
    if (rel === "/" || rel === "") rel = "/index.html";
    // Refuse any attempt to climb out of the app directory, encoded or not.
    if (rel.split(/[/\\]/).indexOf("..") >= 0) return send(res, 403, { error: "Forbidden" });
    if (rel.indexOf("\0") >= 0) return send(res, 400, { error: "Bad request" });
    const full = path.join(APP_DIR, path.normalize(rel).replace(/^([/\\])+/, ""));
    if (!full.startsWith(APP_DIR)) return send(res, 403, { error: "Forbidden" });
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) {
        // unknown path → hand back the SPA shell so deep links keep working
        const shell = path.join(APP_DIR, "index.html");
        return fs.readFile(shell, (e2, buf) => {
          if (e2) return send(res, 404, { error: "Not found" });
          res.writeHead(200, Object.assign({
            "Content-Type": MIME[".html"], "Cache-Control": "no-cache",
          }, corsHeaders()));
          res.end(buf);
        });
      }
      const ext = path.extname(full).toLowerCase();
      fs.readFile(full, (e2, buf) => {
        if (e2) return send(res, 500, { error: "Read error" });
        // Code must always be revalidated: a school should never be stuck on a
        // stale build after an update. Icons and vendored libraries are large
        // and versioned, so they can be cached hard.
        const revalidate = ext === ".html" || ext === ".js" || ext === ".css" ||
          ext === ".webmanifest" || ext === ".json" || path.basename(full) === "sw.js";
        const etag = '"' + buf.length.toString(16) + "-" +
          crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16) + '"';
        if (revalidate && req.headers["if-none-match"] === etag) {
          res.writeHead(304, Object.assign({ ETag: etag, "Cache-Control": "no-cache" }, corsHeaders()));
          return res.end();
        }
        res.writeHead(200, Object.assign({
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Length": buf.length,
          "Cache-Control": revalidate ? "no-cache" : "public, max-age=604800",
          "ETag": etag,
          "Service-Worker-Allowed": "/",
        }, corsHeaders()));
        res.end(req.method === "HEAD" ? undefined : buf);
      });
    });
  } catch (e) {
    log("static error", p, e.message);
    return send(res, 400, { error: "Bad request" });
  }
});

function localDay(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// Teachers only need the geography and the timetable — not the whole roster.
function teacherSnapshot() {
  return {
    version: VERSION,
    serverTime: now(),
    school: getConfig("school", null),
    settings: getConfig("settings", null),
    calendar: getConfig("calendar", null),
    classes: db.prepare("SELECT json FROM classes").all().map((r) => JSON.parse(r.json)),
    rooms: db.prepare("SELECT json FROM rooms").all().map((r) => JSON.parse(r.json)),
    zones: db.prepare("SELECT json FROM zones").all().map((r) => JSON.parse(r.json)),
    timetable: db.prepare("SELECT json FROM timetable").all().map((r) => JSON.parse(r.json)),
  };
}

/* ---------------------------------------------------------------- listen */
// Malformed requests should never take the school's server down.
server.on("clientError", (err, socket) => {
  try { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); } catch (e) {}
});
process.on("uncaughtException", (e) => log("uncaught exception:", e && e.message));
process.on("unhandledRejection", (e) => log("unhandled rejection:", e && e.message));

server.listen(PORT, HOST, () => {
  const nets = require("node:os").networkInterfaces();
  const lan = [];
  Object.values(nets).forEach((list) => (list || []).forEach((n) => {
    if (n.family === "IPv4" && !n.internal) lan.push(n.address);
  }));
  console.log("");
  console.log("  ClassPulse server " + VERSION + "  ·  " + new Date().toLocaleString());
  console.log("  ├─ this computer : http://localhost:" + PORT + "/");
  lan.forEach((ip) => console.log("  ├─ on your Wi-Fi : http://" + ip + ":" + PORT + "/"));
  console.log("  ├─ database      : " + DB_PATH);
  console.log("  └─ health        : http://localhost:" + PORT + "/api/health");
  console.log("");
  console.log("  Open the Wi-Fi address on a phone, then “Add to Home screen”.");
  console.log("  Cameras need http://localhost or https:// — see docs/DEPLOYMENT.md.");
  console.log("");
});

process.on("SIGINT", () => {
  log("shutting down");
  try { db.close(); } catch (e) {}
  process.exit(0);
});
