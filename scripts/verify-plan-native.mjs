// Installed rc5 preset, prompt assembly and ToolRuntime; synthetic data only.
// No model, real schedule, network, user history, account or PTC program runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import plugin from '../lib/index.js';
import {Store} from '../lib/store.js';
import {Permissions} from '../lib/permissions.js';
import {Engine} from '../lib/engine.js';
import {registerPlanPreset, PLAN_PRESET_ID} from '../lib/plan-runtime.js';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryParent=fs.realpathSync.native(os.tmpdir());
const temporaryRoot=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-plan-native-')));
const previousHome=process.env.DSH_HOME,previousFetch=globalThis.fetch,originalEngineRead=Engine.prototype.read;
const fibers=[],scopes=[],disposers=[];
let runtime,passed=false,modelCalls=0,networkCalls=0,scriptBodies=0,statusBodies=0,xSearchBodies=0,fileReads=0,webReads=0;
process.env.DSH_HOME=temporaryRoot;
globalThis.fetch=()=>{networkCalls++;throw Error('No network access allowed');};
// Replace the X backend seam only in this isolated verifier process. The real
// registered x_whale_search definition, runtime visibility and guards still run.
Engine.prototype.read=async function(operation,args,signal){
  signal.throwIfAborted();assert.equal(operation,'search');assert.equal(args.query,'Synthetic X read');xSearchBodies++;
  return {ok:true,items:[{id:'synthetic-x-result',text:'SYNTHETIC_NATIVE_X_SEARCH_CONTENT'}]};
};
try {
  const [{Context},{Loader},{SessionProjectionRegistry},{default:SystemPrompt},{ToolRuntime},{AgentRegistry},{AgentPresetRegistry},{createScope}]=await Promise.all([
    hostImport('cordis'),hostImport('cordis-plugin-loader'),hostImport('dsh-session-projection'),hostImport('dsh-system-prompt'),hostImport('dsh-tools'),hostImport('dsh-agent'),hostImport('dsh-agent-preset-registry'),hostImport('dsh-scope'),
  ]);
  const ctx=new Context(),signal=new AbortController().signal;
  const within=value=>{const resolved=path.resolve(value),relative=path.relative(temporaryRoot,resolved);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Only synthetic temporary file reads are permitted');return resolved;};
  fs.writeFileSync(path.join(temporaryRoot,'synthetic-source.txt'),'SYNTHETIC_NATIVE_READ_CONTENT\n');
  ctx.provide('ptcRuntime',{language:'typescript',programFormat:'function-body',execute:()=>{scriptBodies++;throw Error('PTC program body must never run');}});
  ctx.provide('llm',new Proxy({}, {get:()=>()=>{modelCalls++;throw Error('No model calls allowed');}}));
  ctx.provide('fs',{
    resolve:async(value,{cwd=temporaryRoot,signal}={})=>{signal?.throwIfAborted();const resolved=within(path.resolve(cwd,value));return {path:resolved,displayPath:resolved};},
    stat:async(target,signal)=>{signal?.throwIfAborted();const info=await fs.promises.stat(within(target.path));return {type:info.isFile()?'file':'directory',size:info.size,version:'synthetic-version'};},
    processPath:target=>within(target.path),
    readText:async(target,signal)=>{signal?.throwIfAborted();fileReads++;return fs.promises.readFile(within(target.path),'utf8');},
    streamText:async()=>{throw Error('The small synthetic file must not stream');},
  });
  ctx.provide('workingDirectory',{ensure:async()=>temporaryRoot,get:()=>temporaryRoot});
  ctx.provide('attachments',{imageLimits:{maxImageBytes:1024,maxImagesPerMessage:1,maxMessageImageBytes:1024,maxImagePixels:1,maxImageDimension:1,mediaTypes:[]}});
  ctx.provide('web',{
    search:async({query},signal)=>{signal.throwIfAborted();assert.equal(query,'Synthetic public source');webReads++;return {content:'SYNTHETIC_NATIVE_SEARCH_CONTENT',sources:[{url:'https://example.com/synthetic',title:'Synthetic public source'}],truncated:false};},
    fetch:()=>{throw Error('No actual fetch is permitted');},
  });
  ctx.provide('typert',{
    resources:{register:()=>()=>{}},lookups:{register:()=>()=>{},configure:()=>()=>{}},contexts:{registerHost:()=>()=>{},configureHost:()=>()=>{}},
  });
  const baseUrl=pathToFileURL(path.join(hostRoot,'..','package.json')).href;
  ctx.baseUrl=baseUrl;
  for(const [implementation,config]of [[Loader,{baseUrl}],[SessionProjectionRegistry,{}],[SystemPrompt,{includeHarnessIdentity:false}],[ToolRuntime,{mode:'ptc'}],[AgentRegistry,{}],[AgentPresetRegistry,{default:'synthetic-default-ptc'}]]){
    const fiber=ctx.plugin(implementation,config);fibers.push(fiber);await fiber;
  }
  const main={id:'synthetic-native-main',session:{id:'synthetic-native-main',header:{cwd:temporaryRoot}}};
  const worker={id:'synthetic-native-worker',session:{id:'synthetic-native-worker',header:{cwd:temporaryRoot,sandboxMode:'read-only'}}};
  const legacy={id:'synthetic-legacy-worker',session:{id:'synthetic-legacy-worker',header:{cwd:temporaryRoot,sandboxMode:'read-only'}}};
  for(const agent of [main,worker,legacy]){
    const scope=createScope(ctx,agent);scopes.push(scope);agent.ctx=scope.ctx;
    disposers.push(ctx.agents.enter(agent));
  }
  const store=new Store();store.saveState({...store.state(),sessionId:main.session.id});
  const task={id:'synthetic-native-plan',title:'Synthetic native plan',permission:'read-only',mode:PLAN_PRESET_ID,executions:[{id:'synthetic-native-execution',sessionId:worker.session.id,startedAt:1},{id:'synthetic-legacy-execution',sessionId:legacy.session.id,startedAt:1}],integrations:{'dsh-my-fish':{kind:'personal-plan',version:1,fingerprint:'synthetic-create-fingerprint',instruction:'Synthetic public read'}}};
  const taskBoard={snapshot:()=>({tasks:[structuredClone(task)],scheduler:{timeZone:'UTC'}}),apply:()=>{throw Error('This verifier never creates or changes a scheduled card');}};
  ctx.provide('taskBoard',taskBoard);
  const pluginFiber=ctx.plugin({name:'synthetic-native-my-fish',inject:['tools'],apply:child=>{
    // The tested registration handle above owns the real preset. The wrapper
    // only suppresses duplicate optional registration by the full plugin.
    const toolService={register:definition=>child.tools.register(definition.name==='x_whale_status'?{...definition,execute:(...args)=>{statusBodies++;return definition.execute(...args);}}:definition),guard:callback=>child.tools.guard(callback)};
    plugin.apply({
      tools:toolService,sessionController:{create:()=>{throw Error('No real conversation creation');},prompt:()=>{modelCalls++;throw Error('No model prompt');}},
      webServer:{register:()=>()=>{}},connection:{requestRejection:()=>undefined},logger:child.logger,
      effect:fn=>child.effect(fn),on:(...args)=>child.on(...args),provide:(...args)=>child.provide(...args),
      inject:(names,callback)=>{if(!names.includes('agentPresets'))return child.inject(names,callback);},
    });
  }});fibers.push(pluginFiber);await pluginFiber;await new Promise(resolve=>setImmediate(resolve));
  runtime=registerPlanPreset(ctx.agentPresets);
  await runtime.ready;
  const resolvedPreset=await ctx.agentPresets.resolve(PLAN_PRESET_ID);
  assert.equal(resolvedPreset.broken,undefined,'The real owned preset must mount: '+(resolvedPreset.broken??''));
  assert.equal(await runtime.ensureReady(),PLAN_PRESET_ID);
  assert.equal((await ctx.agentPresets.resolve(PLAN_PRESET_ID)).broken,undefined);
  const assemble=agent=>ctx.systemPrompt.assemble({agent,scope:agent,signal});
  const oldSurface=await assemble(legacy);
  assert.deepEqual(oldSurface.tools.map(tool=>tool.name),['run_code'],'The global PTC presentation reproduces the unusable channel');
  const policy=new Permissions(store);
  policy.save({shell:true});
  let callNumber=0;
  const execute=(agent,name,arguments_)=>ctx.tools.execute({agent,name,arguments:arguments_,callId:'synthetic-native-call-'+(++callNumber),signal});
  const deniedProgram=await execute(legacy,'run_code',{code:''});
  assert.equal(deniedProgram.isError,true);assert.match(deniedProgram.error.message,/只读执行/);
  assert.equal(scriptBodies,0,'Even an empty PTC program is rejected before its body');
  await ctx.agentPresets.mount(worker.ctx,task.mode);
  assert.equal(ctx.agentPresets.composedPreset(worker.ctx),PLAN_PRESET_ID);
  assert.equal(ctx.tools.modeFor(worker),'native');assert.equal(ctx.tools.modeFor(legacy),'ptc','The host default is unchanged');
  const nativeSurface=await assemble(worker),nativeNames=nativeSurface.tools.map(tool=>tool.name);
  for(const name of ['x_whale_status','x_whale_search','assistant_plan_report','read','web_search','web_fetch'])assert.ok(nativeNames.includes(name),'Native schema is model-visible: '+name);
  assert.ok(!nativeNames.includes('run_code'),'The native model-facing surface has no PTC executor');
  for(const name of ['pwsh','bash','write','edit','subagent','assistant_context','assistant_memory','assistant_goal','assistant_companion','assistant_plan','assistant_wake','assistant_finish','social_action','x_whale_bookmark','x_whale_reply','x_whale_share','x_whale_diary'])assert.ok(!nativeNames.includes(name),'The dedicated preset exposes no execution/write/private tool: '+name);
  assert.equal(ctx.tools.get('assistant_memory',worker),undefined,'Restricted global tools cannot be resolved in the plan scope');
  const status=await execute(worker,'x_whale_status',{});
  assert.equal(status.isError,false);assert.equal(statusBodies,1,'The actual My Fish status body is reached through native ToolRuntime');
  assert.ok(JSON.parse(status.content[0].text).config);
  const xSearch=await execute(worker,'x_whale_search',{query:'Synthetic X read',count:1});
  assert.equal(xSearch.isError,false);assert.equal(xSearchBodies,1);assert.equal(JSON.parse(xSearch.content[0].text).items[0].text,'SYNTHETIC_NATIVE_X_SEARCH_CONTENT');
  const read=await execute(worker,'read',{file_path:'synthetic-source.txt'});
  assert.equal(read.isError,false);assert.ok(read.content.some(part=>part.type==='text'&&part.text.includes('SYNTHETIC_NATIVE_READ_CONTENT')));assert.equal(fileReads,1);
  const search=await execute(worker,'web_search',{queries:['Synthetic public source']});
  assert.equal(search.isError,false);assert.ok(search.content.some(part=>part.type==='text'&&part.text.includes('SYNTHETIC_NATIVE_SEARCH_CONTENT')));assert.equal(webReads,1);
  const report=await execute(worker,'assistant_plan_report',{id:task.id,notify:false,summary:'Synthetic native status, file and public-source reads completed.'});
  assert.equal(report.isError,false);assert.equal(JSON.parse(report.content[0].text).ok,true);assert.equal(store.state().planReports[0].executionId,'synthetic-native-execution');
  const noExecutor=await execute(worker,'run_code',{code:''});assert.equal(noExecutor.isError,true);assert.equal(scriptBodies,0);
  assert.equal(task.permission,'read-only');assert.equal(worker.session.header.sandboxMode,'read-only');
  policy.save({shell:false});assert.equal(policy.policy().fileWrite,false);assert.equal(policy.policy().delegation,false);
  assert.equal(modelCalls,0);assert.equal(networkCalls,0);
  passed=true;
} finally {
  for(const dispose of disposers.reverse())await dispose();
  for(const scope of scopes.reverse())await scope.dispose();
  if(runtime)await runtime.dispose();
  for(const fiber of fibers.reverse())await fiber.dispose();
  globalThis.fetch=previousFetch;
  Engine.prototype.read=originalEngineRead;
  if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
  const relative=path.relative(temporaryParent,path.resolve(temporaryRoot));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({planNativeTools:'passed',ownedPresetActualMount:'passed',modelFacingNativeSurface:'passed',legacyPtcCollapseReproduced:'passed',actualMyFishStatusDispatch:'passed',actualXSearchWithSyntheticBackend:'passed',actualReadToolWithSyntheticFile:'passed',actualWebToolWithSyntheticProvider:'passed',actualOwnPlanReport:'passed',emptyProgramNeverExecuted:'passed',globalPresentationUnchanged:'passed',statusBodies,xSearchBodies,fileReads,webReads,scriptBodies,modelCalls,networkCalls,realLedgerReads:0,realLedgerWrites:0,scope:'Installed Loader/AgentPresetRegistry/SystemPrompt/ToolRuntime with a synthetic task and scoped agents; synthetic X backend and FS/web providers, no actual scheduler timer, model, account or PTC program'}));
