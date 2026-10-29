import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilibiliAdapter} from '../lib/channels/bilibili.js';

const BV='BV1xx411c7mD',SECOND='BV1ab411c7mD';
const context=()=>({agent:{id:'synthetic-agent'},token:{synthetic:true},callId:'synthetic-outer',rootCallId:'synthetic-root',signal:new AbortController().signal});
const payload=(data,options={})=>new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'},...options});
const metadata=(extra={})=>({bvid:BV,aid:12345,title:'合成视频',desc:'合成简介',duration:120,pubdate:1700000000,owner:{name:'合成作者',mid:123},stat:{view:42,reply:3},...extra});
const comment=(rpid,message='合成评论')=>({rpid,member:{uname:'合成读者',mid:'123'},like:2,rcount:1,ctime:1700000001,content:{message}});
const forbiddenStore=new Proxy({},{get(){throw Error('Anonymous adapter must not access store');}});

test('Bilibili capability distinguishes runtime support, session visibility and unchecked connection',()=>{
  let calls=0;const adapter=createBilibiliAdapter({store:forbiddenStore,fetchImpl:()=>{calls++;},getTools:()=>null});
  const status=adapter.capabilities();assert.equal(status.installed,true);assert.equal(status.implemented,true);assert.equal(status.available,true);assert.equal(status.configured,true);assert.equal(status.accountRequired,false);
  assert.equal(status.currentSessionVisible,null);assert.equal(status.connection.state,'unchecked');assert.equal(status.connection.checkedAt,null);assert.equal(status.readAvailability.search.available,false);assert.equal(status.readAvailability.search.currentSessionVisible,null);
  assert.equal(status.readAvailability.read.available,true);assert.equal(status.readAvailability.comments.available,true);assert.equal(calls,0);
  for(const action of Object.values(status.actions))assert.deepEqual(action,{supported:false,enabled:false,liveVerified:false});
  assert.equal(adapter.action,undefined);assert.equal(adapter.timeline,undefined);
  assert.equal(status.diagnostics.supported,true);assert.equal(status.diagnostics.kind,'public-read');
  const unavailable=createBilibiliAdapter({fetchImpl:null});assert.equal(unavailable.capabilities(context()).available,false);assert.equal(unavailable.capabilities(context()).readAvailability.read.available,false);
  assert.equal(unavailable.capabilities().diagnostics.supported,false);
});

test('Bilibili diagnostics use one fixed anonymous metadata GET and do not inspect accounts or comments',async()=>{
  const requests=[],adapter=createBilibiliAdapter({store:forbiddenStore,now:()=>1234,getTools:()=>{throw Error('Check must not use host tools');},fetchImpl:async(...args)=>{
    requests.push(args);return payload(metadata({bvid:'BV1GJ411x7h7',title:'合成检查视频',cookie:'SYNTHETIC_PRIVATE_VALUE'}));
  }});
  const result=await adapter.check(new AbortController().signal);
  assert.equal(requests.length,1);assert.equal(requests[0][0],'https://api.bilibili.com/x/web-interface/view?bvid=BV1GJ411x7h7');
  const options=requests[0][1];assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{accept:'application/json'});
  assert.equal(result.ok,true);assert.equal(result.checks.connection.status,'verified');assert.equal(result.checks.connection.checkedAt,1234);
  assert.equal(result.checks.identity.status,'not-applicable');assert.match(result.checks.permissions.scope,/不支持/);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_VALUE'),false);assert.equal(result.items,undefined);
  assert.equal(adapter.capabilities().readAvailability.read.connection.state,'verified');
  assert.equal(adapter.capabilities().readAvailability.comments.connection.state,'unchecked');assert.equal(adapter.capabilities().readAvailability.search.connection.state,'unchecked');
  assert.match(adapter.capabilities().connection.scope,/未检查搜索、评论、账号或写入权限/);
});

test('Bilibili diagnostics preserve restriction cooldown and never retry after HTTP or platform denials',async()=>{
  for(const makeResponse of [()=>new Response('',{status:429}),()=>new Response(JSON.stringify({code:-352}),{headers:{'content-type':'application/json'}})]){
    let calls=0,time=1000;const adapter=createBilibiliAdapter({now:()=>time,fetchImpl:async()=>{calls++;return makeResponse();}});
    await assert.rejects(adapter.check(),/停止/);assert.equal(calls,1);assert.equal(adapter.capabilities().connection.state,'failed');
    await assert.rejects(adapter.check(),/冷却期/);await assert.rejects(adapter.read({reference:BV}),/冷却期/);assert.equal(calls,1);
    time+=5*60*1000;assert.equal(adapter.capabilities().readAvailability.read.available,true);
  }
});

