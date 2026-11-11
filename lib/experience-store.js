import crypto from 'node:crypto';
import {atomic,readJSON} from './store.js';

const LIMITS={interests:30,active:5,episodes:120,tombstones:2000,context:16000};
const EMPTY={version:1,interests:[],episodes:[],tombstones:{interestIds:[],episodeIds:[]}};
const STATUSES=['active','paused','settled'];
const INPUT=['id','runId','mainSessionId','interestId','title','question','before','thought','reason','nextQuestion','sources','origin'];
const SOURCE=['id','platform','operation','reference','url','title','excerpt','scope','truncated','readAt','sessionId'];
const INTEREST=['id','mainSessionId','title','question','currentThought','nextQuestion','origin','status','createdAt','updatedAt','userPositions'];
const EPISODE=['id','runId','mainSessionId','interestId','title','question','before','thought','reason','nextQuestion','sources','origin','at','fingerprint'];
const SECRET=/(?:["']?(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token|私钥)["']?\s*[:=]\s*["']?[^\s"',;}&]+|bearer\s+[a-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const LOCAL_PATH=/(?:(?:^|[^a-z0-9])[a-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|\s)\/(?:home|users|mnt)\/)/i;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>structuredClone(value);
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw Error('经历记录包含无效字段');}
function decoded(value){let result=value.normalize('NFKC');for(let i=0;i<3;i++){try{const next=decodeURIComponent(result);if(next===result)break;result=next;}catch{break;}}return result;}
function text(value,max,empty=false){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('经历文字格式或长度无效');const normalized=decoded(value);if(SECRET.test(normalized)||LOCAL_PATH.test(normalized))throw Error('经历疑似包含凭据或本机路径');return value.trim();}
function id(value){const result=text(value,200);if(!/^[\w:.-]+$/.test(result))throw Error('经历标识无效');return result;}
function time(value){if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw Error('经历时间无效');return value;}
function option(value,values){if(!values.includes(value))throw Error('经历选项无效');return value;}
function array(value,max){if(!Array.isArray(value)||value.length>max)throw Error('经历数量或格式无效');return value;}
function distinct(rows){if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('经历存在重复标识');return rows;}
function publicUrl(value){const raw=text(value,2000);let parsed;try{parsed=new URL(raw);}catch{throw Error('经历来源链接无效');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)throw Error('经历来源必须是无凭据的HTTPS链接');const host=parsed.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)||host.startsWith('['))throw Error('经历来源不能是本机或私网');for(const key of parsed.searchParams.keys())if(/token|cookie|password|secret|api[_-]?key|authorization/i.test(decoded(key)))throw Error('经历来源链接包含敏感参数');if(SECRET.test(decoded(parsed.hash)))throw Error('经历来源链接包含敏感片段');return parsed.href;}
function source(value){fields(value,SOURCE);const platform=text(value.platform,64);if(!/^[a-z][a-z0-9_-]*$/.test(platform)||typeof value.truncated!=='boolean')throw Error('经历来源格式无效');return {id:id(value.id),platform,operation:option(value.operation,['read','comments','timeline']),reference:text(value.reference,2000),url:publicUrl(value.url),title:text(value.title,300,true),excerpt:text(value.excerpt,1500,true),scope:text(value.scope,1000),truncated:value.truncated,readAt:time(value.readAt),...(value.sessionId===undefined?{}:{sessionId:id(value.sessionId)})};}
function position(value){fields(value,['messageId','quote','at']);return {messageId:id(value.messageId),quote:text(value.quote,500),at:time(value.at)};}
function interest(value){fields(value,INTEREST);return {id:id(value.id),mainSessionId:id(value.mainSessionId),title:text(value.title,150),question:text(value.question,500),currentThought:text(value.currentThought,1500),nextQuestion:text(value.nextQuestion,500,true),origin:option(value.origin,['fish','shared']),status:option(value.status,STATUSES),createdAt:time(value.createdAt),updatedAt:time(value.updatedAt),userPositions:array(value.userPositions??[],6).map(position)};}
function episode(value){fields(value,EPISODE);const sources=distinct(array(value.sources,6).map(source));if(!sources.length||!/^[a-f0-9]{64}$/.test(value.fingerprint))throw Error('经历必须保留来源与请求校验');return {id:id(value.id),runId:id(value.runId),mainSessionId:id(value.mainSessionId),interestId:id(value.interestId),title:text(value.title,150),question:text(value.question,500),before:text(value.before,1500,true),thought:text(value.thought,1500),reason:text(value.reason,1000),nextQuestion:text(value.nextQuestion,500,true),sources,origin:option(value.origin,['fish','shared']),at:time(value.at),fingerprint:value.fingerprint};}
function state(value){fields(value,['version','interests','episodes','tombstones']);if(value.version!==1)throw Error('经历文件版本不支持');fields(value.tombstones,['interestIds','episodeIds']);const interests=distinct(array(value.interests,LIMITS.interests).map(interest)),episodes=distinct(array(value.episodes,LIMITS.episodes).map(episode)),interestIds=array(value.tombstones.interestIds,LIMITS.tombstones).map(id),episodeIds=array(value.tombstones.episodeIds,LIMITS.tombstones).map(id);if(new Set(interestIds).size!==interestIds.length||new Set(episodeIds).size!==episodeIds.length||interests.filter(row=>row.status==='active').length>LIMITS.active||interests.some(row=>interestIds.includes(row.id))||episodes.some(row=>episodeIds.includes(row.id)||!interests.some(topic=>topic.id===row.interestId&&topic.mainSessionId===row.mainSessionId)))throw Error('经历记录归属或数量不一致');return {version:1,interests,episodes,tombstones:{interestIds,episodeIds}};}
function input(value,now){fields(value,INPUT);const sources=distinct(array(value.sources,6).map(source));if(!sources.length||sources.some(row=>row.readAt>now+60000))throw Error('经历必须引用实际读取时间的来源');return {id:id(value.id),runId:id(value.runId),mainSessionId:id(value.mainSessionId),interestId:value.interestId===undefined?null:id(value.interestId),title:text(value.title,150),question:text(value.question,500),before:value.before===undefined?null:text(value.before,1500,true),thought:text(value.thought,1500),reason:text(value.reason,1000),nextQuestion:text(value.nextQuestion??'',500,true),sources,origin:option(value.origin,['fish','shared'])};}

