import test from 'node:test';
import assert from 'node:assert/strict';
import {ExploreHost} from '../lib/explore-host.js';
import {EXPLORE_PRESET_ID,registerExplorePreset} from '../lib/explore-preset.js';

function fixture(){
  const agents=new Map(),calls=[];
  const registry={get:id=>agents.get(id)},presets={resolve:async()=>({id:EXPLORE_PRESET_ID}),composedPreset:ctx=>ctx.preset};
  const controller={create:async input=>{calls.push(['create',input]);agents.set(input.sessionId,{id:input.sessionId,session:{id:input.sessionId},ctx:{preset:input.agentPreset},model:{select:value=>calls.push(['model',value])},cancel:(...args)=>calls.push(['cancel',...args])});return {sessionId:input.sessionId};},prompt:async input=>{calls.push(['prompt',input]);return {accepted:true};},resolveAgent:async id=>({agent:agents.get(id)})};
  return {agents,calls,controller,presets,host:new ExploreHost({getController:()=>controller,getRegistry:()=>registry,getPresets:()=>presets})};
}
const input={sessionId:'synthetic-explore',requestId:'synthetic-request',cwd:'E:/Synthetic',prompt:'Synthetic exploration'};
test('explore host creates a dedicated preset identity, prompts once and clears inbox on cancellation',async()=>{
  const f=fixture(),result=await f.host.start(input,new AbortController().signal);
  assert.equal(result.hidden,false);assert.equal(result.presetId,EXPLORE_PRESET_ID);assert.equal(f.calls[0][1].agentPreset,EXPLORE_PRESET_ID);
  assert.equal(f.calls[1][1].sessionId,input.sessionId);assert.equal(f.calls[1][1].requestId,input.requestId);
  await assert.rejects(f.host.start(input),/已存在/);assert.equal(f.calls.length,2);
  assert.equal((await f.host.cancel(input.sessionId)).cancelled,true);assert.deepEqual(f.calls.at(-1).slice(1),[{kind:'hook',reason:'探索轮次已停止'},{keepInbox:false}]);
});
test('unready preset, aborted dispatch and mismatched identities never prompt',async()=>{
  const f=fixture();f.presets.resolve=async()=>({id:'other'});await assert.rejects(f.host.start(input),/预设未就绪/);assert.equal(f.calls.length,0);
  f.presets.resolve=async()=>({id:EXPLORE_PRESET_ID});const abort=new AbortController();abort.abort();await assert.rejects(f.host.start(input,abort.signal));assert.equal(f.calls.length,0);
  f.controller.create=async()=>({sessionId:'unexpected'});await assert.rejects(f.host.start(input),/不同探索身份/);assert.equal(f.calls.length,0);
});
test('model inheritance selects only the new verified agent and forwards no unrelated fields',async()=>{
  const f=fixture();await f.host.start({...input,modelSelection:{provider:'synthetic-provider',model:'synthetic-model',reasoningEffort:'high',unrelated:'not forwarded'}});
  assert.deepEqual(f.calls[1],['model',{provider:'synthetic-provider',model:'synthetic-model',reasoningEffort:'high'}]);assert.equal(f.calls[2][0],'prompt');
});
test('workspace grouping passes only workspaceId and preserves the requested background identity',async()=>{
  const f=fixture();await f.host.start({...input,workspaceId:'synthetic-workspace'});
  assert.deepEqual(f.calls[0],['create',{sessionId:input.sessionId,workspaceId:'synthetic-workspace',agentPreset:EXPLORE_PRESET_ID}]);assert.equal(Object.hasOwn(f.calls[0][1],'cwd'),false);
  const invalid=fixture();await assert.rejects(invalid.host.start({...input,workspaceId:''}),/参数无效/);assert.equal(invalid.calls.length,0);
});
test('foreign sessions cannot be cancelled and preset lifecycle refuses unresolved registrations',async()=>{
  const f=fixture();f.agents.set('synthetic-foreign',{session:{id:'synthetic-foreign'},ctx:{preset:'other'},cancel:()=>assert.fail()});assert.equal((await f.host.cancel('synthetic-foreign')).cancelled,false);
  let disposed=0;const runtime=registerExplorePreset({register:async()=>()=>disposed++,resolve:async()=>({id:EXPLORE_PRESET_ID})});await runtime.ensureReady();await runtime.dispose();assert.equal(disposed,1);await assert.rejects(runtime.ensureReady(),/卸载/);
});
