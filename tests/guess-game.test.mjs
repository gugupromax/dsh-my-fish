import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {GuessGame} from '../lib/guess-game.js';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-guess-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root);store.saveState({...store.state(),sessionId:'main'});const companion=new CompanionStore(store),game=new GuessGame(store,companion);return {store,companion,game};}
const exec={agent:{session:{id:'main'}}};
const video='BV1GJ411x7h7';
function receipt(companion){return companion.addReceipt({platform:'bilibili',operation:'read',reference:video,url:'https://www.bilibili.com/video/'+video+'/',title:'Synthetic title',excerpt:'Synthetic description',scope:'Synthetic metadata',sessionId:'main'});}
function show(f){f.game.observe({id:'main'},{type:'assistant/message',data:{message:{source:{kind:'model'},content:[{type:'text',text:'Synthetic guess'}]}}});return f.game.list('main').at(-1);}
function begin(f){const round=f.game.start({reference:video},'main');const r=receipt(f.companion);f.game.bet({id:round.id,revision:round.revision,guess:'Synthetic guess',receiptId:r.id},'main');return show(f);}

test('game blocks premature comments, uses a real current-session receipt and stores a stable sample',t=>{
  const f=fixture(t),round=f.game.start({reference:video},'main');
  assert.equal(f.game.start({reference:video},'main').id,round.id);
  assert.throws(()=>f.game.beforeComments({platform:'bilibili',args:{reference:video},exec}),/先说出/);
  assert.throws(()=>f.game.bet({id:round.id,revision:0,guess:'Synthetic',receiptId:'not-real'},'main'),/实际读取/);
  const r=receipt(f.companion),waiting=f.game.bet({id:round.id,revision:0,guess:'Synthetic guess',receiptId:r.id},'main');
  assert.throws(()=>f.game.beforeComments({platform:'bilibili',args:{reference:video},exec}),/先说出/);
  f.companion.recordUserMessage({id:'before-shown',text:'premature answer',sessionId:'main',at:Date.now()});
  assert.throws(()=>f.game.answer({id:waiting.id,revision:waiting.revision,messageId:'before-shown',quote:'premature answer'},'main'),/先将自己的猜测/);
  const shown=show(f);f.companion.recordUserMessage({id:'answer-1',text:'Synthetic answer',sessionId:'main',at:Date.now()});
  assert.throws(()=>f.game.answer({id:shown.id,revision:shown.revision,messageId:'before-shown',quote:'premature answer'},'main'),/本局猜测之后/);
  const ready=f.game.answer({id:shown.id,revision:shown.revision,messageId:'answer-1',quote:'Synthetic answer'},'main');
  const args={reference:video,count:20},token=f.game.beforeComments({platform:'bilibili',args,exec});
  assert.equal(args.count,20);assert.equal(token.args.count,5);assert.equal(token.args.page,1);assert.equal(token.args.sort,'hot');
  assert.throws(()=>f.game.beforeComments({platform:'bilibili',args:{reference:video},exec}),/尚未确认/);
  f.game.afterComments(token,{ok:true,title:'Synthetic video',items:[{rpid:'1',text:'Synthetic comment',like:3}]});
  const saved=f.game.list('main')[0];assert.equal(saved.status,'done');assert.equal(saved.comments.count,1);assert.equal(saved.comments.items[0].text,'Synthetic comment');
  assert.equal(f.game.afterComments(token,null,Error('late')),false);
  assert.equal(f.game.list('main')[0].comments.items[0].text,'Synthetic comment');
});

test('a pending or crash-interrupted read can be cancelled, and a late response cannot reveal',t=>{
  const f=fixture(t),waiting=begin(f);f.companion.recordUserMessage({id:'answer-cancel',text:'Synthetic answer',sessionId:'main',at:Date.now()});
  f.game.answer({id:waiting.id,revision:waiting.revision,messageId:'answer-cancel',quote:'Synthetic answer'},'main');
  const token=f.game.beforeComments({platform:'bilibili',args:{reference:video},exec});
  const fresh=new GuessGame(f.store,f.companion),reading=fresh.list('main')[0];assert.equal(reading.status,'reading');
  assert.equal(fresh.cancel({id:reading.id,revision:reading.revision},'main').status,'cancelled');
  assert.equal(f.game.afterComments(token,{ok:true,items:[{rpid:'1',text:'Synthetic late comment'}]}),false);
  assert.equal(fresh.list('main')[0].comments,null);
});

test('messages existing before a guess cannot impersonate a later answer',t=>{
  const f=fixture(t);f.companion.recordUserMessage({id:'initial',text:'Synthetic initial text',sessionId:'main',at:Date.now()});
  const waiting=begin(f);
  assert.throws(()=>f.game.answer({id:waiting.id,revision:waiting.revision,messageId:'initial',quote:'Synthetic initial'},'main'),/本局猜测之后/);
  assert.throws(()=>f.game.answer({id:waiting.id,revision:waiting.revision,messageId:'unknown',quote:'Synthetic'},'main'),/原话/);
});

test('skip requires actual explicit user words and failed reads require an explicit fresh retry',t=>{
  const f=fixture(t),waiting=begin(f);f.companion.recordUserMessage({id:'m1',text:'Synthetic answer',sessionId:'main',at:Date.now()});
  assert.throws(()=>f.game.answer({id:waiting.id,revision:waiting.revision,messageId:'m1',quote:'Synthetic answer',skip:true},'main'),/明确/);
  f.companion.recordUserMessage({id:'m2',text:'跳过，揭晓吧',sessionId:'main',at:Date.now()});
  const ready=f.game.answer({id:waiting.id,revision:waiting.revision,messageId:'m2',quote:'跳过',skip:true},'main');
  f.companion.recordUserMessage({id:'early-retry',text:'重试',sessionId:'main',at:Date.now()});
  const token=f.game.beforeComments({platform:'bilibili',args:{reference:video},exec});f.game.afterComments(token,null,Error('synthetic failure'));
  const uncertain=f.game.list('main')[0];assert.equal(uncertain.status,'uncertain');
  assert.throws(()=>f.game.retry({id:ready.id,revision:uncertain.revision,messageId:'early-retry',quote:'重试'},'main'),/明确要求重试/);
  assert.throws(()=>f.game.retry({id:ready.id,revision:uncertain.revision,messageId:'m2',quote:'跳过'},'main'),/明确要求重试/);
  f.companion.recordUserMessage({id:'m3',text:'请重试',sessionId:'main',at:Date.now()});
  assert.equal(f.game.retry({id:ready.id,revision:uncertain.revision,messageId:'m3',quote:'重试'},'main').status,'ready');
});

test('game restricts bypasses only for current personal ownership and releases them on cancellation',t=>{
  const f=fixture(t),round=f.game.start({reference:video},'main');
  for(const name of ['web_search','web_fetch','run_code','pwsh','bsk_page','social_search'])assert.match(f.game.guard({name,arguments:{}},'personal'),/揭晓或取消/);
  assert.equal(f.game.guard({name:'social_read',arguments:{platform:'bilibili',reference:video}},'personal'),undefined);
  assert.match(f.game.guard({name:'social_read',arguments:{platform:'bilibili',reference:video}},'descendant'),/猜评论/);
  assert.equal(f.game.guard({name:'web_search'},null),undefined);
  f.game.cancel({id:round.id,revision:round.revision},'main');assert.equal(f.game.guard({name:'web_search'},'personal'),undefined);
});
