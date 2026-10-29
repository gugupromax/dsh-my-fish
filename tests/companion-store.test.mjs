import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store,atomic} from '../lib/store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {registerCompanionTools,COMPANION_PARAMETERS} from '../lib/companion-tools.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-companion-'));
  t.after(()=>{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(root));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true});});
  const store=new Store(root);store.saveState({...store.state(),sessionId:'synthetic-main'});
  return {root,store,companion:new CompanionStore(store)};
}
const receipt=(extra={})=>({platform:'bilibili',operation:'read',reference:'BV1GJ411x7h7',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic source',excerpt:'Synthetic publicly read description.',scope:'Public metadata and description only; no video or audio watched.',sessionId:'synthetic-main',...extra});
const start=(companion,title='Synthetic interest')=>companion.start({title,openQuestion:'What evidence would change this idea?'},'synthetic-main');
const reflect=(companion,thread,source,extra={})=>companion.reflect({id:thread.id,thought:'A tentative synthetic opinion.',nextQuestion:'What should be checked next?',reason:'The description provides a narrower example.',receiptIds:[source.id],...extra},'synthetic-main');

test('companion reads stay write-free and an interest starts with a question rather than an invented experience',t=>{
  const {store,companion}=fixture(t);const profile=store.file('assistant/profile.json');atomic(profile,{name:'LOCAL_SENTINEL',persona:'Synthetic custom role'});
  const before=fs.readFileSync(profile,'utf8'),state=fs.readFileSync(store.file('state.json'),'utf8');
  assert.deepEqual(companion.snapshot(),{threads:[],receipts:[],recentUserMessages:[]});assert.equal(companion.context().threads.length,0);assert.equal(fs.existsSync(companion.file()),false);
  const first=start(companion);assert.equal(first.currentThought,'');assert.equal(first.revision,0);assert.equal(first.origin,'fish');assert.deepEqual(first.latestSources,[]);
  assert.equal(start(companion).id,first.id);assert.equal(fs.readFileSync(profile,'utf8'),before);assert.equal(fs.readFileSync(store.file('state.json'),'utf8'),state);
  assert.equal(new CompanionStore(store).snapshot().threads[0].id,first.id);
});

test('a viewpoint requires a minted current-session reading receipt and keeps its actual scope',t=>{
  const {companion}=fixture(t),thread=start(companion),read=companion.addReceipt(receipt());
  assert.match(read.id,/^receipt-/);assert.equal(read.scope,receipt().scope);
  assert.throws(()=>reflect(companion,thread,{id:'receipt-'+crypto.randomUUID()}),/实际取得/);
  const search=companion.addReceipt(receipt({operation:'search'}));assert.throws(()=>reflect(companion,thread,search),/搜索摘要/);
  assert.throws(()=>companion.addReceipt(receipt({sessionId:'ordinary'})),/主会话/);
  const updated=reflect(companion,thread,read);assert.equal(updated.revision,1);assert.equal(updated.currentThought,'A tentative synthetic opinion.');
  assert.equal(updated.latestSources[0].scope,receipt().scope);assert.equal(updated.latestSources[0].operation,'read');assert.equal(updated.episodes[0].before,'');
  assert.equal(Object.hasOwn(updated.latestSources[0],'sessionId'),false);assert.equal(Object.hasOwn(updated.latestSources[0],'excerpt'),false);
});

test('same evidence and same thought are idempotent while new viewpoints retain their exact old evidence snapshot',t=>{
  const {companion}=fixture(t),thread=start(companion),read=companion.addReceipt(receipt()),first=reflect(companion,thread,read);
  const repeated=reflect(companion,thread,read,{reason:'Different filler reason.'});assert.equal(repeated.revision,1);assert.equal(repeated.episodes.length,1);
  const second=reflect(companion,thread,read,{thought:'The new view is more cautious.',reason:'I revised the interpretation.'});
  assert.equal(second.revision,2);assert.equal(second.revisions[1].before,first.currentThought);assert.equal(second.revisions[1].after,second.currentThought);
  assert.deepEqual(second.episodes[0].sources[0],first.episodes[0].sources[0]);
});

test('old receipts need a real reread after thirty days and rereading does not rewrite old episodes',t=>{
  const {companion}=fixture(t);let now=Date.UTC(2026,9,29);t.mock.method(Date,'now',()=>now);
  const thread=start(companion),read=companion.addReceipt(receipt()),first=reflect(companion,thread,read);
  now+=31*86400000;assert.throws(()=>reflect(companion,thread,read,{thought:'Unsupported claim of fresh reading.'}),/30天/);
  const reread=companion.addReceipt(receipt());assert.equal(reread.id,read.id);assert.equal(reread.readAt,now);
  const next=reflect(companion,thread,reread,{thought:'Updated after an actual reread.'});assert.equal(next.episodes[0].sources[0].readAt,first.episodes[0].sources[0].readAt);assert.equal(next.latestSources[0].readAt,now);
});

test('receipts reject credentials, local paths, malformed fields and forged timestamps without echoing their values',t=>{
  const {companion}=fixture(t);const badUrls=['https://name:PRIVATE_SENTINEL@example.com/','file:///C:/Private/file','https://example.com/?%74oken=PRIVATE_SENTINEL','https://example.com/#api_key=PRIVATE_SENTINEL'];
  for(const value of badUrls){assert.throws(()=>companion.addReceipt(receipt({url:value})),error=>!error.message.includes('PRIVATE_SENTINEL'));}
  for(const value of [{excerpt:'password=PRIVATE_SENTINEL'},{excerpt:'Read E:\\Private\\file'},{truncated:'yes'},{readAt:Date.now()+120000},{opaqueSecret:'PRIVATE_SENTINEL'},{operation:'publish'}])assert.throws(()=>companion.addReceipt(receipt(value)));
  assert.equal(fs.existsSync(companion.file()),false);
  assert.doesNotThrow(()=>companion.addReceipt(receipt({title:'',excerpt:'Actual visible text.'})));
});

test('user positions must quote an actual captured message and never accept a model-invented stance',t=>{
  const {companion}=fixture(t),thread=start(companion),at=Date.now();
  const actual=companion.recordUserMessage({id:'synthetic-message',text:'I disagree with that interpretation, but I like the question.',sessionId:'synthetic-main',at});
  assert.equal(companion.recordUserMessage({...actual}).id,actual.id);
  assert.throws(()=>companion.respond({id:thread.id,messageId:'forged-message',quote:'I agree.'},'synthetic-main'),/实际收到/);
  assert.throws(()=>companion.respond({id:thread.id,messageId:actual.id,quote:'I agree.'},'synthetic-main'),/原话/);
  assert.throws(()=>companion.respond({id:thread.id,messageId:actual.id,quote:'I disagree',stance:'disagree'},'synthetic-main'),/字段/);
  const updated=companion.respond({id:thread.id,messageId:actual.id,quote:'I disagree with that interpretation'},'synthetic-main');
  assert.deepEqual(updated.userPositions,[{messageId:actual.id,quote:'I disagree with that interpretation',at}]);
  assert.equal(companion.respond({id:thread.id,messageId:actual.id,quote:'I disagree with that interpretation'},'synthetic-main').userPositions.length,1);
});

test('sensitive user messages are skipped in full before truncation and only thirty recent messages are retained',t=>{
  const {companion}=fixture(t),at=Date.now();
  assert.equal(companion.recordUserMessage({id:'secret-message',text:'x'.repeat(1600)+' password=PRIVATE_SENTINEL',sessionId:'synthetic-main',at}),null);
  assert.equal(companion.recordUserMessage({id:'empty-message',text:'   ',sessionId:'synthetic-main',at}),null);assert.equal(fs.existsSync(companion.file()),false);
  for(let i=0;i<34;i++)companion.recordUserMessage({id:'message-'+i,text:'Synthetic text '+i+'x'.repeat(1800),sessionId:'synthetic-main',at});
  const snapshot=companion.snapshot();assert.equal(snapshot.recentUserMessages.length,30);assert.equal(snapshot.recentUserMessages[0].id,'message-4');assert.equal(snapshot.recentUserMessages[0].text.length,1500);
  assert.equal(companion.context().recentUserMessages.length,4);assert.ok(!fs.readFileSync(companion.file(),'utf8').includes('PRIVATE_SENTINEL'));
});

test('pausing and forgetting are scoped to the thread and cannot change persona, schedules or permissions',t=>{
  const {store,companion}=fixture(t),thread=start(companion),read=companion.addReceipt(receipt());const state=fs.readFileSync(store.file('state.json'),'utf8');
  companion.setStatus(thread.id,'paused');assert.equal(companion.context().threads.length,0);assert.throws(()=>reflect(companion,thread,read),/已放下/);
  companion.setStatus(thread.id,'active');assert.equal(companion.context().threads.length,1);companion.setStatus(thread.id,'settled');assert.equal(companion.context().threads.length,0);
  companion.forget(thread.id);assert.equal(companion.snapshot().threads.length,0);assert.throws(()=>companion.setStatus(thread.id,'active'),/不存在/);
  assert.equal(fs.readFileSync(store.file('state.json'),'utf8'),state);
});

test('interest, episode and receipt limits bound local data and context without dropping historical source evidence',t=>{
  const {companion}=fixture(t);const threads=Array.from({length:5},(_,i)=>start(companion,'Synthetic interest '+i));assert.throws(()=>start(companion,'Sixth active'),/已满/);
  const read=companion.addReceipt(receipt());
  for(let i=0;i<15;i++)reflect(companion,threads[0],read,{thought:'Synthetic opinion revision '+i,reason:'Synthetic evidence-driven revision '+i});
  for(let i=0;i<125;i++)companion.addReceipt(receipt({reference:'BV1GJ411x7h7#comment:'+i,url:'https://example.com/source/'+i,excerpt:'Synthetic excerpt '+i}));
  const snapshot=companion.snapshot();assert.equal(snapshot.receipts.length,120);assert.equal(snapshot.threads[0].episodes.length,12);assert.equal(snapshot.threads[0].episodes[0].after,'Synthetic opinion revision 3');
  assert.equal(snapshot.threads[0].latestSources[0].id,read.id);assert.equal(companion.context().threads.length,3);assert.ok(JSON.stringify(companion.context()).length<=24000);
});

test('internal dispatch tracking survives reload and retains only its exact one hundred identifiers',t=>{
  const {store,companion}=fixture(t);companion.registerDispatch('my-fish:wake:0');
  const initial=JSON.parse(fs.readFileSync(companion.file(),'utf8'));initial.dispatches=Array.from({length:100},(_,i)=>'my-fish:wake:'+i);atomic(companion.file(),initial);
  for(let i=100;i<105;i++)companion.registerDispatch('my-fish:wake:'+i);
  const reloaded=new CompanionStore(store);assert.equal(reloaded.isInternalDispatch('my-fish:wake:0'),false);assert.equal(reloaded.isInternalDispatch('my-fish:wake:104'),true);assert.equal(reloaded.isInternalDispatch('ordinary-user-request'),false);
  assert.equal(Object.hasOwn(reloaded.snapshot(),'dispatches'),false);assert.throws(()=>companion.registerDispatch('C:\\Private\\request'));
});

test('worst-case long records stay below the context character budget while the full local records remain editable',t=>{
  const {companion}=fixture(t),threads=Array.from({length:5},(_,i)=>start(companion,'Long synthetic topic '+i));
  const sources=Array.from({length:6},(_,i)=>companion.addReceipt(receipt({reference:'b'.repeat(1999)+i,url:'https://example.com/'+('p'.repeat(1850))+i,title:'t'.repeat(300),excerpt:'e'.repeat(1500),scope:'s'.repeat(1000)})));
  for(const current of threads)for(let i=0;i<3;i++)companion.reflect({id:current.id,thought:'f'.repeat(1499)+i,nextQuestion:'q'.repeat(500),reason:'r'.repeat(1000),receiptIds:sources.map(item=>item.id)},'synthetic-main');
  for(let i=0;i<4;i++)companion.recordUserMessage({id:'long-message-'+i,text:'u'.repeat(1500),sessionId:'synthetic-main',at:Date.now()});
  const context=companion.context();assert.ok(JSON.stringify(context).length<=24000);assert.equal(context.recentUserMessages.length,4);assert.ok(context.threads.length<=3);assert.equal(context.moreThreads,true);
  assert.equal(companion.snapshot().threads[0].currentThought.length,1500);assert.equal(companion.snapshot().threads[0].episodes.length,3);
});

test('companion follows the committed workspace root and malformed stored fields fail closed',t=>{
  const {root,store,companion}=fixture(t),thread=start(companion);const next=path.join(root,'migrated'),sessionState=store.state();fs.mkdirSync(next);atomic(path.join(next,'state.json'),sessionState);store.root=next;
  assert.equal(companion.snapshot().threads.length,0);const fresh=start(companion,'New root interest');assert.notEqual(fresh.id,thread.id);
  const malformed=JSON.parse(fs.readFileSync(companion.file(),'utf8'));malformed.threads[0].opaqueSecret='PRIVATE_SENTINEL';atomic(companion.file(),malformed);assert.throws(()=>companion.context(),/字段/);
});

test('one companion tool enforces current personal ownership and cannot mint receipts or invent user messages',async t=>{
  const {store,companion}=fixture(t),definitions=[],exec={agent:{session:{id:'synthetic-main'}}};let leases=0;
  const requirePersonal=value=>{if(value?.agent?.session?.id!==store.state().sessionId)throw Error('personal only');};
  registerCompanionTools({tool:(name,description,parameters,execute)=>definitions.push({name,description,parameters,execute}),companion,store,requirePersonal,engine:{serial:async job=>{leases++;return job();}}});
  assert.equal(definitions.length,1);assert.equal(definitions[0].name,'assistant_companion');assert.equal(COMPANION_PARAMETERS.additionalProperties,false);assert.equal(Object.hasOwn(COMPANION_PARAMETERS.properties,'scope'),false);
  const invoke=(args,who=exec)=>definitions[0].execute(args,undefined,who);assert.throws(()=>invoke({action:'list'},{agent:{session:{id:'ordinary'}}}),/personal/);
  assert.throws(()=>invoke({action:'list'},{agent:{session:{id:'worker'}}}),/personal/);
  const first=await invoke({action:'start',title:'Synthetic tool interest',openQuestion:'A real question'});assert.equal(first.thread.currentThought,'');assert.equal(leases,1);
  const listed=invoke({action:'list'});assert.equal(listed.threads[0].id,first.thread.id);assert.equal(leases,1);
  await invoke({action:'pause',id:first.thread.id});const paused=invoke({action:'list'});assert.equal(paused.threads.length,0);assert.deepEqual(paused.otherThreads,[{id:first.thread.id,title:'Synthetic tool interest',status:'paused'}]);
  await invoke({action:'resume',id:first.thread.id});
  await assert.rejects(()=>invoke({action:'reflect',id:first.thread.id,thought:'Fake visit',reason:'No actual source',receiptIds:['receipt-'+crypto.randomUUID()]}),/实际取得/);
  assert.equal(companion.snapshot().threads[0].revision,0);
});
