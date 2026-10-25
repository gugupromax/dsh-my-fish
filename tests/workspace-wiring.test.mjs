import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import plugin from '../lib/index.js';
import {Store,DEFAULTS} from '../lib/store.js';

function fixture(t,options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-workspace-wiring-')),home=path.join(root,'isolated-home'),source=path.join(home,'my-fish'),target=path.join(root,'selected-data');
  fs.mkdirSync(path.join(source,'workspace'),{recursive:true});
  fs.writeFileSync(path.join(source,'workspace','example.txt'),'synthetic work file');
  fs.writeFileSync(path.join(source,'credentials.json'),JSON.stringify({codec:'dpapi',data:'SYNTHETIC_ENCRYPTED_BYTES_NOT_A_REAL_SECRET'}));
  const store=new Store(source,{home});store.saveConfig({...DEFAULTS,name:'Synthetic Fish'});
  const sessionId='synthetic-existing-main';store.saveState({...store.state(),sessionId});
  const main={id:sessionId,status:options.running?'running':'idle',session:{id:sessionId,header:Object.freeze({id:sessionId,cwd:path.join(source,'workspace')}),effectiveCwd:path.join(source,'workspace')}};
  const rows=[main],ownership=new Map(),routes=[],tools=new Map(),guards=[],events=new Map(),cleanup=[],calls={create:0,prompt:0,resolve:0,maintenance:0,set:[]};
  let maintenance=false,held=false;
  const setEntered=Promise.withResolvers(),releaseSet=Promise.withResolvers();
  main.runMaintenance=job=>{
    if(maintenance||main.status==='running')throw Error('synthetic agent already has active work');
    maintenance=true;calls.maintenance++;
    return Promise.resolve().then(()=>job(new AbortController().signal)).finally(()=>{maintenance=false;});
  };
  main.whenIdle=()=>{throw Error('creation reconciliation must never await whenIdle');};
  const registry={list:()=>rows,isOwnedBy:(id,owner)=>rows.some(agent=>agent.id===id&&ownership.get(agent)===owner)};
  const workingDirectory={get:session=>session.effectiveCwd,set:async(agent,destination,signal)=>{
    signal?.throwIfAborted();calls.set.push({agent,destination,maintenance});
    if(options.holdSet&&!held){held=true;setEntered.resolve();await releaseSet.promise;}
    if(options.failSet)throw Error('synthetic directory switch failed');
    agent.session.effectiveCwd=destination;return destination;
  }};
  const previousHome=process.env.DSH_HOME;process.env.DSH_HOME=home;
  t.after(()=>{
    releaseSet.resolve();for(const dispose of cleanup.reverse())if(typeof dispose==='function')dispose();
    if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
    fs.rmSync(root,{recursive:true,force:true});
  });
  const services={agents:registry,...(options.noDirectoryService?{}:{workingDirectory})};
  plugin.apply({
    sessionController:{resolveAgent:async id=>{calls.resolve++;assert.equal(id,sessionId);return {agent:main};},create:async()=>{calls.create++;throw Error('must retain the existing session');},prompt:async()=>{calls.prompt++;throw Error('a migration must not prompt a model');}},
    connection:{requestRejection:()=>undefined},
    tools:{register:definition=>{tools.set(definition.name,definition);return ()=>tools.delete(definition.name);},guard:guard=>{guards.push(guard);return ()=>{};}},
    webServer:{register:definition=>{routes.push(definition);return ()=>{};}},
    inject:(names,callback)=>{if(names.every(name=>services[name]))callback({...services,effect:effect=>cleanup.push(effect())});},
    on:(name,listener)=>{const entries=events.get(name)||[];entries.push(listener);events.set(name,entries);return ()=>{};},
    effect:effect=>cleanup.push(effect()),logger:{warn:()=>{}},
  });
  async function dispatch(method,endpoint,body,options={}) {
    const url=(options.legacy?'/x-whale/api/':'/my-fish/api/')+endpoint;
    const route=routes.find(row=>url.startsWith(row.path+'/'));
    const request=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(request,{method,url,socket:{remoteAddress:options.remoteAddress||'127.0.0.1'},headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json',...options.headers}});
    let value;const response={statusCode:0,setHeader:()=>{},end:text=>{value={status:response.statusCode,data:JSON.parse(text)};}};
    await route.handler(request,response);return value;
  }
  const emit=async(name,value)=>{for(const listener of events.get(name)||[])await listener(value);};
  return {root,home,source,target,store,sessionId,main,rows,ownership,calls,guards,tools,dispatch,emit,setEntered,releaseSet,options};
}

test('workspace API enforces trusted origin for both route names and reports the real isolated data path',async t=>{
  const f=fixture(t);
  for(const legacy of [false,true]){
    assert.equal((await f.dispatch('GET','workspace',undefined,{legacy,remoteAddress:'192.0.2.1'})).status,403);
    assert.equal((await f.dispatch('POST','workspace',{path:f.target},{legacy,headers:{origin:'https://untrusted.example'}})).status,403);
    const response=await f.dispatch('GET','workspace',undefined,{legacy});
    assert.equal(response.status,200);assert.equal(response.data.path,f.source);assert.equal(response.data.workingDirectory,path.join(f.source,'workspace'));
    assert.equal(response.data.canMigrate,true);assert.equal(response.data.permissionBoundaryUnchanged,true);
    assert.equal(JSON.stringify(response).includes('SYNTHETIC_ENCRYPTED_BYTES'),false);
  }
  assert.equal(fs.existsSync(f.target),false);assert.equal(f.calls.resolve,0);
});

test('workspace API migrates full synthetic data while preserving the session and leaving subsequent serialized operations usable',async t=>{
  const f=fixture(t);
  const memory=await f.dispatch('POST','assistant/memory',{text:'synthetic preference',category:'preference',source:'synthetic fixture'});
  assert.equal(memory.status,200);
  const originalCredential=fs.readFileSync(path.join(f.source,'credentials.json'),'utf8'),originalHeader=f.main.session.header;
  const response=await f.dispatch('POST','workspace',{path:f.target});
  assert.equal(response.status,200,response.data.error);assert.equal(response.data.path,f.target);assert.equal(response.data.workingDirectory,path.join(f.target,'workspace'));
  assert.equal(response.data.permissionBoundaryUnchanged,true);assert.equal(f.calls.maintenance,1);assert.equal(f.calls.set[0].maintenance,true);
  assert.equal(f.calls.create,0);assert.equal(f.calls.prompt,0);assert.equal(f.main.session.header,originalHeader);
  assert.equal(fs.readFileSync(path.join(f.target,'credentials.json'),'utf8'),originalCredential);
  assert.equal(fs.readFileSync(path.join(f.target,'workspace','example.txt'),'utf8'),'synthetic work file');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target,'state.json'),'utf8')).sessionId,f.sessionId);
  assert.ok(fs.existsSync(f.source),'source remains a rollback copy');
  assert.equal(new Store(undefined,{home:f.home}).root,f.target,'a future instance follows the durable locator');
  assert.equal((await f.dispatch('GET','assistant')).data.memories[0].id,memory.data.memory.id);
  assert.equal(fs.existsSync(path.join(f.target,'.operation.lock')),false,'the active engine lock must not become a permanent destination lock');
  const save=await f.dispatch('POST','config',{...DEFAULTS,name:'After migration'});
  assert.equal(save.status,200,save.data.error);
  assert.equal((await f.dispatch('GET','state')).data.sessionId,f.sessionId);
});

