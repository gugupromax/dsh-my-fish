import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import plugin from '../lib/index.js';
import { Store, DEFAULTS } from '../lib/store.js';
import { AssistantStore } from '../lib/assistant-store.js';
import { dayKey } from '../lib/engine.js';

const OLD = 'synthetic-deleted-main';
const agent = id => ({ id, status: 'idle', session: { id, header: { id } } });
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-session-wiring-'));
  const home = path.join(root, 'host'), data = options.custom ? path.join(root, 'custom-private-data') : path.join(home, 'my-fish');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(path.join(data, 'workspace'), { recursive: true });
  if (options.custom) fs.writeFileSync(path.join(home, 'my-fish-location.json'), JSON.stringify({ version: 1, path: data }));
  const store = new Store(data, { home }); store.saveConfig({ ...DEFAULTS, aiUsername: 'syntheticfish' });
  const assistant = new AssistantStore(store);
  assistant.saveSettings({ enabled: true, startHour: 0, endHour: 24 });
  assistant.remember({ text: '保留的合成偏好', category: 'preference', source: '合成用户' });
  assistant.saveGoal({ title: '保留的合成目标', source: '合成用户' });
  assistant.addNotice({ title: '保留的合成动态', body: '恢复会话前已经记录的合成消息。' });
  fs.writeFileSync(store.file('assistant/permissions.json'), JSON.stringify({ shell: false, fileWrite: false, browserInteract: false, delegation: false, privateTerms: ['SYNTHETIC PRIVATE TERM'] }));
  fs.writeFileSync(store.file('credentials.json'), JSON.stringify({ codec: 'dpapi', data: 'SYNTHETIC_ENCRYPTED_BYTES' }));
  fs.writeFileSync(store.file('workspace/example.txt'), 'synthetic work remains in place');
  const oldRun = { id: 'synthetic-old-run', at: 100, sessionId: OLD, status: 'queued', reason: 'old queued evidence' };
  const preserved = {
    inflight: 'synthetic-uncertain-social-action', pausedUntil: Date.now() + 86400000, pauseReason: 'synthetic account pause',
    identity: { id: 'synthetic-account', username: 'syntheticfish' }, ledger: [{ status: 'uncertain', target: 'synthetic-post' }],
    runs: { [dayKey(Date.now())]: 2 }, nextRun: options.due ? 0 : Date.now() + 3600000,
    planReports: [{ planId: 'independent-plan', executionId: 'old-plan-execution', notified: false }],
  };
  store.saveState({ ...store.state(), sessionId: OLD, ...preserved, ...(options.oldActive ? { activeRun: { id: oldRun.id, sessionId: OLD, query: 'must not replay this query' }, dispatchPending: true, lastRun: oldRun, runHistory: [oldRun] } : {}) });
  const beforeFiles = new Map(['config.json', 'credentials.json', 'assistant/profile.json', 'assistant/settings.json', 'assistant/memories.json', 'assistant/goals.json', 'assistant/inbox.json', 'assistant/permissions.json', 'workspace/example.txt'].map(name => [name, fs.readFileSync(store.file(name))]));
  const live = new Map(), metadata = new Map(), rows = [], ownership = new Map(), calls = { create: [], prompt: [], stat: [], resolve: [], warn: [] };
  const registry = { list: () => rows, isOwnedBy: (id, owner) => rows.some(subject => subject.id === id && ownership.get(subject) === owner) };
  const sessions = { get: id => live.get(id) };
  const persistence = { stat: async (id, { signal }) => {
    signal.throwIfAborted(); calls.stat.push(id);
    if (options.ioError) throw Error('synthetic metadata IO failure');
    if (options.badMetadata && id === OLD) return { header: { id: 'different-session' }, revision: 'synthetic' };
    return metadata.get(id);
  } };
  if (options.archived) metadata.set(OLD, { header: { id: OLD }, revision: 'synthetic-version', archived: true });
  if (options.live) { const old = agent(OLD); live.set(OLD, old.session); rows.push(old); }
  const services = new Map();
  if (!options.noRegistry) services.set('agents', registry);
  if (!options.noSessions) services.set('sessions', sessions);
  if (!options.noPersistence) services.set('sessionPersistence', persistence);
  const tools = new Map(), routes = new Map(), guards = [], effects = [], injections = [], ticks = [];
  const activate = entry => {
    if (!entry.active && entry.names.every(name => services.has(name))) {
      entry.active = true;
      entry.callback({ ...Object.fromEntries(services), effect: fn => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); } });
    }
  };
  const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = home;
  const nativeSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms, ...args) => { ticks.push(fn); return nativeSetInterval(fn, ms, ...args); };
  try {
    plugin.apply({
      sessionController: {
        create: async request => {
          calls.create.push(structuredClone(request));
          if (options.failCreateBefore && calls.create.length === 1) throw Error('synthetic create failure before commit');
          const created = agent(request.sessionId); created.session.header.cwd = request.cwd; created.session.effectiveCwd = request.cwd;
          live.set(request.sessionId, created.session); metadata.set(request.sessionId, { header: { id: request.sessionId }, revision: 'created-version' }); rows.push(created);
          if (options.unknownCreateOnce && calls.create.length === 1) throw Error('synthetic unknown create outcome');
          await Promise.resolve(); return { sessionId: request.sessionId };
        },
        prompt: async request => { calls.prompt.push(request); return { accepted: true }; },
        resolveAgent: async id => { calls.resolve.push(id); return { agent: rows.find(row => row.session.id === id) }; },
      },
      connection: { requestRejection: () => undefined },
      tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); }, guard: fn => { guards.push(fn); return () => {}; } },
      webServer: { register: definition => { routes.set(definition.path, definition.handler); return () => routes.delete(definition.path); } },
      inject: (names, callback) => { const entry = { names, callback, active: false }; injections.push(entry); activate(entry); },
      effect: fn => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); },
      logger: { warn: (...args) => calls.warn.push(args) },
    });
  } finally { globalThis.setInterval = nativeSetInterval; }
  t.after(() => {
    for (const dispose of effects.reverse()) dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('my-fish-session-wiring-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function dispatch(method, endpoint, body = {}, { legacy = false, origin = 'http://127.0.0.1:3000' } = {}) {
    const prefix = legacy ? '/x-whale/api' : '/my-fish/api';
    const req = Readable.from(method === 'GET' ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: prefix + '/' + endpoint, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3000', origin, 'content-type': 'application/json' } });
    let result;
    const res = { statusCode: 0, setHeader() {}, end(value) { result = { status: this.statusCode, data: JSON.parse(value) }; } };
    await routes.get(prefix)(req, res); return result;
  }
  return { root, home, data, store, assistant, preserved, beforeFiles, oldRun, rows, ownership, calls, live, metadata, tools, ticks, options, dispatch,
    connect: (name, service) => { services.set(name, service); for (const entry of injections) activate(entry); }, sessions, persistence, registry,
    execute: (name, args, subject = agent('ordinary-session')) => tools.get(name).execute(args, { agent: subject, signal: new AbortController().signal }),
    guard: (name, args, subject) => guards[0]({ name, arguments: args, agent: subject }),
  };
}

test('trusted manual recovery through both APIs creates one replacement without prompt or private file changes', async t => {
  const f = fixture(t, { oldActive: true, custom: true });
  const [first, second] = await Promise.all([f.dispatch('POST', 'session'), f.dispatch('POST', 'session', {}, { legacy: true })]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.notEqual(first.data.sessionId, OLD); assert.equal(first.data.sessionId, second.data.sessionId);
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 0);
  assert.equal(f.calls.create[0].cwd, path.join(f.data, 'workspace'));
  assert.equal(f.store.state().sessionId, first.data.sessionId);
  assert.equal(f.store.state().sessionCreation, null);
  for (const [name, bytes] of f.beforeFiles) assert.deepEqual(fs.readFileSync(f.store.file(name)), bytes, name);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'my-fish-location.json'), 'utf8')).path, f.data);
  assert.equal(f.calls.resolve.length, 0, 'session presence only inspects metadata, not restored runtime');
});

