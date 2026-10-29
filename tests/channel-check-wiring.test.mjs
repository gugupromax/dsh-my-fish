import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import plugin from '../lib/index.js';
import {Social} from '../lib/social.js';

test('channel checks are trusted settings operations and malformed requests never reach a provider',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-channel-check-http-')),oldHome=process.env.DSH_HOME,oldCheck=Social.prototype.check;
  process.env.DSH_HOME=home;const routes=new Map(),tools=[],effects=[],calls=[];
  Social.prototype.check=async function(args,signal,exec){calls.push({args,signal,exec});return {ok:true,platform:args.platform,channel:{id:args.platform},checks:{permissions:{status:'configuration-only',liveWritesChecked:false}},note:'Synthetic read-only check'};};
  t.after(()=>{for(const cleanup of effects.reverse())cleanup?.();Social.prototype.check=oldCheck;if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;assert.equal(path.dirname(path.resolve(home)),path.resolve(os.tmpdir()));fs.rmSync(home,{recursive:true,force:true});});
  plugin.apply({sessionController:{},connection:{requestRejection:()=>undefined},tools:{register:definition=>{tools.push(definition.name);return()=>{};}},webServer:{register:definition=>{routes.set(definition.path,definition.handler);return()=>{};}},effect:fn=>effects.push(fn()),logger:{warn:()=>{}}});
  async function request(prefix,body,origin='http://127.0.0.1:3000',method='POST'){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url:prefix+'/channels/check',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000',origin,'content-type':'application/json'}});
    let result;const res={statusCode:0,setHeader:()=>{},end:value=>{result={status:res.statusCode,body:JSON.parse(value)};}};await routes.get(prefix)(req,res);return result;
  }
  for(const prefix of ['/my-fish/api','/x-whale/api']){
    const result=await request(prefix,{platform:'x'});assert.equal(result.status,200);assert.equal(result.body.checks.permissions.liveWritesChecked,false);
    assert.equal((await request(prefix,{platform:'x'},'https://untrusted.invalid')).status,403);
    for(const body of [{},{platform:'x',allowReplies:true},{platform:1},[],null])assert.equal((await request(prefix,body)).status,400);
    assert.equal((await request(prefix,undefined,undefined,'GET')).status,405);
  }
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.args.platform==='x'&&call.signal instanceof AbortSignal&&call.exec===undefined));
  assert.equal(tools.includes('social_check'),false,'connection checks must not become an automatic model tool');
});
