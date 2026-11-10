import crypto from 'node:crypto';
import {atomic,readJSON} from './store.js';
import {companionVideoReference} from './companion-runtime.js';

const ACTIVE=new Set(['prepare','waiting','ready','reading','uncertain']);
const SECRET=/(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const sessionOf=exec=>exec?.agent?.session?.id??exec?.agent?.session?.header?.id??exec?.agent?.id;
function text(value,label,max){if(typeof value!=='string'||!value.trim()||value.length>max||SECRET.test(value))throw Error(label+'格式无效');return value.trim();}
function clean(value,max){return typeof value==='string'&&!SECRET.test(value)?value.slice(0,max):'';}
function reference(value){const url=companionVideoReference(value);return {url,bvid:/\/video\/(BV[^/]+)\//.exec(url)[1]};}

export class GuessGame {
  constructor(store,companion){this.store=store;this.companion=companion;}
  file(){return this.store.file('assistant/guess-game.json');}
  _rows(){const data=readJSON(this.file(),{version:1,rounds:[]});if(!data||data.version!==1||!Array.isArray(data.rounds)||data.rounds.length>30||data.rounds.some(row=>!row||typeof row.id!=='string'||typeof row.sessionId!=='string'||typeof row.bvid!=='string'||!['prepare','waiting','ready','reading','uncertain','done','cancelled'].includes(row.status)||!Number.isSafeInteger(row.revision)))throw Error('猜评论记录格式无效');return data.rounds;}
  _save(rows){if(rows.length>30)throw Error('猜评论记录已满');atomic(this.file(),{version:1,rounds:rows});}
  _main(sessionId){if(!sessionId||sessionId!==this.store.state().sessionId)throw Error('猜评论仅允许当前主会话');}
  _row(rows,id,sessionId,revision){this._main(sessionId);const row=rows.find(item=>item.id===id&&item.sessionId===sessionId);if(!row)throw Error('没有找到本会话的游戏');if(!Number.isSafeInteger(revision)||row.revision!==revision)throw Error('游戏状态已变化，请刷新后继续');return row;}
  list(sessionId){this._main(sessionId);return this._rows().filter(row=>row.sessionId===sessionId).map(row=>structuredClone(row));}
  start({reference:input},sessionId){
    this._main(sessionId);const video=reference(input),rows=this._rows(),active=rows.find(row=>row.sessionId===sessionId&&ACTIVE.has(row.status));
    if(active){if(active.bvid===video.bvid)return structuredClone(active);throw Error('已有一局进行中，请先结束或取消');}
    if(rows.length>=30){const old=rows.findIndex(row=>['done','cancelled'].includes(row.status));if(old<0)throw Error('未结束的猜评论局已满，请先整理');rows.splice(old,1);}
    const row={id:crypto.randomUUID(),sessionId,reference:video.url,bvid:video.bvid,status:'prepare',revision:0,createdAt:Date.now(),guess:null,receiptId:null,betAt:null,shownAt:null,seenMessageIds:[],retrySeenMessageIds:[],readStartedAt:null,answer:null,comments:null};
    rows.push(row);this._save(rows);return structuredClone(row);
  }
  bet({id,revision,guess,receiptId},sessionId){
    const rows=this._rows(),row=this._row(rows,id,sessionId,revision);if(row.status!=='prepare')throw Error('请先查看当前游戏状态');
    const actual=this.companion.snapshot().receipts.find(item=>item.id===receiptId&&item.sessionId===sessionId&&item.platform==='bilibili'&&item.operation==='read'&&item.reference===row.bvid&&item.readAt>=row.createdAt);
    if(!actual)throw Error('请先在本局实际读取这个视频的标题或简介');
    row.guess=text(guess,'猜测',500);row.receiptId=receiptId;row.betAt=Date.now();row.seenMessageIds=this.companion.snapshot().recentUserMessages.filter(item=>item.sessionId===sessionId).map(item=>item.id);row.status='waiting';row.revision++;this._save(rows);return structuredClone(row);
  }
  answer({id,revision,messageId,quote,skip=false},sessionId){
    const rows=this._rows(),row=this._row(rows,id,sessionId,revision);if(row.status!=='waiting')throw Error('当前游戏尚未等待作答');if(row.shownAt===null)throw Error('请先将自己的猜测发到主会话，再等待用户作答');
    const part=text(quote,'用户原话',500),message=this.companion.snapshot().recentUserMessages.find(item=>item.id===messageId&&item.sessionId===sessionId&&item.at>=row.shownAt&&!(row.seenMessageIds??[]).includes(item.id)&&item.text.includes(part));
    if(!message)throw Error('请引用本局猜测之后主会话实际收到的用户原话');
    if(skip&&!/(跳过|揭晓|直接看|不猜|公布)/.test(part))throw Error('跳过需要用户明确表示跳过或揭晓');
    row.answer={messageId,quote:part,at:message.at,skipped:skip};row.status='ready';row.revision++;this._save(rows);return structuredClone(row);
  }
  cancel({id,revision},sessionId){const rows=this._rows(),row=this._row(rows,id,sessionId,revision);if(ACTIVE.has(row.status)){row.status='cancelled';row.revision++;this._save(rows);}return structuredClone(row);}
  retry({id,revision,messageId,quote},sessionId){
    const rows=this._rows(),row=this._row(rows,id,sessionId,revision);if(!['reading','uncertain'].includes(row.status))throw Error('当前不需要重试');
    const part=text(quote,'用户原话',500),message=this.companion.snapshot().recentUserMessages.find(item=>item.id===messageId&&item.sessionId===sessionId&&item.at>=row.readStartedAt&&!(row.retrySeenMessageIds??[]).includes(item.id)&&item.text.includes(part));
    if(!message||!/(重试|再试|重新读取|重新揭晓)/.test(part))throw Error('请在主会话明确要求重试后再读取');
    row.status='ready';row.revision++;this._save(rows);return structuredClone(row);
  }
  guard(exec,scope){
    if(!['personal','descendant'].includes(scope))return;
    const main=this.store.state().sessionId,row=this._rows().find(item=>item.sessionId===main&&ACTIVE.has(item.status));if(!row)return;
    const name=exec?.name,args=exec?.arguments??{};
    if(name==='social_read'||name==='social_comments'){
      if(scope==='personal'&&args.platform==='bilibili'){
        try{if(reference(args.reference).bvid===row.bvid)return;}catch{}
      }
      return '猜评论进行中，请先揭晓或取消本局，再读取其他渠道内容。';
    }
    if(['web_search','web_fetch','social_search','social_timeline','social_action','x_whale_search','x_whale_read','x_whale_timeline','x_whale_bookmark','x_whale_reply','x_whale_share','pwsh','bash','run_code','terminal_open','terminal_send','bsk_session','bsk_page','bsk_inspect','bsk_tabs','bsk_interact','bsk_assist'].includes(name))return '猜评论进行中，请先揭晓或取消本局，再使用联网、浏览器或命令工具。';
  }
  beforeComments({platform,args,exec}){
    if(platform!=='bilibili'||!exec)return null;const sessionId=sessionOf(exec);if(!sessionId||sessionId!==this.store.state().sessionId)return null;
    let video;try{video=reference(args.reference);}catch{return null;}
    const rows=this._rows(),row=rows.find(item=>item.sessionId===sessionId&&item.bvid===video.bvid&&ACTIVE.has(item.status));if(!row)return null;
    if(row.status==='prepare'||row.status==='waiting')throw Error('请先说出你的猜测，或明确跳过，再揭晓评论');
    if(row.status!=='ready')throw Error('本局评论读取尚未确认，请核对后由用户明确要求重试');
    if(args.page!==undefined&&args.page!==1||args.sort!==undefined&&args.sort!=='hot')throw Error('猜评论只使用首页热评');
    const boundedArgs={...args,page:1,sort:'hot',count:Math.min(args.count??5,5)};
    row.readStartedAt=Date.now();row.retrySeenMessageIds=this.companion.snapshot().recentUserMessages.filter(item=>item.sessionId===sessionId).map(item=>item.id);row.status='reading';row.revision++;this._save(rows);
    return {id:row.id,sessionId,revision:row.revision,args:boundedArgs};
  }
  afterComments(token,result,error){
    if(!token)return true;
    if(this.store.state().sessionId!==token.sessionId)return false;
    const rows=this._rows(),row=rows.find(item=>item.id===token.id&&item.sessionId===token.sessionId);
    if(!row||row.revision!==token.revision||row.status!=='reading')return false;
    if(error||!result||result.ok===false||!Array.isArray(result.items)){
      row.readStartedAt=Date.now();row.retrySeenMessageIds=this.companion.snapshot().recentUserMessages.filter(item=>item.sessionId===token.sessionId).map(item=>item.id);
      row.status='uncertain';row.revision++;this._save(rows);return true;
    }
    const items=result.items.slice(0,5).filter(item=>item&&typeof item==='object').map(item=>({rpid:clean(String(item.rpid??''),40),text:clean(item.text,2000),like:Number.isSafeInteger(item.like)?item.like:null})).filter(item=>/^[1-9][0-9]{0,21}$/.test(item.rpid)&&item.text);
    row.comments={bvid:row.bvid,url:row.reference,title:clean(result.title,300),sampledAt:Date.now(),count:items.length,returnedCount:result.items.length,items,scope:'匿名首页有限顶层评论，不能代表完整评论区或视频内容。'};
    row.status='done';row.revision++;this._save(rows);return true;
  }
  observe(session,event){
    const sessionId=session?.id??session?.header?.id;if(!sessionId||sessionId!==this.store.state().sessionId||event?.type!=='assistant/message')return;
    const message=event.data?.message;if(message?.source?.kind!=='model'||!Array.isArray(message.content))return;
    const output=message.content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');
    const rows=this._rows(),row=rows.find(item=>item.sessionId===sessionId&&item.status==='waiting'&&item.shownAt===null&&output.includes(item.guess));
    if(!row)return;
    row.shownAt=Date.now();row.seenMessageIds=this.companion.snapshot().recentUserMessages.filter(item=>item.sessionId===sessionId).map(item=>item.id);row.revision++;this._save(rows);
  }
}
