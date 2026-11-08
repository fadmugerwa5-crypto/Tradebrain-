/* ==========================================================================
   ClassPulse — tools/academic-test.cjs
   Checks the academic modules against a real server:
     roster + syllabus (leaders only) · coverage confirmation · assessment
     workflow (draft → submit → return/approve) · locked after submit ·
     marks validation · server-side audit trail · role-filtered delivery ·
     persistence across restart · optional AI is off by default and isolated.
   Self-contained: starts its own server on port 8793.
   Run:  node tools/academic-test.cjs
   ========================================================================== */
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 8793;
const BASE = "http://localhost:" + PORT;
const DB = path.join(__dirname, "..", "server", "academic-test.db");
const MOCK_PORT = 8794;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, {
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
function rm(file) { for (const f of [file, file + "-wal", file + "-shm"]) { try { fs.unlinkSync(f); } catch (e) {} } }
async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
function start() {
  return spawn(process.execPath, [path.join(__dirname, "..", "server", "server.cjs"),
    "--port", String(PORT), "--quiet", "--db", DB], { stdio: "ignore" });
}
let opN = 0;
const op = (data) => ({ kind: "acad", id: "op-" + (++opN) + "-" + Math.random().toString(36).slice(2, 7), data });
async function push(token, data) {
  const o = op(data);
  const r = await call("POST", "/api/ops", { device: "dev-test", ops: [o] }, token);
  return { r, o, accepted: !!(r.data && (r.data.accepted || []).includes(o.id)), reason: r.data && r.data.rejected && r.data.rejected[0] && r.data.rejected[0].reason, rec: r.data && r.data.acad && r.data.acad[0] };
}
async function login(staffNo, pin) {
  const r = await call("POST", "/api/login", { staffNo, pin });
  return r.data && r.data.token;
}

(async () => {
  console.log("\nClassPulse academic modules check\n");
  rm(DB);
  let child = start();
  let mock = null;
  let exitCode = 0;
  try {
    if (!(await waitForServer())) throw new Error("server did not start on " + PORT);

    const mk = (id, name, role, staffNo, pin, subjects) => ({ id, name, role, staffNo, dept: "X", subjects: subjects || [], active: true, pin: digest(pin) });
    const doc = {
      school: { name: "Academic Test School", term: "Term I", centre: {} },
      settings: { schoolStart: "07:30", lateAfter: "08:00", schoolEnd: "15:10", periods: [{ n: 1, start: "08:00", end: "08:40" }] },
      classes: [{ id: "S1A", level: "S1", stream: "A" }, { id: "S1B", level: "S1", stream: "B" }],
      rooms: [{ id: "room-S1A", name: "S1A", kind: "class", classId: "S1A" }],
      zones: [{ roomId: "room-S1A", label: "S1A", kind: "class", code: "S1A", secret: "s" }],
      subjects: ["Mathematics", "English"],
      users: [
        mk("u-admin", "Admin", "admin", "ADM-001", "1234"),
        mk("u-dos", "Director", "dos", "DOS-001", "2222"),
        mk("t-1", "Math Teacher", "teacher", "T-1", "1111", ["Mathematics"]),
        mk("t-2", "English Teacher", "teacher", "T-2", "2222", ["English"]),
      ],
      timetable: [
        { id: "tt1", day: 1, period: 1, classId: "S1A", teacherId: "t-1", subject: "Mathematics", roomId: "room-S1A" },
        { id: "tt2", day: 2, period: 1, classId: "S1B", teacherId: "t-2", subject: "English", roomId: "room-S1A" },
      ],
    };
    let r = await call("POST", "/api/setup", { data: doc });
    ok("school set up", r.status === 200 && r.data.ok, r.data);
    const admin = r.data.token;
    const dos = await login("DOS-001", "2222");
    const t1 = await login("T-1", "1111");
    const t2 = await login("T-2", "2222");
    ok("all four accounts sign in", !!(admin && dos && t1 && t2));

    /* ---------------------------------------------- roster + syllabus */
    let x = await push(t1, { col: "students", id: "st-hack", name: "Hack", classId: "S1A" });
    ok("a teacher cannot edit the class list", !x.accepted && /Director/.test(x.reason || ""), x.reason);
    x = await push(t1, { col: "syllabus", id: "sy-hack", subject: "Mathematics", level: "S1", topic: "Hack" });
    ok("a teacher cannot change the syllabus", !x.accepted, x.reason);
    x = await push(null, { col: "students", id: "st-anon", name: "Anon", classId: "S1A" });
    ok("no session, no write", x.r.status === 401 || !x.accepted, x.r.status);

    for (const [i, n] of ["Amina", "Brian", "Cathy"].entries()) {
      x = await push(dos, { col: "students", id: "st-" + (i + 1), name: n, admNo: "A" + (i + 1), classId: "S1A", active: true });
      ok("DOS adds learner " + n, x.accepted, x.reason);
    }
    x = await push(dos, { col: "students", id: "st-bad", name: "Nobody", classId: "S9Z" });
    ok("a learner cannot join a class that does not exist", !x.accepted, x.reason);

    x = await push(dos, { col: "syllabus", id: "sy-1", subject: "Mathematics", level: "S1", term: "1", week: 1, order: 1, topic: "Sets", subtopics: ["Union", "Intersection"], objectives: ["Define a set"], units: 1 });
    ok("DOS adds a syllabus topic", x.accepted, x.reason);
    x = await push(dos, { col: "syllabus", id: "sy-2", subject: "Mathematics", level: "S1", term: "1", week: 3, order: 2, topic: "Integers" });
    ok("DOS adds a second topic", x.accepted, x.reason);
    x = await push(dos, { col: "syllabus", id: "sy-3", subject: "Mathematics", level: "S1", term: "1", order: 3 });
    ok("a topic without a name is refused", !x.accepted, x.reason);

    /* ------------------------------------------------------ coverage */
    const pg = (topic, cls) => "pg|" + topic + "|" + cls;
    x = await push(t1, { col: "progress", id: pg("sy-1", "S1A"), topicId: "sy-1", classId: "S1A", status: "completed" });
    ok("completing a topic needs explicit confirmation", !x.accepted && /Confirm/i.test(x.reason || ""), x.reason);
    x = await push(t1, { col: "progress", id: pg("sy-1", "S1A"), topicId: "sy-1", classId: "S1A", status: "completed", confirmed: true });
    ok("confirmed completion is accepted", x.accepted && x.rec && x.rec.status === "completed" && x.rec.confirmedBy === "t-1", x);
    x = await push(t2, { col: "progress", id: pg("sy-2", "S1A"), topicId: "sy-2", classId: "S1A", status: "in-progress" });
    ok("a teacher who does not teach it cannot record coverage", !x.accepted && /timetabled/.test(x.reason || ""), x.reason);
    x = await push(t1, { col: "progress", id: pg("sy-2", "S1B"), topicId: "sy-2", classId: "S1B", status: "in-progress" });
    ok("coverage cannot be recorded for a class they do not teach", !x.accepted, x.reason);
    x = await push(t1, { col: "progress", id: pg("sy-2", "S1A"), topicId: "sy-2", classId: "S1A", status: "not-completed" });
    ok("'not completed' needs a reason", !x.accepted, x.reason);
    x = await push(t1, { col: "progress", id: pg("sy-2", "S1A"), topicId: "sy-2", classId: "S1A", status: "not-completed", note: "Lost two lessons to a school event" });
    ok("'not completed' with a reason is accepted", x.accepted, x.reason);
    x = await push(t1, { col: "progress", id: "pg|forged", topicId: "sy-2", classId: "S1A", status: "in-progress" });
    ok("coverage records must use the canonical id", !x.accepted, x.reason);

    /* ---------------------------------------------------- assessments */
    const base = { col: "assessments", classId: "S1A", subject: "Mathematics", title: "Integers test", kind: "test", term: "1", total: 100 };
    x = await push(t2, Object.assign({ id: "as-x" }, base));
    ok("a teacher cannot create an assessment for a class/subject they do not teach", !x.accepted, x.reason);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-1": 75, "st-2": 120 } }, base));
    ok("a mark above the total is refused", !x.accepted && /outside/.test(x.reason || ""), x.reason);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-ghost": 50 } }, base));
    ok("a mark for someone who is not in the class is refused", !x.accepted, x.reason);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-1": 75, "st-2": "AB" }, status: "approved" }, base));
    ok("a teacher saving with status 'approved' only gets a draft", x.accepted && x.rec.status === "draft", x.rec);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-1": 75, "st-2": "AB", "st-3": 40 }, status: "submitted" }, base));
    ok("teacher submits results", x.accepted && x.rec.status === "submitted" && !!x.rec.submittedAt, x);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-1": 99 } }, base));
    ok("submitted results are locked for the teacher", !x.accepted && /locked/i.test(x.reason || ""), x.reason);
    x = await push(t1, { col: "assessments", id: "as-empty", classId: "S1A", subject: "Mathematics", title: "Empty", total: 10, status: "submitted" });
    ok("cannot submit with no marks", !x.accepted, x.reason);

    x = await push(dos, { col: "assessments", id: "as-1", status: "returned" });
    ok("returning results needs a note", !x.accepted, x.reason);
    x = await push(dos, { col: "assessments", id: "as-1", status: "returned", returnNote: "Check Brian's mark" });
    ok("DOS returns results with a note", x.accepted && x.rec.status === "returned" && x.rec.returnNote === "Check Brian's mark" && x.rec.reviewedBy === "u-dos", x);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-1": 75, "st-2": "AB", "st-3": 45 }, status: "submitted" }, base));
    ok("teacher corrects and resubmits", x.accepted && x.rec.status === "submitted" && x.rec.marks["st-3"] === 45, x);
    x = await push(t1, { col: "assessments", id: "as-1", status: "approved" });
    ok("a teacher cannot approve their own results", !x.accepted, x.reason);
    x = await push(dos, { col: "assessments", id: "as-1", status: "approved" });
    ok("DOS approves", x.accepted && x.rec.status === "approved", x);
    x = await push(t1, Object.assign({ id: "as-1", marks: { "st-1": 100 }, status: "draft" }, base));
    ok("approved results are locked for the teacher", !x.accepted, x.reason);
    x = await push(dos, { col: "assessments", id: "as-1", marks: { "st-1": 80, "st-2": "AB", "st-3": 45 } });
    ok("changing approved marks needs a reason", !x.accepted && /reason/i.test(x.reason || ""), x.reason);
    x = await push(dos, { col: "assessments", id: "as-1", marks: { "st-1": 80, "st-2": "AB", "st-3": 45 }, reason: "Marking error found on re-check" });
    ok("DOS corrects approved marks with a reason", x.accepted && x.rec.marks["st-1"] === 80, x);
    x = await push(dos, { col: "assessments", id: "as-1", deleted: true });
    ok("approved results cannot be deleted", !x.accepted, x.reason);

    /* ----------------------------------------------------- lesson plans */
    const planOp = (token, data) => call("POST", "/api/ops", { device: "dev-test", ops: [{ kind: "plan", id: "op-plan-" + Math.random().toString(36).slice(2, 7), data }] }, token);
    r = await planOp(t1, { id: "pl-1", by: "t-1", status: "approved", review: { comment: "self-approved" }, plan: { meta: { topic: "Sets" } }, text: "x", ts: Date.now() });
    let ex = await call("GET", "/api/export", null, admin);
    let pl = ((ex.data && ex.data.activity && ex.data.activity.plans) || []).find((p) => p.id === "pl-1");
    ok("a teacher cannot approve their own lesson plan (it is saved as a draft, review stripped)", !!pl && pl.status === "draft" && !pl.review, pl);
    await planOp(t1, { id: "pl-1", by: "t-1", status: "submitted", plan: { meta: { topic: "Sets" } }, text: "x", ts: Date.now() });
    r = await planOp(t2, { id: "pl-1", by: "t-2", status: "submitted", text: "hijack", ts: Date.now() });
    ex = await call("GET", "/api/export", null, admin);
    pl = ex.data.activity.plans.find((p) => p.id === "pl-1");
    ok("another teacher cannot overwrite it", r.data.rejected && r.data.rejected.length === 1 && pl.text === "x", r.data);
    await planOp(dos, { id: "pl-1", by: "t-1", status: "approved", review: { by: "u-dos", comment: "Good" }, plan: { meta: { topic: "Sets" } }, text: "x", ts: Date.now() });
    r = await planOp(t1, { id: "pl-1", by: "t-1", status: "draft", text: "changed after approval", ts: Date.now() });
    ex = await call("GET", "/api/export", null, admin);
    pl = ex.data.activity.plans.find((p) => p.id === "pl-1");
    ok("the DOS approves; the teacher can no longer change an approved plan", pl.status === "approved" && pl.text === "x" && r.data.rejected.length === 1, pl);

    /* ----------------------------------------------- idempotent retry */
    const dup = op({ col: "students", id: "st-4", name: "Dan", classId: "S1A" });
    await call("POST", "/api/ops", { device: "dev-test", ops: [dup] }, dos);
    const again = await call("POST", "/api/ops", { device: "dev-test", ops: [dup] }, dos);
    ok("a retried operation is accepted without error", (again.data.accepted || []).includes(dup.id), again.data);

    /* ----------------------------------------------- who sees what */
    const lead = await call("GET", "/api/acad", null, dos);
    ok("DOS sees every assessment, learner and topic", lead.data.assessments.length === 1 && lead.data.students.length >= 4 && lead.data.syllabus.length === 2, Object.keys(lead.data));
    const audit = lead.data.markaudit || [];
    const acts = audit.map((a) => a.action);
    ok("the audit trail records create, submit, return, approve", ["created", "submitted", "returned", "approved"].every((a) => acts.includes(a)), acts);
    const edit = audit.find((a) => a.action === "edited-after-approval");
    ok("an after-approval edit is audited with who, what and why", !!edit && edit.byName === "Director" && edit.reason.includes("re-check") && edit.changes.some((c) => c.studentId === "st-1" && c.from === 75 && c.to === 80), edit);
    const own = await call("GET", "/api/acad", null, t1);
    ok("the owning teacher sees their assessment", own.data.assessments.length === 1 && own.data.assessments[0].status === "approved");
    ok("teachers never receive the audit trail", (own.data.markaudit || []).length === 0);
    ok("a teacher gets the roster of classes they teach", own.data.students.length >= 4 && own.data.students.every((s) => s.classId === "S1A"));
    const other = await call("GET", "/api/acad", null, t2);
    ok("another teacher sees no marks or progress of colleagues", other.data.assessments.length === 0 && other.data.progress.length === 0, other.data);
    ok("another teacher gets no roster for classes they do not teach", other.data.students.length === 0);
    ok("every teacher can read the syllabus", other.data.syllabus.length === 2);
    r = await call("GET", "/api/acad");
    ok("no session, no academic data", r.status === 401, r.status);

    /* ------------------------------------------- restart persistence */
    child.kill();
    await new Promise((res) => setTimeout(res, 400));
    child = start();
    ok("server restarts", await waitForServer());
    const dos2 = await login("DOS-001", "2222");
    const after = await call("GET", "/api/acad", null, dos2);
    const a1 = (after.data.assessments || [])[0];
    ok("academic records survive a restart", !!a1 && a1.status === "approved" && a1.marks["st-1"] === 80 && after.data.syllabus.length === 2 && (after.data.markaudit || []).length === audit.length, { a1, n: (after.data.markaudit || []).length, was: audit.length });

    /* ----------------------------------------------- optional AI */
    const tT1 = await login("T-1", "1111");
    const adm = await login("ADM-001", "1234");
    r = await call("GET", "/api/ai/status", null, tT1);
    ok("AI is off by default", r.status === 200 && r.data.enabled === false, r.data);
    r = await call("POST", "/api/ai/ask", { task: "explain", topicId: "sy-1" }, tT1);
    ok("asking while AI is off fails politely (503, AI_OFF)", r.status === 503 && r.data.code === "AI_OFF", r.data);
    r = await call("POST", "/api/ai/config", { enabled: true, apiKey: "sk-test" }, tT1);
    ok("a teacher cannot configure AI", r.status === 403, r.status);
    r = await call("POST", "/api/ai/config", { enabled: true, apiKey: "sk-test", endpoint: "http://example.com/v1" }, adm);
    ok("a plain-http endpoint to another host is refused", r.status === 400, r.data);

    let lastBody = null;
    mock = http.createServer((q, s) => {
      let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
        try { lastBody = { headers: q.headers, json: JSON.parse(b) }; } catch (e) {}
        s.writeHead(200, { "content-type": "application/json" });
        s.end(JSON.stringify({ content: [{ type: "text", text: "Sets are collections of distinct objects." }] }));
      });
    }).listen(MOCK_PORT);
    r = await call("POST", "/api/ai/config", { enabled: true, apiKey: "sk-test", endpoint: "http://127.0.0.1:" + MOCK_PORT + "/v1/messages", dailyLimit: 2 }, adm);
    ok("admin configures AI", r.status === 200 && r.data.enabled === true && r.data.hasKey === true, r.data);
    r = await call("GET", "/api/ai/status", null, tT1);
    ok("teachers can see AI is on but never the key", r.data.enabled === true && r.data.apiKey === undefined && r.data.hasKey === undefined, r.data);
    r = await call("POST", "/api/ai/ask", { task: "explain", topicId: "sy-1" }, tT1);
    ok("a teacher gets an AI answer", r.status === 200 && /Sets are collections/.test(r.data.text), r.data);
    ok("the request used the school's syllabus entry and the server-held key", !!lastBody && lastBody.headers["x-api-key"] === "sk-test" && /Union, Intersection/.test(lastBody.json.system) && /Define a set/.test(lastBody.json.system), lastBody && lastBody.json.system);
    r = await call("POST", "/api/ai/ask", { task: "nonsense", topicId: "sy-1" }, tT1);
    ok("an unknown AI task is refused", r.status === 400, r.status);
    await call("POST", "/api/ai/ask", { task: "notes", topicId: "sy-1" }, tT1);
    r = await call("POST", "/api/ai/ask", { task: "revision", topicId: "sy-1" }, tT1);
    ok("the per-teacher daily AI limit holds", r.status === 429 && r.data.code === "AI_LIMIT", r.data);
    mock.close(); mock = null;
    await call("POST", "/api/ai/config", { clearKey: true }, adm);
    r = await call("POST", "/api/ai/ask", { task: "explain", topicId: "sy-1" }, tT1);
    ok("clearing the key switches AI off again", r.status === 503, r.status);
    r = await call("GET", "/api/health");
    ok("everything else still works with AI off", r.status === 200 && r.data.ok);
  } catch (e) {
    console.log("  ERROR " + (e && e.stack || e));
    exitCode = 1; fail++;
  } finally {
    try { child.kill(); } catch (e) {}
    try { mock && mock.close(); } catch (e) {}
    await new Promise((res) => setTimeout(res, 300));
    rm(DB);
  }
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : exitCode);
})();
