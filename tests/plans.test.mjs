import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';
import { Plans, PLAN_INTEGRATION, validCron, validateSchedule } from '../lib/plans.js';

const NOW = Date.UTC(2026, 9, 25, 8);
const schedule = { mode: 'cron', cron: '0 * * * *', timeZone: 'Asia/Shanghai' };
const input = (requestId = 'create-one') => ({ requestId, title: '公开消息', instruction: '只读查看公开测试来源，有新消息才通知。', schedule });
const exec = id => ({ agent: { session: { id } } });
function fixture() {
  let state = {}, tasks = [], failAfterCommit = false;
  const calls = [], requests = new Map(), notices = [];
  const store = { state: () => structuredClone(state), saveState: value => { state = structuredClone(value); } };
  const host = {
    snapshot: () => ({ tasks: structuredClone(tasks), scheduler: { timeZone: 'Asia/Shanghai' } }),
    apply: async (requestId, action, initiator) => {
      calls.push({ requestId, action: structuredClone(action), initiator });
      const fingerprint = JSON.stringify(action);
      if (requests.has(requestId)) { assert.equal(requests.get(requestId), fingerprint, 'host rejects changed actions on the same request key'); return host.snapshot(); }
      if (action.kind === 'create') {
        assert.ok(!tasks.some(row => row.id === action.id));
        tasks.push({ id: action.id, ...structuredClone(action.input), status: 'todo', executions: [], schedule: { ...action.input.schedule, lastTriggeredAt: undefined, runCount: 0, nextRunAt: action.input.schedule.enabled ? NOW + 3600000 : undefined } });
      } else {
        const task = tasks.find(row => row.id === action.taskId);
        assert.ok(task);
        if (action.kind === 'archive') { task.archivedAt = NOW; task.schedule.enabled = false; }
        else if (action.kind === 'update') {
          if (task.archivedAt !== undefined || task.executions.length) throw Error('content-frozen');
          assert.ok(Object.keys(action.patch).every(key => ['title', 'prompt'].includes(key)));
          Object.assign(task, structuredClone(action.patch));
        }
        else {
          if (action.patch.mode === 'once' && action.patch.enabled && action.patch.at <= NOW) throw Error('invalid schedule');
          task.schedule = { ...task.schedule, ...structuredClone(action.patch), nextRunAt: action.patch.enabled === false ? undefined : NOW + 3600000 };
          if (action.patch.mode === 'once') { delete task.schedule.cron; delete task.schedule.maxRuns; }
          if (action.patch.mode === 'cron') delete task.schedule.at;
        }
      }
      requests.set(requestId, fingerprint);
      if (failAfterCommit) { failAfterCommit = false; throw Error('connection lost after commit'); }
      return host.snapshot();
    },
  };
  const assistant = { addNotice: notice => {
    if (notices.some(row => JSON.stringify(row.links) === JSON.stringify(notice.links))) return { notice: { id: 'notice-one' }, deduplicated: true };
    notices.push(structuredClone(notice)); return { notice: { id: 'notice-one' }, deduplicated: false };
  } };
  const plans = new Plans({ getHost: () => host, assistant, store, now: () => NOW });
  return { plans, host, store, assistant, calls, notices, rows: () => tasks, failNext: () => { failAfterCommit = true; } };
}

test('plan availability is explicit and absence never creates an independent scheduler', async () => {
  const plans = new Plans();
  assert.deepEqual(plans.list().plans, []);
  assert.equal(plans.list().available, false);
  await assert.rejects(plans.create(input()), /任务看板未连接/);
  assert.equal(plans.isPlanSession(exec('unrelated')), false);
});