test('Bilibili diagnostics reuse cancellation, busy rejection and hard timeout',async t=>{
  const controller=new AbortController();let calls=0;
  const adapter=createBilibiliAdapter({fetchImpl:()=>{calls++;return new Promise(()=>{});}});
  const request=adapter.check(controller.signal);await assert.rejects(adapter.check(),/正在运行/);assert.equal(calls,1);
  controller.abort(new Error('synthetic-check-cancel'));await assert.rejects(request,/synthetic-check-cancel/);
  await assert.rejects(adapter.check(controller.signal),/synthetic-check-cancel/);assert.equal(calls,1);
  t.mock.timers.enable({apis:['setTimeout']});
  const timeout=adapter.check();t.mock.timers.tick(15000);await assert.rejects(timeout,/超时/);assert.equal(calls,2);assert.equal(adapter.capabilities().connection.state,'failed');
});

test('Bilibili read only fetches the fixed anonymous view endpoint and returns bounded metadata',async()=>{
  const requests=[],adapter=createBilibiliAdapter({store:forbiddenStore,now:()=>1234,fetchImpl:async(...args)=>{requests.push(args);return payload(metadata({desc:'x'.repeat(9000),pic:'https://invalid.example/never-fetched'}));}});
  const result=await adapter.read({reference:'https://www.bilibili.com/video/'+BV+'/?p=2#part'});
  assert.equal(requests.length,1);assert.equal(requests[0][0],'https://api.bilibili.com/x/web-interface/view?bvid='+BV);
  const options=requests[0][1];assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.deepEqual(options.headers,{accept:'application/json'});assert.ok(options.signal);
  assert.equal(result.aid,'12345');assert.equal(result.title,'合成视频');assert.equal(result.description.length,8000);assert.equal(result.items.length,1);assert.equal(result.untrusted,true);assert.match(result.scope,/不含视频、音频、字幕/);
  assert.deepEqual(adapter.capabilities().connection,{state:'verified',checkedAt:1234,scope:result.scope});assert.equal(adapter.capabilities().readAvailability.search.connection.state,'unchecked');
});

test('Bilibili rejects URLs, shortlinks, credentials, malformed BVs and invalid options before any request',async()=>{
  let requests=0;const adapter=createBilibiliAdapter({fetchImpl:async()=>{requests++;return payload(metadata());}});
  for(const reference of ['http://www.bilibili.com/video/'+BV,'https://b23.tv/abc','https://www.bilibili.com.evil.example/video/'+BV,'https://api.bilibili.com/x/web-interface/view?bvid='+BV,'https://user@www.bilibili.com/video/'+BV,'https://www.bilibili.com/video/'+BV+'/other','https://www.bilibili.com:444/video/'+BV,'BV1xx411c7m0','BV2xx411c7mD','file:///video/'+BV,'https://www.bilibili.com/video/%42'+BV.slice(1)])await assert.rejects(adapter.read({reference}),/合法/);
  for(const options of [{count:0},{count:51},{count:1.5},{page:0},{page:101},{sort:'likes'}])await assert.rejects(adapter.comments({reference:BV,...options}),/范围|排序/);
  assert.equal(requests,0);assert.equal(adapter.capabilities().connection.state,'unchecked');
});

test('Bilibili comments resolves safe aid then maps genuine public reply fields and limits pinned results',async()=>{
  const requests=[],top=comment('100'),reply={page:{count:30},top:[top],upper:{top},replies:[top,comment('101','x'.repeat(3000)),comment('102')]};
  const adapter=createBilibiliAdapter({store:forbiddenStore,fetchImpl:async(url,options)=>{requests.push([url,options]);return payload(requests.length===1?metadata():reply);}});
  const result=await adapter.comments({reference:BV,count:2,page:3,sort:'time'});
  assert.equal(requests.length,2);const url=new URL(requests[1][0]);assert.equal(url.origin,'https://api.bilibili.com');assert.equal(url.pathname,'/x/v2/reply');assert.deepEqual(Object.fromEntries(url.searchParams),{type:'1',oid:'12345',sort:'0',ps:'2',pn:'3'});
  assert.equal(result.items.length,2);assert.equal(result.items[0].tag,'置顶');assert.equal(result.items[1].rpid,'101');assert.equal(result.items[1].text.length,2000);assert.equal(result.total,30);assert.equal(result.sort,'time');assert.equal(result.page,3);assert.equal(result.truncated,true);assert.match(result.scope,/未展开楼中楼/);
  for(const [,options] of requests)assert.deepEqual(Object.keys(options.headers),['accept']);assert.equal(adapter.capabilities().readAvailability.comments.connection.state,'verified');assert.equal(adapter.capabilities().readAvailability.read.connection.state,'unchecked');
});

