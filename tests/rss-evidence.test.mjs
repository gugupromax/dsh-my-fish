import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {Social} from '../lib/social.js';
import {createRssAdapter} from '../lib/channels/rss.js';
import {captureCompanionRead} from '../lib/companion-evidence.js';

const MAIN='synthetic-rss-main',main={agent:{session:{id:MAIN}}},outside={agent:{session:{id:'synthetic-other-chat'}}};
const feed={id:'example',name:'Synthetic public feed',url:'https://feed.example.org/feed.xml'};
function xml({body='Synthetic embedded article text',full=true,url='https://article.example.org/post?p=2&amp;lang=zh'}={}){
  return `<rss xmlns:content="urn:content"><channel><item><title>Synthetic article</title><link>${url}</link><${full?'content:encoded':'description'}><![CDATA[${body}]]></${full?'content:encoded':'description'}></item></channel></rss>`;
}
function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fish-rss-evidence-')),store=new Store(directory),companion=new CompanionStore(store),requests=[];
  store.saveState({...store.state(),sessionId:MAIN});
  const adapter=createRssAdapter({getFeeds:()=>[feed],fetchFeed:async(url,signal)=>{requests.push(url);signal?.throwIfAborted();if(options.fail)throw Error('Synthetic feed read failed');return xml(options);}});
  const social=new Social({},store,{adapters:[adapter],onRead:input=>captureCompanionRead(companion,store,input)});
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  return {store,companion,social,requests};
}
async function discover(f,exec=main){return f.social.discover({platform:'rss',count:1},new AbortController().signal,exec);}
async function read(f,reference,exec=main){return f.social.read({platform:'rss',reference},new AbortController().signal,exec);}

test('RSS candidates do not mint reading receipts; actual cached feed reads mint bounded main-session evidence',async t=>{
  const f=fixture(t),found=await discover(f);
  assert.equal(found.candidatesOnly,true);assert.equal(found.companionReceipts,undefined);assert.equal(f.companion.snapshot().receipts.length,0);
  const reference=found.items[0].reference,result=await read(f,reference),[receipt]=f.companion.snapshot().receipts;
  assert.equal(f.requests.length,1,'Only the configured feed was fetched, not the article link');assert.equal(f.requests[0],feed.url);
  assert.equal(result.items[0].contentKind,'feed-content');assert.equal(result.companionReceipts.length,1);
  assert.equal(receipt.platform,'rss');assert.equal(receipt.operation,'read');assert.equal(receipt.reference,reference);assert.equal(receipt.sessionId,MAIN);assert.equal(receipt.excerpt,'Synthetic embedded article text');
  assert.equal(receipt.url,'https://article.example.org/post?p=2&lang=zh');assert.match(receipt.scope,/仅订阅源内嵌正文，/);assert.match(receipt.scope,/没有读取文章外链/);assert.match(receipt.scope,/不可信资料/);
  const summary=result.companionReceipts[0];assert.equal(summary.url,receipt.url);assert.equal(summary.sessionId,undefined);assert.equal(summary.excerpt,undefined);assert.equal(result.companionReceiptError,undefined);
});

test('short feed summaries retain their limited scope even when text is not truncated',async t=>{
  const f=fixture(t,{body:'Only a short teaser.',full:false}),found=await discover(f),result=await read(f,found.items[0].reference);
  assert.equal(result.items[0].contentKind,'feed-summary');assert.equal(result.items[0].truncated,false);
  const [receipt]=f.companion.snapshot().receipts;assert.equal(receipt.truncated,false);assert.equal(receipt.excerpt,'Only a short teaser.');assert.match(receipt.scope,/没有读取文章外链/);assert.match(receipt.scope,/不表示听过播客或看过视频/);
});

test('large embedded text has a bounded truncated receipt rather than a full-document claim',async t=>{
  const f=fixture(t,{body:'Synthetic feed text. '.repeat(800)}),found=await discover(f),result=await read(f,found.items[0].reference),[receipt]=f.companion.snapshot().receipts;
  assert.equal(result.items[0].text.length,12000);assert.equal(result.items[0].truncated,true);assert.equal(receipt.excerpt.length,800);assert.equal(receipt.truncated,true);assert.equal(f.requests.length,1);
});

test('foreign sessions may read their own discovered public content but cannot mint main memories',async t=>{
  const f=fixture(t),found=await discover(f,outside),result=await read(f,found.items[0].reference,outside);
  assert.equal(result.items[0].text,'Synthetic embedded article text');assert.equal(result.companionReceipts,undefined);assert.equal(f.companion.snapshot().receipts.length,0);
  await assert.rejects(()=>read(f,found.items[0].reference,main),/有效reference/);assert.equal(f.companion.snapshot().receipts.length,0);
});

test('feed failures, unsafe links, fabricated references and cancellation never produce receipts',async t=>{
  const failed=fixture(t,{fail:true});await assert.rejects(()=>discover(failed),/Synthetic feed read failed/);assert.equal(failed.companion.snapshot().receipts.length,0);
  const unsafe=fixture(t,{url:'https://article.example.org/post?access_token=SYNTHETIC_SECRET'});const found=await discover(unsafe);assert.equal(found.items.length,0);assert.equal(unsafe.companion.snapshot().receipts.length,0);
  const valid=fixture(t);await assert.rejects(()=>read(valid,'example:fabricated'),/有效reference/);
  const controller=new AbortController();controller.abort();await assert.rejects(async()=>valid.social.discover({platform:'rss'},controller.signal,main));assert.equal(valid.companion.snapshot().receipts.length,0);assert.equal(valid.requests.length,0);
});

test('RSS source identity checks reject mismatched references or unknown content kinds',t=>{
  const f=fixture(t),item={reference:'example:synthetic',contentKind:'feed-content',url:'https://article.example.org/post?p=1',text:'Synthetic body',title:'Synthetic title'};
  for(const [args,value]of [[{reference:'different'},item],[{reference:item.reference},{...item,contentKind:'video'}],[{reference:item.reference},{...item,url:'https://article.example.org/?token=private'}]]){
    assert.deepEqual(captureCompanionRead(f.companion,f.store,{platform:'rss',operation:'read',args,result:{ok:true,items:[value]},exec:main}),[]);
  }
  assert.equal(f.companion.snapshot().receipts.length,0);
});
