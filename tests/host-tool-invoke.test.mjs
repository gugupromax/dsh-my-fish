import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostToolInvoker} from '../lib/host-tool-invoke.js';

const input=()=>({name:'web_search',arguments:{queries:['Synthetic public source']},agent:{id:'synthetic-agent'},parent:{},rootCallId:'root',callId:'child',signal:new AbortController().signal,toolSet:{}});

test('legacy host calls retain their original execution context without loading a modern SDK',async()=>{
  const call=input();let received;
  const invoke=createHostToolInvoker({tools:{get(){},execute:async value=>{received=value;return {ok:true};}},loader:{import:()=>{throw Error('must not import');}}});
  assert.equal(invoke.available(),true);assert.deepEqual(await invoke(call),{ok:true});assert.equal(received,call);
});

test('modern nested calls preserve admission and provenance, use completion, and never use the batch entry',async()=>{
  for(const denied of [false,true]){
    const call=input(),calls=[];const result={isError:denied};
    class Pipeline{
      constructor(ctx){assert.equal(ctx.tools.setExecutor instanceof Function,true);}
      async prepare(value){assert.equal(value,call);calls.push('prepare');return {kind:denied?'post-result':'dispatch',exec:value,result};}
      async dispatch(exec){assert.equal(exec.parent,call.parent);assert.equal(exec.toolSet,call.toolSet);calls.push('dispatch');return {kind:'post-result',result};}
      async complete(exec,outcome){assert.equal(exec.rootCallId,'root');assert.equal(outcome.result,result);calls.push('complete');return result;}
    }
    const invoke=createHostToolInvoker({tools:{get(){},setExecutor(){},execute:()=>{throw Error('batch entry loses nested context');}},loader:{import:async spec=>{assert.equal(spec,'@deepseek-ai/dsh-tools/pipeline');return {ToolExecutionPipeline:Pipeline};}}});
    assert.equal(await invoke(call),result);assert.deepEqual(calls,denied?['prepare','complete']:['prepare','dispatch','complete']);
  }
});

test('missing caller or public SDK service fails closed without falling back to batch or direct tool bodies',async()=>{
  let batches=0;
  const ctx={tools:{get(){},setExecutor(){},execute:()=>{batches++;}}},invoke=createHostToolInvoker(ctx);
  assert.equal(invoke.available(),false);
  await assert.rejects(invoke({...input(),parent:undefined}),/真实执行来源/);
  await assert.rejects(invoke(input()),/加载服务未就绪/);
  ctx.loader={import:async()=>{throw Error('Synthetic unavailable SDK');}};
  await assert.rejects(invoke(input()),/unavailable/);assert.equal(batches,0);
});
