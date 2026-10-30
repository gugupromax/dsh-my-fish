import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_PRESET_ID, planPresetDefinition, registerPlanPreset } from '../lib/plan-runtime.js';

test('owned plan composition explicitly selects native tools and only adds read modules', () => {
  const definition = planPresetDefinition();
  assert.equal(definition.id, PLAN_PRESET_ID);
  assert.deepEqual(definition.plugins.slice(0,4).map(row => row.name), [
    '@deepseek-ai/dsh-agent-tool-presentation', '@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-web',
  ]);
  assert.equal(definition.plugins[4].name,new URL('../lib/plan-runtime.js',import.meta.url).href);
  assert.deepEqual(definition.plugins[0].config, { mode: 'native' });
  assert.deepEqual(definition.plugins[2].config, { read: true, readImage: true, write: false, edit: false });
  assert.equal(definition.plugins[3].config.search, true);
  assert.equal(definition.plugins[3].config.fetch, true);
  definition.plugins[0].config.mode = 'ptc';
  assert.equal(planPresetDefinition().plugins[0].config.mode, 'native', 'callers cannot mutate later registrations');
  assert.equal(JSON.stringify(definition).includes('persona'), false);
});

test('readiness waits for registration and checks the exact owned preset before returning its id', async () => {
  let finish, resolved = 0, released = 0;
  const registration = new Promise(resolve => { finish = resolve; });
  const runtime = registerPlanPreset({
    register: async definition => { assert.equal(definition.id, PLAN_PRESET_ID); await registration; return () => { released++; }; },
    resolve: async id => { resolved++; assert.equal(id, PLAN_PRESET_ID); return { id }; },
  });
  const pending = runtime.ensureReady();
  await Promise.resolve(); assert.equal(resolved, 0);
  finish(); assert.equal(await pending, PLAN_PRESET_ID); assert.equal(resolved, 1);
  assert.equal(await runtime.ensureReady(), PLAN_PRESET_ID); assert.equal(resolved, 2);
  await runtime.dispose(); await runtime.dispose(); assert.equal(released, 1);
  await assert.rejects(runtime.ensureReady(), /卸载/);
});

test('missing, failed, conflicting and broken preset services never fall back to a default mode', async () => {
  for (const registry of [undefined, {}, { register() {} }, { resolve() {} }]) assert.throws(() => registerPlanPreset(registry), /服务不可用/);
  const failure = registerPlanPreset({ register: async () => { throw Error('Duplicate agent preset'); }, resolve: async () => { throw Error('must not resolve'); } });
  await assert.rejects(failure.ensureReady(), /Duplicate/); await failure.dispose();
  const missingDisposer = registerPlanPreset({ register: async () => undefined, resolve: async id => ({ id }) });
  await assert.rejects(missingDisposer.ensureReady(), /未确认/); await missingDisposer.dispose();
  for (const answer of [undefined, { id: 'ptc' }, { id: PLAN_PRESET_ID, broken: 'Synthetic missing dependency' }, { id: PLAN_PRESET_ID, broken: '' }]) {
    let released = 0;
    const runtime = registerPlanPreset({ register: async () => () => { released++; }, resolve: async () => answer });
    await assert.rejects(runtime.ensureReady(), /未就绪/); await runtime.dispose(); assert.equal(released, 1);
  }
});

test('service disposal during late registration releases only the owned registration exactly once', async () => {
  let finish, released = 0, resolved = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const runtime = registerPlanPreset({ register: async () => { await gate; return () => { released++; }; }, resolve: async id => { resolved++; return { id }; } });
  const pending = runtime.ensureReady(), disposed = runtime.dispose();
  finish(); await disposed; await assert.rejects(pending, /卸载/);
  assert.equal(released, 1); assert.equal(resolved, 0);
});

test('unload while readiness resolves refuses the now-stale preset', async () => {
  let finish, released = 0, began;
  const entered = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const runtime = registerPlanPreset({ register: async () => () => { released++; }, resolve: async id => { began(); await gate; return { id }; } });
  const pending = runtime.ensureReady(); await entered; await runtime.dispose(); finish();
  await assert.rejects(pending, /卸载/); assert.equal(released, 1);
});
