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

test('ordinary HTTPS source links are not Windows drive paths while real and encoded private paths stay blocked',t=>{
  const {policy}=fixture(t);
  for(const [name,args] of [['social_read',{platform:'bilibili',reference:'https://www.bilibili.com/video/BV1GJ411x7h7/'}],['web_fetch',{url:'https://example.test/reading'}],['social_read',{platform:'x',reference:'https://x.com/example/status/123456'}]])assert.equal(policy.guard(call(name,args)),undefined);
  for(const value of ['E:\\example\\private.txt','E:/example/private.txt','\\\\server\\share\\private.txt','/users/example/private.txt','/home/example/private.txt','E%253A%252Fexample%252Fprivate.txt','https://example.test/?path=E%3A%2Fexample%2Fprivate.txt'])assert.match(policy.guard(call('web_search',{query:value})),/路径/);
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
  for(const subject of [old,child])for(const name of ['pwsh','web_search','assistant_context','ask_user_question','session_event_search','task_board_list','compress'])assert.match(policy.guard(call(name,{},subject)),/失效/);
  assert.equal(policy.guard(call('pwsh',{},main)),undefined);assert.equal(policy.guard(call('pwsh',{},ordinary)),undefined);
});

test('personal host interaction and read tools remain available without machine permissions while plan compression stays local',t=>{
  const {store}=fixture(t),main=agent('main'),child=agent('personal-child'),grandchild=agent('personal-grandchild'),plan=agent('plan-root'),planChild=agent('plan-child'),ordinary=agent('ordinary');
  ordinary.session.parentId=main.id;
  const rows=[main,child,grandchild,plan,planChild,ordinary],owners=new Map([[child,main],[grandchild,child],[planChild,plan]]);
  const policy=new Permissions(store,{isPlanSession:exec=>exec.agent===plan,getRegistry:()=>({list:()=>rows,isOwnedBy:(id,owner)=>rows.some(row=>row.id===id&&owners.get(row)===owner)})});
  const localTools=['ask_user_question','session_event_search','task_board_list','compress'];
  const state=structuredClone(store.state()),before=policy.policy();
  assert.deepEqual([before.shell,before.fileWrite,before.browserInteract,before.delegation],[false,false,false,false]);
  assert.equal(policy.scope(call('compress',{},child)),'descendant');
  assert.equal(policy.scope(call('compress',{},grandchild)),'descendant');
  assert.equal(policy.scope(call('compress',{},plan)),'plan');
  assert.equal(policy.scope(call('compress',{},planChild)),'plan-descendant');
  for(const subject of [main,child,grandchild,plan,planChild]){
    for(const name of [main,child,grandchild].includes(subject)?localTools:['compress'])assert.equal(policy.guard(call(name,{},subject)),undefined,subject.id+' / '+name);
    assert.match(policy.guard(call('unreviewed_new_host_tool',{},subject)),/尚未纳入|分类/);
    for(const name of ['pwsh','run_code','write','edit','bsk_interact','subagent','spawn_teammate','send_message'])assert.equal(typeof policy.guard(call(name,{},subject)),'string',subject.id+' / '+name);
  }
  assert.equal(policy.scope(call('compress',{},ordinary)),null,'a stored parent claim is not live runtime ownership');
  for(const name of localTools)assert.equal(policy.guard(call(name,{},ordinary)),undefined);
  assert.deepEqual(policy.policy(),before);assert.deepEqual(store.state(),state,'classification does not mutate permissions or session state');
});

