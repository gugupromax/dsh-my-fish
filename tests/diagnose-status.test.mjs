import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,DEFAULTS} from '../lib/store.js';
import {Engine} from '../lib/engine.js';

function storeFor(t,config={}) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'x-diagnose-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.saveConfig({...DEFAULTS,...config});return store;}
test('missing username records a blocked diagnosis without reading credentials or calling X',async t=>{
  const store=storeFor(t);let requests=0;
  const engine=new Engine(store,async()=>{requests++;throw Error('must not connect');});
  await assert.rejects(()=>engine.diagnose(),/填写 AI 账号/);
  assert.equal(requests,0);
  assert.equal(store.state().lastDiagnosis.status,'failed');
  assert.match(store.state().lastDiagnosis.message,/填写 AI 账号/);
});
test('successful diagnosis records verified identity and failure invalidates previous identity',async t=>{
  const store=storeFor(t,{aiUsername:'fixture_bot'});
  const engine=new Engine(store,async()=>({id:'99999',username:'fixture_bot',name:'Fixture Assistant'}),Date.now,async()=>{});
  await engine.diagnose();assert.equal(store.state().lastDiagnosis.status,'passed');
  engine.adapter=async()=>{throw Object.assign(Error('请检查连接'),{code:'network_uncertain'});};
  await assert.rejects(()=>engine.diagnose());
  assert.equal(store.state().identity,null);
  assert.equal(store.state().lastDiagnosis.status,'failed');
});
