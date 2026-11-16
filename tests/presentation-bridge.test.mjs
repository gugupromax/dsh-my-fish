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
test('combined presentation independently queues local speech and sends one silent pet bubble without replay',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,mode:'both',petId:'main',surface:'web',speak:false});
 const result=await f.bridge.observe({id:'main'},assistant('combined'));assert.equal(result.accepted,true);
 const speech=f.bridge.speech(0,'consumer-a');assert.equal(speech.enabled,true);assert.equal(speech.items.length,1);assert.equal(speech.items[0].text,'Synthetic actual reply');
 const broadcast=f.calls.find(c=>c.url.includes('/broadcast'));assert.equal(broadcast.body.speak,false);assert.equal(f.calls.filter(c=>c.url.includes('/broadcast')).length,1);
 assert.equal((await f.bridge.observe({id:'main'},assistant('combined'))).deduplicated,true);assert.equal(f.bridge.speech(0,'consumer-a').items.length,1);
 await f.bridge.stop();assert.deepEqual(f.bridge.speech(0,'consumer-a').items,[]);assert.ok(f.calls.some(c=>c.url.includes('bubble/clear')));
});
test('combined presentation refuses duplicate pet voice and leaves previously saved settings untouched',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,mode:'pet',petId:'main',speak:true});const before=f.bridge.settings();
 assert.throws(()=>f.bridge.saveSettings({mode:'both'}),/关闭桌宠自身朗读/);assert.deepEqual(f.bridge.settings(),before);
 assert.throws(()=>f.bridge.saveSettings({mode:'both',petId:'',speak:false}),/桌宠ID/);
});
test('combined presentation preserves a queued speech item even if pet transport fails without redelivery',async t=>{
 const f=fixture(t,{fetchImpl:async url=>{if(url.includes('/lock?'))return new Response('{"ok":true,"lockId":"synthetic-lock"}');if(url.includes('/broadcast'))throw Error('synthetic unavailable');return new Response('{"ok":true}');}});
 f.bridge.saveSettings({enabled:true,mode:'both',petId:'main',speak:false});assert.equal((await f.bridge.observe({id:'main'},assistant('broken-pet'))).uncertain,true);
 assert.equal(f.bridge.speech(0,'consumer-a').items.length,1);assert.equal((await f.bridge.observe({id:'main'},assistant('broken-pet'))).deduplicated,true);
});
test('combined mode cancels both channels during an unresponsive pet broadcast and prevents late playback',async t=>{
 let finish;const held=new Promise(resolve=>{finish=resolve;});const f=fixture(t,{fetchImpl:async url=>{if(url.includes('/lock?'))return new Response('{"ok":true,"lockId":"synthetic-lock"}');if(url.includes('/broadcast'))return held;return new Response('{"ok":true}');}});
 f.bridge.saveSettings({enabled:true,mode:'both',petId:'main',speak:false});const job=f.bridge.observe({id:'main'},assistant('slow-broadcast'));await new Promise(resolve=>setImmediate(resolve));
 const before=f.bridge.speech(0,'consumer-a');assert.equal(before.items.length,1);await f.bridge.stop();const result=await job;assert.equal(result.ok,false);assert.ok(f.bridge.speech(0,'consumer-a').epoch>before.epoch);assert.deepEqual(f.bridge.speech(0,'consumer-a').items,[]);
 finish(new Response('{"ok":true}'));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.bridge.speech(0,'consumer-a').items,[]);assert.equal((await f.bridge.observe({id:'main'},assistant('slow-broadcast'))).deduplicated,true);
});
test('activity actions default off and require explicitly configured safe action names',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,petId:'main'});
 await f.bridge.observe({id:'main'},{type:'turn/start',data:{turn:1}});await f.bridge.observe({id:'main'},{type:'tool/call',data:{turn:1,name:'read',arguments:'SECRET'}});assert.equal(f.calls.length,0);
 assert.throws(()=>f.bridge.saveSettings({activityActions:{enabled:true,thinking:'../private'}}),/状态动作/);
 assert.throws(()=>f.bridge.saveSettings({activityActions:{enabled:true,thinking:'safe',other:'x'}}),/状态动作/);
 assert.equal(f.bridge.settings().activityActions.enabled,false);
});
test('main turn uses only selected action names, with one thinking and one PTC reading action',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,petId:'main',surface:'web',activityActions:{enabled:true,thinking:'Synthetic thinking',reading:'Synthetic reading'}});
 await f.bridge.observe({id:'other'},{type:'turn/start',data:{turn:1}});assert.equal(f.calls.length,0);
 await f.bridge.observe({id:'main'},{type:'turn/start',data:{turn:1}});await f.bridge.observe({id:'main'},{type:'turn/start',data:{turn:1}});
 await f.bridge.observe({id:'main'},{type:'tool/call',data:{turn:1,callId:'root-1',name:'run_code',arguments:'SECRET'}});
 await f.bridge.observe({id:'main'},{type:'tool/ptc-dispatch-start',data:{name:'social_read',rootCallId:'old-root'}});
 await f.bridge.observe({id:'main'},{type:'tool/ptc-dispatch-start',data:{name:'social_read',rootCallId:'root-1',arguments:{text:'SECRET'}}});
 await f.bridge.observe({id:'main'},{type:'tool/ptc-dispatch-start',data:{name:'social_read',rootCallId:'root-1'}});
 const animations=f.calls.filter(c=>c.url.includes('/anim'));assert.deepEqual(animations.map(c=>c.body),[{name:'Synthetic thinking'},{name:'Synthetic reading'}]);
 assert.equal(JSON.stringify(f.calls).includes('SECRET'),false);assert.equal(f.calls.filter(c=>c.url.includes('/lock/release')).length,2);assert.equal(f.calls.some(c=>c.body?.force),false);
 await f.bridge.observe({id:'main'},{type:'turn/end',data:{turn:1}});await f.bridge.observe({id:'main'},{type:'tool/call',data:{turn:1,name:'read'}});assert.equal(f.calls.filter(c=>c.url.includes('/anim')).length,2);
 await f.bridge.observe({id:'main'},{type:'turn/start',data:{turn:2}});await f.bridge.observe({id:'main'},{type:'tool/ptc-dispatch-start',data:{name:'social_read',rootCallId:'root-1'}});assert.equal(f.calls.filter(c=>c.url.includes('/anim')).length,3);
 await f.bridge.observe({id:'main'},{type:'tool/call',data:{turn:2,callId:'direct-2',name:'read'}});assert.equal(f.calls.filter(c=>c.url.includes('/anim')).length,4);
});
test('status action ignores occupied pet and never clears a committed reply bubble on turn end',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,petId:'main',activityActions:{enabled:true,thinking:'Think',reading:'Read'}});await f.bridge.observe({id:'main'},assistant('existing'));
 const before=f.calls.length;await f.bridge.observe({id:'main'},{type:'turn/start',data:{turn:2}});await f.bridge.observe({id:'main'},{type:'tool/call',data:{turn:2,name:'read'}});await f.bridge.observe({id:'main'},{type:'turn/end',data:{turn:2}});
 assert.equal(f.calls.length,before);assert.equal(f.calls.some(c=>c.url.includes('bubble/clear')),false);
});
test('late activity acknowledgement cannot animate after stop or a main-session change',async t=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const calls=[];
 const f=fixture(t,{fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});if(url.includes('/lock?'))return pending;return new Response('{"ok":true}');}});
 f.bridge.saveSettings({enabled:true,petId:'main',activityActions:{enabled:true,thinking:'Think',reading:'Read'}});
 const start=f.bridge.observe({id:'main'},{type:'turn/start',data:{turn:3}});await new Promise(done=>setImmediate(done));await f.bridge.stop();await start;
 resolve(new Response('{"ok":true,"lockId":"late-lock"}'));await new Promise(done=>setImmediate(done));assert.equal(calls.some(c=>c.url.includes('/anim')),false);
 f.store.saveState({...f.store.state(),sessionId:'new-main'});await f.bridge.observe({id:'main'},{type:'tool/call',data:{turn:3,name:'read'}});assert.equal(calls.some(c=>c.url.includes('/anim')),false);
});
test('explicit dependency check projects state keys only and never returns unrelated pet data',async t=>{
 const f=fixture(t,{fetchImpl:async(url,init)=>{assert.equal(init.method,'GET');assert.equal(new URL(url).pathname,'/dsh-pet-7340/state');return new Response(JSON.stringify({counter:1,pets:{main:{say:{data:{text:'private chat'}}}},sections:{balance:{data:{amount:42}},config:{data:{path:'private'}}}}));}});
 const result=await f.bridge.check();assert.equal(result.connected,true);assert.deepEqual(result.pets,[{id:'main',name:'main'}]);assert.equal(result.catalogComplete,false);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('amount'),false);
});

