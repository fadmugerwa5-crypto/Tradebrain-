'use strict';
// All text is inserted with textContent (never innerHTML). API keys are sent once and never returned.
const $app = document.getElementById('app');
const AGENT_TOOLS = ['web_search', 'web_fetch', 'file_list', 'file_read', 'file_write', 'image_generate'];
let view = 'dashboard', chatId = null, taskId = null, poll = null;

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
async function api(path, method = 'GET', body) {
  let r;
  try { r = await fetch('/api/' + path, { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); }
  catch { throw new Error('No connection to the server. Check your network and try again.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { showLogin(); throw new Error('Signed out'); }
  if (!r.ok) { const e = new Error(j.error || 'Request failed (' + r.status + ')'); e.data = j; throw e; }
  return j;
}
const badge = (s) => h('span', { class: 'badge s-' + s.toLowerCase() }, s.replace(/_/g, ' ').toLowerCase());
const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

function shell(title, ...body) {
  const tabs = [['dashboard', 'Dashboard'], ['tasks', 'Tasks'], ['trading', 'Trading'], ['tools', 'Tools'], ['teams', 'Teams'], ['memory', 'Memory'], ['chat', 'Chat'], ['connections', 'AI Connections'], ['activity', 'Activity']];
  clearTimeout(poll);
  $app.replaceChildren(h('h1', {}, title), ...body,
    h('nav', {}, tabs.map(([id, label]) => h('button', { class: view === id ? 'on' : '', onclick: () => { view = id; taskId = null; render(); } }, label))));
}

function showLogin() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' }), msg = h('p', { class: 'err' });
  const go = async () => { try { await api('login', 'POST', { password: pw.value }); render(); } catch (e) { msg.textContent = e.message; } };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  $app.replaceChildren(h('h1', {}, 'AI Command Center'), h('div', { class: 'card' }, h('label', {}, 'Password'), pw, msg, h('p', {}, h('button', { onclick: go }, 'Sign in'))));
}

async function dashboard() {
  const d = await api('dashboard');
  const stat = (n, l) => h('div', { class: 'card' }, h('div', { class: 'num' }, String(n)), h('div', { class: 'mut' }, l));
  shell('Dashboard',
    h('div', { class: 'grid' }, stat(d.providers.total, 'Providers configured'), stat(d.providers.connected, 'Connected and tested'), stat(d.chats, 'Chats saved'), stat(d.departments, 'Departments on'), stat(d.agents, 'Agents created'), stat(d.dailyCalls.used + ' / ' + d.dailyCalls.limit, 'Task model calls today')),
    h('div', { class: 'card' }, h('h2', {}, 'Tasks'), Object.keys(d.tasks).length ? h('p', {}, Object.entries(d.tasks).map(([k, v]) => [badge(k), ' ' + v + '  '])) : h('p', { class: 'mut' }, 'No tasks yet.')),
    h('div', { class: 'card' }, h('h2', {}, 'Estimated cost'), h('p', { class: 'num' }, '$' + d.cost.estimatedUSD), h('p', { class: 'mut' }, d.cost.note), d.cost.unpriced.length ? h('p', { class: 'mut' }, 'No price entered yet for: ' + d.cost.unpriced.join(', ') + ' (Tools, Prices).') : null),
    h('div', { class: 'card' }, h('h2', {}, 'Usage (measured)'),
      h('p', {}, d.usage.in + ' tokens in, ' + d.usage.out + ' tokens out'), h('p', { class: 'mut' }, 'Source: ' + d.usage.source)),
    h('div', { class: 'card' }, h('h2', {}, 'Not built yet'),
      h('p', { class: 'mut' }, 'Live trading (deliberately absent), per-department model routing, a code sandbox that blocks the network, running the server inside the APK, scheduled jobs, notifications. Nothing here is simulated.')),
    h('div', { class: 'card' }, h('h2', {}, 'Recent activity'),
      d.recent.length ? h('ul', {}, d.recent.map((e) => h('li', {}, when(e.t) + ' — ' + e.type + (e.provider ? ' (' + e.provider + ')' : '')))) : h('p', { class: 'mut' }, 'No activity yet. Add a provider under AI Connections.')));
}

async function connections() {
  const list = await api('providers');
  const cards = list.map((p) => {
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: p.hasKey ? 'Key saved (hidden). Paste a new one to replace.' : 'Paste API key', 'aria-label': p.name + ' API key' });
    const model = h('select', { 'aria-label': 'Model' }, h('option', { value: '' }, p.models.length ? 'Choose a model' : 'Test the key to load models'),
      (p.model && !p.models.includes(p.model) ? [p.model] : []).concat(p.models).map((m) => h('option', { value: m, selected: m === p.model }, m)));
    const fb = h('input', { value: p.fallbackModel, placeholder: 'Optional fallback model (same provider)', 'aria-label': 'Fallback model' });
    const base = p.id === 'custom' ? h('input', { value: p.baseUrl, placeholder: 'https://host/v1', 'aria-label': 'Base URL' }) : null;
    const en = h('input', { type: 'checkbox', checked: p.enabled });
    const out = h('p', { class: p.error ? 'err' : 'mut' }, p.error || (p.testedAt ? 'Last tested ' + when(p.testedAt) : 'Not tested yet'));
    const btn = h('button', { onclick: async () => {
      btn.disabled = true; out.className = 'mut'; out.textContent = 'Testing…';
      try {
        await api('providers/' + p.id, 'PUT', { apiKey: key.value, model: model.value, fallbackModel: fb.value, enabled: en.checked, ...(base ? { baseUrl: base.value } : {}) });
        await api('providers/' + p.id + '/test', 'POST'); connections();
      } catch (e) { out.className = 'err'; out.textContent = e.message; btn.disabled = false; }
    } }, 'Save and test');
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, p.name), h('div', { class: 'fit' }, badge(p.status))),
      base && [h('label', {}, 'Base URL (OpenAI-compatible)'), base], h('label', {}, 'API key'), key, h('label', {}, 'Model'), model, h('label', {}, 'Fallback model'), fb,
      h('label', { class: 'chk' }, en, 'Enabled'), out, btn);
  });
  shell('AI Connections', h('p', { class: 'mut' }, 'Status turns Connected only after a real test request succeeds. Keys are encrypted on the server and never sent back to this page.'), ...cards);
}

