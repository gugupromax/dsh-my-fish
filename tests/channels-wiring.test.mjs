import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import plugin from '../lib/index.js';
import {Store,DEFAULTS} from '../lib/store.js';

function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-channels-wiring-')),previous=process.env.DSH_HOME,previousFetch=globalThis.fetch;
  process.env.DSH_HOME=home;const store=new Store(),main={id:'synthetic-main',session:{id:'synthetic-main'}},ordinary={id:'synthetic-ordinary',session:{id:'synthetic-ordinary'}};
  store.saveConfig({...DEFAULTS,aiUsername:'fixture_ai'});store.saveState({...store.state(),sessionId:main.id});
  const definitions=new Map(),routes=new Map(),services=new Map(),effects=[],guards=[],calls={fetch:0};
  globalThis.fetch=async()=>{calls.fetch++;throw Error('Unexpected external request in integration fixture');};
  plugin.apply({sessionController:{},connection:{requestRejection:()=>undefined},
    tools:{register:def=>{definitions.set(def.name,def);return()=>definitions.delete(def.name);},get:(name)=>definitions.get(name),guard:fn=>{guards.push(fn);return()=>{};}},
    webServer:{register:def=>{routes.set(def.path,def.handler);return()=>routes.delete(def.path);}},
    provide:(name,value)=>services.set(name,value),inject:()=>{},on:()=>{},effect:fn=>effects.push(fn()),logger:{warn:()=>{}}
  });
  t.after(()=>{for(const cleanup of effects.reverse())cleanup?.();globalThis.fetch=previousFetch;if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert.equal(path.dirname(path.resolve(home)),path.resolve(os.tmpdir()));fs.rmSync(home,{recursive:true,force:true});});
  async function request(prefix,method,route,body,origin='http://127.0.0.1:3000'){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url:prefix+'/'+route,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000',origin,'content-type':'application/json'}});
    let result;const res={statusCode:0,setHeader:()=>{},end:text=>{result={status:res.statusCode,value:JSON.parse(text)};}};await routes.get(prefix)(req,res);return result;
  }
  const execute=(name,args,agent=main)=>definitions.get(name).execute(args,{agent,token:Symbol('synthetic-parent'),callId:'synthetic-outer',signal:new AbortController().signal});
  return {store,main,ordinary,definitions,services,calls,guards,request,execute};
}

test('both trusted API aliases expose X and Bilibili metadata without issuing platform requests',async t=>{
  const f=fixture(t);
  for(const prefix of ['/my-fish/api','/x-whale/api']){
    const response=await f.request(prefix,'GET','channels');assert.equal(response.status,200);assert.equal(response.value.ok,true);
    assert.deepEqual(response.value.platforms.map(row=>row.id),['x','bilibili']);
    const bili=response.value.platforms.find(row=>row.id==='bilibili');assert.equal(bili.accountRequired,false);assert.equal(bili.implemented,true);assert.equal(bili.currentSessionVisible,null);
    for(const action of Object.values(bili.actions)){assert.equal(action.supported,false);assert.equal(action.enabled,false);}
    assert.equal((await f.request(prefix,'GET','channels',undefined,'https://untrusted.invalid')).status,403);
  }
  assert.equal(f.calls.fetch,0);
});

test('trusted provider registration adds a future channel without adding a model registration tool or HTTP endpoint',async t=>{
  const f=fixture(t),service=f.services.get('myFishChannels');assert.equal(service.version,1);let reads=0;
  const provider={id:'fixture-news',name:'Synthetic News',capabilities:()=>({installed:true,implemented:true,available:true,configured:true,accountRequired:false,connection:{state:'unchecked'},reads:['read'],actions:{},scope:'synthetic public excerpt'}),read:async({reference})=>{reads++;return {source:'synthetic',data:{id:reference,text:'public fixture'}};}};
  const remove=service.register(provider);assert.ok(service.catalog().platforms.some(row=>row.id==='fixture-news'));
  const result=await f.execute('social_read',{platform:'fixture-news',reference:'fixture-item'});assert.equal(reads,1);assert.equal(result.platform,'fixture-news');assert.equal(result.data.id,'fixture-item');
  assert.equal((await f.request('/my-fish/api','POST','channels/register',{})).status,404);
  assert.equal([...f.definitions.keys()].some(name=>/register/.test(name)),false);
  remove();assert.equal(service.catalog().platforms.some(row=>row.id==='fixture-news'),false);
});

test('unknown channels and unsupported Bilibili writes never enter a provider or network request',async t=>{
  const f=fixture(t);
  for(const [name,args] of [
    ['social_search',{platform:'unregistered',query:'public'}],
    ['social_action',{platform:'bilibili',action:'bookmark',reference:'BV1GJ411x7h7',reason:'synthetic reason'}],
    ['social_timeline',{platform:'bilibili'}],
    ['social_comments',{platform:'x',reference:'123456'}],
  ])await assert.rejects(()=>f.execute(name,args));
  await assert.rejects(()=>f.execute('social_action',{platform:'x',action:'reply',reference:'123456',text:'test',reason:'synthetic'},f.ordinary),/专用/);
  assert.equal(f.calls.fetch,0);
});

test('new read tools remain available under the personal guard while private query material is stopped before dispatch',async t=>{
  const f=fixture(t);
  await f.request('/my-fish/api','POST','permissions',{privateTerms:['SYNTHETIC PRIVATE QUERY']});
  for(const name of ['social_comments','social_timeline'])assert.equal(f.guards[0]({name,arguments:{platform:'bilibili'},agent:f.main}),undefined);
  await assert.rejects(()=>f.execute('social_read',{platform:'bilibili',reference:'SYNTHETIC PRIVATE QUERY'}),/私密词/);
  await assert.rejects(()=>f.execute('social_comments',{platform:'bilibili',reference:'https://example.invalid/?token=synthetic-secret'}),/凭据/);
  assert.equal(f.calls.fetch,0);
});
