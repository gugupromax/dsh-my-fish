import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Social} from '../lib/social.js';
import { Engine } from '../lib/engine.js';
import { Store, DEFAULTS } from '../lib/store.js';

test('social adapter advertises only implemented abilities and preserves platform guards',async()=>{
  const requests=[],engine={read:async(...args)=>{requests.push(args);return {data:[]};},write:async(...args)=>{requests.push(args);return {ok:true};}};
  const store={config:()=>({aiUsername:'fish',transport:'browser',allowBookmarks:false,allowReplies:false,allowMentions:false,mode:'solo'}),state:()=>({identity:{username:'fish'}}),publicStatus:()=>({hasCredentials:true})};
  const social=new Social(engine,store);
  const capabilities=social.capabilities();assert.deepEqual(capabilities.platforms.map(p=>p.id),['x']);
  assert.equal(capabilities.platforms[0].actions.reply.enabled,false);
  assert.equal(capabilities.platforms[0].actions.reply.liveVerified,false);
  assert.throws(()=>social.search({platform:'bilibili',query:'test'}),/尚未接入/);assert.equal(requests.length,0);
  await social.search({platform:'x',query:'用户自己的词',count:3});assert.deepEqual(requests[0].slice(0,2),['search',{query:'用户自己的词',count:3}]);
  await social.read({platform:'x',reference:'https://x.com/example/status/123456'});assert.equal(requests[1][1].id,'123456');
  assert.throws(()=>social.read({platform:'x',reference:'https://evil.example/status/123456'}),/有效/);
});

function fixture() {
  const requests = [], config = { aiUsername: 'fixture_bot', transport: 'browser', allowBookmarks: false, allowReplies: false, allowMentions: false, mode: 'solo' };
  const state = { identity: { username: 'fixture_bot', checkedAt: 123 } };
  const engine = { read: async (...args) => { requests.push(['read', ...args]); return { source: '合成材料', data: [{ id: '123456', text: '合成帖子' }] }; },
    write: async (...args) => { requests.push(['write', ...args]); return { ok: true, acknowledgement: { id: '654321' } }; } };
  const store = { config: () => config, state: () => state, publicStatus: () => ({ hasCredentials: true }) };
  return { social: new Social(engine, store), store, engine, requests, config, state };
}

test('registered read providers receive every argument except platform plus original signal and execution context', async () => {
  const { social, requests } = fixture(), calls = [];
  const exec = { agent: { id: 'fixture-session' } }, signal = new AbortController().signal;
  const data = [{ id: 'public-content', text: '合成材料', extra: '保留公开字段' }];
  const adapter = { id: 'fixture', name: '测试渠道', capabilities: received => ({
    implemented: true, available: true, configured: false, accountRequired: false, connection: { state: 'unchecked' },
    currentSessionVisible: received != null, reads: ['search', 'read', 'timeline', 'comments'], actions: {}, scope: '有限公开内容',
  }) };
  for (const method of ['search', 'read', 'timeline', 'comments']) adapter[method] = (...args) => { calls.push([method, ...args]); return { data, source: '可信来源标注', scope: '更窄的结果范围' }; };
  social.register(adapter);
  for (const method of ['search', 'read', 'timeline', 'comments']) {
    const result = await social[method]({ platform: 'fixture', query: '当次关键词', reference: 'public-content', count: 2, page: 3, sort: 'time' }, signal, exec);
    assert.equal(result.data, data);
    assert.equal(result.source, '可信来源标注');
    assert.equal(result.scope, '更窄的结果范围');
    assert.equal(result.platform, 'fixture');
    assert.equal(result.items[0].platform, 'fixture');
    assert.equal(result.items[0].extra, '保留公开字段');
    assert.equal(result.items[0].scope, '更窄的结果范围');
  }
  assert.equal(calls.length, 4);
  assert.equal(calls[0][1].platform, undefined);
  assert.deepEqual(calls[0][1], { query: '当次关键词', reference: 'public-content', count: 2, page: 3, sort: 'time' });
  assert.equal(calls[0][2], signal); assert.equal(calls[0][3], exec);
  assert.equal(requests.length, 0);
});