test('schedules require a concrete IANA zone, correct grammar and future once times', () => {
  for (const cron of ['0 * * * *', '*/15 9-18 * * 1-5', '0,30 1/2 * 1,6 0,7']) assert.equal(typeof validCron(cron), 'string');
  for (const cron of ['* * * *', '60 * * * *', '0 24 * * *', '0 0 0 * *', '0 0 * 13 *', '0 0 * * 8', '*/0 * * * *', '0/2/3 * * * *', '3-1 * * * *']) assert.throws(() => validCron(cron));
  assert.throws(() => validateSchedule({ ...schedule, timeZone: 'CST' }, NOW), /时区/);
  assert.throws(() => validateSchedule({ ...schedule, timeZone: 'Invalid/Place' }, NOW), /时区/);
  assert.throws(() => validateSchedule({ ...schedule, at: NOW + 1 }, NOW), /同时/);
  assert.throws(() => validateSchedule({ mode: 'once', at: NOW, timeZone: 'UTC' }, NOW), /未来/);
  assert.throws(() => validateSchedule({ ...schedule, maxRuns: 0 }, NOW), /正整数/);
  assert.equal(validateSchedule({ mode: 'once', at: NOW + 1, timeZone: 'UTC' }, NOW).at, NOW + 1);
});

test('create uses the public host action with fixed read-only isolated execution and no defaults', async () => {
  const f = fixture(), result = await f.plans.create(input(), 'main-session');
  assert.equal(result.ok, true);
  assert.equal(result.plan.status, 'scheduled');
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.action.kind, 'create');
  assert.equal(call.initiator, 'main-session');
  assert.equal(call.action.input.permission, 'read-only');
  assert.equal(call.action.input.applyCardDefaults, false);
  assert.equal(call.action.input.reuseSession, false);
  assert.equal(Object.hasOwn(call.action.input, 'teamRun'), false, 'legacy team execution defaults off; retired wire fields must be omitted');
  assert.equal(call.action.input.goalRun, false);
  assert.match(call.action.input.prompt, /assistant_plan_report/);
  assert.match(call.action.input.prompt, /不是个人主会话/);
  assert.equal(call.action.input.integrations[PLAN_INTEGRATION].sourceSessionId, 'main-session');
  assert.equal(f.plans.list().plans.length, 1);
  assert.equal(f.plans.list().recovery, 'skip-missed');
});

test('creation retries are deterministic across adapter instances and do not duplicate after unknown commit', async () => {
  const f = fixture(); f.failNext();
  await assert.rejects(f.plans.create(input(), 'main'), /connection lost/);
  const fresh = new Plans({ getHost: () => f.host, assistant: f.assistant, store: f.store, now: () => NOW });
  const retried = await fresh.create(input(), 'main');
  assert.equal(retried.replayed, true);
  assert.equal(f.rows().length, 1);
  assert.equal(f.calls.length, 1);
  await assert.rejects(fresh.create({ ...input(), instruction: 'changed' }, 'main'), /另一项计划/);
  await assert.rejects(fresh.create(input(), 'another-session'), /另一项计划/);
});

test('plan responses are already lossless JSON across host optional fields and all management actions', async () => {
  const f = fixture(), check = value => { assert.deepEqual(value, JSON.parse(JSON.stringify(value))); return value; };
  const created = await f.plans.create(input(), 'main');
  assert.equal(Object.hasOwn(f.rows()[0].schedule, 'lastTriggeredAt'), true, 'real host retains own undefined optional fields');
  assert.equal(f.rows()[0].schedule.lastTriggeredAt, undefined);
  check(created);
  check(f.plans.list());
  check(await f.plans.create(input(), 'main'));
  const id = created.plan.id;
  for (const action of ['pause', 'resume', 'update', 'cancel']) {
    const result = await f.plans.manage({ id, action, requestId: 'json-' + action, ...(action === 'update' ? { schedule: { mode: 'once', at: NOW + 7200000, timeZone: 'UTC' } } : {}) });
    check(result); check(f.plans.list());
  }
  check(await f.plans.manage({ id, action: 'cancel', requestId: 'json-cancel' }));
  assert.equal(f.rows().length, 1);
  assert.equal(f.calls.length, 5, 'JSON checking and retries never submit extra mutations');
});

test('public schedule fields omit unset values without losing stop metadata or mutating the host', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  const task = f.rows()[0];
  Object.assign(task.schedule, { lastTriggeredAt: NOW, endedAt: NOW + 1, endedReason: 'limit', skippedAt: NOW - 1, skippedReason: 'busy', extension: { privateValue: 'synthetic-unpublished' } });
  const before = structuredClone(task), view = f.plans.list().plans[0];
  assert.deepEqual(view.schedule, { enabled: true, mode: 'cron', cron: schedule.cron, timeZone: 'Asia/Shanghai', nextRunAt: NOW + 3600000, runCount: 0, lastTriggeredAt: NOW, endedAt: NOW + 1, endedReason: 'limit', skippedAt: NOW - 1, skippedReason: 'busy' });
  assert.deepEqual(task, before);
  view.schedule.cron = 'changed copy';
  assert.equal(task.schedule.cron, schedule.cron);
});

