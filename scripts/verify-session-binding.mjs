// Real installed SessionController/WorkspaceRegistry, isolated under OS temp.
// No real profile, chat history, external transport, or model execution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {CompanionRuntime} from '../lib/companion-runtime.js';
import {Scheduler} from '../lib/scheduler.js';
import {createSessionProbe} from '../lib/session-presence.js';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-session-binding-host-'));
const selected=path.join(temporaryRoot,'selected'),other=path.join(temporaryRoot,'other');
for(const directory of [selected,other])fs.mkdirSync(directory);
const fibers=[],disposers=[];
let passed=false,modelCalls=0,admittedPrompts=0;
try{
  const [{Context},{default:Storage},jsonStorage,domainStorage,{SessionStore},{SessionProjectionRegistry},{default:SystemPrompt},{ToolRuntime},{AgentRegistry},jsonPersistence,{SessionQueryEngine},{WorkspaceRegistry},{WorkingDirectoryService},{default:AgentLoop},{SessionController}]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-storage'),hostImport('dsh-storage-json'),hostImport('dsh-storage-domain'),hostImport('dsh-session'),hostImport('dsh-session-projection'),hostImport('dsh-system-prompt'),hostImport('dsh-tools'),hostImport('dsh-agent'),hostImport('dsh-session-persistence-jsonl'),hostImport('dsh-session-query'),hostImport('dsh-workspace'),hostImport('dsh-working-directory'),hostImport('dsh-agent-loop'),hostImport('dsh-api-session-controller'),
  ]);
  const ctx=new Context(),signal=new AbortController().signal;
  const within=value=>{const resolved=path.resolve(value),relative=path.relative(temporaryRoot,resolved);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'The verifier only accepts its own temporary paths');return resolved;};
  ctx.provide('fs',{
    resolve:async(value,{cwd=selected,signal}={})=>{signal?.throwIfAborted();return within(path.resolve(cwd,value));},
    stat:async(value,signal)=>{signal?.throwIfAborted();try{const info=await fs.promises.stat(within(value));return {type:info.isDirectory()?'directory':'file'};}catch(error){if(error.code==='ENOENT')return undefined;throw error;}},
    processPath:value=>within(value),
  });
  ctx.provide('llm',new Proxy({}, {get:()=>()=>{modelCalls++;throw Error('Session binding verification must never execute a model');}}));
  ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic-provider',model:'synthetic-model'})});
  ctx.provide('attachments',{
    imageLimits:{maxImageBytes:1,maxImagesPerMessage:1,maxMessageImageBytes:1,maxImagePixels:1,maxImageDimension:1,mediaTypes:[]},
    admitPromptContent:async content=>{assert.ok(content.every(part=>part.type==='text'));admittedPrompts++;return content;},
  });
  ctx.provide('fileUploads',{
    registerAgentResolver:()=>()=>{},
    resolve:()=>{throw Error('No file receipt may be resolved in this verifier');},
    bindPrompt:()=>({commit(){},[Symbol.dispose](){}}),
  });
  ctx.provide('remoteAccess',{allows:()=>true});
  ctx.provide('typert',{
    resources:{register:()=>()=>{}},
    lookups:{register:()=>()=>{},configure:()=>()=>{}},
    contexts:{registerHost:()=>()=>{},configureHost:()=>()=>{}},
  });
  for(const [plugin,config] of [
    [Storage,{}],[jsonStorage,{root:path.join(temporaryRoot,'storage')}],[domainStorage,{backend:'json'}],
    [SessionStore,{}],[SessionProjectionRegistry,{}],[SystemPrompt,{includeHarnessIdentity:false}],[ToolRuntime,{mode:'native'}],[AgentRegistry,{}],
    [jsonPersistence,{root:path.join(temporaryRoot,'logs'),compression:'none'}],[SessionQueryEngine,{}],[WorkspaceRegistry,{}],
    [WorkingDirectoryService,{defaultDirectory:selected}],[AgentLoop,{agents:[],maxParallelToolCalls:1}],[SessionController,{nativeOpen:false}],
  ]){const fiber=ctx.plugin(plugin,config);fibers.push(fiber);await fiber;}
  // Block every synthetic turn before model admission, while preserving actual
  // SessionController routing and real Agent/Session lifecycle events.
  disposers.push(ctx.on('agent/pre-step',()=>({kind:'reject',reason:'Synthetic session binding verifier: no model'})));
  const workspace=await ctx.workspaceRegistry.create(selected,'Synthetic selected workspace');
  const created=await ctx.sessionController.create({workspaceId:workspace.id,sessionId:'synthetic-fixed-main'});
  assert.equal(created.sessionId,'synthetic-fixed-main');
  const agent=ctx.agents.get(created.sessionId);assert.ok(agent);
  assert.equal(agent.session.header.cwd,workspace.path);assert.deepEqual(workspace.sessionIds,[created.sessionId]);
  const firstSequence=agent.session.seq;
  const accepted=await ctx.sessionController.prompt({sessionId:created.sessionId,requestId:'synthetic-first-turn',mode:'queue',content:[{type:'text',text:'Synthetic first conversation turn'}]},signal);
  assert.equal(accepted.accepted,true);await agent.whenIdle();
  assert.ok(agent.session.seq>firstSequence);assert.ok(agent.session.snapshotEvents().some(event=>event.type==='turn/start'));
  assert.equal(modelCalls,0);
  // This counterexample is why create must not be used to open a started chat.
  const replacement=await ctx.sessionController.create({workspaceId:workspace.id,sessionId:created.sessionId});
  assert.notEqual(replacement.sessionId,created.sessionId,'Host create only reuses a blank named session');
  assert.equal(ctx.sessions.get(created.sessionId),agent.session,'The original started conversation remains intact');
  assert.ok(workspace.sessionIds.includes(created.sessionId));assert.ok(workspace.sessionIds.includes(replacement.sessionId));
  const {SessionBinding}=await import('../lib/session-binding.js');
  const getRegistry=()=>ctx.workspaceRegistry,getSessions=()=>ctx.sessions,getPersistence=()=>ctx.sessionPersistence,getAgents=()=>ctx.agents;
  const fixtureStore=new Store(selected),fixtureAssistant=new AssistantStore(fixtureStore),fixtureCompanion=new CompanionStore(fixtureStore);
  const binding=new SessionBinding({store:fixtureStore,getRegistry,getSessions,getPersistence,getAgents,signal});
  const originalSequence=agent.session.seq,originalProfile=fixtureAssistant.profile();
  await binding.bind({workspaceId:workspace.id,sessionId:created.sessionId});
  assert.equal(fixtureStore.state().sessionId,created.sessionId);assert.equal(agent.session.seq,originalSequence,'Binding an existing started conversation cannot rewrite or replay its history');
  assert.deepEqual(fixtureAssistant.profile(),originalProfile,'Binding does not replace the role');
  let createCalls=0,promptCalls=0;
  const controller={
    create:async request=>{createCalls++;return ctx.sessionController.create(request);},
    prompt:async(request,signal)=>{promptCalls++;assert.equal(request.sessionId,created.sessionId);return ctx.sessionController.prompt(request,signal);},
  };
  const probeSession=createSessionProbe({getSessions,getPersistence,getRegistry:getAgents});
  const scheduler=new Scheduler(fixtureStore,controller,signal,fixtureAssistant,{probeSession,companion:fixtureCompanion,sessionBinding:binding});
  assert.equal((await scheduler.ensureSession({recoverMissing:true})).sessionId,created.sessionId);
  assert.equal((await scheduler.ensureSession({recoverMissing:true})).sessionId,created.sessionId);
  const runtime=new CompanionRuntime({store:fixtureStore,companion:fixtureCompanion,scheduler,controller,signal});
  const chat=await runtime.chat({requestId:'synthetic-real-controller-companion-chat'});assert.equal(chat.sessionId,created.sessionId);assert.equal(chat.queued,true);await agent.whenIdle();
  await scheduler.run(true,'Synthetic explicit wake in the bound conversation');await agent.whenIdle();
  scheduler.finish({runId:fixtureStore.state().activeRun.id,notify:false,summary:'Synthetic verifier quiet completion'});
  assert.equal(createCalls,0,'Opening, continuation and waking must not call host create after a started main exists');
  assert.equal(promptCalls,2);assert.equal(fixtureStore.state().sessionId,created.sessionId);assert.ok(workspace.sessionIds.includes(created.sessionId));
  const reloadedStore=new Store(selected),reloadedBinding=new SessionBinding({store:reloadedStore,getRegistry,getSessions,getPersistence,getAgents,signal});
  const reloadedScheduler=new Scheduler(reloadedStore,controller,signal,new AssistantStore(reloadedStore),{probeSession,sessionBinding:reloadedBinding});
  assert.equal((await reloadedScheduler.ensureSession({recoverMissing:true})).sessionId,created.sessionId);assert.equal(createCalls,0);
  const ungrouped=await ctx.sessionController.create({cwd:workspace.path,sessionId:'synthetic-existing-ungrouped'});
  assert.equal(workspace.sessionIds.includes(ungrouped.sessionId),false,'A cwd alone does not attach a new conversation to the workspace');
  const ungroupedAgent=ctx.agents.get(ungrouped.sessionId),ungroupedSeq=ungroupedAgent.session.seq;
  const upgradedState={...fixtureStore.state(),sessionId:ungrouped.sessionId};delete upgradedState.mainSessionBinding;fixtureStore.saveState(upgradedState);
  await binding.ensureAttached(ungrouped.sessionId);
  await binding.bind({workspaceId:workspace.id,sessionId:ungrouped.sessionId});
  assert.equal(fixtureStore.state().sessionId,ungrouped.sessionId);assert.ok(workspace.sessionIds.includes(ungrouped.sessionId));assert.equal(ungroupedAgent.session.seq,ungroupedSeq);
  const unrelated=await ctx.sessionController.create({cwd:other,sessionId:'synthetic-different-origin'}),beforeRejected=JSON.stringify(fixtureStore.state()),beforeRejectedAgentCount=ctx.agents.list().length;
  await assert.rejects(()=>binding.ensureAttached(unrelated.sessionId),/创建目录|分组/);
  await assert.rejects(()=>binding.bind({workspaceId:workspace.id,sessionId:unrelated.sessionId}));
  assert.equal(JSON.stringify(fixtureStore.state()),beforeRejected);assert.equal(ctx.agents.list().length,beforeRejectedAgentCount);
  assert.equal(ctx.agents.get(unrelated.sessionId).session.header.cwd,other,'A failed cross-directory binding cannot rewrite the immutable origin');
  // A cold synthetic record with an intentionally invalid body proves the
  // binding picker reads metadata, not chat history, and does not resume it.
  const coldId='synthetic-cold-metadata-candidate',coldHeader={version:4,id:coldId,createdAt:1,cwd:workspace.path,isSeeded:false};
  const coldHandle=await ctx.sessionPersistence.create(coldHeader,{signal});await coldHandle.flush();await coldHandle.close();
  const coldFile=ctx.sessionPersistence.locate(coldHeader).path;within(coldFile);fs.appendFileSync(coldFile,'SYNTHETIC BODY THAT MUST NOT BE PARSED\n');
  const coldBytes=fs.readFileSync(coldFile),beforeColdAgentCount=ctx.agents.list().length;
  await workspace.attachSession(coldId);await binding.snapshot(workspace.id);await binding.bind({workspaceId:workspace.id,sessionId:coldId});
  assert.equal(fixtureStore.state().sessionId,coldId);assert.equal(ctx.sessions.get(coldId),undefined);assert.equal(ctx.agents.list().length,beforeColdAgentCount);assert.deepEqual(fs.readFileSync(coldFile),coldBytes);
  const freshRoot=path.join(temporaryRoot,'fresh-selected');fs.mkdirSync(freshRoot);
  const freshStore=new Store(freshRoot),freshAssistant=new AssistantStore(freshStore),freshBinding=new SessionBinding({store:freshStore,getRegistry,getSessions,getPersistence,getAgents,signal});
  let firstCreates=0;
  const firstController={create:async request=>{firstCreates++;assert.equal(typeof request.workspaceId,'string');assert.equal(request.cwd,undefined,'Host create rejects workspaceId plus cwd');return ctx.sessionController.create(request);},prompt:async()=>{throw Error('Opening a new main conversation must not prompt a model');}};
  const firstScheduler=new Scheduler(freshStore,firstController,signal,freshAssistant,{probeSession,sessionBinding:freshBinding});
  const first=await firstScheduler.ensureSession({recoverMissing:true}),freshAgent=ctx.agents.get(first.sessionId),freshWorkspace=await ctx.workspaceRegistry.resolveByPath(freshRoot);
  assert.equal(firstCreates,1);assert.ok(freshWorkspace);assert.ok(freshWorkspace.sessionIds.includes(first.sessionId));assert.equal(freshAgent.session.header.cwd,freshWorkspace.path);
  assert.equal((await firstScheduler.ensureSession({recoverMissing:true})).sessionId,first.sessionId);assert.equal(firstCreates,1);
  assert.equal(modelCalls,0);
  passed=true;
}finally{
  for(const dispose of disposers.reverse())await dispose();
  for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporaryRoot));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({hostSessionControllerBinding:'passed',actualCreateAndPrompt:'passed',namedStartedCreateMintsNewIdentity:true,workspaceMembership:'passed',existingMainReuse:'passed',sameSessionAfterStoreReload:'passed',existingUngroupedAttachment:'passed',coldMetadataOnlyBinding:'passed',differentOriginRefused:'passed',firstMainCreatedInWorkspace:'passed',modelCalls,admittedPrompts,scope:'Installed Cordis/SessionController/AgentRegistry/WorkspaceRegistry with synthetic temporary persistence and no real profile'}));
