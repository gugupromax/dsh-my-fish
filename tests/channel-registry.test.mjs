import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelRegistry } from '../lib/channels/registry.js';

function provider(id = 'fixture', overrides = {}) {
  return { id, name: '合成渠道', capabilities: () => ({
    implemented: true, available: true, configured: false, accountRequired: false,
    connection: { state: 'unchecked', checkedAt: null, scope: '未检查' },
    currentSessionVisible: true, reads: ['search'], actions: {}, scope: '公开合成内容',
  }), search: () => ({ data: [] }), ...overrides };
}

test('channel registrations reject duplicate IDs and their disposers remove exactly their own registration', () => {
  const registry = new ChannelRegistry();
  const first = provider(), second = provider();
  const disposeFirst = registry.register(first);
  assert.equal(registry.get('fixture'), first);
  assert.throws(() => registry.register(second), /已经注册/);
  disposeFirst();
  assert.equal(registry.get('fixture'), undefined);
  const disposeSecond = registry.register(second);
  disposeFirst();
  assert.equal(registry.get('fixture'), second);
  disposeSecond(); disposeSecond();
  assert.deepEqual(registry.list(), []);
});

test('catalog entries cannot claim installed code, a verified connection or visible session', () => {
  const registry = new ChannelRegistry({ catalog: [{ id: 'future', name: '未来渠道', installed: true,
    implemented: true, available: true, configured: true, currentSessionVisible: true,
    diagnostics: { supported: true, kind: 'identity', scope: '目录没有执行代码' },
    connection: { state: 'verified', checkedAt: 10 }, reads: ['search'], actions: { reply: { supported: true, enabled: true } },
  }] });
  const future = registry.list({ agent: {} })[0];
  assert.equal(future.name, '未来渠道');
  for (const key of ['installed', 'implemented', 'available', 'configured']) assert.equal(future[key], false);
  assert.equal(future.connection.state, 'unavailable');
  assert.equal(future.currentSessionVisible, null);
  assert.deepEqual(future.reads, []);
  assert.equal(future.diagnostics.supported, false);
  assert.deepEqual(future.actions.reply, { supported: false, enabled: false, liveVerified: false });
  const dispose = registry.register(provider('future'));
  assert.equal(registry.list()[0].installed, true);
  dispose();
  assert.equal(registry.list()[0].installed, false);
});

test('registry projects only declared public fields at every capability level', () => {
  const secret = 'SYNTHETIC_PRIVATE_VALUE';
  const registry = new ChannelRegistry();
  registry.register(provider('fixture', { capabilities: () => ({
    id: 'spoofed', name: '合成名称', installed: true, implemented: true, available: true,
    configured: true, accountRequired: false, currentSessionVisible: true,
    credentials: { token: secret }, config: { secret }, persona: secret, privateTerms: [secret],
    connection: { state: 'verified', checkedAt: 123, scope: '合成核验', credentials: secret },
    diagnostics: { supported: true, kind: 'public-read', scope: '只读检查', credentials: secret, config: { secret } },
    reads: ['search', 'read', 'not_a_read', 'search'],
    readAvailability: { search: { available: true, currentSessionVisible: true, reason: '可见', credentials: secret,
      connection: { state: 'verified', checkedAt: 123, scope: '有限范围', token: secret } }, read: false },
    actions: { reply: { supported: true, enabled: true, liveVerified: false, config: secret } },
    scope: '合成材料', description: '范围明确',
  }), check: () => ({ ok: true }), action: () => ({ ok: true }) }));
  const status = registry.list()[0];
  assert.equal(status.id, 'fixture');
  assert.equal(status.currentSessionVisible, null);
  assert.equal(status.readAvailability.search.currentSessionVisible, null);
  assert.deepEqual(status.reads, ['search']);
  assert.deepEqual(status.diagnostics, { supported: true, kind: 'public-read', scope: '只读检查' });
  assert.equal(JSON.stringify(status).includes(secret), false);
  const exec = { agent: { id: 'synthetic-session' } };
  assert.equal(registry.list(exec)[0].currentSessionVisible, true);
  assert.equal(registry.list(exec)[0].readAvailability.search.currentSessionVisible, true);
});

test('declared methods and actions require their provider implementation', () => {
  const registry = new ChannelRegistry();
  registry.register(provider('fixture', { search: undefined, capabilities: () => ({ available: true,
    reads: ['search', 'timeline', 'comments'], diagnostics: { supported: true }, actions: { like: { supported: true, enabled: true, liveVerified: true } },
  }) }));
  assert.deepEqual(registry.list()[0].reads, []);
  assert.equal(registry.list()[0].diagnostics.supported, false);
  assert.deepEqual(registry.list()[0].actions.like, { supported: false, enabled: false, liveVerified: false });
});

test('diagnostics require an implemented and explicitly declared read-only checker', () => {
  const registry = new ChannelRegistry();
  registry.register(provider('undeclared', { check: () => ({ ok: true }) }));
  registry.register(provider('disabled', { check: () => ({ ok: true }), capabilities: () => ({
    implemented: false, diagnostics: { supported: true, kind: 'identity', scope: '合成检查' },
  }) }));
  assert.equal(registry.capabilities('undeclared').diagnostics.supported, false);
  assert.equal(registry.capabilities('disabled').diagnostics.supported, false);
});

test('invalid provider IDs, missing declarations and asynchronous capability declarations fail explicitly', () => {
  const registry = new ChannelRegistry();
  for (const id of ['', '../private', '__proto__', 'Uppercase', null]) assert.throws(() => registry.register(provider(id)), /渠道 ID/);
  assert.throws(() => registry.register({ id: 'missing' }), /capabilities/);
  registry.register(provider('async_provider', { capabilities: () => Promise.resolve({ available: true }) }));
  assert.throws(() => registry.list(), /同步/);
  assert.throws(() => new ChannelRegistry({ catalog: [{ id: 'same' }, { id: 'same' }] }), /重复/);
});
