// Explicit installed-SDK combination checks; synthetic memory only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const app=process.env.DSH_DESKTOP_EXE||'D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fish-context-isolation-'));
const marker='SYNTHETIC_PRIVATE_CONTEXT_MARKER',required='SYNTHETIC_REQUIRED_CONTEXT_MARKER';
const providers=`disposers.push(ctx.systemPrompt.context({name:'synthetic-external-memory',order:110,interpolate:false,text:()=> '${marker}'}));disposers.push(ctx.systemPrompt.context({name:'synthetic-required',order:111,required:true,interpolate:false,text:()=> '${required}'}));`;
function replaceOnce(source,needle,replacement){assert.ok(source.includes(needle),'Fixture anchor absent: '+needle);return source.replace(needle,replacement);}
const attempts={};
try{
 for(const kind of ['explore','plan']){
  let source=fs.readFileSync(path.join(dir,kind==='explore'?'verify-explore-host.mjs':'verify-plan-native.mjs'),'utf8');
  source=source.replace(/from '([.][^']+)'/g,(_match,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(dir,p)).href));
  if(kind==='explore'){
   source=replaceOnce(source,'// An ordinary caller can still use its own preset; no global surface change.',providers+'\n  // An ordinary caller can still use its own preset; no global surface change.');
   source=replaceOnce(source,"assert.ok(ordinaryAssembly.tools.some(tool=>tool.name==='assistant_memory'));",`assert.ok(JSON.stringify(ordinaryAssembly).includes('${marker}'));assert.ok(ordinaryAssembly.tools.some(tool=>tool.name==='assistant_memory'));`);
   const needle='const assembly=await ctx.systemPrompt.assemble({agent,scope:agent,signal,toolSet}),names=assembly.tools.map(item=>item.name);';
   source=replaceOnce(source,needle,needle+`assert.equal(JSON.stringify(assembly).includes('${marker}'),false);assert.equal(JSON.stringify(assembly).includes('${required}'),true);assert.equal(JSON.stringify(ctx.systemPrompt.refreshContext(assembly,{agent,scope:agent,signal,toolSet})).includes('${marker}'),false);`);
  }else{
   source=replaceOnce(source,"const main={id:'synthetic-native-main'",providers+"\n  const main={id:'synthetic-native-main'");
   source=replaceOnce(source,'const oldSurface=await assemble(legacy);',`const oldSurface=await assemble(legacy);assert.ok(JSON.stringify(oldSurface).includes('${marker}'));`);
   const needle='const nativeSurface=await assemble(worker),nativeNames=nativeSurface.tools.map(tool=>tool.name);';
   source=replaceOnce(source,needle,needle+`assert.equal(JSON.stringify(nativeSurface).includes('${marker}'),false);assert.equal(JSON.stringify(nativeSurface).includes('${required}'),true);`);
  }
  const file=path.join(temp,kind+'.mjs');fs.writeFileSync(file,source);
  let result;for(let attempt=1;attempt<=3;attempt++){
   result=spawnSync(app,['--expose-internals',file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:60000});attempts[kind]=attempt;
   const fixtureError=/(?:EPERM: operation not permitted, rename[^\n]*my-fish-(?:explore-host|plan-native)-[^\n]*workspace\.json|ENOTEMPTY, Directory not empty[^\n]*my-fish-(?:explore-host|plan-native)-)/.test(result.stderr||'');
   if(result.status===0||!fixtureError)break;
   console.warn(kind+' synthetic fixture temporary-file error, attempt '+attempt+': '+(result.stderr||'').match(/(?:EPERM: operation not permitted, rename|ENOTEMPTY, Directory not empty)/)?.[0]);
  }
  if(result.error||result.status!==0)throw Error(kind+' fixture failed: '+(result.stderr||result.error));
  assert.match(result.stdout,/passed/);
 }
 console.log(JSON.stringify({optionalContextsSuppressed:['explore','plan'],ordinaryContextUnaffected:true,requiredContextRemains:true,exploreRefreshSuppressed:true,attempts,modelCalls:0,networkCalls:0,scope:'synthetic providers and actual installed SDK; required contexts, sections and variables are not suppressed'}));
}finally{
 const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temp,{recursive:true,force:true});
}
