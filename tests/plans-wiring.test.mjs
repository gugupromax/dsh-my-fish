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
        else if (action.kind === 'update') {
          assert.deepEqual(Object.keys(action).sort(), ['kind', 'patch', 'taskId']);
          assert.ok(Object.keys(action.patch).length > 0);
          assert.ok(Object.keys(action.patch).every(key => ['title', 'prompt'].includes(key)), 'content updates cannot patch permissions, integrations or schedules');
          if (task.archivedAt !== undefined || task.executions.length > 0) throw Error('task content is frozen after its first execution');
          for (const [key, value] of Object.entries(action.patch)) task[key] = value.trim();
          // Mirror the native content transition so an unsafe update of a
          // continuation snapshot cannot be hidden by a more permissive mock.
          task.freeze = undefined; task.handover = undefined;
        } else assert.fail('unsupported host action: ' + action.kind);
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

test('plan tool declares management ID aliases and explains update fields', async t => {
  const f = fixture(t), definition = f.tools.get('assistant_plan'), properties = definition.parameters.properties;
  for (const key of ['id', 'taskId', 'planId', 'requestId', 'title', 'instruction', 'schedule']) assert.ok(properties[key], key + ' is supported by the declared tool schema');
  assert.match(definition.description, /update|修改/);
  assert.match(properties.requestId.description ?? definition.description, /requestId|请求/);
  assert.match([properties.instruction.description, definition.description].join(' '), /指令|正文|内容/);
});

test('main tool updates current content through native update while preserving creation identity and schedule', async t => {
  const f = fixture(t), original = draft('content-tool-create'), created = await f.run('assistant_plan', original), id = created.plan.id;
  const marker = structuredClone(f.taskRows[0].integrations), initialSchedule = structuredClone(f.taskRows[0].schedule);
  for (const [index, alias] of ['id', 'taskId', 'planId'].entries()) {
    const instruction = 'Synthetic public reading instruction ' + index;
    const changed = await f.run('assistant_plan', { action: 'update', [alias]: id, requestId: 'content-tool-update-' + index, instruction });
    assert.equal(changed.ok, true); assert.equal(changed.plan.instruction, instruction);
    assert.equal(changed.plan.canEditContent, true);
    assert.equal(changed.plan.contentEditReason, null);
    const call = f.hostCalls.at(-1);
    assert.equal(call.action.kind, 'update'); assert.equal(call.initiator, 'main-session');
    assert.deepEqual(Object.keys(call.action.patch), ['prompt']);
    assert.match(call.action.patch.prompt, /assistant_plan_report/);
    assert.match(call.action.patch.prompt, /独立只读计划执行/);
    assert.ok(call.action.patch.prompt.includes(instruction));
    assert.deepEqual(f.taskRows[0].schedule, initialSchedule);
    assert.deepEqual(f.taskRows[0].integrations, marker);
    assert.equal(f.taskRows[0].permission, 'read-only');
    assert.equal(f.taskRows[0].reuseSession, false); assert.equal(f.taskRows[0].goalRun, false);
    const listed = await f.run('assistant_plan', { action: 'list' });
    assert.equal(listed.plans[0].instruction, instruction);
    assert.deepEqual(listed, JSON.parse(JSON.stringify(listed)), 'current content receipts are already lossless JSON');
  }
  const renamed = await f.run('assistant_plan', { action: 'update', id, requestId: 'content-tool-title', title: 'Synthetic renamed plan' });
  assert.equal(renamed.plan.title, 'Synthetic renamed plan');
  assert.deepEqual(Object.keys(f.hostCalls.at(-1).action.patch), ['title']);
  const calls = f.hostCalls.length, replay = await f.run('assistant_plan', original);
  assert.equal(replay.replayed, true); assert.equal(replay.plan.title, renamed.plan.title);
  assert.equal(replay.plan.instruction, 'Synthetic public reading instruction 2');
  assert.equal(f.hostCalls.length, calls); assert.equal(f.taskRows.length, 1);
});

