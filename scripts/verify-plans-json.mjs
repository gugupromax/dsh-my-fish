// Actual installed SDK, synthetic task-board snapshots, and an isolated data home.
// Never opens the user's task ledger or starts a model, timer execution, or GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import plugin from '../lib/index.js';
import { Store } from '../lib/store.js';

const sdkRoot = process.argv[2] || 'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const { snapshotJsonValue } = await import(pathToFileURL(path.join(sdkRoot, '@deepseek-ai/dsh-util-values/lib/index.js')).href);
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-plan-json-'));
const previousHome = process.env.DSH_HOME;
const effects = [], definitions = new Map(), taskRows = [], requests = new Map(), checked = [];
const mainId = 'synthetic-plan-main', workerId = 'synthetic-plan-worker';
const presetDefinitions=new Map();
const agentPresets={register:async definition=>{presetDefinitions.set(definition.id,definition);return()=>presetDefinitions.delete(definition.id);},resolve:async id=>presetDefinitions.get(id)};
const now = Date.now(), nextRunAt = now + 3600000;
const originalFetch = globalThis.fetch;
let hostCalls = 0, createCalls = 0, modelCalls = 0, networkCalls = 0, failAfterNextCommit = false;
const hostActions = [], refused = [];
let transitions, installedTaskBoard = null;
process.env.DSH_HOME = isolatedHome;
globalThis.fetch = () => { networkCalls++; throw Error('No network requests allowed'); };

// The currently observed 0.4.12 creation transition removes undefined patch
// fields, but its default rule still owns lastTriggeredAt: undefined.
const clearOptional = value => { for (const key of Object.keys(value)) if (value[key] === undefined && key !== 'lastTriggeredAt') delete value[key]; return value; };
const host = {
  snapshot: () => ({ tasks: structuredClone(taskRows), scheduler: { timeZone: 'Asia/Shanghai' } }),
  async apply(requestId, action) {
    const fingerprint = JSON.stringify(action);
    if (requests.has(requestId)) {
      assert.equal(requests.get(requestId), fingerprint);
      return host.snapshot();
    }
    hostCalls++;
    hostActions.push(structuredClone(action));
    if (action.kind === 'create') {
      createCalls++;
      if (transitions) {
        const changed = transitions.applyCreateTask(taskRows, action.input, now, action.id, undefined, 'Asia/Shanghai');
        assert.ok(changed.task, changed.error);
        taskRows.splice(0, taskRows.length, ...changed.tasks);
      } else taskRows.push({ id: action.id, ...structuredClone(action.input), status: 'todo', executions: [], schedule: { ...action.input.schedule, runCount: 0, nextRunAt, lastTriggeredAt: undefined } });
    } else {
      const task = taskRows.find(row => row.id === action.taskId);
      assert.ok(task);
      if (action.kind === 'update') {
        // applyUpdateTask is deliberately only a pure transition. The real
        // HostTaskLedger applies these gates BEFORE invoking that function.
        if (task.archivedAt !== undefined) throw Error('archived task is read-only');
        const hasContent = transitions ? transitions.hasContentPatch(action.patch) : ['title', 'description', 'prompt'].some(key => key in action.patch);
        const editable = transitions ? transitions.canEditTaskContent(task) : task.executions.length === 0;
        if (hasContent && !editable) throw Error('task has already been executed');
        if ('title' in action.patch && action.patch.title?.trim() === '') throw Error('title is required');
        assert.ok(Object.keys(action.patch).every(key => ['title', 'prompt'].includes(key)), 'My Fish never changes permission, targets, schedule, or integrations through content updates');
        if (transitions) taskRows.splice(0, taskRows.length, ...transitions.applyUpdateTask(taskRows, action.taskId, action.patch, now));
        else Object.assign(task, action.patch, { updatedAt: now });
      } else if (transitions) {
        const changed = action.kind === 'archive' ? transitions.applyArchiveTask(taskRows, action.taskId, now) : transitions.applySetSchedule(taskRows, action.taskId, action.patch, now, 'Asia/Shanghai');
        assert.equal(action.kind === 'archive' ? changed.archived : changed.applied, true);
        taskRows.splice(0, taskRows.length, ...changed.tasks);
      } else if (action.kind === 'archive') {
        task.archivedAt = now;
        task.schedule = { ...task.schedule, enabled: false, nextRunAt: undefined };
      } else {
        task.schedule = { ...task.schedule, ...action.patch };
        task.schedule.nextRunAt = task.schedule.enabled ? nextRunAt : undefined;
        if (task.schedule.mode === 'once') { task.schedule.cron = undefined; task.schedule.maxRuns = undefined; }
        clearOptional(task.schedule);
      }
    }
    requests.set(requestId, fingerprint);
    if (failAfterNextCommit) { failAfterNextCommit = false; throw Error('synthetic receipt lost after commit'); }
    return host.snapshot();
  },
};

