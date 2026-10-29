import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../lib/store.js';
import {SessionBinding} from '../lib/session-binding.js';

function fixture(t){
  const temporaryBase=fs.realpathSync.native(os.tmpdir()),home=fs.realpathSync.native(fs.mkdtempSync(path.join(temporaryBase,'my-fish-binding-')));
  fs.mkdirSync(path.join(home,'data'));fs.mkdirSync(path.join(home,'other'));
  const root=fs.realpathSync.native(path.join(home,'data')),other=fs.realpathSync.native(path.join(home,'other'));
  t.after(()=>{const relative=path.relative(temporaryBase,path.resolve(home));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(path.dirname(path.resolve(home)),temporaryBase);fs.rmSync(home,{recursive:true,force:true});});
  const store=new Store(root),headers=new Map(),live=new Map(),workspaces=new Map(),calls={create:0,attach:0,stat:0,save:0};
  const old='synthetic-old-main',target='synthetic-target-main';
  const header=(id,cwd=root,extra={})=>({version:4,id,cwd,createdAt:123,isSeeded:false,...extra});
  headers.set(old,header(old,other));headers.set(target,header(target));
  const agents=[{id:old,session:{id:old},status:'idle'},{id:target,session:{id:target},status:'idle'}],owners=new Map();
  const runtime={list:()=>agents,isOwnedBy:(id,owner)=>agents.some(agent=>agent.id===id&&owners.get(agent)===owner)};
  const entity=(id,directory,members=[])=>({id,title:'Synthetic '+id,path:directory,sessionIds:[...members],attachSession:async sessionId=>{
    calls.attach++;const row=headers.get(sessionId);assert.ok(row);assert.equal(fs.realpathSync.native(row.cwd),fs.realpathSync.native(directory));
    const workspace=workspaces.get(id);if(!workspace.sessionIds.includes(sessionId))workspace.sessionIds.push(sessionId);
  }});
  const registry={get:id=>workspaces.get(id),list:()=>[...workspaces.values()],archivedSessionIds:[],resolveByPath:async directory=>[...workspaces.values()].find(item=>fs.realpathSync.native(item.path)===fs.realpathSync.native(directory)),create:async(directory,title)=>{
    calls.create++;const workspace=entity('synthetic-created-workspace-'+calls.create,directory);workspace.title=title;workspaces.set(workspace.id,workspace);return workspace;
  }};
  const workspace=entity('synthetic-root-workspace',root,[target]);workspaces.set(workspace.id,workspace);
  const sessions={get:id=>live.get(id)},persistence={stat:async id=>{calls.stat++;const value=headers.get(id);return value?{header:structuredClone(value),revision:'synthetic-revision'}:undefined;},read(){throw Error('Never read a conversation body');}};
  store.saveState({...store.state(),sessionId:old,runs:{synthetic:2},nextRun:12345,pausedUntil:987654321,pauseReason:'Synthetic account pause',ledger:[{id:'synthetic-audit'}]});
  const originalSave=store.saveState.bind(store);store.saveState=value=>{calls.save++;return originalSave(value);};
  const options={store,getRegistry:()=>registry,getSessions:()=>sessions,getPersistence:()=>persistence,getAgents:()=>runtime};
  return {home,root,other,store,old,target,headers,header,live,agents,owners,runtime,workspaces,workspace,registry,sessions,persistence,calls,options,binding:new SessionBinding(options),entity};
}

test('snapshot selects the exact data-root group and reads candidate metadata without creating or writing',async t=>{
  const f=fixture(t),before=fs.readFileSync(f.store.file('state.json'),'utf8');
  const nested=path.join(f.root,'nested');fs.mkdirSync(nested);f.workspaces.set('synthetic-nested',f.entity('synthetic-nested',nested));
  const result=await f.binding.snapshot();
  assert.equal(result.available,true);assert.equal(result.selectedWorkspaceId,f.workspace.id);assert.equal(result.current.sessionId,f.old);assert.equal(result.current.cwd,f.other);assert.equal(result.requiresBinding,true);
  assert.deepEqual(result.candidates,[{id:f.target,cwd:f.root,createdAt:123}]);assert.equal(result.workspaces.length,2);
  assert.equal(f.calls.create,0);assert.equal(f.calls.attach,0);assert.equal(f.calls.save,0);assert.equal(fs.readFileSync(f.store.file('state.json'),'utf8'),before);
});

