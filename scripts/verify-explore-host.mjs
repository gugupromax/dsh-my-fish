// Installed public host APIs and synthetic data only. No real model or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ExploreHost} from '../lib/explore-host.js';
import {registerExplorePreset,EXPLORE_PRESET_ID,EXPLORE_TOOLS} from '../lib/explore-preset.js';
import {hostToolsFixture} from './host-tools-fixture.mjs';
const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const load=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const fixture=await hostToolsFixture(hostRoot),temp=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-explore-host-'));
const fibers=[],disposers=[];let preset,modelCalls=0,networkCalls=0,claims=0,passed=false;
try{
  const [{Context},{Loader},{default:Storage},jsonStorage,domainStorage,{SessionStore},{SessionProjectionRegistry},{default:SystemPrompt},{AgentRegistry},jsonPersistence,{SessionQueryEngine},{WorkspaceRegistry},{WorkingDirectoryService},{default:AgentLoop},{SessionController},{AgentPresetRegistry},{createAssistantMessage}]=await Promise.all([
    load('cordis'),load('cordis-plugin-loader'),load('dsh-storage'),load('dsh-storage-json'),load('dsh-storage-domain'),load('dsh-session'),load('dsh-session-projection'),load('dsh-system-prompt'),load('dsh-agent'),load('dsh-session-persistence-jsonl'),load('dsh-session-query'),load('dsh-workspace'),load('dsh-working-directory'),load('dsh-agent-loop'),load('dsh-api-session-controller'),load('dsh-agent-preset-registry'),load('dsh-llm'),
  ]);
  const ctx=new Context(),signal=new AbortController().signal,baseUrl=pathToFileURL(path.join(hostRoot,'..','package.json')).href;ctx.baseUrl=baseUrl;
  const within=value=>{const target=path.resolve(value),relative=path.relative(temp,target);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));return target;};
  ctx.provide('fs',{resolve:async(value,{cwd=temp}={})=>within(path.resolve(cwd,value)),stat:async value=>{const st=await fs.promises.stat(within(value));return {type:st.isDirectory()?'directory':'file'};},processPath:within});
  ctx.provide('llm',new Proxy({}, {get:()=>()=>{modelCalls++;throw Error('No model call permitted');}}));
  ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});
  ctx.provide('attachments',{imageLimits:{maxImageBytes:1,maxImagesPerMessage:1,maxMessageImageBytes:1,maxImagePixels:1,maxImageDimension:1,mediaTypes:[]},admitPromptContent:async content=>content});
  ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{},resolve:()=>assert.fail(),bindPrompt:()=>({commit(){},[Symbol.dispose](){}})});
  ctx.provide('remoteAccess',{allows:()=>true});ctx.provide('typertGateway',{getPendingRemoteEvents:()=>[]});
  ctx.provide('typert',{resources:{register:()=>()=>{}},lookups:{register:()=>()=>{},configure:()=>()=>{}},contexts:{registerHost:()=>()=>{},configureHost:()=>()=>{}}});
  ctx.provide('web',{searchReady:()=>true,fetchReady:()=>false,search:async()=>{networkCalls++;return {content:'Synthetic search',sources:[],truncated:false};},fetch:()=>assert.fail()});
  for(const [implementation,config]of [[Loader,{baseUrl}],[Storage,{}],[jsonStorage,{root:path.join(temp,'storage')}],[domainStorage,{backend:'json'}],[SessionStore,{}],[SessionProjectionRegistry,{}],[SystemPrompt,{includeHarnessIdentity:false}],...fixture.plugins('native'),[AgentRegistry,{}],[jsonPersistence,{root:path.join(temp,'logs'),compression:'none'}],[SessionQueryEngine,{}],[WorkspaceRegistry,{}],[WorkingDirectoryService,{defaultDirectory:temp}],[AgentLoop,{agents:[],maxParallelToolCalls:1}],[AgentPresetRegistry,{default:'synthetic-default'}],[SessionController,{nativeOpen:false}]]){const fiber=ctx.plugin(implementation,config);fibers.push(fiber);await fiber;}
  // An ordinary caller can still use its own preset; no global surface change.
  disposers.push(await ctx.agentPresets.register({id:'synthetic-default',name:'Synthetic default',plugins:[]}));
  const schema={type:'object',properties:{},additionalProperties:true},seen=[];
  for(const name of [...EXPLORE_TOOLS,'assistant_memory','write','pwsh','assistant_plan'])disposers.push(ctx.tools.register({name,description:'Synthetic '+name,parameters:schema,output:{schema:{},render:()=>[]},execute:async(_args,exec)=>{
    if(name==='social_search')return fixture.invoke(ctx,{name:'web_search',arguments:{queries:['Synthetic']},agent:exec.agent,signal:exec.signal,callId:'synthetic-nested',rootCallId:exec.callId,parent:exec.token,toolSet:exec.toolSet});
    return {ok:true};
  }}));
  preset=registerExplorePreset(ctx.agentPresets);await preset.ensureReady();
  const ordinaryCreated=await ctx.sessionController.create({sessionId:'synthetic-ordinary-session',cwd:temp,agentPreset:'synthetic-default'}),ordinary=ctx.agents.get(ordinaryCreated.sessionId),ordinarySequence=ordinary.session.seq;
  const ordinarySet=await fixture.resolve(ctx,ordinary,signal);try{const ordinaryAssembly=await ctx.systemPrompt.assemble({agent:ordinary,scope:ordinary,signal,toolSet:ordinarySet});assert.ok(ordinaryAssembly.tools.some(tool=>tool.name==='assistant_memory'));assert.ok(ordinaryAssembly.tools.some(tool=>tool.name==='pwsh'));}finally{ordinarySet.dispose();}
  const host=new ExploreHost({getController:()=>ctx.sessionController,getRegistry:()=>ctx.agents,getPresets:()=>ctx.agentPresets});
  const turns=new Map();
  disposers.push(ctx.on('agent/inbox/claimed',({agent,message,turn})=>{if(message.source?.rpcId==='synthetic-explore-request'){turns.set(agent.session.id,turn);claims++;}},{global:true}));
  // Preserve the actual default enter decision, then stop before model access.
  disposers.push(ctx.on('agent/pre-step',async (_input,next)=>{const decision=await next();assert.equal(decision.kind,'enter');return {kind:'reject',reason:'Synthetic verifier: no model'};},{global:true}));
  const inherited={provider:'synthetic-main-provider',model:'synthetic-main-model',reasoningEffort:'high'};
  const workspace=await ctx.workspaceRegistry.create(temp,'Synthetic explore workspace');
  const result=await host.start({sessionId:'synthetic-background-session',requestId:'synthetic-explore-request',cwd:temp,workspaceId:workspace.id,prompt:'Synthetic public exploration',modelSelection:inherited},signal);
  assert.equal(result.hidden,false);const agent=host.identity(result.sessionId);assert.ok(agent);await agent.whenIdle();assert.equal(claims,1);
  assert.equal(ordinary.session.seq,ordinarySequence,'Exploration does not prompt or rewrite the ordinary conversation');
  assert.equal(ctx.agentPresets.composedPreset(agent.ctx),EXPLORE_PRESET_ID);
  assert.ok(workspace.sessionIds.includes(agent.session.id));assert.equal(agent.session.header.cwd,workspace.path);
  assert.deepEqual(agent.model.current(),inherited);assert.deepEqual(ctx.agentDefaultModel.currentSelection(),{provider:'synthetic',model:'synthetic'});
  disposers.push(ctx.tools.register({name:'synthetic_late_private_tool',description:'Synthetic late private tool',parameters:schema,output:{schema:{},render:()=>[]},execute:()=>assert.fail()}));
  const toolSet=await fixture.resolve(ctx,agent,signal);try{
    const assembly=await ctx.systemPrompt.assemble({agent,scope:agent,signal,toolSet}),names=assembly.tools.map(item=>item.name);
    for(const name of EXPLORE_TOOLS)assert.ok(names.includes(name),'Exploration capability '+name);
    assert.ok(names.includes('web_search'),'Scoped internal search dependency remains callable');
    for(const name of ['assistant_memory','write','pwsh','assistant_plan','synthetic_late_private_tool','web_fetch','run_code'])assert.ok(!names.includes(name),'Private/execution tool hidden '+name);
    disposers.push(ctx.tools.guard(exec=>{seen.push({name:exec.name,callId:exec.callId,rootCallId:exec.rootCallId,hasToken:!!exec.token,hasParent:!!exec.parent});}));
    const nested=await fixture.invoke(ctx,{name:'social_search',arguments:{},agent,signal,callId:'synthetic-outer',toolSet});assert.equal(nested.isError,false);
    assert.ok(seen.some(row=>row.name==='web_search'&&row.rootCallId==='synthetic-outer'&&row.hasToken));
  }finally{toolSet.dispose();}
  const message=createAssistantMessage({content:[{type:'text',text:'Synthetic completed thought'}],source:{provider:'synthetic',model:'synthetic'}});
  const event=agent.session.append('assistant/message',{turn:turns.get(agent.session.id),step:1,message},{surfaceOp:'append'});
  assert.equal(event.data.turn,turns.get(agent.session.id));assert.equal(event.data.message.source.kind,'model');
  await agent.runMaintenance(async()=>{
    await ctx.sessionController.prompt({sessionId:result.sessionId,requestId:'synthetic-cancelled-prompt',mode:'queue',content:[{type:'text',text:'Synthetic queued content to cancel'}]},signal);
    assert.equal((await host.cancel(result.sessionId)).cancelled,true);
  });await agent.whenIdle();assert.equal(claims,1,'Cancelled inbox contents are not consumed in a new turn');
  assert.equal(modelCalls,0);assert.equal(networkCalls,1);passed=true;
  console.log(JSON.stringify({exploreHost:'passed',backgroundWorkspaceMembership:'passed',ordinaryConversationUnchanged:'passed',nativeRestrictedPreset:'passed',inheritedSessionModel:'passed',globalModelDefaultUnchanged:'passed',inboxClaimTurnCorrelation:'passed',queuedCancellation:'passed',nestedGuardContext:seen,hidden:false,modelCalls,syntheticWebCalls:networkCalls,realNetworkCalls:0}));
}finally{
  if(preset)await preset.dispose();for(const dispose of disposers.reverse())await dispose();for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temp,{recursive:true,force:true});
}
if(!passed)throw Error('Explore host verification did not complete');
