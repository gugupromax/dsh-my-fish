import crypto from 'node:crypto';
import {atomic,readJSON} from './store.js';

const EMPTY={threads:[],receipts:[],recentUserMessages:[],dispatches:[]};
const STATUSES=['active','paused','settled'];
const OPERATIONS=['search','read','comments','timeline'];
const MAX_RECEIPT_AGE=30*24*60*60*1000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CREDENTIAL=/(?:["']?(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token|私钥)["']?\s*[:=]\s*["']?[^\s"',;}&]+|bearer\s+[a-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const LOCAL_PATH=/(?:(?:^|[^a-z0-9])[a-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|\s)\/(?:home|users|mnt)\/)/i;

function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('陪伴记录格式无效');return value;}
function fields(value,allowed){object(value);if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('陪伴记录包含不支持的字段');}
function array(value,max){if(!Array.isArray(value)||value.length>max)throw Error('陪伴记录数量或格式无效');return value;}
function enumeration(value,allowed){if(!allowed.includes(value))throw Error('陪伴记录选项无效');return value;}
function time(value){if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw Error('陪伴记录时间无效');return value;}
function normalized(value){let text=String(value).normalize('NFKC');for(let i=0;i<3;i++){try{const next=decodeURIComponent(text);if(next===text)break;text=next;}catch{break;}}return text;}
function sensitive(value){const text=normalized(value);return CREDENTIAL.test(text)||LOCAL_PATH.test(text);}
function text(value,max,{empty=false,preserve=false}={}){
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error('陪伴记录文字格式或长度无效');
  if(sensitive(value))throw Error('陪伴记录疑似包含凭据或本机路径，已拒绝保存');
  return preserve?value:value.trim();
}
function opaque(value){const result=text(value,200);if(!/^[\w:.-]+$/.test(result))throw Error('陪伴记录标识无效');return result;}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw Error('兴趣线标识无效');return value;}
function receiptId(value){if(typeof value!=='string'||!value.startsWith('receipt-')||!UUID.test(value.slice(8)))throw Error('已读资料标识无效');return value;}
function url(value){
  const raw=text(value,2000);let parsed;try{parsed=new URL(raw);}catch{throw Error('资料链接无效');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)throw Error('资料链接必须是不含凭据的HTTPS网址');
  if(/^(?:localhost|127(?:\.\d+){3}|\[::1\])$/i.test(parsed.hostname))throw Error('资料链接不能指向本机');
  for(const key of parsed.searchParams.keys())if(/^(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)$/i.test(normalized(key)))throw Error('资料链接不能包含凭据参数');
  if(sensitive(normalized(parsed.hash)))throw Error('资料链接不能包含敏感片段');
  return parsed.href;
}
function source(value){
  fields(value,['id','platform','operation','reference','url','title','excerpt','scope','truncated','sessionId','readAt']);
  const platform=text(value.platform,64);if(!/^[a-z][a-z0-9_-]*$/.test(platform))throw Error('资料渠道标识无效');
  if(typeof value.truncated!=='boolean')throw Error('资料截断状态必须是开关');
  return {id:receiptId(value.id),platform,operation:enumeration(value.operation,OPERATIONS),reference:text(value.reference,2000),url:url(value.url),title:text(value.title,300,{empty:true}),excerpt:text(value.excerpt,1500,{empty:true}),scope:text(value.scope,1000),truncated:value.truncated===true,sessionId:opaque(value.sessionId),readAt:time(value.readAt)};
}
function publicSource(value){const {sessionId,excerpt,reference,...visible}=value;return visible;}
function position(value){fields(value,['messageId','quote','at']);return {messageId:opaque(value.messageId),quote:text(value.quote,500,{preserve:true}),at:time(value.at)};}
function episode(value){
  fields(value,['id','at','runId','before','after','reason','nextQuestion','sourceIds','sources']);
  const sources=array(value.sources,6).map(source),sourceIds=array(value.sourceIds,6).map(receiptId);
  if(new Set(sourceIds).size!==sourceIds.length||sources.length!==sourceIds.length||sources.some((item,index)=>item.id!==sourceIds[index]))throw Error('兴趣线资料引用不一致');
  return {id:uuid(value.id),at:time(value.at),runId:value.runId===null?null:opaque(value.runId),before:text(value.before,1500,{empty:true}),after:text(value.after,1500),reason:text(value.reason,1000),nextQuestion:text(value.nextQuestion,500,{empty:true}),sourceIds,sources};
}
function thread(value){
  fields(value,['id','title','currentThought','openQuestion','nextQuestion','status','origin','createdAt','updatedAt','revision','episodes','userPositions']);
  if(!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('兴趣线版本无效');
  return {id:uuid(value.id),title:text(value.title,150),currentThought:text(value.currentThought,1500,{empty:true}),openQuestion:text(value.openQuestion,500),nextQuestion:text(value.nextQuestion,500,{empty:true}),status:enumeration(value.status,STATUSES),origin:enumeration(value.origin,['fish','user']),createdAt:time(value.createdAt),updatedAt:time(value.updatedAt),revision:value.revision,episodes:array(value.episodes,12).map(episode),userPositions:array(value.userPositions,6).map(position)};
}
function message(value){fields(value,['id','text','sessionId','at']);return {id:opaque(value.id),text:text(value.text,1500,{preserve:true}),sessionId:opaque(value.sessionId),at:time(value.at)};}
function distinct(rows){if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('陪伴记录存在重复标识');return rows;}
function state(value){
  fields(value,['threads','receipts','recentUserMessages','dispatches']);
  const result={threads:distinct(array(value.threads,30).map(thread)),receipts:distinct(array(value.receipts,120).map(source)),recentUserMessages:distinct(array(value.recentUserMessages,30).map(message)),dispatches:array(value.dispatches,100).map(opaque)};
  if(result.threads.filter(item=>item.status==='active').length>5||new Set(result.dispatches).size!==result.dispatches.length)throw Error('陪伴记录数量不一致');
  return result;
}
function viewThread(value,{context=false}={}){
  const episodes=context?value.episodes.slice(-3):value.episodes;
  return {...structuredClone(value),episodes:episodes.map(item=>({...item,sources:item.sources.map(publicSource)})),userPositions:structuredClone(context?value.userPositions.slice(-3):value.userPositions),latestSources:(value.episodes.at(-1)?.sources??[]).map(publicSource),revisions:episodes.map(({before,after,reason,sourceIds,at})=>({before,after,reason,sourceIds:[...sourceIds],at}))};
}
function contextThread(value){
  return {id:value.id,title:value.title,currentThought:value.currentThought.slice(0,800),openQuestion:value.openQuestion.slice(0,250),nextQuestion:value.nextQuestion.slice(0,250),status:value.status,origin:value.origin,revision:value.revision,updatedAt:value.updatedAt,
    latestSources:(value.episodes.at(-1)?.sources??[]).slice(0,3).map(item=>({...publicSource(item),title:item.title.slice(0,160),scope:item.scope.slice(0,400)})),
    revisions:value.episodes.slice(-3).map(({before,after,reason,sourceIds,at})=>({before:before.slice(0,400),after:after.slice(0,400),reason:reason.slice(0,250),sourceIds:[...sourceIds],at})),
    userPositions:value.userPositions.slice(-3).map(item=>({...item,quote:item.quote.slice(0,300)}))};
}

/** Local continuity, separate from role prompts, permissions and user-fact memory. */
export class CompanionStore {
  constructor(legacyStore){if(typeof legacyStore?.file!=='function'||typeof legacyStore?.state!=='function')throw Error('需要本地助理存储');this.legacy=legacyStore;}
  file(){return this.legacy.file('assistant/companion.json');}
  _state(){return state(readJSON(this.file(),EMPTY));}
  _save(value){const checked=state(value);atomic(this.file(),checked);return checked;}
  _main(sessionId){const current=this.legacy.state().sessionId;if(!current||typeof sessionId!=='string'||current!==sessionId)throw Error('陪伴记录仅属于当前个人主会话');return opaque(sessionId);}
  _find(rows,id){uuid(id);const found=rows.find(item=>item.id===id);if(!found)throw Error('兴趣线不存在，不能用旧标识重新建立');return found;}
  snapshot(){const value=this._state();return {threads:value.threads.map(item=>viewThread(item)),receipts:structuredClone(value.receipts),recentUserMessages:structuredClone(value.recentUserMessages)};}
  context(){
    const value=this._state(),main=this.legacy.state().sessionId;
    const active=value.threads.filter(item=>item.status==='active').sort((a,b)=>b.updatedAt-a.updatedAt),result={threads:[],receipts:[],recentUserMessages:[]};
    const append=(key,row)=>{result[key].push(row);if(JSON.stringify(result).length>23900){result[key].pop();return false;}return true;};
    for(const item of value.recentUserMessages.filter(item=>item.sessionId===main).slice(-4))append('recentUserMessages',{...item,text:item.text.slice(0,800)});
    for(const item of active.slice(0,3))append('threads',contextThread(item));
    for(const item of value.receipts.filter(item=>item.sessionId===main).slice(-12).reverse())append('receipts',{...item,excerpt:item.excerpt.slice(0,600),scope:item.scope.slice(0,400),title:item.title.slice(0,160),contextExcerptTruncated:item.excerpt.length>600});
    return {...result,moreThreads:active.length>result.threads.length};
  }
  start(input,sessionId){
    this._main(sessionId);fields(input,['title','openQuestion','origin']);
    const title=text(input.title,150),openQuestion=text(input.openQuestion,500),origin=enumeration(input.origin??'fish',['fish','user']);
    const value=this._state(),existing=value.threads.find(item=>item.title.normalize('NFKC').toLowerCase()===title.normalize('NFKC').toLowerCase());
    if(existing){if(existing.openQuestion===openQuestion)return viewThread(existing);throw Error('已有同主题兴趣线，请继续已有话题');}
    if(value.threads.length>=30||value.threads.filter(item=>item.status==='active').length>=5)throw Error('兴趣线已满，请先暂停或整理已有话题');
    const now=Date.now(),created={id:crypto.randomUUID(),title,currentThought:'',openQuestion,nextQuestion:openQuestion,status:'active',origin,createdAt:now,updatedAt:now,revision:0,episodes:[],userPositions:[]};
    value.threads.push(created);this._save(value);return viewThread(created);
  }
  reflect(input,sessionId){
    this._main(sessionId);fields(input,['id','thought','nextQuestion','reason','receiptIds']);
    const value=this._state(),current=this._find(value.threads,input.id);if(current.status!=='active')throw Error('这条兴趣线已放下，请先明确恢复话题');
    const thought=text(input.thought,1500),nextQuestion=text(input.nextQuestion??'',500,{empty:true}),reason=text(input.reason,1000),ids=array(input.receiptIds,6).map(receiptId);
    if(!ids.length||new Set(ids).size!==ids.length)throw Error('想法需要引用实际读取过的资料');
    const now=Date.now(),sources=ids.map(id=>{const found=value.receipts.find(item=>item.id===id);if(!found||found.sessionId!==sessionId)throw Error('资料不是当前主会话实际取得的读取回执');if(found.operation==='search')throw Error('搜索摘要只是线索，请先实际读取正文、简介或评论');if(now-found.readAt>MAX_RECEIPT_AGE||found.readAt>now+60000)throw Error('资料回执已超过30天，请重新读取后再形成新想法');return found;});
    const previous=current.episodes.at(-1),sameIds=previous&&[...previous.sourceIds].sort().join('|')===[...ids].sort().join('|');
    if(sameIds&&current.currentThought===thought&&current.nextQuestion===nextQuestion)return viewThread(current);
    const active=this.legacy.state().activeRun;
    current.episodes.push({id:crypto.randomUUID(),at:now,runId:active?.sessionId===sessionId?opaque(active.id):null,before:current.currentThought,after:thought,reason,nextQuestion,sourceIds:ids,sources:structuredClone(sources)});
    current.episodes=current.episodes.slice(-12);current.currentThought=thought;current.nextQuestion=nextQuestion;current.updatedAt=now;current.revision++;
    this._save(value);return viewThread(current);
  }
  respond(input,sessionId){
    this._main(sessionId);fields(input,['id','messageId','quote']);const value=this._state(),current=this._find(value.threads,input.id),messageId=opaque(input.messageId),quote=text(input.quote,500,{preserve:true});
    const actual=value.recentUserMessages.find(item=>item.id===messageId&&item.sessionId===sessionId);if(!actual||!actual.text.includes(quote))throw Error('只能引用当前主会话实际收到的用户原话');
    if(current.userPositions.some(item=>item.messageId===messageId&&item.quote===quote))return viewThread(current);
    current.userPositions.push({messageId,quote,at:actual.at});current.userPositions=current.userPositions.slice(-6);current.updatedAt=Date.now();this._save(value);return viewThread(current);
  }
  setStatus(id,status){
    enumeration(status,STATUSES);const value=this._state(),current=this._find(value.threads,id);
    if(status==='active'&&current.status!=='active'&&value.threads.filter(item=>item.status==='active').length>=5)throw Error('同时最多继续五条兴趣线');
    if(current.status!==status){current.status=status;current.updatedAt=Date.now();this._save(value);}return viewThread(current);
  }
  forget(id){const value=this._state();this._find(value.threads,id);value.threads=value.threads.filter(item=>item.id!==id);this._save(value);return {ok:true,id};}
  addReceipt(input){
    fields(input,['platform','operation','reference','url','title','excerpt','scope','truncated','sessionId','readAt']);this._main(input.sessionId);
    if(input.truncated!==undefined&&typeof input.truncated!=='boolean')throw Error('资料截断状态必须是开关');
    const created=source({id:'receipt-'+crypto.randomUUID(),...input,title:input.title??'',excerpt:input.excerpt??'',truncated:input.truncated??false,readAt:input.readAt??Date.now()});
    if(created.readAt>Date.now()+60000)throw Error('资料读取时间不能在未来');
    const value=this._state(),comparable=({id,readAt,...item})=>JSON.stringify(item),existing=value.receipts.find(item=>comparable(item)===comparable(created));
    if(existing){if(created.readAt>existing.readAt){existing.readAt=created.readAt;this._save(value);}return structuredClone(existing);}
    value.receipts.push(created);value.receipts=value.receipts.slice(-120);this._save(value);return structuredClone(created);
  }
  recordUserMessage(input){
    fields(input,['id','text','sessionId','at']);this._main(input.sessionId);
    if(typeof input.text!=='string')throw Error('用户话题文字格式无效');if(!input.text.trim()||sensitive(input.text))return null;
    const created=message({...input,text:input.text.slice(0,1500),at:input.at??Date.now()});if(created.at>Date.now()+60000)throw Error('用户话题时间不能在未来');
    const value=this._state(),existing=value.recentUserMessages.find(item=>item.id===created.id);
    if(existing){if(JSON.stringify(existing)!==JSON.stringify(created))throw Error('用户消息标识与已记录内容不一致');return structuredClone(existing);}
    value.recentUserMessages.push(created);value.recentUserMessages=value.recentUserMessages.slice(-30);this._save(value);return structuredClone(created);
  }
  registerDispatch(requestId){const id=opaque(requestId),value=this._state();if(!value.dispatches.includes(id)){value.dispatches.push(id);value.dispatches=value.dispatches.slice(-100);this._save(value);}return id;}
  isInternalDispatch(requestId){return typeof requestId==='string'&&this._state().dispatches.includes(requestId);}
}