test('execution history and older partial report receipts are lossless JSON without invented values', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  f.rows()[0].executions.push({ id: 'json-open-run', sessionId: undefined, startedAt: NOW, endedAt: undefined, result: undefined, error: undefined });
  f.store.saveState({ planReports: [{ planId: plan.id, executionId: 'older-receipt', at: NOW, notify: false }] });
  const result = f.plans.list();
  assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
  assert.equal(result.plans[0].lastRun.result, 'running');
  assert.equal(result.plans[0].lastRun.endedAt, null);
  assert.equal(result.plans[0].lastRun.sessionId, null);
  assert.equal(result.plans[0].runReports[0].notified, undefined, 'missing historical facts are not invented');
});

test('repeated create after a one-shot has fired returns its original stopped plan', async () => {
  const f = fixture(), once = { ...input(), schedule: { mode: 'once', at: NOW + 1, timeZone: 'UTC' } };
  await f.plans.create(once);
  f.rows()[0].schedule.enabled = false;
  f.rows()[0].schedule.endedReason = 'fired';
  const later = new Plans({ getHost: () => f.host, store: f.store, now: () => NOW + 100 });
  assert.equal((await later.create(once)).replayed, true);
  assert.equal(f.calls.length, 1);
});

test('pause resume update and cancel use only task board actions and retain history', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  const paused = await f.plans.manage({ taskId: plan.id, action: 'pause', requestId: 'pause-one' });
  assert.equal(paused.plan.schedule.enabled, false);
  const resumed = await f.plans.manage({ id: plan.id, action: 'resume', requestId: 'resume-one' });
  assert.equal(resumed.plan.schedule.enabled, true);
  await f.plans.manage({ planId: plan.id, action: 'update', requestId: 'change-time', schedule: { ...schedule, cron: '0 9 * * *' } });
  assert.equal(f.rows()[0].schedule.cron, '0 9 * * *');
  const cancelled = await f.plans.manage({ id: plan.id, action: 'cancel', requestId: 'cancel-one' });
  assert.equal(cancelled.plan.status, 'cancelled');
  assert.equal((await f.plans.manage({ id: plan.id, action: 'cancel', requestId: 'cancel-one' })).replayed, true);
  assert.ok(f.rows()[0]);
  await assert.rejects(f.plans.manage({ id: plan.id, action: 'resume', requestId: 'after-cancel' }), /已取消/);
});

test('management cannot touch unrelated cards or claim a running plan was cancelled', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  f.rows().push({ id: 'someone-else', executions: [], schedule: { enabled: true } });
  assert.equal(f.plans.list().plans.length, 1);
  await assert.rejects(f.plans.manage({ id: 'someone-else', action: 'pause', requestId: 'wrong-card' }), /不是 My Fish/);
  f.rows()[0].executions.push({ id: 'run-one', sessionId: 'worker', startedAt: NOW });
  const calls = f.calls.length;
  await assert.rejects(f.plans.manage({ id: plan.id, action: 'cancel', requestId: 'stop-running' }), /本轮仍在运行/);
  assert.equal(f.calls.length, calls);
  await f.plans.manage({ id: plan.id, action: 'pause', requestId: 'pause-running' });
  assert.equal(f.rows()[0].executions[0].endedAt, undefined);
  assert.equal(f.plans.list().plans[0].status, 'running');
});

