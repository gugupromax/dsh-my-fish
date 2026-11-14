import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../lib/store.js';import {PresentationBridge} from '../lib/presentation-bridge.js';
const assistant=(id='message-one',text='Synthetic actual reply')=>({type:'assistant/message',data:{turn:1,step:1,message:{id,source:{kind:'model'},content:[{type:'text',text}]}}});
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-presentation-')),store=new Store(root);store.saveState({...store.state(),sessionId:'main'});const calls=[];let clock=Date.now();
 const fetchImpl=async(url,init)=>{calls.push({url,init,body:init.body?JSON.parse(init.body):null});return new Response(JSON.stringify(url.includes('/lock?')?{ok:true,lockId:'synthetic-lock'}:{ok:true}),{headers:{'content-type':'application/json'}});};
 const bridge=new PresentationBridge({store,getBaseUrl:()=> 'http://127.0.0.1:1234',fetchImpl,now:()=>clock,timeoutMs:50,...options});
 t.after(async()=>{await bridge.dispose();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return {root,store,bridge,calls,advance:ms=>clock+=ms};
}
test('disabled and unrelated events are side effect free and cannot generate another persona',async t=>{
 const f=fixture(t);assert.equal(f.bridge.settings().enabled,false);await f.bridge.observe({id:'main'},assistant());assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.bridge.file()),false);
 f.bridge.saveSettings({enabled:true,petId:'main',surface:'web'});await f.bridge.observe({id:'other'},assistant());await f.bridge.observe({id:'main'},{...assistant(),data:{...assistant().data,interrupted:true}});assert.equal(f.calls.length,0);
 assert.throws(()=>f.bridge.saveSettings({endpoint:'https://evil.example'}),/字段/);assert.throws(()=>f.bridge.saveSettings({surface:'any'}),/格式/);
 assert.throws(()=>f.bridge.saveSettings(null),/字段/);assert.throws(()=>f.bridge.saveSettings([]),/字段/);
});
test('committed main replies use exact locked local broadcast parameters and durable message deduplication',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,petId:'main',surface:'web',speak:true,animation:'Synthetic action'});
 assert.equal((await f.bridge.observe({id:'main'},assistant())).accepted,true);assert.equal(f.calls.length,3);
 assert.equal(new URL(f.calls[0].url).pathname,'/dsh-pet-7340/lock');assert.deepEqual(f.calls[0].body,{ttl:20000});
 const broadcast=f.calls[1];assert.equal(new URL(broadcast.url).searchParams.get('surface'),'web');assert.equal(new URL(broadcast.url).searchParams.get('lock'),'synthetic-lock');assert.deepEqual(broadcast.body,{text:'Synthetic actual reply',duration:15000,anim:false,speak:true});
 assert.equal(f.calls[2].body.name,'Synthetic action');assert.equal(f.bridge.snapshot().audioStopSupported,false);await f.bridge.observe({id:'main'},assistant());assert.equal(f.calls.length,3);
 const reloaded=new PresentationBridge({store:f.store,getBaseUrl:()=> 'http://127.0.0.1:1234',fetchImpl:()=>assert.fail('Must not replay')});assert.equal((await reloaded.observe({id:'main'},assistant())).deduplicated,true);await reloaded.dispose();
 const raw=fs.readFileSync(f.bridge.file(),'utf8');assert.equal(raw.includes('Synthetic actual reply'),false);
});
test('unknown broadcasts are not retried and arbitrary remote endpoints cannot receive text',async t=>{
 let broadcasts=0;const f=fixture(t,{fetchImpl:async url=>{if(url.includes('/lock?'))return new Response('{"ok":true,"lockId":"synthetic-lock"}');if(url.includes('/broadcast')){broadcasts++;throw Error('unknown');}return new Response('{"ok":true}');}});f.bridge.saveSettings({enabled:true,petId:'main'});
 assert.equal((await f.bridge.observe({id:'main'},assistant())).uncertain,true);await f.bridge.observe({id:'main'},assistant());assert.equal(broadcasts,1);
 const remote=fixture(t,{getBaseUrl:()=> 'https://outside.example/',fetchImpl:()=>assert.fail('Remote requests forbidden')});remote.bridge.saveSettings({enabled:true,petId:'main'});assert.equal((await remote.bridge.observe({id:'main'},assistant())).uncertain,true);
});
test('real user input stops pending delivery, clears only its own bubble and never force releases',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,petId:'main'});await f.bridge.observe({id:'main'},assistant());await f.bridge.observe({id:'main'},{type:'user/message',data:{source:{kind:'user',rpcId:'real-user'}}});
 assert.ok(f.calls.some(c=>c.url.includes('bubble/clear')&&new URL(c.url).searchParams.get('lock')==='synthetic-lock'));
 const release=f.calls.find(c=>c.url.includes('lock/release'));assert.deepEqual(release.body,{lockId:'synthetic-lock'});assert.ok(!f.calls.some(c=>c.body?.force));
});
test('browser speech is synchronous, bounded, single-consumer and cleared on stop or main change',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,mode:'browser'});for(let i=0;i<7;i++)await f.bridge.observe({id:'main'},assistant('synthetic-'+i));
 assert.equal(f.calls.length,0);assert.equal(f.bridge.speech().items.length,0);const a=f.bridge.speech(0,'consumer-a');assert.equal(a.claimed,true);assert.equal(a.items.length,5);assert.equal(a.seq,7);assert.equal(f.bridge.speech(0,'consumer-b').claimed,false);
 f.advance(4001);assert.equal(f.bridge.speech(6,'consumer-b').items.length,1);const epoch=a.epoch;await f.bridge.stop();assert.ok(f.bridge.speech().epoch>epoch);assert.equal(f.bridge.speech(0,'consumer-b').items.length,0);
 await f.bridge.observe({id:'main'},assistant('after-stop'));f.store.saveState({...f.store.state(),sessionId:'another-main'});assert.equal(f.bridge.speech(0,'consumer-a').items.length,0);
});
test('explicit dependency check projects state keys only and never returns unrelated pet data',async t=>{
 const f=fixture(t,{fetchImpl:async(url,init)=>{assert.equal(init.method,'GET');assert.equal(new URL(url).pathname,'/dsh-pet-7340/state');return new Response(JSON.stringify({counter:1,pets:{main:{say:{data:{text:'private chat'}}}},sections:{balance:{data:{amount:42}},config:{data:{path:'private'}}}}));}});
 const result=await f.bridge.check();assert.equal(result.connected,true);assert.deepEqual(result.pets,[{id:'main',name:'main'}]);assert.equal(result.catalogComplete,false);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('amount'),false);
});
