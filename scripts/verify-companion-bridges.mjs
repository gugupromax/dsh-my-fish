// Actual root plugin and installed host with temporary synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import plugin from '../lib/index.js';
import {Store,readJSON} from '../lib/store.js';
import {IntegrationSettings} from '../lib/integration-settings.js';
import {Readable} from 'node:stream';
import {hostToolsFixture} from './host-tools-fixture.mjs';
const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const load=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const fixture=await hostToolsFixture(hostRoot),temp=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-companion-bridges-'));
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
  const {default:Subagents}=await load('dsh-subagent');const subagentFiber=ctx.plugin(Subagents,{});fibers.push(subagentFiber);await subagentFiber;
  disposers.push(await ctx.agentPresets.register({id:'synthetic-default',name:'Synthetic default',plugins:[]}));
  const workspace=await ctx.workspaceRegistry.create(temp,'Synthetic selected Fish workspace');
  const created=await ctx.sessionController.create({sessionId:'synthetic-chain-main',workspaceId:workspace.id,agentPreset:'synthetic-default'}),main=ctx.agents.get(created.sessionId),store=new Store();store.saveState({...store.state(),sessionId:created.sessionId,mainSessionBinding:{sessionId:created.sessionId,workspaceId:workspace.id,path:workspace.path,boundAt:Date.now()}});

  const routes=new Map();ctx.provide('webServer',{register:row=>{routes.set(row.path,row.handler);return ()=>routes.delete(row.path);}});ctx.provide('connection',{requestRejection:()=>undefined});
  globalThis.fetch=()=>{throw Error('No external video, pet or network calls allowed');};
  const image={attachmentId:'sha256:'+'a'.repeat(64),mediaType:'image/png',width:800,height:450,bytes:30000},providerCalls=[];
  for(const name of ['video_probe','video_storyboard'])disposers.push(ctx.tools.register({name,description:'Synthetic external video provider',parameters:{type:'object',properties:{input:{type:'string'}},required:['input'],additionalProperties:true},output:{schema:{},render:(_a,v)=>[...(v.images??[]).map(attachment=>({type:'image',attachment})),{type:'text',text:v.text}]},execute:(args,exec)=>{
    providerCalls.push({name,args,exec});assert.ok(exec.parent,'Provider receives the actual outer execution token');assert.notEqual(exec.rootCallId,exec.callId);
    assert.equal(args.input,'https://www.bilibili.com/video/BV1GJ411x7h7/');
    if(name==='video_storyboard'){assert.equal(args.maxFrames,12);assert.equal(args.maxSheets,2);assert.equal(args.to-args.from,45);assert.equal(args.scanHeight,360);}
    return name==='video_probe'?{text:'Synthetic metadata'}:{text:'Synthetic bounded video index',images:[image]};
  }}));
  const personal=ctx.plugin(plugin);fibers.push(personal);await personal;await new Promise(resolve=>setImmediate(resolve));
  let counter=0;const execute=(name,args)=>fixture.invoke(ctx,{name,arguments:args,agent:main,signal,callId:'synthetic-bridges-'+(++counter)});
  const directBefore=await execute('video_probe',{input:'https://www.bilibili.com/video/BV1GJ411x7h7/'});assert.equal(directBefore.isError,true);assert.equal(providerCalls.length,0);
  const disabled=await execute('assistant_video',{reference:'BV1GJ411x7h7'});assert.equal(disabled.isError,true);assert.equal(providerCalls.length,0);
  new IntegrationSettings(store).save({videoEnabled:true});
  const value=await execute('assistant_video',{reference:'BV1GJ411x7h7',from:10,seconds:45});assert.equal(value.isError,false,value.error?.message);
  assert.equal(providerCalls.length,2);assert.equal(providerCalls[0].exec.rootCallId,providerCalls[1].exec.rootCallId);assert.deepEqual(value.value.images,[image]);assert.deepEqual(value.value,JSON.parse(JSON.stringify(value.value)));assert.equal(value.value.hasTranscript,null);
  const renderer=ctx.tools.get('assistant_video',main).output.render({reference:'BV1GJ411x7h7'},value.value);assert.deepEqual(renderer[0],{type:'image',attachment:image});assert.equal(renderer[1].type,'text');assert.equal(JSON.parse(renderer[1].text).images,undefined);
  const directAfter=await execute('video_storyboard',{input:'https://www.bilibili.com/video/BV1GJ411x7h7/'});assert.equal(directAfter.isError,true);assert.equal(providerCalls.length,2);
  async function http(method,route,body){const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url='/my-fish/api/'+route;req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'127.0.0.1:4000',origin:'http://127.0.0.1:4000',...(body===undefined?{}:{'content-type':'application/json'})};const res={statusCode:0,setHeader(){},end(raw){this.body=JSON.parse(raw);}};await routes.get('/my-fish/api')(req,res);assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body;}
  await http('POST','presentation',{enabled:true,mode:'browser',speak:true});
  const spoken=createAssistantMessage({content:[{type:'text',text:'Synthetic main conversation statement.'}],source:{provider:'synthetic',model:'synthetic'}});
  main.session.append('assistant/message',{turn:1,step:1,message:spoken},{surfaceOp:'append'});await new Promise(resolve=>setImmediate(resolve));
  const queue=await http('GET','presentation/speech?after=0&consumer=synthetic-browser-consumer');assert.equal(queue.claimed,true);assert.equal(queue.items.length,1);assert.equal(queue.items[0].text,'Synthetic main conversation statement.');
  const oldEpoch=queue.epoch;await http('POST','presentation/stop',{});const stopped=await http('GET','presentation/speech?after=0&consumer=synthetic-browser-consumer');assert.equal(stopped.items.length,0);assert.ok(stopped.epoch>oldEpoch);
  assert.equal(modelCalls,0);passed=true;console.log(JSON.stringify({productionVideoBoundary:'passed',directVideoStillDenied:'passed',nestedProvenanceAndBudget:'passed',nativeAttachmentRenderer:'passed',losslessVideoResult:'passed',mainSpeechQueue:'passed',speechStopEpoch:'passed',modelCalls,realNetworkCalls:0,imagePixelAdmission:'not-tested',scope:'Actual root plugin and installed ToolRuntime/controller; synthetic provider refs and committed assistant event; no real media, pet, audio or model'}));
}finally{
  for(const dispose of disposers.reverse())await dispose();for(const fiber of fibers.reverse())await fiber.dispose();globalThis.fetch=previousFetch;if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temp,{recursive:true,force:true});
}
if(!passed)throw Error('Companion bridge verification did not complete');
