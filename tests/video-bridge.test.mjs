import test from 'node:test';import assert from 'node:assert/strict';
import {VideoBridge,videoReference} from '../lib/video-bridge.js';
const BV='BV1GJ411x7h7',URL='https://www.bilibili.com/video/'+BV+'/';
const image={attachmentId:'sha256:'+'a'.repeat(64),mediaType:'image/png',width:800,height:450,bytes:30000};
function fixture({visible=true,handler}={}){
  const agent={id:'main',session:{id:'main'}},exec={agent,token:{minted:'synthetic'},callId:'outer',rootCallId:'outer',toolSet:{synthetic:true},signal:new AbortController().signal},calls=[];
  const invokeTool=async input=>{calls.push(input);return handler?handler(input):{isError:false,value:input.name==='video_probe'?{text:'<video duration="300" />'}:{text:'Synthetic window index',images:[image]}};};
  const bridge=new VideoBridge({getTools:()=>({get:()=>visible?{}:undefined}),invokeTool,store:{state:()=>({sessionId:'main'})}});
  return {bridge,exec,calls};
}
test('video references normalize only canonical public platform links',()=>{
  assert.equal(videoReference(BV),URL);assert.equal(videoReference(URL+'?spm_id_from=tracking'),URL);assert.equal(videoReference('https://youtu.be/dQw4w9WgXcQ'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  for(const value of ['C:/Private/video.mp4','file:///tmp/test.mp4','https://127.0.0.1/video/'+BV,'https://b23.tv/a','https://user:pass@www.bilibili.com/video/'+BV,'https://www.bilibili.com.evil.example/video/'+BV,URL+'?token=private',URL+'#private','https://www.bilibili.com/a/../video/'+BV])assert.throws(()=>videoReference(value),undefined,value);
});
test('explicit current-main read uses guarded probe then a bounded storyboard and native attachments',async()=>{
  const {bridge,exec,calls}=fixture(),result=await bridge.read({reference:BV,from:10,seconds:45},exec.signal,exec);
  assert.equal(result.ok,true);assert.equal(result.hasFrames,true);assert.equal(result.hasTranscript,null);assert.deepEqual(result.images,[image]);assert.equal(result.from,10);assert.equal(result.to,55);
  assert.deepEqual(calls.map(c=>c.name),['video_probe','video_storyboard']);
  assert.deepEqual(calls[1].arguments,{input:URL,from:10,to:55,segment:45,maxFrames:12,maxSheets:2,scanHeight:360,budget:360000,allowAnonymous:true,detail:'low',transcript:'auto',ocr:false,sourceHash:false});
  for(const call of calls){assert.equal(call.parent,exec.token);assert.equal(call.rootCallId,exec.callId);assert.equal(call.agent,exec.agent);assert.equal(call.toolSet,exec.toolSet);assert.notEqual(call.callId,exec.callId);}
  assert.match(result.scope,/Cookie/);assert.equal(bridge.busy,false);
});
test('missing provider returns unavailable and invalid bounds or foreign sessions never dispatch',async()=>{
  const f=fixture({visible:false});assert.equal((await f.bridge.read({reference:BV},f.exec.signal,f.exec)).unavailable,true);assert.equal(f.calls.length,0);
  const live=fixture();for(const args of [{reference:BV,seconds:181},{reference:BV,from:-1},{reference:BV,cookies:'C:/Private'},{reference:BV,phase:'zoom'}])await assert.rejects(live.bridge.read(args,live.exec.signal,live.exec));
  await assert.rejects(live.bridge.read({reference:BV},live.exec.signal,{...live.exec,agent:{id:'other'}}),/主会话/);assert.equal(live.calls.length,0);
});
test('probe produces no media claim and local paths are not returned as source evidence',async()=>{
  const f=fixture({handler:async()=>({isError:false,value:{text:'<video path="C:/Private/cache.mp4" duration="10" /> /tmp/private/frame.png'}})});
  const result=await f.bridge.read({reference:BV,phase:'probe'},f.exec.signal,f.exec);assert.equal(f.calls.length,1);assert.equal(result.hasFrames,false);assert.deepEqual(result.images,[]);assert.doesNotMatch(result.text,/Private|\/tmp\/private/);
});
test('file paths and malformed provider outputs cannot masquerade as actual image attachments',async()=>{
  for(const images of [['C:/Private/image.png'],[{path:'C:/Private/image.png'}],[image,image,image]]){
    const f=fixture({handler:async input=>({isError:false,value:input.name==='video_probe'?{text:'probe'}:{text:'index',images}})});
    await assert.rejects(f.bridge.read({reference:BV},f.exec.signal,f.exec),/附件|图片/);assert.equal(f.bridge.busy,false);
  }
  const f=fixture({handler:async()=>({isError:true,error:{message:'Private source error'}})});await assert.rejects(f.bridge.read({reference:BV},f.exec.signal,f.exec),/未成功/);assert.equal(f.calls.length,1);
});
test('nested permission is scoped to the exact in-flight stage, agent, parent and root call',async()=>{
  let tested=0;const f=fixture({handler:async input=>{assert.equal(f.bridge.allowsNested({...input}),true);assert.equal(f.bridge.allowsNested({...input,name:'video_zoom'}),false);assert.equal(f.bridge.allowsNested({...input,parent:{}}),false);assert.equal(f.bridge.allowsNested({...input,rootCallId:'other'}),false);tested++;return {isError:false,value:input.name==='video_probe'?{text:'probe'}:{text:'index',images:[]}};}});
  const result=await f.bridge.read({reference:BV},f.exec.signal,f.exec);assert.equal(tested,2);assert.equal(result.hasFrames,false);assert.equal(f.bridge.allowsNested(f.calls[1]),false);
});
test('cancellation stops delivery and holds the in-flight lock until an uncooperative provider settles',async()=>{
  let resolve;const gate=new Promise(r=>resolve=r),abort=new AbortController(),f=fixture({handler:()=>gate});
  const pending=f.bridge.read({reference:BV},abort.signal,f.exec);await new Promise(r=>setImmediate(r));assert.equal(f.bridge.busy,true);abort.abort();await assert.rejects(pending,/停止等待/);assert.equal(f.bridge.busy,true);
  await assert.rejects(f.bridge.read({reference:BV},f.exec.signal,f.exec),/尚在处理/);assert.equal(f.bridge.allowsNested(f.calls[0]),false);
  resolve({isError:false,value:{text:'late probe'}});await new Promise(r=>setImmediate(r));assert.equal(f.bridge.busy,false);assert.equal(f.calls.length,1);
});
