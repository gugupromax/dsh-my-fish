// Installed SessionController/Agent/Inbox integration, with synthetic data only.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fish-interest-queue-script-'));
try{
  let source=fs.readFileSync(path.join(directory,'verify-session-binding.mjs'),'utf8');
  const anchor='  const firstSequence=agent.session.seq;';assert.ok(source.includes(anchor));source=source.slice(0,source.indexOf(anchor));
  source=source.replace(/from '([.][^']+)'/g,(_all,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(directory,p)).href));
  const uploadAnchor='registerAgentResolver:()=>()=>{},';assert.ok(source.includes(uploadAnchor));source=source.replace(uploadAnchor,uploadAnchor+'retirePrompt:()=>{},');
  const homeAnchor="const selected=path.join(temporaryRoot,'selected'),other=path.join(temporaryRoot,'other');";assert.ok(source.includes(homeAnchor));source=source.replace(homeAnchor,homeAnchor+"process.env.DSH_HOME=temporaryRoot;let blockedNetworkCalls=0;globalThis.fetch=()=>{blockedNetworkCalls++;throw Error('No network permitted');};");
  source+=`
  const {Exploration}=await import(${JSON.stringify(pathToFileURL(path.resolve(directory,'../lib/exploration.js')).href)});
  const fixtureStore=new Store(selected);fixtureStore.saveState({...fixtureStore.state(),sessionId:created.sessionId});
  const controller={updateQueue:request=>ctx.sessionController.updateQueue(request)};
  const ex=new Exploration({store:fixtureStore,experiences:{episodes:()=>[]},controller,getMainAgent:()=>agent});
  const requestId='my-fish-chat-discovery-synthetic-queue';
  const row={runId:'synthetic-run',mainSessionId:created.sessionId,interestId:'synthetic-interest',status:'queued',requestId,turn:null};
  ex.save({version:1,runs:[],openings:[row],lastUserAt:0});
  await agent.runMaintenance(async()=>{
    const request=async(id,text)=>ctx.sessionController.prompt({sessionId:created.sessionId,requestId:id,mode:'queue',content:[{type:'text',text}]},signal);
    assert.equal((await request('synthetic-other','Unrelated synthetic queue item')).accepted,true);
    assert.equal((await request(requestId,'Synthetic discovery opening')).accepted,true);
    const all=[...agent.inbox.nextTurn,...agent.inbox.nextStep];
    assert.equal(all.filter(x=>x.source?.rpcId===requestId).length,1);assert.equal(all.filter(x=>x.source?.rpcId==='synthetic-other').length,1);
    const result=await ex.cancelQueuedForInterest('synthetic-interest');assert.equal(result.ok,true);assert.equal(result.cancelled,1);
    const after=[...agent.inbox.nextTurn,...agent.inbox.nextStep];assert.equal(after.filter(x=>x.source?.rpcId===requestId).length,0);assert.equal(after.filter(x=>x.source?.rpcId==='synthetic-other').length,1);
    assert.equal(ex.state().openings[0].status,'cancelled');
    const missing={...row,runId:'synthetic-missing',requestId:'my-fish-chat-discovery-missing'};ex.save({version:1,runs:[],openings:[missing],lastUserAt:0});
    assert.equal((await ex.cancelQueuedForInterest('synthetic-interest')).uncertain,true);
    const claimed={...row,runId:'synthetic-claimed',turn:1,requestId:'my-fish-chat-discovery-claimed'};ex.save({version:1,runs:[],openings:[claimed],lastUserAt:0});
    assert.equal((await ex.cancelQueuedForInterest('synthetic-interest')).uncertain,true);
    const remain=[...agent.inbox.nextTurn,...agent.inbox.nextStep];assert.equal(remain.filter(x=>x.source?.rpcId==='synthetic-other').length,1);
    const other=remain.find(x=>x.source?.rpcId==='synthetic-other');assert.equal((await ctx.sessionController.updateQueue({sessionId:created.sessionId,itemId:other.id,action:{kind:'remove'}})).accepted,true);
  });
  assert.equal(modelCalls,0);assert.equal(blockedNetworkCalls,0);passed=true;
}finally{
  for(const dispose of disposers.reverse())await dispose();for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(temporaryParent,path.resolve(temporaryRoot));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({actualSessionController:'passed',actualAgentInbox:'passed',exactQueuedRemoval:'passed',unrelatedQueuePreserved:'passed',missingAndClaimedUncertain:'passed',modelCalls,networkCalls:0,scope:'Synthetic temporary DSH SDK sessions; no real profile, model, or network'}));
`;
  const file=path.join(temporary,'fixture.mjs');fs.writeFileSync(file,source);
  const app=process.env.DSH_DESKTOP_EXE||'D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe';
  const result=spawnSync(app,['--expose-internals',file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
  if(result.error||result.status!==0||!result.stdout?.includes('actualSessionController'))throw Error('Installed interest queue verification failed');
}finally{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporary));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temporary,{recursive:true,force:true});}
