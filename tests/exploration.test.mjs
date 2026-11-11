import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {ExperienceStore} from '../lib/experience-store.js';
import {Exploration} from '../lib/exploration.js';
import {Scheduler} from '../lib/scheduler.js';
const BV='BV1GJ411x7h7',url='https://www.bilibili.com/video/'+BV+'/';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-exploration-')),store=new Store(root),assistant=new AssistantStore(store),companion=new CompanionStore(store),experiences=new ExperienceStore(store);
  store.saveState({...store.state(),sessionId:'main'});assistant.saveSettings({enabled:true,startHour:0,endHour:24});
  const main={id:'main',session:{id:'main'},status:'idle'},started=[],cancelled=[],prompts=[];let now=Date.now();
  const host={start:async input=>{started.push(input);return {accepted:true};},cancel:async id=>{cancelled.push(id);return {ok:true,cancelled:true};},identity:id=>started.some(x=>x.sessionId===id)?{id}:null};
  const controller={prompt:async input=>{prompts.push(input);return {accepted:true};}},explore=new Exploration({store,assistant,companion,experiences,host,controller,getMainAgent:()=>main,now:()=>now,quietMs:200,timeoutMs:180000,signal:new AbortController().signal});
  t.after(()=>{explore.dispose();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const exec=(name,args={},id='call-'+name)=>({name,arguments:args,callId:id,rootCallId:id,agent:{id:explore.active()?.sessionId??started.at(-1)?.sessionId,session:{id:explore.active()?.sessionId??started.at(-1)?.sessionId}}});
  const read=()=>explore.capture({platform:'bilibili',operation:'read',args:{reference:BV},result:{ok:true,items:[{bvid:BV,url,title:'Synthetic public title',description:'Synthetic description'}],scope:'Synthetic public metadata'},exec:exec('social_read',{platform:'bilibili',reference:BV})})[0];
  const report=receipt=>explore.report({runId:explore.active().id,quiet:false,share:true,title:'Synthetic interest',question:'Why does this work?',thought:'An actual synthetic observation',reason:'A concrete detail',nextQuestion:'What happens next?',receiptIds:[receipt.id]},exec('assistant_explore'));
  return {store,assistant,companion,experiences,explore,host,controller,main,started,cancelled,prompts,exec,read,report,advance:ms=>{now+=ms;},now:()=>now};
}
test('background starts separately, preserves main identity and rejects duplicate active starts',async t=>{
  const f=fixture(t);await f.explore.start();assert.equal(f.started.length,1);assert.notEqual(f.started[0].sessionId,'main');assert.equal(f.store.state().sessionId,'main');assert.equal(f.prompts.length,0);assert.ok(f.explore.owns(f.exec('social_read')));
  await assert.rejects(f.explore.start(),/已有/);assert.equal(f.started.length,1);assert.equal(f.explore.preStep({agent:f.main}),undefined);
  assert.match(f.explore.guard(f.exec('read',{path:'private'})),/仅允许/);assert.match(f.explore.guard(f.exec('social_read',{platform:'x',reference:'123'})),/仅允许/);
});
test('manual exploration can start from the running main while automatic work respects idle and pause',async t=>{
  const f=fixture(t);f.main.status='running';assert.ok((await f.explore.start()).skipped);await f.explore.start({manual:true});assert.equal(f.started.length,1);
  await f.explore.stop(f.explore.active().id);f.main.status='idle';f.assistant.saveSettings({enabled:false});assert.ok((await f.explore.start()).skipped);assert.equal(f.started.length,1);
});
test('budget counts unique calls, refuses argument replay and allows only a proven nested search',async t=>{
  const f=fixture(t);await f.explore.start();const call=f.exec('social_search',{platform:'bilibili',query:'Synthetic question'},'search-one');
  assert.equal(f.explore.guard(call),undefined);assert.equal(f.explore.guard(call),undefined);assert.match(f.explore.guard({...call,arguments:{platform:'bilibili',query:'Changed'}}),/不同参数/);
  assert.match(f.explore.guard(f.exec('social_search',{platform:'bilibili',query:'Another'},'search-two')),/额度/);
  assert.match(f.explore.guard(f.exec('web_search',{queries:['bypass']})),/必须通过/);
  const nested={...f.exec('web_search'),rootCallId:'search-one',parent:{synthetic:true}};assert.equal(f.explore.guard(nested),undefined);assert.match(f.explore.guard({...nested,parent:undefined}),/必须通过/);
  assert.match(f.explore.guard(f.exec('social_comments',{platform:'bilibili',reference:BV,count:20})),/最多五条/);
});
test('only actual read evidence records an episode; late and foreign reports cannot alter it',async t=>{
  const f=fixture(t);await f.explore.start();const run=f.explore.active();
  assert.throws(()=>f.report({id:'fabricated'}),/来源/);assert.equal(f.experiences.episodes('main').length,0);
  const receipt=f.read(),result=f.report(receipt);assert.ok(result.episodeId);assert.equal(f.experiences.episodes('main').length,1);assert.equal(f.store.state().explorationActive,null);
  assert.equal(f.explore.capture({exec:f.exec('social_read')} ).length,0);
  assert.equal(f.explore.preStep({agent:{session:{id:run.sessionId}}}).kind,'reject');assert.equal(f.explore.preStep({agent:f.main}),undefined);
});
test('actual main reply attribution needs the matching claimed turn and source mention',async t=>{
  const f=fixture(t);await f.explore.start();f.report(f.read());f.advance(500);await f.explore.deliver();assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].sessionId,'main');
  const opening=f.explore.state().openings[0],message={id:'reply',source:{kind:'model'},content:[{type:'text',text:'A specific thought '+url}]};
  f.explore.observe({id:'main'},{type:'assistant/message',data:{turn:1,message}});assert.equal(f.explore.state().openings[0].status,'queued');
  f.explore.claimed({agent:f.main,message:{source:{rpcId:opening.requestId}},turn:4});f.explore.observe({id:'main'},{type:'assistant/message',data:{turn:4,message}});
  assert.equal(f.explore.state().openings[0].status,'spoken');await f.explore.deliver();assert.equal(f.prompts.length,1);
});
test('snooze, recent user activity, paused and forgotten interests suppress automatic sharing',async t=>{
  const f=fixture(t);await f.explore.start();f.report(f.read());const interest=f.experiences.interests('main')[0];f.assistant.snooze('two-hours');assert.ok((await f.explore.deliver()).skipped);f.assistant.snooze('resume');
  f.explore.observe({id:'main'},{type:'user/message',data:{source:{kind:'user',rpcId:'real-user-rpc'}}});assert.ok((await f.explore.deliver()).skipped);f.advance(500);f.experiences.setInterest(interest.id,'paused');assert.ok((await f.explore.deliver()).skipped);f.experiences.forget(interest.id);assert.ok((await f.explore.deliver()).skipped);assert.equal(f.prompts.length,0);
});
test('unknown opening is not resent across reload and has explicit end-waiting recovery',async t=>{
  const f=fixture(t);await f.explore.start();f.report(f.read());f.advance(500);f.controller.prompt=async input=>{f.prompts.push(input);throw Error('unknown transport');};
  assert.equal((await f.explore.deliver()).uncertain,true);assert.equal(f.store.state().dispatchPending,true);await f.explore.deliver();assert.equal(f.prompts.length,1);
  const data=f.explore.state();assert.equal(data.openings[0].status,'unknown');assert.match(f.explore.recoverOpening().note,/不会重发/);assert.equal(f.store.state().dispatchPending,false);await f.explore.deliver();assert.equal(f.prompts.length,1);
});
test('expiry and cancellation revoke background tools while preserving main data',async t=>{
  const f=fixture(t);await f.explore.start();const run=f.explore.active();f.advance(180001);await f.explore.sweep();assert.equal(f.cancelled[0],run.sessionId);assert.equal(f.store.state().explorationActive,null);assert.equal(f.store.state().sessionId,'main');assert.match(f.explore.guard(f.exec('social_read',{platform:'bilibili',reference:BV})),/结束或失效/);
});
test('automatic interest wakes use the background while manual and due goal work retain main execution',async t=>{
  const f=fixture(t);const scheduler=new Scheduler(f.store,{prompt:async input=>{f.prompts.push(input);},create:()=>{throw Error('No replacement main');}},new AbortController().signal,f.assistant,{probeSession:async()=> 'exists'});scheduler.exploration=f.explore;
  const result=await scheduler.run(false);assert.ok(result.runId);assert.equal(f.prompts.length,0);assert.equal(f.started.length,1);await f.explore.stop(result.runId);
  f.store.saveState({...f.store.state(),nextRun:0});f.assistant.saveGoal({title:'Synthetic due goal',detail:'An actual goal',nextCheckAt:null});await scheduler.run(false);assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].sessionId,'main');
});

