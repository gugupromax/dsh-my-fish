import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomic, readJSON } from './store.js';

const PROFILE_KEYS=['name','ownerTitle','selfClaim','persona','interests','replyStyle','emojiStyle'];
const SETTING_KEYS=['enabled','intervalMinutes','startHour','endHour','maxRunsDaily','maxCandidates'];
const CATEGORIES=['preference','fact','decision','observation'];
const GOAL_STATUSES=['active','paused','done'];
const SECRET=/(?:["']?(?:auth_token|ct0|cookie|authorization|api[_-]?key|access_token|refresh_token|password|私钥)["']?\s*[:=]\s*\S+|-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----)/i;
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+'格式错误');return value;}
function fields(value,allowed,label){object(value,label);if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error(label+'包含不支持的字段');}
function text(value,label,max,empty=false){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error(label+'必须是'+(empty?'不超过':'1–')+max+'字的文字');return value.trim();}
function noSecret(value){if(SECRET.test(value))throw Error('请勿把 Cookie、密码或私钥写入个人助理记录');return value;}
function timestamp(value,label){if(value===null)return null;if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw Error(label+'必须是有效时间戳或 null');return value;}
function integer(value,label,min,max){if(!Number.isInteger(value)||value<min||value>max)throw Error(label+'超出允许范围');return value;}
function id(value){if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw Error('记录 ID 无效');return value;}
function array(value,label,max){if(!Array.isArray(value)||value.length>max)throw Error(label+'格式或数量错误');return value;}
function enumValue(value,values,label){if(!values.includes(value))throw Error(label+'无效');return value;}
function lookup(rows,value,label){id(value);const row=rows.find(item=>item.id===value);if(!row)throw Error(label+'不存在，不能用旧 ID 新建记录');return row;}
function terms(query){
  const value=query.normalize('NFKC').toLowerCase(),out=new Set(value.match(/[\p{L}\p{N}]+/gu)||[]);
  for(const chunk of value.match(/[\p{Script=Han}]+/gu)||[]){for(let i=0;i<chunk.length-1;i++)out.add(chunk.slice(i,i+2));}
  return [...out].filter(item=>item.length>1||/[\p{Script=Han}]/u.test(item));
}
function validProfile(value){
  object(value,'角色');const result={id:'default'};
  const preserve=(input,label,max,empty=false)=>{noSecret(text(input,label,max,empty));return input;};
  for(const key of ['name','ownerTitle','selfClaim'])result[key]=preserve(value[key],key,80);
  result.persona=preserve(value.persona,'人设',20000,true);
  result.interests=array(value.interests,'兴趣',10).map(value=>preserve(value,'兴趣',300));
  result.replyStyle=enumValue(value.replyStyle===undefined?'default':value.replyStyle,['default','concise','natural','formal'],'说话风格');
  result.emojiStyle=enumValue(value.emojiStyle===undefined?'default':value.emojiStyle,['default','none','moderate'],'表情符号设置');
  return result;
}
function validSettings(value){
  object(value,'作息');if(typeof value.enabled!=='boolean')throw Error('自主唤醒必须是开关');
  const result={enabled:value.enabled};
  for(const [key,min,max] of [['intervalMinutes',30,1440],['startHour',0,23],['endHour',1,24],['maxRunsDaily',1,12],['maxCandidates',1,20]])result[key]=integer(value[key],key,min,max);
  result.snoozeUntil=value.snoozeUntil===undefined?null:timestamp(value.snoozeUntil,'临时暂停截止时间');
  if(result.startHour===result.endHour)throw Error('作息起止时间不能相同');return result;
}
function link(value){
  fields(value,['title','url'],'原帖链接');const raw=noSecret(text(value.url,'链接',2000));let url;
  try{url=new URL(raw);}catch{throw Error('链接网址无效');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('链接只接受不含账号密码的 HTTP(S) 网址');
  for(const key of url.searchParams.keys())if(/^(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|token|secret)$/i.test(key))throw Error('链接不能包含凭据参数');
  try{noSecret(decodeURIComponent(url.hash));}catch(error){if(error instanceof URIError)throw Error('链接片段编码无效');throw error;}
  return {title:value.title===undefined?'':noSecret(text(value.title,'链接标题',200,true)),url:url.href};
}
function canonicalLinks(links){
  return [...new Set(links.map(item=>{
    const url=new URL(item.url),isX=/^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/i.test(url.hostname);
    const post=isX&&url.pathname.match(/\/status\/(\d+)(?:\/|$)/);if(post)return 'x:status:'+post[1];
    url.hash='';if(isX)url.hostname='x.com';
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(?:fbclid|gclid|ref_src|ref_url)$/i.test(key)||(isX&&/^(?:s|t)$/i.test(key)))url.searchParams.delete(key);
    url.searchParams.sort();return url.href;
  }))].sort();
}
function recordTime(value,label){if(value===null)throw Error(label+'必须是有效时间戳');return timestamp(value,label);}

