import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store,atomic} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {CompanionRuntime,companionVideoReference} from '../lib/companion-runtime.js';
import {Scheduler} from '../lib/scheduler.js';
import {personalContextText} from '../lib/assistant-context.js';
import {Permissions} from '../lib/permissions.js';

function fixture(t,{failPrompt=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-companion-runtime-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const store=new Store(root),assistant=new AssistantStore(store),companion=new CompanionStore(store),requests=[];
  store.saveState({...store.state(),sessionId:'synthetic-main'});
  const controller={prompt:async request=>{requests.push(request);if(failPrompt)throw Error('Synthetic unknown acknowledgement');},create:async()=>{throw Error('Must not replace the main conversation');}};
  const signal=new AbortController().signal,scheduler=new Scheduler(store,controller,signal,assistant,{companion});
  const runtime=new CompanionRuntime({store,companion,scheduler,controller,signal});
  return {root,store,assistant,companion,requests,controller,scheduler,runtime};
}

test('video conversation accepts canonical BV links and discards tracking while refusing unrelated targets',()=>{
  const expected='https://www.bilibili.com/video/BV1GJ411x7h7/';
  for(const value of ['BV1GJ411x7h7','https://bilibili.com/video/BV1GJ411x7h7','https://www.bilibili.com/video/BV1GJ411x7h7/?utm_source=synthetic#reply'])assert.equal(companionVideoReference(value),expected);
  for(const value of ['',null,'http://www.bilibili.com/video/BV1GJ411x7h7/','https://b23.tv/example','https://www.bilibili.com.evil.invalid/video/BV1GJ411x7h7/','https://name:password@www.bilibili.com/video/BV1GJ411x7h7/','https://www.bilibili.com:4430/video/BV1GJ411x7h7/','https://www.bilibili.com/video/not-bv/','https://www.bilibili.com/video/BV1GJ411x7h7/extra'])assert.throws(()=>companionVideoReference(value),/BV/);
});

test('explicit topic chat stays in the fixed main conversation and is idempotent across runtime reloads',async t=>{
  const f=fixture(t),topic=f.companion.start({title:'Synthetic curiosity',openQuestion:'What would explain this?'},'synthetic-main');
  const input={id:topic.id,requestId:'synthetic-chat-request-1'},before=f.store.config();
  const first=await f.runtime.chat(input);assert.equal(first.sessionId,'synthetic-main');assert.equal(first.queued,true);assert.equal(f.requests.length,1);
  assert.match(f.requests[0].content[0].text,/Synthetic curiosity/);assert.equal(f.companion.isInternalDispatch(f.requests[0].requestId),true);
  const again=new CompanionRuntime({...f,runtime:undefined,signal:new AbortController().signal});
  assert.equal((await again.chat(input)).queued,true);assert.equal(f.requests.length,1);
  await assert.rejects(()=>f.runtime.chat({...input,reference:'BV1GJ411x7h7'}),/不能更换/);
  assert.deepEqual(f.store.config(),before);assert.equal(f.assistant.settings().enabled,false);assert.equal(f.store.state().activeRun,undefined);
});

test('Bilibili chat is a user-requested prompt rather than a claimed read or autonomous permission',async t=>{
  const f=fixture(t);await f.runtime.chat({reference:'BV1GJ411x7h7',requestId:'synthetic-video-request'});
  assert.match(f.requests[0].content[0].text,/social_read/);assert.match(f.requests[0].content[0].text,/别假装看过视频/);
  assert.deepEqual(f.companion.snapshot().receipts,[]);assert.deepEqual(f.companion.snapshot().threads,[]);
  assert.equal(f.assistant.settings().enabled,false);assert.equal(f.store.config().allowReplies,false);
});

test('unknown chat admission stays locked and its original request is never resent automatically',async t=>{
  const f=fixture(t,{failPrompt:true}),input={requestId:'synthetic-unknown-request'};
  await assert.rejects(()=>f.runtime.chat(input),/未确认/);assert.equal(f.requests.length,1);assert.equal(f.store.state().dispatchPending,true);
  const retry=await new CompanionRuntime({...f,signal:new AbortController().signal}).chat(input);
  assert.equal(retry.uncertain,true);assert.equal(retry.queued,false);assert.equal(f.requests.length,1);
  await assert.rejects(()=>f.runtime.chat({requestId:'synthetic-other-request'}),/未确认/);assert.equal(f.requests.length,1);
});

test('invalid, paused and old-session chat references fail without creating a prompt',async t=>{
  const f=fixture(t),topic=f.companion.start({title:'Synthetic paused curiosity',openQuestion:'An actual open question'},'synthetic-main');f.companion.setStatus(topic.id,'paused');
  for(const input of [null,[],{}, {requestId:'short'}, {requestId:'synthetic-invalid',extra:true},{id:topic.id,requestId:'synthetic-paused'}])await assert.rejects(()=>f.runtime.chat(input));
  assert.equal(f.requests.length,0);
  await f.runtime.chat({requestId:'synthetic-old-session'});f.store.saveState({...f.store.state(),sessionId:'synthetic-new-main'});
  await assert.rejects(()=>f.runtime.chat({requestId:'synthetic-old-session'}),/旧主会话/);assert.equal(f.requests.length,1);
});

test('live conversation capture excludes program prompts, unrelated sessions, runtime content and sensitive full messages',t=>{
  const f=fixture(t);const event=(id,text,rpcId='native-user-'+id)=>({type:'user/message',time:Date.now(),data:{id,source:{kind:'user',rpcId},content:[{type:'text',text}]}});
  f.companion.registerDispatch('synthetic-self-rpc');
  f.runtime.observe({id:'synthetic-main'},event('own','Synthetic scheduled task','synthetic-self-rpc'));
  f.runtime.observe({id:'ordinary'},event('outside','Synthetic outside text'));
  f.runtime.observe({id:'synthetic-main'},{...event('context','Synthetic runtime instructions'),data:{...event('context','').data,source:{kind:'runtime-context'}}});
  f.runtime.observe({id:'synthetic-main'},event('secret','x'.repeat(1600)+' password=SYNTHETIC_SECRET'));
  assert.equal(f.companion.snapshot().recentUserMessages.length,0);
  const genuine=event('native-message','我对这条说法有不同意见。');f.runtime.observe({id:'synthetic-main'},genuine);f.runtime.observe({id:'synthetic-main'},genuine);
  assert.equal(f.companion.snapshot().recentUserMessages.length,1);assert.equal(f.companion.snapshot().recentUserMessages[0].id,'native-message');
  assert.ok(!fs.readFileSync(f.companion.file(),'utf8').includes('SYNTHETIC_SECRET'));
});

test('scheduled companion curiosity has continuity context and its own persisted prompts never become user opinions',async t=>{
  const f=fixture(t);f.companion.start({title:'Synthetic continuing interest',openQuestion:'A question from the last visit'},'synthetic-main');
  await f.scheduler.run(true);assert.equal(f.requests.length,1);
  const request=f.requests[0];assert.match(request.content[0].text,/日常兴趣探索/);assert.match(request.content[0].text,/Synthetic continuing interest/);assert.match(request.content[0].text,/不要求产出工作日报/);
  f.runtime.observe({id:'synthetic-main'},{type:'user/message',time:Date.now(),data:{id:'scheduled-message',source:{kind:'user',rpcId:request.requestId},content:request.content}});
  assert.equal(f.companion.snapshot().recentUserMessages.length,0);
  const main=personalContextText(f.store,f.assistant,{agent:{session:{id:'synthetic-main'}}},f.companion);
  assert.match(main,/不要把每次聊天都写成目标/);assert.match(main,/Synthetic continuing interest/);
  assert.equal(personalContextText(f.store,f.assistant,{agent:{session:{id:'ordinary'}}},f.companion),'');
});

test('companion tools remain personal and cannot enter a read-only plan or its descendants',t=>{
  const f=fixture(t),plan={id:'synthetic-plan'};
  const permissions=new Permissions(f.store,{isPlanSession:exec=>exec.agent===plan});
  assert.equal(permissions.guard({name:'assistant_companion',agent:{session:{id:'synthetic-main'}},arguments:{action:'list'}}),undefined);
  assert.match(permissions.guard({name:'assistant_companion',agent:plan,arguments:{action:'list'}}),/只读/);
});

test('old generated prompts remain excluded after the bounded dispatch index has rotated',t=>{
  const f=fixture(t);atomic(f.companion.file(),{threads:[],receipts:[],recentUserMessages:[],dispatches:Array.from({length:100},(_,i)=>'other-dispatch-'+i)});
  for(const rpcId of ['my-fish-chat-old-generated','my-fish-wake-old-generated'])f.runtime.observe({id:'synthetic-main'},{type:'user/message',time:Date.now(),data:{id:rpcId,source:{kind:'user',rpcId},content:[{type:'text',text:'Generated prompt must never become a user opinion.'}]}});
  assert.deepEqual(f.companion.snapshot().recentUserMessages,[]);
});

test('manual recovery understands pending companion chat ownership and never replays its old prompt',async t=>{
  const f=fixture(t,{failPrompt:true});await assert.rejects(()=>f.runtime.chat({requestId:'synthetic-unknown-before-delete'}),/未确认/);
  let creates=0;f.controller.create=async request=>{creates++;return {sessionId:request.sessionId};};
  const scheduler=new Scheduler(f.store,f.controller,new AbortController().signal,f.assistant,{companion:f.companion,probeSession:async id=>id==='synthetic-main'?'missing':'exists'});
  const result=await scheduler.ensureSession({recoverMissing:true});
  assert.equal(result.recovered,true);assert.equal(creates,1);assert.equal(f.requests.length,1);
  assert.equal(f.store.state().dispatchPending,false);assert.equal(f.store.state().companionChatPending,null);
  assert.equal(f.store.state().companionChats[0].status,'interrupted');
  await assert.rejects(()=>f.runtime.chat({requestId:'synthetic-unknown-before-delete'}),/旧主会话/);
});
