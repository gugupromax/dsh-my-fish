import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import plugin from '../lib/index.js';
import {Store} from '../lib/store.js';

function fixture(t,{fresh=false}={}){
  const temporaryParent=fs.realpathSync.native(os.tmpdir());
  const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-native-binding-wiring-'))),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
  const store=new Store();fs.mkdirSync(store.file('workspace'),{recursive:true});store.saveState({...store.state(),sessionId:fresh?null:'synthetic-loose-main'});
  const live=new Map(),headers=new Map(),calls={create:[],prompt:[],attach:[]},effects=[],routes=new Map(),tools=new Map(),guards=[];
  const group={id:'synthetic-workspace',title:'Synthetic group',path:store.root,sessionIds:fresh?[]:['synthetic-existing-main'],attachSession:async id=>{calls.attach.push(id);if(!group.sessionIds.includes(id))group.sessionIds.push(id);}};
  for(const [id,cwd] of [['synthetic-loose-main',store.file('workspace')],['synthetic-existing-main',store.root]]){const header={id,cwd,isSeeded:false,createdAt:1};headers.set(id,header);live.set(id,{id,header});}
  const services={
    sessions:{get:id=>live.get(id)},sessionPersistence:{stat:async id=>headers.has(id)?{header:headers.get(id),revision:'synthetic-revision'}:undefined},
    agents:{list:()=>[],isOwnedBy:()=>false},workspaceRegistry:{list:()=>[group],get:id=>id===group.id?group:undefined,resolveByPath:async cwd=>(await fs.promises.realpath(cwd))===(await fs.promises.realpath(group.path))?group:undefined,archivedSessionIds:[]},
  };
  const ctx={
    sessionController:{create:async request=>{calls.create.push(request);assert.equal(request.workspaceId,group.id);assert.equal(Object.hasOwn(request,'cwd'),false);const sessionId='synthetic-actual-returned-id',header={id:sessionId,cwd:group.path,isSeeded:false,createdAt:2};headers.set(sessionId,header);live.set(sessionId,{id:sessionId,header});group.sessionIds.push(sessionId);return {sessionId};},prompt:async request=>{calls.prompt.push(request);}},
    connection:{requestRejection:()=>undefined},logger:{warn:()=>{}},
    tools:{register:definition=>{tools.set(definition.name,definition);return ()=>tools.delete(definition.name);},guard:callback=>{guards.push(callback);return ()=>{};}},
    webServer:{register:row=>{routes.set(row.path,row.handler);return ()=>routes.delete(row.path);}},
    inject:(names,callback)=>{if(names.every(name=>services[name]))callback({...Object.fromEntries(names.map(name=>[name,services[name]])),effect:fn=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);}});},
    effect:fn=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);},
  };plugin.apply(ctx);
  t.after(()=>{for(const dispose of effects.reverse())dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert.equal(path.dirname(path.resolve(home)),temporaryParent);fs.rmSync(home,{recursive:true,force:true});});
  async function http(prefix,method,route,body,headers={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url=prefix+'/'+route;req.socket={remoteAddress:'127.0.0.1'};
    req.headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json',...headers};
    const res={statusCode:0,setHeader(){},end(text){this.body=JSON.parse(text);}};await routes.get(prefix)(req,res);return {status:res.statusCode,body:res.body};
  }return {store,group,calls,http,guards,tools};
}

test('all trusted chat entries reuse the selected existing grouped conversation without creating another',async t=>{
  const f=fixture(t),before=f.store.state();
  for(const prefix of ['/my-fish/api','/x-whale/api']){
    const snapshot=await f.http(prefix,'GET','session-binding');assert.equal(snapshot.status,200);assert.equal(snapshot.body.requiresBinding,true);assert.equal(snapshot.body.candidates[0].id,'synthetic-existing-main');
    assert.equal((await f.http(prefix,'POST','session',{})).status,400);assert.equal(f.calls.create.length,0);
  }
  assert.equal((await f.http('/my-fish/api','POST','session/bind',{workspaceId:f.group.id,sessionId:'synthetic-existing-main'},{origin:'https://outside.invalid'})).status,403);
  for(const body of [null,{},[],{workspaceId:f.group.id,sessionId:'synthetic-existing-main',enabled:true}])assert.equal((await f.http('/my-fish/api','POST','session/bind',body)).status,400);
  const bound=await f.http('/x-whale/api','POST','session/bind',{workspaceId:f.group.id,sessionId:'synthetic-existing-main'});assert.equal(bound.status,200);assert.equal(bound.body.sessionId,'synthetic-existing-main');
  for(const prefix of ['/my-fish/api','/x-whale/api']){
    for(let i=0;i<2;i++){const opened=await f.http(prefix,'POST','session',{});assert.equal(opened.body.sessionId,'synthetic-existing-main');assert.equal(opened.body.created,false);}
    const chatted=await f.http(prefix,'POST','companion/chat',{requestId:'synthetic-fixed-chat-'+prefix.includes('x-whale')});assert.equal(chatted.status,200);assert.equal(chatted.body.sessionId,'synthetic-existing-main');
  }
  assert.equal(f.calls.create.length,0);assert.equal(f.calls.prompt.length,2);assert.ok(f.calls.prompt.every(row=>row.sessionId==='synthetic-existing-main'));
  assert.equal(f.store.state().mainSessionBinding.workspaceId,f.group.id);assert.equal(f.store.state().runs&&JSON.stringify(f.store.state().runs),JSON.stringify(before.runs));
  assert.match(f.guards[0]({name:'web_search',arguments:{},agent:{id:'synthetic-loose-main'}}),/失效/);
});

test('first explicit initialization passes a native workspace ID and persists the actual returned main ID',async t=>{
  const f=fixture(t,{fresh:true});
  const first=await f.http('/my-fish/api','POST','session',{});assert.equal(first.status,200);assert.equal(first.body.sessionId,'synthetic-actual-returned-id');assert.equal(first.body.created,true);
  assert.equal(f.calls.create.length,1);assert.ok(f.group.sessionIds.includes(first.body.sessionId));assert.equal(f.store.state().mainSessionBinding.sessionId,first.body.sessionId);
  const second=await f.http('/x-whale/api','POST','session',{});assert.equal(second.body.sessionId,first.body.sessionId);assert.equal(second.body.created,false);assert.equal(f.calls.create.length,1);assert.equal(f.calls.prompt.length,0);
});