test('both trusted API aliases update plan content and reject untrusted requests before host mutations', async t => {
  const f = fixture(t);
  for (const [index, prefix] of ['/my-fish/api', '/x-whale/api'].entries()) {
    const created = await f.http(prefix, 'POST', 'plans', draft('content-api-create-' + index)), id = created.body.plan.id;
    const instruction = 'Synthetic API content ' + index, title = 'Synthetic API title ' + index;
    const body = { action: 'update', taskId: id, requestId: 'content-api-update-' + index, title, instruction };
    const calls = f.hostCalls.length;
    const denied = await f.http(prefix, 'POST', 'plans', body, { origin: 'https://untrusted.example' });
    assert.equal(denied.status, 403); assert.equal(f.hostCalls.length, calls);
    const changed = await f.http(prefix, 'POST', 'plans', body);
    assert.equal(changed.status, 200); assert.equal(changed.body.plan.instruction, instruction); assert.equal(changed.body.plan.title, title);
    assert.deepEqual(Object.keys(f.hostCalls.at(-1).action.patch).sort(), ['prompt', 'title']);
    const listed = await f.http(prefix, 'GET', 'plans');
    assert.equal(listed.body.plans.find(row => row.id === id).instruction, instruction);
    const unchanged = await f.http(prefix, 'POST', 'plans', body);
    assert.equal(unchanged.status, 200); assert.equal(unchanged.body.unchanged, true);
    assert.equal(f.hostCalls.length, calls + 1);
  }
});

test('mixed actual content and time changes reject atomically while unchanged echoes need only one native action', async t => {
  const f = fixture(t), original = draft('mixed-content-create'), created = await f.run('assistant_plan', original), id = created.plan.id;
  const before = structuredClone(f.taskRows), calls = f.hostCalls.length;
  const mixed = { action: 'update', id, requestId: 'mixed-content-update', title: 'Changed title', instruction: 'Changed public reading', schedule: { ...original.schedule, cron: '15 9 * * *' } };
  await assert.rejects(f.run('assistant_plan', mixed), /分开|分别|同时|两次/);
  assert.equal(f.hostCalls.length, calls); assert.deepEqual(f.taskRows, before);
  const contentOnly = await f.run('assistant_plan', { ...mixed, requestId: 'mixed-content-echo-clock', schedule: original.schedule });
  assert.equal(contentOnly.plan.instruction, mixed.instruction); assert.equal(f.hostCalls.at(-1).action.kind, 'update');
  const timeOnly = await f.run('assistant_plan', { ...mixed, requestId: 'mixed-content-echo-content' });
  assert.equal(timeOnly.plan.schedule.cron, mixed.schedule.cron); assert.equal(timeOnly.plan.instruction, mixed.instruction);
  assert.equal(f.hostCalls.at(-1).action.kind, 'set-schedule');
});

test('frozen content rejects changes but accepts identical saved content without resubmission', async t => {
  const f = fixture(t), created = await f.run('assistant_plan', draft('frozen-content-create')), id = created.plan.id;
  const body = { action: 'update', id, requestId: 'frozen-content-saved', instruction: 'Synthetic saved instruction before execution' };
  const changed = await f.run('assistant_plan', body);
  f.taskRows[0].executions.push({ id: 'content-frozen-execution', sessionId: 'worker-session', startedAt: 10, endedAt: 20, result: 'succeeded' });
  const before = structuredClone(f.taskRows), calls = f.hostCalls.length;
  await assert.rejects(f.run('assistant_plan', { ...body, requestId: 'frozen-content-changed', instruction: 'Different instruction after execution' }), /冻结|执行|只读|不能修改/);
  const same = await f.run('assistant_plan', body);
  assert.equal(same.unchanged, true); assert.equal(same.plan.instruction, changed.plan.instruction);
  assert.equal(same.plan.canEditContent, false);
  assert.equal(typeof same.plan.contentEditReason, 'string'); assert.ok(same.plan.contentEditReason.length > 0);
  assert.equal(f.hostCalls.length, calls); assert.deepEqual(f.taskRows, before);
  await assert.rejects(f.run('assistant_plan', { ...body, instruction: 'Ordinary session attempt' }, f.ordinary), /专用个人助理会话/);
  f.taskRows[0].executions.push({ id: 'content-running-execution', sessionId: 'worker-session', startedAt: 21 });
  await assert.rejects(f.run('assistant_plan', { ...body, instruction: 'Worker attempt' }, f.worker), /计划会话/);
  const listed = await f.run('assistant_plan', { action: 'list' });
  assert.equal(listed.plans[0].canEditContent, false);
});