test('Bilibili hot sorting uses sort 2 and null replies remains a successful empty sample',async()=>{
  const urls=[],adapter=createBilibiliAdapter({fetchImpl:async url=>{urls.push(url);return payload(urls.length===1?metadata():{replies:null,page:{count:0}});}});
  const result=await adapter.comments({reference:BV});assert.equal(result.count,0);assert.equal(new URL(urls[1]).searchParams.get('sort'),'2');assert.equal(result.sort,'hot');
});

test('Bilibili stops comments after unsafe aid or mismatched video metadata',async()=>{
  for(const extra of [{aid:'https://evil.example/a'},{aid:Number.MAX_SAFE_INTEGER+1},{aid:0},{aid:'-1'},{bvid:SECOND}]){
    let requests=0;const adapter=createBilibiliAdapter({fetchImpl:async()=>{requests++;return payload(metadata(extra));}});
    await assert.rejects(adapter.comments({reference:BV}),/aid无效|元信息结构/);assert.equal(requests,1);assert.equal(adapter.capabilities().connection.state,'failed');
  }
});

test('Bilibili HTTP platform restrictions stop immediately and preserve channel-local cooldown',async()=>{
  for(const status of [401,403,412,429]){
    let time=1000,requests=0;const adapter=createBilibiliAdapter({now:()=>time,fetchImpl:async()=>{requests++;return new Response('',{status});}});
    await assert.rejects(adapter.comments({reference:BV}),/停止并暂停/);assert.equal(requests,1);assert.equal(adapter.capabilities().readAvailability.read.available,false);
    await assert.rejects(adapter.read({reference:BV}),/冷却期/);assert.equal(requests,1);time+=5*60*1000;assert.equal(adapter.capabilities().readAvailability.read.available,true);
  }
});

test('Bilibili API restrictions stop immediately without reply requests or retries',async()=>{
  for(const code of [-352,-412,-509,-799]){
    let requests=0;const adapter=createBilibiliAdapter({fetchImpl:async()=>{requests++;return new Response(JSON.stringify({code}),{headers:{'content-type':'application/json'}});}});
    await assert.rejects(adapter.comments({reference:BV}),new RegExp('code='+code));assert.equal(requests,1);assert.equal(adapter.capabilities().readAvailability.comments.available,false);
  }
});

test('Bilibili rejects redirects, wrong MIME, invalid JSON and both declared and streamed oversize bodies',async()=>{
  const cases=[()=>new Response('',{status:302,headers:{location:'https://evil.example/'}}),()=>new Response('<html>captcha</html>',{headers:{'content-type':'text/html'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(512*1024+1)}}),()=>new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}})];
  for(const response of cases){let requests=0;const adapter=createBilibiliAdapter({fetchImpl:async()=>{requests++;return response();}});await assert.rejects(adapter.read({reference:BV}),/异常|JSON|体积限制/);assert.equal(requests,1);}
});

test('Bilibili propagates cancellation before and during fetch and serializes without starting a second request',async()=>{
  let calls=0,started;const gate=new Promise(resolve=>{started=resolve;}),controller=new AbortController();
  const adapter=createBilibiliAdapter({fetchImpl:async()=>{calls++;started();return new Promise(()=>{});}});
  const first=adapter.read({reference:BV},controller.signal);await gate;
  await assert.rejects(adapter.read({reference:SECOND}),/正在运行/);assert.equal(calls,1);controller.abort(new Error('synthetic-cancel'));await assert.rejects(first,/synthetic-cancel/);
  await assert.rejects(adapter.read({reference:BV},controller.signal),/synthetic-cancel/);assert.equal(calls,1);
});

test('Bilibili cancellation interrupts a pending response stream',async()=>{
  const controller=new AbortController();let reading;const ready=new Promise(resolve=>{reading=resolve;});
  const stream=new ReadableStream({pull(){reading();return new Promise(()=>{});}});
  const adapter=createBilibiliAdapter({fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}})});
  const request=adapter.read({reference:BV},controller.signal);await ready;controller.abort(new Error('stream-cancel'));await assert.rejects(request,/stream-cancel/);
});

