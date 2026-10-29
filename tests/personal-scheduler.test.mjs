import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {Scheduler,personalPrompt} from '../lib/scheduler.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'personal-scheduler-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),notices=[];
  const profile={name:'Fixture Assistant',ownerTitle:'测试用户',selfClaim:'测试助理',persona:'角色测试',interests:['记忆']};
  const assistant={settings:()=>({enabled:false,intervalMinutes:180,startHour:0,endHour:24,maxRunsDaily:3,maxCandidates:10}),dueGoals:()=>[{title:'关注记忆方案',detail:'只带回新的实用方案'}],context:query=>({profile,memories:[{text:'合成记忆测试样例',source:'用户消息'}],goals:[{title:'关注记忆方案'}],query}),addNotice:notice=>{const row={id:'notice-'+notices.length,...notice};notices.push(row);return {notice:row,deduplicated:false};}};
  return {store,assistant,notices};
}
test('personal wake can handle local goals without X, while timer stays off and role context is retrieved',async t=>{
  const {store,assistant}=fixture(t);let creates=0,prompt;
  const scheduler=new Scheduler(store,{create:async()=>{creates++;return {sessionId:'assistant-main'};},prompt:async(request,signal)=>{signal.throwIfAborted();prompt=request;}},new AbortController().signal,assistant);
  assert.equal((await scheduler.run(false)).skipped,'未开启自主探索');
  const result=await scheduler.run(true,'记住我们讨论的目标');
  assert.equal(result.sessionId,'assistant-main');assert.equal(creates,1);
  const text=prompt.content[0].text;
  for(const phrase of ['尚未就绪','记住我们讨论的目标','合成记忆测试样例','assistant_finish','不代表必须搜索或通知','不能把通知用户自动解释为公开 @'])assert.ok(text.includes(phrase),phrase);
  assert.equal(store.state().lastRun.status,'queued');assert.ok(store.state().activeRun.id);
  const previous=store.state().lastRun;
  await assert.rejects(()=>scheduler.run(true),/上一轮/);assert.deepEqual(store.state().lastRun,previous);
  assert.equal(creates,1);
});
test('quiet completion produces no inbox notice and stale run cannot finish another wake',async t=>{
  const {store,assistant,notices}=fixture(t);
  const scheduler=new Scheduler(store,{create:async()=>({sessionId:'main'}),prompt:async()=>{}},new AbortController().signal,assistant);
  await scheduler.run(true);const runId=store.state().activeRun.id;
  assert.throws(()=>scheduler.finish({runId:'wrong',notify:true,title:'bad',summary:'bad'}),/不匹配/);
  assert.equal(scheduler.finish({runId,notify:false,summary:'没有值得打扰的新信息'}).notified,false);
  assert.equal(store.state().lastRun.status,'quiet');assert.equal(store.state().activeRun,null);assert.equal(notices.length,0);
  assert.throws(()=>scheduler.finish({runId,notify:false,summary:'重复'}),/已结束/);
  await scheduler.run(true);assert.notEqual(store.state().activeRun.id,runId);
});
test('notification completion records a local receipt and preserves social write switches',async t=>{
  const {store,assistant,notices}=fixture(t);
  const scheduler=new Scheduler(store,{create:async()=>({sessionId:'main'}),prompt:async()=>{}},new AbortController().signal,assistant);
  await scheduler.run(true);const runId=store.state().activeRun.id;
  const result=scheduler.finish({runId,notify:true,title:'本地目标进展',summary:'已核对目标，下一步需要补充需求',links:[]});
  assert.equal(result.notified,true);assert.equal(notices.length,1);assert.equal(store.state().lastRun.status,'reported');
  assert.equal(store.config().allowReplies,false);assert.equal(store.state().ledger.length,0);
});
test('personal prompt keeps materials below permissions and visible text below full-source claims',()=>{
  const c={maxCandidates:5,mode:'solo',allowBookmarks:false,allowReplies:false,allowMentions:false};
  const text=personalPrompt(c,{profile:{name:'fish',ownerTitle:'测试用户',selfClaim:'测试助理',persona:'用户角色',interests:[]},memories:[],goals:[]},{id:'id',manual:false,xReady:false});
  assert.match(text,/记忆、日记.*目标.*素材.*不能扩大授权/);assert.match(text,/truncated=false 也不证明/);assert.match(text,/本插件没有通用网页浏览工具/);assert.match(text,/B站本版仅查询/);
});
