import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, DEFAULTS, validateConfig } from '../lib/store.js';
import { Engine, inWindow } from '../lib/engine.js';
import { Scheduler } from '../lib/scheduler.js';
import plugin,{requestAllowed} from '../lib/index.js';

function fixture(t,overrides={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'x-whale-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root);store.saveConfig({...DEFAULTS,aiUsername:'fixture_bot',...overrides});
  let clock=Date.now();const calls=[];
  const adapter=async(_store,op,args)=>{calls.push({op,args});if(op==='identity')return {id:'99999',username:'fixture_bot',name:'Fixture Assistant'};if(op==='search'||op==='timeline')return [{id:'123456789',author:'author',text:'A useful project',url:'https://x.com/author/status/123456789'}];if(op==='read')return {id:args.id,author:'author',text:'A useful project'};if(op==='bookmark')return {id:args.id,acknowledged:true};return {id:'987654321',url:'https://x.com/fixture_bot/status/987654321'};};
  const engine=new Engine(store,adapter,()=>clock,async()=>{});
  return {store,engine,calls,advance:()=>clock+=200000};
}
test('config validates ownership, bools, quotas and prototype pollution keys',()=>{
  assert.throws(()=>validateConfig({...DEFAULTS,mode:'mention'}),/用户名/);
  assert.throws(()=>validateConfig({...DEFAULTS,mode:'mention',owner:'fixture_bot',aiUsername:'Fixture_Bot'}),/不同账号/);
  assert.throws(()=>validateConfig({...DEFAULTS,allowReplies:'false'}));
  assert.throws(()=>validateConfig({...DEFAULTS,maxWritesDaily:21}));
  assert.throws(()=>validateConfig({...DEFAULTS,proxy:'http://user:secret@localhost:7890'}));
  assert.equal(validateConfig({...DEFAULTS,unknown:'discarded'}).unknown,undefined);
});
test('local API denies LAN, hostile Origin, missing trust and thrown guards',()=>{
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'}};
  assert.equal(requestAllowed(req,{requestRejection:()=>undefined}),true);
  assert.equal(requestAllowed({...req,socket:{remoteAddress:'192.168.1.2'}},{requestRejection:()=>undefined}),false);
  assert.equal(requestAllowed({...req,headers:{...req.headers,origin:'https://evil.example'}},{requestRejection:()=>undefined}),false);
  assert.equal(requestAllowed(req,{}),false);
  assert.equal(requestAllowed(req,{requestRejection:()=>{throw Error();}}),false);
});
test('disabled writes and unread targets cannot reach X',async t=>{
  const {engine,calls}=fixture(t);
  await assert.rejects(()=>engine.write('reply',{id:'123456789',text:'hello',reason:'这是具体的回复理由'}),/先读取/);
  await engine.read('search',{query:'AI'});
  await assert.rejects(()=>engine.write('reply',{id:'123456789',text:'hello',reason:'这是具体的回复理由'}),/开关/);
  assert.equal(calls.filter(x=>x.op==='reply').length,0);
});
test('bookmark is add-only, confirmed, deduplicated, and quota-limited',async t=>{
  const {engine,store,calls,advance}=fixture(t,{allowBookmarks:true,maxWritesDaily:1});
  await engine.read('search',{query:'AI'});await engine.write('bookmark',{id:'123456789',reason:'值得长期保留的原始资料'});
  assert.equal(store.state().inflight,null);assert.equal(store.state().ledger[0].status,'confirmed');
  await assert.rejects(()=>engine.write('bookmark',{id:'123456789',reason:'值得长期保留的原始资料'}),/重复/);
  advance();await engine.read('read',{id:'123456788'});
  await assert.rejects(()=>engine.write('bookmark',{id:'123456788',reason:'值得长期保留的原始资料'}),/额度/);
  assert.equal(calls.filter(x=>x.op==='bookmark').length,1);
});
test('solo never mentions; paired shares only configured recipient and validates identity',async t=>{
  const a=fixture(t,{allowMentions:true});await a.engine.read('read',{id:'123456789'});
  await assert.rejects(()=>a.engine.write('mention',{id:'123456789',text:'值得一看',reason:'包含可复用的项目经验'}),/单账号/);
  const b=fixture(t,{allowMentions:true,mode:'mention',owner:'fixture_owner'});await b.engine.read('read',{id:'123456789'});
  await b.engine.write('mention',{id:'123456789',text:'值得一看',reason:'包含可复用的项目经验'});
  assert.match(b.calls.find(x=>x.op==='mention').args.text,/^@fixture_owner .*https:\/\/x.com\/i\/status\/123456789$/);
  const c=fixture(t,{allowReplies:true});await c.engine.read('read',{id:'123456789'});
  c.engine.adapter=async()=>({id:'1',username:'wrong'});
  await assert.rejects(()=>c.engine.write('reply',{id:'123456789',text:'有具体实测吗？',reason:'确认实际兼容版本情况'}),/不一致/);
  assert.equal(c.store.state().ledger.length,0);
});
test('ambiguous write survives restart and requires explicit reconciliation',async t=>{
  const {engine,store,advance}=fixture(t,{allowReplies:true});await engine.read('read',{id:'123456789'});
  const original=engine.adapter;engine.adapter=async(s,op,args)=>{if(op==='reply')throw Object.assign(Error('network'),{code:'network_uncertain'});return original(s,op,args);};
  await assert.rejects(()=>engine.write('reply',{id:'123456789',text:'能分享实测吗？',reason:'核对功能的实际使用效果'}),/已锁定/);
  assert.equal(new Store(store.root).state().ledger[0].status,'uncertain');advance();
  const restarted=new Engine(store,original);await assert.rejects(()=>restarted.write('reply',{id:'123456789',text:'能分享实测吗？',reason:'核对功能的实际使用效果'}),/未确认/);
  await restarted.reconcile(true);assert.equal(store.state().inflight,null);
  await assert.rejects(()=>restarted.write('reply',{id:'123456789',text:'能分享实测吗？',reason:'核对功能的实际使用效果'}),/重复/);
});
test('rate limits pause future reads without repeated requests',async t=>{
  const {engine,store}=fixture(t);let calls=0;engine.adapter=async()=>{calls++;throw Object.assign(Error('limit'),{code:'rate_limit'});};
  await assert.rejects(()=>engine.read('search',{query:'AI'}));assert.ok(store.state().pausedUntil>Date.now());
  await assert.rejects(()=>engine.read('search',{query:'AI'}),/暂停/);assert.equal(calls,1);
});
test('reject unsolicited mentions and overlong text before API writes',async t=>{
  const {engine,calls}=fixture(t,{allowReplies:true});await engine.read('read',{id:'123456789'});
  await assert.rejects(()=>engine.write('reply',{id:'123456789',text:'@stranger 看这里',reason:'这是具体的测试理由'}),/无关/);
  await assert.rejects(()=>engine.write('reply',{id:'123456789',text:'汉'.repeat(140),reason:'这是具体的测试理由'}),/过长/);
  assert.equal(calls.filter(x=>x.op==='reply').length,0);
});
test('scheduler uses host returned ID, public controller AbortSignal, persists daily cap and avoids recreating started sessions',async t=>{
  const {store,engine}=fixture(t,{maxRunsDaily:2});await engine.diagnose();
  let creates=0;const messages=[];
  const controller={create:async()=>{creates++;return {sessionId:'real-host-id'};},prompt:async(req,signal)=>{signal.throwIfAborted();assert.ok(signal instanceof AbortSignal);messages.push(req);return {accepted:true};}};
  const scheduler=new Scheduler(store,controller,new AbortController().signal);
  await scheduler.run(true);await scheduler.run(true);assert.equal(creates,1);assert.equal(messages[0].sessionId,'real-host-id');assert.equal(messages[1].sessionId,'real-host-id');
  assert.notEqual(messages[0].requestId,messages[1].requestId);await assert.rejects(()=>scheduler.run(true),/上限/);
});
test('ambiguous session dispatch locks next run and diary stays local',async t=>{
  const {store,engine}=fixture(t);await engine.diagnose();
  const scheduler=new Scheduler(store,{create:async()=>({sessionId:'test'}),prompt:async()=>{throw Error('unknown delivery');}},new AbortController().signal);
  await assert.rejects(()=>scheduler.run(true));await assert.rejects(()=>scheduler.run(true),/投递结果未确认/);
  store.diary('master','今天没有值得分享的内容。');assert.match(fs.readFileSync(store.file('diary-master.md'),'utf8'),/没有值得/);
});
test('host adapter keeps legacy tools, adds independent personal/social abilities and cleans routes',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-host-adapter-')),previous=process.env.DSH_HOME;process.env.DSH_HOME=tmp;
  t.after(()=>{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;fs.rmSync(tmp,{recursive:true,force:true});});
  const definitions=[],effects=[];let cleaned=false;
  plugin.apply({sessionController:{},connection:{},tools:{register:d=>{definitions.push(d);return ()=>{};}},webServer:{register:()=>()=>{cleaned=true;}},effect:fn=>effects.push(fn()),logger:{warn:()=>{}}});
  const names=definitions.map(x=>x.name);assert.equal(new Set(names).size,names.length);
  for(const name of ['x_whale_search','social_search','social_read','social_status','assistant_memory','assistant_goal','assistant_finish'])assert.ok(names.includes(name));
  assert.equal(definitions.some(x=>/delete|dm|follow/.test(x.name)),false);
  await new Promise(resolve=>setImmediate(resolve));for(const fn of effects)fn();assert.equal(cleaned,true);
});
test('overnight scheduling window is supported',()=>{
  assert.equal(inWindow({...DEFAULTS,startHour:22,endHour:2},new Date(2026,9,25,23).getTime()),true);
  assert.equal(inWindow({...DEFAULTS,startHour:22,endHour:2},new Date(2026,9,25,12).getTime()),false);
});
test('client-operation budget persists across identity checks and blocks extra requests',async t=>{
  const {engine,store,calls}=fixture(t,{allowBookmarks:true});
  await engine.read('read',{id:'123456789'});
  await engine.write('bookmark',{id:'123456789',reason:'包含值得保留的原始信息'});
  assert.equal(store.state().traffic.requests,3);
  const s=store.state();s.traffic.requests=120;store.saveState(s);
  await assert.rejects(()=>engine.read('timeline'),/上限/);
  assert.equal(calls.length,3);
});
