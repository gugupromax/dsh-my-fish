// Installed-host contract only: real execution tokens, synthetic agents and
// no-op search results. No model, network, account data, or social write runs.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBilibiliAdapter} from '../lib/channels/bilibili.js';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const fibers=[],disposers=[],detach=[];
let passed=false;
try{
  const [{Context},{default:SystemPrompt},{ToolRuntime},{AgentRegistry}]=await Promise.all([hostImport('cordis'),hostImport('dsh-system-prompt'),hostImport('dsh-tools'),hostImport('dsh-agent')]);
  const ctx=new Context();
  for(const [plugin,config] of [[SystemPrompt,{includeHarnessIdentity:false}],[ToolRuntime,{mode:'native'}],[AgentRegistry,{}]]){const fiber=ctx.plugin(plugin,config);fibers.push(fiber);await fiber;}
  const main={id:'synthetic-bili-main',session:{id:'synthetic-bili-main'}},child={id:'synthetic-bili-child',session:{id:'synthetic-bili-child'}};
  detach.push(ctx.agents.enter(main));detach.push(ctx.agents.enter(child,main));assert.equal(ctx.agents.isOwnedBy(child.id,main),true);
  const nestedInputs=[],outerTokens=[],guarded=[];let bodies=0,deny=false;
  const adapter=createBilibiliAdapter({fetchImpl:()=>{throw Error('No network may run in the host bridge test');},getTools:()=>({get:(name,agent)=>ctx.tools.get(name,agent),execute:input=>{nestedInputs.push(input);return ctx.tools.execute(input);}})});
  const output={schema:{},render:()=>[{type:'text',text:'Synthetic no-op bridge result'}]};
  disposers.push(ctx.tools.register({name:'web_search',description:'Synthetic no-op public search fixture',parameters:{type:'object',properties:{queries:{type:'array',items:{type:'string'}}},required:['queries'],additionalProperties:false},output,execute:(args,exec)=>{bodies++;assert.deepEqual(args.queries,['site:bilibili.com/video synthetic public topic']);assert.ok(exec.token);return {sources:[{url:'https://www.bilibili.com/video/BV1xx411c7mD/',title:'Synthetic public video',snippet:'Synthetic search excerpt'},{url:'https://invalid.example/video/BV1xx411c7mD/'}],truncated:false};}}));
  disposers.push(ctx.tools.register({name:'social_search',description:'Synthetic outer channel facade fixture',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},output,execute:(args,exec)=>{outerTokens.push(exec.token);return adapter.search(args,exec.signal,exec);}}));
  disposers.push(ctx.tools.guard(exec=>{if(exec.name!=='web_search')return;guarded.push(exec.agent);if(deny)return 'Synthetic nested search guard denial';}));
  const input=(agent,callId)=>({name:'social_search',agent,arguments:{query:'synthetic public topic'},callId,signal:new AbortController().signal});
  const initial=adapter.capabilities();assert.equal(initial.currentSessionVisible,null);assert.equal(initial.readAvailability.search.currentSessionVisible,null);assert.equal(initial.connection.state,'unchecked');
  for(const [agent,index] of [[main,1],[child,2]]){
    const call=input(agent,'synthetic-bili-outer-'+index),result=await ctx.tools.execute(call);
    assert.equal(result.isError,false);assert.equal(result.value.items.length,1);assert.equal(result.value.items[0].bvid,'BV1xx411c7mD');
    const nested=nestedInputs.at(-1);assert.equal(nested.agent,agent);assert.equal(nested.parent,outerTokens.at(-1));assert.ok(nested.parent,'parent must be a real registry-minted token');assert.equal(nested.rootCallId,call.callId);assert.notEqual(nested.callId,call.callId);assert.equal(guarded.at(-1),agent);
  }
  assert.equal(bodies,2);assert.notEqual(nestedInputs[0].callId,nestedInputs[1].callId);
  deny=true;const rejected=await ctx.tools.execute(input(main,'synthetic-bili-denied'));
  assert.equal(rejected.isError,true);assert.equal(bodies,2,'nested host guard must deny before the search body');assert.equal(adapter.capabilities().readAvailability.search.connection.state,'failed');
  deny=false;
  await assert.rejects(adapter.search({query:'synthetic public topic'},new AbortController().signal,{agent:main,callId:'synthetic-missing-parent'}),/真实执行上下文/);
  assert.equal(bodies,2,'missing outer execution context must not dispatch');
  passed=true;
}finally{
  for(const dispose of disposers.reverse())await dispose();
  for(const leave of detach.reverse())leave();
  for(const fiber of fibers.reverse())await fiber.dispose();
}
if(passed)console.log(JSON.stringify({hostChannelBridge:'passed',scopeAwareLookup:'passed',registryMintedParentToken:'passed',rootCallPropagation:'passed',nestedGuardEnforcement:'passed',missingParentRejected:'passed',modelCalls:0,networkCalls:0,socialWrites:0,scope:'Installed Cordis/ToolRuntime/AgentRegistry; synthetic agents and no-op structured web_search only'}));
