import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import plugin from '../lib/index.js';
import { Store } from '../lib/store.js';

function fixture(t, { available = true, registryAvailable = true } = {}) {
  const previous = process.env.DSH_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-wiring-'));
  process.env.DSH_HOME = root;
  const store = new Store();
  store.saveState({ ...store.state(), sessionId: 'main-session' });
  const effects = [], injections = [], routes = new Map(), tools = new Map(), guards = [];
  const main = { id: 'main-agent', session: { id: 'main-session' } };
  const worker = { id: 'worker-agent', session: { id: 'worker-session' } };
  const child = { id: 'child-agent', session: { id: 'child-session' } };
  const ordinary = { id: 'ordinary-agent', session: { id: 'ordinary-session' } };
  const all = [main, worker, child, ordinary];
  const registry = { list: () => all, isOwnedBy: (id, owner) => id === child.id && owner === worker };
  const taskRows = [], hostCalls = [], requestCache = new Map();
  const host = {
    snapshot: () => ({ tasks: structuredClone(taskRows), scheduler: { timeZone: 'Asia/Shanghai' } }),
    apply: async (requestId, action, initiator) => {
      const fingerprint = JSON.stringify(action);
      if (requestCache.has(requestId)) { assert.equal(requestCache.get(requestId), fingerprint); return host.snapshot(); }
      hostCalls.push({ requestId, action: structuredClone(action), initiator });
      if (action.kind === 'create') taskRows.push({ id: action.id, ...structuredClone(action.input), status: 'todo', schedule: { ...action.input.schedule, nextRunAt: Date.now() + 3600000, runCount: 0 }, executions: [] });
      else {
        const task = taskRows.find(row => row.id === action.taskId);
        assert.ok(task);
        if (action.kind === 'set-schedule') Object.assign(task.schedule, action.patch);
        else if (action.kind === 'archive') task.archivedAt = Date.now();
      }
      requestCache.set(requestId, fingerprint);
      return host.snapshot();
    },
  };
  const services = new Map();
  if (available) services.set('taskBoard', host);
  if (registryAvailable) services.set('agents', registry);
  function activate(row) {
    if (row.names.every(name => services.has(name))) {
      const childContext = Object.fromEntries(row.names.map(name => [name, services.get(name)]));
      childContext.effect = fn => { const dispose = fn(); if (typeof dispose === 'function') row.disposers.push(dispose); };
      row.active = true;
      row.callback(childContext);
    }
  }
  const ctx = {
    sessionController: { create: () => { throw Error('tests must not create a real conversation'); }, prompt: () => { throw Error('tests must not prompt a real conversation'); } },
    connection: { requestRejection: () => undefined },
    tools: {
      register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); },
      guard: callback => { guards.push(callback); return () => guards.splice(guards.indexOf(callback), 1); },
    },
    webServer: { register: row => { routes.set(row.path, row.handler); return () => routes.delete(row.path); } },
    inject: (names, callback) => { const row = { names, callback, active: false, disposers: [] }; injections.push(row); activate(row); },
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); },
    logger: { warn: () => {} },
  };
  plugin.apply(ctx);
  t.after(() => {
    for (const dispose of effects.reverse()) dispose();
    for (const row of injections) for (const dispose of row.disposers.reverse()) dispose();
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('my-fish-wiring-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = (name, args, subject = main) => tools.get(name).execute(args, { agent: subject, signal: new AbortController().signal });
  const callGuard = (name, args, subject = main) => guards[0]({ name, arguments: args, agent: subject });
  async function http(prefix, method, route, body, overrides = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method; req.url = prefix + '/' + route;
    req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', ...overrides };
    const res = { statusCode: 0, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await routes.get(prefix)(req, res);
    return { status: res.statusCode, body: res.body };
  }
  return { store, tools, routes, run, callGuard, http, taskRows, hostCalls, main, worker, child, ordinary, services,
    connect: (name, value) => { services.set(name, value); for (const row of injections.filter(row => !row.active)) activate(row); },
    host, registry,
  };
}
const draft = requestId => ({ action: 'create', requestId, title: '受控测试计划', instruction: '仅查看公开测试资料，有变化才通知。', schedule: { mode: 'cron', cron: '0 * * * *', timeZone: 'Asia/Shanghai' } });

test('temporary snooze is a trusted settings-only operation with strict presets and no new model tool', async t => {
  const f=fixture(t),before=JSON.stringify(f.store.state());
  assert.equal(f.tools.has('assistant_snooze'),false);assert.equal(f.tools.size,23);
  for(const prefix of ['/my-fish/api','/x-whale/api']){
    const paused=await f.http(prefix,'POST','assistant/snooze',{preset:'two-hours'});
    assert.equal(paused.status,200);assert.equal(paused.body.settings.enabled,false);assert.ok(paused.body.settings.snoozeUntil>Date.now());
    const until=paused.body.settings.snoozeUntil;
    assert.equal((await f.http(prefix,'GET','assistant/snooze')).status,405);
    assert.equal((await f.http(prefix,'POST','assistant/snooze',{preset:'resume'},{origin:'https://untrusted.invalid'})).status,403);
    for(const body of [null,[],{}, {preset:1},{preset:'unknown'},{preset:'resume',enabled:true},{snoozeUntil:null}])assert.equal((await f.http(prefix,'POST','assistant/snooze',body)).status,400);
    assert.equal((await f.http(prefix,'GET','assistant')).body.settings.snoozeUntil,until);
    assert.equal((await f.http(prefix,'POST','assistant/settings',{intervalMinutes:240})).body.settings.snoozeUntil,until);
    assert.equal((await f.http(prefix,'POST','assistant/settings',{snoozeUntil:null})).status,400);
    assert.equal((await f.http(prefix,'POST','assistant/snooze',{preset:'resume'})).body.settings.snoozeUntil,null);
  }
  assert.equal(JSON.stringify(f.store.state()),before);assert.equal(f.hostCalls.length,0);
});

test('temporary snooze does not pause exact task-board schedules or suppress their valid local reports', async t => {
  const f=fixture(t),created=await f.run('assistant_plan',draft('snooze-exact-plan'));
  const original=structuredClone(f.taskRows[0].schedule);
  await f.http('/my-fish/api','POST','assistant/snooze',{preset:'two-hours'});
  assert.deepEqual(f.taskRows[0].schedule,original);assert.equal(f.hostCalls.length,1);
  assert.equal((await f.http('/my-fish/api','GET','plans')).body.plans[0].status,'scheduled');
  f.taskRows[0].executions.push({id:'snooze-host-execution',sessionId:'worker-session',startedAt:Date.now()});
  const report=await f.run('assistant_plan_report',{id:created.plan.id,notify:true,title:'Synthetic exact reminder',summary:'Synthetic reminder delivered during proactive snooze.'},f.worker);
  assert.equal(report.notified,true);assert.equal((await f.http('/my-fish/api','GET','assistant')).body.inbox.length,1);
  assert.deepEqual(f.taskRows[0].schedule,original);assert.equal(f.taskRows[0].executions[0].endedAt,undefined);
  assert.ok((await f.http('/my-fish/api','GET','assistant')).body.settings.snoozeUntil>Date.now());
});

test('plugin routes current and legacy APIs through identical trust checks and accepts actual UI create shape', async t => {
  const f = fixture(t), prefix = '/my-fish/api';
  assert.ok(f.routes.has('/x-whale/api'));
  const created = await f.http(prefix, 'POST', 'plans', draft('ui-create'));
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.equal(f.hostCalls[0].initiator, 'main-session');
  assert.equal(f.hostCalls[0].action.input.permission, 'read-only');
  assert.equal(f.taskRows.length, 1);
  const legacy = await f.http('/x-whale/api', 'GET', 'plans');
  assert.equal(legacy.body.plans[0].id, created.body.plan.id);
  const retried = await f.http(prefix, 'POST', 'plans', draft('ui-create'));
  assert.equal(retried.body.replayed, true);
  assert.equal(f.taskRows.length, 1);
  const denied = await f.http('/x-whale/api', 'POST', 'plans', draft('evil-create'), { origin: 'https://untrusted.example' });
  assert.equal(denied.status, 403);
  assert.equal(f.taskRows.length, 1);
});

test('plugin tools enforce main-only management, strip create action and accept host-scoped plan report', async t => {
  const f = fixture(t);
  await assert.rejects(f.run('assistant_plan', draft('ordinary-request'), f.ordinary), /专用个人助理会话/);
  const created = await f.run('assistant_plan', draft('tool-create'));
  assert.equal(created.ok, true);
  const id = created.plan.id;
  f.taskRows[0].executions.push({ id: 'actual-host-execution', sessionId: 'worker-session', startedAt: Date.now() });
  await assert.rejects(f.run('assistant_plan', { action: 'pause', id, requestId: 'worker-pause' }, f.worker), /计划会话/);
  await assert.rejects(f.run('assistant_plan_report', { id, notify: false, summary: '测试静默结果' }, f.ordinary), /匹配/);
  const report = await f.run('assistant_plan_report', { id, notify: false, summary: '公开测试资料没有变化。' }, f.worker);
  assert.equal(report.notified, false);
  assert.equal(f.store.state().planReports[0].executionId, 'actual-host-execution');
  assert.equal(f.taskRows[0].executions[0].endedAt, undefined);
  const paused = await f.run('assistant_plan', { action: 'pause', id, requestId: 'main-pause' });
  assert.equal(paused.plan.schedule.enabled, false);
});

test('runtime-owned plan descendants remain read-only even when main machine permissions are enabled', async t => {
  const f = fixture(t);
  const created = await f.run('assistant_plan', draft('scope-create'));
  f.taskRows[0].executions.push({ id: 'host-execution', sessionId: 'worker-session', startedAt: Date.now() });
  await f.http('/my-fish/api', 'POST', 'permissions', { shell: true, fileWrite: true, browserInteract: true, delegation: true });
  for (const subject of [f.worker, f.child]) {
    for (const name of ['pwsh', 'run_code', 'write', 'edit', 'bsk_interact', 'subagent', 'assistant_context', 'assistant_memory', 'assistant_goal', 'assistant_plan', 'social_action']) assert.equal(typeof f.callGuard(name, {}, subject), 'string', name);
    assert.equal(f.callGuard('web_search', { query: 'public documentation' }, subject), undefined);
  }
  assert.equal(f.callGuard('pwsh', {}, f.main), undefined);
  assert.equal(f.callGuard('pwsh', {}, f.ordinary), undefined);
  await assert.rejects(f.run('assistant_plan_report', { id: created.plan.id, notify: false, summary: 'child report' }, f.child), /匹配/);
});

test('optional taskBoard can appear after plugin apply without creating a substitute timer', async t => {
  const f = fixture(t, { available: false, registryAvailable: false });
  const unavailable = await f.http('/my-fish/api', 'GET', 'plans');
  assert.equal(unavailable.body.available, false);
  const refused = await f.http('/my-fish/api', 'POST', 'plans', draft('unavailable-create'));
  assert.equal(refused.status, 400);
  assert.equal(f.taskRows.length, 0);
  f.connect('taskBoard', f.host);
  f.connect('agents', f.registry);
  const created = await f.http('/my-fish/api', 'POST', 'plans', draft('later-create'));
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.equal(f.hostCalls.length, 1);
  const capabilities = await f.run('assistant_capabilities', {});
  assert.equal(capabilities.plansAvailable, true);
  assert.equal(capabilities.capabilities.descendantScopeAvailable, true);
});

test('API update accepts UI taskId alias and never edits the host-frozen task instruction', async t => {
  const f = fixture(t), created = await f.http('/my-fish/api', 'POST', 'plans', draft('edit-create'));
  const id = created.body.plan.id;
  f.taskRows[0].executions.push({ id: 'finished-run', sessionId: 'finished-worker', startedAt: 10, endedAt: 20, result: 'succeeded' });
  const changed = await f.http('/my-fish/api', 'POST', 'plans', { action: 'update', taskId: id, requestId: 'edit-time', schedule: { mode: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Shanghai' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.plan.schedule.cron, '0 9 * * *');
  assert.equal(f.hostCalls.at(-1).action.kind, 'set-schedule');
  assert.equal(f.taskRows[0].integrations['dsh-my-fish'].instruction, draft('ignored').instruction);
});
