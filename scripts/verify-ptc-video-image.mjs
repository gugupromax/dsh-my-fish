// Installed PTC executor + production My Fish, with a synthetic program runtime.
// No real model, network, user video, user profile or user conversation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const app=process.env.DSH_DESKTOP_EXE||'D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fish-ptc-video-'));
const replace=(source,before,after)=>{assert.ok(source.includes(before),'Missing fixture anchor: '+before);return source.replace(before,after);};
try{
 let source=fs.readFileSync(path.join(dir,'verify-companion-bridges.mjs'),'utf8');
 source=source.replace(/from '([.][^']+)'/g,(_all,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(dir,p)).href));
 source=replace(source,"...fixture.plugins('native')","...fixture.plugins('ptc')");
 source=replace(source,"const ctx=new Context(),signal=",`const ctx=new Context();\n  ctx.provide('ptcRuntime',{language:'typescript',programFormat:'function-body',resolve:spec=>({...spec,timeoutMs:null}),run:async spec=>{const value=await spec.bindings[0].functions.assistant_video({reference:'BV1GJ411x7h7',from:10,seconds:45});return {logs:[],value};},release:()=>{}});\n  const signal=`);
 const start=source.indexOf('  let counter=0;const execute=');const end=source.indexOf('\n}finally{',start);assert.ok(start>=0&&end>start,'Fixture execution section missing');
 const body=`  const {Permissions}=await import(${JSON.stringify(pathToFileURL(path.resolve(dir,'../lib/permissions.js')).href)});
  new Permissions(store).save({shell:true});new IntegrationSettings(store).save({videoEnabled:true});
  const result=await fixture.invoke(ctx,{name:'run_code',arguments:{code:'synthetic program',description:'Synthetic video dispatch'},agent:main,signal,callId:'synthetic-ptc-run'});
  assert.equal(result.isError,false,result.error?.message);assert.equal(providerCalls.length,2);
  assert.ok(Array.isArray(result.additionalContexts),'PTC image should be a deferred context');
  const context=result.additionalContexts.find(message=>message.source?.kind==='ptc-mode'&&message.content?.some(block=>block.type==='image'));
  assert.ok(context,'PTC executor attaches successful image for the next context');assert.deepEqual(context.content.find(block=>block.type==='image').attachment,image);
  const {projectImagesForTextModel}=await load('dsh-llm');const projected=projectImagesForTextModel([context]);
  assert.ok(!projected[0].content.some(block=>block.type==='image'));assert.ok(projected[0].content.some(block=>block.type==='text'&&/image omitted/.test(block.text)));
  assert.equal(modelCalls,0);passed=true;console.log(JSON.stringify({actualPtcExecutor:'passed',syntheticProgramRuntime:true,productionVideoBridge:'passed',deferredImageContext:'passed',textOnlyProjection:'passed',modelCalls,networkCalls:0,scope:'Actual DSH PTC executor and pipeline with synthetic program runtime, fixture image reference, no real model or network; does not prove provider pixels or model request admission'}));`;
 source=source.slice(0,start)+body+source.slice(end);
 const file=path.join(temp,'ptc.mjs');fs.writeFileSync(file,source);
 const result=spawnSync(app,['--expose-internals',file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0||!result.stdout.includes('actualPtcExecutor'))throw Error('PTC video image isolation verification failed');
}finally{const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temp,{recursive:true,force:true});}
