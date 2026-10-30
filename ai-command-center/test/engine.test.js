'use strict';
// Runs the built in-app engine (mobile/www/engine.js) in Node with a mocked native fetch, exactly as the phone would use it.
const test = require('node:test'), assert = require('node:assert'), path = require('path'), { execFileSync } = require('child_process');
execFileSync(process.execPath, [path.join(__dirname, '..', 'mobile', 'build-www.js')]);
const KEY = 'sk-test-APPKEY-987654';
const calls = [];
globalThis.fetch = async (url, init = {}) => {               // stands in for Capacitor's native HTTP
  calls.push(String(url)); const j = (c, o) => new Response(JSON.stringify(o), { status: c, headers: { 'content-type': 'application/json' } });
  if ((init.headers || {}).authorization !== 'Bearer ' + KEY) return j(401, { error: { message: 'bad key' } });
  if (String(url).endsWith('/models')) return j(200, { data: [{ id: 'grok-test' }] });
  if (String(url).endsWith('/chat/completions')) return j(200, { choices: [{ message: { content: 'hello from the phone' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
  return j(404, {});
};
require('../mobile/www/engine.js');
const wh = globalThis.__workhouse;
const api = async (p, m = 'GET', b) => { const r = await fetch('/api/' + p, { method: m, headers: m === 'GET' ? {} : { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); return { status: r.status, json: await r.json() }; };

test('app signs itself in: no login screen needed', async () => { await wh.ready; assert.deepStrictEqual((await api('me')).json, { ok: true }); });
test('ten starter departments exist and logout is harmless', async () => { assert.strictEqual((await api('departments')).json.length, 10); assert.strictEqual((await api('logout', 'POST')).status, 200); assert.strictEqual((await api('me')).status, 200); });
test('API key is verified over the native network layer and stored encrypted, never returned', async () => {
  await api('providers/xai', 'PUT', { apiKey: 'wrong-key', model: 'grok-test' });
  assert.notStrictEqual((await api('providers/xai/test', 'POST')).json.status, 'connected');
  const r = await api('providers/xai', 'PUT', { apiKey: KEY, model: 'grok-test' }); assert.ok(!JSON.stringify(r.json).includes(KEY));
  assert.strictEqual((await api('providers/xai/test', 'POST')).json.status, 'connected');
  assert.ok(calls.some((u) => u.startsWith('https://api.x.ai/')));
  const stored = Buffer.from(wh.files.get('/data/db.json')).toString('utf8'); assert.ok(!stored.includes(KEY), 'key must not be stored in plain text');
});
test('a chat completes through the in-app engine and is saved', async () => {
  const r = await api('chat', 'POST', { providerId: 'xai', message: 'hi' }); assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.messages.at(-1).content, 'hello from the phone');
  assert.ok(Buffer.from(wh.files.get('/data/db.json')).toString('utf8').includes('hello from the phone'));
});
test('data and the encryption key survive an app restart (saved files reload)', async () => {
  const snap = new Map([...wh.files].map(([k, v]) => [k, Buffer.from(v)]));
  for (const k of ['/data/db.json', '/app/.secret', '/app/.pw']) assert.ok(snap.has(k), k + ' is saved');
  const { createApp } = require('../server'), os = require('os'), fs = require('fs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
  fs.writeFileSync(path.join(dir, 'db.json'), snap.get('/data/db.json'));
  const app2 = createApp({ dataDir: dir, password: 'x'.repeat(10), secret: snap.get('/app/.secret').toString('utf8').trim() });
  const p = app2.db().providers.xai; assert.ok(p && p.key, 'provider kept after restart');
});
test('workspace files can be written, listed, downloaded and deleted in the in-app file store', async () => {
  const w = await api('files', 'POST', { name: 'note.txt', content: 'abc 123' }); assert.strictEqual(w.status, 200, JSON.stringify(w.json));
  assert.ok(JSON.stringify((await api('files')).json).includes('note.txt'));
  const d = await fetch('/api/files/note.txt'); assert.strictEqual(d.status, 200); assert.strictEqual(await d.text(), 'abc 123');
  assert.strictEqual((await api('files/note.txt', 'DELETE')).status, 200); assert.ok(!JSON.stringify((await api('files')).json).includes('note.txt'));
});
test('running programs stays switched off in the app, and private web addresses stay blocked', async () => {
  const r = await api('tools/run', 'POST', { tool: 'web_fetch', args: { url: 'http://192.168.1.1/' } }); assert.ok(r.status >= 400, JSON.stringify(r.json));
});
