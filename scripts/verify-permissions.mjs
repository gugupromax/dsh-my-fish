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
  const main={id:'synthetic-main',session:{id:'synthetic-main'}},child={id:'synthetic-child',session:{id:'synthetic-child'}},nested={id:'synthetic-nested',session:{id:'synthetic-nested'}},ordinary={id:'synthetic-ordinary',session:{id:'synthetic-ordinary',parentId:main.id}},plan={id:'synthetic-plan',session:{id:'synthetic-plan'}},planChild={id:'synthetic-plan-child',session:{id:'synthetic-plan-child'}};
  for(const [agent,owner] of [[main,undefined],[child,main],[nested,child],[ordinary,undefined],[plan,undefined],[planChild,plan]])detachAgents.push(ctx.agents.enter(agent,owner));
  assert.equal(ctx.agents.isOwnedBy(child.id,main),true);
  assert.equal(ctx.agents.isOwnedBy(nested.id,child),true);
  assert.equal(ctx.agents.isOwnedBy(ordinary.id,main),false,'durable parent data is not runtime ownership');
  const store=new Store(temporaryRoot);store.saveState({...store.state(),sessionId:main.id});
  const permissions=new Permissions(store,{getRegistry:()=>ctx.agents,isPlanSession:exec=>exec?.agent?.session?.id===plan.session.id});
  let bodies=0,outerToken;
  for(const name of ['pwsh','web_search','read','ask_user_question','session_event_search','task_board_list','compress','write','synthetic_unknown_tool'])disposers.push(ctx.tools.register({name,description:'Synthetic no-op contract fixture',parameters:{type:'object',properties:{},additionalProperties:true},output:{schema:{},render:()=>[{type:'text',text:'Synthetic no-op'}]},execute:(_args,exec)=>{bodies++;if(name==='read')outerToken=exec.token;return {ok:true};}}));
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
  // Exercise the actual runtime guard with no-op definitions only. These
  // checks do not display real questions, read logs/cards, or compress data;
  // host tool availability and the real tools' own gates remain independent.
  const utilityArgs={
    ask_user_question:{questions:[{id:'synthetic-preference',question:'Synthetic preference?',options:[{label:'Synthetic option'}]}]},
    session_event_search:{query:'Synthetic event text'},
    task_board_list:{limit:1},
    compress:{content:'m00001–m00002 Synthetic summary\nSynthetic already-consumed context.'},
  };
  const bodyBeforeUtilities=bodies;
  for(const subject of [main,child,nested])for(const [name,args]of Object.entries(utilityArgs)){
    const result=await ctx.tools.execute(input(subject,name,args));
    assert.equal(result.isError,false,subject.id+' can use '+name+' without machine/browser/delegation permissions');
  }
  assert.equal(bodies,bodyBeforeUtilities+12);
  for(const subject of [plan,planChild]){
    for(const name of ['compress','session_event_search'])assert.equal((await ctx.tools.execute(input(subject,name,utilityArgs[name]))).isError,false,subject.id+' retains current-context maintenance');
    assert.equal((await ctx.tools.execute(input(subject,'session_event_search',{...utilityArgs.session_event_search,session_id:subject.session.id}))).isError,false,'explicit current session remains allowed');
    const beforeDenials=bodies;
    for(const name of ['ask_user_question','task_board_list']){
      const result=await ctx.tools.execute(input(subject,name,utilityArgs[name]));
      assert.equal(result.isError,true,name+' is explicitly restricted for autonomous plans');
      assert.match(result.error.message,/计划|只读|汇报|会话/);
      assert.doesNotMatch(result.error.message,/尚未纳入/,'known restricted tools have an actionable scope reason');
    }
    for(const target of [main.session.id,child.session.id,ordinary.session.id,'synthetic-another-session',null,17]){
      const result=await ctx.tools.execute(input(subject,'session_event_search',{...utilityArgs.session_event_search,session_id:target}));
      assert.equal(result.isError,true,'plan searches may not select another session or malformed target');
      assert.match(result.error.message,/计划|当前|会话/);
    }
    assert.equal(bodies,beforeDenials,'plan restrictions reject before a tool body starts');
  }
  assert.equal((await ctx.tools.execute(input(main,'session_event_search',{...utilityArgs.session_event_search,session_id:ordinary.session.id}))).isError,false,'personal callers retain the real host authorization boundary; this no-op does not read another chat');
  for(const subject of [main,child,nested,plan,planChild]){
    const beforeDenials=bodies;
    assert.equal((await ctx.tools.execute(input(subject,'write',{path:'synthetic.txt',content:'Synthetic'}))).isError,true);
    const unknown=await ctx.tools.execute(input(subject,'synthetic_unknown_tool'));
    assert.equal(unknown.isError,true);assert.match(unknown.error.message,/尚未纳入/);
    assert.equal(bodies,beforeDenials,'classification does not open unknown tools or file writes');
  }
  assert.deepEqual(permissions.policy(),{shell:false,fileWrite:false,browserInteract:false,delegation:false,privateTerms:['SYNTHETIC PRIVATE TOPIC']},'utility classification never toggles saved policy');
  const bodiesBeforeDisposal=bodies;
  await disposeGuard();
  assert.equal((await ctx.tools.execute(input(nested,'pwsh'))).isError,false,'disposing the exact guard removes only this restriction');
  assert.equal(bodies,bodiesBeforeDisposal+1);
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
if(passed)console.log(JSON.stringify({hostPermissionGuard:'passed',runtimeOwnedChildren:'passed',nestedRuntimeOwnership:'passed',ordinarySessionIsolation:'passed',outboundPrivateTerms:'passed',ptcNestedSchedulerPrepare:'passed',knownUtilityClassifications:'passed',planOwnSessionSearch:'passed',planInteractiveAndBoardIsolation:'passed',unknownAndWriteStillDenied:'passed',policyUnchanged:'passed',guardDisposal:'passed',scope:'Installed Cordis/ToolRuntime/AgentRegistry with synthetic agents and no-op tools; no real question, chat/task read, compression, model, or PTC program executed'}));