test('binding an existing grouped conversation preserves all data and audit state and retires only the old main',async t=>{
  const f=fixture(t);atomic(f.store.file('assistant/profile.json'),{name:'SYNTHETIC_PRIVATE_PROFILE'});atomic(f.store.file('assistant/companion.json'),{synthetic:'SYNTHETIC_PRIVATE_HISTORY'});
  const before=f.store.state(),profile=fs.readFileSync(f.store.file('assistant/profile.json'),'utf8'),companion=fs.readFileSync(f.store.file('assistant/companion.json'),'utf8');
  const result=await f.binding.bind({workspaceId:f.workspace.id,sessionId:f.target}),after=f.store.state();
  assert.equal(result.changed,true);assert.equal(after.sessionId,f.target);assert.deepEqual(after.retiredSessionIds,[f.old]);assert.equal(after.mainSessionBinding.workspaceId,f.workspace.id);assert.equal(after.mainSessionBinding.sessionId,f.target);assert.equal(after.mainSessionBinding.path,f.root);
  const {sessionId,mainSessionBinding,retiredSessionIds,...preserved}=after;const {sessionId:oldId,...expected}=before;assert.deepEqual(preserved,expected);
  assert.equal(fs.readFileSync(f.store.file('assistant/profile.json'),'utf8'),profile);assert.equal(fs.readFileSync(f.store.file('assistant/companion.json'),'utf8'),companion);
  assert.equal(f.calls.create,0);assert.equal(f.calls.attach,0);assert.equal(f.calls.save,1);
  const raw=fs.readFileSync(f.store.file('state.json'),'utf8'),again=await f.binding.bind({workspaceId:f.workspace.id,sessionId:f.target});
  assert.equal(again.changed,false);assert.equal(f.calls.save,1);assert.equal(again.binding.boundAt,mainSessionBinding.boundAt);assert.equal(fs.readFileSync(f.store.file('state.json'),'utf8'),raw);
  assert.equal((await f.binding.snapshot()).requiresBinding,false);
});

test('a previously retired valid target is removed from retirement when explicitly selected as the main',async t=>{
  const f=fixture(t);f.store.saveState({...f.store.state(),retiredSessionIds:[f.target,'synthetic-older']});
  await f.binding.bind({workspaceId:f.workspace.id,sessionId:f.target});
  assert.deepEqual(f.store.state().retiredSessionIds,['synthetic-older',f.old]);
});

test('same-directory loose sessions can be attached in place without calling session creation',async t=>{
  const f=fixture(t);f.headers.set(f.old,f.header(f.old));
  assert.equal((await f.binding.snapshot()).requiresBinding,false);
  const result=await f.binding.ensureAttached(f.old);assert.equal(result.grouped,true);assert.equal(result.sessionId,f.old);assert.equal(result.workspaceId,f.workspace.id);
  assert.equal(f.store.state().sessionId,f.old);assert.equal(f.calls.attach,1);assert.equal(f.calls.create,0);assert.equal(f.calls.save,0);
  await f.binding.ensureAttached(f.old);assert.equal(f.calls.attach,1);
});

test('cross-directory old main cannot be falsely moved or replaced by ensureAttached',async t=>{
  const f=fixture(t),before=f.store.state();
  await assert.rejects(()=>f.binding.ensureAttached(f.old),/选择.*已有会话/);
  assert.deepEqual(f.store.state(),before);assert.equal(f.calls.attach,0);assert.equal(f.calls.create,0);
});

test('new-session placement registers or resolves the data-root group and never creates a conversation',async t=>{
  const f=fixture(t);
  assert.deepEqual(await f.binding.creationLocation(),{workspaceId:f.workspace.id,cwd:f.root});assert.equal(f.calls.create,0);
  f.workspaces.clear();const first=await f.binding.creationLocation(),again=await f.binding.creationLocation();
  assert.equal(first.cwd,f.root);assert.deepEqual(first,again);assert.equal(f.calls.create,1);assert.equal(f.calls.attach,0);assert.equal(f.store.state().sessionId,f.old);
});

test('confirmed returned identity saves only binding after the scheduler adopts that identity',async t=>{
  const f=fixture(t),before=f.store.state();
  await assert.rejects(()=>f.binding.confirmCreated(f.target,f.workspace.id),/尚未采用/);assert.deepEqual(f.store.state(),before);
  f.store.saveState({...before,sessionId:f.target,sessionCreation:{id:'synthetic-pending'}});
  const expected=f.store.state(),binding=await f.binding.confirmCreated(f.target,f.workspace.id),after=f.store.state();
  assert.equal(binding.sessionId,f.target);assert.deepEqual(after,{...expected,mainSessionBinding:binding});assert.equal(f.calls.create,0);
  const saves=f.calls.save;await f.binding.confirmCreated(f.target,f.workspace.id);assert.equal(f.calls.save,saves);
});