async function chat() {
  const provs = (await api('providers')).filter((p) => p.status === 'connected');
  let c = chatId ? await api('chats/' + chatId).catch(() => null) : null;
  const past = await api('chats');
  const box = h('div', {}, (c ? c.messages : []).map((m) => h('div', { class: 'msg ' + (m.role === 'user' ? 'u' : 'a') }, m.content,
    m.role === 'assistant' ? h('div', { class: 'meta' }, m.model + (m.think ? ' · Think' : '') + (m.usage ? ' · ' + m.usage.in + '/' + m.usage.out + ' tokens' : '')) : null)));
  if (!provs.length) return shell('Chat', h('div', { class: 'card' }, h('p', {}, 'No connected provider yet.'), h('p', { class: 'mut' }, 'Add an API key under AI Connections and run Save and test.'),
    h('button', { onclick: () => { view = 'connections'; render(); } }, 'Open AI Connections')));
  const sel = h('select', { 'aria-label': 'Provider' }, provs.map((p) => h('option', { value: p.id }, p.name + ' · ' + p.model)));
  const think = h('input', { type: 'checkbox' }), txt = h('textarea', { placeholder: 'Message', 'aria-label': 'Message' }), err = h('p', { class: 'err' });
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, speak = h('input', { type: 'checkbox' }), mic = SR ? h('button', { class: 'sec', onclick: () => { try { const r = new SR(); r.lang = navigator.language || 'en-US'; r.onresult = (e) => { txt.value += (txt.value ? ' ' : '') + e.results[0][0].transcript; }; r.start(); } catch (e) { err.textContent = 'Voice input is not available here'; } } }, 'Speak') : null;
  const send = h('button', { onclick: async () => {
    if (!txt.value.trim()) return; send.disabled = true; err.textContent = '';
    try { const r = await api('chat', 'POST', { providerId: sel.value, message: txt.value, think: think.checked, chatId }); chatId = r.id; if (speak.checked && globalThis.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(r.messages[r.messages.length - 1].content)); } chat(); }
    catch (e) { err.textContent = e.message; send.disabled = false; }
  } }, 'Send');
  shell('Chat', box, h('div', { class: 'card' }, h('div', { class: 'row' }, sel), h('label', { class: 'chk' }, think, 'Think (asks the model to reason step by step; uses more tokens)'), txt, err,
    globalThis.speechSynthesis ? h('label', { class: 'chk' }, speak, 'Read the next reply aloud') : null, h('div', { class: 'row' }, send, mic, h('button', { class: 'sec', onclick: () => { chatId = null; chat(); } }, 'New chat'))),
    past.length ? h('div', { class: 'card' }, h('h2', {}, 'Earlier chats'), past.slice(0, 10).map((p) => h('p', {}, h('button', { class: 'sec', onclick: () => { chatId = p.id; chat(); } }, p.title)))) : null);
}