test('a role may let an existing interest cool without inventing another reading episode',async t=>{
  const f=fixture(t);await f.explore.start();f.report(f.read());const topic=f.experiences.interests('main')[0];f.experiences.chooseInterest=()=>topic;
  await f.explore.start();const result=f.explore.report({runId:f.explore.active().id,quiet:true,share:false,reason:'This question is no longer interesting',interestStatus:'paused'},f.exec('assistant_explore'));
  assert.equal(result.finished,true);assert.equal(f.experiences.interests('main')[0].status,'paused');assert.equal(f.experiences.episodes('main').length,1);f.advance(500);assert.ok((await f.explore.deliver()).skipped);
});

test('manual exploration can return while autonomy is disabled but automatic openings honor the saved window',async t=>{
  const f=fixture(t);f.assistant.saveSettings({enabled:false});await f.explore.start({manual:true});f.report(f.read());f.advance(500);assert.equal((await f.explore.deliver()).queued,true);
  const other=fixture(t);await other.explore.start();other.report(other.read());const hour=new Date(other.now()).getHours();const start=(hour+2)%24,end=start===23?24:start+1;other.assistant.saveSettings({startHour:start,endHour:end});other.advance(500);assert.ok((await other.explore.deliver()).skipped);assert.equal(other.prompts.length,0);
});

test('a claimed reply without a source mention is not falsely recorded as a spoken discovery',async t=>{
  const f=fixture(t);await f.explore.start();f.report(f.read());f.advance(500);await f.explore.deliver();const opening=f.explore.state().openings[0];
  f.explore.claimed({agent:f.main,message:{source:{rpcId:opening.requestId}},turn:9});f.explore.observe({id:'main'},{type:'assistant/message',data:{turn:9,message:{id:'real-reply',source:{kind:'model'},content:[{type:'text',text:'Responding to a newer user question'}]}}});
  assert.equal(f.explore.state().openings[0].status,'responded');assert.equal(f.explore.state().openings[0].spokenAt,undefined);assert.equal(f.prompts.length,1);
});

test('plugin disposal requests cancellation and preserves an unconfirmed run for restart recovery',async t=>{
  const f=fixture(t);await f.explore.start();const id=f.explore.active().id;f.explore.dispose();assert.equal(f.cancelled.length,1);assert.equal(f.explore.state().runs.find(r=>r.id===id).status,'unknown');assert.ok(f.store.state().explorationActive);f.advance(180001);await f.explore.sweep();assert.equal(f.store.state().explorationActive,null);
});
