import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {Scheduler} from '../lib/scheduler.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-session-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),assistant=new AssistantStore(store),known=new Set(),calls={create:[],prompt:0};
  store.saveState({...store.state(),sessionId:'deleted-main'});
  const host={create:async request=>{calls.create.push(request);known.add(request.sessionId);return {sessionId:request.sessionId};},prompt:async()=>{calls.prompt++;}};
  const probe=async id=>known.has(id)?'exists':'missing';
  const scheduler=new Scheduler(store,host,new AbortController().signal,assistant,{probeSession:probe});
  return {root,store,assistant,known,calls,host,probe,scheduler};
}
test('manual recovery replaces an unavailable main exactly once without prompting or changing personal records',async t=>{
  const f=fixture(t);f.assistant.remember({text:'synthetic persistent preference',source:'test user'});fs.mkdirSync(f.store.file('workspace'),{recursive:true});fs.writeFileSync(f.store.file('workspace/note.txt'),'synthetic work');
  const [first,second]=await Promise.all([f.scheduler.ensureSession({recoverMissing:true}),f.scheduler.ensureSession({recoverMissing:true})]);
  assert.notEqual(first.sessionId,'deleted-main');assert.equal(first.recovered,true);assert.equal(second.sessionId,first.sessionId);assert.equal(f.calls.create.length,1);assert.equal(f.calls.prompt,0);
  assert.equal(f.assistant.memories().length,1);assert.equal(fs.readFileSync(f.store.file('workspace/note.txt'),'utf8'),'synthetic work');assert.equal(f.store.root,f.root);assert.equal(f.store.state().sessionCreation,null);
});
test('available or archived records keep the saved main and never create a replacement',async t=>{
  const f=fixture(t);f.known.add('deleted-main');const before=f.store.state();
  assert.equal((await f.scheduler.ensureSession({recoverMissing:true})).sessionId,'deleted-main');assert.equal(f.calls.create.length,0);assert.deepEqual(f.store.state(),before);
});
test('probe errors preserve the original mapping and all run state',async t=>{
  const f=fixture(t);f.store.saveState({...f.store.state(),dispatchPending:true,activeRun:{id:'old-run',sessionId:'deleted-main'}});const before=f.store.state();
  const scheduler=new Scheduler(f.store,f.host,new AbortController().signal,f.assistant,{probeSession:async()=>{throw Error('temporary metadata failure');}});
  await assert.rejects(()=>scheduler.ensureSession({recoverMissing:true}),/temporary metadata failure/);assert.deepEqual(f.store.state(),before);assert.equal(f.calls.create.length,0);
});
test('unknown create outcome is reconciled against its persisted requested ID rather than creating a duplicate',async t=>{
  const f=fixture(t),base=f.host.create;
  f.host.create=async request=>{await base(request);throw Error('unknown create response');};
  await assert.rejects(()=>f.scheduler.ensureSession({recoverMissing:true}),/unknown create response/);
  const pending=f.store.state().sessionCreation;assert.ok(pending.id);assert.equal(f.store.state().sessionId,'deleted-main');
  const restored=new Scheduler(f.store,f.host,new AbortController().signal,f.assistant,{probeSession:f.probe});
  const recovered=await restored.ensureSession({recoverMissing:true});assert.equal(recovered.sessionId,pending.id);assert.equal(f.calls.create.length,1);assert.equal(f.calls.prompt,0);
});
test('failed creation retries the same requested ID and never clears the deleted binding before success',async t=>{
  const f=fixture(t);let attempts=0;const ids=[];
  f.host.create=async request=>{ids.push(request.sessionId);if(++attempts===1)throw Error('synthetic failure before commit');f.known.add(request.sessionId);return {sessionId:request.sessionId};};
  await assert.rejects(()=>f.scheduler.ensureSession({recoverMissing:true}),/synthetic failure/);assert.equal(f.store.state().sessionId,'deleted-main');
  await f.scheduler.ensureSession({recoverMissing:true});assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
test('recovery interrupts only old local run bindings and leaves account uncertainty, budget and saved goals intact',async t=>{
  const f=fixture(t);f.assistant.saveSettings({enabled:true});f.assistant.saveGoal({title:'synthetic saved goal'});
  const old={id:'old-run',sessionId:'deleted-main',status:'queued',at:100,reason:'queued before deletion'};
  f.store.saveState({...f.store.state(),activeRun:{id:old.id,sessionId:old.sessionId},dispatchPending:true,lastRun:old,runHistory:[old],runs:{today:3},nextRun:987654321,inflight:'uncertain-public-action',pausedUntil:9999999999999,pauseReason:'account pause'});
  const result=await f.scheduler.ensureSession({recoverMissing:true}),state=f.store.state();
  assert.notEqual(result.sessionId,'deleted-main');assert.equal(state.activeRun,null);assert.equal(state.dispatchPending,false);assert.equal(state.lastRun.status,'interrupted');assert.equal(state.lastRun.sessionId,'deleted-main');
  assert.equal(state.inflight,'uncertain-public-action');assert.equal(state.pausedUntil,9999999999999);assert.equal(state.pauseReason,'account pause');assert.deepEqual(state.runs,{today:3});assert.equal(state.nextRun,987654321);assert.equal(f.assistant.goals().length,1);
  assert.equal(state.sessionRecovery.followupPaused,true);assert.ok(state.retiredSessionIds.includes('deleted-main'));assert.equal((await f.scheduler.run(false)).skipped,'会话恢复后自主跟进暂缓');assert.equal(f.calls.prompt,0);
  assert.throws(()=>f.scheduler.finish({runId:old.id,notify:false,summary:'late old callback'}),/已结束|不匹配/);
});
test('unavailable main is never replaced by an automatic or non-recovery ensure call',async t=>{
  const f=fixture(t);await assert.rejects(()=>f.scheduler.ensureSession(),/会话/);assert.equal(f.calls.create.length,0);assert.equal(f.store.state().sessionId,'deleted-main');
});
test('inconsistent run ownership refuses recovery before creating anything',async t=>{
  const f=fixture(t);f.store.saveState({...f.store.state(),activeRun:{id:'foreign-run',sessionId:'different-main'}});
  await assert.rejects(()=>f.scheduler.ensureSession({recoverMissing:true}),/归属|绑定/);assert.equal(f.calls.create.length,0);assert.equal(f.store.state().sessionId,'deleted-main');
});