test('full expression ledger archives terminal records without replaying old or uncertain deliveries',async t=>{
 const f=fixture(t);f.bridge.saveSettings({enabled:true,mode:'browser'});
 await f.bridge.observe({id:'main'},assistant('original'));
 const data=f.bridge.state(),original=data.deliveries[0];
 for(let i=1;i<4999;i++)data.deliveries.push({key:'synthetic-'+i,sessionId:'main',messageId:'s-'+i,status:'accepted',at:1});
 data.deliveries.push({key:'unknown-key',sessionId:'main',messageId:'uncertain',status:'unknown',at:1});
 fs.writeFileSync(f.bridge.file(),JSON.stringify(data));
 // Simulate a crash after archive write but before removing the active row.
 fs.writeFileSync(f.bridge.archiveFile(),JSON.stringify({version:1,deliveries:[{key:original.key,status:'accepted'}]}));
 assert.equal((await f.bridge.observe({id:'main'},assistant('new'))).queued,true);
 assert.ok(f.bridge.state().deliveries.length<5000);
 assert.equal(f.bridge.archive().deliveries.filter(row=>row.key===original.key).length,1);
 assert.equal((await f.bridge.observe({id:'main'},assistant('original'))).deduplicated,true);
 assert.ok(f.bridge.state().deliveries.some(row=>row.key==='unknown-key')||f.bridge.archive().deliveries.some(row=>row.key==='unknown-key'));
});
