import crypto from 'node:crypto';
import {atomic,readJSON} from './store.js';

const DEFAULT_ACTIONS=Object.freeze({enabled:false,thinking:'',reading:''});
const DEFAULTS={enabled:false,mode:'pet',petId:'',surface:'desktop',speak:false,animation:'',activityActions:DEFAULT_ACTIONS};
const TERMINAL=new Set(['accepted','unknown','cancelled','rejected']);
const READ_TOOLS=new Set(['social_search','social_read','social_comments','social_discover','social_timeline','assistant_video','web_search','web_fetch','read']);
const DIAGNOSTIC={disabled:'未启用',unconfigured:'未填写动作名称',busy:'桌宠忙碌，本次跳过',too_long:'回复超过1600字，本次未表达',empty:'没有可表达的文字',sensitive:'内容可能包含敏感信息，本次未表达',pending:'正在请求',accepted:'接口已受理，实际显示或播放尚未确认',unknown:'连接失败或结果未知，未自动重试',cancelled:'本次表达已取消',full:'表达记录已满，请检查设置'};
const SECRET=/(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const sessionId=value=>value?.id??value?.header?.id;
async function responseText(response,max){
  if(!response.body?.getReader){const raw=await response.text();if(raw.length>max)throw Error('桌宠响应过大');return raw;}
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('桌宠响应过大');}parts.push(value);}return Buffer.concat(parts).toString('utf8');}finally{reader.releaseLock();}
}
function settings(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(DEFAULTS,key)))throw Error('桌宠设置字段无效');
  const value={...DEFAULTS,...input};
  if(typeof value.enabled!=='boolean'||typeof value.speak!=='boolean'||!['pet','browser','both'].includes(value.mode)||!['web','desktop'].includes(value.surface)||typeof value.petId!=='string'||value.petId.length>64||/[<>:"/\\|?*\u0000-\u001f]/.test(value.petId)||value.petId!==value.petId.trim())throw Error('桌宠设置格式无效');
  if(typeof value.animation!=='string'||value.animation.length>100||/[\/\\\u0000-\u001f]/.test(value.animation)||SECRET.test(value.animation))throw Error('动画只接受已配置的池内名称');
  const actions=value.activityActions;if(!actions||typeof actions!=='object'||Array.isArray(actions)||Object.keys(actions).some(key=>!Object.hasOwn(DEFAULT_ACTIONS,key)))throw Error('状态动作设置格式无效');
  value.activityActions={...DEFAULT_ACTIONS,...actions};if(typeof value.activityActions.enabled!=='boolean'||['thinking','reading'].some(key=>typeof value.activityActions[key]!=='string'||value.activityActions[key].length>100||/[\/\\\u0000-\u001f]/.test(value.activityActions[key])||SECRET.test(value.activityActions[key])))throw Error('状态动作只接受已配置的池内名称');
  if(value.enabled&&['pet','both'].includes(value.mode)&&!value.petId)throw Error('请先填写已存在的桌宠ID');
  if(value.enabled&&value.mode==='both'&&value.speak)throw Error('同时启用浏览器朗读时，请关闭桌宠自身朗读以免重复播放');
  return value;
}

/** Optional local presentation only: never asks the pet to generate another reply. */
export class PresentationBridge {
  constructor({store,getBaseUrl=()=>null,fetchImpl=globalThis.fetch,now=Date.now,logger,timeoutMs=5000,durationMs=15000}={}){
    Object.assign(this,{store,getBaseUrl,fetchImpl,now,logger,timeoutMs,durationMs});this.tail=Promise.resolve();this.epoch=0;this.lease=null;this.active=null;this.disposed=false;this.speechItems=[];this.speechSeq=0;this.speechMain=null;this.activityGeneration=0;this.activityTurn=null;this.activitySession=null;this.activitySeen=new Set();this.activityRoots=new Set();this.activityController=null;this.activityTask=null;this.presentationPending=0;this.diagnostics={};this.diagnosticSeq=0;
  }
  diagnostic(main,kind,code,token){if(!main||main!==this.store.state().sessionId||!DIAGNOSTIC[code])return null;const previous=this.diagnostics[kind];if(token!==undefined&&(!previous||previous.token!==token||previous.main!==main))return null;const value={main,token:token??++this.diagnosticSeq,code,at:this.now()};this.diagnostics[kind]=value;return value.token;}
  file(){return this.store.file('assistant/presentation.json');}
  archiveFile(){return this.store.file('assistant/presentation-archive.json');}
  archive(){const data=readJSON(this.archiveFile(),{version:1,deliveries:[]});if(data?.version!==1||!Array.isArray(data.deliveries)||data.deliveries.some(row=>!row||typeof row.key!=='string'||!TERMINAL.has(row.status)))throw Error('桌宠历史记录格式无效');return data;}
  compact(data){
    if(data.deliveries.length<5000)return;
    const removable=data.deliveries.filter(row=>['accepted','cancelled','rejected'].includes(row.status)).slice(0,Math.max(1,data.deliveries.length-4500));if(!removable.length)return;
    const archive=this.archive(),keys=new Set(archive.deliveries.map(row=>row.key));for(const row of removable)if(!keys.has(row.key)){archive.deliveries.push({key:row.key,status:row.status});keys.add(row.key);}
    // Archive first: interruption can leave duplicates, but cannot lose a deduplication key.
    atomic(this.archiveFile(),archive);const moved=new Set(removable);data.deliveries=data.deliveries.filter(row=>!moved.has(row));
  }
  state(){
    const data=readJSON(this.file(),{version:1,settings:{...DEFAULTS},deliveries:[]});
    if(data?.version!==1||!Array.isArray(data.deliveries)||data.deliveries.length>5000||data.deliveries.some(row=>!row||typeof row.key!=='string'||typeof row.sessionId!=='string'||typeof row.messageId!=='string'||!['prepared',...TERMINAL].includes(row.status)))throw Error('桌宠联动记录格式无效');
    return {...data,settings:settings(data.settings)};
  }
  settings(){return this.state().settings;}
  saveSettings(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('桌宠设置字段无效');
    const current=this.state(),value=settings({...current.settings,...input});
    void this.stop().catch(()=>{});this.diagnostics={};current.settings=value;atomic(this.file(),current);return value;
  }
  base(){
    const raw=this.getBaseUrl();if(typeof raw!=='string'||!raw)return null;
    let value;try{value=new URL(raw);}catch{throw Error('本机桌宠连接地址无效');}
    if(value.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(value.hostname)||value.username||value.password||value.search||value.hash||value.pathname!=='/')throw Error('桌宠仅允许连接可信本机DSH服务');
    return value.origin;
  }
  snapshot(){const data=this.state(),main=this.store.state().sessionId,own=data.deliveries.filter(row=>main&&row.sessionId===main);let baseReady=false;try{baseReady=!!this.base();}catch{}const browser=data.settings.mode==='browser',both=data.settings.mode==='both',diagnostics={};for(const kind of ['reply','activity']){const row=this.diagnostics[kind];if(row&&row.main===main)diagnostics[kind]={code:row.code,note:DIAGNOSTIC[row.code],at:row.at};else if(!data.settings.enabled||(kind==='activity'&&!data.settings.activityActions.enabled))diagnostics[kind]={code:'disabled',note:DIAGNOSTIC.disabled};else diagnostics[kind]={code:'unchecked',note:'尚无本会话结果'};}return {ok:true,settings:data.settings,baseReady,dependency:both?'dsh-pet-and-browser-local-speech':browser?'browser-local-speech':'dsh-pet',connection:own.at(-1)?.status??'unchecked',audioStopSupported:browser||both,maxChars:1600,last:own.slice(-3).map(({status,at,reason})=>({status,at,reason:reason??''})),diagnostics,note:both?'使用桌宠气泡和浏览器本地中文音色；接口受理或排队不代表实际显示或播放。':browser?'使用浏览器消费者选择的本地音色。accepted仅表示已排入内存队列；停止通过epoch通知浏览器执行，不证明声音实际播放。':'桌宠需另行安装与配置。accepted仅表示接口受理，不证明气泡已显示或声音已播放；当前接口不能保证停止已播放音频。'};}
  speech(after=0,consumerId=null){
    if(!Number.isSafeInteger(after)||after<0)throw Error('语音游标无效');const main=this.store.state().sessionId;
    if(consumerId!==null&&(typeof consumerId!=='string'||!/^[a-zA-Z0-9_-]{8,120}$/.test(consumerId)))throw Error('语音消费者标识无效');
    if(this.speechMain!==main){this.speechItems=[];this.speechMain=main;this.consumer=null;this.epoch++;}
    const config=this.settings(),enabled=!this.disposed&&config.enabled&&['browser','both'].includes(config.mode);
    let claimed=false;
    if(enabled&&consumerId&&(!this.consumer||this.consumer.until<=this.now()||this.consumer.id===consumerId)){this.consumer={id:consumerId,until:this.now()+4000};claimed=true;}
    return {enabled,epoch:this.epoch,seq:this.speechSeq,claimed,leaseMs:4000,items:claimed?this.speechItems.filter(item=>item.seq>after).map(item=>({...item})):[]};
  }
  async check(){
    let timer;const abort=new AbortController();
    try{const base=this.base();if(!base)throw Error('not ready');const response=await Promise.race([this.fetchImpl(base+'/dsh-pet-7340/state',{method:'GET',redirect:'error',signal:abort.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('timeout'));},this.timeoutMs);})]);
      if(!response.ok)throw Error('not accepted');abort.signal.throwIfAborted();const raw=await Promise.race([responseText(response,512000),new Promise((_,reject)=>abort.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))]);const data=JSON.parse(raw);
      if(!data||!Number.isFinite(data.counter)||!data.pets||typeof data.pets!=='object'||Array.isArray(data.pets))return {ok:true,connected:true,pets:[],catalogComplete:false,note:'本机接口已应答，但宠物状态结构尚未核验。'};
      const pets=Object.keys(data.pets).filter(id=>id&&id.length<=64&&!/[<>:"/\\|?*\u0000-\u001f]/.test(id)&&!SECRET.test(id)).slice(0,30).map(id=>({id,name:id}));
      return {ok:true,connected:true,pets,catalogComplete:false,note:'仅列出已有状态的宠物ID，不是完整配置目录；未访问账号、聊天或配置路径，未测试显示与发声。'};
    }catch{return {ok:true,connected:false,pets:[],catalogComplete:false,note:'桌宠接口未就绪或本次检查失败；请确认已安装dsh-pet并重开同一DSH实例。'};}finally{clearTimeout(timer);}
  }
  record(key,patch){if(this.disposed)return;const data=this.state(),row=data.deliveries.find(item=>item.key===key);if(row){Object.assign(row,patch);atomic(this.file(),data);}}
  async request(path,config,body,{lock,signal}={}){
    const base=this.base();if(!base||typeof this.fetchImpl!=='function')throw Error('桌宠依赖或本机服务未就绪');
    const url=new URL('/dsh-pet-7340/'+path,base);url.searchParams.set('pet',config.petId);if(path!=='lock/release')url.searchParams.set('surface',config.surface);if(lock)url.searchParams.set('lock',lock);
    const timeout=new AbortController(),combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;
    let timer;const stopped=new Promise((_,reject)=>{const fail=()=>reject(Error('桌宠请求中断或超时，结果未确认'));combined.addEventListener('abort',fail,{once:true});if(combined.aborted)fail();});
    timer=setTimeout(()=>timeout.abort(),this.timeoutMs);timer.unref?.();
    try{return await Promise.race([(async()=>{combined.throwIfAborted();const response=await this.fetchImpl(url.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:combined});combined.throwIfAborted();if(!response.ok)throw Error('桌宠接口未受理');const text=await responseText(response,32000);combined.throwIfAborted();let result;try{result=JSON.parse(text);}catch{throw Error('桌宠回执无效');}if(result?.ok!==true)throw Error('桌宠拒绝本次联动');return result;})(),stopped]);}
    finally{clearTimeout(timer);}
  }
  cancelActivity({keepTurn=false}={}){this.activityGeneration++;if(this.activityController){this.activityController.abort();const row=this.diagnostics.activity;if(row?.code==='pending')this.diagnostic(row.main,'activity','cancelled',row.token);}if(!keepTurn){this.activityTurn=null;this.activityRoots.clear();}return this.activityTask??Promise.resolve();}
  activity(session,event){
    const main=this.store.state().sessionId,id=sessionId(session),type=event?.type,data=event?.data??{};
    if(this.activitySession&&this.activitySession!==main){void this.cancelActivity().catch(()=>{});this.activitySession=null;}
    if(!main||id!==main)return;
    if(type==='turn/start'){
      if(!Number.isSafeInteger(data.turn)||data.turn<0)return;
      const key=JSON.stringify([main,data.turn]);if(this.activitySeen.has(key))return;
      void this.cancelActivity().catch(()=>{});this.activitySession=main;this.activityTurn=data.turn;this.activitySeen.add(key);if(this.activitySeen.size>100)this.activitySeen.delete(this.activitySeen.values().next().value);
      return this.activityAction('thinking',main,data.turn);
    }
    if(type==='turn/end'){
      if(this.activitySession===main&&Number.isSafeInteger(data.turn)&&data.turn===this.activityTurn)void this.cancelActivity().catch(()=>{});
      return;
    }
    if(type!=='tool/call'&&type!=='tool/ptc-dispatch-start')return;
    if(this.activitySession!==main||this.activityTurn===null)return;
    if(type==='tool/call'){
      if(!Number.isSafeInteger(data.turn)||data.turn!==this.activityTurn||typeof data.callId!=='string'||!data.callId)return;
      this.activityRoots.add(data.callId);if(this.activityRoots.size>100)this.activityRoots.delete(this.activityRoots.values().next().value);
    }else if(typeof data.rootCallId!=='string'||!this.activityRoots.has(data.rootCallId))return;
    if(!READ_TOOLS.has(data.name))return;
    return this.activityAction('reading',main,this.activityTurn);
  }
  activityAction(phase,main,turn){
    const config=this.settings(),key=JSON.stringify([main,turn,phase]);
    if(this.activitySeen.has(key))return;this.activitySeen.add(key);if(this.activitySeen.size>200)this.activitySeen.delete(this.activitySeen.values().next().value);
    const name=config.activityActions[phase];if(!config.enabled||!['pet','both'].includes(config.mode)||!config.activityActions.enabled){this.diagnostic(main,'activity','disabled');return;}if(!name){this.diagnostic(main,'activity','unconfigured');return;}if(this.lease||this.active||this.presentationPending||this.activityTask){this.diagnostic(main,'activity','busy');return;}const diagnosticToken=this.diagnostic(main,'activity','pending');
    const generation=++this.activityGeneration,controller=new AbortController();this.activityController=controller;
    const valid=()=>!this.disposed&&!controller.signal.aborted&&generation===this.activityGeneration&&this.activitySession===main&&this.activityTurn===turn&&this.store.state().sessionId===main;
    const task=(async()=>{let lockId;try{
      const locked=await this.request('lock',config,{ttl:2000},{signal:controller.signal});
      if(typeof locked.lockId!=='string'||!locked.lockId||locked.lockId.length>200){if(valid())this.diagnostic(main,'activity','unknown',diagnosticToken);return;}lockId=locked.lockId;
      if(!valid())return;if(this.lease||this.active||this.presentationPending){this.diagnostic(main,'activity','busy',diagnosticToken);return;}
      await this.request('anim',config,{name},{lock:lockId,signal:controller.signal});if(valid())this.diagnostic(main,'activity','accepted',diagnosticToken);
    }catch{if(valid())this.diagnostic(main,'activity','unknown',diagnosticToken);}
    finally{if(lockId)try{await this.request('lock/release',config,{lockId});}catch{}if(this.activityController===controller)this.activityController=null;}})();
    this.activityTask=task;void task.finally(()=>{if(this.activityTask===task)this.activityTask=null;});return task;
  }
  observe(session,event){
    if(this.disposed)return Promise.resolve({skipped:true});
    if(this.activitySession&&this.activitySession!==this.store.state().sessionId){void this.cancelActivity().catch(()=>{});this.activitySession=null;}
    if(sessionId(session)!==this.store.state().sessionId)return Promise.resolve({skipped:true});
    if(event?.type==='user/message'&&event.data?.source?.kind==='user'&&typeof event.data.source.rpcId==='string'&&event.data.source.rpcId&&!event.data.source.rpcId.startsWith('my-fish-'))return this.stop({keepActivityTurn:true});
    if(['turn/start','turn/end','tool/call','tool/ptc-dispatch-start'].includes(event?.type)){const task=this.activity(session,event);return task??Promise.resolve({skipped:true});}
    if(event?.type!=='assistant/message'||event.data?.interrupted===true||event.data?.message?.source?.kind!=='model')return Promise.resolve({skipped:true});
    const data=this.state(),config=data.settings,main=sessionId(session);if(!config.enabled){this.diagnostic(main,'reply','disabled');return Promise.resolve({skipped:true});}
    const message=event.data.message;if(typeof message.id!=='string'||!message.id||!Array.isArray(message.content))return Promise.resolve({skipped:true});
    const content=message.content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n').trim();
    if(!content||content.length>1600||SECRET.test(content)){this.diagnostic(main,'reply',!content?'empty':content.length>1600?'too_long':'sensitive');return Promise.resolve({skipped:true,reason:'文字为空、过长或包含疑似敏感信息，未转发'});}
    const key=crypto.createHash('sha256').update(JSON.stringify([sessionId(session),message.id])).digest('hex');
    if(data.deliveries.some(row=>row.key===key)||this.archive().deliveries.some(row=>row.key===key))return Promise.resolve({deduplicated:true});
    this.compact(data);
    if(data.deliveries.length>=5000){this.diagnostic(main,'reply','full');return Promise.resolve({skipped:true,reason:'桌宠去重记录已满，请先核对整理'});}
    data.deliveries.push({key,sessionId:sessionId(session),messageId:message.id,status:'prepared',at:this.now()});atomic(this.file(),data);
    if(['browser','both'].includes(config.mode)){
      if(this.speechMain!==sessionId(session)){this.speechItems=[];this.speechMain=sessionId(session);this.epoch++;}
      this.speechItems.push({seq:++this.speechSeq,messageId:message.id,text:content});this.speechItems=this.speechItems.slice(-5);
      if(config.mode==='browser'){this.record(key,{status:'accepted',reason:'已交给浏览器语音队列，实际播放未核验'});this.diagnostic(main,'reply','accepted');return Promise.resolve({ok:true,queued:true});}
    }
    const epoch=this.epoch,diagnosticToken=this.diagnostic(main,'reply','pending'),activity=this.cancelActivity({keepTurn:true});this.presentationPending++;const job=this.tail.then(async()=>{try{await activity;const result=await this.present({key,config,content,epoch,main});this.diagnostic(main,'reply',result.ok?'accepted':result.cancelled?'cancelled':'unknown',diagnosticToken);return result;}catch(error){this.diagnostic(main,'reply','unknown',diagnosticToken);throw error;}});this.tail=job.catch(()=>{});void job.then(()=>this.presentationPending--,()=>this.presentationPending--);return job;
  }
  async present({key,config,content,epoch,main}){
    const valid=()=>!this.disposed&&epoch===this.epoch&&main===this.store.state().sessionId&&this.settings().enabled;
    if(!valid()){this.record(key,{status:'cancelled',reason:'联动已取消或主会话已变化'});return {cancelled:true};}
    // Release our previous lease only; never force-release another plugin's lock.
    await this.release();if(!valid()){this.record(key,{status:'cancelled'});return {cancelled:true};}
    const abort=new AbortController();this.active=abort;
    try{
      const result=await this.request('lock',config,{ttl:Math.max(1000,Math.min(120000,this.durationMs+5000))},{signal:abort.signal});
      if(typeof result.lockId!=='string'||!result.lockId||result.lockId.length>200)throw Error('桌宠未返回有效占用锁');
      this.lease={id:result.lockId,config};if(!valid()){await this.release();this.record(key,{status:'cancelled'});return {cancelled:true};}
      await this.request('broadcast',config,{text:content,duration:this.durationMs,anim:false,speak:config.speak},{lock:this.lease.id,signal:abort.signal});
      this.record(key,{status:'accepted',reason:config.speak?'接口已受理气泡与朗读请求，播放未核验':'接口已受理气泡请求，显示未核验'});
      if(config.animation&&valid())await this.request('anim',config,{name:config.animation},{lock:this.lease.id,signal:abort.signal});
      if(this.lease){clearTimeout(this.releaseTimer);this.releaseTimer=setTimeout(()=>{void this.release().catch(()=>{});},this.durationMs);this.releaseTimer.unref?.();}
      return {ok:true,accepted:true};
    }catch{this.record(key,{status:epoch===this.epoch?'unknown':'cancelled',reason:'联动中断或回执未知，没有重发'});await this.release();return {ok:false,uncertain:true};}
    finally{if(this.active===abort)this.active=null;}
  }
  async release({clear=false}={}){
    clearTimeout(this.releaseTimer);const lease=this.lease;this.lease=null;if(!lease)return;
    if(clear)try{await this.request('bubble/clear',lease.config,{}, {lock:lease.id});}catch{}
    try{await this.request('lock/release',lease.config,{lockId:lease.id});}catch{}
  }
  async stop({keepActivityTurn=false}={}){this.epoch++;this.speechItems=[];this.consumer=null;this.active?.abort();const activity=this.cancelActivity({keepTurn:keepActivityTurn});await Promise.all([this.release({clear:true}),activity]);return {ok:true,pendingCancelled:true,audioStopped:false,note:'已取消待发送内容；浏览器语音将按新epoch停止，桌宠已播放声音需用其自身停止控件。'};}
  async dispose(){if(this.disposed)return;this.disposed=true;await this.stop();}
}
