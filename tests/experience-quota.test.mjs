import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../lib/store.js';
import {ExperienceStore} from '../lib/experience-store.js';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-quota-'));t.after(()=>{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true});});const store=new Store(root);return {store,experiences:new ExperienceStore(store,{now:()=>1800000000000})};}
const source={id:'synthetic-receipt',platform:'bilibili',operation:'read',reference:'BV1GJ411x7h7',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic title',excerpt:'Synthetic description',scope:'Metadata only',truncated:false,readAt:1799999999000};
const request=(session,i)=>({id:session+'-episode-'+i,runId:'synthetic-run',mainSessionId:session,title:'Synthetic interest '+i,question:'Why?',thought:'Synthetic thought',reason:'Synthetic reason',nextQuestion:'Next?',sources:[source],origin:'fish'});

test('active interest allowance is independent per main session and survives reload',t=>{
  const f=fixture(t),old=[];for(let i=0;i<5;i++)old.push(f.experiences.record(request('old-main',i)).interest);
  assert.equal(f.experiences.interests('new-main').length,0);
  const fresh=[];for(let i=0;i<5;i++)fresh.push(f.experiences.record(request('new-main',i)).interest);
  assert.throws(()=>f.experiences.record(request('old-main',6)),/已满/);
  assert.throws(()=>f.experiences.record(request('new-main',6)),/已满/);
  f.experiences.setInterest(fresh[0].id,'paused');assert.equal(f.experiences.setInterest(old[0].id,'active').status,'active');
  assert.equal(f.experiences.chooseInterest({mainSessionId:'new-main',random:()=>0.01}),null);
  f.experiences.record(request('new-main',6));assert.throws(()=>f.experiences.setInterest(fresh[0].id,'active'),/已满/);
  assert.ok(f.experiences.chooseInterest({mainSessionId:'old-main',random:()=>0.01}));
  const reloaded=new ExperienceStore(f.store,{now:()=>1800000000000});assert.equal(reloaded.interests('old-main').length,5);assert.equal(reloaded.interests('new-main').filter(row=>row.status==='active').length,5);
  const data=reloaded.state();data.interests.find(row=>row.id===fresh[0].id).status='active';atomic(reloaded.file(),data);assert.throws(()=>reloaded.state(),/数量不一致/);
});

test('global 30 interest capacity is retained across sessions',t=>{
  const f=fixture(t);for(let s=0;s<6;s++)for(let i=0;i<5;i++)f.experiences.record(request('main-'+s,i));
  assert.throws(()=>f.experiences.record(request('main-6',0)),/总数已满/);
  assert.ok(f.experiences.chooseInterest({mainSessionId:'main-0',random:()=>0.01}));
});
