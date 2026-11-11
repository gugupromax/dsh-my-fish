// Actual root plugin and installed host with temporary synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import plugin from '../lib/index.js';
import {Store,readJSON} from '../lib/store.js';
import {ExperienceStore} from '../lib/experience-store.js';
import {hostToolsFixture} from './host-tools-fixture.mjs';
const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const load=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const fixture=await hostToolsFixture(hostRoot),temp=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-exploration-chain-'));
const previousHome=process.env.DSH_HOME,previousFetch=globalThis.fetch,previousInterval=globalThis.setInterval;
process.env.DSH_HOME=temp;
const fibers=[],disposers=[],held=[];let modelCalls=0,fetchCalls=0,webCalls=0,replyCalls=0,passed=false,tick;
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
  ctx.provide('web',{searchReady:()=>true,fetchReady:()=>false,search:async()=>{webCalls++;return {content:'Synthetic search',sources:[{url:'https://www.bilibili.com/video/BV1GJ411x7h7/',title:'Synthetic public source',snippet:'Synthetic summary'}],truncated:false};},fetch:()=>assert.fail()});
  for(const [implementation,config]of [[Loader,{baseUrl}],[Storage,{}],[jsonStorage,{root:path.join(temp,'storage')}],[domainStorage,{backend:'json'}],[SessionStore,{}],[SessionProjectionRegistry,{}],[SystemPrompt,{includeHarnessIdentity:false}],...fixture.plugins('native'),[AgentRegistry,{}],[jsonPersistence,{root:path.join(temp,'logs'),compression:'none'}],[SessionQueryEngine,{}],[WorkspaceRegistry,{}],[WorkingDirectoryService,{defaultDirectory:temp}],[AgentLoop,{agents:[],maxParallelToolCalls:1}],[AgentPresetRegistry,{default:'synthetic-default'}],[SessionController,{nativeOpen:false}]]){const fiber=ctx.plugin(implementation,config);fibers.push(fiber);await fiber;}
  disposers.push(await ctx.agentPresets.register({id:'synthetic-default',name:'Synthetic default',plugins:[]}));
  const workspace=await ctx.workspaceRegistry.create(temp,'Synthetic selected Fish workspace');
  const created=await ctx.sessionController.create({sessionId:'synthetic-chain-main',workspaceId:workspace.id,agentPreset:'synthetic-default'}),main=ctx.agents.get(created.sessionId),store=new Store();store.saveState({...store.state(),sessionId:created.sessionId,mainSessionBinding:{sessionId:created.sessionId,workspaceId:workspace.id,path:workspace.path,boundAt:Date.now()}});
  ctx.provide('webServer',{register:()=>()=>{}});ctx.provide('connection',{requestRejection:()=>undefined});
  globalThis.fetch=async url=>{
    fetchCalls++;const requested=new URL(url);assert.equal(requested.hostname,'api.bilibili.com');let data;
    if(requested.pathname==='/x/web-interface/view'){
      assert.equal(requested.searchParams.get('bvid'),'BV1GJ411x7h7');
      data={bvid:'BV1GJ411x7h7',aid:12345,title:'Synthetic metadata',desc:'Synthetic description for a fixture read',duration:50,owner:{name:'Synthetic creator',mid:123},stat:{view:10,reply:9}};
    }else{
      assert.equal(requested.pathname,'/x/v2/reply');replyCalls++;
      assert.equal(requested.searchParams.get('ps'),'5','Omitted count is bounded at the actual transport');assert.equal(requested.searchParams.get('pn'),'1');assert.equal(requested.searchParams.get('sort'),'2');assert.equal(requested.searchParams.get('oid'),'12345');
      data={page:{count:9},replies:Array.from({length:9},(_,index)=>({rpid:String(index+1),member:{uname:'Synthetic commenter',mid:'123'},like:index,rcount:0,ctime:1700000000,content:{message:'Synthetic comment '+index}}))};
    }
    return new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
  };
  globalThis.setInterval=(fn,ms,...args)=>{if(ms===60000){tick=fn;return previousInterval(()=>{},ms);}return previousInterval(fn,ms,...args);};
  const pluginFiber=ctx.plugin(plugin);fibers.push(pluginFiber);await pluginFiber;globalThis.setInterval=previousInterval;await new Promise(resolve=>setImmediate(resolve));
  await ctx.agentPresets.resolve('dsh-my-fish-explore-native');
  let backgroundReady;const waitBackground=new Promise(resolve=>backgroundReady=resolve),turns=new Map();
  disposers.push(ctx.on('agent/inbox/claimed',({agent,message,turn})=>{if(message.source?.rpcId?.startsWith('my-fish-chat-discovery-'))turns.set(agent.session.id,turn);},{global:true}));
  disposers.push(ctx.on('agent/pre-step',async ({agent},next)=>{
    const decision=await next();assert.equal(decision.kind,'enter');
    if(agent!==main){backgroundReady(agent);await new Promise(resolve=>held.push(resolve));}
    return {kind:'reject',reason:'Synthetic verifier prevents every model call'};
  },{global:true}));
  let callNumber=0;const execute=(agent,name,args)=>fixture.invoke(ctx,{name,arguments:args,agent,signal,callId:'synthetic-chain-'+(++callNumber)});
  const started=await execute(main,'assistant_explore',{action:'start'});assert.equal(started.isError,false,started.error?.message);
  const agent=await Promise.race([waitBackground,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Background did not reach pre-step')),3000);t.unref();})]);
  const run=readJSON(store.file('assistant/exploration.json'),null).runs.at(-1);assert.equal(run.sessionId,agent.session.id);assert.equal(run.mainSessionId,main.session.id);
  assert.ok(workspace.sessionIds.includes(agent.session.id),'Background execution belongs to the selected main workspace');assert.ok(workspace.sessionIds.includes(main.session.id));assert.equal(agent.session.header.cwd,workspace.path);
  const privateRead=await execute(agent,'assistant_memory',{action:'recall',query:'Synthetic'});assert.equal(privateRead.isError,true);
  const directWeb=await execute(agent,'web_search',{queries:['Synthetic bypass']});assert.equal(directWeb.isError,true);assert.equal(webCalls,0);
  const search=await execute(agent,'social_search',{platform:'bilibili',query:'Synthetic bounded search',count:1});assert.equal(search.isError,false,search.error?.message);assert.equal(webCalls,1);
  const repeatedSearch=await execute(agent,'social_search',{platform:'bilibili',query:'Synthetic extra search',count:1});assert.equal(repeatedSearch.isError,true);assert.equal(webCalls,1);
  const actual=await execute(agent,'social_read',{platform:'bilibili',reference:'BV1GJ411x7h7'});assert.equal(actual.isError,false,actual.error?.message);const value=actual.value??JSON.parse(actual.content[0].text);assert.equal(fetchCalls,1);assert.equal(value.companionReceipts.length,1);
  const comments=await execute(agent,'social_comments',{platform:'bilibili',reference:'BV1GJ411x7h7'});assert.equal(comments.isError,false,comments.error?.message);const commentValue=comments.value??JSON.parse(comments.content[0].text);assert.equal(replyCalls,1);assert.equal(fetchCalls,3);assert.equal(commentValue.items.length,5);assert.ok(commentValue.items.length<=5);
  const repeatedComments=await execute(agent,'social_comments',{platform:'bilibili',reference:'BV1GJ411x7h7'});assert.equal(repeatedComments.isError,true);assert.equal(fetchCalls,3);assert.equal(replyCalls,1);
  const searchValue=search.value??JSON.parse(search.content[0].text);assert.equal(searchValue.companionReceipts.length,1);
  const falseReport=await execute(agent,'assistant_explore',{action:'report',runId:run.id,quiet:false,share:true,title:'Synthetic false report',question:'Synthetic question?',thought:'Synthetic unverified thought',reason:'Synthetic search is only a lead',nextQuestion:'Synthetic next question?',receiptIds:[searchValue.companionReceipts[0].id]});assert.equal(falseReport.isError,true);assert.match(falseReport.error.message,/实际阅读/);assert.equal(new ExperienceStore(store).episodes(main.session.id).length,0);
  const report=await execute(agent,'assistant_explore',{action:'report',runId:run.id,quiet:false,share:true,title:'Synthetic new interest',question:'Synthetic question?',thought:'Synthetic observation from the fetched description',reason:'Synthetic interest because of the read detail',nextQuestion:'Synthetic next question?',receiptIds:[value.companionReceipts[0].id]});assert.equal(report.isError,false,report.error?.message);
  for(const resolve of held.splice(0))resolve();await agent.whenIdle();assert.equal(new ExperienceStore(store).episodes(main.session.id).length,1);
  assert.equal(typeof tick,'function');tick();
  for(let i=0;i<100&&!turns.has(main.session.id);i++)await new Promise(resolve=>setTimeout(resolve,10));
  await main.whenIdle();assert.ok(turns.has(main.session.id),'Real main prompt was consumed with its registered RPC identity');
  const message=createAssistantMessage({content:[{type:'text',text:'Synthetic natural opening https://www.bilibili.com/video/BV1GJ411x7h7/'}],source:{provider:'synthetic',model:'synthetic'}});
  main.session.append('assistant/message',{turn:turns.get(main.session.id),step:1,message},{surfaceOp:'append'});
  const final=readJSON(store.file('assistant/exploration.json'),null);assert.equal(final.runs.at(-1).status,'finished');assert.equal(final.openings.at(-1).status,'spoken');assert.equal(store.state().sessionId,main.session.id);assert.equal(store.state().dispatchPending,false);
  assert.equal(modelCalls,0);passed=true;
  console.log(JSON.stringify({productionExplorationChain:'passed',productionWorkspaceGrouping:'passed',productionPrivateIsolation:'passed',productionNestedSearchBudget:'passed',actualSyntheticReadReceipts:'passed',defaultCommentTransportLimit:'passed',repeatCommentBudget:'passed',searchReceiptReportRejected:'passed',episodeAndMainDelivery:'passed',committedMessageAttribution:'passed',modelCalls,syntheticFetchCalls:fetchCalls,syntheticReplyCalls:replyCalls,syntheticWebCalls:webCalls,realNetworkCalls:0,scope:'Actual root plugin, host controller/tools/guards/presets; synthetic Bili transport and committed assistant event; no actual model or private data'}));
}finally{
  for(const resolve of held.splice(0))resolve();for(const dispose of disposers.reverse())await dispose();for(const fiber of fibers.reverse())await fiber.dispose();
  globalThis.fetch=previousFetch;globalThis.setInterval=previousInterval;if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temp,{recursive:true,force:true});
}
if(!passed)throw Error('Exploration chain verification did not complete');
