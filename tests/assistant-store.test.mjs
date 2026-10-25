import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store,DEFAULTS,atomic} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';

function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'personal-store-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const legacy=new Store(dir);return {dir,legacy,assistant:new AssistantStore(legacy)};}

test('read-only legacy fallback migrates independently only on first write',t=>{
  const {dir,legacy,assistant}=fixture(t);legacy.saveConfig({...DEFAULTS,name:'旧角色',enabled:false});legacy.saveState({identity:{username:'old'},runs:{today:2},sessionId:'unchanged'});atomic(legacy.file('credentials.json'),{codec:'opaque',data:'DO_NOT_TOUCH'});fs.writeFileSync(legacy.file('diary-master.md'),'旧日记，不可当成用户事实');
  const before=fs.readFileSync(legacy.file('config.json'),'utf8'),state=fs.readFileSync(legacy.file('state.json'),'utf8'),credential=fs.readFileSync(legacy.file('credentials.json'),'utf8');
  assert.equal(assistant.profile().name,'旧角色');assert.equal(assistant.settings().enabled,false);assert.equal(fs.existsSync(path.join(dir,'assistant')),false);assert.deepEqual(assistant.memories(),[]);
  assistant.saveProfile({name:'新角色'});assert.equal(assistant.profile().name,'新角色');assert.equal(fs.readFileSync(legacy.file('config.json'),'utf8'),before);assert.equal(fs.readFileSync(legacy.file('state.json'),'utf8'),state);assert.equal(fs.readFileSync(legacy.file('credentials.json'),'utf8'),credential);
  legacy.saveConfig({...DEFAULTS,name:'再次修改旧版'});assert.equal(assistant.profile().name,'新角色');assert.deepEqual(assistant.memories(),[]);
});

test('relevant recall handles Chinese phrases and ranks matches before recent unrelated memories',t=>{
  const {assistant}=fixture(t);const useful=assistant.remember({text:'合成条目：长期记忆检索测试，平台标签为 SampleOS。',category:'preference',source:'用户当前对话'});assistant.remember({text:'合成条目：火山地质分类。',category:'preference',source:'用户当前对话'});
  assert.equal(assistant.memories('长期记忆')[0].id,useful.id);assert.deepEqual(assistant.memories('量子卫星'),[]);assert.equal(assistant.memories('SampleOS')[0].id,useful.id);assert.equal(assistant.remember({text:useful.text,category:'preference',source:'重复说法'}).id,useful.id);assert.equal(assistant.memories().length,2);
});

test('correction replaces old text and forgetting removes it from disk and recall',t=>{
  const {assistant}=fixture(t);const row=assistant.remember({text:'优先选择云端工具',category:'preference',source:'旧对话'});const updated=assistant.remember({id:row.id,text:'优先选择本地工具',source:'用户纠正'});
  assert.equal(updated.createdAt,row.createdAt);assert.deepEqual(assistant.memories('云端'),[]);assert.equal(assistant.memories('本地')[0].id,row.id);
  assistant.forget(row.id);assert.deepEqual(assistant.memories(),[]);assert.ok(!fs.readFileSync(assistant.file('memories.json'),'utf8').includes('本地工具'));assert.throws(()=>assistant.remember({id:row.id,text:'旧ID暗创',source:'错误'}),/不存在/);
});

test('expired observations are excluded from context and snapshot counts',t=>{
  const {assistant}=fixture(t);assistant.remember({text:'某候选本周仍待验证',category:'observation',source:'页面观察',expiresAt:Date.now()-1});assistant.remember({text:'使用 Windows',category:'fact',source:'用户说明'});
  assert.equal(assistant.context().memories.length,1);assert.equal(assistant.snapshot().stats.memoryCount,1);assert.doesNotThrow(()=>JSON.parse(JSON.stringify(assistant.snapshot())));
});

test('goals retain progress and scheduling while paused and done goals are not due',t=>{
  const {assistant}=fixture(t);const now=Date.now(),due=assistant.saveGoal({title:'留意本地记忆方案',mode:'watch',detail:'只筛真正落地的',nextCheckAt:now-1});assistant.saveGoal({title:'明天再看',nextCheckAt:now+86400000});assistant.saveGoal({title:'暂停项',status:'paused'});assistant.saveGoal({title:'完成项',status:'done'});
  assert.deepEqual(assistant.dueGoals(now).map(row=>row.id),[due.id]);const updated=assistant.saveGoal({id:due.id,progress:'已核对一个候选'});assert.equal(updated.detail,due.detail);assert.equal(updated.nextCheckAt,due.nextCheckAt);assistant.saveGoal({id:due.id,status:'done'});assert.deepEqual(assistant.dueGoals(now),[]);assistant.deleteGoal(due.id);assert.throws(()=>assistant.saveGoal({id:due.id,title:'暗创'}),/不存在/);
});

test('inbox deduplicates notices and preserves read state instead of notifying again',t=>{
  const {assistant}=fixture(t);const input={title:'发现一个候选',body:'需要进一步验证，来源是作者说法。',links:[{title:'原帖',url:'https://x.com/user/status/123'}]};const first=assistant.addNotice(input);assert.equal(first.deduplicated,false);assert.equal(assistant.snapshot().stats.unread,1);assistant.readNotice(first.notice.id);const duplicate=assistant.addNotice(input);assert.equal(duplicate.deduplicated,true);assert.ok(duplicate.notice.readAt);assert.equal(assistant.notices().length,1);assert.equal(assistant.snapshot().stats.unread,0);
  assistant.addNotice({...input,key:'goal-unique'});assert.equal(assistant.addNotice({...input,key:'goal-unique',body:'同一去重标识'}).deduplicated,true);
});

