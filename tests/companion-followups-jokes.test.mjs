import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {CompanionFollowups} from '../lib/companion-followups.js';
import {CompanionJokes} from '../lib/companion-jokes.js';
import {CompanionStore} from '../lib/companion-store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {Scheduler,personalPrompt} from '../lib/scheduler.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-followup-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),now=Date.now(),run={id:'synthetic-run',manual:false,at:now-1000,sessionId:'main'};
  store.saveState({...store.state(),sessionId:'main',activeRun:{id:run.id,sessionId:'main'}});
  const position={messageId:'message-a',quote:'Synthetic original opinion',at:now-100};
  const receipt={id:'receipt-a',platform:'bilibili',operation:'comments',reference:'BV1GJ411x7h7:comment-a',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic source',excerpt:'Synthetic comment one',scope:'Public comments',truncated:false,sessionId:'main',readAt:now};
  const data={threads:[{id:'thread-a',status:'active',userPositions:[position],episodes:[{runId:run.id,sourceIds:[receipt.id]}]}],recentUserMessages:[{id:'message-a',sessionId:'main',at:position.at,text:position.quote}],receipts:[receipt]};
  const companion={snapshot:()=>structuredClone(data)};
  const notices=new Map(),settings={enabled:true,snoozeUntil:null};
  const assistant={settings:()=>settings,addNotice:value=>{const previous=notices.get(value.key);if(previous)return {notice:previous,deduplicated:true};const notice={id:'notice-'+notices.size,...value};notices.set(value.key,notice);return {notice,deduplicated:false};}};
  return {store,run,data,settings,notices,followups:new CompanionFollowups(store,companion,assistant),jokes:new CompanionJokes(store,companion),companion,assistant};
}
const request={threadId:'thread-a',messageId:'message-a',receiptId:'receipt-a',title:'Synthetic discovery',summary:'Synthetic linked discovery',links:[]};

test('follow-up persists source-content deduplication across rereads and inbox eviction',t=>{
  const f=fixture(t),first=f.followups.publish(request,'main',f.run);
  assert.equal(first.notified,true);assert.equal(f.notices.size,1);
  f.data.receipts[0].readAt+=20;f.data.receipts[0].scope='A refreshed description of the same scope';f.notices.clear();
  const reload=new CompanionFollowups(f.store,f.companion,f.assistant);
  assert.equal(reload.publish(request,'main',f.run).notified,false);assert.equal(f.notices.size,0);
});

test('new evidence waits for an actual response, and inactive, stale or snoozed topics remain quiet',t=>{
  const f=fixture(t);assert.equal(f.followups.publish(request,'main',f.run).notified,true);
  const next={...f.data.receipts[0],id:'receipt-b',excerpt:'Different synthetic comment'};
  f.data.receipts.push(next);f.data.threads[0].episodes[0].sourceIds=[next.id];
  const later={...request,receiptId:next.id};
  assert.match(f.followups.publish(later,'main',f.run).reason,/等待回应/);
  const at=Date.now()+5;f.data.recentUserMessages.push({id:'message-b',sessionId:'main',at,text:'Synthetic second response'});
  f.data.threads[0].userPositions.push({messageId:'message-b',quote:'Synthetic second response',at});
  assert.equal(f.followups.publish({...later,messageId:'message-b'},'main',f.run).notified,true);
  f.settings.snoozeUntil=Date.now()+60000;assert.match(f.followups.publish(later,'main',f.run).reason,/暂停/);
  f.settings.snoozeUntil=null;f.data.threads[0].status='paused';assert.equal(f.followups.publish(later,'main',f.run).notified,false);
});

test('an interrupted notification never automatically resends an uncertain committed result',t=>{
  const f=fixture(t);let attempts=0;
  f.assistant.addNotice=()=>{attempts++;throw Error('Synthetic outcome unknown');};
  assert.throws(()=>f.followups.publish(request,'main',f.run),/outcome unknown/);
  assert.match(f.followups.publish(request,'main',f.run).reason,/未确认/);
  assert.equal(attempts,1);
});

