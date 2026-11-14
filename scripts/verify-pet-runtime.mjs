// Installed dsh-pet runtime, synthetic home and no real profile/renderer/voice.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {Readable} from 'node:stream';import {EventEmitter} from 'node:events';
import childProcess from 'node:child_process';import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import {syncBuiltinESMExports} from 'node:module';
const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const petRoot=process.env.DSH_PET_PACKAGE||path.join(os.homedir(),'.dsh/profiles/desktop/node_modules/dsh-pet');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-pet-runtime-')),previousHome=process.env.DSH_HOME,previousFetch=globalThis.fetch;
const originalSpawn=childProcess.spawn,originalHttp=http.request,originalHttps=https.request,originalHttpGet=http.get,originalHttpsGet=https.get,originalConnect=net.connect,originalCreateConnection=net.createConnection,originalTlsConnect=tls.connect;
const fibers=[];let modelCalls=0,networkCalls=0,credentialReads=0,processSpawns=0,passed=false;
process.env.DSH_HOME=temp;
const forbiddenNetwork=()=>{networkCalls++;throw Error('No network permitted in pet verifier');};
globalThis.fetch=forbiddenNetwork;http.request=forbiddenNetwork;https.request=forbiddenNetwork;http.get=forbiddenNetwork;https.get=forbiddenNetwork;net.connect=forbiddenNetwork;net.createConnection=forbiddenNetwork;tls.connect=forbiddenNetwork;
childProcess.spawn=()=>{processSpawns++;throw Error('No desktop helper or dependency process permitted');};syncBuiltinESMExports();
fs.mkdirSync(path.join(temp,'dsh-pet'),{recursive:true});
fs.writeFileSync(path.join(temp,'dsh-pet/main-config.jsonc'),JSON.stringify({voiceEnabled:false,voiceWhisperEnabled:false,voiceTodoEnabled:false,voiceNotifyEnabled:false,whisperImageEnabled:false,chatImageEnabled:false,chatAnimationEnabled:false,notificationsEnabled:false,clickSoundEnabled:false,trayEnabled:false,pets:[{id:'main',name:'Synthetic My Fish',size:260,balanceEnabled:false,whisperEnabled:false,workStatusEnabled:false,fixedEnabled:true,display:'web',position:{corner:'top-right',marginX:24,marginY:100}}]}));
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
try{
 const [{Context},{Loader}]=await Promise.all([hostImport('cordis'),hostImport('cordis-plugin-loader')]);const ctx=new Context();
 const routes=new Map();ctx.provide('webServer',{port:9999,getOrigin:()=> 'http://127.0.0.1:9999',register:entry=>{routes.set(entry.path,entry.handler);return ()=>routes.delete(entry.path);}});
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic',model:'synthetic'})});ctx.provide('credentials',{resolve:()=>{credentialReads++;throw Error('No user credentials permitted');}});
 ctx.provide('llm',new Proxy({}, {get:()=>()=>{modelCalls++;throw Error('No model permitted');}}));ctx.provide('commands',{register:()=>()=>{}});ctx.provide('connection',{});
 const baseUrl=pathToFileURL(path.join(hostRoot,'..','package.json')).href;ctx.baseUrl=baseUrl;
 const {createRuntimeResolution,ProfileRuntimeResolution,PluginPackages}=await hostImport('dsh-app-boot');
 const installAnchor=path.resolve(hostRoot,'..','package.json'),installation=await createRuntimeResolution({installAnchor,home:temp});
 const profileDir=path.join(os.homedir(),'.dsh/profiles/desktop'),petMetadata=JSON.parse(fs.readFileSync(path.join(petRoot,'package.json'),'utf8'));
 // Publish a minimal resolution table explicitly. This does not load the real
 // profile manifest, compose its plugins, read its config, or start app boot.
 const resolution=new ProfileRuntimeResolution({installAnchor,home:temp},{...installation,profilesDir:path.dirname(profileDir),profileDir,localPackageNames:['dsh-pet'],linkedRoots:[],entries:[...installation.entries,{name:'dsh-pet',version:petMetadata.version,scope:'profile',declarer:path.join(profileDir,'package.json'),packageDir:petRoot}]});
 const packages=ctx.plugin(PluginPackages,{resolution});fibers.push(packages);await packages;
 const loader=ctx.plugin(Loader,{baseUrl});fibers.push(loader);await loader;
 const module=await ctx.loader.import(pathToFileURL(path.join(petRoot,'lib/index.js')).href);
 const pet=ctx.plugin(module);fibers.push(pet);await pet;await new Promise(setImmediate);
 const handler=routes.get('/dsh-pet-7340');assert.equal(typeof handler,'function');
 async function invoke(method,endpoint,body){
   const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url='/dsh-pet-7340/'+endpoint;req.headers={'content-type':'application/json'};
   const res=new EventEmitter();res.statusCode=0;res.headers={};res.setHeader=(key,value)=>res.headers[key]=value;res.writeHead=(status,headers)=>{res.statusCode=status;Object.assign(res.headers,headers);};res.end=raw=>{res.raw=String(raw??'');res.writableEnded=true;};
   await handler(req,res);assert.equal(res.statusCode,200,endpoint+' response: '+res.raw);return JSON.parse(res.raw);
 }
 const state=await invoke('GET','state');assert.ok(state.pets&&typeof state.pets==='object');
 const leased=await invoke('POST','lock?pet=main&surface=web',{ttl:10000});assert.equal(leased.ok,true);assert.equal(typeof leased.lockId,'string');
 const key=encodeURIComponent(leased.lockId),text='Synthetic My Fish presentation only';
 const shown=await invoke('POST','broadcast?pet=main&surface=web&lock='+key,{text,duration:5000,anim:false,speak:false});assert.equal(shown.ok,true);
 const accepted=await invoke('GET','state');assert.equal(accepted.pets.main.say.data.text,text);assert.equal(accepted.pets.main.say.data.anim,false);assert.equal(accepted.pets.main.say.data.voiceTo,undefined);
 assert.equal((await invoke('POST','bubble/clear?pet=main&surface=web&lock='+key,{})).ok,true);
 const cleared=await invoke('GET','state');assert.equal(cleared.pets.main.say.data.clear,true);
 assert.equal((await invoke('POST','lock/release?pet=main',{lockId:leased.lockId})).ok,true);const released=await invoke('GET','state');assert.equal(released.pets.main.lock.data.locked,false);
 assert.equal(modelCalls,0);assert.equal(networkCalls,0);assert.equal(credentialReads,0);assert.equal(processSpawns,0);passed=true;
 console.log(JSON.stringify({installedPetRuntime:'passed',version:petMetadata.version,relocatedPeerImports:false,directPackageLoad:'passed',actualRuntimeResolutionHook:'passed',realRouteStateLockBroadcastClearRelease:'passed',acceptedStateContainsSyntheticText:true,defaultAutomaticCallsDisabled:'passed',modelCalls,networkCalls,credentialReads,processSpawns,scope:'Unmodified installed package through actual Cordis Loader and PluginPackages runtime resolution; temporary DSH_HOME and explicit single-package resolution table, synthetic services/routes only; no real profile config, DOM renderer, audio or desktop helper'}));
}finally{
 for(const fiber of fibers.reverse())await fiber.dispose();
 globalThis.fetch=previousFetch;childProcess.spawn=originalSpawn;http.request=originalHttp;https.request=originalHttps;http.get=originalHttpGet;https.get=originalHttpsGet;net.connect=originalConnect;net.createConnection=originalCreateConnection;tls.connect=originalTlsConnect;syncBuiltinESMExports();if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;
 const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temp));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(temp,{recursive:true,force:true});
}
if(!passed)throw Error('Installed pet runtime verification did not complete');
