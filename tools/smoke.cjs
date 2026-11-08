/* ==========================================================================
   ClassPulse — tools/smoke.cjs
   End-to-end check of a running ClassPulse server and the static app.
   Start the server, then run:

       node server/server.cjs            (in one terminal)
       node tools/smoke.cjs              (in another)

   Optional: node tools/smoke.cjs http://192.168.1.20:8787
   ========================================================================== */
"use strict";

const BASE = (process.argv[2] || process.env.CLASSPULSE_URL || "http://localhost:8787").replace(/\/+$/, "");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name + (extra ? "  → " + extra : "")); }
}
function section(t) { console.log("\n" + t); }

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

// fetch() normalises "%2e%2e" into ".." before the request leaves the machine,
// so traversal must be probed over a raw socket to test the server itself.
function rawGet(rawPath, portOverride) {
  return new Promise((resolve) => {
    const net = require("node:net");
    const u = new URL(BASE);
    const port = portOverride || Number(u.port || (u.protocol === "https:" ? 443 : 80));
    const sock = net.connect(port, u.hostname, () => {
      sock.write("GET " + rawPath + " HTTP/1.1\r\nHost: " + u.host + "\r\nConnection: close\r\n\r\n");
    });
    let buf = "";
    const done = () => resolve(buf);
    sock.on("data", (d) => (buf += d.toString("utf8")));
    sock.on("end", done);
    sock.on("close", done);
    sock.on("error", () => resolve("<<error>>"));
  });
}