try {
  // Copy public program source only; never load its controller or ledger.
  const installedSource = process.env.DSH_TASK_BOARD_SOURCE || path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@linxin666', 'dsh-client-ui-task-board', 'src');
  if (fs.existsSync(path.join(installedSource, 'core', 'use-cases', 'task-create.ts'))) {
    const source = path.join(isolatedHome, 'pure-board-source');
    fs.cpSync(installedSource, source, { recursive: true });
    fs.writeFileSync(path.join(isolatedHome, 'package.json'), '{"type":"module"}');
    const transform = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) transform(file);
        else if (entry.name.endsWith('.ts')) fs.writeFileSync(file, stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'transform' }));
      }
    };
    transform(source);
    transitions = Object.assign({}, ...await Promise.all(['task-create.ts', 'task-schedule.ts', 'task-archive.ts', 'task-update.ts'].map(name => import(pathToFileURL(path.join(source, 'core', 'use-cases', name)).href))));
    installedTaskBoard = JSON.parse(fs.readFileSync(path.join(installedSource, '..', 'package.json'), 'utf8')).version;
  }
  const store = new Store();
  store.saveState({ ...store.state(), sessionId: mainId });
  plugin.apply({
    sessionController: { create() { throw Error('No conversation creation allowed'); }, prompt() { modelCalls++; throw Error('No model prompt allowed'); } },
    connection: { requestRejection: () => undefined },
    tools: { register(definition) { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } },
    webServer: { register: () => () => {} },
    inject(names, callback) { if(names.length===1&&['taskBoard','agentPresets'].includes(names[0]))callback({[names[0]]:names[0]==='taskBoard'?host:agentPresets,effect(fn){const cleanup=fn();if(typeof cleanup==='function')effects.push(cleanup);}}); },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') effects.push(cleanup); },
    logger: { warn: () => {} },
  });
  async function execute(label, args, sessionId = mainId, name = 'assistant_plan') {
    const definition = definitions.get(name);
    assert.ok(definition);
    const value = await definition.execute(args, { agent: { id: sessionId, session: { id: sessionId } }, signal: new AbortController().signal });
    assert.equal(value.ok, true, label + ' must succeed before serialization');
    // This is the same validator the installed host runs before rendering.
    assert.notEqual(snapshotJsonValue(value), undefined, label + ' must pass installed lossless JSON validation');
    assert.deepEqual(value, JSON.parse(JSON.stringify(value)), label + ' must already be JSON before rendering');
    assert.deepEqual(JSON.parse(definition.output.render(args, value)[0].text), value);
    checked.push(label);
    return value;
  }
  async function rejectWithoutWrite(label, args, expected) {
    const before = host.snapshot(), count = hostCalls;
    await assert.rejects(execute(label, args), expected);
    assert.equal(hostCalls, count, label + ' must reject before host.apply');
    assert.deepEqual(host.snapshot(), before, label + ' must leave schedule, content, and history unchanged');
    refused.push(label);
  }
  const draft = { action: 'create', requestId: 'synthetic-plan-json-create', title: 'Synthetic public reading', instruction: 'Read a synthetic public source and report real changes only.', schedule: { mode: 'cron', cron: '0 * * * *', timeZone: 'Asia/Shanghai' } };
  const created = await execute('create', draft), id = created.plan.id;
  assert.equal(snapshotJsonValue(host.snapshot()), undefined, 'fixture retains real optional undefined values');
  assert.equal(Object.hasOwn(taskRows[0].schedule, 'lastTriggeredAt'), true);
  assert.equal(taskRows[0].schedule.lastTriggeredAt, undefined);
  assert.equal(created.plan.schedule.maxRuns, undefined);
  await execute('list-existing', { action: 'list' });
  assert.equal((await execute('create-replay', draft)).replayed, true);
  assert.equal(createCalls, 1, 'same request must not create twice');
  assert.equal(created.plan.canEditContent, true);
  const originalMarker = structuredClone(taskRows[0].integrations), originalSchedule = structuredClone(taskRows[0].schedule);
  const revisedInstruction = 'Synthetic public reading. '.repeat(40).slice(0, 874) + 'S';
  assert.equal(revisedInstruction.length, 875, '875 characters are purely synthetic, never copied from a real plan');
  const contentArgs = { action: 'update', id, requestId: 'synthetic-plan-content', title: 'Synthetic revised reading', instruction: revisedInstruction };
  const edited = await execute('update-content-before-first-run', contentArgs);
  assert.equal(edited.plan.instruction, revisedInstruction);
  assert.equal(edited.plan.title, contentArgs.title);
  assert.equal(edited.plan.canEditContent, true);
  assert.deepEqual(taskRows[0].schedule, originalSchedule);
  assert.deepEqual(taskRows[0].integrations, originalMarker, 'creation fingerprint and original instruction remain immutable audit data');
  assert.equal(taskRows[0].permission, 'read-only');
  assert.deepEqual(Object.keys(hostActions.at(-1).patch).sort(), ['prompt', 'title']);
  assert.equal(hostActions.at(-1).kind, 'update');
  const listedEdited = await execute('list-edited-current-content', { action: 'list' });
  assert.equal(listedEdited.plans[0].instruction, revisedInstruction);
  const replayAfterEdit = await execute('original-create-replay-after-content-update', draft);
  assert.equal(replayAfterEdit.replayed, true);
  assert.equal(replayAfterEdit.plan.instruction, revisedInstruction, 'create replay reports current content without undoing updates');
  const beforeSame = hostCalls;
  assert.equal((await execute('content-update-equal-retry', contentArgs)).unchanged, true);
  assert.equal(hostCalls, beforeSame);
  await execute('update-title-taskId-alias', { action: 'update', taskId: id, requestId: 'synthetic-title-alias', title: 'Synthetic title through taskId' });
  assert.deepEqual(Object.keys(hostActions.at(-1).patch), ['title']);
  const instructionArgs = { action: 'update', planId: id, requestId: 'synthetic-instruction-alias', instruction: 'Synthetic instruction through planId.' };
  const instructionOnly = await execute('update-instruction-planId-alias', instructionArgs);
  assert.equal(instructionOnly.plan.instruction, instructionArgs.instruction);
  assert.deepEqual(Object.keys(hostActions.at(-1).patch), ['prompt']);
  const echoArgs = { action: 'update', id, requestId: 'synthetic-content-same-schedule', title: instructionOnly.plan.title, instruction: 'Synthetic rewrite with unchanged schedule echo.', schedule: { ...draft.schedule, enabled: true } };
  const echoResult = await execute('content-update-with-unchanged-schedule-echo', echoArgs);
  assert.equal(echoResult.plan.instruction, echoArgs.instruction);
  assert.deepEqual(taskRows[0].schedule, originalSchedule);
  await rejectWithoutWrite('mixed-content-and-clock-changes', { action: 'update', id, requestId: 'synthetic-mixed-reject', instruction: 'Synthetic should not be saved.', schedule: { ...draft.schedule, cron: '15 * * * *' } }, /内容|时间|分别|两次/);
  for (const field of ['freeze', 'handover']) {
    taskRows[0][field] = field === 'freeze' ? { goal: 'Synthetic preserved snapshot', progress: '', next: '', frozenAt: now } : { bundledAt: now, documents: [], scripts: [] };
    await rejectWithoutWrite('protect-existing-' + field, { action: 'update', id, requestId: 'synthetic-protect-' + field, instruction: 'Synthetic refused rewrite.' }, /快照|交接|资料|freeze|handover/);
    delete taskRows[0][field];
  }
  const guardedPrompt = taskRows[0].prompt;
  taskRows[0].prompt = 'Synthetic externally changed prompt outside the My Fish wrapper.';
  await rejectWithoutWrite('protect-unknown-prompt-template', { action: 'update', id, requestId: 'synthetic-unknown-prompt', instruction: 'Synthetic refused rewrite.' }, /模板|指令|内容|提示/);
  taskRows[0].prompt = guardedPrompt;
  const lostArgs = { action: 'update', id, requestId: 'synthetic-content-lost-receipt', instruction: 'Synthetic update committed before a lost receipt.' };
  failAfterNextCommit = true;
  await assert.rejects(execute('synthetic-lost-content-receipt', lostArgs), /synthetic receipt lost after commit/);
  const afterLost = hostCalls;
  assert.equal((await execute('retry-content-after-unknown-commit', lostArgs)).unchanged, true);
  assert.equal(hostCalls, afterLost, 'unknown receipt recovery does not reapply content or create another task');
  assert.deepEqual(taskRows[0].integrations, originalMarker);
  await execute('pause', { action: 'pause', id, requestId: 'synthetic-plan-pause' });
  assert.equal(taskRows[0].schedule.nextRunAt, undefined);
  await execute('update-paused', { action: 'update', id, requestId: 'synthetic-plan-update', schedule: { mode: 'cron', cron: '30 * * * *', timeZone: 'Asia/Shanghai' } });
  await execute('resume', { action: 'resume', id, requestId: 'synthetic-plan-resume' });
  taskRows[0].executions.push({ id: 'synthetic-execution-quiet', sessionId: workerId, startedAt: now, endedAt: undefined, result: undefined, error: undefined });
  const frozen = await execute('list-content-frozen-after-execution', { action: 'list' });
  assert.equal(frozen.plans[0].canEditContent, false);
  await rejectWithoutWrite('changed-content-after-execution', { action: 'update', id, requestId: 'synthetic-frozen-reject', instruction: 'Synthetic refused after first execution.' }, /执行|冻结|只读/);
  const beforeFrozenRetry = hostCalls;
  assert.equal((await execute('equal-content-retry-after-execution', lostArgs)).unchanged, true);
  assert.equal(hostCalls, beforeFrozenRetry);
  const report = { id, notify: false, summary: 'Synthetic source has no changes.' };
  await execute('quiet-report', report, workerId, 'assistant_plan_report');
  await execute('quiet-report-replay', report, workerId, 'assistant_plan_report');
  await execute('list-running-with-report', { action: 'list' });
  taskRows[0].executions[0].endedAt = now + 1;
  taskRows[0].executions[0].result = 'success';
  taskRows[0].executions.push({ id: 'synthetic-execution-notice', sessionId: workerId, startedAt: now + 2 });
  await execute('notice-report', { id, notify: true, title: 'Synthetic new reading', summary: 'Synthetic source has one verified update.', links: [{ url: 'https://example.com/synthetic' }] }, workerId, 'assistant_plan_report');
  taskRows[0].executions[1].endedAt = now + 3;
  taskRows[0].executions[1].result = 'success';
  // Upgrade-compatible local report rows may predate optional receipt fields.
  const state = store.state();
  state.planReports.push({ planId: id, executionId: 'synthetic-legacy-report', at: now, notify: false });
  store.saveState(state);
  await execute('list-history-and-partial-report', { action: 'list' });
  // Separate tolerance fixture, not attributed to current creation output.
  Object.assign(taskRows[0].schedule, { maxRuns: undefined, endedAt: undefined, endedReason: undefined, skippedAt: undefined, skippedReason: undefined });
  await execute('list-legacy-undefined-schedule', { action: 'list' });
  await execute('update-once', { action: 'update', id, requestId: 'synthetic-plan-once', schedule: { mode: 'once', at: Date.now() + 86400000, timeZone: 'UTC' } });
  await execute('cancel', { action: 'cancel', id, requestId: 'synthetic-plan-cancel' });
  assert.equal((await execute('cancel-replay', { action: 'cancel', id, requestId: 'synthetic-plan-cancel' })).replayed, true);
  await execute('list-cancelled', { action: 'list' });
  assert.equal(createCalls, 1);
  assert.equal(modelCalls, 0); assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ planToolJson: 'passed', checked, refused, checkedCount: checked.length, refusalCount: refused.length, installedTaskBoard, installedPureTransitions: !!transitions, syntheticHostMutations: hostCalls, syntheticCreates: createCalls, modelCalls, networkCalls, realLedgerReads: 0, realLedgerWrites: 0 }));
} finally {
  for (const cleanup of effects.reverse()) cleanup();
  globalThis.fetch = originalFetch;
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(isolatedHome));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Refusing cleanup outside OS temporary directory');
  fs.rmSync(isolatedHome, { recursive: true, force: true });
}
