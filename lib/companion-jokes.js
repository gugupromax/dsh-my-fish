import crypto from 'node:crypto';
import {atomic,readJSON} from './store.js';

const SECRET=/(?:["']?(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token|私钥)["']?\s*[:=]\s*["']?[^\s"',;}&]+|bearer\s+[a-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const LOCAL_PATH=/(?:(?:^|[^a-z0-9])[a-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|\s)\/(?:home|users|mnt)\/)/i;
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('共同梗文字格式或长度无效');let decoded=value.normalize('NFKC');for(let i=0;i<3;i++){try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}catch{break;}}if(SECRET.test(decoded)||LOCAL_PATH.test(decoded))throw Error('共同梗包含疑似凭据或本机路径');return value.trim();}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** User-confirmed shared expressions, isolated from persona and factual memory. */
export class CompanionJokes {
  constructor(store,companion){this.store=store;this.companion=companion;}
  file(){return this.store.file('assistant/jokes.json');}
  state(){const data=readJSON(this.file(),{version:1,items:[],deleted:[]});if(data?.version!==1||!Array.isArray(data.items)||!Array.isArray(data.deleted))throw Error('共同梗记录格式无效');return data;}
  main(sessionId){if(!sessionId||this.store.state().sessionId!==sessionId)throw Error('共同梗只属于当前主会话');}
  list(sessionId){this.main(sessionId);return structuredClone(this.state().items.filter(item=>item.sessionId===sessionId));}
  add(input,sessionId){
    this.main(sessionId);const name=text(input.name,100),quote=text(input.quote,500),scene=text(input.scene,300);
    const messages=this.companion.snapshot().recentUserMessages.filter(row=>row.sessionId===sessionId);
    const source=messages.find(row=>row.id===input.sourceMessageId),confirmation=messages.find(row=>row.id===input.confirmMessageId);
    if(!source||!confirmation||confirmation.at<source.at||!source.text.includes(quote)||!source.text.includes(name)||!/记住|记一下|记下来|以后叫/.test(confirmation.text)||/不要记|别记|不用记|不想记|无需记/.test(confirmation.text))throw Error('需要当前主会话的原话及明确记住该叫法的消息');
    const data=this.state(),confirmationKey=hash([sessionId,confirmation.id,name]),existing=data.items.find(row=>row.confirmationKey===confirmationKey);
    if(existing)return structuredClone(existing);
    if(data.deleted.includes(confirmationKey))throw Error('该确认对应的梗已删除，需要新的明确确认才能再次保存');
    if(data.items.filter(row=>row.sessionId===sessionId).length>=100)throw Error('共同梗数量已满，请先整理');
    const item={id:crypto.randomUUID(),sessionId,name,quote,scene,sourceMessageId:source.id,confirmMessageId:confirmation.id,confirmationKey,createdAt:Date.now(),lastUsedAt:null};
    data.items.push(item);atomic(this.file(),data);return structuredClone(item);
  }
  update(input,sessionId){
    this.main(sessionId);const data=this.state(),item=data.items.find(row=>row.id===input.id&&row.sessionId===sessionId);
    if(!item)throw Error('共同梗不存在');
    const name=text(input.name,100),quote=text(input.quote,500),scene=text(input.scene,300);
    const messages=this.companion.snapshot().recentUserMessages.filter(row=>row.sessionId===sessionId);
    const source=messages.find(row=>row.id===input.sourceMessageId),confirmation=messages.find(row=>row.id===input.confirmMessageId);
    if(!source||!confirmation||confirmation.at<source.at||confirmation.at<item.createdAt||!source.text.includes(quote)||!source.text.includes(name)||!/改成|改为|换成|记住|记一下|记下来|以后叫/.test(confirmation.text)||/不要改|别改|不用改|不要记|别记/.test(confirmation.text))throw Error('纠正共同梗需要当前主会话原话及明确更改要求');
    const confirmationKey=hash([sessionId,confirmation.id,name]);
    if(data.deleted.includes(confirmationKey))throw Error('该确认已失效，需要新的明确要求');
    if(confirmationKey===item.confirmationKey){if(item.name===name&&item.quote===quote&&item.scene===scene&&item.sourceMessageId===source.id)return structuredClone(item);throw Error('同一确认不能用于不同内容');}
    if(data.items.some(row=>row!==item&&row.confirmationKey===confirmationKey))throw Error('这个确认已经用于另一条共同梗');
    data.deleted.push(item.confirmationKey);
    Object.assign(item,{name,quote,scene,sourceMessageId:source.id,confirmMessageId:confirmation.id,confirmationKey,lastUsedAt:null});
    atomic(this.file(),data);return structuredClone(item);
  }
  forget(input,sessionId){
    this.main(sessionId);const data=this.state(),item=data.items.find(row=>row.id===input.id&&row.sessionId===sessionId);
    if(!item)throw Error('共同梗不存在');
    const confirmation=this.companion.snapshot().recentUserMessages.find(row=>row.id===input.confirmMessageId&&row.sessionId===sessionId);
    if(!confirmation||confirmation.at<item.createdAt||!/忘记|忘掉|删除|不要记|别再用/.test(confirmation.text))throw Error('删除共同梗需要当前主会话的明确要求');
    data.items=data.items.filter(row=>row!==item);data.deleted.push(item.confirmationKey);atomic(this.file(),data);return {ok:true,id:item.id};
  }
  context(sessionId,query){
    if(typeof query!=='string'||query.trim().length<2)return [];
    const normalized=query.normalize('NFKC').toLowerCase();
    return this.list(sessionId).filter(item=>normalized.includes(item.name.normalize('NFKC').toLowerCase())||item.scene.split(/[，。！？、\s]+/).some(part=>part.length>=2&&normalized.includes(part.normalize('NFKC').toLowerCase()))).slice(-1);
  }
  observe(session,event){
    const sessionId=session?.id??session?.header?.id;
    if(!sessionId||sessionId!==this.store.state().sessionId||event?.type!=='assistant/message')return;
    const message=event.data?.message;
    if(!Array.isArray(message?.content))return;
    const spoken=message.content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');
    if(!spoken)return;
    const at=Number.isSafeInteger(event.time)&&event.time>=0?event.time:Date.now(),data=this.state();
    let changed=false;
    for(const item of data.items)if(item.sessionId===sessionId&&spoken.includes(item.name)&&(item.lastUsedAt??0)<at){item.lastUsedAt=at;changed=true;}
    if(changed)atomic(this.file(),data);
  }
}

export function registerJokeTools({tool,jokes,store,engine,requirePersonal}){
  const str={type:'string'},schema={type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['list','add','update','forget']},id:str,name:str,quote:str,scene:str,sourceMessageId:str,confirmMessageId:str}};
  tool('assistant_joke','管理用户明确确认的共同梗。add/update需提供原话来源消息和明确记住或更改的确认消息，forget需提供明确删除的消息；只在当前主会话使用。',schema,(args,_signal,exec)=>{
    requirePersonal(exec);const sessionId=store.state().sessionId;
    if(args.action==='list')return {ok:true,jokes:jokes.list(sessionId)};
    return engine.serial(()=>{requirePersonal(exec);if(store.state().sessionId!==sessionId)throw Error('主会话已变化');if(args.action==='add')return {ok:true,joke:jokes.add(args,sessionId)};if(args.action==='update')return {ok:true,joke:jokes.update(args,sessionId)};if(args.action==='forget')return jokes.forget(args,sessionId);throw Error('共同梗操作无效');});
  });
}
