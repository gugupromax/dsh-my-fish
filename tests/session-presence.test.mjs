import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionProbe} from '../lib/session-presence.js';
const signal=()=>new AbortController().signal;
test('a live session is valid without persistence and does not read a log',async()=>{
  const probe=createSessionProbe({getSessions:()=>({get:id=>({id})}),getPersistence:()=>{throw Error('must not inspect body or persistence');}});
  assert.equal(await probe('main',signal()),'exists');
});
test('saved metadata including archived records is valid and never restores an agent',async()=>{
  let reads=0;const probe=createSessionProbe({getSessions:()=>({get:()=>undefined}),getPersistence:()=>({stat:async(id,options)=>{options.signal.throwIfAborted();reads++;return {header:{id,version:4},revision:'synthetic',archived:true};}})});
  assert.equal(await probe('main',signal()),'exists');assert.equal(reads,1);
});
test('unready metadata service, malformed records, IO errors and cancellation are never missing evidence',async()=>{
  const sessions={get:()=>undefined};
  await assert.rejects(()=>createSessionProbe({getSessions:()=>sessions})('main',signal()),/尚未就绪/);
  for(const metadata of [null,{},false,{header:{id:'different'},revision:'x'}])await assert.rejects(()=>createSessionProbe({getSessions:()=>sessions,getPersistence:()=>({stat:async()=>metadata})})('main',signal()),/元数据/);
  await assert.rejects(()=>createSessionProbe({getSessions:()=>sessions,getPersistence:()=>({stat:async()=>{throw Error('IO fixture');}})})('main',signal()),/IO fixture/);
  const aborted=new AbortController();aborted.abort(Error('cancel fixture'));await assert.rejects(()=>createSessionProbe({})('main',aborted.signal),/cancel fixture/);
});
test('absence requires strict undefined, a second live check and no lingering runtime',async()=>{
  const base={getSessions:()=>({get:()=>undefined}),getPersistence:()=>({stat:async()=>undefined})};
  await assert.rejects(()=>createSessionProbe(base)('main',signal()),/运行状态/);
  await assert.rejects(()=>createSessionProbe({...base,getRegistry:()=>({list:()=>[{id:'main',session:{id:'main'}}]})})('main',signal()),/卸载|运行/);
  assert.equal(await createSessionProbe({...base,getRegistry:()=>({list:()=>[]})})('main',signal()),'missing');
  let checks=0;assert.equal(await createSessionProbe({...base,getSessions:()=>({get:id=>++checks===1?undefined:{id}})})('main',signal()),'exists');
});
