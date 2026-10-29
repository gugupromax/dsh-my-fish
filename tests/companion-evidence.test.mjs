import test from 'node:test';
import assert from 'node:assert/strict';
import {Social} from '../lib/social.js';
import {createBilibiliAdapter} from '../lib/channels/bilibili.js';
import {captureCompanionRead} from '../lib/companion-evidence.js';

const BVID='BV1GJ411x7h7', BURL='https://www.bilibili.com/video/'+BVID+'/';
const main={agent:{session:{id:'synthetic-main'}}};
function fixture(){
  const recorded=[],state={sessionId:'synthetic-main',identity:{username:'synthetic_bot'}};
  const store={state:()=>state,config:()=>({aiUsername:'synthetic_bot',transport:'browser',mode:'solo',allowBookmarks:true,allowReplies:false,allowMentions:false}),publicStatus:()=>({hasCredentials:true})};
  const companion={addReceipt:record=>{const row={...record,id:'receipt-'+recorded.length};recorded.push(row);return row;}};
  const onRead=input=>captureCompanionRead(companion,store,input);
  return {store,state,companion,recorded,onRead};
}
const json=data=>new Response(JSON.stringify({code:0,data}),{status:200,headers:{'content-type':'application/json'}});
const video={aid:170001,bvid:BVID,title:'Synthetic video title',desc:'Synthetic description',owner:{name:'Synthetic author',mid:42},duration:100,pubdate:1000,stat:{view:30}};

test('actual Bilibili adapter reads create bounded receipts only after successful main-session calls',async()=>{
  const f=fixture(),calls=[],desc='合成公开简介。'.repeat(200);
  const adapter=createBilibiliAdapter({fetchImpl:async url=>{calls.push(url);return json({...video,desc,config:{token:'SYNTHETIC_SECRET'}});}});
  const social=new Social({},f.store,{adapters:[adapter],onRead:f.onRead});
  const result=await social.read({platform:'bilibili',reference:BURL},new AbortController().signal,main);
  assert.equal(calls.length,1);assert.match(calls[0],/^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?/);
  assert.equal(f.recorded.length,1);const row=f.recorded[0];
  assert.equal(row.reference,BVID);assert.equal(row.url,BURL);assert.equal(row.excerpt.length,800);assert.equal(row.truncated,true);
  assert.equal(row.sessionId,'synthetic-main');assert.equal(row.title,video.title);assert.match(row.scope,/未观看视频/);assert.match(row.scope,/不可信资料/);
  assert.equal(JSON.stringify(row).includes('SYNTHETIC_SECRET'),false);
  assert.deepEqual(Object.keys(result.companionReceipts[0]).sort(),['id','operation','platform','readAt','scope','title','url']);
  assert.equal(result.companionReceipts[0].id,row.id);assert.equal(result.companionReceipts[0].sessionId,undefined);assert.equal(result.companionReceipts[0].excerpt,undefined);
});

test('Bilibili comment receipts identify individual comments and retain their real parent video URL and narrow scope',async()=>{
  const f=fixture(),calls=[];
  const adapter=createBilibiliAdapter({fetchImpl:async url=>{
    calls.push(url);return url.includes('/view?')?json(video):json({page:{count:50},replies:Array.from({length:8},(_,index)=>({rpid:String(index+1),content:{message:'Synthetic comment '+index},member:{uname:'Synthetic commenter'},like:0,rcount:0,ctime:1}))});
  }});
  const social=new Social({},f.store,{adapters:[adapter],onRead:f.onRead});
  const result=await social.comments({platform:'bilibili',reference:BVID,count:8},undefined,main);
  assert.equal(calls.length,2);assert.equal(f.recorded.length,5);assert.equal(result.companionReceipts.length,5);
  for(let i=0;i<5;i++){
    const row=f.recorded[i];assert.equal(row.reference,BVID+'#comment:'+(i+1));assert.equal(row.url,BURL);assert.equal(row.operation,'comments');
    assert.equal(row.excerpt,'Synthetic comment '+i);assert.equal(row.title,video.title);assert.match(row.scope,/有限顶层评论/);assert.match(row.scope,/未观看/);
  }
});