async function activity() {
  const rows = await api('audit');
  shell('Activity', h('div', { class: 'card' }, rows.length ? rows.map((e) => h('p', {}, h('span', { class: 'mut' }, when(e.t) + ' '), e.type,
    e.provider ? ' · ' + e.provider : '', e.model ? ' · ' + e.model : '', e.status ? ' · ' + e.status : '')) : h('p', { class: 'mut' }, 'Nothing recorded yet.')));
}

async function tasks() {
  if (taskId) return taskDetail();
  const [provs, list] = await Promise.all([api('providers'), api('tasks')]); const ok = provs.filter((p) => p.status === 'connected');
  const obj = h('textarea', { placeholder: 'Describe what you want done and the result you expect', 'aria-label': 'Task' }), err = h('p', { class: 'err' });
  const sel = h('select', { 'aria-label': 'Provider' }, ok.map((p) => h('option', { value: p.id }, p.name + ' · ' + p.model)));
  const calls = h('input', { type: 'number', value: '15', min: '3', max: '60', 'aria-label': 'Max model calls' }), rev = h('input', { type: 'number', value: '1', min: '0', max: '3', 'aria-label': 'Correction rounds' });
  const mode = h('select', { 'aria-label': 'Autonomy' }, h('option', { value: 'assisted' }, 'Assisted: I approve the plan first'), h('option', { value: 'controlled' }, 'Controlled: run within the limits below'));
  const go = h('button', { onclick: async () => { go.disabled = true; err.textContent = '';
    try { const t = await api('tasks', 'POST', { objective: obj.value, providerId: sel.value, maxCalls: +calls.value, maxReview: +rev.value, autonomy: mode.value }); taskId = t.id; render(); } catch (e) { err.textContent = e.message; go.disabled = false; } } }, 'Create task');
  shell('Tasks', ok.length ? h('div', { class: 'card' }, h('h2', {}, 'New task'), obj, h('label', {}, 'Provider'), sel, h('label', {}, 'Autonomy'), mode,
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Max model calls (hard limit)'), calls), h('div', {}, h('label', {}, 'Correction rounds per step'), rev)), err, h('p', {}, go))
    : h('div', { class: 'card' }, h('p', {}, 'No connected provider yet.'), h('button', { onclick: () => { view = 'connections'; render(); } }, 'Open AI Connections')),
    h('div', { class: 'card' }, h('h2', {}, 'All tasks'), list.length ? list.map((t) => h('p', {}, h('button', { class: 'sec', onclick: () => { taskId = t.id; render(); } }, t.objective.slice(0, 60)), ' ', badge(t.status), h('span', { class: 'mut' }, ' ' + t.done + '/' + t.total + ' steps · ' + t.calls + '/' + t.maxCalls + ' calls'))) : h('p', { class: 'mut' }, 'No tasks yet.')));
  if (list.some((t) => ['QUEUED', 'RUNNING'].includes(t.status))) poll = setTimeout(render, 3000);
}
async function taskDetail() {
  const t = await api('tasks/' + taskId); const act = (a, b) => async () => { try { await api('tasks/' + t.id + '/' + a, 'POST', b); } catch (e) { alert(e.message); } render(); };
  const more = h('input', { type: 'number', value: String(t.maxCalls + 10), min: '3', max: '60', 'aria-label': 'New call limit' });
  const btns = [];
  if (t.status === 'WAITING_FOR_APPROVAL') btns.push(h('button', { onclick: act('approve') }, 'Approve plan and run'));
  if (!['COMPLETED', 'CANCELLED'].includes(t.status)) btns.push(h('button', { class: 'sec', onclick: act('cancel') }, 'Cancel'));
  if (['FAILED', 'BLOCKED', 'CANCELLED'].includes(t.status)) btns.push(h('button', { onclick: () => act('retry', { maxCalls: +more.value })() }, 'Retry'), h('div', {}, h('label', {}, 'Call limit for retry'), more));
  if (t.result) btns.push(h('button', { class: 'sec', onclick: async () => { await api('memory', 'POST', { title: t.objective.slice(0, 80), content: t.result, source: 'task ' + t.id }); alert('Saved to Memory as unverified.'); } }, 'Save result to Memory'));
  shell('Task', h('button', { class: 'sec', onclick: () => { taskId = null; render(); } }, 'Back'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, t.objective), h('div', { class: 'fit' }, badge(t.status))), h('p', { class: 'mut' }, t.calls + ' of ' + t.maxCalls + ' model calls · ' + t.tokens.in + '/' + t.tokens.out + ' tokens (reported) · ' + t.autonomy + ' · retries ' + t.retries), t.error ? h('p', { class: 'err' }, t.error) : null, h('div', { class: 'row' }, btns)),
    t.subtasks.length ? h('div', {}, t.subtasks.map((x) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, x.title), h('div', { class: 'fit' }, badge(x.status))),
      h('p', { class: 'mut' }, x.department + ' · ' + (x.agent || 'not started') + ' · attempts ' + x.attempts + (x.dependsOn.length ? ' · after ' + x.dependsOn.join(', ') : '')), x.review ? h('p', { class: x.review.ok ? 'ok' : 'err' }, 'Review: ' + (x.review.ok ? 'passed' : 'failed — ' + x.review.issues)) : null,
      x.output ? h('div', { class: 'msg a' }, x.output) : null))) : null,
    t.result ? h('div', { class: 'card' }, h('h2', {}, 'Result'), h('div', { class: 'msg a' }, t.result), h('p', { class: 'mut' }, t.verification.note)) : null);
  if (['QUEUED', 'RUNNING'].includes(t.status)) poll = setTimeout(render, 2500);
}
async function teams() {
  const ds = await api('departments');
  const nn = h('input', { placeholder: 'New department name', 'aria-label': 'Department name' }), ni = h('textarea', { placeholder: 'What this department does', 'aria-label': 'Department instructions' });
  shell('Teams', h('p', { class: 'mut' }, 'Departments without an agent run with a department default. Agents you add here take over their department\'s steps.'),
    ...ds.map((d) => { const ins = h('textarea', { 'aria-label': d.name + ' instructions' }, d.instructions), en = h('input', { type: 'checkbox', checked: d.enabled });
      const tl = AGENT_TOOLS.map((n) => [n, h('input', { type: 'checkbox' })]), an = h('input', { placeholder: 'Agent name', 'aria-label': 'Agent name' }), ar = h('input', { placeholder: 'Role (for example Lead researcher)', 'aria-label': 'Agent role' }), ai = h('input', { placeholder: 'Agent instructions', 'aria-label': 'Agent instructions' });
      return h('div', { class: 'card' }, h('h2', {}, d.name), h('label', { class: 'chk' }, en, 'Enabled'), ins,
        h('p', {}, h('button', { class: 'sec', onclick: async () => { await api('departments/' + d.id, 'PUT', { instructions: ins.value, enabled: en.checked }); teams(); } }, 'Save department'), ' ',
          d.id !== 'administration' ? h('button', { class: 'sec', onclick: async () => { if (confirm('Delete ' + d.name + ' and its agents?')) { await api('departments/' + d.id, 'DELETE'); teams(); } } }, 'Delete') : null),
        d.agents.map((a) => h('p', {}, h('b', {}, a.name), ' ' + a.role + (a.tools && a.tools.length ? ' · tools: ' + a.tools.join(', ') : ' · no tools') + ' ', h('button', { class: 'sec', onclick: async () => { await api('agents/' + a.id, 'DELETE'); teams(); } }, 'Remove'))),
        h('label', {}, 'Add agent'), an, ar, ai, h('label', {}, 'Tools this agent may use'), tl.map(([n, i]) => h('label', { class: 'chk' }, i, n)), h('p', {}, h('button', { onclick: async () => { try { await api('agents', 'POST', { name: an.value, role: ar.value, instructions: ai.value, departmentId: d.id, tools: tl.filter((x) => x[1].checked).map((x) => x[0]) }); teams(); } catch (e) { alert(e.message); } } }, 'Add agent'))); }),
    h('div', { class: 'card' }, h('h2', {}, 'New department'), nn, ni, h('p', {}, h('button', { onclick: async () => { try { await api('departments', 'POST', { name: nn.value, instructions: ni.value }); teams(); } catch (e) { alert(e.message); } } }, 'Create department'))));
}
async function memory(q = '') {
  const notes = await api('memory' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const sq = h('input', { type: 'search', value: q, placeholder: 'Search memory', 'aria-label': 'Search memory' }), t = h('input', { placeholder: 'Title', 'aria-label': 'Title' }), c = h('textarea', { placeholder: 'What should be remembered', 'aria-label': 'Content' });
  sq.addEventListener('keydown', (e) => e.key === 'Enter' && memory(sq.value));
  shell('Memory', h('p', { class: 'mut' }, 'Saved notes start as unverified. Mark one verified only after you have checked it.'), sq,
    h('div', { class: 'card' }, h('h2', {}, 'Add note'), t, c, h('div', { class: 'row' }, h('button', { onclick: async () => { try { await api('memory', 'POST', { title: t.value, content: c.value }); memory(); } catch (e) { alert(e.message); } } }, 'Save note'), h('a', { href: '/api/export', download: '' }, 'Export everything (JSON)')), h('label', {}, 'Restore from an export file (merges; never touches keys or trading data)'), h('input', { type: 'file', accept: 'application/json', 'aria-label': 'Import file', onchange: async (e) => { try { const data = JSON.parse(await e.target.files[0].text()); const r = await api('import', 'POST', { data }); alert('Imported: ' + JSON.stringify(r.imported)); memory(); } catch (x) { alert(x.message); } } })),
    ...notes.map((n) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, n.title), h('div', { class: 'fit' }, h('span', { class: 'badge ' + (n.status === 'verified' ? 's-connected' : 's-untested') }, n.status))), h('div', { class: 'msg' }, n.content), h('p', { class: 'mut' }, 'Source: ' + n.source),
      h('div', { class: 'row' }, h('button', { class: 'sec', onclick: async () => { await api('memory/' + n.id, 'PUT', { status: n.status === 'verified' ? 'unverified' : 'verified' }); memory(q); } }, n.status === 'verified' ? 'Mark unverified' : 'Mark verified'),
        h('button', { class: 'sec', onclick: async () => { if (confirm('Delete this note?')) { await api('memory/' + n.id, 'DELETE'); memory(q); } } }, 'Delete')))));
}

