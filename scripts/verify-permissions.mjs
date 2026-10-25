// Installed-host contract test only: synthetic agents, no-op tools, isolated data.
// Does not run a model, PTC program, shell, browser, or real task.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../lib/store.js';
import {Permissions} from '../lib/permissions.js';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-guard-host-'));
const fibers=[],detachAgents=[],disposers=[];
let passed=false;
try {
  const [{Context},{default:SystemPrompt},{ToolRuntime,TOOL_RUNTIME_SCHEDULER},{AgentRegistry}]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-system-prompt'),hostImport('dsh-tools'),hostImport('dsh-agent'),
  ]);
  const ctx=new Context();
  for(const [plugin,config] of [[SystemPrompt,{includeHarnessIdentity:false}],[ToolRuntime,{mode:'native'}],[AgentRegistry,{}]]){
    const fiber=ctx.plugin(plugin,config);fibers.push(fiber);await fiber;
  }
  const main={id:'synthetic-main',session:{id:'synthetic-main'}},child={id:'synthetic-child',session:{id:'synthetic-child'}},nested={id:'synthetic-nested',session:{id:'synthetic-nested'}},ordinary={id:'synthetic-ordinary',session:{id:'synthetic-ordinary',parentId:main.id}};
  for(const [agent,owner] of [[main,undefined],[child,main],[nested,child],[ordinary,undefined]])detachAgents.push(ctx.agents.enter(agent,owner));
  assert.equal(ctx.agents.isOwnedBy(child.id,main),true);
  assert.equal(ctx.agents.isOwnedBy(nested.id,child),true);
  assert.equal(ctx.agents.isOwnedBy(ordinary.id,main),false,'durable parent data is not runtime ownership');
  const store=new Store(temporaryRoot);store.saveState({...store.state(),sessionId:main.id});
  const permissions=new Permissions(store,{getRegistry:()=>ctx.agents});
  let bodies=0,outerToken;
  for(const name of ['pwsh','web_search','read'])disposers.push(ctx.tools.register({name,description:'Synthetic no-op contract fixture',parameters:{type:'object',properties:{},additionalProperties:true},output:{schema:{},render:()=>[{type:'text',text:'Synthetic no-op'}]},execute:(_args,exec)=>{bodies++;if(name==='read')outerToken=exec.token;return {ok:true};}}));
  const disposeGuard=ctx.tools.guard(exec=>permissions.guard(exec));disposers.push(disposeGuard);
  let counter=0;
  const input=(agent,name,arguments_={})=>({agent,name,arguments:arguments_,callId:'synthetic-call-'+(++counter),signal:new AbortController().signal});
  for(const subject of [main,child,nested]){
    const result=await ctx.tools.execute(input(subject,'pwsh'));
    assert.equal(result.isError,true);assert.match(result.error.message,/本地命令权限/);
  }
  assert.equal(bodies,0,'denied bodies must never start');
  assert.equal((await ctx.tools.execute(input(ordinary,'pwsh'))).isError,false,'ordinary chat retains its own host policy');
  assert.equal(bodies,1);
  permissions.save({privateTerms:['SYNTHETIC PRIVATE TOPIC']});
  const secret=await ctx.tools.execute(input(nested,'web_search',{query:'synthetic%20private%20topic'}));
  assert.equal(secret.isError,true);assert.match(secret.error.message,/私密词/);assert.equal(bodies,1);
  assert.equal((await ctx.tools.execute(input(nested,'read'))).isError,false);
  assert.ok(outerToken,'obtain a real registry-minted parent execution token');
  const scheduler=ctx.tools[TOOL_RUNTIME_SCHEDULER];
  const denied=await scheduler.prepare({...input(nested,'pwsh'),parent:outerToken});
  assert.equal(denied.kind,'post-result');assert.equal(denied.result.isError,true);assert.match(denied.result.error.message,/本地命令权限/);
  await scheduler.finalize(denied.exec,denied.result);
  assert.equal(bodies,2,'PTC-style nested preparation must deny before dispatch');
  permissions.save({shell:true});
  const allowed=await scheduler.prepare({...input(nested,'pwsh'),parent:outerToken});
  assert.equal(allowed.kind,'dispatch');
  const dispatched=await scheduler.dispatch(allowed.exec);
  const settled=dispatched.kind==='post-result'?await scheduler.finalize(allowed.exec,dispatched.result):await scheduler.finish(allowed.exec,dispatched.result);
  assert.equal(settled.isError,false);assert.equal(bodies,3);
  permissions.save({shell:false});
  await disposeGuard();
  assert.equal((await ctx.tools.execute(input(nested,'pwsh'))).isError,false,'disposing the exact guard removes only this restriction');
  assert.equal(bodies,4);
  detachAgents[2]();
  assert.equal(ctx.agents.isOwnedBy(nested.id,child),false,'ownership ends when the actual registry entry detaches');
  passed=true;
} finally {
  for(const dispose of disposers.reverse())await dispose();
  for(const detach of detachAgents.reverse())detach();
  for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporaryRoot));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Temporary cleanup must stay under the OS temporary directory');
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({hostPermissionGuard:'passed',runtimeOwnedChildren:'passed',nestedRuntimeOwnership:'passed',ordinarySessionIsolation:'passed',outboundPrivateTerms:'passed',ptcNestedSchedulerPrepare:'passed',guardDisposal:'passed',scope:'Installed Cordis/ToolRuntime/AgentRegistry with synthetic agents and no-op tools; no model or PTC program executed'}));