test('Bilibili search receipts explicitly remain search summaries and preserve scoped host execution',async()=>{
  const f=fixture(),calls=[],exec={...main,token:{synthetic:true},callId:'outer-call'};
  const tools={get:()=>({synthetic:true}),execute:async args=>{calls.push(args);return {isError:false,value:{sources:[{url:BURL,title:'Synthetic search title',snippet:'Only a search summary'}]}};}};
  const adapter=createBilibiliAdapter({getTools:()=>tools,fetchImpl:()=>{throw Error('Search must use the host bridge');}});
  const social=new Social({},f.store,{adapters:[adapter],onRead:f.onRead});
  const result=await social.search({platform:'bilibili',query:'synthetic search'},undefined,exec);
  assert.equal(calls.length,1);assert.equal(calls[0].parent,exec.token);assert.equal(f.recorded.length,1);
  assert.equal(f.recorded[0].operation,'search');assert.equal(f.recorded[0].excerpt,'Only a search summary');
  assert.match(f.recorded[0].scope,/仅搜索结果标题与摘要/);assert.match(f.recorded[0].scope,/不能作为完整正文或观点事实/);
  assert.equal(result.companionReceipts[0].operation,'search');
});

test('ordinary chats, plan sessions, missing sessions and unknown platforms never write personal receipts',()=>{
  const f=fixture(),result={ok:true,items:[{bvid:BVID,url:BURL,title:'Synthetic title',description:'Synthetic body'}]};
  const input={platform:'bilibili',operation:'read',args:{reference:BVID},result};
  for(const exec of [undefined,{agent:{}},{agent:{id:'ordinary'}},{agent:{session:{id:'plan-worker'}}}])assert.deepEqual(captureCompanionRead(f.companion,f.store,{...input,exec}),[]);
  assert.deepEqual(captureCompanionRead(f.companion,f.store,{...input,platform:'future-provider',exec:main}),[]);
  f.state.sessionId=null;assert.deepEqual(captureCompanionRead(f.companion,f.store,{...input,exec:main}),[]);
  assert.equal(f.recorded.length,0);
});

test('X evidence requires canonical observed post links and copies only explicit safe text fields',()=>{
  const f=fixture(),result={items:[
    {id:'123456',url:'https://twitter.com/Synthetic/status/123456?s=20',text:'Synthetic visible text',config:{cookie:'SYNTHETIC_SECRET'},credentials:{token:'SYNTHETIC_SECRET'}},
    {id:'123457',url:'https://evil.invalid/Synthetic/status/123457',text:'Wrong host'},
    {id:'123458',url:'https://x.com/Synthetic/status/123458?access_token=SYNTHETIC_SECRET',text:'Secret link'},
    {id:'123459',url:'https://x.com/Synthetic/other/../status/123459',text:'Ambiguous path'},
    {id:'123460',url:'https://x.com/Synthetic/status/123460',text:'auth_token=SYNTHETIC_SECRET'},
    {id:'123461',text:'No observed link'},
  ],scope:'Page-visible body only',config:{token:'SYNTHETIC_SECRET'}};
  const rows=captureCompanionRead(f.companion,f.store,{platform:'x',operation:'read',result,exec:main});
  assert.equal(rows.length,1);assert.equal(rows[0].url,'https://x.com/Synthetic/status/123456');assert.equal(rows[0].reference,'123456');
  assert.equal(rows[0].excerpt,'Synthetic visible text');assert.match(rows[0].scope,/Page-visible body only/);assert.equal(JSON.stringify(f.recorded).includes('SYNTHETIC_SECRET'),false);
  assert.deepEqual(Object.keys(rows[0]).sort(),['excerpt','id','operation','platform','readAt','reference','scope','sessionId','title','truncated','url']);
});

test('invalid or conflicting Bilibili identities do not become receipts and narrower item scopes are retained',()=>{
  const f=fixture(),input={platform:'bilibili',operation:'read',exec:main};
  const results=[
    {items:[{bvid:BVID,url:'https://evil.invalid/video/'+BVID,title:'Wrong host'}]},
    {items:[{bvid:'BV1ab411c7mD',url:BURL,title:'Conflict'}]},
    {items:[{bvid:BVID,url:BURL+'?token=SYNTHETIC_SECRET',title:'Secret link'}]},
    {items:[{bvid:BVID,url:'https://www.bilibili.com/other/../video/'+BVID,title:'Ambiguous path'}]},
    {ok:false,items:[{bvid:BVID,title:'Failed'}]},
    {unsupported:true,items:[{bvid:BVID,title:'Unsupported'}]},
    {items:[]},
  ];
  for(const result of results)assert.deepEqual(captureCompanionRead(f.companion,f.store,{...input,result}),[]);
  const rows=captureCompanionRead(f.companion,f.store,{...input,result:{scope:'Broad source scope',items:[{bvid:BVID,url:BURL,title:'Safe title',description:'Safe description',scope:'Only this narrow item'}]}});
  assert.equal(rows.length,1);assert.match(rows[0].scope,/Only this narrow item/);assert.doesNotMatch(rows[0].scope,/Broad source scope/);
});