test('new local host classifications preserve outbound secret and private-term review in every managed scope',t=>{
  const {store}=fixture(t),main=agent('main'),child=agent('personal-child'),plan=agent('plan-root'),planChild=agent('plan-child'),rows=[main,child,plan,planChild];
  const owners=new Map([[child,main],[planChild,plan]]);
  const policy=new Permissions(store,{isPlanSession:exec=>exec.agent===plan,getRegistry:()=>({list:()=>rows,isOwnedBy:(id,owner)=>rows.some(row=>row.id===id&&owners.get(row)===owner)})});
  policy.save({privateTerms:['SYNTHETIC PRIVATE PHRASE']});
  for(const subject of rows){
    for(const name of [main,child].includes(subject)?['ask_user_question','session_event_search','task_board_list','compress']:['compress'])assert.equal(policy.guard(call(name,{},subject)),undefined);
    for(const [name,args] of [
      ['web_search',{query:'SYNTHETIC%2520PRIVATE%2520PHRASE'}],
      ['web_fetch',{url:'https://example.test/?access_token=synthetic-secret-value'}],
      ['social_search',{platform:'bilibili',query:'E:\\synthetic\\private.txt'}],
    ]){
      const reason=policy.guard(call(name,args,subject));assert.equal(typeof reason,'string',subject.id+' / '+name);
      assert.ok(!reason.includes('synthetic-secret-value'));assert.ok(!reason.includes('SYNTHETIC PRIVATE PHRASE'));
    }
    assert.equal(policy.guard(call('web_search',{query:'public release notes'},subject)),undefined);
  }
  assert.deepEqual([policy.policy().shell,policy.policy().fileWrite,policy.policy().browserInteract,policy.policy().delegation],[false,false,false,false]);
});

test('allowing task-board listing never grants plan management, writes or delegation even under broader main policy',t=>{
  const {store}=fixture(t),main=agent('main'),plan=agent('plan-root'),child=agent('plan-child'),rows=[main,plan,child];
  const policy=new Permissions(store,{isPlanSession:exec=>exec.agent===plan,getRegistry:()=>({list:()=>rows,isOwnedBy:(id,owner)=>id===child.id&&owner===plan})});
  policy.save({shell:true,fileWrite:true,browserInteract:true,delegation:true});
  for(const subject of [plan,child]){
    assert.equal(policy.guard(call('compress',{},subject)),undefined);
    for(const name of ['ask_user_question','task_board_list'])assert.match(policy.guard(call(name,{},subject)),/计划|个人/);
    for(const name of ['assistant_plan','assistant_memory','assistant_context','assistant_wake','social_action','x_whale_reply','pwsh','run_code','write','bsk_interact','subagent','spawn_teammate','send_message','task_board_create','task_board_update','task_board_archive','task_board_execute'])assert.equal(typeof policy.guard(call(name,{},subject)),'string',subject.id+' / '+name);
    assert.equal(policy.guard(call('assistant_plan_report',{},subject)),undefined);
    assert.match(policy.guard(call('task_board_unreviewed_action',{},subject)),/尚未纳入|分类/);
  }
  for(const name of ['task_board_create','task_board_update','task_board_archive','task_board_execute'])assert.match(policy.guard(call(name,{},main)),/尚未纳入|分类/,'no prefix wildcard authorizes '+name);
});

test('plan history search is confined to its own current session while personal chats retain native host authorization',t=>{
  const {store}=fixture(t),main=agent('main'),personalChild=agent('personal-child'),plan=agent('plan-root'),planChild=agent('plan-child'),rows=[main,personalChild,plan,planChild];
  const owners=new Map([[personalChild,main],[planChild,plan]]);
  const policy=new Permissions(store,{isPlanSession:exec=>exec.agent===plan,getRegistry:()=>({list:()=>rows,isOwnedBy:(id,owner)=>rows.some(row=>row.id===id&&owners.get(row)===owner)})});
  for(const subject of [plan,planChild]){
    assert.equal(policy.guard(call('session_event_search',{query:'synthetic current-session fact'},subject)),undefined);
    assert.equal(policy.guard(call('session_event_search',{query:'synthetic current-session fact',session_id:subject.session.id},subject)),undefined);
    for(const target of [main.id,personalChild.id,subject===plan?planChild.id:plan.id,'another-synthetic-session','',null,0,false,[],{}]){
      const reason=policy.guard(call('session_event_search',{query:'synthetic lookup',session_id:target},subject));
      assert.match(reason,/计划|当前|会话/,subject.id+' cannot inspect '+JSON.stringify(target));
    }
  }
  for(const subject of [main,personalChild])assert.equal(policy.guard(call('session_event_search',{query:'synthetic native-host-scope lookup',session_id:'another-same-workspace-session'},subject)),undefined,'the host remains responsible for authorizing personal native-scope searches');
  assert.deepEqual([policy.policy().shell,policy.policy().fileWrite,policy.policy().browserInteract,policy.policy().delegation],[false,false,false,false]);
});
