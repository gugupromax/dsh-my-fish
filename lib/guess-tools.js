const str={type:'string'};
const parameters={type:'object',properties:{action:{type:'string',enum:['list','start','bet','answer','skip','retry','cancel']},id:str,revision:{type:'integer'},reference:str,guess:str,receiptId:str,messageId:str,quote:str},required:['action'],additionalProperties:false};
const keys={list:['action'],start:['action','reference'],bet:['action','id','revision','guess','receiptId'],answer:['action','id','revision','messageId','quote'],skip:['action','id','revision','messageId','quote'],retry:['action','id','revision','messageId','quote'],cancel:['action','id','revision']};
export function registerGuessTools({tool,game,store,requirePersonal,engine}){
  tool('assistant_guess','和用户玩猜评论。用户明确发起时 start；先读本局视频标题/简介，再用 bet 保存自己的猜测和本局真实读取回执，然后将猜测原文发到主会话。等待用户实际作答或明确跳过，list 查询最新 revision 和消息 ID，再用 answer/skip 引用原话，之后才可读取本局首页至多五条热评并揭晓。list 查看已保存结果，失败后须用户明确要求再 retry；cancel 结束。只依据有限评论样本，不声称看过视频。',parameters,(args,_signal,exec)=>{
    requirePersonal(exec);const session=store.state().sessionId;
    if(!keys[args.action]||Object.keys(args).some(key=>!keys[args.action].includes(key)))throw Error('猜评论操作或字段无效');
    if(args.action==='list')return {ok:true,rounds:game.list(session),recentUserMessages:game.companion.snapshot().recentUserMessages.filter(row=>row.sessionId===session).slice(-5)};
    return engine.serial(()=>{
      requirePersonal(exec);if(store.state().sessionId!==session)throw Error('主会话绑定已变化，请从当前主会话重试');
      const {action,...input}=args;
      if(action==='start')return {ok:true,round:game.start(input,session)};
      if(action==='bet')return {ok:true,round:game.bet(input,session)};
      if(action==='answer'||action==='skip')return {ok:true,round:game.answer({...input,skip:action==='skip'},session)};
      if(action==='retry')return {ok:true,round:game.retry(input,session)};
      if(action==='cancel')return {ok:true,round:game.cancel(input,session)};
      throw Error('猜评论操作无效');
    });
  });
}