test('editing paused schedule preserves disabled state and run cap unless explicitly changed', async () => {
  const f = fixture(), { plan } = await f.plans.create({ ...input(), schedule: { ...schedule, maxRuns: 5 } });
  await f.plans.manage({ id: plan.id, action: 'pause', requestId: 'pause-before-edit' });
  const edited = await f.plans.manage({ id: plan.id, action: 'update', requestId: 'edit-while-paused', schedule: { ...schedule, cron: '30 9 * * *' } });
  assert.equal(edited.plan.schedule.enabled, false, 'editing a time is not authorization to resume a plan');
  assert.equal(edited.plan.schedule.maxRuns, 5);
  assert.equal(f.calls.at(-1).action.patch.enabled, false);
  assert.equal(f.calls.at(-1).action.patch.maxRuns, 5);
  const explicit = await f.plans.manage({ id: plan.id, action: 'update', requestId: 'explicit-enable', schedule: { ...schedule, enabled: true, maxRuns: 2 } });
  assert.equal(explicit.plan.schedule.enabled, true);
  assert.equal(explicit.plan.schedule.maxRuns, 2);
  await f.plans.manage({ id: plan.id, action: 'pause', requestId: 'pause-before-once' });
  const once = await f.plans.manage({ id: plan.id, action: 'update', requestId: 'convert-to-once', schedule: { mode: 'once', at: NOW + 3600000, timeZone: 'UTC' } });
  assert.equal(once.plan.schedule.enabled, false);
  assert.equal(once.plan.schedule.maxRuns, undefined);
  assert.equal(Object.hasOwn(f.calls.at(-1).action.patch, 'maxRuns'), false);
  assert.equal(f.rows()[0].permission, 'read-only');
});

test('instruction and title updates before execution use native content patches and list authoritative content', async () => {
  const f = fixture(), original = input('content-source'), { plan } = await f.plans.create(original, 'main');
  const before = structuredClone(f.rows()[0]), instruction = 'Synthetic public source instruction. '.repeat(25).slice(0, 875);
  const changed = await f.plans.manage({ action: 'update', id: plan.id, requestId: 'content-new-instruction', instruction }, 'main');
  assert.equal(changed.plan.instruction, instruction.trim());
  assert.equal(changed.plan.canEditContent, true);
  assert.equal(changed.plan.contentEditReason, null);
  assert.equal(f.calls.at(-1).action.kind, 'update');
  assert.deepEqual(Object.keys(f.calls.at(-1).action.patch), ['prompt']);
  assert.match(f.rows()[0].prompt, /独立只读计划执行/);
  assert.ok(f.rows()[0].prompt.includes(instruction.trim()));
  assert.deepEqual(f.rows()[0].schedule, before.schedule);
  assert.deepEqual(f.rows()[0].integrations, before.integrations, 'original create identity remains immutable');
  for (const key of ['permission', 'reuseSession', 'goalRun', 'applyCardDefaults']) assert.deepEqual(f.rows()[0][key], before[key]);
  assert.equal(f.plans.list().plans[0].instruction, instruction.trim());
  const replay = await f.plans.create(original, 'main');
  assert.equal(replay.replayed, true);
  assert.equal(replay.plan.instruction, instruction.trim(), 'original create retry must not restore old instructions');
  const titled = await f.plans.manage({ action: 'update', taskId: plan.id, requestId: 'content-new-title', title: 'Synthetic revised title' });
  assert.equal(titled.plan.title, 'Synthetic revised title');
  assert.equal(titled.plan.instruction, instruction.trim());
  assert.deepEqual(f.calls.at(-1).action.patch, { title: 'Synthetic revised title' });
  assert.deepEqual(titled, JSON.parse(JSON.stringify(titled)));
  assert.equal(f.rows().length, 1);
  assert.equal(f.calls.length, 3);
});

test('mixed actual time and content changes are refused before either write while unchanged echoes work', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  const before = structuredClone(f.rows()[0]), changedSchedule = { ...schedule, cron: '30 9 * * *' };
  await assert.rejects(f.plans.manage({ action: 'update', id: plan.id, requestId: 'mixed-edit', instruction: 'Synthetic changed requirement', schedule: changedSchedule }), /分两次/);
  assert.deepEqual(f.rows()[0], before); assert.equal(f.calls.length, 1);
  const echoed = await f.plans.manage({ action: 'update', id: plan.id, requestId: 'content-with-time-echo', instruction: 'Synthetic changed requirement', schedule: { ...schedule } });
  assert.equal(echoed.plan.instruction, 'Synthetic changed requirement');
  assert.equal(f.calls.at(-1).action.kind, 'update');
  assert.deepEqual(f.rows()[0].schedule, before.schedule);
  const time = await f.plans.manage({ action: 'update', planId: plan.id, requestId: 'time-with-content-echo', title: plan.title, instruction: echoed.plan.instruction, schedule: changedSchedule });
  assert.equal(time.plan.schedule.cron, changedSchedule.cron);
  assert.equal(f.calls.at(-1).action.kind, 'set-schedule');
});