/** Source-backed role experiences; does not read or rewrite personal facts. */
export class ExperienceStore {
  constructor(store,{now=Date.now}={}){if(typeof store?.file!=='function'||typeof now!=='function')throw Error('需要经历存储与时钟');this.store=store;this.now=now;}
  file(){return this.store.file('assistant/experiences.json');}
  state(){return state(readJSON(this.file(),EMPTY));}
  _save(value){const checked=state(value);atomic(this.file(),checked);return checked;}
  interests(mainSessionId){return copy(this.state().interests.filter(row=>mainSessionId===undefined||row.mainSessionId===mainSessionId));}
  episodes(mainSessionId){return copy(this.state().episodes.filter(row=>mainSessionId===undefined||row.mainSessionId===mainSessionId));}
  record(value){
    const now=time(this.now()),request=input(value,now),fingerprint=digest(request),data=this.state(),existing=data.episodes.find(row=>row.id===request.id);
    if(existing){if(existing.fingerprint!==fingerprint)throw Error('同一经历标识不能更改内容');return {interest:copy(data.interests.find(row=>row.id===existing.interestId)),episode:copy(existing),deduplicated:true};}
    if(data.tombstones.episodeIds.includes(request.id))throw Error('该经历已删除或退出保留范围，不能用旧标识恢复');
    let topic=request.interestId?data.interests.find(row=>row.id===request.interestId&&row.mainSessionId===request.mainSessionId):null;
    if(request.interestId&&!topic)throw Error('兴趣不存在或不属于当前主会话，不能用旧标识恢复');
    if(topic&&topic.status!=='active')throw Error('该兴趣已放下，请先明确恢复');
    if(topic&&request.before!==null&&request.before!==topic.currentThought)throw Error('兴趣看法已变化，请核对后再记录');
    if(!topic&&request.before)throw Error('新兴趣没有此前看法，不能编造旧经历');
    const previousThought=topic?.currentThought??'';
    if(!topic){if(data.interests.length>=LIMITS.interests||data.interests.filter(row=>row.status==='active').length>=LIMITS.active)throw Error('兴趣数量已满，请先暂停或整理');topic={id:crypto.randomUUID(),mainSessionId:request.mainSessionId,title:request.title,question:request.question,currentThought:request.thought,nextQuestion:request.nextQuestion,origin:request.origin,status:'active',createdAt:now,updatedAt:now,userPositions:[]};data.interests.push(topic);}
    const created={...request,interestId:topic.id,before:request.before??previousThought,at:now,fingerprint};
    topic.title=request.title;topic.question=request.question;topic.currentThought=request.thought;topic.nextQuestion=request.nextQuestion;topic.updatedAt=now;
    data.episodes.push(created);if(data.episodes.length>LIMITS.episodes)data.tombstones.episodeIds.push(data.episodes.shift().id);
    this._save(data);return {interest:copy(topic),episode:copy(created),deduplicated:false};
  }
  setInterest(interestId,status){const data=this.state(),topic=data.interests.find(row=>row.id===id(interestId));if(!topic)throw Error('兴趣不存在');option(status,STATUSES);if(topic.status!==status&&status==='active'&&data.interests.filter(row=>row.status==='active').length>=LIMITS.active)throw Error('活动兴趣已满');if(topic.status!==status){topic.status=status;topic.updatedAt=time(this.now());this._save(data);}return copy(topic);}
  // The caller must first verify this message and verbatim quote against the
  // actual main-session user event; a source ID alone is not user evidence.
  respond(value,mainSessionId){fields(value,['interestId','messageId','quote','at']);const data=this.state(),topic=data.interests.find(row=>row.id===id(value.interestId)&&row.mainSessionId===id(mainSessionId));if(!topic)throw Error('兴趣不存在或不属于当前主会话');const created=position({messageId:value.messageId,quote:value.quote,at:value.at});if(created.at>this.now()+60000)throw Error('用户回应时间不能在未来');const existing=topic.userPositions.find(row=>row.messageId===created.messageId&&row.quote===created.quote);if(existing){if(existing.at!==created.at)throw Error('用户回应标识对应的时间不一致');return copy(topic);}topic.userPositions.push(created);topic.userPositions=topic.userPositions.slice(-6);topic.updatedAt=time(this.now());this._save(data);return copy(topic);}
  forget(interestId){const data=this.state(),topic=data.interests.find(row=>row.id===id(interestId));if(!topic){if(data.tombstones.interestIds.includes(interestId))return {ok:true,id:interestId};throw Error('兴趣不存在');}data.tombstones.interestIds.push(topic.id);data.tombstones.episodeIds.push(...data.episodes.filter(row=>row.interestId===topic.id).map(row=>row.id));data.interests=data.interests.filter(row=>row!==topic);data.episodes=data.episodes.filter(row=>row.interestId!==topic.id);this._save(data);return {ok:true,id:topic.id};}
  chooseInterest({random=Math.random,mainSessionId}={}){
    if(typeof mainSessionId!=='string'||!mainSessionId)return null;
    const rows=this.interests(mainSessionId).filter(row=>row.status==='active').sort((a,b)=>(Number(!!b.nextQuestion)-Number(!!a.nextQuestion))||a.updatedAt-b.updatedAt);
    if(!rows.length)return null;const draw=random();if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('探索随机值无效');if(draw<0.25&&this.state().interests.filter(row=>row.status==='active').length<LIMITS.active)return null;
    // Unresolved, less recently updated topics receive the largest weights.
    const weights=rows.map((row,index)=>(rows.length-index)*(row.nextQuestion?2:1)),total=weights.reduce((a,b)=>a+b,0);let cursor=((draw<0.25?draw:draw-0.25)/0.75)*total;for(let i=0;i<rows.length;i++){cursor-=weights[i];if(cursor<0)return copy(rows[i]);}return copy(rows.at(-1));
  }
  context(query,mainSessionId){
    if(typeof mainSessionId!=='string'||!mainSessionId)return {interests:[],episodes:[]};
    const data=this.state(),terms=typeof query==='string'?query.normalize('NFKC').toLowerCase().split(/[\s，。！？、,.;:!?]+/).filter(part=>part.length>=2).slice(0,12):[];
    const score=row=>terms.reduce((sum,term)=>sum+Number((row.title+' '+(row.question??'')+' '+(row.thought??row.currentThought??'')).normalize('NFKC').toLowerCase().includes(term)),0);
    const allowed=data.interests.filter(row=>row.mainSessionId===mainSessionId&&row.status==='active'),ids=new Set(allowed.map(row=>row.id)),result={interests:[],episodes:[]};
    const append=(key,row)=>{result[key].push(row);if(JSON.stringify(result).length>LIMITS.context){result[key].pop();return false;}return true;};
    for(const row of allowed.sort((a,b)=>score(b)-score(a)||b.updatedAt-a.updatedAt).slice(0,3))append('interests',copy(row));
    for(const row of data.episodes.filter(row=>row.mainSessionId===mainSessionId&&ids.has(row.interestId)).sort((a,b)=>score(b)-score(a)||b.at-a.at).slice(0,4)){
      const {fingerprint,...visible}=row;append('episodes',{...copy(visible),before:visible.before.slice(0,500),thought:visible.thought.slice(0,800),reason:visible.reason.slice(0,500),sources:visible.sources.slice(0,3).map(({excerpt,...source})=>({...source,excerpt:excerpt.slice(0,400)}))});
    }
    return result;
  }
}