test('unknown platforms, missing methods and unimplemented providers make no provider requests', () => {
  const { social, requests } = fixture();
  let calls = 0;
  social.register({ id: 'limited', name: '有限渠道', capabilities: () => ({ implemented: true, available: true, reads: ['search'] }), search: () => { calls++; } });
  social.register({ id: 'planned', name: '未实现渠道', capabilities: () => ({ implemented: false, available: true, reads: ['search'] }), search: () => { calls++; } });
  for (const method of ['search', 'read', 'timeline', 'comments', 'action']) assert.throws(() => social[method]({ platform: 'missing' }), /尚未接入/);
  assert.throws(() => social.comments({ platform: 'limited' }), /尚未支持/);
  assert.throws(() => social.timeline({ platform: 'limited' }), /尚未支持/);
  assert.throws(() => social.search({ platform: 'planned' }), /尚未支持/);
  assert.throws(() => social.action({ platform: 'limited', action: 'like' }), /尚未支持/);
  assert.equal(calls, 0); assert.equal(requests.length, 0);
});

test('per-method availability and actual session visibility prevent calls without overstating other reads', async () => {
  const { social } = fixture(); let calls = 0;
  const status = { implemented: true, available: true, currentSessionVisible: true, connection: { state: 'unchecked' },
    reads: ['search', 'read', 'comments'], readAvailability: { search: false, read: { available: true, currentSessionVisible: false }, comments: { available: true, currentSessionVisible: true } } };
  const call = () => { calls++; return { data: [] }; };
  social.register({ id: 'public', capabilities: () => status, search: call, read: call, comments: call });
  const exec = { agent: {} };
  assert.throws(() => social.search({ platform: 'public' }, undefined, exec), /不可用/);
  assert.throws(() => social.read({ platform: 'public' }, undefined, exec), /不可见/);
  await social.comments({ platform: 'public' }, undefined, exec);
  assert.equal(calls, 1);
  status.currentSessionVisible = false;
  assert.throws(() => social.comments({ platform: 'public' }, undefined, exec), /不可见/);
  assert.equal(calls, 1);
});

test('action dispatch requires supported, enabled, available, account configuration and verified connection', async () => {
  const { social } = fixture(); let calls = 0;
  const status = { implemented: true, available: true, accountRequired: true, configured: true,
    connection: { state: 'verified' }, reads: [], actions: { reply: { supported: true, enabled: true, liveVerified: false } } };
  const exec = { agent: {} }, signal = new AbortController().signal, received = [];
  social.register({ id: 'writer', capabilities: () => status, action: (...args) => { calls++; received.push(args); return { ok: true, acknowledgement: { id: 'fixture-ack' } }; } });
  const args = { platform: 'writer', action: 'reply', reference: 'content-id', text: '合成回复', reason: '仅用于合成测试' };
  assert.throws(() => social.action({ ...args, action: 'constructor' }), /尚未支持/);
  status.actions.reply.supported = false; assert.throws(() => social.action(args), /尚未支持/);
  status.actions.reply.supported = true; status.actions.reply.enabled = false; assert.throws(() => social.action(args), /开关/);
  status.actions.reply.enabled = true; status.available = false; assert.throws(() => social.action(args), /尚未就绪/);
  status.available = true; status.configured = false; assert.throws(() => social.action(args), /尚未就绪/);
  status.configured = true;
  for (const state of ['unchecked', 'failed', 'unavailable', 'unconfigured']) { status.connection.state = state; assert.throws(() => social.action(args), /尚未就绪/); }
  assert.equal(calls, 0);
  status.connection.state = 'verified';
  const result = await social.action(args, signal, exec);
  assert.equal(calls, 1); assert.equal(result.acknowledgement.id, 'fixture-ack'); assert.equal(result.platform, 'writer');
  assert.deepEqual(received[0], [{ action: 'reply', reference: 'content-id', text: '合成回复', reason: '仅用于合成测试' }, signal, exec]);
});

