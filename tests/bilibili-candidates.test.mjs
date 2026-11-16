import test from 'node:test';import assert from 'node:assert/strict';import {BilibiliCandidates} from '../lib/bilibili-candidates.js';
const bv='BV1GJ411x7h7';
function fixture(){
 let main='main-a',now=1000,calls=0;
 let provider=async()=>({ok:true,platform:'bilibili',source:'public-popular',candidatesOnly:true,personalized:false,items:[{bvid:bv,title:'合成标题',author:'合成作者',snippet:'合成摘要',url:'https://attacker.invalid/?token=secret',publishedAt:123},{bvid:bv,title:'重复'},{bvid:'invalid',title:'无效'}]});
 const candidates=new BilibiliCandidates({getMain:()=>main,discover:async(...args)=>{calls++;return provider(...args);},now:()=>now,ttlMs:100});
 return {candidates,setMain:value=>main=value,setNow:value=>now=value,setProvider:value=>provider=value,get calls(){return calls;}};
}
test('only trusted discover supplies bounded unpersonalized candidates; selection does not read or mint receipts',async()=>{
 const f=fixture();assert.equal(f.candidates.snapshot().state,'empty');assert.equal(f.calls,0);
 const result=await f.candidates.refresh();assert.equal(f.calls,1);assert.equal(result.personalized,false);assert.equal(result.items.length,1);assert.equal(result.items[0].url,'https://www.bilibili.com/video/'+bv+'/');assert.doesNotMatch(JSON.stringify(result),/attacker|secret/);
 assert.deepEqual(f.candidates.select(bv),{ok:true,reference:bv,note:'仅选择了候选；是否读取以主会话实际结果为准。'});assert.equal(f.calls,1);assert.equal(Object.hasOwn(result,'companionReceipts'),false);
});
test('expired, switched, invalidated, and unknown candidates cannot be selected',async()=>{
 const f=fixture();await f.candidates.refresh();assert.throws(()=>f.candidates.select('BV1abcdefghi'),/失效|有效/);f.setMain('main-b');assert.equal(f.candidates.snapshot().items.length,0);assert.throws(()=>f.candidates.select(bv),/失效/);f.setMain('main-a');f.setNow(1100);assert.throws(()=>f.candidates.select(bv),/失效/);f.setNow(1050);f.candidates.invalidate();assert.throws(()=>f.candidates.select(bv),/失效/);
 f.setMain(null);await assert.rejects(f.candidates.refresh(),/绑定/);
});
test('forged provider shape and private material do not enter candidate cache',async()=>{
 const f=fixture();for(const result of [{ok:true,platform:'bilibili',items:[]},{ok:true,platform:'other',source:'public-popular',candidatesOnly:true,personalized:false,items:[]},{ok:true,platform:'bilibili',source:'public-popular',candidatesOnly:true,personalized:false,items:Array(6).fill({})}]){f.setProvider(async()=>result);await assert.rejects(f.candidates.refresh(),/格式/);}
 f.setProvider(async()=>({ok:true,platform:'bilibili',source:'public-popular',candidatesOnly:true,personalized:false,items:[{bvid:bv,title:'cookie=synthetic-secret',author:'A',snippet:'auth_token=secret'}]}));const out=await f.candidates.refresh();assert.doesNotMatch(JSON.stringify(out),/synthetic-secret|auth_token=secret/);
});
test('a late result after invalidation or abort never replaces current candidates',async()=>{
 const f=fixture();let resolve;f.setProvider(()=>new Promise(r=>resolve=r));const pending=f.candidates.refresh();await assert.rejects(f.candidates.refresh(),/正在/);f.candidates.invalidate();resolve({ok:true,platform:'bilibili',source:'public-popular',candidatesOnly:true,personalized:false,items:[{bvid:bv,title:'合成'}]});await assert.rejects(pending,/变化/);assert.equal(f.candidates.snapshot().items.length,0);
 const abort=new AbortController();f.setProvider(()=>new Promise(r=>resolve=r));const next=f.candidates.refresh(abort.signal);abort.abort();resolve({ok:true,platform:'bilibili',source:'public-popular',candidatesOnly:true,personalized:false,items:[]});await assert.rejects(next,/取消/);assert.equal(f.candidates.snapshot().items.length,0);
});
