// Isolated metadata contract verification. No real profile, chat, agent or model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-session-metadata-host-'));
const fibers=[],handles=[];
let passed=false;
try {
  const [{Context},{SessionStore},backend,{SessionQueryEngine}]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-session'),hostImport('dsh-session-persistence-jsonl'),hostImport('dsh-session-query'),
  ]);
  const ctx=new Context();
  for(const [plugin,config] of [[SessionStore,{}],[backend,{root:path.join(temporaryRoot,'logs'),compression:'none'}],[SessionQueryEngine,{}]]){
    const fiber=ctx.plugin(plugin,config);fibers.push(fiber);await fiber;
  }
  const persistence=ctx.sessionPersistence,sessionId='synthetic-personal-metadata';
  const signal=new AbortController().signal;
  assert.equal(await persistence.stat(sessionId,{signal}),undefined,'an absent identity is strictly undefined');
  const header={version:4,id:sessionId,createdAt:1,cwd:temporaryRoot,isSeeded:false};
  const handle=await persistence.create(header,{signal});handles.push(handle);
  const pending=await persistence.stat(sessionId,{signal});
  assert.equal(pending.header.id,sessionId);assert.equal(typeof pending.revision,'string');
  assert.equal(ctx.sessions.get(sessionId),undefined,'metadata lookup does not resume a live session');
  await handle.flush();await handle.close();
  const stored=await persistence.stat(sessionId,{signal});
  assert.equal(stored.header.cwd,temporaryRoot);assert.equal(stored.formatStatus,'current');assert.equal(typeof stored.sizeBytes,'number');
  const artifact=persistence.locate(header).path;
  const relativeArtifact=path.relative(temporaryRoot,path.resolve(artifact));
  assert.ok(relativeArtifact&&!relativeArtifact.startsWith('..')&&!path.isAbsolute(relativeArtifact));
  const original=fs.readFileSync(artifact,'utf8');
  fs.appendFileSync(artifact,'THIS SYNTHETIC BODY IS INTENTIONALLY NOT A VALID EVENT\n');
  assert.equal((await persistence.stat(sessionId,{signal})).header.id,sessionId,'stat reads the header and filesystem metadata, not the chat body');
  const cancelled=new AbortController();cancelled.abort(Error('synthetic metadata cancellation'));
  await assert.rejects(()=>persistence.stat(sessionId,{signal:cancelled.signal}),/synthetic metadata cancellation/);
  fs.writeFileSync(artifact,'{broken synthetic header\n');
  assert.equal(await persistence.stat(sessionId,{signal}),undefined,'installed JSONL stat also returns undefined for an unreadable header: it is not proof of physical deletion');
  fs.writeFileSync(artifact,original);
  assert.equal((await persistence.stat(sessionId,{signal})).header.id,sessionId);
  const withoutPersistence=new Context(),unavailableFibers=[];
  try{
    for(const plugin of [SessionStore,SessionQueryEngine]){const fiber=withoutPersistence.plugin(plugin,{});unavailableFibers.push(fiber);await fiber;}
    await assert.rejects(()=>withoutPersistence.sessionQuery.observeSession(sessionId),error=>error.code==='SESSION_QUERY_SESSION_NOT_FOUND','a missing persistence service is also reported as not found by the query layer');
  }finally{for(const fiber of unavailableFibers.reverse())await fiber.dispose();}
  passed=true;
} finally {
  for(const handle of handles.reverse())await handle.close();
  for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporaryRoot));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(passed)console.log(JSON.stringify({hostSessionMetadata:'passed',strictMissingUndefined:'passed',pendingAndStoredShape:'passed',metadataOnlyNoResume:'passed',bodyNotRead:'passed',cancellationPreserved:'passed',malformedHeaderAlsoReturnsUndefined:true,missingPersistenceAlsoLooksNotFound:true,modelCalls:0,scope:'Installed JSONL persistence and SessionQuery with a temporary synthetic artifact; no user profile, actual chat or agent operations'}));
