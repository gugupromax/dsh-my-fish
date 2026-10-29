const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const pick=(input,keys)=>Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));

export const COMPANION_PARAMETERS=object({action:{type:'string',enum:['list','start','reflect','respond','pause','resume','forget']},id:str,title:str,openQuestion:str,thought:str,nextQuestion:str,reason:str,receiptIds:{type:'array',items:str},messageId:str,quote:str},['action']);

export function registerCompanionTools({tool,companion,store,requirePersonal,engine}){
  tool('assistant_companion','延续自己的兴趣与对话：list查看当前话题、实际已读资料回执和用户原话；start建立好奇问题；reflect引用真实read/comments/timeline回执形成或修正自己的看法；respond引用实际用户messageId及原话片段。不把搜索摘要当读过正文，不把自己观点当用户偏好，不虚构观看视频或现实经历。pause/resume只放下或继续这条话题，forget删除它；不改变作息、权限或社交开关。',COMPANION_PARAMETERS,(args,_signal,exec)=>{
    requirePersonal(exec);const sessionId=store.state().sessionId;
    if(args.action==='list')return {ok:true,...companion.context(),otherThreads:companion.snapshot().threads.map(({id,title,status})=>({id,title,status}))};
    return engine.serial(()=>{
      // Recheck the current binding after waiting for the operation lease.
      requirePersonal(exec);if(store.state().sessionId!==sessionId)throw Error('主会话绑定已变化，请从当前主会话重试');
      if(args.action==='start')return {ok:true,thread:companion.start(pick(args,['title','openQuestion']),sessionId)};
      if(args.action==='reflect')return {ok:true,thread:companion.reflect(pick(args,['id','thought','nextQuestion','reason','receiptIds']),sessionId)};
      if(args.action==='respond')return {ok:true,thread:companion.respond(pick(args,['id','messageId','quote']),sessionId)};
      if(args.action==='pause'||args.action==='resume')return {ok:true,thread:companion.setStatus(args.id,args.action==='pause'?'paused':'active')};
      if(args.action==='forget')return companion.forget(args.id);
      throw Error('兴趣线操作无效');
    });
  });
}
