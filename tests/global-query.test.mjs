import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin from '../lib/index.js';
import {Engine} from '../lib/engine.js';
test('another DSH session can ask its own query with scheduling off; public writing remains scoped',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x-global-')),oldHome=process.env.DSH_HOME,oldRead=Engine.prototype.read;
  const tools=new Map(),effects=[];let received;
  process.env.DSH_HOME=tmp;
  Engine.prototype.read=async function(operation,args){received={operation,args};return {data:[]};};
  try{
    plugin.apply({sessionController:{},connection:{},tools:{register:d=>{tools.set(d.name,d);return ()=>{};}},webServer:{register:()=>()=>{}},effect:fn=>effects.push(fn()),logger:{warn:()=>{}}});
    const exec={signal:new AbortController().signal,agent:{id:'another-window',session:{header:{id:'another-window'}}}};
    await tools.get('x_whale_search').execute({query:'任意会话自己的检索词',count:3},exec);
    assert.equal(received.operation,'search');assert.equal(received.args.query,'任意会话自己的检索词');
    const status=await tools.get('x_whale_status').execute({},exec);
    assert.equal(status.config.enabled,false);assert.equal(status.config.persona,undefined);assert.equal(status.config.queries,undefined);
    await assert.rejects(()=>tools.get('x_whale_reply').execute({id:'123456',text:'hi',reason:'a specific reason'},exec),/专用/);
  }finally{
    for(const cleanup of effects)cleanup();Engine.prototype.read=oldRead;
    if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