test('notice links deduplicate the same discovery despite rewritten prose, link order and tracking',t=>{
  const {assistant}=fixture(t);const first=assistant.addNotice({title:'一个候选',body:'先看原始说明',links:[{url:'https://x.com/Author/status/123?s=20&t=tracking'},{url:'https://example.com/guide?b=2&a=1&utm_source=x#intro'}]});
  const repeated=assistant.addNotice({title:'换一个标题',body:'摘要换了措辞',links:[{url:'https://example.com/guide?a=1&b=2'},{url:'https://twitter.com/author/status/123'}]});
  assert.equal(repeated.deduplicated,true);assert.equal(repeated.notice.id,first.notice.id);
  assert.equal(assistant.addNotice({title:'真正的新进展',body:'已完成新的验证',links:[{url:'https://x.com/author/status/123'},{url:'https://example.com/guide?a=1&b=2'}],key:'verified-next-step'}).deduplicated,false);
  const context=assistant.context();assert.equal(context.recentNotices.length,2);assert.deepEqual(Object.keys(context.recentNotices[0]).sort(),['createdAt','id','links','title']);assert.equal(assistant.memories().length,0);
});

test('credential URL parameters including encoded keys never reach disk',t=>{
  const {dir,assistant}=fixture(t);for(const url of ['https://example.com/?auth_token=SECRET123','https://example.com/?auth%5Ftoken=SECRET123','https://example.com/?TOKEN=SECRET123','https://example.com/?api_key=SECRET123','https://example.com/#ct0=SECRET123'])assert.throws(()=>assistant.addNotice({title:'不得写入',body:'普通说明',links:[{url}]}),/凭据|Cookie/);
  assert.equal(fs.existsSync(path.join(dir,'assistant')),false);
  assistant.addNotice({title:'正常链接',body:'只有公开链接',links:[{url:'https://example.com/?q=memory'}]});const saved=fs.readFileSync(assistant.file('inbox.json'),'utf8');assert.ok(saved.includes('q=memory'));assert.ok(!saved.includes('SECRET123'));
});

test('corrupted records fail closed instead of leaking arbitrary fields into snapshots',t=>{
  const {assistant}=fixture(t);const row=assistant.remember({text:'仅有效字段',source:'用户说明'});atomic(assistant.file('memories.json'),[{...row,credential:'DO_NOT_EXPOSE'}]);assert.throws(()=>assistant.snapshot(),/字段/);
  atomic(assistant.file('memories.json'),[{...row,category:'unsupported'}]);assert.throws(()=>assistant.context(),/分类/);
  atomic(assistant.file('memories.json'),[{...row,createdAt:null}]);assert.throws(()=>assistant.snapshot(),/创建时间/);
});

test('model context bounds persona and due goals while preserving complete editable records',t=>{
  const {assistant}=fixture(t),persona='稳定角色设定。'.repeat(700);assistant.saveProfile({persona});
  for(let i=0;i<8;i++)assistant.saveGoal({title:'持续目标'+i,detail:'完整目标说明'.repeat(400),nextCheckAt:0});
  for(let i=0;i<12;i++)assistant.remember({text:'有效记忆'+i,category:'fact',source:'用户当前对话'});
  const context=assistant.context('',3);assert.equal(context.profile.persona.length,3000);assert.equal(context.personaTruncated,true);assert.equal(context.goals.length,5);assert.equal(context.moreDueGoals,true);assert.equal(context.memories.length,3);
  assert.equal(assistant.profile().persona,persona);assert.equal(assistant.snapshot().profile.persona,persona);assert.equal(assistant.goals('all').length,8);assert.equal(assistant.dueGoals().length,8);assert.equal(context.goals[0].detail,'完整目标说明'.repeat(400));
  for(const goal of assistant.goals('all').slice(0,4))assistant.saveGoal({id:goal.id,status:'paused'});
  assistant.saveProfile({persona:'简短设定'});const smaller=assistant.context();assert.equal(smaller.personaTruncated,false);assert.equal(smaller.goals.length,4);assert.equal(smaller.moreDueGoals,false);
});

test('malformed fields, unknown IDs and secrets fail without creating personal files',t=>{
  const {dir,assistant}=fixture(t);for(const text of ['auth_token=SECRET123','"ct0": "SECRET"','Cookie: session=secret','-----BEGIN PRIVATE KEY-----\nabc'])assert.throws(()=>assistant.remember({text,source:'不要保存'}),/Cookie/);
  assert.throws(()=>assistant.saveProfile({allowReplies:true}),/字段/);assert.throws(()=>assistant.saveSettings({intervalMinutes:1}),/范围/);assert.throws(()=>assistant.saveGoal({title:'目标',status:'fake'}),/无效/);assert.throws(()=>assistant.saveGoal({id:crypto.randomUUID(),title:'不存在'}),/不存在/);assert.throws(()=>assistant.remember({text:'正常',source:'用户',expiresAt:NaN}),/时间戳/);assert.throws(()=>assistant.addNotice({title:'标题',body:'正文',links:[{url:'javascript:alert(1)'}]}),/HTTP/);assert.throws(()=>assistant.addNotice({title:'标题',body:'正文',links:[{url:'https://name:password@example.com/'}]}),/HTTP/);assert.equal(fs.existsSync(path.join(dir,'assistant')),false);
});
