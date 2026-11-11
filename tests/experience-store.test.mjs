import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../lib/store.js';
import {ExperienceStore} from '../lib/experience-store.js';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-experiences-'));t.after(()=>{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true});});const store=new Store(root);let now=1800000000000;const experiences=new ExperienceStore(store,{now:()=>now});return {store,experiences,advance:()=>now+=1000};}
const source=(extra={})=>({id:'receipt-synthetic',platform:'bilibili',operation:'read',reference:'BV1GJ411x7h7',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic title',excerpt:'Synthetic video description',scope:'Metadata only; no video viewed',truncated:false,readAt:1799999999000,...extra});
const request=(extra={})=>({id:'synthetic-episode',runId:'synthetic-run',mainSessionId:'synthetic-main',title:'Synthetic game design',question:'Why make this choice?',thought:'Synthetic first interpretation',reason:'A specific part of the actual description',nextQuestion:'Look for another example',sources:[source()],origin:'fish',...extra});

test('empty experience reads are side-effect free and recording preserves source-backed changes without touching persona or state',t=>{
  const f=fixture(t);assert.deepEqual(f.experiences.state(),{version:1,interests:[],episodes:[],tombstones:{interestIds:[],episodeIds:[]}});assert.equal(fs.existsSync(f.experiences.file()),false);
  const result=f.experiences.record(request());assert.equal(result.episode.before,'');assert.equal(result.interest.currentThought,'Synthetic first interpretation');assert.deepEqual(result.episode.sources,[source()]);
  f.advance();const second=f.experiences.record(request({id:'synthetic-next',interestId:result.interest.id,before:result.interest.currentThought,thought:'Synthetic revised interpretation'}));
  assert.equal(second.episode.before,'Synthetic first interpretation');assert.equal(second.interest.currentThought,'Synthetic revised interpretation');assert.equal(f.experiences.episodes().length,2);
  assert.equal(fs.existsSync(f.store.file('state.json')),false);assert.equal(fs.existsSync(f.store.file('assistant/profile.json')),false);assert.equal(fs.existsSync(f.store.file('assistant/companion.json')),false);
});

test('stable record requests replay unchanged after later opinions but reject changed requests and stale before values',t=>{
  const f=fixture(t),first=f.experiences.record(request());f.advance();f.experiences.record(request({id:'synthetic-next',interestId:first.interest.id,thought:'Synthetic newer thought'}));
  const reloaded=new ExperienceStore(f.store,{now:()=>1800000001000});const replay=reloaded.record(request());assert.equal(replay.deduplicated,true);assert.equal(replay.episode.thought,'Synthetic first interpretation');assert.equal(replay.interest.currentThought,'Synthetic newer thought');
  assert.throws(()=>f.experiences.record(request({reason:'Different request'})),/同一经历/);
  assert.throws(()=>f.experiences.record(request({id:'stale-update',interestId:first.interest.id,before:'Synthetic first interpretation'})),/看法已变化/);
  assert.throws(()=>f.experiences.record(request({id:'fabricated-before',before:'An unrecorded prior opinion'})),/新兴趣/);
});

test('record rejects search summaries, unsupported or sensitive fields and malformed URLs before writing',t=>{
  const f=fixture(t);const invalid=[request({sources:[]}),request({sources:[source({operation:'search'})]}),request({sources:[source({url:'https://example.com/?access_token=synthetic-secret-value'})]}),request({sources:[source({url:'https://127.0.0.1/private'})]}),request({sources:[source({url:'https://192.168.1.2/private'})]}),request({sources:[source({url:'file:///private'})]}),request({sources:[source({opaqueSecret:'untrusted'})]}),request({sources:[source({readAt:1800000060001})]}),request({sources:[source({truncated:'no'})]}),request({sources:[source(),source()]}),request({thought:'auth_token=SYNTHETIC_SECRET'}),request({reason:'Read E:\\Private\\file'}),request({question:'%70assword%3DSYNTHETIC_SECRET'}),request({opaqueSecret:'SYNTHETIC_SECRET'})];
  for(const value of invalid)assert.throws(()=>f.experiences.record(value));assert.equal(fs.existsSync(f.experiences.file()),false);
});

test('context and exploration choices never cross main-session ownership and paused interests stop recall and recording',t=>{
  const f=fixture(t),first=f.experiences.record(request());f.advance();f.experiences.record(request({id:'foreign-episode',mainSessionId:'synthetic-foreign',title:'Foreign topic'}));
  assert.deepEqual(f.experiences.context('Synthetic'),{interests:[],episodes:[]});const context=f.experiences.context('Synthetic game','synthetic-main');assert.equal(context.interests.length,1);assert.equal(context.episodes.length,1);assert.equal(context.episodes[0].mainSessionId,'synthetic-main');
  assert.equal(f.experiences.chooseInterest({random:()=>0.7}),null);assert.equal(f.experiences.chooseInterest({mainSessionId:'synthetic-main',random:()=>0}),null);assert.equal(f.experiences.chooseInterest({mainSessionId:'synthetic-main',random:()=>0.7}).id,first.interest.id);
  assert.throws(()=>f.experiences.record(request({id:'cross-update',mainSessionId:'synthetic-foreign',interestId:first.interest.id})),/不属于/);
  f.experiences.setInterest(first.interest.id,'paused');assert.equal(f.experiences.context('game','synthetic-main').episodes.length,0);assert.throws(()=>f.experiences.record(request({id:'paused-update',interestId:first.interest.id})),/已放下/);f.experiences.setInterest(first.interest.id,'active');assert.equal(f.experiences.context('game','synthetic-main').episodes.length,1);
});

test('forget removes interests and their episodes and tombstones prevent old requests from reviving them',t=>{
  const f=fixture(t),first=f.experiences.record(request());f.experiences.forget(first.interest.id);assert.equal(f.experiences.interests().length,0);assert.equal(f.experiences.episodes().length,0);assert.equal(f.experiences.forget(first.interest.id).ok,true);
  assert.throws(()=>f.experiences.record(request()),/旧标识/);assert.throws(()=>f.experiences.record(request({id:'new-id',interestId:first.interest.id})),/旧标识/);assert.throws(()=>f.experiences.setInterest(first.interest.id,'active'),/不存在/);
});

test('verified user replies retain only bounded verbatim positions and source session audit fields survive reload',t=>{
  const f=fixture(t),first=f.experiences.record(request({sources:[source({sessionId:'synthetic-background'})]}));
  assert.equal(first.episode.sources[0].sessionId,'synthetic-background');
  for(let i=0;i<8;i++)f.experiences.respond({interestId:first.interest.id,messageId:'user-'+i,quote:'Synthetic actual user quote '+i,at:1799999999000+i},'synthetic-main');
  const topic=f.experiences.context('game','synthetic-main').interests[0];assert.equal(topic.userPositions.length,6);assert.equal(topic.userPositions[0].messageId,'user-2');assert.equal(topic.origin,'fish');
  assert.throws(()=>f.experiences.respond({interestId:first.interest.id,messageId:'cross-user',quote:'Synthetic quote',at:1799999999000},'synthetic-foreign'),/不属于/);
  assert.throws(()=>f.experiences.respond({interestId:first.interest.id,messageId:'bad',quote:'password=SYNTHETIC_SECRET',at:1799999999000},'synthetic-main'),/凭据/);
  const latest=topic.userPositions.at(-1);assert.equal(f.experiences.respond({interestId:first.interest.id,...latest},'synthetic-main').userPositions.length,6);
});

test('bounded episodes retain evidence snapshots and cannot be restored by evicted request IDs',t=>{
  const f=fixture(t),first=f.experiences.record(request());for(let i=1;i<=122;i++){f.advance();f.experiences.record(request({id:'episode-'+i,interestId:first.interest.id,thought:'Synthetic thought '+i,sources:[source({id:'source-'+i,excerpt:'Synthetic excerpt '+i})]}));}
  assert.equal(f.experiences.episodes().length,120);assert.equal(f.experiences.episodes()[0].id,'episode-3');assert.equal(f.experiences.episodes()[0].sources[0].excerpt,'Synthetic excerpt 3');assert.throws(()=>f.experiences.record(request()),/保留范围/);assert.ok(JSON.stringify(f.experiences.context('Synthetic','synthetic-main')).length<=16000);
});

test('active interest limits and strict persisted validation fail without rewriting records',t=>{
  const f=fixture(t);for(let i=0;i<5;i++)f.experiences.record(request({id:'episode-'+i,title:'Synthetic '+i}));assert.throws(()=>f.experiences.record(request({id:'sixth'})),/已满/);
  const first=f.experiences.interests()[0];f.experiences.setInterest(first.id,'paused');f.experiences.record(request({id:'sixth'}));assert.throws(()=>f.experiences.setInterest(first.id,'active'),/已满/);assert.ok(f.experiences.chooseInterest({mainSessionId:'synthetic-main',random:()=>0.01}));
  atomic(f.experiences.file(),{...f.experiences.state(),opaque:'bad'});const bytes=fs.readFileSync(f.experiences.file(),'utf8');assert.throws(()=>f.experiences.context('Synthetic','synthetic-main'),/字段/);assert.equal(fs.readFileSync(f.experiences.file(),'utf8'),bytes);
});
