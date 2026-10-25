import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, DEFAULTS } from '../lib/store.js';
import { Scheduler } from '../lib/scheduler.js';

function fixture(t,overrides={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'x-whale-visible-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root);store.saveConfig({...DEFAULTS,aiUsername:'fixture_bot',...overrides});
  return store;
}
test('missing identity leaves a persistent blocked manual attempt and no session',async t=>{
  const store=fixture(t);let creates=0;
  const scheduler=new Scheduler(store,{create:async()=>{creates++;return {sessionId:'no'};}},new AbortController().signal);
  const before=Date.now();
  await assert.rejects(()=>scheduler.run(true),/连接体检/);
  const last=new Store(store.root).state().lastRun;
  assert.equal(last.status,'blocked');assert.equal(last.manual,true);assert.ok(last.at>=before);
  assert.match(last.reason,/连接体检/);assert.equal(creates,0);
  assert.equal(store.publicStatus().lastRun.status,'blocked');
});
test('due automatic attempt is recorded but not-yet-due ticks do not replace it',async t=>{
  const store=fixture(t,{enabled:true,startHour:0,endHour:24});
  const scheduler=new Scheduler(store,{},new AbortController().signal);
  await assert.rejects(()=>scheduler.run(false),/连接体检/);
  const blocked=store.state().lastRun;assert.equal(blocked.status,'blocked');assert.equal(blocked.manual,false);
  const s=store.state();s.nextRun=Date.now()+3600000;store.saveState(s);
  assert.equal((await scheduler.run(false)).skipped,'未到作息时间');
  assert.deepEqual(store.state().lastRun,blocked);
});
test('session creation failure is persisted without consuming a run or losing identity',async t=>{
  const store=fixture(t),s=store.state();s.identity={username:'fixture_bot'};store.saveState(s);
  const scheduler=new Scheduler(store,{create:async()=>{throw Error('model unavailable');}},new AbortController().signal);
  await assert.rejects(()=>scheduler.run(true),/model unavailable/);
  const next=store.state();assert.equal(next.lastRun.status,'failed');assert.match(next.lastRun.reason,/model unavailable/);
  assert.equal(next.identity.username,'fixture_bot');assert.deepEqual(next.runs,{});
});
test('dispatch failure records session and uncertainty; queued never claims completion',async t=>{
  const store=fixture(t),s=store.state();s.identity={username:'fixture_bot'};store.saveState(s);
  let fail=true;
  const scheduler=new Scheduler(store,{create:async()=>({sessionId:'real-session'}),prompt:async()=>{if(fail)throw Error('dispatch rejected');}},new AbortController().signal);
  await assert.rejects(()=>scheduler.run(true));
  let next=store.state();assert.equal(next.lastRun.status,'failed');assert.equal(next.lastRun.sessionId,'real-session');assert.equal(next.dispatchPending,true);
  next.dispatchPending=false;store.saveState(next);fail=false;await scheduler.run(true);
  next=store.state();assert.equal(next.lastRun.status,'queued');assert.match(next.lastRun.reason,/不代表/);
  assert.equal(store.publicStatus().sessionId,'real-session');
});
test('failure reasons do not persist credential assignments',async t=>{
  const store=fixture(t),s=store.state();s.identity={username:'fixture_bot'};store.saveState(s);
  const scheduler=new Scheduler(store,{create:async()=>{throw Error('auth_token=SUPERSECRET ct0=CSRFSECRET cookie=JARSECRETS password=PASSWORDSECRET');}},new AbortController().signal);
  await assert.rejects(()=>scheduler.run(true));
  assert.equal(store.state().lastRun.status,'failed');
  assert.ok(!JSON.stringify(store.publicStatus()).includes('SUPERSECRET'));
  assert.ok(!JSON.stringify(store.publicStatus()).includes('CSRFSECRET'));
  assert.ok(!JSON.stringify(store.publicStatus()).includes('JARSECRETS'));
  assert.ok(!JSON.stringify(store.publicStatus()).includes('PASSWORDSECRET'));
});
test('two fresh diaries close the reporting stage without claiming useful results or publication',async t=>{
  const store=fixture(t),s=store.state();s.identity={username:'fixture_bot'};store.saveState(s);
  const scheduler=new Scheduler(store,{create:async()=>({sessionId:'report-test'}),prompt:async()=>({accepted:true})},new AbortController().signal);
  await scheduler.run(true);
  store.diary('master','本轮读取失败，没有推荐。');scheduler.diaryWritten('master');
  assert.equal(store.state().lastRun.status,'queued');
  store.diary('private','记录失败原因，不编造推荐。');scheduler.diaryWritten('private');
  assert.equal(store.state().lastRun.status,'reported');
  assert.match(store.state().lastRun.reason,/以日记和最近读取状态为准/);
  assert.equal(store.state().ledger.length,0);
});
test('public read status excludes response bodies, credential fields and arbitrary details',t=>{
  const store=fixture(t),s=store.state();
  s.lastRead={at:Date.now(),operation:'search',status:'failed',message:'读取未成功',kind:'KeyError',code:'request_failed',details:'secret-details',auth_token:'secret-cookie',body:'raw-body'};
  store.saveState(s);
  assert.equal(store.publicStatus().lastRead.kind,'KeyError');
  const json=JSON.stringify(store.publicStatus());
  for(const secret of ['secret-details','secret-cookie','raw-body'])assert.ok(!json.includes(secret));
});
