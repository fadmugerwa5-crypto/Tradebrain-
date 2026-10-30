'use strict';
// Stand-ins for the Node modules the engine expects, so the same server code runs inside the phone app.
// Files live in memory and are saved to the app's private IndexedDB by boot.js (via the persist hooks).
const Bf = require('shim-crypto').Buffer;

function makeShims(persist) {
  const files = new Map(), dirs = new Set(['/']);
  const enoent = (p) => Object.assign(new Error("ENOENT: no such file or directory, '" + p + "'"), { code: 'ENOENT' });
  const path = {
    sep: '/',
    normalize(p) { const abs = String(p).startsWith('/'), out = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.'); },
    join(...a) { return path.normalize(a.filter(Boolean).join('/')); },
    resolve(...a) { let r = ''; for (const s of a) r = String(s).startsWith('/') ? s : r + '/' + s; return path.normalize(r.startsWith('/') ? r : '/' + r); },
    extname(p) { const b = path.basename(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    basename(p) { return String(p).split('/').filter(Boolean).pop() || ''; },
    dirname(p) { const s = String(p).split('/').filter(Boolean); s.pop(); return '/' + s.join('/'); },
  };
  const P = (p) => path.resolve(p);
  const mk = (p) => { let c = ''; for (const s of P(p).split('/').filter(Boolean)) { c += '/' + s; dirs.add(c); } };
  const bytes = (d) => (typeof d === 'string' ? Bf.from(d) : Bf.from(d));
  const fs = {
    mkdirSync: (p) => mk(p),
    existsSync: (p) => files.has(P(p)) || dirs.has(P(p)),
    readFileSync: (p, enc) => { const b = files.get(P(p)); if (!b) throw enoent(p); const o = Bf.from(b); return enc ? o.toString(enc === 'utf8' || enc === 'utf-8' ? undefined : enc) : o; },
    writeFileSync: (p, d) => { const k = P(p), b = bytes(d); mk(path.dirname(k)); files.set(k, b); persist.put(k, b); },
    renameSync: (a, b) => { const x = files.get(P(a)); if (!x) throw enoent(a); files.set(P(b), x); files.delete(P(a)); persist.put(P(b), x); persist.del(P(a)); },
    unlinkSync: (p) => { files.delete(P(p)); persist.del(P(p)); },
    readdirSync: (p) => { const d = P(p).replace(/\/$/, '') + '/', s = new Set(); for (const k of [...files.keys(), ...dirs]) if (k.startsWith(d) && k.length > d.length) s.add(k.slice(d.length).split('/')[0]); return [...s]; },
    statSync: (p) => { const k = P(p), f = files.get(k); if (f) return { isFile: () => true, isDirectory: () => false, size: f.length, mtimeMs: Date.now() }; if (dirs.has(k)) return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: Date.now() }; throw enoent(p); },
    rmSync: (p) => { const k = P(p); for (const f of [...files.keys()]) if (f === k || f.startsWith(k + '/')) { files.delete(f); persist.del(f); } for (const d of [...dirs]) if (d === k || d.startsWith(k + '/')) dirs.delete(d); },
    mkdtempSync: (prefix) => { const d = P(prefix + Math.random().toString(36).slice(2, 8)); mk(d); return d; },
  };
  const isV4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((n) => +n < 256);
  const isV6 = (s) => /^[0-9a-f:.]+$/i.test(s) && s.includes(':');
  const net = { isIPv4: isV4, isIPv6: isV6, isIP: (s) => (isV4(s) ? 4 : isV6(s) ? 6 : 0) };
  // DNS is not available in the app; names that clearly mean "this device / local network" still count as private.
  const dns = { promises: { lookup: async (host) => [{ address: /^localhost$|\.local$|\.internal$|\.lan$/i.test(host) ? '127.0.0.1' : '8.8.8.8', family: 4 }] } };
  // http(s).get implemented with fetch (which the app routes through native HTTP).
  const get = (u, o, cb) => {
    const ls = {}, ac = new AbortController(); let dead = false, t;
    const emit = (e, ...a) => (ls[e] || []).forEach((f) => f(...a));
    const req = { on(e, f) { (ls[e] = ls[e] || []).push(f); return req; }, destroy(err) { dead = true; clearTimeout(t); ac.abort(); emit('error', err || new Error('aborted')); } };
    if (o.timeout) t = setTimeout(() => emit('timeout'), o.timeout);
    fetch(u.href, { headers: o.headers, signal: ac.signal }).then(async (r) => {
      clearTimeout(t); const buf = Bf.from(new Uint8Array(await r.arrayBuffer())), rl = {};
      const res = { statusCode: r.status, headers: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])), resume() {}, on(e, f) { (rl[e] = rl[e] || []).push(f); return res; } };
      cb(res); queueMicrotask(() => { if (dead) return; (rl.data || []).forEach((f) => f(buf)); (rl.end || []).forEach((f) => f()); });
    }).catch((e) => { if (!dead) emit('error', e); });
    return req;
  };
  const http = { createServer: (h) => ({ handler: h, listen() {}, close() {} }), get };
  const child_process = { spawnSync: () => ({ status: 1 }), spawn: () => { throw new Error('Running programs is not available in the app'); } };
  const os = { tmpdir: () => '/tmp' };
  return { path, fs, net, dns, http, https: http, child_process, os, files, dirs };
}
module.exports = { makeShims };