test('X compatibility status preserves public keys and timeline is browser-only with no comments', async () => {
  const { social, requests, config, state } = fixture();
  const status = social.capabilities().platforms[0];
  assert.equal(status.account, 'fixture_bot'); assert.equal(status.transport, 'browser');
  assert.equal(status.connected, true); assert.equal(status.identityCheckedAt, 123);
  assert.equal(status.connection.state, 'verified'); assert.equal(status.currentSessionVisible, null);
  assert.match(status.connectionNote, /没有发起实时/);
  assert.equal(social.capabilities({ agent: {} }).platforms[0].currentSessionVisible, null);
  await social.timeline({ platform: 'x', count: 4 });
  assert.deepEqual(requests[0].slice(0, 3), ['read', 'timeline', { count: 4 }]);
  config.transport = 'direct_api';
  assert.throws(() => social.timeline({ platform: 'x' }), /尚未支持/);
  assert.throws(() => social.comments({ platform: 'x', reference: '123456' }), /尚未支持/);
  assert.equal(requests.length, 1);
  state.identity = null;
  assert.equal(social.capabilities().platforms[0].connection.state, 'unchecked');
  config.aiUsername = '';
  assert.equal(social.capabilities().platforms[0].connection.state, 'unconfigured');
  assert.equal(social.capabilities().platforms[0].available, false);
});

test('X unified items preserve old Engine payloads and disabled actions stop before Engine', async () => {
  const { social, requests, config, state } = fixture();
  const result = await social.search({ platform: 'x', query: '测试内容', count: 2 });
  assert.deepEqual(result.data, [{ id: '123456', text: '合成帖子' }]);
  assert.equal(Object.hasOwn(result.data[0], 'platform'), false);
  assert.equal(result.items[0].platform, 'x'); assert.equal(result.source, '合成材料');
  const args = { platform: 'x', action: 'reply', reference: '123456', text: '合成回复', reason: '仅用于合成测试' };
  assert.throws(() => social.action(args), /开关/);
  assert.throws(() => social.action({ ...args, action: 'like' }), /尚未支持/);
  config.allowReplies = true; state.identity = null;
  assert.throws(() => social.action(args), /尚未就绪/);
  assert.equal(requests.length, 1);
  state.identity = { username: 'fixture_bot', transport: 'different-backend' };
  assert.throws(() => social.action(args), /尚未就绪/);
  state.identity = { username: 'fixture_bot', transport: 'browser' };
  await social.action(args);
  assert.deepEqual(requests[1].slice(0, 3), ['write', 'reply', { id: '123456', text: '合成回复', reason: '仅用于合成测试' }]);
});

test('an aborted call stops before a registered provider request', () => {
  const { social, requests } = fixture();
  const abort = new AbortController(); abort.abort();
  assert.throws(() => social.search({ platform: 'x', query: '合成' }, abort.signal), /abort/i);
  assert.equal(requests.length, 0);
});

