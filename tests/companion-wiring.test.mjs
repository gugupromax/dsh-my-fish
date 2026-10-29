import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import plugin from '../lib/index.js';
import {Store} from '../lib/store.js';
import {CompanionStore} from '../lib/companion-store.js';

function fixture(t,{fetchImpl}={}){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-companion-wiring-')),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
  const store=new Store();store.saveState({...store.state(),sessionId:'synthetic-main'});
  const companion=new CompanionStore(store),tools=new Map(),routes=new Map(),listeners=new Map(),effects=[],requests=[];
  const main={id:'synthetic-main-agent',session:{id:'synthetic-main'},status:'idle'},outside={id:'synthetic-outside',session:{id:'synthetic-outside'}};
  const services={sessions:{get:id=>({id})},agents:{list:()=>[main,outside],isOwnedBy:()=>false}};
  const emit=(name,...args)=>{for(const handler of listeners.get(name)||[])handler(...args);};
  const ctx={
    sessionController:{create:async()=>{throw Error('Should reuse the main conversation');},prompt:async request=>{requests.push(request);emit('session/event',main.session,{type:'user/message',time:Date.now(),data:{id:'program-'+requests.length,source:{kind:'user',rpcId:request.requestId},content:request.content}});}},
    connection:{requestRejection:()=>undefined},logger:{warn:()=>{}},
    tools:{register:definition=>{tools.set(definition.name,definition);return ()=>tools.delete(definition.name);},guard:()=>()=>{}},
    webServer:{register:row=>{routes.set(row.path,row.handler);return ()=>routes.delete(row.path);}},
    on:(name,handler)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(handler);return ()=>listeners.set(name,listeners.get(name).filter(value=>value!==handler));},
    inject:(names,callback)=>{if(names.every(name=>services[name]))callback({...Object.fromEntries(names.map(name=>[name,services[name]])),effect:fn=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);}});},
    effect:fn=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);},
  };
  const originalFetch=globalThis.fetch;
  try{if(fetchImpl)globalThis.fetch=fetchImpl;plugin.apply(ctx);}finally{globalThis.fetch=originalFetch;}
  t.after(()=>{for(const dispose of effects.reverse())dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert.equal(path.dirname(path.resolve(home)),path.resolve(os.tmpdir()));fs.rmSync(home,{recursive:true,force:true});});
  async function http(prefix,method,route,body,headers={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url=prefix+'/'+route;req.socket={remoteAddress:'127.0.0.1'};
    req.headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json',...headers};
    const res={statusCode:0,setHeader(){},end(text){this.body=JSON.parse(text);}};await routes.get(prefix)(req,res);return {status:res.statusCode,body:res.body};
  }
  const run=(args,agent=main)=>tools.get('assistant_companion').execute(args,{agent,signal:new AbortController().signal});
  return {store,companion,tools,requests,main,outside,emit,http,run};
}

test('companion routes are trusted aliases and reading the empty layer creates no role or false interests',async t=>{
  const f=fixture(t);assert.equal(f.tools.size,23);assert.equal(fs.existsSync(f.companion.file()),false);
  for(const prefix of ['/my-fish/api','/x-whale/api']){
    const value=await f.http(prefix,'GET','companion');assert.equal(value.status,200);assert.deepEqual(value.body.threads,[]);assert.equal(fs.existsSync(f.companion.file()),false);
    assert.equal((await f.http(prefix,'GET','companion',undefined,{origin:'https://outside.invalid'})).status,403);
    for(const body of [null,[],{},{id:'not-a-topic',status:'active',enabled:true}])assert.equal((await f.http(prefix,'POST','companion/topic',body)).status,400);
  }
  assert.equal(f.requests.length,0);assert.equal(fs.existsSync(f.store.file('assistant/profile.json')),false);
  await assert.rejects(()=>f.run({action:'start',title:'Unrelated test',openQuestion:'Not the main conversation'},f.outside),/专用个人/);
});

