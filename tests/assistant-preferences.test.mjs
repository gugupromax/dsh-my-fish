import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {personalContextText} from '../lib/assistant-context.js';
import {Scheduler,personalPrompt} from '../lib/scheduler.js';
import {registerAssistantTools} from '../lib/assistant-tools.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-preferences-'));
  t.after(()=>{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true});});
  const store=new Store(root),assistant=new AssistantStore(store);return {root,store,assistant};
}

test('old role files receive presentation defaults without writes and style saves preserve the custom role exactly',t=>{
  const {store,assistant}=fixture(t);
  const old={id:'default',name:'SYNTHETIC_ROLE',ownerTitle:'SYNTHETIC_USER',selfClaim:'SYNTHETIC_SELF',persona:'  Synthetic role\r\nwith preserved spacing.\n',interests:[' Synthetic interest ']};
  atomic(assistant.file('profile.json'),old);const before=fs.readFileSync(assistant.file('profile.json'),'utf8');
  assert.deepEqual(assistant.profile(),{...old,replyStyle:'default',emojiStyle:'default'});
  assert.equal(fs.readFileSync(assistant.file('profile.json'),'utf8'),before);
  const saved=assistant.saveProfile({replyStyle:'concise',emojiStyle:'none'});
  for(const key of Object.keys(old))assert.deepEqual(saved[key],old[key]);
  assert.deepEqual(new AssistantStore(store).profile(),saved);
  const updated=fs.readFileSync(assistant.file('profile.json'),'utf8');
  for(const value of [null,'unknown','__proto__','constructor',true])assert.throws(()=>assistant.saveProfile({replyStyle:value}),/无效/);
  assert.throws(()=>assistant.saveProfile({emojiStyle:'many'}),/无效/);
  assert.equal(fs.readFileSync(assistant.file('profile.json'),'utf8'),updated);
});

test('style preferences refresh in each personal context and wake prompt without entering unrelated chats',t=>{
  const {store,assistant}=fixture(t);assistant.saveProfile({persona:'SYNTHETIC_PERSONA'});store.saveState({...store.state(),sessionId:'personal'});
  const context=()=>personalContextText(store,assistant,{agent:{session:{id:'personal'}}});
  assert.doesNotMatch(context(),/说话风格：|表情符号：/);
  assistant.saveProfile({replyStyle:'concise',emojiStyle:'none'});
  assert.match(context(),/说话风格：简短/);assert.match(context(),/表情符号：不使用/);assert.match(context(),/不改变角色身份、事实判断或任何工具权限/);
  assert.equal(personalContextText(store,assistant,{agent:{session:{id:'ordinary'}}}),'');
  const c=store.config(),prompt=personalPrompt(c,assistant.context(),{id:'synthetic',manual:true,xReady:false});
  assert.match(prompt,/SYNTHETIC_PERSONA/);assert.match(prompt,/说话风格：简短/);assert.match(prompt,/表情符号：不使用/);
  assistant.saveProfile({replyStyle:'formal',emojiStyle:'moderate'});
  assert.match(context(),/说话风格：正式/);assert.match(context(),/少量使用 emoji/);assert.doesNotMatch(context(),/说话风格：简短/);
  assistant.saveProfile({replyStyle:'natural'});assert.match(context(),/说话风格：自然/);
  assistant.saveProfile({replyStyle:'default',emojiStyle:'default'});assert.doesNotMatch(context(),/说话风格：|表情符号：/);
});

