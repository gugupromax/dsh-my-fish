import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilibiliAdapter} from '../lib/channels/bilibili.js';
import {Social} from '../lib/social.js';

const BV='BV1xx411c7mD',SECOND='BV1ab411c7mD';
const payload=data=>new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
const candidate=(extra={})=>({bvid:BV,title:'合成候选',desc:'合成简介',owner:{name:'合成作者'},pubdate:1700000000,...extra});
const forbiddenStore=new Proxy({},{get(){throw Error('Public discovery must not inspect accounts');}});
const exec={agent:{id:'synthetic-discover-agent'}};

test('public discovery fetches one anonymous fixed homepage and projects bounded candidates only',async()=>{
  const calls=[],adapter=createBilibiliAdapter({store:forbiddenStore,now:()=>1234,fetchImpl:async(...args)=>{calls.push(args);return payload({list:[candidate({title:'x'.repeat(400),desc:'y'.repeat(800),url:'https://invalid.example/never-used',cookie:'SYNTHETIC_NEVER_PUBLIC'}),candidate(),candidate({bvid:SECOND})],no_more:false});}});
  const result=await adapter.discover({count:1});
  assert.equal(calls.length,1);assert.equal(calls[0][0],'https://api.bilibili.com/x/web-interface/popular?ps=1&pn=1');
  const options=calls[0][1];assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.deepEqual(options.headers,{accept:'application/json'});
  assert.equal(result.count,1);assert.equal(result.items[0].url,'https://www.bilibili.com/video/'+BV+'/');assert.equal(result.items[0].title.length,300);assert.equal(result.items[0].snippet.length,600);
  assert.equal(result.candidatesOnly,true);assert.equal(result.personalized,false);assert.equal(result.source,'public-popular');assert.equal(result.truncated,true);assert.equal(result.untrusted,true);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_NEVER_PUBLIC'),false);assert.equal(JSON.stringify(result).includes('invalid.example'),false);
  const capability=adapter.capabilities();assert.equal(capability.readAvailability.discover.connection.state,'verified');assert.equal(capability.readAvailability.read.connection.state,'unchecked');assert.match(result.scope,/不是账号个性化推荐/);
});

test('public discovery validates options before requests and refuses unsupported destination fields',async()=>{
  let calls=0;const adapter=createBilibiliAdapter({fetchImpl:async()=>{calls++;return payload({list:[]});}});
  for(const input of [null,[],{count:0},{count:6},{count:1.5},{page:2},{url:'https://invalid.example'},{count:1,query:'synthetic'}])await assert.rejects(adapter.discover(input),/数量|只接受/);
  assert.equal(calls,0);assert.equal(adapter.capabilities().readAvailability.discover.connection.state,'unchecked');
});

test('malformed discovery data is not misreported as an empty result, while a genuine empty list is valid',async()=>{
  for(const data of [{},{list:null},{list:[candidate()],no_more:'false'},{list:[candidate({bvid:'https://invalid.example'})]},{list:[candidate({title:''})]}]){
    const adapter=createBilibiliAdapter({fetchImpl:async()=>payload(data)});await assert.rejects(adapter.discover(),/结构|有效视频/);assert.equal(adapter.capabilities().readAvailability.discover.connection.state,'failed');
  }
  const adapter=createBilibiliAdapter({fetchImpl:async()=>payload({list:[],no_more:true})});const result=await adapter.discover();assert.equal(result.count,0);assert.equal(result.truncated,false);
});

test('discovery ignores unsafe references and duplicate IDs without trusting provider links',async()=>{
  const adapter=createBilibiliAdapter({fetchImpl:async()=>payload({list:[candidate({bvid:'BV2xx411c7mD'}),candidate({bvid:'../escape'}),candidate(),candidate(),candidate({bvid:SECOND,pubdate:Number.MAX_SAFE_INTEGER+1})],no_more:true})});
  const result=await adapter.discover();assert.deepEqual(result.items.map(row=>row.bvid),[BV,SECOND]);assert.equal(result.items[1].publishedAt,null);
});

test('public discovery reuses restriction cooldown, cancellation, timeout and busy protection without retries',async t=>{
  let calls=0;const limited=createBilibiliAdapter({now:()=>1000,fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  await assert.rejects(limited.discover(),/停止并暂停/);await assert.rejects(limited.discover(),/冷却期/);assert.equal(calls,1);
  const controller=new AbortController(),adapter=createBilibiliAdapter({fetchImpl:()=>{calls++;return new Promise(()=>{});}}),pending=adapter.discover({},controller.signal);
  await assert.rejects(adapter.discover(),/正在运行/);controller.abort(Error('synthetic-discover-cancel'));await assert.rejects(pending,/synthetic-discover-cancel/);assert.equal(calls,2);
  t.mock.timers.enable({apis:['setTimeout']});const timeout=adapter.discover();t.mock.timers.tick(15000);await assert.rejects(timeout,/超时/);assert.equal(calls,3);
});

test('unified discovery checks its own facade visibility and never calls the read-evidence callback',async()=>{
  let reads=0,requests=0;const tools={get:name=>name==='social_discover'?{}:undefined};
  const adapter=createBilibiliAdapter({store:forbiddenStore,getTools:()=>tools,fetchImpl:async()=>{requests++;return payload({list:[candidate()]});}});
  const social=new Social({},forbiddenStore,{adapters:[adapter],onRead:()=>{reads++;throw Error('Candidate must not count as read');}});
  const result=await social.discover({platform:'bilibili',count:2},undefined,exec);assert.equal(result.items[0].platform,'bilibili');assert.equal(result.companionReceipts,undefined);assert.equal(result.companionReceiptError,undefined);assert.equal(reads,0);assert.equal(requests,1);
  const status=social.registry.capabilities('bilibili',exec);assert.ok(status.reads.includes('discover'));assert.equal(status.readAvailability.discover.currentSessionVisible,true);assert.equal(status.readAvailability.read.currentSessionVisible,false);
  tools.get=()=>undefined;await assert.rejects(async()=>social.discover({platform:'bilibili'},undefined,exec),/不可见|不可用/);assert.equal(requests,1);
  social.register({id:'unsupported',name:'Unsupported',capabilities:()=>({implemented:true,available:true,reads:['read']}),read:async()=>({items:[]})});
  await assert.rejects(async()=>social.discover({platform:'unsupported'}),/尚未支持/);
});

test('unified discovery strips even a provider-supplied read receipt before returning candidates',async()=>{
  const social=new Social({},forbiddenStore,{adapters:[{id:'synthetic',name:'Synthetic',capabilities:()=>({implemented:true,available:true,reads:['discover']}),discover:async()=>({items:[],companionReceipts:[{id:'not-real'}],companionReceiptError:'not-real'})}]});
  const result=await social.discover({platform:'synthetic'});assert.equal(result.companionReceipts,undefined);assert.equal(result.companionReceiptError,undefined);
});