test('a real read receipt and live user quote support a continuing topic through tool and UI aliases',async t=>{
  const f=fixture(t),started=await f.run({action:'start',title:'Synthetic video idea',openQuestion:'Why do these explanations differ?'});
  const receipt=f.companion.addReceipt({platform:'bilibili',operation:'read',reference:'BV1GJ411x7h7',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic video metadata',excerpt:'Only the synthetic description was read.',scope:'Synthetic video metadata only; not watched.',truncated:false,sessionId:'synthetic-main'});
  const reflected=await f.run({action:'reflect',id:started.thread.id,thought:'A synthetic interpretation based on the description.',reason:'New description evidence',nextQuestion:'What do the comments disagree about?',receiptIds:[receipt.id]});
  assert.equal(reflected.thread.revision,1);assert.equal(reflected.thread.latestSources[0].id,receipt.id);
  f.emit('session/event',f.main.session,{type:'user/message',time:Date.now(),data:{id:'native-main-message',source:{kind:'user',rpcId:'native-main-rpc'},content:[{type:'text',text:'I disagree with this explanation.'}]}});
  await f.run({action:'respond',id:started.thread.id,messageId:'native-main-message',quote:'I disagree'});
  await assert.rejects(()=>f.run({action:'respond',id:started.thread.id,messageId:'native-main-message',quote:'An invented user preference'}),/原话/);
  assert.equal((await f.http('/my-fish/api','POST','companion/topic',{id:started.thread.id,status:'paused'})).status,200);
  assert.equal((await f.run({action:'list'})).otherThreads[0].status,'paused');
  await f.http('/x-whale/api','POST','companion/topic',{id:started.thread.id,status:'active'});
  const chat=await f.http('/my-fish/api','POST','companion/chat',{id:started.thread.id,requestId:'synthetic-topic-chat-request'});
  assert.equal(chat.status,200);assert.equal(chat.body.queued,true);assert.equal(f.requests.length,1);
  assert.equal(f.companion.snapshot().recentUserMessages.length,1,'The program-generated continuation is not a user opinion');
  assert.equal((await f.http('/x-whale/api','POST','companion/chat',{id:started.thread.id,requestId:'synthetic-topic-chat-request'})).status,200);assert.equal(f.requests.length,1);
  assert.equal(f.store.config().allowReplies,false);assert.equal(f.store.state().activeRun,undefined);
});

test('invalid video chat cannot send a prompt and forgetting a topic removes it without changing scheduling',async t=>{
  const f=fixture(t),before=f.store.config();
  assert.equal((await f.http('/my-fish/api','POST','companion/chat',{reference:'https://outside.invalid/video/BV1GJ411x7h7/',requestId:'synthetic-bad-reference'})).status,400);assert.equal(f.requests.length,0);
  const started=await f.run({action:'start',title:'Synthetic curiosity to forget',openQuestion:'A small open question'});
  assert.equal((await f.http('/x-whale/api','POST','companion/forget',{id:started.thread.id})).status,200);
  assert.deepEqual(f.companion.snapshot().threads,[]);assert.deepEqual(f.store.config(),before);
});

test('the actual guarded Bilibili facade mints usable evidence from its bounded synthetic transport',async t=>{
  const network=[];
  const f=fixture(t,{fetchImpl:async url=>{
    network.push(String(url));assert.equal(new URL(url).hostname,'api.bilibili.com');
    return new Response(JSON.stringify({code:0,data:{bvid:'BV1GJ411x7h7',aid:123456,title:'Synthetic public metadata',desc:'A synthetic description for a genuine adapter read.',owner:{mid:123,name:'Synthetic author'},stat:{view:1},duration:10,pubdate:1700000000}}),{headers:{'content-type':'application/json'}});
  }});
  const actual=await f.tools.get('social_read').execute({platform:'bilibili',reference:'https://www.bilibili.com/video/BV1GJ411x7h7/'},{agent:f.main,signal:new AbortController().signal});
  assert.equal(network.length,1);assert.equal(actual.companionReceipts.length,1);assert.match(actual.companionReceipts[0].scope,/未观看/);
  const started=await f.run({action:'start',title:'Synthetic bounded discussion',openQuestion:'What does this description suggest?'});
  const changed=await f.run({action:'reflect',id:started.thread.id,thought:'A synthetic interpretation of the read description.',reason:'The actual facade returned this description.',nextQuestion:'Does the comment sample agree?',receiptIds:[actual.companionReceipts[0].id]});
  assert.equal(changed.thread.revision,1);assert.equal(changed.thread.latestSources[0].url,'https://www.bilibili.com/video/BV1GJ411x7h7/');
  assert.equal(f.requests.length,0);assert.equal(f.store.config().allowReplies,false);
});