test('temporary snooze survives reload and schedule edits without changing switches, account state or quotas',t=>{
  const {store,assistant}=fixture(t),now=new Date(2026,9,29,20,10,5).getTime();
  assistant.saveSettings({enabled:true,startHour:0,endHour:24});
  const initial=assistant.settings();assert.equal(initial.snoozeUntil,null);
  store.saveState({...store.state(),sessionId:'main',runs:{synthetic:2},nextRun:now+60000,pausedUntil:now+100000,inflight:{id:'synthetic-receipt'},sessionRecovery:{followupPaused:true}});
  const before=fs.readFileSync(store.file('state.json'),'utf8'),config=store.config();
  const paused=assistant.snooze('two-hours',now);assert.equal(paused.snoozeUntil,now+7200000);
  assert.deepEqual({...paused,snoozeUntil:null},initial);
  const reloaded=new AssistantStore(store);assert.equal(reloaded.settings().snoozeUntil,paused.snoozeUntil);
  reloaded.saveSettings({intervalMinutes:240});assert.equal(reloaded.settings().snoozeUntil,paused.snoozeUntil);
  assert.throws(()=>reloaded.saveSettings({snoozeUntil:null}),/字段/);
  assert.equal(fs.readFileSync(store.file('state.json'),'utf8'),before);assert.deepEqual(store.config(),config);
  const resumed=reloaded.snooze('resume',now);assert.equal(resumed.snoozeUntil,null);assert.equal(resumed.enabled,true);assert.equal(resumed.intervalMinutes,240);
  assert.equal(fs.readFileSync(store.file('state.json'),'utf8'),before);
  reloaded.saveSettings({enabled:false});assert.equal(reloaded.snooze('resume',now).enabled,false);
});

test('today snooze ends at the next local midnight across month and year boundaries',t=>{
  const {assistant}=fixture(t);
  for(const [now,expected] of [[new Date(2026,9,29,23,59,59,999),new Date(2026,9,30)],[new Date(2026,11,31,8),new Date(2027,0,1)]])assert.equal(assistant.snooze('today',now.getTime()).snoozeUntil,expected.getTime());
  const before=fs.readFileSync(assistant.file('settings.json'),'utf8');
  for(const value of [null,{},'unknown'])assert.throws(()=>assistant.snooze(value),/无效/);
  assert.throws(()=>assistant.snooze('two-hours',8640000000000000),/时间戳/);
  assert.equal(fs.readFileSync(assistant.file('settings.json'),'utf8'),before);
});

test('automatic snoozed ticks are side-effect free, while a manual task still runs',async t=>{
  const {store,assistant}=fixture(t);assistant.saveSettings({enabled:true,startHour:0,endHour:24});assistant.snooze('two-hours');
  store.saveState({...store.state(),sessionId:'synthetic-main',runs:{synthetic:1},nextRun:0,pausedUntil:Date.now()+600000});
  const before=fs.readFileSync(store.file('state.json'),'utf8');let prompts=0;
  const scheduler=new Scheduler(store,{create:async()=>{throw Error('must reuse existing session');},prompt:async()=>{prompts++;}},new AbortController().signal,assistant);
  assert.equal((await scheduler.run(false)).skipped,'自主跟进已临时暂停');assert.equal(prompts,0);assert.equal(fs.readFileSync(store.file('state.json'),'utf8'),before);
  await scheduler.run(true,'Synthetic manual task');assert.equal(prompts,1);assert.deepEqual(store.state().runs,{synthetic:1});
  assert.equal(assistant.settings().snoozeUntil>Date.now(),true);
});

test('expired snooze respects the original schedule and total enable switch instead of replaying missed wakes',async t=>{
  const {store,assistant}=fixture(t);let now=new Date(2026,9,29,12).getTime();t.mock.method(Date,'now',()=>now);
  assistant.saveSettings({enabled:true,startHour:0,endHour:24});assistant.snooze('two-hours',now);
  store.saveState({...store.state(),sessionId:'synthetic-main',nextRun:now+3*3600000});let prompts=0;
  const scheduler=new Scheduler(store,{prompt:async()=>{prompts++;}},new AbortController().signal,assistant);
  now+=2*3600000;assert.equal((await scheduler.run(false)).skipped,'未到作息时间');assert.equal(prompts,0);
  now+=3600000;await scheduler.run(false);assert.equal(prompts,1);
  scheduler.finish({runId:store.state().activeRun.id,notify:false,summary:'Synthetic completion'});
  assert.equal((await scheduler.run(false)).skipped,'未到作息时间');assert.equal(prompts,1);
  assistant.saveSettings({enabled:false});assistant.snooze('resume',now);assert.equal((await scheduler.run(false)).skipped,'未开启自主探索');assert.equal(prompts,1);
});