async function trading() {
  const [st, provs] = await Promise.all([api('trading'), api('providers')]); const c = st.config, ok = provs.filter((p) => p.status === 'connected'), msg = h('p', { class: 'err' });
  const act = (a) => async () => { msg.textContent = ''; try { if (a === 'kill' && !confirm('Stop the bot and close all open demo positions?')) return; await api('trading/' + a, 'POST'); } catch (e) { msg.textContent = e.message; return; } trading(); };
  const inp = (v, type = 'number', step = 'any') => h('input', { type, value: String(v), step, 'aria-label': 'setting' }), fld = (l, i) => h('div', {}, h('label', {}, l), i);
  const broker = h('select', { 'aria-label': 'Broker' }, ['binance', 'deriv'].map((b) => h('option', { value: b, selected: b === c.broker }, b === 'binance' ? 'Binance Spot Testnet' : 'Deriv demo'))),
    sym = inp(c.symbols.join(', '), 'text'), intv = h('select', { 'aria-label': 'Candle interval' }, ['1m', '5m', '15m'].map((i) => h('option', { value: i, selected: i === c.interval }, i)));
  const num = { stake: inp(c.stake), slPct: inp(c.slPct), tpPct: inp(c.tpPct), maxOpen: inp(c.maxOpen), dailyLossCap: inp(c.dailyLossCap), maxTradesPerDay: inp(c.maxTradesPerDay), cooldownSec: inp(c.cooldownSec), scanSec: inp(c.scanSec), minAgree: inp(c.minAgree), minConfidence: inp(c.minConfidence), maxLossStreak: inp(c.maxLossStreak) };
  const labels = { stake: 'Stake per trade', slPct: 'Stop loss %', tpPct: 'Take profit %', maxOpen: 'Max open trades', dailyLossCap: 'Daily loss cap', maxTradesPerDay: 'Max trades per day', cooldownSec: 'Cooldown per symbol (sec)', scanSec: 'Scan every (sec)', minAgree: 'AIs that must agree', minConfidence: 'Min AI confidence (0-1)', maxLossStreak: 'Pause after N losses in a row' };
  const strat = Object.entries(st.strategies).map(([k, n]) => [k, n, h('input', { type: 'checkbox', checked: c.strategies.includes(k) })]);
  const flags = [['jitterShield', 'Jitter Shield: skip choppy markets'], ['aplusOnly', 'A+ only: trade only setups with 4 or more of 5 confirmations'], ['reentry', 'Smart re-entry: skip the cooldown after a winning take-profit'], ['autoResume', 'Continue automatically after a restart (re-checks the demo account first; never after Stop or the kill switch)']].map(([k, l]) => [k, l, h('input', { type: 'checkbox', checked: !!c[k] })]);
  const ais = ok.map((p) => [p.id, p.name, h('input', { type: 'checkbox', checked: c.aiProviders.includes(p.id) })]), mon = h('input', { type: 'checkbox', checked: c.aiMonitor });
  const save = h('button', { onclick: async () => { msg.textContent = ''; const b = { broker: broker.value, symbols: sym.value.split(','), interval: intv.value, strategies: strat.filter((x) => x[2].checked).map((x) => x[0]), aiProviders: ais.filter((x) => x[2].checked).map((x) => x[0]), aiMonitor: mon.checked }; flags.forEach((f) => (b[f[0]] = f[2].checked));
    for (const k in num) b[k] = num[k].value; try { await api('trading/config', 'PUT', b); trading(); } catch (e) { msg.textContent = e.message; } } }, 'Save settings');
  const brokerCard = (id, name, fields) => { const b = st.brokers[id], ins = fields.map((f) => h('input', { type: 'password', autocomplete: 'off', placeholder: f[1], 'aria-label': name + ' ' + f[1] })), out = h('p', { class: b.error ? 'err' : 'mut' }, b.error || (b.status === 'connected' ? 'Verified demo account · balance ' + b.balance + ' ' + b.currency : 'Not verified yet'));
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, name), h('div', { class: 'fit' }, badge(b.status))), ...ins, out, h('p', {}, h('button', { onclick: async () => { out.className = 'mut'; out.textContent = 'Checking…';
      try { await api('trading/brokers/' + id, 'PUT', Object.fromEntries(fields.map((f, i) => [f[0], ins[i].value]))); await api('trading/brokers/' + id + '/test', 'POST'); trading(); } catch (e) { out.className = 'err'; out.textContent = e.message; } } }, 'Save and verify'))); };
  const bt = h('select', { 'aria-label': 'Backtest strategy' }, Object.entries(st.strategies).map(([k, n]) => h('option', { value: k }, n))), btOut = h('p', { class: 'mut' });
  const posCard = (p) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, p.symbol + ' ' + p.side + ' · ' + (st.strategies[p.strategy] || p.strategy)), h('div', { class: 'fit' }, badge(p.status))),
    h('p', { class: 'mut' }, p.broker + ' · entry ' + (+p.entry).toFixed(4) + (p.sl ? ' · stop ' + p.sl + ' · target ' + p.tp : ' · fixed duration') + (p.last ? ' · now ' + p.last : '') + (p.pnl != null ? ' · P&L ' + p.pnl + ' (' + p.closeReason + ')' : '')),
    p.views.length ? h('p', { class: 'mut' }, 'AI views at entry: ' + p.views.map((v) => v.provider + ' ' + v.action + ' ' + Math.round(v.confidence * 100) + '%').join(', ')) : null,
    p.reviews.length ? h('p', { class: 'mut' }, 'AI monitor: ' + p.reviews.slice(-3).map((r) => r.action + ' (' + r.reason + ')').join(' · ')) : null);
  shell('Trading', h('div', { class: 'card' }, h('p', { class: 'ok' }, 'Demo accounts only. Binance runs on the Spot Testnet host and Deriv tokens from real-money accounts are refused. There is no live-trading code in this app.'),
    h('div', { class: 'row' }, badge(st.killed ? 'blocked' : st.enabled ? 'running' : 'cancelled'), h('span', { class: 'mut' }, st.killed ? 'Kill switch on' : st.enabled ? 'Bot running' : 'Bot stopped (it never starts by itself)')),
    h('div', { class: 'row' }, st.enabled ? h('button', { class: 'sec', onclick: act('stop') }, 'Stop bot') : h('button', { onclick: act('start') }, 'Start bot'), h('button', { class: 'sec', onclick: act('closeall') }, 'Close all'),
      st.killed ? h('button', { class: 'sec', onclick: act('unkill') }, 'Reset kill switch') : h('button', { onclick: act('kill'), style: 'background:var(--rd)' }, 'Kill switch')), msg),
    h('div', { class: 'grid' }, ...[[st.stats.pnlToday, 'P&L today'], [st.stats.tradesToday, 'Trades today'], [Math.round(st.stats.winRate * 100) + '%', 'Win rate (' + st.stats.closedTotal + ')'], [st.stats.totalPnl, 'Total P&L (demo)']].map(([n, l]) => h('div', { class: 'card' }, h('div', { class: 'num' }, String(n)), h('div', { class: 'mut' }, l)))),
    brokerCard('binance', 'Binance Spot Testnet', [['apiKey', 'Testnet API key'], ['apiSecret', 'Testnet API secret']]), brokerCard('deriv', 'Deriv demo account', [['token', 'Demo API token']]),
    h('div', { class: 'card' }, h('h2', {}, 'Settings'), fld('Broker', broker), fld('Symbols (comma separated)', sym), fld('Candle interval', intv), ...Object.keys(num).map((k) => fld(labels[k], num[k])),
      h('label', {}, 'Strategies'), strat.map(([, n, i]) => h('label', { class: 'chk' }, i, n)), h('label', {}, 'AIs that assess every trade'), ais.length ? ais.map(([, n, i]) => h('label', { class: 'chk' }, i, n)) : h('p', { class: 'mut' }, 'Connect an AI under AI Connections first.'),
      h('label', { class: 'chk' }, mon, 'AIs monitor open trades (and can close them) and write lessons to Memory'), flags.map(([, l, i]) => h('label', { class: 'chk' }, i, l)), h('p', {}, save)),
    h('div', { class: 'card' }, h('h2', {}, 'Backtest on past candles'), bt, btOut, h('p', {}, h('button', { class: 'sec', onclick: async () => { btOut.textContent = 'Running…'; try { const r = await api('trading/backtest', 'POST', { strategy: bt.value, symbol: c.symbols[0] });
      btOut.textContent = r.strategy + ': ' + r.trades + ' trades, win rate ' + Math.round(r.winRate * 100) + '%, total ' + r.totalPct + '% on ' + r.candles + ' candles. ' + r.note; } catch (e) { btOut.textContent = e.message; } } }, 'Run backtest'))),
    h('h2', {}, 'Open positions'), st.open.length ? st.open.map(posCard) : h('p', { class: 'mut' }, 'None.'), h('h2', {}, 'Recent closed'), st.recent.length ? st.recent.map(posCard) : h('p', { class: 'mut' }, 'None yet.'),
    h('div', { class: 'card' }, h('h2', {}, 'Journal'), st.journal.length ? st.journal.map((e) => h('p', { class: 'mut' }, new Date(e.t).toLocaleTimeString() + ' ' + e.type + (e.symbol ? ' ' + e.symbol : '') + (e.reason ? ': ' + e.reason : '') + (e.reasons ? ': ' + e.reasons.join('; ') : '') + (e.pnl != null ? ' P&L ' + e.pnl : ''))) : h('p', { class: 'mut' }, 'Nothing yet.')));
  if (st.enabled) poll = setTimeout(render, 5000);
}

