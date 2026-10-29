// Runs against the installed host's actual schema implementation, without launching or changing DSH.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import plugin from '../lib/index.js';
import {Store} from '../lib/store.js';
const root=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const sdk=await import(pathToFileURL(path.join(root,'@deepseek-ai/dsh-tools/lib/index.js')).href);
const effects=[],names=[],definitions=[],statuses=[];
const isolatedHome=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-sdk-')),previousHome=process.env.DSH_HOME;
process.env.DSH_HOME=isolatedHome;
try {
  plugin.apply({sessionController:{},connection:{},tools:{register:definition=>{sdk.assertObjectJsonSchema(definition.parameters);sdk.assertSupportedJsonSchema(definition.output.schema);names.push(definition.name);definitions.push(definition);return ()=>{};}},webServer:{register:()=>()=>{}},effect:fn=>effects.push(fn()),logger:{warn:()=>{}}});
  const store=new Store(),sessionId='synthetic-sdk-personal-session';
  store.saveState({...store.state(),sessionId});
  const values=await import(pathToFileURL(path.join(root,'@deepseek-ai/dsh-util-values/lib/index.js')).href);
  for(const name of ['x_whale_status','social_status','assistant_context','assistant_capabilities','assistant_plan','assistant_companion']){
    const definition=definitions.find(d=>d.name===name);if(!definition)continue;
    const status=await definition.execute(['assistant_plan','assistant_companion'].includes(name)?{action:'list'}:{},{agent:{id:sessionId,session:{id:sessionId}},signal:new AbortController().signal});
    values.snapshotJsonValue(status);statuses.push(name);
  }
  console.log(JSON.stringify({hostSchema:'passed',hostStatusJson:'passed',registeredTools:names,statusTools:statuses},null,2));
} finally {
  for(const cleanup of effects.reverse())if(typeof cleanup==='function')cleanup();
  if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(isolatedHome));
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Refusing temporary cleanup outside the OS temporary directory');
  fs.rmSync(isolatedHome,{recursive:true,force:true});
}