test('any execution freezes changed content but not time updates or already-equal content retries', async () => {
  for (const record of [{ id: 'running', startedAt: NOW }, { id: 'finished', startedAt: NOW, endedAt: NOW + 1, result: 'success' }, { id: 'cancelled', startedAt: NOW, endedAt: NOW + 1, result: 'cancelled' }]) {
    const f = fixture(), { plan } = await f.plans.create(input());
    f.rows()[0].executions.push(record);
    assert.equal(f.plans.list().plans[0].canEditContent, false);
    await assert.rejects(f.plans.manage({ action: 'update', id: plan.id, requestId: 'frozen-content', instruction: 'Synthetic changed requirement' }), /首次执行|已经执行|执行记录/);
    assert.equal(f.calls.length, 1);
    const same = await f.plans.manage({ action: 'update', id: plan.id, requestId: 'same-content', instruction: input().instruction });
    assert.equal(same.unchanged, true); assert.equal(f.calls.length, 1);
    const time = await f.plans.manage({ action: 'update', id: plan.id, requestId: 'time-still-editable', schedule: { ...schedule, cron: '30 9 * * *' } });
    assert.equal(time.plan.schedule.cron, '30 9 * * *');
  }
});

test('lost content update response is reconciled without another write even if a run starts', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  const edit = { action: 'update', id: plan.id, requestId: 'unknown-content-update', instruction: 'Synthetic revised requirement' };
  f.failNext(); await assert.rejects(f.plans.manage(edit), /connection lost/);
  f.rows()[0].executions.push({ id: 'started-after-commit', sessionId: 'worker', startedAt: NOW });
  const fresh = new Plans({ getHost: () => f.host, store: f.store, now: () => NOW });
  const retry = await fresh.manage(edit);
  assert.equal(retry.unchanged, true); assert.equal(retry.plan.instruction, edit.instruction);
  assert.equal(f.calls.length, 2); assert.equal(f.rows().length, 1);
});

test('content updates protect native continuation data and unrecognized prompt wrappers', async () => {
  for (const field of ['freeze', 'handover']) {
    const f = fixture(), { plan } = await f.plans.create(input());
    f.rows()[0][field] = { synthetic: 'native continuation data' };
    const before = structuredClone(f.rows()[0]);
    assert.equal(f.plans.list().plans[0].canEditContent, false);
    await assert.rejects(f.plans.manage({ action: 'update', id: plan.id, requestId: 'protect-' + field, title: 'Synthetic new title' }), /续接|快照|交接|看板/);
    assert.deepEqual(f.rows()[0], before); assert.equal(f.calls.length, 1);
  }
  const f = fixture(), { plan } = await f.plans.create(input());
  f.rows()[0].prompt = 'Synthetic prompt edited outside the bridge';
  const view = f.plans.list().plans[0];
  assert.equal(view.instruction, null, 'never present the original marker as current instructions');
  assert.equal(view.canEditContent, false);
  await assert.rejects(f.plans.manage({ action: 'update', id: plan.id, requestId: 'unsafe-wrapper', instruction: 'Synthetic new instruction' }), /模板|提示|看板/);
  await f.plans.manage({ action: 'update', id: plan.id, requestId: 'safe-time', schedule: { ...schedule, cron: '30 9 * * *' } });
  assert.equal(f.rows()[0].prompt, 'Synthetic prompt edited outside the bridge');
});

