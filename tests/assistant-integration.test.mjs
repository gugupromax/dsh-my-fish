import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin from '../lib/index.js';
import {Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {personalContextText} from '../lib/assistant-context.js';

test('memory and goals work from ordinary chats, corrections/forgetting reach the scoped per-step context',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'assistant-integration-')),old=process.env.DSH_HOME;
  process.env.DSH_HOME=tmp;const tools=new Map(),effects=[],contexts=[];
  t.after(()=>{for(const cleanup of effects)cleanup();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;fs.rmSync(tmp,{recursive:true,force:true});});
  plugin.apply({sessionController:{},connection:{},tools:{register:d=>{tools.set(d.name,d);return ()=>{};}},webServer:{register:()=>()=>{}},effect:f=>effects.push(f()),logger:{warn:()=>{}},inject:(services,fn)=>{assert.ok(['systemPrompt','taskBoard','agents','workingDirectory','sessions','sessionPersistence'].includes(services[0]));if(services[0]==='systemPrompt')fn({systemPrompt:{context:d=>{contexts.push(d);return ()=>{};}}});}});
  const exec={signal:new AbortController().signal,agent:{session:{id:'ordinary'}}};
  const call=(name,args)=>tools.get(name).execute(args,exec);
  const result=await call('assistant_memory',{action:'remember',text:'合成用户偏好火山分类的记忆方案',category:'preference',source:'合成夹具说明'});
  const id=result.memory.id;
  assert.equal((await call('assistant_memory',{action:'recall',query:'记忆方案'})).memories.length,1);
  await call('assistant_memory',{action:'remember',id,text:'合成用户偏好珊瑚生态的记忆方案',source:'合成夹具更正'});
  assert.equal((await call('assistant_memory',{action:'recall',query:'火山分类'})).memories.length,0);
  const goal=await call('assistant_goal',{action:'save',title:'跟进记忆方案',mode:'watch'});
  await call('assistant_goal',{action:'save',id:goal.goal.id,status:'paused'});
  assert.equal((await call('assistant_goal',{action:'list'})).goals[0].status,'paused');
  const store=new Store(),assistant=new AssistantStore(store),s=store.state();s.sessionId='personal';store.saveState(s);
  assert.equal(contexts[0].required,true);assert.equal(contexts[0].text({agent:{session:{id:'ordinary'}}}), '');
  const personal={agent:{session:{id:'personal'}}};
  assert.match(contexts[0].text(personal),/合成用户偏好珊瑚生态/);
  await call('assistant_memory',{action:'forget',id});
  assert.ok(!contexts[0].text(personal).includes('合成用户偏好珊瑚生态'));
  assert.equal(assistant.snapshot().stats.memoryCount,0);
  assert.equal(store.config().enabled,false);assert.equal(store.config().allowReplies,false);
  await assert.rejects(()=>call('assistant_finish',{runId:'anything',notify:false,summary:'完成'}),/专用/);
  await assert.rejects(()=>call('social_action',{platform:'x',action:'reply',reference:'123456',text:'hi',reason:'普通会话不能写入'}),/专用/);
});

test('per-step context is bounded, uses current records and never enters an unrelated session',()=>{
  const store={state:()=>({sessionId:'personal',activeRun:{id:'run',query:'当前目标'}})};
  const assistant={dueGoals:()=>[],context:query=>({profile:{name:'Fixture Assistant',ownerTitle:'测试用户',selfClaim:'测试助理',persona:'a'.repeat(4000),interests:[]},memories:[{text:query}],goals:[]})};
  assert.equal(personalContextText(store,assistant,{agent:{session:{id:'other'}}}),'');
  const text=personalContextText(store,assistant,{agent:{session:{id:'personal'}}});
  assert.match(text,/当前目标/);assert.ok(!text.includes('a'.repeat(3001)));assert.match(text,/不会授予浏览器、公开发帖/);
});
