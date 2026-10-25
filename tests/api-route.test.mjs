import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import plugin from '../lib/index.js';
import { DEFAULTS } from '../lib/store.js';

test('settings API matches host prefix boundaries and preserves endpoint dispatch',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'x-whale-route-test-'));
  const previousHome=process.env.DSH_HOME;
  process.env.DSH_HOME=root;
  let route;
  const cleanup=[];
  t.after(()=>{
    for(const dispose of cleanup.reverse())if(typeof dispose==='function')dispose();
    if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
    fs.rmSync(root,{recursive:true,force:true});
  });
  plugin.apply({
    sessionController:{},connection:{requestRejection:()=>undefined},
    tools:{register:()=>()=>{}},
    webServer:{register:definition=>{route=definition;return ()=>{};}},
    effect:effect=>cleanup.push(effect()),logger:{warn:()=>{}}
  });
  // Match the shipped dsh-host-webserver contract: it appends its own slash.
  const matches=pathname=>pathname===route.path||pathname.startsWith(`${route.path}/`);
  async function dispatch(method,url,body){
    const pathname=new URL(url,'http://127.0.0.1:3000').pathname;
    if(!matches(pathname))return {status:404,data:{error:'host route not found'}};
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method,url,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'}});
    let result;
    const res={statusCode:0,setHeader:()=>{},end:text=>{result={status:res.statusCode,data:JSON.parse(text)};}};
    await route.handler(req,res);
    return result;
  }
  const state=await dispatch('GET','/x-whale/api/state');
  assert.equal(state.status,200);
  assert.equal(state.data.ok,true);
  assert.equal(matches('/x-whale/apievil/state'),false);
  const saved=await dispatch('POST','/x-whale/api/config',{...DEFAULTS,name:'Route probe'});
  assert.equal(saved.status,200);
  assert.equal((await dispatch('GET','/x-whale/api/state?fresh=1')).data.config.name,'Route probe');
  const diary=await dispatch('GET','/x-whale/api/diary');
  assert.equal(diary.status,200);
  assert.deepEqual(diary.data.diaries,{master:'',private:''});
  const personal=await dispatch('GET','/x-whale/api/assistant');
  assert.equal(personal.data.profile.name,'Route probe');assert.equal(personal.data.settings.enabled,false);
  const role=await dispatch('POST','/x-whale/api/assistant/profile',{name:'独立角色'});
  assert.equal(role.data.profile.name,'独立角色');
  assert.equal((await dispatch('GET','/x-whale/api/state')).data.config.name,'Route probe');
  const memory=await dispatch('POST','/x-whale/api/assistant/memory',{text:'用户偏好有来源的推荐',category:'preference',source:'用户在设置页填写'});
  assert.equal(memory.status,200);
  assert.equal((await dispatch('GET','/x-whale/api/assistant')).data.stats.memoryCount,1);
  assert.equal((await dispatch('POST','/x-whale/api/assistant/forget',{id:memory.data.memory.id})).status,200);
  const goal=await dispatch('POST','/x-whale/api/assistant/goal',{title:'关注本地工具',mode:'watch'});
  assert.equal(goal.status,200);
  assert.equal((await dispatch('POST','/x-whale/api/assistant/goal',{id:goal.data.goal.id,status:'paused'})).data.goal.status,'paused');
  assert.equal((await dispatch('GET','/x-whale/api/state')).data.config.allowReplies,false);
  assert.equal((await dispatch('POST','/x-whale/api/assistant/settings',{allowReplies:true})).status,400);
});