test('recovery interrupts old run, retains account pause and quota, and late old finish is rejected', async t => {
  const f = fixture(t, { oldActive: true });
  const response = await f.dispatch('POST', 'session'), id = response.data.sessionId, state = f.store.state();
  assert.equal(state.activeRun, null); assert.equal(state.dispatchPending, false);
  assert.equal(state.lastRun.status, 'interrupted'); assert.equal(state.lastRun.sessionId, OLD);
  assert.equal(state.runHistory[0].id, f.oldRun.id); assert.equal(state.runHistory[0].status, 'interrupted');
  for (const [key, value] of Object.entries(f.preserved)) assert.deepEqual(state[key], value, key);
  assert.equal(state.sessionRecovery.followupPaused, true);
  assert.ok(state.retiredSessionIds.includes(OLD));
  await assert.rejects(f.execute('assistant_finish', { runId: f.oldRun.id, notify: false, summary: 'late old result' }, agent(id)), /已结束|不匹配/);
  await assert.rejects(f.execute('assistant_finish', { runId: f.oldRun.id, notify: false, summary: 'retired result' }, agent(OLD)), /引用已失效/);
  const visible = await f.dispatch('GET', 'state');
  assert.equal(visible.data.sessionRecovery.followupPaused, true);
  assert.equal(visible.data.pausedUntil, f.preserved.pausedUntil);
  const permissions = await f.dispatch('GET', 'permissions'); assert.equal(permissions.status, 200);
  assert.equal(permissions.data.policy.shell, false);
});

