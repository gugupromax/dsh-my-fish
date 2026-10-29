// Installed Cordis/Session contracts only; no real profile, logs, model, GUI or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import plugin from '../lib/index.js';
import {Store} from '../lib/store.js';
import {CompanionStore} from '../lib/companion-store.js';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-companion-host-'));
const previousHome=process.env.DSH_HOME,fibers=[],definitions=[],routes=[];
let modelCalls=0,passed=false;
process.env.DSH_HOME=temporaryRoot;
try{
  const [{Context},{SessionStore},{createUserMessage,createAssistantMessage},sdk]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-session'),hostImport('dsh-llm'),hostImport('dsh-tools'),
  ]);
  const ctx=new Context();
  const providerFiber=ctx.plugin({name:'synthetic-companion-host-providers',apply:child=>{
    child.provide('sessionController',{
      create:()=>{modelCalls++;throw Error('No real session creation is allowed');},
      prompt:()=>{modelCalls++;throw Error('No model prompt is allowed');},
      resolveAgent:()=>{modelCalls++;throw Error('No real agent may be resumed');},
    });
    child.provide('connection',{requestRejection:()=>undefined});
    child.provide('webServer',{register:route=>{routes.push(route);return ()=>{};}});
    child.provide('tools',{
      register:definition=>{sdk.assertObjectJsonSchema(definition.parameters);sdk.assertSupportedJsonSchema(definition.output.schema);definitions.push(definition);return ()=>{};},
      guard:()=>()=>{},get:()=>undefined,
    });
  }});fibers.push(providerFiber);await providerFiber;
  const sessionFiber=ctx.plugin(SessionStore,{});fibers.push(sessionFiber);await sessionFiber;
  const personalFiber=ctx.plugin(plugin);fibers.push(personalFiber);await personalFiber;
  await new Promise(resolve=>setImmediate(resolve));
  const store=new Store(),companion=new CompanionStore(store),mainId='synthetic-companion-main';
  store.saveState({...store.state(),sessionId:mainId});
  assert.equal(definitions.length,23);assert.ok(definitions.some(item=>item.name==='assistant_companion'));
  assert.ok(routes.some(item=>item.path==='/my-fish/api'));

  let main,ordinary;
  const sourceFiber=ctx.plugin({name:'synthetic-companion-message-source',inject:['sessions'],apply:child=>{
    main=child.sessions.create(mainId,{meta:{cwd:temporaryRoot}});
    ordinary=child.sessions.create('synthetic-companion-ordinary',{meta:{cwd:temporaryRoot}});
  }});fibers.push(sourceFiber);await sourceFiber;
  const append=(session,text,source)=>{
    const message=createUserMessage({content:[{type:'text',text}],source});
    const event=session.append('user/message',message,{surfaceOp:'append'});
    return {message,event};
  };
  const live=append(main,'  Synthetic user opinion kept verbatim.  ',{kind:'user',rpcId:'synthetic-live-user-rpc'});
  let rows=companion.snapshot().recentUserMessages;
  assert.equal(rows.length,1);assert.equal(rows[0].id,live.message.id);assert.equal(rows[0].text,'  Synthetic user opinion kept verbatim.  ');
  assert.equal(rows[0].sessionId,mainId);assert.equal(rows[0].at,live.event.time);assert.ok(Number.isSafeInteger(live.event.time));
  assert.equal(live.event.data.source.rpcId,'synthetic-live-user-rpc');assert.equal(live.event.data.id,live.message.id);

  append(ordinary,'Synthetic unrelated personal statement',{kind:'user',rpcId:'synthetic-ordinary-rpc'});
  append(main,'Synthetic runtime context',{kind:'runtime-context'});
  append(main,'Synthetic message with no explicit user RPC',{kind:'user'});
  companion.registerDispatch('synthetic-internal-rpc');
  append(main,'Synthetic generated followup, not an actual user opinion',{kind:'user',rpcId:'synthetic-internal-rpc'});
  append(main,'Synthetic generated chat whose index may have expired',{kind:'user',rpcId:'my-fish-chat-synthetic-evicted'});
  append(main,'Synthetic generated wake whose index may have expired',{kind:'user',rpcId:'my-fish-wake-synthetic-evicted'});
  append(main,'auth_token=SYNTHETIC_NEVER_PERSIST',{kind:'user',rpcId:'synthetic-secret-rpc'});
  const assistant=createAssistantMessage({content:[{type:'text',text:'Synthetic model text, not a user opinion'}],source:{provider:'synthetic',model:'synthetic'}});
  main.append('assistant/message',{turn:1,step:1,message:assistant},{surfaceOp:'append'});
  assert.equal(companion.snapshot().recentUserMessages.length,1);

  // Replaying the same immutable event is idempotent. No history is scanned.
  ctx.emit('session/event',main,live.event);
  assert.equal(companion.snapshot().recentUserMessages.length,1);
  await personalFiber.dispose();
  append(main,'Synthetic after plugin disposal',{kind:'user',rpcId:'synthetic-disposed-rpc'});
  assert.equal(companion.snapshot().recentUserMessages.length,1);
  assert.equal(modelCalls,0);
  passed=true;
}finally{
  for(const fiber of fibers.reverse())await fiber.dispose();
  if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporaryRoot));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Cleanup stays inside the OS temporary directory');
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({hostCompanionEvents:'passed',actualUserMessageShape:'passed',mainSessionIsolation:'passed',internalPromptExclusion:'passed',sensitiveMessageExclusion:'passed',duplicateEventIdempotence:'passed',disposal:'passed',registeredTools:definitions.length,modelCalls,networkCalls:0,realProfileReads:0,scope:'Installed Cordis/SessionStore/createUserMessage with temporary data and synthetic committed events; actual My Fish event hook and SDK schemas, no real agent or history'}));