test('explicit native workspace placement survives a different assistant data root',async t=>{
  const f=fixture(t),otherWorkspace=f.entity('synthetic-explicit-group',f.other,[f.old]);f.workspaces.set(otherWorkspace.id,otherWorkspace);
  f.store.saveState({...f.store.state(),mainSessionBinding:{workspaceId:otherWorkspace.id,sessionId:f.old,path:f.other,boundAt:10}});
  assert.deepEqual(await f.binding.creationLocation(),{workspaceId:otherWorkspace.id,cwd:f.other});
  assert.equal((await f.binding.snapshot()).selectedWorkspaceId,otherWorkspace.id);assert.equal((await f.binding.snapshot()).requiresBinding,false);
});

test('malformed requests, non-members and invalid or delegated headers cannot become a main',async t=>{
  const f=fixture(t),before=f.store.state();
  for(const value of [null,[],{}, {workspaceId:f.workspace.id,sessionId:f.target,enabled:true},{workspaceId:'missing',sessionId:f.target},{workspaceId:f.workspace.id,sessionId:'outside'}])await assert.rejects(()=>f.binding.bind(value));
  for(const extra of [{isSeeded:true},{origin:'subagent'},{parentSession:'synthetic-parent'},{isSeeded:'false'},{delegationDepth:1},{id:'different-id'},{cwd:f.other}]){
    f.headers.set(f.target,f.header(f.target,f.root,extra));await assert.rejects(()=>f.binding.bind({workspaceId:f.workspace.id,sessionId:f.target}));
  }
  assert.deepEqual(f.store.state(),before);assert.equal(f.calls.save,0);assert.equal(f.calls.create,0);
});

test('snapshot excludes seeded, delegated, archived and cwd-mismatched members',async t=>{
  const f=fixture(t);
  for(const [id,extra] of [['synthetic-seeded',{isSeeded:true}],['synthetic-child',{origin:'subagent'}],['synthetic-wrong-cwd',{cwd:f.other}],['synthetic-archived',{}]]){f.workspace.sessionIds.push(id);f.headers.set(id,f.header(id,f.root,extra));}
  f.registry.archivedSessionIds.push('synthetic-archived');
  assert.deepEqual((await f.binding.snapshot()).candidates.map(item=>item.id),[f.target]);
});

test('running roots, live owned descendants and unresolved assistant operations refuse a rebind without stopping work',async t=>{
  const f=fixture(t),input={workspaceId:f.workspace.id,sessionId:f.target},base=f.store.state();
  for(const agent of f.agents){agent.status='running';await assert.rejects(()=>f.binding.bind(input),/仍在运行/);agent.status='idle';}
  const child={id:'synthetic-running-child',session:{id:'synthetic-running-child'},status:'running'};f.agents.push(child);f.owners.set(child,f.agents[0]);
  await assert.rejects(()=>f.binding.bind(input),/子任务.*运行/);f.agents.pop();f.owners.delete(child);
  for(const flag of ['activeRun','dispatchPending','sessionCreation','inflight','companionChatPending']){
    f.store.saveState({...base,[flag]:true});const before=f.store.state();await assert.rejects(()=>f.binding.bind(input),/未确认/);assert.deepEqual(f.store.state(),before);
  }
  assert.equal(f.calls.create,0);assert.equal(f.calls.attach,0);
});

test('runtime-owned targets and missing runtime verification cannot be adopted even with ordinary-looking headers',async t=>{
  const f=fixture(t),input={workspaceId:f.workspace.id,sessionId:f.target};f.owners.set(f.agents[1],f.agents[0]);
  await assert.rejects(()=>f.binding.bind(input),/不匹配/);assert.deepEqual((await f.binding.snapshot()).candidates,[]);f.owners.clear();
  await assert.rejects(()=>new SessionBinding({...f.options,getAgents:()=>null}).bind(input),/运行状态尚未就绪/);
});

test('unavailable grouping preserves an existing main but cannot create an ungrouped replacement',async t=>{
  const f=fixture(t),binding=new SessionBinding({...f.options,getRegistry:()=>null});
  const result=await binding.snapshot();assert.equal(result.available,false);assert.equal(result.requiresBinding,false);assert.deepEqual(result.workspaces,[]);assert.deepEqual(result.candidates,[]);
  assert.deepEqual(await binding.ensureAttached(f.old),{available:false,grouped:false,sessionId:f.old,note:'宿主工作区分组服务尚未就绪，继续使用原主会话；未创建新会话。'});
  await assert.rejects(()=>binding.creationLocation(),/尚未就绪/);assert.equal(f.store.state().sessionId,f.old);
});