test('Bilibili hard timeout stops a transport that ignores cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const adapter=createBilibiliAdapter({fetchImpl:()=>new Promise(()=>{})}),request=adapter.read({reference:BV});
  t.mock.timers.tick(15000);await assert.rejects(request,/超时/);assert.equal(adapter.capabilities().connection.state,'failed');
});

test('Bilibili search uses scoped host lookup, genuine parent propagation and structured sources only',async()=>{
  const exec=context(),lookups=[],inputs=[],tools={get:(name,agent)=>{lookups.push([name,agent]);return {execute:()=>{throw Error('Must not invoke definition directly');}};},execute:async input=>{inputs.push(input);return {isError:false,value:{sources:[{url:'https://www.bilibili.com/video/'+BV+'/?p=2',title:'合成标题',snippet:'合成摘要'},{url:'https://bilibili.com/video/'+BV},{url:'https://evil.example/video/'+BV},{url:'https://www.bilibili.com.evil.example/video/'+BV},{url:'https://b23.tv/abc'},{url:'https://www.bilibili.com/video/'+SECOND}],truncated:false}};}};
  const adapter=createBilibiliAdapter({store:forbiddenStore,getTools:()=>tools,fetchImpl:()=>{throw Error('Search must use host');}});
  assert.equal(adapter.capabilities().readAvailability.search.available,false);assert.equal(adapter.capabilities(exec).readAvailability.search.available,true);
  const result=await adapter.search({query:'  合成主题  ',count:1},exec.signal,exec),input=inputs[0];
  assert.deepEqual(input.arguments,{queries:['site:bilibili.com/video 合成主题']});assert.equal(input.name,'web_search');assert.equal(input.agent,exec.agent);assert.equal(input.parent,exec.token);assert.equal(input.rootCallId,exec.rootCallId);assert.equal(input.signal,exec.signal);assert.notEqual(input.callId,exec.callId);assert.equal(result.items.length,1);assert.equal(result.items[0].url,'https://www.bilibili.com/video/'+BV+'/');assert.equal(result.truncated,true);assert.match(result.scope,/不是B站站内搜索/);assert.equal(lookups.every(([name,agent])=>['web_search','social_search','social_read','social_comments'].includes(name)&&agent===exec.agent),true);
  await adapter.search({query:'另一个合成主题'},exec.signal,{...exec,rootCallId:undefined});assert.notEqual(inputs[1].callId,input.callId);assert.equal(inputs[1].rootCallId,exec.callId);assert.equal(adapter.capabilities().readAvailability.search.connection.state,'verified');assert.equal(adapter.capabilities().readAvailability.read.connection.state,'unchecked');
});

test('Bilibili missing or hidden host search and absent parent tokens never dispatch',async()=>{
  let calls=0;const exec=context();
  for(const getTools of [()=>null,()=>({get:()=>undefined,execute:()=>{calls++;}}),()=>({get:()=>({}),execute:()=>{calls++;}})]){
    const adapter=createBilibiliAdapter({getTools});await assert.rejects(adapter.search({query:'合成主题'},undefined,{...exec,token:undefined}),/真实执行上下文/);await assert.rejects(adapter.search({query:'合成主题'}),/真实执行上下文/);
  }
  assert.equal(calls,0);
});

test('Bilibili facade visibility is independently checked and never inferred from fetch or dependency presence',()=>{
  const exec=context(),adapter=createBilibiliAdapter({getTools:()=>({get:name=>name==='web_search'?{}:undefined,execute:async()=>{}})}),status=adapter.capabilities(exec);
  assert.equal(status.available,true);assert.equal(status.currentSessionVisible,false);
  for(const name of ['search','read','comments']){assert.equal(status.readAvailability[name].currentSessionVisible,false);assert.equal(status.readAvailability[name].available,false);}
  assert.match(status.readAvailability.search.reason,/social_search/);assert.equal(createBilibiliAdapter().capabilities(exec).currentSessionVisible,null);
});

test('Bilibili host failures and malformed search values cannot be mistaken for successful empty results',async()=>{
  for(const result of [{isError:true,error:{message:'synthetic guard denial'},value:{sources:[]}},{isError:false,value:{content:'synthetic text without sources'}},{value:{sources:[]}}]){
    const adapter=createBilibiliAdapter({getTools:()=>({get:()=>({}),execute:async()=>result})});await assert.rejects(adapter.search({query:'合成主题'},undefined,context()),/执行失败|结构化sources/);assert.equal(adapter.capabilities().connection.state,'failed');
  }
});