test('active personal agents, runtime-owned children and missing directory services refuse before copying',async t=>{
  for(const mode of ['main-running','child-running','missing-service','missing-maintenance']){
    await t.test(mode,async t=>{
      const f=fixture(t,{running:mode==='main-running',noDirectoryService:mode==='missing-service'});
      if(mode==='missing-maintenance')delete f.main.runMaintenance;
      if(mode==='child-running'){const child={id:'synthetic-child',status:'running',session:{id:'synthetic-child'}};f.rows.push(child);f.ownership.set(child,f.main);}
      const status=await f.dispatch('GET','workspace');assert.equal(status.data.canMigrate,false);
      const response=await f.dispatch('POST','workspace',{path:f.target});assert.equal(response.status,400);assert.equal(fs.existsSync(f.target),false);
      assert.equal(f.calls.maintenance,0);assert.equal(f.calls.set.length,0);assert.equal((await f.dispatch('GET','workspace')).data.path,f.source);
    });
  }
});

test('the whole settings and tool surface refuses writes while a maintenance-held migration switches cwd',async t=>{
  const f=fixture(t,{holdSet:true});
  const migration=f.dispatch('POST','workspace',{path:f.target});
  try{
    await Promise.race([f.setEntered.promise,migration.then(result=>{throw Error('Migration ended before its directory switch: '+JSON.stringify(result));})]);
    const status=await f.dispatch('GET','workspace');assert.equal(status.data.migrating,true);assert.equal(status.data.canMigrate,false);
    for(const [endpoint,body] of [['assistant/profile',{name:'must not save'}],['permissions',{shell:true}],['credentials',{auth_token:'synthetic-value',ct0:'synthetic-value'}],['workspace',{path:path.join(f.root,'second')}],['session',{}]]){
      assert.equal((await f.dispatch('POST',endpoint,body)).status,409,endpoint);
    }
    await assert.rejects(()=>f.tools.get('assistant_context').execute({},{agent:f.main,signal:new AbortController().signal}),/迁移/);
    assert.match(f.guards[0]({name:'read',arguments:{},agent:f.main}),/迁移/);
    assert.equal(f.guards[0]({name:'read',arguments:{},agent:{id:'ordinary',session:{id:'ordinary'}}}),undefined,'unrelated host chats keep their own policy');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.source,'config.json'),'utf8')).name,'Synthetic Fish');
  }finally{f.releaseSet.resolve();}
  const result=await migration;assert.equal(result.status,200,result.data.error);
  assert.equal(f.calls.create,0);assert.equal(f.calls.prompt,0);
});