test('followup-resume changes only recovery pause and never clears account uncertainty or prompts', async t => {
  const f = fixture(t, { oldActive: true }); await f.dispatch('POST', 'session');
  const before = f.store.state();
  const denied = await f.dispatch('POST', 'session/followup-resume', {}, { origin: 'https://untrusted.example' });
  assert.equal(denied.status, 403); assert.equal(f.store.state().sessionRecovery.followupPaused, true);
  const resumed = await f.dispatch('POST', 'session/followup-resume'); assert.equal(resumed.status, 200);
  const after = f.store.state(), expected = structuredClone(before); expected.sessionRecovery.followupPaused = false;
  assert.deepEqual(after, expected);
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 0);
});

test('temporarily absent metadata services and IO errors preserve old binding and all state', async t => {
  const f = fixture(t, { noPersistence: true, oldActive: true }), before = f.store.state();
  assert.equal((await f.dispatch('POST', 'session')).status, 400);
  assert.deepEqual(f.store.state(), before); assert.equal(f.calls.create.length, 0);
  f.connect('sessionPersistence', f.persistence); f.options.ioError = true;
  const error = await f.dispatch('POST', 'session'); assert.equal(error.status, 400); assert.match(error.data.error, /IO failure/);
  assert.deepEqual(f.store.state(), before); assert.equal(f.calls.create.length, 0);
  f.options.ioError = false;
  assert.equal((await f.dispatch('POST', 'session')).status, 200);
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 0);
});

test('live and archived metadata keep the original main rather than interpreting absence from sidebar as deletion', async t => {
  const f = fixture(t, { archived: true }), before = f.store.state();
  const archived = await f.dispatch('POST', 'session'); assert.equal(archived.status, 200);
  assert.equal(archived.data.sessionId, OLD); assert.equal(archived.data.created, false);
  assert.deepEqual(f.store.state(), before);
  f.metadata.delete(OLD); const live = agent(OLD); f.live.set(OLD, live.session); f.rows.push(live);
  assert.equal((await f.dispatch('POST', 'session')).data.sessionId, OLD);
  assert.equal(f.calls.create.length, 0); assert.equal(f.calls.prompt.length, 0);
});

