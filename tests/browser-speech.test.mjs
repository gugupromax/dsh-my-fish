import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
const local={name:'Synthetic local Chinese',lang:'zh-CN',localService:true};
const cloud={name:'Synthetic cloud Chinese',lang:'zh-CN',localService:false};
function factory(){let exported;vm.runInNewContext(source,{window:{__ModuleLoader__:{load:definition=>{exported=definition.factory(()=>({createElement(){}}));}}},Date,JSON,URL,AbortController,setTimeout,clearTimeout});return exported.createBrowserSpeechController;}
const state=(seq=0,items=[],extra={})=>({enabled:true,claimed:true,epoch:1,seq,items,...extra});
const item=(seq,text='Synthetic queued speech')=>({seq,messageId:'synthetic-'+seq,text});
async function fixture(t,{voices=[local],initial=state()}={}){
 const timers=new Map(),spoken=[],calls=[];let next=initial,clock=1000,visible=true,number=0,cancelled=0;
 const synthesis={speaking:false,pending:false,getVoices:()=>voices,cancel(){cancelled++;this.speaking=false;this.pending=false;},speak(utterance){spoken.push(utterance);this.speaking=true;utterance.onstart?.();}};
 class Utterance{constructor(text){this.text=text;}}
 const controller=factory()({request:request=>{calls.push(request);return typeof next==='function'?next(request):Promise.resolve(next);},synthesis,Utterance,isVisible:()=>visible,now:()=>clock,setTimer:(fn,ms)=>{const id=++number;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id),timeoutMs:2500});
 t.after(()=>controller.stop());controller.start();await new Promise(setImmediate);
 return {controller,synthesis,spoken,calls,timers,setNext:value=>next=value,advance:ms=>clock+=ms,setVisible:value=>visible=value,cancelled:()=>cancelled,
  finish(){synthesis.speaking=false;spoken.at(-1)?.onend?.();},async poll(value){if(value!==undefined)next=value;await controller.poll();}};
}
test('browser speech selects only confirmed local Chinese voices, never cloud or unknown-locality voices',async t=>{
 const f=await fixture(t,{voices:[cloud,{name:'Unknown locality',lang:'zh-CN'}, {name:'Local English',lang:'en-US',localService:true},local]});
 await f.poll(state(1,[item(1)]));assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].voice,local);assert.equal(f.spoken[0].lang,'zh-CN');
 assert.equal(f.controller.status().localVoices.length,1);assert.equal(f.cancelled(),0);
 const unsupported=await fixture(t,{voices:[cloud]});await unsupported.poll(state(1,[item(1)]));assert.equal(unsupported.spoken.length,0);assert.match(unsupported.controller.status().message,/本地中文音色/);assert.throws(()=>unsupported.controller.preview(),/本地中文音色/);
});
test('first activation skips existing replies and the actual queue pump chains new utterances',async t=>{
 const f=await fixture(t,{initial:state(5,[item(4,'Old reply'),item(5,'Latest old reply')])});assert.equal(f.spoken.length,0);
 await f.poll(state(7,[item(6,'New first sentence'),item(7,'New second sentence')]));assert.equal(f.calls.at(-1).after,5);assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].text,'New first sentence');
 f.finish();assert.equal(f.spoken.length,2);assert.equal(f.spoken[1].text,'New second sentence');f.finish();assert.equal(f.controller.status().active,false);
 await f.poll(state(7,[item(6),item(7)]));assert.equal(f.spoken.length,2,'already accepted sequence numbers do not replay');
});
test('epoch changes stop current speech and clear old pending sentences before handling new work',async t=>{
 const f=await fixture(t);await f.poll(state(2,[item(1,'Old first'),item(2,'Old second')]));assert.equal(f.spoken.length,1);
 await f.poll(state(2,[],{epoch:2}));assert.equal(f.cancelled(),1);assert.equal(f.controller.status().active,false);
 await f.poll(state(3,[item(3,'New after user')],{epoch:2}));assert.equal(f.spoken.at(-1).text,'New after user');assert.equal(f.spoken.length,2);
});
test('disabled speech stops only its owned utterance and reenabling skips accumulated old replies',async t=>{
 const f=await fixture(t);await f.poll(state(1,[item(1)]));await f.poll(state(3,[item(2),item(3)],{enabled:false}));assert.equal(f.cancelled(),1);assert.equal(f.spoken.length,1);
 await f.poll(state(5,[item(4),item(5)]));assert.equal(f.spoken.length,1);await f.poll(state(6,[item(6,'After reenabling')]));assert.equal(f.spoken.at(-1).text,'After reenabling');
});
test('losing the consumer lease or hiding the page stops owned speech, and visibility return skips stale messages',async t=>{
 const f=await fixture(t);await f.poll(state(1,[item(1)]));await f.poll(state(2,[item(2)],{claimed:false}));assert.equal(f.cancelled(),1);assert.match(f.controller.status().message,/其它窗口/);
 await f.poll(state(3,[item(3)]));assert.equal(f.spoken.length,2);f.setVisible(false);await f.poll();assert.equal(f.cancelled(),2);assert.match(f.controller.status().message,/不可见/);
 f.setVisible(true);await f.poll(state(5,[item(4),item(5)]));assert.equal(f.spoken.length,2);await f.poll(state(6,[item(6)]));assert.equal(f.spoken.length,3);
});
test('local typing interrupts immediately and pauses newly arrived messages during its quiet interval',async t=>{
 const f=await fixture(t);await f.poll(state(1,[item(1)]));f.controller.interrupt();assert.equal(f.cancelled(),1);await f.poll(state(2,[item(2)]));assert.equal(f.spoken.length,1);
 f.advance(15001);await f.poll(state(3,[item(3,'After input pause')]));assert.equal(f.spoken.at(-1).text,'After input pause');assert.equal(f.spoken.length,2);
});
test('connection timeout cancels pending owned speech even if the transport never resolves',async t=>{
 const f=await fixture(t);await f.poll(state(1,[item(1)]));f.setNext(()=>new Promise(()=>{}));const pending=f.controller.poll();
 const timeout=[...f.timers.values()].find(timer=>timer.ms===2500);assert.ok(timeout);timeout.fn();await pending;assert.equal(f.calls.at(-1).signal.aborted,true);assert.equal(f.cancelled(),1);assert.match(f.controller.status().message,/连接暂不可用/);
});
test('a busy foreign speech engine is never cancelled by polling, preview or explicit stop without owned audio',async t=>{
 const f=await fixture(t);f.synthesis.speaking=true;await f.poll(state(1,[item(1)]));assert.equal(f.spoken.length,0);assert.throws(()=>f.controller.preview(),/其它语音/);f.controller.interrupt();f.controller.stop();assert.equal(f.cancelled(),0);
});
