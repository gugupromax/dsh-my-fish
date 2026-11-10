// Installed AgentLoop, Tools and task-board runner with synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Store} from '../lib/store.js';
import {Permissions} from '../lib/permissions.js';
import {PlanRepeatGuard} from '../lib/plan-repeat-guard.js';
import {hostToolsFixture} from './host-tools-fixture.mjs';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const boardSource=path.join(os.homedir(),'.dsh/profiles/desktop/node_modules/@linxin666/dsh-client-ui-task-board/src');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-repeat-host-'));
const fibers=[],disposers=[],handles=[];
let modelCalls=0,toolBodies=0,preSteps=0,passed=false;
try{
  const [{Context},{SessionStore},{SessionProjectionRegistry},{default:SystemPrompt},{AgentRegistry},{default:AgentLoop},fixture]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-session'),hostImport('dsh-session-projection'),hostImport('dsh-system-prompt'),hostImport('dsh-agent'),hostImport('dsh-agent-loop'),hostToolsFixture(hostRoot),
  ]);
  const ctx=new Context(),signal=new AbortController().signal;
  ctx.provide('llm',new Proxy({}, {get:()=>()=>{modelCalls++;throw Error('No model call allowed');}}));
  for(const [implementation,config] of [[SessionStore,{}],[SessionProjectionRegistry,{}],[SystemPrompt,{includeHarnessIdentity:false}],...fixture.plugins('native'),[AgentRegistry,{}],[AgentLoop,{agents:[],maxParallelToolCalls:1}]]){
    const fiber=ctx.plugin(implementation,config);fibers.push(fiber);await fiber;
  }
  const handle=await ctx.agents.create({sessionId:'synthetic-repeat-session',meta:{cwd:temp},agentOptions:{provider:'synthetic-provider',model:'synthetic-model'}});handles.push(handle);
  const agent=handle.agent,store=new Store(temp);store.saveState({...store.state(),sessionId:'synthetic-personal'});
  const schedule={enabled:true,nextRunAt:987654321};
  const task={id:'synthetic-plan',schedule,integrations:{'dsh-my-fish':{kind:'personal-plan',version:1,fingerprint:'synthetic'}},executions:[{id:'synthetic-execution',sessionId:agent.session.id,startedAt:1}]};
  const host={snapshot:()=>({tasks:[task]})},notices=[];
  const repeat=new PlanRepeatGuard({getHost:()=>host,assistant:{addNotice:notice=>{notices.push(notice);return {notice:{id:'synthetic'},deduplicated:false};}}});
  const permissions=new Permissions(store,{isPlanSession:exec=>exec.agent===agent});
  disposers.push(ctx.tools.register({name:'pwsh',description:'Synthetic blocked tool',parameters:{type:'object',properties:{},additionalProperties:true},output:{schema:{},render:()=>[{type:'text',text:'Synthetic'}]},execute:()=>{toolBodies++;throw Error('Tool body must never run');}}));
  disposers.push(ctx.tools.guard(exec=>repeat.record(exec,permissions.guard(exec))));
  let testDenials=false,continued=0;
  disposers.push(ctx.on('agent/pre-step',async (event,next)=>{
    if(testDenials&&event.agent===agent){
      preSteps++;
      for(const callId of ['synthetic-one','synthetic-two']){
      const result=await fixture.invoke(ctx,{agent,name:'pwsh',arguments:{},callId,signal});
      assert.equal(result.isError,true);
      }
    }
    return repeat.preStep(event)??next();
  },{global:true}));
  disposers.push(ctx.on('session/event',(session,event)=>repeat.observe(session,event),{global:true}));
  // Reach the host's actual default enter decision, then stop before any model
  // call. Both an unrelated chat and an unblocked owned plan must continue.
  const stopBeforeModel=ctx.on('agent/pre-step',async (_event,next)=>{
    const decision=await next();assert.equal(decision.kind,'enter');assert.ok(Array.isArray(decision.messages));continued++;
    return {kind:'reject',reason:'Synthetic test stops before model'};
  },{global:true});disposers.push(stopBeforeModel);
  const ordinary=await ctx.agents.create({sessionId:'synthetic-unrelated-session',meta:{cwd:temp},agentOptions:{provider:'synthetic-provider',model:'synthetic-model'}});handles.push(ordinary);
  for(const current of [ordinary.agent,agent]){current.followup({content:[{type:'text',text:'Synthetic unblocked chat'}],source:{kind:'user'}});await current.whenIdle();}
  assert.equal(continued,2);assert.equal(notices.length,0);assert.equal(modelCalls,0);
  stopBeforeModel();testDenials=true;
  agent.followup({content:[{type:'text',text:'Synthetic plan run'}],source:{kind:'user'}});
  await agent.whenIdle();
  const events=agent.session.snapshotEvents(),ending=events.find(event=>event.type==='turn/end');
  assert.equal(ending?.data?.reason?.kind,'blocked');
  assert.equal(preSteps,1);assert.equal(toolBodies,0);assert.equal(modelCalls,0);assert.equal(notices.length,1);
  assert.deepEqual(task.schedule,{enabled:true,nextRunAt:987654321});

  // Load the installed task board's public runner and pure support code from
  // a temporary source copy; no live board service or ledger is opened.
  const copied=path.join(temp,'board-source');fs.cpSync(boardSource,copied,{recursive:true});
  fs.writeFileSync(path.join(temp,'package.json'),'{"type":"module"}');
  const rewrite=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true}) ){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())rewrite(file);
    else if(entry.name.endsWith('.ts')){
      let source=stripTypeScriptTypes(fs.readFileSync(file,'utf8'),{mode:'transform'});
      source=source.replaceAll("'@deepseek-ai/cordis'",JSON.stringify(pathToFileURL(path.join(hostRoot,'@deepseek-ai/cordis/lib/index.js')).href));
      fs.writeFileSync(file,source);
    }
  }};
  rewrite(copied);
  const {HostExecutionRunner}=await import(pathToFileURL(path.join(copied,'host-runner.ts')).href);
  const gateway={stream:async()=>({async *[Symbol.asyncIterator](){yield {type:'snapshot',cursor:agent.session.seq,records:events.map(event=>({event})),hasMore:false};}})};
  const peer={id:'synthetic-peer',ctx,principal:{kind:'owner'},signal,interactions:'none',dispose:async()=>{}};
  const runner=new HostExecutionRunner(gateway,undefined,undefined,undefined,peer);
  const result=await runner.inspect(agent.session.id,0,[{sessionId:agent.session.id,running:false}]);
  assert.equal(result.outcome,'failed');assert.match(result.error,/blocked/);
  const {settleExecution}=await import(pathToFileURL(path.join(copied,'core/tasks.ts')).href);
  const settled=settleExecution({...task,status:'running'},'synthetic-execution',result.outcome,12345,result.error);
  assert.equal(settled.status,'failed');assert.equal(settled.executions[0].result,'failed');
  assert.equal(settled.executions[0].endedAt,12345);assert.deepEqual(settled.schedule,schedule);
  passed=true;
}finally{
  for(const dispose of disposers.reverse())await dispose();
  for(const handle of handles.reverse())await handle.dispose();
  for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(temp,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({repeatDenialRealAgent:'passed',unblockedPlanContinuation:'passed',unrelatedChatContinuation:'passed',blockedTurn:'passed',boardInspect:'failed-as-expected',boardSettlementTransition:'failed-as-expected',scheduleUnchanged:true,notices:1,toolBodies,modelCalls,realLedgerReads:0,scope:'Synthetic guard calls inside pre-step; installed AgentLoop, board runner inspect via synthetic gateway, and pure board settlement; no live board service, plan or model'}));
