import crypto from 'node:crypto';

const BV=/^BV1[1-9A-HJ-NP-Za-km-z]{9}$/;
export function companionVideoReference(value){
  if(typeof value!=='string'||!value.trim()||value.length>2048)throw Error('请填写BV号或规范B站视频链接');
  const text=value.trim();if(BV.test(text))return 'https://www.bilibili.com/video/'+text+'/';
  let url;try{url=new URL(text);}catch{throw Error('请填写BV号或规范B站视频链接');}
  const match=url.pathname.match(/^\/video\/(BV1[1-9A-HJ-NP-Za-km-z]{9})\/?$/);
  if(url.protocol!=='https:'||!['www.bilibili.com','bilibili.com'].includes(url.hostname)||url.port||url.username||url.password||!match)throw Error('请填写BV号或规范B站视频链接');
  return 'https://www.bilibili.com/video/'+match[1]+'/';
}
function request(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','reference','requestId'].includes(key)))throw Error('续聊请求格式不正确');
  if(typeof value.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,120}$/.test(value.requestId))throw Error('需要有效的续聊请求标识');
  if(value.id!==undefined&&(typeof value.id!=='string'||!/^[a-f0-9-]{36}$/i.test(value.id)))throw Error('兴趣话题标识无效');
  const reference=value.reference===undefined?'':companionVideoReference(value.reference);
  return {requestId:value.requestId,...(value.id?{id:value.id}:{}),...(reference?{reference}:{})};
}
const sessionId=session=>session?.id??session?.header?.id;

export class CompanionRuntime{
  constructor({store,companion,scheduler,controller,signal}){Object.assign(this,{store,companion,scheduler,controller,signal});}
  async chat(input){
    const value=request(input),fingerprint=JSON.stringify({id:value.id??null,reference:value.reference??null});
    let state=this.store.state();const previous=(state.companionChats??[]).find(row=>row.requestId===value.requestId);
    if(previous){
      if(previous.fingerprint!==fingerprint)throw Error('同一续聊标识不能更换话题，请重新发起');
      if(previous.sessionId!==state.sessionId)throw Error('这次续聊属于旧主会话，请从当前聊天重新发起');
      return {ok:true,sessionId:previous.sessionId,requestId:value.requestId,queued:previous.status==='queued',uncertain:previous.status!=='queued',note:previous.status==='queued'?'已交给同一个主会话，没有重复发送':'上次续聊投递尚未确认，没有重复发送；请先打开主会话核对。'};
    }
    if(state.activeRun||state.dispatchPending)throw Error('上一轮对话仍在处理或投递未确认，请先到主会话核对');
    const topic=value.id?this.companion.snapshot().threads.find(row=>row.id===value.id):null;
    if(value.id&&!topic)throw Error('这个兴趣话题已经不存在，请刷新后再选');
    if(topic&&topic.status!=='active')throw Error('这个话题已暂时放下，请先恢复后再聊');
    this.signal?.throwIfAborted();
    const {sessionId:main}=await this.scheduler.ensureSession({recoverMissing:true});
    const internalId='my-fish-chat-'+crypto.createHash('sha256').update(value.requestId).digest('hex');
    const prompt=value.reference
      ?`我想和你聊聊这个B站内容：${value.reference}\n请先用 social_read 实际读取公开简介，必要时用 social_comments 看少量评论。按读到的范围聊聊你觉得有意思或有争议的地方，别假装看过视频。值得继续探讨时可把它接入兴趣线，留个下次想聊的问题。`
      :topic?`我们接着聊“${topic.title}”吧。你上次留下的问题是“${topic.nextQuestion||topic.openQuestion}”。先自然接上我们实际聊过的内容；有新观点要说明读到的依据。`
        :'你最近有什么自己想琢磨的？可以接着已有兴趣去读一点新东西，回来跟我随便聊聊你的看法。没有合适的资料也可以说还没想明白，不需要写工作报告。';
    this.companion.registerDispatch(internalId);
    state=this.store.state();
    const record={requestId:value.requestId,fingerprint,sessionId:main,internalId,at:Date.now(),status:'prepared'};
    state.companionChats=[...(state.companionChats??[]),record].slice(-40);state.dispatchPending=true;state.companionChatPending=value.requestId;this.store.saveState(state);
    try{
      this.signal?.throwIfAborted();
      await this.controller.prompt({sessionId:main,requestId:internalId,mode:'queue',content:[{type:'text',text:prompt}]},this.signal);
      const next=this.store.state(),saved=next.companionChats?.find(row=>row.requestId===value.requestId);
      if(saved)saved.status='queued';
      if(next.companionChatPending===value.requestId){next.dispatchPending=false;next.companionChatPending=null;}
      this.store.saveState(next);
      return {ok:true,sessionId:main,requestId:value.requestId,queued:true,note:'已交给主会话继续聊；是否读到内容，以聊天里的实际结果为准。'};
    }catch{
      const next=this.store.state(),saved=next.companionChats?.find(row=>row.requestId===value.requestId);if(saved)saved.status='unknown';this.store.saveState(next);
      throw Error('续聊投递结果未确认，请先打开主会话核对；同一请求不会重复发送。');
    }
  }
  // Observe new, committed events from this main conversation only. No log scan.
  observe(session,event){
    const main=this.store.state().sessionId;
    if(!main||sessionId(session)!==main||event?.type!=='user/message')return;
    const message=event.data,source=message?.source;
    if(source?.kind!=='user'||typeof source.rpcId!=='string'||!source.rpcId||/^my-fish-(?:chat|wake)-/.test(source.rpcId)||this.companion.isInternalDispatch(source.rpcId))return;
    if(typeof message.id!=='string'||!Array.isArray(message.content))return;
    const text=message.content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');
    if(!text.trim())return;
    const at=Number.isSafeInteger(event.time)&&event.time>=0?event.time:Date.now();
    return this.companion.recordUserMessage({id:message.id,text,sessionId:main,at});
  }
}