test('memory expiry is retained on corrections, explicit removal works and expired records cannot be silently renewed by duplicate text',t=>{
  const {assistant}=fixture(t);let now=new Date(2026,9,29,12).getTime();t.mock.method(Date,'now',()=>now);
  const expiresAt=now+60000,row=assistant.remember({text:'Synthetic temporary trip',category:'fact',source:'Synthetic user statement',expiresAt});
  const corrected=assistant.remember({id:row.id,text:'Synthetic corrected trip',source:'Synthetic user correction'});assert.equal(corrected.expiresAt,expiresAt);assert.equal(corrected.createdAt,row.createdAt);
  const raw=fs.readFileSync(assistant.file('memories.json'),'utf8');
  assert.throws(()=>assistant.remember({text:corrected.text,source:'Another source',expiresAt:null}),/原 ID/);
  assert.equal(fs.readFileSync(assistant.file('memories.json'),'utf8'),raw);
  now=expiresAt;assert.deepEqual(assistant.memories(),[]);assert.equal(assistant.snapshot().stats.memoryCount,0);assert.deepEqual(assistant.context().memories,[]);
  assert.throws(()=>assistant.remember({text:corrected.text,source:'Another source'}),/旧记忆已过期.*明确新的有效期/);
  assert.throws(()=>assistant.remember({text:corrected.text,source:'Another source',expiresAt:now}),/旧记忆已过期.*明确新的有效期/);
  assert.equal(fs.readFileSync(assistant.file('memories.json'),'utf8'),raw);
  const permanent=assistant.remember({id:row.id,expiresAt:null,source:'Synthetic explicit keep'});assert.equal(permanent.expiresAt,null);assert.equal(assistant.memories()[0].id,row.id);
  assert.throws(()=>assistant.remember({id:row.id,expiresAt:'tomorrow'}),/时间戳/);
});

test('memory tool preserves expiry and provenance unless the user explicitly clears it',async t=>{
  const {assistant,store}=fixture(t),tools=new Map(),expiresAt=Date.now()+600000;
  registerAssistantTools({tool:(name,_description,_schema,execute)=>tools.set(name,execute),assistant,store});
  const exec={agent:{session:{id:'synthetic-chat'}}},call=args=>tools.get('assistant_memory')(args,undefined,exec);
  const first=call({action:'remember',text:'Synthetic temporary fact',source:'Explicit synthetic statement',expiresAt});
  const corrected=call({action:'remember',id:first.memory.id,text:'Synthetic corrected fact',source:'Explicit correction'});assert.equal(corrected.memory.expiresAt,expiresAt);assert.match(corrected.memory.source,/DSH 会话 synthetic-chat/);
  assert.throws(()=>call({action:'remember',id:first.memory.id,source:'ambiguous',clearExpiry:true,expiresAt}),/不能同时/);
  const kept=call({action:'remember',id:first.memory.id,source:'Explicit keep permanently',clearExpiry:true});assert.equal(kept.memory.expiresAt,null);assert.equal(kept.memory.id,first.memory.id);
  assert.match(personalPrompt(store.config(),assistant.context(),{id:'synthetic',manual:true,xReady:false}),/纠正已有记忆保留原有效期/);
});

test('a hidden expired memory can be recorded again with an explicit new expiry without reviving its old source',t=>{
  const {assistant}=fixture(t);let now=new Date(2026,9,29,12).getTime();t.mock.method(Date,'now',()=>now);
  for(const kind of ['permanent','temporary']){
    const text='Synthetic repeated state '+kind,old=assistant.remember({text,source:'Synthetic former statement',category:'fact',expiresAt:now+1});
    now+=2;assert.equal(assistant.memories().some(row=>row.id===old.id),false);
    const expiresAt=kind==='permanent'?null:now+60000;
    const renewed=assistant.remember({text,source:'Synthetic new statement',category:'fact',expiresAt});
    assert.notEqual(renewed.id,old.id);assert.equal(renewed.source,'Synthetic new statement');assert.equal(renewed.expiresAt,expiresAt);
    assert.deepEqual(JSON.parse(fs.readFileSync(assistant.file('memories.json'),'utf8')).find(row=>row.id===old.id),old);
    assert.deepEqual(assistant.memories(text).filter(row=>row.text===text),[renewed]);
    assert.equal(assistant.remember({text,source:'Synthetic same active request',expiresAt}).id,renewed.id);
  }
});
