import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {Scheduler} from '../lib/scheduler.js';
import {dayKey} from '../lib/engine.js';

test('chat initialization creates exactly one durable session without prompting, quota, or an active run',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-session-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root);let creates=0,prompts=0;
  const controller={create:async()=>{creates++;await Promise.resolve();return {sessionId:'host-returned-main'};},prompt:async()=>{prompts++;}};
  const scheduler=new Scheduler(store,controller,new AbortController().signal,new AssistantStore(store));
  const results=await Promise.all([scheduler.ensureSession(),scheduler.ensureSession()]);
  assert.equal(creates,1);assert.equal(prompts,0);assert.equal(results[0].sessionId,'host-returned-main');assert.equal(results[1].created,false);
  assert.equal(store.state().sessionId,'host-returned-main');assert.equal(store.state().activeRun,undefined);assert.deepEqual(store.state().runs,{});
  const restored=new Scheduler(store,controller,new AbortController().signal);await restored.ensureSession();assert.equal(creates,1);
});
test('explicit user task is not swallowed by autonomous exploration daily quota',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-task-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),assistant=new AssistantStore(store),day=dayKey(Date.now());store.saveState({...store.state(),sessionId:'main',runs:{[day]:12}});
  const scheduler=new Scheduler(store,{prompt:async()=>{}},new AbortController().signal,assistant);
  assert.equal((await scheduler.run(true,'明确当次任务')).ok,true);assert.equal(store.state().runs[day],12);
});