(async function run() {
  console.log("ClassPulse smoke test against " + BASE);

  /* ---------------------------------------------------------------- health */
  section("Health & static app");
  let r = await api("GET", "/api/health");
  ok("GET /api/health is 200", r.status === 200, "got " + r.status);
  ok("health reports the product name", r.json && r.json.name === "ClassPulse");
  ok("health reports users", r.json && r.json.users > 0, "users=" + (r.json && r.json.users));
  ok("health reports timetable rows", r.json && r.json.timetableRows > 0, "rows=" + (r.json && r.json.timetableRows));

  const home = await fetch(BASE + "/");
  const html = await home.text();
  ok("GET / serves the app shell", home.status === 200 && /<div id="app"/.test(html));
  ok("shell loads every script in order",
    ["util.js", "store.js", "sync.js", "views-admin.js", "app.js"].every((f) => html.indexOf(f) >= 0));

  const mani = await fetch(BASE + "/manifest.webmanifest");
  const mj = await mani.json().catch(() => null);
  ok("manifest is served", mani.status === 200 && !!mj);
  ok("manifest has 192 + 512 icons",
    !!mj && mj.icons.some((i) => i.sizes === "192x192") && mj.icons.some((i) => i.sizes === "512x512"));
  ok("manifest is standalone", !!mj && mj.display === "standalone");

  for (const f of ["/js/app.js", "/css/theme.css", "/icons/icon-192.png", "/vendor/jsQR.js"]) {
    const res = await fetch(BASE + f);
    ok("asset " + f, res.status === 200, "got " + res.status);
  }

  /* ----------------------------------------------------------------- login */
  section("Authentication");
  const bad = await api("POST", "/api/login", { userId: "u-dos", pin: "9999" });
  ok("wrong PIN is rejected", bad.status === 401, "got " + bad.status);

  const dos = await api("POST", "/api/login", { userId: "u-dos", pin: "2222" });
  ok("DOS signs in with PIN 2222", dos.status === 200 && !!dos.json.token, JSON.stringify(dos.json).slice(0, 120));
  const dosTok = dos.json.token;
  ok("DOS is given role dos", dos.json.role === "dos");
  ok("DOS snapshot includes users", Array.isArray(dos.json.snapshot.users) && dos.json.snapshot.users.length > 20);
  ok("DOS snapshot includes the weekly timetable",
    Array.isArray(dos.json.snapshot.timetable) && dos.json.snapshot.timetable.length >= 400,
    "rows=" + (dos.json.snapshot.timetable || []).length);
  ok("PIN is never sent back", JSON.stringify(dos.json).indexOf("\"pin\"") === -1);

  const adm = await api("POST", "/api/login", { userId: "u-admin", pin: "0000" });
  ok("Admin signs in with PIN 0000", adm.status === 200 && adm.json.role === "admin");
  const admTok = adm.json.token;

  const teach = await api("POST", "/api/login", { userId: "t1", pin: "3001" });
  ok("Teacher t1 signs in with PIN 3001", teach.status === 200 && teach.json.role === "teacher");
  const teachTok = teach.json.token;
  ok("teacher snapshot omits the staff roster", teach.json.snapshot.users === undefined);
  ok("teacher snapshot still carries zones", Array.isArray(teach.json.snapshot.zones) && teach.json.snapshot.zones.length > 0);

  const anon = await api("GET", "/api/bootstrap");
  ok("bootstrap without a token is 401", anon.status === 401, "got " + anon.status);

  const dev = await api("POST", "/api/device", { device: "smoke-device", label: "smoke test" });
  ok("anonymous device can register", dev.status === 200 && !!dev.json.token);
  const devTok = dev.json.token;

  /* ------------------------------------------------------------------- ops */
  section("Scans, ops and live fan-out");
  const canBootstrap = await api("GET", "/api/bootstrap", null, devTok);
  ok("registered device can fetch a snapshot", canBootstrap.status === 200);

  // Open the live stream first so we can prove fan-out.
  const streamCtrl = new AbortController();
  const received = [];
  const streamReady = fetch(BASE + "/api/stream?device=smoke-listener&token=" + dosTok, {
    signal: streamCtrl.signal,
    headers: { Accept: "text/event-stream" },
  }).then(async (res) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (line) { try { received.push(JSON.parse(line.slice(6))); } catch (e) {} }
        }
      }
    } catch (e) { /* aborted at the end */ }
  });

  await new Promise((r2) => setTimeout(r2, 400));

  const stamp = Date.now();
  const eventId = "ev-smoke-" + stamp;
  const ops = [
    { kind: "event", id: eventId, ts: stamp, data: { id: eventId, ts: stamp, type: "class-in", userId: "t1", roomId: "room-S1A", zone: "room-S1A", method: "qr" } },
    { kind: "alert", id: "al-smoke-" + stamp, ts: stamp, data: { id: "al-smoke-" + stamp, ts: stamp, level: "warn", audience: ["dos", "head"], title: "Smoke test", body: "Automated check" } },
    { kind: "override", id: stamp + "|1|S1A", dateKey: "2026-01-01", key: "2026-01-01#1#S1A", data: { inAt: "08:02", pushedBy: "smoke" } },
  ];
  const pushed = await api("POST", "/api/ops", { device: "smoke-device", ops }, devTok);
  ok("device ops are accepted", pushed.status === 200 && pushed.json.count === 3, JSON.stringify(pushed.json));

  const priv = await api("POST", "/api/ops", { ops: [{ kind: "settings", id: "x", data: { settings: { hacked: true } } }] }, devTok);
  ok("a plain device cannot change school settings", priv.status === 200 && priv.json.count === 0);

  const lead = await api("POST", "/api/ops", { ops: [{ kind: "settings", id: "st-" + stamp, data: { settings: { schoolStart: "07:30" } } }] }, admTok);
  ok("admin can push settings", lead.status === 200 && lead.json.count === 1);

  await new Promise((r2) => setTimeout(r2, 1200));
  const gotOp = received.some((m) => (m.type === "ops" || m.type === "op") &&
    JSON.stringify(m).indexOf(eventId) >= 0);
  ok("live stream received the broadcast", gotOp, "messages=" + received.length);
  ok("stream opened with a hello", received.some((m) => m.type === "hello"));
  ok("sender is not echoed to itself", !received.some((m) => m.from === "smoke-listener"));

  // The DOS's own push should come back to the listener, so this also proves
  // that a *different* device's scan shows up live.
  streamCtrl.abort();
  await streamReady.catch(() => {});

  const state = await api("GET", "/api/state?date=" + new Date().toISOString().slice(0, 10), null, dosTok);
  ok("day state lists the new event", state.status === 200 && state.json.events.some((e) => e.id === eventId));
  ok("day state lists the new alert", state.json.alerts.some((a) => a.id === "al-smoke-" + stamp));

  /* -------------------------------------------------------------- reporting */
  section("Reports & housekeeping");
  const stats = await api("GET", "/api/stats", null, dosTok);
  ok("stats endpoint works", stats.status === 200 && Array.isArray(stats.json.byKind));
  ok("stats counted the scan events", (stats.json.byKind.find((k) => k.kind === "event") || {}).n >= 1);

  const expDos = await api("GET", "/api/export", null, dosTok);
  ok("DOS can export the server record", expDos.status === 200 && Array.isArray(expDos.json.ops));

  const expDev = await api("GET", "/api/export", null, devTok);
  ok("a plain device cannot export", expDev.status === 403, "got " + expDev.status);

  const nope = await api("GET", "/api/nothing-here", null, dosTok);
  ok("unknown API path gives a clean 404", nope.status === 404);

  const spa = await fetch(BASE + "/dos/pulse");
  const spaText = await spa.text();
  ok("deep links fall back to the app shell", spa.status === 200 && spaText.indexOf('<div id="app"') >= 0);

  const trav = await rawGet("/%2e%2e/server/seed.json");
  ok("path traversal is refused", /^HTTP\/1\.1 403/.test(trav) && trav.indexOf("seededAt") === -1,
    trav.split("\r\n")[0]);

  const trav2 = await rawGet("/..%2fserver%2fseed.json");
  ok("encoded path traversal is refused", /^HTTP\/1\.1 403/.test(trav2) && trav2.indexOf("seededAt") === -1,
    trav2.split("\r\n")[0]);

  const trav3 = await rawGet("/../../server/seed.json");
  ok("plain path traversal is refused", /^HTTP\/1\.1 403/.test(trav3) && trav3.indexOf("seededAt") === -1,
    trav3.split("\r\n")[0]);

  const nul = await rawGet("/js/app.js%00.png");
  ok("null-byte paths do not leak files", nul.indexOf("seededAt") === -1);

  const dbFile = await fetch(BASE + "/classpulse.db");
  const dbText = await dbFile.text();
  ok("the database is never served", dbText.indexOf("SQLite format 3") === -1);

  const opt = await fetch(BASE + "/api/health", { method: "OPTIONS" });
  ok("CORS preflight is allowed", opt.status === 204 && opt.headers.get("access-control-allow-origin") === "*");

  /* ------------------------------------------------------------- finish up */
  section("Result");
  console.log("  " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("\nSmoke test crashed:", e && e.message);
  console.error("Is the server running?  node server/server.cjs");
  process.exit(2);
});
