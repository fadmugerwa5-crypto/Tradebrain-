#!/usr/bin/env node
'use strict';
// Builds mobile/www: the Workhouse app UI plus an in-app engine (the same server code, running on the phone).
// Usage: node mobile/build-www.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), eng = path.join(__dirname, 'engine'), out = path.join(__dirname, 'www');
const rd = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const brand = (s) => s.split('AI Command Center').join('Workhouse').split('AICommandCenter').join('Workhouse');
function patch(src, from, to, label) { if (!src.includes(from)) { console.warn('skipped: ' + label); return src; }; return src.split(from).join(to); }

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

// ---- engine.js ----
const mods = [['shim-crypto', rd(eng, 'shim-crypto.js')], ['shims', rd(eng, 'shims.js')],
  ['server', brand(rd(root, 'server.js'))], ['tools', brand(rd(root, 'tools.js'))], ['trading', brand(rd(root, 'trading.js'))]];
let js = '(function (root) {\n"use strict";\nconst M = {};\n';
for (const [n, s] of mods) js += 'M[' + JSON.stringify(n) + '] = { fn: function (module, exports, require, __dirname, process, Buffer) {\n' + s + '\n} };\n';
js += rd(eng, 'boot.js') + '\n})(globalThis);\n';
fs.writeFileSync(path.join(out, 'engine.js'), js);

// ---- UI ----
let html = brand(rd(root, 'public', 'index.html'));
html = patch(html, '<link rel="manifest" href="manifest.json">', '', 'manifest link');
html = patch(html, '<script src="app.js"></script>', '<script src="engine.js"></script><script src="app.js"></script>', 'script tag');
fs.writeFileSync(path.join(out, 'index.html'), html);

let app = brand(rd(root, 'public', 'app.js'));
app = patch(app, "if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});", '', 'service worker');
app = patch(app, "h('button', { class: 'nav', 'data-i': '↩', onclick: async () => { try { await api('logout', 'POST'); } catch { /* already out */ } showLogin(); } }, 'Sign out')", 'null', 'sign out button');
app = patch(app, "h('img', { src: '/api/files/' + encodeURIComponent(r.file), alt: 'Generated image', class: 'gen' })", 'fileImg(r.file)', 'generated image');
app = patch(app, "h('a', { href: '/api/files/' + encodeURIComponent(f.name), download: f.name }, f.name)",
  "h('a', { href: '#', onclick: async (ev) => { ev.preventDefault(); try { const u = await fileBlobUrl(f.name), a = h('a', { href: u, download: f.name }); document.body.append(a); a.click(); a.remove(); } catch (x) { alert(x.message); } } }, f.name)", 'file link');
app += "\nasync function fileBlobUrl(name) { const r = await fetch('/api/files/' + encodeURIComponent(name)); if (!r.ok) throw new Error('File not found'); return URL.createObjectURL(await r.blob()); }\n" +
  "function fileImg(name) { const i = h('img', { alt: 'Generated image', class: 'gen' }); fileBlobUrl(name).then((u) => { i.src = u; }).catch(() => { i.alt = 'Image not found'; }); return i; }\n";
fs.writeFileSync(path.join(out, 'app.js'), app);
fs.writeFileSync(path.join(out, 'style.css'), brand(rd(root, 'public', 'style.css')));
fs.copyFileSync(path.join(root, 'public', 'icon.svg'), path.join(out, 'icon.svg'));
console.log('Built mobile/www (' + Math.round(js.length / 1024) + ' KB engine)');