test('trusted channel checks bypass initial account and connection gates and project provider results', async () => {
  const { social, requests } = fixture(), calls = [], secret = 'SYNTHETIC_PRIVATE_VALUE';
  const signal = new AbortController().signal, exec = { agent: { id: 'synthetic-session' } };
  social.register({ id: 'diagnostic', capabilities: () => ({
    implemented: true, available: false, configured: false, accountRequired: true, currentSessionVisible: false,
    diagnostics: { supported: true, kind: 'identity', scope: '只读检查' }, connection: { state: 'unchecked' },
    actions: { reply: { supported: true, enabled: false, liveVerified: false } },
  }), action: () => { throw Error('Must not write'); }, check: (...args) => {
    calls.push(args); return { ok: true, config: secret, token: secret, persona: secret,
      checks: { connection: { status: 'verified', checkedAt: 123, scope: '合成请求', token: secret },
        identity: { status: 'verified', username: 'fixture_bot', id: secret, config: secret },
        permissions: { status: 'verified', liveWritesChecked: true, actions: { reply: { enabled: true } }, token: secret }, credentials: secret },
      note: '仅只读检查', channel: { config: secret },
    };
  } });
  const result = await social.check({ platform: 'diagnostic', reference: secret }, signal, exec);
  assert.deepEqual(calls, [[signal, exec]]); assert.equal(requests.length, 0);
  assert.equal(result.ok, true); assert.equal(result.platform, 'diagnostic');
  assert.equal(result.channel.id, 'diagnostic'); assert.equal(result.channel.configured, false);
  assert.equal(result.checks.connection.status, 'verified'); assert.equal(result.checks.connection.checkedAt, 123);
  assert.deepEqual(result.checks.identity, { status: 'verified', scope: '', username: 'fixture_bot' });
  assert.equal(result.checks.permissions.status, 'configuration-only'); assert.equal(result.checks.permissions.liveWritesChecked, false);
  assert.deepEqual(result.checks.permissions.actions, result.channel.actions);
  assert.equal(result.checks.permissions.actions.reply.enabled, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('unsupported, unimplemented and aborted checks make no provider requests', async () => {
  const { social } = fixture(); let calls = 0;
  const check = () => { calls++; return { ok: true }; };
  social.register({ id: 'missing_method', capabilities: () => ({ diagnostics: { supported: true } }) });
  social.register({ id: 'undeclared', capabilities: () => ({}), check });
  social.register({ id: 'planned', capabilities: () => ({ implemented: false, diagnostics: { supported: true } }), check });
  social.register({ id: 'implemented', capabilities: () => ({ diagnostics: { supported: true } }), check });
  for (const platform of ['missing_method', 'undeclared', 'planned']) await assert.rejects(social.check({ platform }), /尚未支持/);
  await assert.rejects(social.check({ platform: 'missing' }), /尚未接入/);
  const controller = new AbortController(); controller.abort(new Error('synthetic-check-cancel'));
  await assert.rejects(social.check({ platform: 'implemented' }, controller.signal), /synthetic-check-cancel/);
  assert.equal(calls, 0);
});

test('channel checks reject duplicate concurrent requests and release the gate after failure', async () => {
  const { social } = fixture(); let calls = 0, rejectFirst;
  social.register({ id: 'serial_check', capabilities: () => ({ diagnostics: { supported: true } }), check: () => {
    calls++; return calls === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : { ok: true };
  } });
  const first = social.check({ platform: 'serial_check' });
  await assert.rejects(social.check({ platform: 'serial_check' }), /正在运行/);
  assert.equal(calls, 1); rejectFirst(new Error('synthetic-check-failure')); await assert.rejects(first, /synthetic-check-failure/);
  assert.equal((await social.check({ platform: 'serial_check' })).ok, true); assert.equal(calls, 2);
});

test('X check calls diagnose directly and exposes only public identity and configured action switches', async () => {
  const { social, config, state, engine, requests } = fixture(), secret = 'SYNTHETIC_PRIVATE_VALUE';
  const originalConfig = structuredClone(config), signal = new AbortController().signal;
  state.identity = null; state.inflight = 'synthetic-uncertain-receipt'; state.pausedUntil = 123;
  engine.serial = () => { throw Error('Do not nest diagnose in serial'); };
  let calls = 0;
  engine.diagnose = async received => { calls++; assert.equal(received, signal); state.identity = { username: config.aiUsername, checkedAt: 456 };
    return { ok: true, identity: { username: config.aiUsername, id: secret, cookie: secret }, config: secret, persona: secret };
  };
  assert.equal(social.capabilities().platforms[0].connection.state, 'unchecked');
  const result = await social.check({ platform: 'x' }, signal);
  assert.equal(calls, 1); assert.equal(requests.length, 0);
  assert.equal(result.channel.connection.state, 'verified'); assert.equal(result.checks.connection.checkedAt, 456);
  assert.equal(result.checks.identity.username, config.aiUsername); assert.equal(result.checks.identity.status, 'verified');
  assert.equal(result.checks.permissions.liveWritesChecked, false); assert.equal(result.checks.permissions.actions.reply.enabled, false);
  assert.equal(state.inflight, 'synthetic-uncertain-receipt'); assert.equal(state.pausedUntil, 123);
  assert.deepEqual(config, originalConfig); assert.equal(JSON.stringify(result).includes(secret), false);
});

test('real X diagnostics preserve configuration and receipt locks and failed checks clear verified identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  store.saveConfig({ ...DEFAULTS, aiUsername: 'fixture_bot' });
  fs.writeFileSync(store.file('credentials.json'), 'SYNTHETIC_EXISTENCE_MARKER_NOT_A_CREDENTIAL');
  const originalConfig = store.config(), state = store.state();
  state.inflight = 'synthetic-lock'; state.ledger = [{ id: 'synthetic-lock', status: 'uncertain', text: '合成回执' }]; store.saveState(state);
  let calls = 0, mismatch = false;
  const engine = new Engine(store, async (_store, op) => { calls++; assert.equal(op, 'identity'); return { id: '12345', username: mismatch ? 'other_fixture' : 'fixture_bot' }; }, () => 10000, async () => {});
  const social = new Social(engine, store);
  const success = await social.check({ platform: 'x' });
  assert.equal(success.checks.identity.status, 'verified'); assert.equal(success.channel.connection.state, 'verified');
  assert.equal(store.state().inflight, 'synthetic-lock'); assert.deepEqual(store.state().ledger, state.ledger);
  mismatch = true; await assert.rejects(social.check({ platform: 'x' }), /不一致/);
  assert.equal(social.capabilities().platforms[0].connection.state, 'failed'); assert.equal(store.state().identity, null);
  assert.equal(store.state().inflight, 'synthetic-lock'); assert.deepEqual(store.config(), originalConfig); assert.equal(calls, 2);
  const paused = store.state(); paused.pausedUntil = 20000; paused.pauseReason = '合成限流'; store.saveState(paused);
  await assert.rejects(social.check({ platform: 'x' }), /已暂停/); assert.equal(calls, 2);
  assert.equal(store.state().pausedUntil, 20000); assert.equal(store.state().inflight, 'synthetic-lock');
});

test('X checks retain Engine missing-account errors instead of blocking first-time diagnosis', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-first-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root); let calls = 0;
  const social = new Social(new Engine(store, async () => { calls++; throw Error('合成缺少凭据'); }), store);
  await assert.rejects(social.check({ platform: 'x' }), /先填写/); assert.equal(calls, 0);
  store.saveConfig({ ...DEFAULTS, aiUsername: 'fixture_bot' });
  await assert.rejects(social.check({ platform: 'x' }), /合成缺少凭据/); assert.equal(calls, 1);
  assert.equal(store.config().aiUsername, 'fixture_bot'); assert.equal(store.state().identity, null);
});