async function toolsPage() {
  const [info, provs, prices] = await Promise.all([api('tools'), api('providers'), api('prices')]); const cf = info.config, out = h('pre', { class: 'msg', style: 'display:none;overflow:auto' });
  const show = (v) => { out.style.display = 'block'; out.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); };
  const run = async (tool, args) => { show('Working…'); try { const r = await api('tools/run', 'POST', { tool, args }); show(r.result); return r.result; } catch (e) { show(e.message); } };
  const key = h('input', { type: 'password', autocomplete: 'off', placeholder: cf.braveKey ? 'Key saved (hidden). Paste a new one to replace.' : 'Brave Search API key', 'aria-label': 'Brave Search API key' }), q = h('input', { placeholder: 'Try a search', 'aria-label': 'Search query' }), url = h('input', { type: 'url', placeholder: 'https://… page to read', 'aria-label': 'Page URL' });
  const okp = provs.filter((p) => ['xai', 'openai', 'custom'].includes(p.id) && p.status === 'connected'), ip = h('select', { 'aria-label': 'Image provider' }, h('option', { value: '' }, 'Choose provider'), okp.map((p) => h('option', { value: p.id, selected: p.id === cf.image.providerId }, p.name))),
    im = h('input', { value: cf.image.model || '', placeholder: 'Image model name from your provider\'s docs', 'aria-label': 'Image model' }), ipd = h('input', { type: 'number', value: String(cf.imagesPerDay), min: '1', max: '100', 'aria-label': 'Images per day' }), pr = h('input', { placeholder: 'Describe the image', 'aria-label': 'Image prompt' }), pic = h('div', {});
  const fn = h('input', { placeholder: 'file name, e.g. notes.txt', 'aria-label': 'File name' }), fc = h('textarea', { placeholder: 'Text content', 'aria-label': 'File content' });
  const code = h('textarea', { placeholder: 'console.log(2 + 2)', 'aria-label': 'JavaScript code' }), jsOn = h('input', { type: 'checkbox', checked: cf.jsEnabled });
  const cfg = (b) => async () => { try { await api('tools/config', 'PUT', b()); toolsPage(); } catch (e) { show(e.message); } };
  const pset = provs.filter((p) => p.hasKey).map((p) => { const v = prices[p.id] || {}, a = h('input', { type: 'number', step: 'any', value: String(v.in || 0), 'aria-label': p.name + ' price per million input tokens' }), b = h('input', { type: 'number', step: 'any', value: String(v.out || 0), 'aria-label': p.name + ' price per million output tokens' }), c = h('input', { type: 'number', step: 'any', value: String(v.image || 0), 'aria-label': p.name + ' price per image' });
    return h('div', {}, h('label', {}, p.name + ': USD per 1M input tokens, per 1M output tokens, per image'), h('div', { class: 'row' }, a, b, c), h('p', {}, h('button', { class: 'sec', onclick: async () => { await api('prices', 'PUT', { providerId: p.id, in: a.value, out: b.value, image: c.value }); toolsPage(); } }, 'Save prices'))); });
  shell('Tools', h('p', { class: 'mut' }, 'Each tool shows its real status. Agents can use only the tools you tick for them under Teams. Web pages and files are untrusted input.'),
    ...info.tools.map((t) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, t.name), h('div', { class: 'fit' }, badge(t.status === 'ready' ? 'completed' : t.status === 'disabled' ? 'cancelled' : 'blocked'), ' ', t.status.replace('_', ' '))), h('p', {}, t.desc), h('p', { class: 'mut' }, 'Input ' + t.input + ' · returns ' + t.output + ' · ' + t.permission + (t.note ? ' · ' + t.note : '')))),
    h('div', { class: 'card' }, h('h2', {}, 'Web search and reading'), h('label', {}, 'Brave Search API key (check Brave\'s current free allowance and terms yourself)'), key, h('p', {}, h('button', { onclick: cfg(() => ({ braveKey: key.value })) }, 'Save key')), q, h('p', {}, h('button', { class: 'sec', onclick: () => run('web_search', { query: q.value }) }, 'Search')), url, h('p', {}, h('button', { class: 'sec', onclick: () => run('web_fetch', { url: url.value }) }, 'Read page'))),
    h('div', { class: 'card' }, h('h2', {}, 'Images'), h('p', { class: 'mut' }, 'Costs money per image. Use your provider\'s current image model name.'), ip, im, ipd, h('p', {}, h('button', { onclick: cfg(() => ({ image: { providerId: ip.value, model: im.value }, imagesPerDay: +ipd.value })) }, 'Save image settings')), pr,
      h('p', {}, h('button', { class: 'sec', onclick: async () => { const r = await run('image_generate', { prompt: pr.value }); if (r && r.file) pic.replaceChildren(h('img', { src: '/api/files/' + encodeURIComponent(r.file), alt: 'Generated image', style: 'max-width:100%;border-radius:10px' })); } }, 'Generate image')), pic),
    h('div', { class: 'card' }, h('h2', {}, 'Workspace files'), info.files.length ? info.files.map((f) => h('p', {}, h('a', { href: '/api/files/' + encodeURIComponent(f.name), download: f.name }, f.name), ' ' + f.size + ' bytes ', h('button', { class: 'sec', onclick: async () => { await api('files/' + encodeURIComponent(f.name), 'DELETE'); toolsPage(); } }, 'Delete'))) : h('p', { class: 'mut' }, 'No files yet.'),
      fn, fc, h('p', {}, h('button', { class: 'sec', onclick: async () => { try { await api('files', 'POST', { name: fn.value, content: fc.value }); toolsPage(); } catch (e) { show(e.message); } } }, 'Save file'))),
    h('div', { class: 'card' }, h('h2', {}, 'Run JavaScript (manual only)'), h('p', { class: 'err' }, 'Limited to 5 seconds and 64 MB with no file access, but it can still reach the network. Run only code you have read. Agents cannot use this.'),
      h('label', { class: 'chk' }, jsOn, 'Enable code execution'), h('p', {}, h('button', { class: 'sec', onclick: cfg(() => ({ jsEnabled: jsOn.checked })) }, 'Save')), code,
      h('p', {}, h('button', { onclick: async () => { if (!confirm('Run this code now?')) return; show('Running…'); try { const r = await api('tools/run_js', 'POST', { code: code.value, confirm: true }); show('exit ' + r.exitCode + (r.signal ? ' (' + r.signal + ')' : '') + '\n' + r.stdout + (r.stderr ? '\n[errors]\n' + r.stderr : '')); } catch (e) { show(e.message); } } }, 'Run'))),
    h('div', { class: 'card' }, h('h2', {}, 'Prices (for cost estimates)'), h('p', { class: 'mut' }, 'Enter the prices from your provider\'s pricing page. The app does not guess prices.'), pset.length ? pset : h('p', { class: 'mut' }, 'Add a provider first.')), out);
}

async function render() {
  try { await ({ dashboard, trading, tools: toolsPage, tasks, teams, memory, chat, connections, activity }[view])(); }
  catch (e) { if (e.message !== 'Signed out') shell('Something went wrong', h('div', { class: 'card' }, h('p', { class: 'err' }, e.message), h('button', { onclick: render }, 'Try again'))); }
}
api('me').then(render).catch(showLogin);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