test('late optional sessions and runtime registry must both be ready before absence authorizes replacement', async t => {
  const f = fixture(t, { noSessions: true, noRegistry: true }), before = f.store.state();
  assert.equal((await f.dispatch('POST', 'session')).status, 400);
  assert.deepEqual(f.store.state(), before);
  f.connect('sessions', f.sessions);
  const noRuntime = await f.dispatch('POST', 'session'); assert.equal(noRuntime.status, 400);
  assert.match(noRuntime.data.error, /运行状态尚未就绪/);
  assert.deepEqual(f.store.state(), before); assert.equal(f.calls.create.length, 0);
  f.connect('agents', f.registry);
  assert.equal((await f.dispatch('POST', 'session')).status, 200);
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 0);
});

test('malformed metadata and lingering old runtime are errors, not deleted-session evidence', async t => {
  const f = fixture(t, { badMetadata: true }), before = f.store.state();
  const malformed = await f.dispatch('POST', 'session'); assert.equal(malformed.status, 400);
  assert.match(malformed.data.error, /元数据无法核验/); assert.deepEqual(f.store.state(), before);
  f.options.badMetadata = false; f.rows.push(agent(OLD));
  const lingering = await f.dispatch('POST', 'session'); assert.equal(lingering.status, 400);
  assert.match(lingering.data.error, /卸载或运行/); assert.deepEqual(f.store.state(), before);
  assert.equal(f.calls.create.length, 0); assert.equal(f.calls.prompt.length, 0);
});

test('unknown creation outcome is reconciled from persisted requested ID, not duplicated on next API call', async t => {
  const f = fixture(t, { unknownCreateOnce: true });
  assert.equal((await f.dispatch('POST', 'session')).status, 400);
  const pending = f.store.state().sessionCreation; assert.ok(pending.id); assert.equal(f.store.state().sessionId, OLD);
  const retry = await f.dispatch('POST', 'session');
  assert.equal(retry.status, 200); assert.equal(retry.data.sessionId, pending.id);
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 0);
  assert.equal(f.store.state().sessionCreation, null);
});

test('automatic timer and wake tool never replace deleted main, and recovery pause prevents automatic replay', async t => {
  const f = fixture(t, { due: true }); await f.dispatch('GET', 'state');
  f.ticks[0](); await flush();
  assert.equal(f.calls.create.length, 0); assert.equal(f.calls.prompt.length, 0);
  assert.equal(f.store.state().sessionId, OLD);
  assert.ok(f.calls.warn.length > 0);
  await assert.rejects(f.execute('assistant_wake', { message: 'new explicit task' }), /手动点击/);
  assert.equal(f.calls.create.length, 0); assert.equal(f.calls.prompt.length, 0);
  const recovered = await f.dispatch('POST', 'session'); assert.equal(recovered.status, 200);
  assert.equal(f.store.state().sessionRecovery.followupPaused, true);
  f.ticks[0](); await flush();
  assert.equal(f.calls.create.length, 1); assert.equal(f.calls.prompt.length, 0);
  assert.equal(f.store.state().activeRun, null);
});

test('read-only assistant tools are usable without waking a main, while retired roots and descendants remain revoked', async t => {
  const f = fixture(t); await f.dispatch('GET', 'state');
  const recalled = await f.execute('assistant_memory', { action: 'recall', query: '合成偏好' });
  assert.equal(recalled.memories.length, 1);
  assert.equal((await f.execute('assistant_context', { query: '合成偏好' })).memories.length, 1);
  assert.equal((await f.execute('assistant_goal', { action: 'list' })).goals.length, 1);
  assert.equal((await f.execute('assistant_capabilities', {})).ok, true);
  assert.equal(f.calls.create.length, 0); assert.equal(f.calls.prompt.length, 0);
  await f.dispatch('POST', 'session');
  const old = agent(OLD), child = agent('synthetic-old-child'); f.rows.push(old, child); f.ownership.set(child, old);
  for (const subject of [old, child]) {
    assert.match(f.guard('pwsh', { command: 'synthetic' }, subject), /引用已失效/);
    assert.match(f.guard('assistant_context', {}, subject), /引用已失效/);
  }
  assert.equal(f.guard('pwsh', {}, agent('unrelated-ordinary')), undefined);
});