test('metadata faults and a changed main during validation fail without adopting stale selections',async t=>{
  const f=fixture(t),input={workspaceId:f.workspace.id,sessionId:f.target},base=f.store.state(),stat=f.persistence.stat;
  f.persistence.stat=async()=>{throw Error('Synthetic storage failure');};await assert.rejects(()=>f.binding.bind(input),/无法读取/);assert.deepEqual(f.store.state(),base);
  f.persistence.stat=async id=>{const metadata=await stat(id);f.store.saveState({...f.store.state(),sessionId:'synthetic-concurrent-main'});return metadata;};
  await assert.rejects(()=>f.binding.bind(input),/已经变化/);assert.equal(f.store.state().sessionId,'synthetic-concurrent-main');
});

test('a fresh missing data directory stays absent during snapshot and is initialized only for explicit creation placement',async t=>{
  const f=fixture(t),fresh=path.join(f.home,'fresh-data'),store=new Store(fresh,{home:f.home});
  const binding=new SessionBinding({...f.options,store});
  const snapshot=await binding.snapshot();
  assert.equal(snapshot.available,true);assert.equal(snapshot.current.sessionId,null);assert.equal(snapshot.selectedWorkspaceId,null);assert.equal(snapshot.requiresBinding,false);assert.deepEqual(snapshot.candidates,[]);assert.equal(fs.existsSync(fresh),false);
  const location=await binding.creationLocation();assert.equal(location.cwd,fresh);assert.equal(fs.statSync(fresh).isDirectory(),true);assert.equal(f.calls.create,1);assert.equal(f.calls.attach,0);
  assert.deepEqual(await binding.creationLocation(),location);assert.equal(f.calls.create,1);assert.equal(store.state().sessionId,undefined);
});

test('a missing previously existing root is not silently recreated as a fresh install',async t=>{
  const f=fixture(t),relative=path.relative(f.home,f.root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(f.root,{recursive:true,force:true});
  await assert.rejects(()=>f.binding.creationLocation(),/目录不可用/);assert.equal(fs.existsSync(f.root),false);assert.equal(f.calls.create,0);
});

test('an unrelated offline workspace does not prevent selecting the valid default group',async t=>{
  const f=fixture(t);f.workspaces.set('synthetic-offline',f.entity('synthetic-offline',path.join(f.home,'offline-directory')));
  const snapshot=await f.binding.snapshot();assert.equal(snapshot.available,true);assert.equal(snapshot.selectedWorkspaceId,f.workspace.id);assert.deepEqual(snapshot.candidates.map(item=>item.id),[f.target]);
  await assert.rejects(()=>f.binding.snapshot('synthetic-offline'),/目录不可用/);
  assert.equal(f.calls.create,0);assert.equal(f.calls.save,0);
});

test('a directory resolver miss falls back to canonical membership without registering a duplicate group',async t=>{
  const f=fixture(t),alias=path.join(f.home,'synthetic-data-alias');
  fs.symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
  f.workspace.path=alias;
  f.workspaces.clear();f.workspaces.set('synthetic-offline',f.entity('synthetic-offline',path.join(f.home,'offline-directory')));f.workspaces.set(f.workspace.id,f.workspace);
  f.registry.resolveByPath=async()=>undefined;
  const snapshot=await f.binding.snapshot();
  assert.equal(snapshot.selectedWorkspaceId,f.workspace.id);assert.deepEqual(snapshot.candidates.map(item=>item.id),[f.target]);
  assert.deepEqual(await f.binding.creationLocation(),{workspaceId:f.workspace.id,cwd:fs.realpathSync.native(f.root)});assert.equal(f.calls.create,0);
  f.registry.resolveByPath=undefined;
  assert.equal((await f.binding.snapshot()).selectedWorkspaceId,f.workspace.id);assert.equal(f.calls.create,0);
  const wrong=f.entity('synthetic-wrong-resolver-result',f.other);f.workspaces.set(wrong.id,wrong);f.registry.resolveByPath=async()=>wrong;
  await assert.rejects(()=>f.binding.snapshot(),/不同|不匹配/);await assert.rejects(()=>f.binding.creationLocation(),/不同|不匹配/);assert.equal(f.calls.create,0);
});
