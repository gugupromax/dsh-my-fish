import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {Permissions} from '../lib/permissions.js';

const agent=id=>({id,session:{id}});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root);store.saveState({...store.state(),sessionId:'main'});return {store,policy:new Permissions(store)};}
function call(name,args={},subject=agent('main')){return {name,arguments:args,agent:subject};}

test('personal defaults deny shell, local writes, browser interaction, delegation and unknown tools without changing ordinary chats',t=>{
  const {policy}=fixture(t);
  for(const name of ['pwsh','terminal_send','run_code','write','edit','bsk_interact','bsk_assist','subagent','spawn_teammate','some_new_tool'])assert.equal(typeof policy.guard(call(name)),'string',name);
  for(const name of ['web_search','web_fetch','read','social_read','assistant_memory'])assert.equal(policy.guard(call(name)),undefined,name);
  assert.equal(policy.guard(call('pwsh',{},agent('ordinary'))),undefined);
  assert.throws(()=>policy.save({enabled:true}),/字段/);
  assert.throws(()=>policy.save({shell:'yes'}),/开关/);
});
test('outbound review rejects secrets, encoded private phrases and local paths without echoing secret values',t=>{
  const {policy}=fixture(t);policy.save({privateTerms:['SYNTHETIC PRIVATE PHRASE']});
  for(const value of ['auth_token=synthetic-secret-value','https://example.test/?api_key=synthetic-secret-value','https://someone:synthetic-secret-value@example.test','SYNTHETIC%2520PRIVATE%2520PHRASE','E:\\example\\file.txt']){
    const reason=policy.guard(call('web_search',{query:value}));assert.equal(typeof reason,'string',value);assert.ok(!reason.includes('synthetic-secret-value'));
  }
  assert.equal(policy.guard(call('web_search',{query:'public release notes'})),undefined);
  assert.equal(policy.guard(call('social_action',{text:'synthetic private phrase'}))?.includes('私密词'),true);
});
test('runtime ownership propagates policy through nested children while a forged durable parent does not claim an unrelated chat',t=>{
  const {store}=fixture(t),main=agent('main'),child=agent('child'),grandchild=agent('grandchild'),ordinary=agent('ordinary');
  ordinary.session.parentId='main';const owners=new Map([[child,main],[grandchild,child]]),all=[main,child,grandchild,ordinary];
  const registry={list:()=>all,isOwnedBy:(id,owner)=>all.some(a=>a.id===id&&owners.get(a)===owner)};
  const policy=new Permissions(store,{getRegistry:()=>registry});
  assert.equal(policy.scope(call('pwsh',{},grandchild)),'descendant');
  assert.equal(typeof policy.guard(call('pwsh',{},grandchild)),'string');
  assert.equal(policy.guard(call('pwsh',{},ordinary)),undefined);
  policy.save({shell:true,delegation:true});assert.equal(policy.guard(call('pwsh',{},grandchild)),undefined);assert.equal(policy.guard(call('subagent',{},main)),undefined);
  owners.delete(grandchild);assert.equal(policy.scope(call('pwsh',{},grandchild)),null);
});
test('plan execution and descendants stay read only even if user enables main-session machine permissions',t=>{
  const {store}=fixture(t),plan=agent('plan'),child=agent('plan-child'),all=[plan,child];
  const policy=new Permissions(store,{isPlanSession:exec=>exec.agent===plan,getRegistry:()=>({list:()=>all,isOwnedBy:(id,owner)=>id===child.id&&owner===plan})});
  policy.save({shell:true,fileWrite:true,browserInteract:true,delegation:true});
  for(const subject of [plan,child]){
    for(const name of ['pwsh','run_code','write','bsk_interact','subagent','assistant_context','social_action','assistant_wake'])assert.equal(typeof policy.guard(call(name,{},subject)),'string',name);
    assert.equal(policy.guard(call('web_search',{query:'public'},subject)),undefined);
  }
  assert.equal(policy.guard(call('assistant_plan_report',{},plan)),undefined);
});

test('retired main and its remaining runtime-owned children do not become unrestricted ordinary chats',t=>{
  const {store}=fixture(t),old=agent('retired-main'),child=agent('retired-child'),main=agent('main'),ordinary=agent('ordinary'),rows=[old,child,main,ordinary];
  store.saveState({...store.state(),retiredSessionIds:[old.id]});
  const policy=new Permissions(store,{getRegistry:()=>({list:()=>rows,isOwnedBy:(id,owner)=>id===child.id&&owner===old})});policy.save({shell:true,delegation:true});
  for(const subject of [old,child])for(const name of ['pwsh','web_search','assistant_context'])assert.match(policy.guard(call(name,{},subject)),/失效/);
  assert.equal(policy.guard(call('pwsh',{},main)),undefined);assert.equal(policy.guard(call('pwsh',{},ordinary)),undefined);
});