test('shared jokes require user confirmation, preserve evidence, record actual utterance and support forgetting',t=>{
  const f=fixture(t),now=Date.now();
  f.data.recentUserMessages.push({id:'source',sessionId:'main',at:now-20,text:'The synthetic scene is called wobble whale'});
  f.data.recentUserMessages.push({id:'confirm',sessionId:'main',at:now-10,text:'记住这个叫法'});
  const args={name:'wobble whale',quote:'called wobble whale',scene:'synthetic scene',sourceMessageId:'source',confirmMessageId:'confirm'};
  const item=f.jokes.add(args,'main');assert.equal(item.quote,args.quote);assert.equal(f.jokes.add(args,'main').id,item.id);
  assert.equal(f.jokes.context('main','synthetic scene is funny')[0].id,item.id);
  f.jokes.observe({id:'other'},{type:'assistant/message',data:{message:{content:[{type:'text',text:'wobble whale'}]}},time:now+1});
  assert.equal(f.jokes.list('main')[0].lastUsedAt,null);
  f.jokes.observe({id:'main'},{type:'assistant/message',data:{message:{content:[{type:'text',text:'wobble whale'}]}},time:now+2});
  assert.equal(f.jokes.list('main')[0].lastUsedAt,now+2);
  f.data.recentUserMessages.push({id:'correct',sessionId:'main',at:Date.now()+5,text:'改成 wobble fish'});
  const updated=f.jokes.update({id:item.id,name:'wobble fish',quote:'wobble fish',scene:'synthetic scene',sourceMessageId:'correct',confirmMessageId:'correct'},'main');
  assert.equal(updated.id,item.id);assert.equal(updated.name,'wobble fish');assert.equal(updated.lastUsedAt,null);
  f.data.recentUserMessages.push({id:'forget',sessionId:'main',at:Date.now()+10,text:'请忘掉这个梗'});
  assert.equal(f.jokes.forget({id:item.id,confirmMessageId:'forget'},'main').ok,true);
  assert.deepEqual(f.jokes.list('main'),[]);assert.throws(()=>f.jokes.add(args,'main'),/已删除/);
});

test('automatic scheduler publishes only a current-session, newly read and reflected source',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-scheduler-followup-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),assistant=new AssistantStore(store),companion=new CompanionStore(store),at=Date.now()-1000;
  assistant.saveSettings({enabled:true});
  const run={id:'synthetic-run',manual:false,at,sessionId:'main',status:'queued',noticePolicy:1,dueGoalIds:[]};
  store.saveState({...store.state(),sessionId:'main',lastRun:run,activeRun:{id:run.id,sessionId:'main',at}});
  const thread=companion.start({title:'Synthetic topic',openQuestion:'What changed?'},'main');
  companion.recordUserMessage({id:'real-user-message',text:'Synthetic user response',sessionId:'main',at});
  companion.respond({id:thread.id,messageId:'real-user-message',quote:'Synthetic user response'},'main');
  const receipt=companion.addReceipt({platform:'bilibili',operation:'read',reference:'BV1GJ411x7h7',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic source',excerpt:'Synthetic public description',scope:'Public metadata only',sessionId:'main'});
  companion.reflect({id:thread.id,thought:'Synthetic new thought',reason:'Synthetic evidence',receiptIds:[receipt.id]},'main');
  const followups=new CompanionFollowups(store,companion,assistant),scheduler=new Scheduler(store,{},new AbortController().signal,assistant,{companion,followups});
  const result=scheduler.finish({runId:run.id,notify:true,title:'Synthetic discovery',summary:'Synthetic verified follow-up',threadId:thread.id,messageId:'real-user-message',receiptId:receipt.id});
  assert.equal(result.notified,true);assert.equal(assistant.notices().length,1);assert.equal(store.state().lastRun.status,'reported');
  assert.equal(store.state().activeRun,null);
  const manual={...run,id:'synthetic-manual',manual:true};store.saveState({...store.state(),lastRun:manual,activeRun:{id:manual.id,sessionId:'main',at}});
  assert.equal(scheduler.finish({runId:manual.id,notify:true,title:'Manual result',summary:'Synthetic manual task result'}).notified,true);
  assert.equal(assistant.notices().length,2);
});

test('automatic wake prompt explains provenance of all required identifiers',()=>{
  const profile={name:'fish',ownerTitle:'user',selfClaim:'fish',persona:'Synthetic role',interests:[]};
  const prompt=personalPrompt({maxCandidates:5,mode:'solo',allowBookmarks:false,allowReplies:false,allowMentions:false},{profile,memories:[],goals:[],companion:{threads:[],receipts:[],recentUserMessages:[]}},{id:'run',manual:false,xReady:false});
  for(const text of ['thread.id','recentUserMessages','companionReceipts','receiptIds','旧回执不能冒充本轮新读取'])assert.ok(prompt.includes(text),text);
});