test('read failures, cancellation, unsupported results, checks and social writes never mint receipts',async()=>{
  const f=fixture();let hooks=0,reply={ok:true,items:[{id:'123456',url:'https://x.com/Synthetic/status/123456',text:'Synthetic body'}]},failure=false,abort;
  const engine={read:async()=>{if(failure)throw Error('Synthetic provider failure');abort?.abort();return reply;},write:async()=>({ok:true}),diagnose:async()=>({ok:true,identity:{username:'synthetic_bot'}})};
  const social=new Social(engine,f.store,{onRead:input=>{hooks++;return f.onRead(input);}});
  failure=true;await assert.rejects(social.read({platform:'x',reference:'123456'},undefined,main),/provider failure/);failure=false;
  for(const value of [{ok:false,items:reply.items},{unsupported:true,items:reply.items},{ok:true,items:[]}]){reply=value;const result=await social.read({platform:'x',reference:'123456'},undefined,main);assert.equal(result.companionReceipts,undefined);}
  abort=new AbortController();reply={items:[{id:'123456',url:'https://x.com/Synthetic/status/123456',text:'Synthetic body'}]};
  await assert.rejects(social.read({platform:'x',reference:'123456'},abort.signal,main),/abort/i);abort=undefined;
  await social.action({platform:'x',action:'bookmark',reference:'123456',reason:'Synthetic approved operation'},undefined,main);
  await social.check({platform:'x'},undefined,main);
  assert.equal(hooks,0);assert.equal(f.recorded.length,0);
});

test('local receipt write failures keep the actual platform result and reveal no private error details',async()=>{
  const f=fixture(),body={items:[{id:'123456',url:'https://x.com/Synthetic/status/123456',text:'Synthetic body'}]};
  const social=new Social({read:async()=>body},f.store,{onRead:()=>{throw Error('Synthetic path C:/Private and auth_token=SYNTHETIC_SECRET');}});
  const result=await social.read({platform:'x',reference:'123456'},undefined,main);
  assert.equal(result.items[0].text,'Synthetic body');assert.equal(result.companionReceipts,undefined);
  assert.match(result.companionReceiptError,/读取成功.*未能保存/);assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'),false);
  const abort=new AbortController(),canceled=new Social({read:async()=>body},f.store,{onRead:()=>{abort.abort();throw Error('Synthetic write error');}});
  await assert.rejects(canceled.read({platform:'x',reference:'123456'},abort.signal,main),/abort/i);
});

test('receipt summaries cannot leak extra callback payload and malformed callbacks cannot claim a saved receipt',async()=>{
  const f=fixture(),body={items:[{id:'123456',url:'https://x.com/Synthetic/status/123456',text:'Synthetic body'}]};
  const receipt={id:'synthetic-receipt',platform:'x',operation:'read',url:'https://x.com/Synthetic/status/123456',title:'Synthetic title',scope:'Synthetic visible text only',readAt:123,sessionId:'PRIVATE_SESSION',config:{token:'SYNTHETIC_SECRET'},excerpt:'PRIVATE_EXCERPT'};
  const social=new Social({read:async()=>body},f.store,{onRead:()=>[receipt]});
  const result=await social.read({platform:'x',reference:'123456'},undefined,main);
  assert.equal(JSON.stringify(result.companionReceipts).includes('PRIVATE_'),false);assert.equal(JSON.stringify(result.companionReceipts).includes('SYNTHETIC_SECRET'),false);
  for(const value of [{...receipt,operation:'search'},{...receipt,url:receipt.url+'?token=secret'},{...receipt,readAt:NaN},{...receipt,id:{token:'secret'}},{...receipt,title:'auth_token=SYNTHETIC_SECRET'}]){
    const invalid=new Social({read:async()=>body},f.store,{onRead:()=>[value]});const received=await invalid.read({platform:'x',reference:'123456'},undefined,main);
    assert.equal(received.companionReceipts,undefined);assert.match(received.companionReceiptError,/未能保存/);
  }
  const forged={...body,companionReceipts:[{id:'provider-forgery',sessionId:'PRIVATE_SESSION'}],companionReceiptError:'SYNTHETIC_SECRET'};
  const empty=new Social({read:async()=>forged},f.store,{onRead:()=>[]});
  const safe=await empty.read({platform:'x',reference:'123456'},undefined,main);
  assert.equal(safe.companionReceipts,undefined);assert.equal(safe.companionReceiptError,undefined);assert.equal(JSON.stringify(safe).includes('PRIVATE_SESSION'),false);
});