test('management validates stable requests, conflicting aliases and action-specific fields without host writes', async t => {
  const f = fixture(t), created = await f.run('assistant_plan', draft('content-validation-create')), id = created.plan.id;
  const before = structuredClone(f.taskRows), calls = f.hostCalls.length;
  for (const body of [
    { action: 'update', id, instruction: 'Missing stable request' },
    { action: 'update', id, taskId: 'conflicting-plan', requestId: 'content-conflict', instruction: 'Wrong target' },
    { action: 'update', id, planId: 'conflicting-plan', requestId: 'content-conflict-plan', instruction: 'Wrong target' },
    { action: 'pause', id, requestId: 'content-pause-field', instruction: 'Cannot sneak an edit into pause' },
    { action: 'update', id, requestId: 'content-empty-change' },
  ]) await assert.rejects(f.run('assistant_plan', body));
  assert.equal(f.hostCalls.length, calls); assert.deepEqual(f.taskRows, before);
  const valid = await f.run('assistant_plan', { action: 'update', id, taskId: id, planId: id, requestId: 'content-aliases-same', instruction: 'All aliases identify the same plan' });
  assert.equal(valid.ok, true); assert.equal(valid.plan.id, id);
});

test('content updates protect continuation snapshots and handover data from the native clearing transition', async t => {
  const f = fixture(t), created = await f.run('assistant_plan', draft('content-continuation-create')), id = created.plan.id;
  for (const key of ['freeze', 'handover']) {
    const task = f.taskRows[0]; task[key] = { synthetic: 'must be preserved' };
    const before = structuredClone(task), calls = f.hostCalls.length;
    await assert.rejects(f.run('assistant_plan', { action: 'update', id, requestId: 'content-protect-' + key, instruction: 'Changed content must not clear ' + key }));
    assert.deepEqual(task, before); assert.equal(f.hostCalls.length, calls);
    const listed = await f.run('assistant_plan', { action: 'list' });
    assert.equal(listed.plans[0].canEditContent, false);
    assert.equal(typeof listed.plans[0].contentEditReason, 'string'); assert.ok(listed.plans[0].contentEditReason.length > 0);
    delete task[key];
  }
});

test('unrecognized host prompt is not presented as the old integration instruction or silently replaced', async t => {
  const f = fixture(t), original = draft('content-unrecognized-create'), created = await f.run('assistant_plan', original), id = created.plan.id;
  f.taskRows[0].prompt = 'Synthetic externally replaced prompt without the guarded My Fish wrapper';
  const listed = await f.run('assistant_plan', { action: 'list' });
  assert.equal(listed.plans[0].instruction, null); assert.equal(listed.plans[0].canEditContent, false);
  assert.equal(typeof listed.plans[0].contentEditReason, 'string'); assert.ok(listed.plans[0].contentEditReason.length > 0);
  const before = structuredClone(f.taskRows), calls = f.hostCalls.length;
  await assert.rejects(f.run('assistant_plan', { action: 'update', id, requestId: 'content-unrecognized-update', instruction: original.instruction }));
  assert.deepEqual(f.taskRows, before); assert.equal(f.hostCalls.length, calls);
});