test('X provider keeps real Engine evidence, identity, quota, duplicate and receipt gates using synthetic storage', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-social-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  store.saveConfig({ ...DEFAULTS, aiUsername: 'fixture_bot', allowBookmarks: true, allowReplies: true, maxWritesDaily: 1 });
  fs.writeFileSync(store.file('credentials.json'), 'SYNTHETIC_EXISTENCE_MARKER_NOT_A_CREDENTIAL');
  const calls = []; let clock = Date.now(), mismatch = false;
  const remote = async (_store, op, args) => {
    calls.push({ op, args });
    if (op === 'identity') return { id: '99999', username: mismatch ? 'other_fixture' : 'fixture_bot' };
    if (op === 'read') return { id: args.id, author: 'fixture_author', text: '合成帖子' };
    if (op === 'bookmark') return { id: args.id, acknowledged: true };
    return { id: '654321' };
  };
  const engine = new Engine(store, remote, () => clock, async () => {}), social = new Social(engine, store);
  await engine.diagnose(); calls.length = 0;
  const args = { platform: 'x', action: 'bookmark', reference: '123456', reason: '保留这条合成验证资料' };
  await assert.rejects(() => social.action(args), /先读取/); assert.equal(calls.length, 0);
  await social.read({ platform: 'x', reference: '123456' });
  mismatch = true;
  await assert.rejects(() => social.action(args), /不一致/);
  assert.equal(calls.some(row => row.op === 'bookmark'), false);
  mismatch = false; const confirmed = await social.action(args);
  assert.equal(confirmed.ok, true); assert.equal(confirmed.acknowledgement.acknowledged, true);
  assert.equal(store.state().inflight, null);
  await assert.rejects(() => social.action(args), /重复/);
  clock += 200000;
  await social.read({ platform: 'x', reference: '123457' });
  await assert.rejects(() => social.action({ ...args, reference: '123457' }), /额度/);
  assert.equal(calls.filter(row => row.op === 'bookmark').length, 1);
});
