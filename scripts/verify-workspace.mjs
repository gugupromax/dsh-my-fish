// Installed DSH contracts using temporary directories and synthetic sessions only.
// Creates no real profile, conversation, plan, network request, or model call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-workspace-host-'));
const original=path.join(temporaryRoot,'original'),selected=path.join(temporaryRoot,'selected'),next=path.join(temporaryRoot,'next');
for(const directory of [original,selected,next])fs.mkdirSync(directory);
const fibers=[],disposers=[],handles=[];
let passed=false;
try {
  const [{Context},{default:SystemPrompt},{ToolRuntime},{AgentRegistry},{SessionStore,Session},{SessionProjectionRegistry},{WorkingDirectoryService},{default:AgentLoop},{default:SandboxPolicy}]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-system-prompt'),hostImport('dsh-tools'),hostImport('dsh-agent'),hostImport('dsh-session'),hostImport('dsh-session-projection'),hostImport('dsh-working-directory'),hostImport('dsh-agent-loop'),hostImport('dsh-sandbox-policy'),
  ]);
  const ctx=new Context();let modelCalls=0,creationChanges=0,queuedSteps=0;
  // Narrow filesystem fixture: real temporary directories, no access elsewhere.
  ctx.provide('fs',{
    resolve:async(value,{cwd=original,signal}={})=>{signal?.throwIfAborted();const target=path.resolve(cwd,value),relative=path.relative(temporaryRoot,target);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));return target;},
    stat:async(value,signal)=>{signal?.throwIfAborted();try{const info=await fs.promises.stat(value);return {type:info.isDirectory()?'directory':'file'};}catch(error){if(error.code==='ENOENT')return undefined;throw error;}},
    processPath:value=>value,
  });
  ctx.provide('llm',new Proxy({}, {get:()=>()=>{modelCalls++;throw Error('A workspace verifier must never call a model');}}));
  for(const [plugin,config] of [[SessionStore,{}],[SessionProjectionRegistry,{}],[SystemPrompt,{includeHarnessIdentity:false}],[ToolRuntime,{mode:'native'}],[AgentRegistry,{}],[WorkingDirectoryService,{defaultDirectory:original}],[SandboxPolicy,{mode:'workspace-write',workspaceRoot:original}],[AgentLoop,{agents:[],maxParallelToolCalls:1}]]){
    const fiber=ctx.plugin(plugin,config);fibers.push(fiber);await fiber;
  }
  const sessionId='synthetic-workspace-main';
  disposers.push(ctx.on('agent/created',async({agent,signal})=>{
    if(agent.id!==sessionId)return;
    // Creation is already under maintenance: neither whenIdle nor a nested
    // runMaintenance may be awaited here. set supports unpublished/live agents.
    assert.equal(agent.status,'idle');
    await ctx.workingDirectory.set(agent,selected,signal);creationChanges++;
  }));
  const handle=await ctx.agents.create({sessionId,meta:{cwd:original},agentOptions:{}});handles.push(handle);
  const agent=handle.agent;
  assert.equal(creationChanges,1);assert.equal(agent.id,sessionId);assert.equal(agent.session.id,sessionId);
  assert.equal(ctx.workingDirectory.get(agent.session),selected);
  assert.equal(agent.session.header.cwd,original,'the immutable project origin stays unchanged');
  assert.equal(ctx.sandboxPolicy.resolve({session:agent.session}).workspaceRoot,original,'changing effective cwd never grants writes in the new location');
  assert.ok(agent.session.snapshotEvents().some(event=>event.type==='working-directory/change'&&event.data.cwd===selected));
  assert.equal(agent.session.snapshotEvents().some(event=>event.type==='turn/start'),false,'directory notice must not wake a model turn');
  assert.equal(modelCalls,0);
  const before=agent.session.seq;
  await assert.rejects(()=>ctx.workingDirectory.set(agent,path.join(temporaryRoot,'missing'),new AbortController().signal),/does not exist/);
  assert.equal(agent.session.seq,before,'invalid targets cannot commit a directory event');
  assert.equal(ctx.workingDirectory.get(agent.session),selected);
  const aborted=new AbortController();aborted.abort(Error('synthetic cancellation'));
  await assert.rejects(()=>ctx.workingDirectory.set(agent,next,aborted.signal),/synthetic cancellation/);
  assert.equal(ctx.workingDirectory.get(agent.session),selected);
  assert.equal(typeof agent.runMaintenance,'function');
  const entered=Promise.withResolvers(),release=Promise.withResolvers();
  const held=agent.runMaintenance(async signal=>{await ctx.workingDirectory.set(agent,next,signal);entered.resolve();await release.promise;return 'synthetic-committed';});
  await entered.promise;
  assert.equal(agent.status,'idle','maintenance is intentionally surfaced as idle');
  assert.throws(()=>agent.runMaintenance(async()=>{}),/already has active work/,'a second migration cannot enter maintenance');
  disposers.push(ctx.on('agent/pre-step',({agent:subject})=>{if(subject===agent){queuedSteps++;return {kind:'reject',reason:'Synthetic verifier refuses model execution'};}return {kind:'reject',reason:'Synthetic verifier'};}));
  agent.followup({content:[{type:'text',text:'Synthetic queued prompt'}],source:{kind:'user'}});
  assert.equal(queuedSteps,0,'a prompt arriving during maintenance must be held');
  assert.equal(agent.session.snapshotEvents().some(event=>event.type==='turn/start'),false);
  release.resolve();assert.equal(await held,'synthetic-committed');await agent.whenIdle();
  assert.equal(queuedSteps,1,'the queued prompt proceeds only after the maintenance job settles');
  assert.equal(modelCalls,0,'the pre-step fixture blocks before a model request');
  assert.equal(ctx.workingDirectory.get(agent.session),next);assert.equal(agent.session.header.cwd,original);
  assert.equal(ctx.sandboxPolicy.resolve({session:agent.session}).workspaceRoot,original);
  const durableFile=path.join(temporaryRoot,'synthetic-session.json');
  fs.writeFileSync(durableFile,JSON.stringify({header:agent.session.header,events:agent.session.snapshotEvents()}));
  const persisted=JSON.parse(fs.readFileSync(durableFile,'utf8'));
  const replay=Session.create(sessionId,persisted.events,persisted.header);
  assert.equal(ctx.workingDirectory.get(replay),next,'a cold synthetic log replay retains effective cwd');
  assert.equal(replay.header.cwd,original);assert.equal(replay.id,sessionId);
  passed=true;
} finally {
  for(const dispose of disposers.reverse())await dispose();
  for(const handle of handles.reverse())await handle.dispose();
  for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporaryRoot));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({hostWorkspaceDirectory:'passed',sameSession:'passed',originalProjectUnchanged:'passed',sandboxWriteRootUnchanged:'passed',creationDirectSet:'passed',invalidTargetAndCancellation:'passed',maintenanceExclusive:'passed',queuedPromptHeld:'passed',syntheticLogReplay:'passed',modelCalls:0,scope:'Installed WorkingDirectory/Session/Projections/AgentRegistry/AgentLoop/SandboxPolicy; temporary filesystem fixture and synthetic persisted log, no real profile or model'}));