test('resumed main agents follow the migrated managed cwd directly without changing a deliberate unrelated cd',async t=>{
  const f=fixture(t);
  const moved=await f.dispatch('POST','workspace',{path:f.target});assert.equal(moved.status,200,moved.data.error);
  const session={id:f.sessionId,header:Object.freeze({id:f.sessionId,cwd:path.join(f.source,'workspace')}),effectiveCwd:path.join(f.source,'workspace')};
  const resumed={id:f.sessionId,status:'idle',session,whenIdle:()=>{throw Error('must not await creation');},runMaintenance:()=>{throw Error('must not nest creation maintenance');}};
  f.rows.splice(0,f.rows.length,resumed);
  const previousSets=f.calls.set.length;await f.emit('agent/created',{agent:resumed});
  assert.equal(f.calls.set.length,previousSets+1);assert.equal(session.effectiveCwd,path.join(f.target,'workspace'));assert.equal(session.header.cwd,path.join(f.source,'workspace'));
  session.effectiveCwd=path.join(f.root,'deliberate-other-directory');
  await f.emit('agent/created',{agent:resumed});assert.equal(f.calls.set.length,previousSets+1,'unrelated explicit directory changes are respected');
  await f.emit('agent/created',{agent:{id:'ordinary',session:{id:'ordinary',effectiveCwd:path.join(f.source,'workspace')}}});
  assert.equal(f.calls.set.length,previousSets+1);
});

test('a pending rollback blocks further personal writes and retries recovery after the directory service returns',async t=>{
  const f=fixture(t,{failSet:true});
  const failed=await f.dispatch('POST','workspace',{path:f.target});
  assert.equal(failed.status,400);assert.match(failed.data.error,/恢复事务|回滚/);
  const pending=await f.dispatch('GET','workspace');
  assert.equal(pending.status,200);assert.equal(pending.data.pendingRecovery,true);assert.equal(pending.data.canMigrate,false,'an unresolved rollback must never offer another migration');
  const save=await f.dispatch('POST','assistant/profile',{name:'must not save during recovery'});
  assert.notEqual(save.status,200,'personal writes must stop until the pending transaction is reconciled');
  await assert.rejects(()=>f.tools.get('assistant_context').execute({},{agent:f.main,signal:new AbortController().signal}),/恢复|directory switch/);
  f.options.failSet=false;
  const recovered=await f.dispatch('GET','workspace');
  assert.equal(recovered.status,200);assert.equal(recovered.data.pendingRecovery,false);assert.equal(recovered.data.canMigrate,true);
  assert.equal(recovered.data.path,f.source);assert.equal(f.main.session.effectiveCwd,path.join(f.source,'workspace'));
  assert.equal((await f.dispatch('POST','assistant/profile',{name:'After recovery'})).status,200);
});