test('update parameters give actionable errors and reject conflicting aliases or content on other actions', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  for (const [value, message] of [
    [{ action: 'update', id: plan.id, instruction: 'Synthetic instruction' }, /requestId/],
    [{ action: 'update', id: plan.id, requestId: 'empty-edit' }, /instruction|title|schedule/],
    [{ action: 'update', id: plan.id, taskId: 'another-id', requestId: 'conflict', instruction: 'Synthetic instruction' }, /冲突|一致/],
    [{ action: 'pause', id: plan.id, requestId: 'wrong-action', instruction: 'Synthetic instruction' }, /update/],
    [{ action: 'update', id: plan.id, requestId: 'secret-edit', instruction: 'api_key=synthetic-secret' }, /凭据/],
  ]) await assert.rejects(f.plans.manage(value), message);
  assert.equal(f.calls.length, 1);
  const sameAliases = await f.plans.manage({ action: 'update', id: plan.id, taskId: plan.id, planId: plan.id, requestId: 'consistent-aliases', title: 'Synthetic new title' });
  assert.equal(sameAliases.plan.title, 'Synthetic new title');
});

test('reports derive the open execution from actual calling session and reject spoofed identifiers', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  f.rows()[0].executions.push({ id: 'host-run', sessionId: 'worker', startedAt: NOW });
  const report = { id: plan.id, notify: false, summary: '未发现新消息。' };
  assert.equal(f.plans.isPlanSession(exec('worker')), true);
  assert.equal(f.plans.isPlanSession(exec('main')), false);
  await assert.rejects(f.plans.report(report, exec('unrelated')), /匹配/);
  await assert.rejects(f.plans.report({ ...report, executionId: 'invented' }, exec('worker')), /不匹配/);
  const result = await f.plans.report(report, exec('worker'));
  assert.equal(result.notified, false);
  assert.equal(f.notices.length, 0);
  assert.equal(f.store.state().planReports[0].executionId, 'host-run');
  assert.equal(f.rows()[0].executions[0].endedAt, undefined, 'only host can settle execution');
  assert.equal(f.plans.list().plans[0].runReports.length, 1);
});

test('quiet report retries remain idempotent after host settlement, and changed content is refused', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  f.rows()[0].executions.push({ id: 'host-run', sessionId: 'worker', startedAt: NOW });
  const report = { id: plan.id, notify: false, summary: '未发现变化。' };
  await f.plans.report(report, exec('worker'));
  f.rows()[0].executions[0].endedAt = NOW + 100;
  assert.equal((await f.plans.report(report, exec('worker'))).replayed, true);
  await assert.rejects(f.plans.report({ ...report, summary: '另一条摘要' }, exec('worker')), /已汇报/);
  assert.equal(f.store.state().planReports.length, 1);
});

test('notice reports are scoped to host execution and use inbox dedup without public operations', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  const report = { id: plan.id, notify: true, summary: '发现一条已核验的公开测试消息。', links: [{ title: '测试来源', url: 'https://example.com/news' }] };
  f.rows()[0].executions.push({ id: 'run-a', sessionId: 'worker-a', startedAt: NOW });
  assert.equal((await f.plans.report(report, exec('worker-a'))).notified, true);
  f.rows()[0].executions[0].endedAt = NOW + 1;
  f.rows()[0].executions.push({ id: 'run-b', sessionId: 'worker-b', startedAt: NOW + 2 });
  const duplicate = await f.plans.report(report, exec('worker-b'));
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.notified, false);
  assert.equal(f.notices.length, 1);
  assert.equal(f.calls.length, 1, 'reports never forge external-outcome host records');
});

test('no report is accepted without durable local receipt storage', async () => {
  const f = fixture(), { plan } = await f.plans.create(input());
  f.rows()[0].executions.push({ id: 'host-run', sessionId: 'worker', startedAt: NOW });
  const noStore = new Plans({ getHost: () => f.host, assistant: f.assistant });
  await assert.rejects(noStore.report({ id: plan.id, notify: true, summary: '测试' }, exec('worker')), /存储不可用/);
  assert.equal(f.notices.length, 0);
});

test('malformed or credential-bearing plans are rejected before host calls', async () => {
  const f = fixture();
  for (const value of [{ ...input(), permission: 'danger-full-access' }, { ...input(), instruction: 'api_key=secret' }, { ...input(), schedule: { ...schedule, enabled: 'true' } }]) await assert.rejects(f.plans.create(value));
  assert.equal(f.calls.length, 0);
});