/** Local personal context. Reading does not migrate files or touch platform credentials. */
export class AssistantStore {
  constructor(legacyStore){if(typeof legacyStore?.file!=='function'||typeof legacyStore?.config!=='function')throw Error('需要旧版数据存储');this.legacy=legacyStore;}
  get root(){return this.legacy.file('assistant');}
  file(name){return path.join(this.root,name);}
  initialize(){
    const initial=[['profile.json',()=>this.profile()],['settings.json',()=>this.settings()],['memories.json',()=>[]],['goals.json',()=>[]],['inbox.json',()=>[]]];
    for(const [name,fallback] of initial)if(!fs.existsSync(this.file(name)))atomic(this.file(name),fallback());
    return this;
  }
  profile(){const saved=readJSON(this.file('profile.json'),null),base=saved??this.legacy.config();return validProfile(base);}
  saveProfile(input){fields(input,['id',...PROFILE_KEYS],'角色');if(input.id!==undefined&&input.id!=='default')throw Error('当前只支持 default 角色');const value=validProfile({...this.profile(),...input});this.initialize();atomic(this.file('profile.json'),value);return value;}
  settings(){return validSettings(readJSON(this.file('settings.json'),null)??this.legacy.config());}
  saveSettings(input){fields(input,SETTING_KEYS,'作息');const value=validSettings({...this.settings(),...input});this.initialize();atomic(this.file('settings.json'),value);return value;}
  snooze(preset,now=Date.now()){
    enumValue(preset,['two-hours','today','resume'],'临时免打扰选项');recordTime(now,'当前时间');
    let snoozeUntil=null;
    if(preset==='two-hours')snoozeUntil=now+2*60*60*1000;
    else if(preset==='today'){const tomorrow=new Date(now);tomorrow.setHours(24,0,0,0);snoozeUntil=tomorrow.getTime();}
    const value=validSettings({...this.settings(),snoozeUntil});this.initialize();atomic(this.file('settings.json'),value);return value;
  }
  _rows(name,max){
    const rows=array(readJSON(this.file(name),[]),name,max),seen=new Set();
    return rows.map(row=>{
      object(row,name);id(row.id);if(seen.has(row.id))throw Error(name+'存在重复 ID');seen.add(row.id);
      const base={id:row.id,createdAt:recordTime(row.createdAt,'创建时间')};
      if(name==='memories.json'){
        fields(row,['id','text','category','source','expiresAt','createdAt','updatedAt'],name);
        return {...base,text:noSecret(text(row.text,'记忆正文',2000)),category:enumValue(row.category,CATEGORIES,'记忆分类'),source:noSecret(text(row.source,'记忆来源',1000)),expiresAt:timestamp(row.expiresAt,'过期时间'),updatedAt:recordTime(row.updatedAt,'更新时间')};
      }
      if(name==='goals.json'){
        fields(row,['id','title','detail','status','mode','nextCheckAt','progress','source','createdAt','updatedAt'],name);
        return {...base,title:noSecret(text(row.title,'目标标题',200)),detail:noSecret(text(row.detail,'目标说明',4000,true)),status:enumValue(row.status,GOAL_STATUSES,'目标状态'),mode:enumValue(row.mode,['watch','task'],'目标类型'),nextCheckAt:timestamp(row.nextCheckAt,'下次跟进时间'),progress:noSecret(text(row.progress,'目标进展',2000,true)),source:noSecret(text(row.source,'目标来源',1000)),updatedAt:recordTime(row.updatedAt,'更新时间')};
      }
      fields(row,['id','title','body','links','key','createdAt','readAt'],name);
      return {...base,title:noSecret(text(row.title,'动态标题',200)),body:noSecret(text(row.body,'动态正文',8000)),links:array(row.links,'动态链接',20).map(link),key:noSecret(text(row.key,'动态去重标识',200)),readAt:timestamp(row.readAt,'已读时间')};
    });
  }
  _memories(){return this._rows('memories.json',2000);}
  memories(query='',limit=20){
    query=text(query,'检索词',500,true);integer(limit,'检索条数',1,2000);const now=Date.now(),tokens=terms(query);
    return this._memories().filter(row=>row.expiresAt===null||row.expiresAt>now).map(row=>{
      const value=(row.text+' '+row.source).normalize('NFKC').toLowerCase();
      const score=query?(value.includes(query.normalize('NFKC').toLowerCase())?100:0)+tokens.reduce((sum,token)=>sum+(value.includes(token)?token.length:0),0):0;
      return {row,score};
    }).filter(item=>!query||item.score>0).sort((a,b)=>b.score-a.score||b.row.updatedAt-a.row.updatedAt).slice(0,limit).map(item=>structuredClone(item.row));
  }
  remember(input){
    fields(input,['id','text','category','source','expiresAt'],'记忆');const rows=this._memories(),old=input.id===undefined?null:lookup(rows,input.id,'记忆');
    const merged={...old,...input},value={text:noSecret(text(merged.text,'记忆正文',2000)),category:enumValue(merged.category??'observation',CATEGORIES,'记忆分类'),source:noSecret(text(merged.source,'记忆来源',1000)),expiresAt:timestamp(merged.expiresAt??null,'过期时间')};
    const now=Date.now(),matches=rows.filter(row=>row.id!==old?.id&&row.text===value.text),duplicate=matches.find(row=>row.expiresAt===null||row.expiresAt>now);
    if(duplicate){
      if(old)throw Error('已有相同正文的记忆，请更新已有记录');
      if(Object.hasOwn(input,'expiresAt')&&value.expiresAt!==duplicate.expiresAt)throw Error('已有相同正文的记忆，请按原 ID 纠正有效期');
      return structuredClone(duplicate);
    }
    if(!old&&matches.length&&(!Object.hasOwn(input,'expiresAt')||(value.expiresAt!==null&&value.expiresAt<=now)))throw Error('同正文的旧记忆已过期，请明确新的有效期或选择长期保留');
    if(!old&&rows.length>=2000)throw Error('记忆已达 2000 条，请先整理');
    const row={id:old?.id??crypto.randomUUID(),...value,createdAt:old?.createdAt??now,updatedAt:now};
    this.initialize();atomic(this.file('memories.json'),old?rows.map(item=>item.id===old.id?row:item):[...rows,row]);return structuredClone(row);
  }
  forget(value){const rows=this._memories();lookup(rows,value,'记忆');this.initialize();atomic(this.file('memories.json'),rows.filter(row=>row.id!==value));return {ok:true,id:value};}
  goals(status='active'){if(status!=='all')enumValue(status,GOAL_STATUSES,'目标状态');return this._rows('goals.json',100).filter(row=>status==='all'||row.status===status).map(row=>structuredClone(row));}
  saveGoal(input){
    fields(input,['id','title','detail','status','mode','nextCheckAt','progress','source'],'目标');const rows=this.goals('all'),old=input.id===undefined?null:lookup(rows,input.id,'目标'),merged={...old,...input};
    const value={title:noSecret(text(merged.title,'目标标题',200)),detail:noSecret(text(merged.detail??'','目标说明',4000,true)),status:enumValue(merged.status??'active',GOAL_STATUSES,'目标状态'),mode:enumValue(merged.mode??'watch',['watch','task'],'目标类型'),nextCheckAt:timestamp(merged.nextCheckAt??null,'下次跟进时间'),progress:noSecret(text(merged.progress??'','目标进展',2000,true)),source:noSecret(text(merged.source??'用户设置','目标来源',1000))};
    if(!old&&rows.length>=100)throw Error('目标已达 100 条，请先整理');const now=Date.now(),row={id:old?.id??crypto.randomUUID(),...value,createdAt:old?.createdAt??now,updatedAt:now};
    this.initialize();atomic(this.file('goals.json'),old?rows.map(item=>item.id===old.id?row:item):[...rows,row]);return structuredClone(row);
  }
  deleteGoal(value){const rows=this.goals('all');lookup(rows,value,'目标');this.initialize();atomic(this.file('goals.json'),rows.filter(row=>row.id!==value));return {ok:true,id:value};}
  dueGoals(now=Date.now()){timestamp(now,'当前时间');return this.goals().filter(row=>row.nextCheckAt===null||row.nextCheckAt<=now).sort((a,b)=>(a.nextCheckAt??0)-(b.nextCheckAt??0)||a.updatedAt-b.updatedAt).slice(0,20);}
  notices(){return this._rows('inbox.json',200).map(row=>structuredClone(row)).sort((a,b)=>b.createdAt-a.createdAt);}
  addNotice(input){
    fields(input,['title','body','links','key'],'动态');const value={title:noSecret(text(input.title,'动态标题',200)),body:noSecret(text(input.body,'动态正文',8000)),links:array(input.links??[],'动态链接',20).map(link)};
    const urls=canonicalLinks(value.links),dedupValue=urls.length?{urls}:value;
    const key=input.key===undefined?crypto.createHash('sha256').update(JSON.stringify(dedupValue)).digest('hex'):noSecret(text(input.key,'动态去重标识',200));
    const rows=this.notices(),existing=rows.find(row=>row.key===key);if(existing)return {notice:existing,deduplicated:true};
    const row={id:crypto.randomUUID(),...value,key,createdAt:Date.now(),readAt:null};this.initialize();atomic(this.file('inbox.json'),[row,...rows].slice(0,200));return {notice:structuredClone(row),deduplicated:false};
  }
  readNotice(value){const rows=this.notices(),old=lookup(rows,value,'动态'),row={...old,readAt:old.readAt??Date.now()};this.initialize();atomic(this.file('inbox.json'),rows.map(item=>item.id===value?row:item));return structuredClone(row);}
  snapshot(){const memories=this.memories('',2000),goals=this.goals('all'),inbox=this.notices();return {profile:this.profile(),settings:this.settings(),memories,goals,inbox,stats:{memoryCount:memories.length,activeGoals:goals.filter(row=>row.status==='active').length,unread:inbox.filter(row=>row.readAt===null).length}};}
  context(query='',limit=8){
    const profile=this.profile(),due=this.dueGoals();
    return {profile:{...profile,persona:profile.persona.slice(0,3000)},personaTruncated:profile.persona.length>3000,memories:this.memories(query,limit),goals:due.slice(0,5),moreDueGoals:due.length>5,recentNotices:this.notices().slice(0,10).map(({id,title,links,createdAt})=>({id,title,links,createdAt}))};
  }
}
