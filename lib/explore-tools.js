export function registerExploreTools({tool,exploration,experiences,companion,store,engine,requirePersonal}){
  const str={type:'string'},parameters={type:'object',additionalProperties:false,required:['action'],properties:{
    action:{type:'string',enum:['status','start','cancel','report','respond','pause','resume','forget']},runId:str,id:str,interestId:str,interestStatus:{type:'string',enum:['active','paused','settled']},quiet:{type:'boolean'},share:{type:'boolean'},title:str,question:str,before:str,thought:str,reason:str,nextQuestion:str,receiptIds:{type:'array',items:str},messageId:str,quote:str,
  }};
  const keys={status:['action'],start:['action'],cancel:['action','runId'],report:['action','runId','interestId','interestStatus','quiet','share','title','question','before','thought','reason','nextQuestion','receiptIds'],respond:['action','interestId','messageId','quote'],pause:['action','interestId'],resume:['action','interestId'],forget:['action','interestId']};
  tool('assistant_explore','管理自己的持续兴趣与公开内容探索。主会话status查看经历/真实用户消息；start启动独立只读探索；cancel取消。respond将用户实际原话接到兴趣（interestId/messageId/quote），pause/resume/forget管理本会话兴趣。后台仅report本轮，quiet=true表示无值得记录的资料，quiet=false必须引用本轮实际读取receiptIds并给title/question/thought/reason/nextQuestion，share仅表示值得自然聊起，不保证打扰用户。',parameters,(a,_signal,exec)=>{
    if(!keys[a.action]||Object.keys(a).some(k=>!keys[a.action].includes(k)))throw Error('探索操作或字段无效');
    if(exploration.owns(exec)){
      if(a.action!=='report')throw Error('后台仅允许回报本轮');const {action,...input}=a;
      return engine.serial(()=>exploration.report(input,exec));
    }
    requirePersonal(exec);const main=store.state().sessionId;
    if(a.action==='status')return {...exploration.snapshot(),recentUserMessages:companion.snapshot().recentUserMessages.filter(m=>m.sessionId===main).slice(-5)};
    return engine.serial(async()=>{
      requirePersonal(exec);if(main!==store.state().sessionId)throw Error('主会话已变化');
      if(a.action==='start')return exploration.start({manual:true});
      if(a.action==='cancel')return a.runId||exploration.active()?exploration.stop(a.runId??exploration.active()?.id):exploration.recoverOpening();
      if(!experiences.interests(main).some(i=>i.id===a.interestId))throw Error('兴趣不属于当前主会话');
      if(a.action==='pause'||a.action==='resume')return {ok:true,interest:experiences.setInterest(a.interestId,a.action==='pause'?'paused':'active')};
      if(a.action==='forget')return experiences.forget(a.interestId);
      if(a.action==='respond'){
        const message=companion.snapshot().recentUserMessages.find(m=>m.id===a.messageId&&m.sessionId===main&&typeof a.quote==='string'&&a.quote.trim()&&m.text.includes(a.quote));if(!message)throw Error('需要本会话实际收到的用户原话');
        return {ok:true,interest:experiences.respond({interestId:a.interestId,messageId:message.id,quote:a.quote,at:message.at},main)};
      }
      throw Error('主会话不能代替后台报告探索结果');
    });
  });
}