const installedRoot = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@linxin666', 'dsh-client-ui-task-board', 'src');
test('installed task board source accepts real bridge actions and applies their time-zone schedule', { skip: !fs.existsSync(path.join(installedRoot, 'protocol.ts')) || typeof nodeModule.stripTypeScriptTypes !== 'function' }, async t => {
  // Node refuses native TypeScript stripping below node_modules. Copy only installed
  // public source to an isolated temporary directory; never load a host ledger.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-plan-contract-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('my-fish-plan-contract-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const source = path.join(temporary, 'src');
  fs.cpSync(installedRoot, source, { recursive: true });
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
  const transform = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) transform(file);
      else if (entry.name.endsWith('.ts')) fs.writeFileSync(file, nodeModule.stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'transform' }));
    }
  };
  transform(source);
  const { parseActionEnvelope } = await import(pathToFileURL(path.join(source, 'protocol.ts')).href);
  const { applyCreateTask } = await import(pathToFileURL(path.join(source, 'core', 'use-cases', 'task-create.ts')).href);
  const { applySetSchedule } = await import(pathToFileURL(path.join(source, 'core', 'use-cases', 'task-schedule.ts')).href);
  const f = fixture(), { plan } = await f.plans.create(input(), 'main');
  await f.plans.manage({ id: plan.id, action: 'pause', requestId: 'pause' }, 'main');
  await f.plans.manage({ id: plan.id, action: 'resume', requestId: 'resume' }, 'main');
  await f.plans.manage({ id: plan.id, action: 'cancel', requestId: 'cancel' }, 'main');
  for (const call of f.calls) assert.ok(parseActionEnvelope(call), call.action.kind + ' is accepted by installed public protocol');
  // Exercise the installed pure creation transition, including hostile card
  // defaults, rather than accepting a parser pass as proof of isolation.
  const create = parseActionEnvelope(f.calls[0]).action;
  const created = applyCreateTask([], create.input, NOW, create.id, undefined, 'UTC', {
    permission: 'danger-full-access', mode: 'synthetic-default', model: 'synthetic/model', reasoningEffort: 'synthetic-effort',
  }).task;
  assert.ok(created);
  assert.equal(created.permission, 'read-only');
  for (const key of ['reuseSession', 'teamRun', 'goalRun']) assert.notEqual(created[key], true, key + ' must stay off');
  for (const key of ['mode', 'model', 'reasoningEffort']) assert.equal(created[key], undefined, 'card defaults must not supply ' + key);
  assert.equal(created.schedule.timeZone, 'Asia/Shanghai');
  assert.equal(created.schedule.nextRunAt, NOW + 3600000);
  // Real pure transitions, rather than JSON round-tripped mocks, retain own
  // undefined fields. Check the public projection before a renderer sees it.
  let actualTasks = [created];
  const actualPlans = new Plans({ getHost: () => ({ snapshot: () => ({ tasks: actualTasks }), apply() { throw Error('pure view only'); } }) });
  const checkProjection = () => {
    const value = actualPlans.list();
    assert.equal(value.ok, true);
    assert.deepEqual(value, JSON.parse(JSON.stringify(value)));
  };
  assert.equal(Object.hasOwn(created.schedule, 'lastTriggeredAt'), true);
  assert.equal(created.schedule.lastTriggeredAt, undefined);
  checkProjection();
  for (const patch of [{ enabled: false }, { enabled: true }, { mode: 'once', at: NOW + 7200000 }, { ...schedule, enabled: true }]) {
    const transition = applySetSchedule(actualTasks, created.id, patch, NOW, 'UTC');
    assert.equal(transition.applied, true);
    actualTasks = transition.tasks;
    checkProjection();
  }
  const task = { id: 'synthetic-only', executions: [], status: 'todo' };
  const changed = applySetSchedule([task], task.id, { ...schedule, enabled: true }, NOW, 'UTC');
  assert.equal(changed.applied, true);
  assert.equal(changed.tasks[0].schedule.timeZone, 'Asia/Shanghai');
  assert.equal(changed.tasks[0].schedule.nextRunAt, NOW + 3600000);
  assert.equal(applySetSchedule([task], task.id, { mode: 'cron', cron: '0 0 31 2 *', enabled: true }, NOW, 'UTC').applied, false);
});
