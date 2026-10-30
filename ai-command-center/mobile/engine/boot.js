// Runs inside the app. Expects `M` (module table) and `root` (window) from the bundle wrapper.
const nativeFetch = root.fetch ? root.fetch.bind(root) : null;   // Capacitor's native-HTTP fetch: no CORS limits
const cryptoShim = M['shim-crypto'].exports || (M['shim-crypto'].exports = (() => { const m = { exports: {} }; M['shim-crypto'].fn(m, m.exports); return m.exports; })());

// ---- persistence: the file table is saved to the app's private IndexedDB (falls back to memory if unavailable) ----
const pending = new Map(); let flushT = null, dbp = null;
const openDB = () => dbp || (dbp = new Promise((ok, no) => { const r = root.indexedDB.open('workhouse', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
async function flush() {
  flushT = null; if (!pending.size || !root.indexedDB) return;
  const batch = [...pending]; pending.clear();
  try { const db = await openDB(), tx = db.transaction('files', 'readwrite'), st = tx.objectStore('files');
    for (const [k, v] of batch) { if (v === null) st.delete(k); else st.put(v, k); }
    await new Promise((ok, no) => { tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
  } catch (e) { for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v); console.error('[workhouse] save failed', e && e.message); }
}
const queue = (k, v) => { pending.set(k, v); if (!flushT) flushT = setTimeout(flush, 250); };
const persist = { put: (k, b) => queue(k, new Uint8Array(b)), del: (k) => queue(k, null) };
if (root.addEventListener) { root.addEventListener('pagehide', () => flush()); root.document && root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') flush(); }); }

// ---- tiny module system ----
const sh = (function () { const m = { exports: {} }; M['shims'].fn(m, m.exports, (n) => (n === 'shim-crypto' ? cryptoShim : null)); return m.exports.makeShims(persist); })();
const proc = { env: {}, execPath: '', on() {}, exit() {} };
const cache = {};
function req(name) {
  name = name.replace(/^node:/, '');
  if (name.startsWith('./')) { const k = name.slice(2).replace(/\.js$/, ''); if (!cache[k]) { const m = (cache[k] = { exports: {} }); M[k].fn(m, m.exports, req, '/app', proc, cryptoShim.Buffer); } return cache[k].exports; }
  if (name === 'crypto') return cryptoShim;
  if (name === 'dns') return sh.dns;
  if (sh[name]) return sh[name];
  throw new Error('Module not available in the app: ' + name);
}
req.main = null;

async function loadFiles() {
  if (!root.indexedDB) return;
  const db = await openDB(), st = db.transaction('files').objectStore('files');
  await new Promise((ok, no) => { const c = st.openCursor(); c.onerror = () => no(c.error);
    c.onsuccess = () => { const cur = c.result; if (!cur) return ok(); const b = cryptoShim.Buffer.from(cur.value); sh.files.set(cur.key, b); let d = cur.key; while ((d = d.slice(0, d.lastIndexOf('/'))) ) sh.dirs.add(d); cur.continue(); }; });
}

let app = null, sid = '', password = '';
const ready = (async () => {
  try { await loadFiles(); } catch (e) { console.error('[workhouse] load failed', e && e.message); }
  if (root.navigator && root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist().catch(() => {});
  if (!sh.fs.existsSync('/app/.pw')) sh.fs.writeFileSync('/app/.pw', cryptoShim.randomBytes(18).toString('base64url'));
  password = sh.fs.readFileSync('/app/.pw', 'utf8').trim();
  app = req('./server').createApp({ dataDir: '/data', password });
  app.resume().catch((e) => console.error('[workhouse] resume failed', e && e.message));
})();

// ---- run one request through the engine's own HTTP handler ----
function dispatch(method, url, headers, bodyText) {
  return new Promise((ok, no) => {
    const ls = {}, rq = { method, url, headers: { ...headers }, socket: { remoteAddress: 'app' }, destroy() {},
      on(e, f) { (ls[e] = ls[e] || []).push(f); if (e === 'end') queueMicrotask(() => { (ls.data || []).forEach((g) => g(bodyText || '')); (ls.end || []).forEach((g) => g()); }); return rq; } };
    const out = { status: 200, headers: {}, chunks: [] };
    const rs = { setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, writeHead(c, h) { out.status = c; for (const [k, v] of Object.entries(h || {})) out.headers[k.toLowerCase()] = v; },
      write(c) { out.chunks.push(c); }, end(c) { if (c != null) out.chunks.push(c); ok(out); } };
    Promise.resolve(app.server.handler(rq, rs)).catch(no);
  });
}
async function login() {
  const r = await dispatch('POST', '/api/login', { 'content-type': 'application/json' }, JSON.stringify({ password }));
  const m = String(r.headers['set-cookie'] || '').match(/sid=([^;]+)/); sid = m ? m[1] : '';
}
const toBody = (chunks) => (chunks.every((c) => typeof c === 'string') ? chunks.join('') : cryptoShim.Buffer.concat(chunks.map((c) => (typeof c === 'string' ? cryptoShim.Buffer.from(c) : c))));

root.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  const origin = (root.location && root.location.origin) || '';
  const path = url.startsWith('/api/') ? url : url.startsWith(origin + '/api/') ? url.slice(origin.length) : null;
  if (path === null) return nativeFetch(input, init);
  init = init || {};
  await ready;
  const method = (init.method || 'GET').toUpperCase(), hdr = {};
  for (const [k, v] of Object.entries(init.headers || {})) hdr[k.toLowerCase()] = v;
  if (path === '/api/logout') return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!sid) await login();
  let r = await dispatch(method, path, { ...hdr, cookie: 'sid=' + sid }, typeof init.body === 'string' ? init.body : '');
  if (r.status === 401) { await login(); r = await dispatch(method, path, { ...hdr, cookie: 'sid=' + sid }, typeof init.body === 'string' ? init.body : ''); }
  const h = {}; for (const k of ['content-type', 'content-disposition']) if (r.headers[k]) h[k] = r.headers[k];
  return new Response(toBody(r.chunks), { status: r.status, headers: h });
};
root.__workhouse = { ready, files: sh.files, flush, engine: () => app };
