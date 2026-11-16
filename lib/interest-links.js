import {atomic,readJSON} from './store.js';

const empty={version:1,links:[]};
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200&&/^[\w:.-]+$/.test(value);
const receiptKeys=['action','interestId','mainSessionId','requestId','threadId'];
const sameReceipt=(a,b)=>receiptKeys.every(key=>a[key]===b[key]);
function validateCompleted(rows){
  if(rows.some(row=>!row||Object.keys(row).sort().join(',')!==receiptKeys.join(',')||!identifier(row.requestId)||!identifier(row.mainSessionId)||!identifier(row.threadId)||!identifier(row.interestId)||!['pause','resume','forget'].includes(row.action))||new Set(rows.map(row=>row.requestId)).size!==rows.length)throw Error('兴趣完成回执格式无效');
}
function checked(value){
  if(!value||value.version!==1||!Array.isArray(value.links)||value.links.length>5000||Object.keys(value).some(k=>!['version','links'].includes(k)))throw Error('兴趣关联记录格式无效');
  const pairs=new Set(),threads=new Set(),interests=new Set();
  for(const row of value.links){
    if(!row||Object.keys(row).some(k=>!['mainSessionId','threadId','interestId','at'].includes(k))||!identifier(row.mainSessionId)||!identifier(row.threadId)||!identifier(row.interestId)||!Number.isSafeInteger(row.at)||row.at<0)throw Error('兴趣关联记录格式无效');
    const pair=JSON.stringify([row.mainSessionId,row.threadId,row.interestId]),t=JSON.stringify([row.mainSessionId,row.threadId]),i=JSON.stringify([row.mainSessionId,row.interestId]);
    if(pairs.has(pair)||threads.has(t)||interests.has(i))throw Error('兴趣关联记录重复');pairs.add(pair);threads.add(t);interests.add(i);
  }
  return value;
}

/** Explicit one-to-one links; no names, content, or inferred session ancestry. */
export class InterestLinks {
  constructor({store,companion,experiences,now=Date.now}){Object.assign(this,{store,companion,experiences,now});}
  file(){return this.store.file('assistant/interest-links.json');}
  state(){return checked(readJSON(this.file(),empty));}
  main(){const id=this.store.state().sessionId;if(!identifier(id))throw Error('请先绑定主会话');return id;}
  available(main){return {threads:this.companion.snapshot().threads,interests:this.experiences.interests(main)};}
  list({includeMissing=false}={}){const main=this.main(),{threads,interests}=this.available(main),threadIds=new Set(threads.map(x=>x.id)),interestIds=new Set(interests.filter(x=>x.mainSessionId===main).map(x=>x.id)),data=this.state();return data.links.filter(x=>x.mainSessionId===main&&(includeMissing||(threadIds.has(x.threadId)&&interestIds.has(x.interestId)))).map(x=>includeMissing?{...x,threadMissing:!threadIds.has(x.threadId),interestMissing:!interestIds.has(x.interestId),conflict:data.links.some(other=>other.threadId===x.threadId&&other.mainSessionId!==main&&threadIds.has(x.threadId)&&this.experiences.interests(other.mainSessionId).some(row=>row.id===other.interestId))}:{...x});}
  link({threadId,interestId}){
    if(new InterestLinkOperations({links:this}).pending())throw Error('关联操作尚未完成，请先核对并重试');
    if(!identifier(threadId)||!identifier(interestId))throw Error('需要选择有效的话题和探索兴趣');
    const main=this.main(),{threads,interests}=this.available(main);
    if(!threads.some(x=>x.id===threadId)||!interests.some(x=>x.id===interestId&&x.mainSessionId===main))throw Error('话题不存在或探索兴趣不属于当前主会话');
    const thread=threads.find(x=>x.id===threadId),interest=interests.find(x=>x.id===interestId&&x.mainSessionId===main);
    if(!['active','paused'].includes(thread.status)||thread.status!==interest.status)throw Error('关联前请将两侧状态调整为同样的进行中或暂停');
    const data=this.state(),existing=data.links.find(x=>x.threadId===threadId||(x.mainSessionId===main&&x.interestId===interestId));
    if(existing){if(existing.mainSessionId===main&&existing.threadId===threadId&&existing.interestId===interestId)return {ok:true,link:{...existing},unchanged:true};throw Error('已有其他会话或兴趣关联，请先解除后再重新选择');}
    if(data.links.length>=5000)throw Error('兴趣关联数量已满');const at=this.now();if(!Number.isSafeInteger(at)||at<0)throw Error('关联时间无效');
    const row={mainSessionId:main,threadId,interestId,at};data.links.push(row);atomic(this.file(),checked(data));return {ok:true,link:{...row}};
  }
  unlink({threadId,interestId}){
    if(new InterestLinkOperations({links:this}).pending())throw Error('关联操作尚未完成，请先核对并重试');
    if(!identifier(threadId)||!identifier(interestId))throw Error('需要选择有效的关联');const main=this.main(),data=this.state(),index=data.links.findIndex(x=>x.mainSessionId===main&&x.threadId===threadId&&x.interestId===interestId);
    if(index<0)return {ok:true,unchanged:true};data.links.splice(index,1);atomic(this.file(),checked(data));return {ok:true};
  }
}

/** Journaled multi-store operation. Caller must serialize with other mutations. */
export class InterestLinkOperations {
  constructor({links}){this.links=links;}
  file(){return this.links.store.file('assistant/interest-operation.json');}
  archiveFile(){return this.links.store.file('assistant/interest-completed-archive.json');}
  archive(){const value=readJSON(this.archiveFile(),{version:1,completed:[]});if(!value||value.version!==1||Object.keys(value).sort().join(',')!=='completed,version'||!Array.isArray(value.completed))throw Error('兴趣完成归档格式无效');validateCompleted(value.completed);return value;}
  journal(){
    const data=readJSON(this.file(),{version:1,pending:null});
    if(!data||data.version!==1||Object.keys(data).some(k=>!['version','pending','completed'].includes(k)))throw Error('兴趣操作记录格式无效');
    const p=data.pending;if(p!==null&&(!p||Object.keys(p).some(k=>!['mainSessionId','threadId','interestId','action','threadDone','interestDone','requestId'].includes(k))||!identifier(p.mainSessionId)||!identifier(p.threadId)||!identifier(p.interestId)||!['pause','resume','forget'].includes(p.action)||typeof p.threadDone!=='boolean'||typeof p.interestDone!=='boolean'||(p.requestId!==undefined&&!identifier(p.requestId))))throw Error('兴趣操作记录格式无效');
    const completed=data.completed??[];if(!Array.isArray(completed)||completed.length>5000)throw Error('兴趣完成回执格式无效');validateCompleted(completed);
    return {version:1,pending:p,completed};
  }
  pending(){return this.journal().pending;}
  recent(main,limit=10){
    if(!identifier(main)||!Number.isInteger(limit)||limit<1||limit>50)throw Error('兴趣回执查询格式无效');
    const combined=[...this.archive().completed,...this.journal().completed],seen=new Map();
    for(const row of combined){const old=seen.get(row.requestId);if(old&&!sameReceipt(old,row))throw Error('兴趣完成回执归档冲突');if(!old)seen.set(row.requestId,row);}
    return [...seen.values()].filter(row=>row.mainSessionId===main).slice(-limit).map(({requestId,threadId,interestId,action})=>({requestId,threadId,interestId,action}));
  }
  compact(journal){
    if(journal.completed.length<5000)return;
    const archive=this.archive(),byId=new Map(archive.completed.map(row=>[row.requestId,row]));
    const moved=journal.completed.slice(0,500);
    for(const row of moved){const existing=byId.get(row.requestId);if(existing&&!sameReceipt(existing,row))throw Error('兴趣完成回执归档冲突');if(!existing){archive.completed.push(row);byId.set(row.requestId,row);}}
    atomic(this.archiveFile(),archive);journal.completed=journal.completed.slice(moved.length);atomic(this.file(),journal);
  }
  save(pending,completedRow=null){const journal=this.journal();if(completedRow){this.compact(journal);journal.completed.push(completedRow);}journal.pending=pending;atomic(this.file(),journal);}
  perform({threadId,interestId,action,requestId}){
    if(!identifier(threadId)||!identifier(interestId)||!identifier(requestId)||!['pause','resume','forget'].includes(action))throw Error('兴趣操作格式无效');
    const main=this.links.main(),journal=this.journal(),archive=this.archive(),done=journal.completed.find(row=>row.requestId===requestId),archived=archive.completed.find(row=>row.requestId===requestId);let p=journal.pending;
    if(done&&archived&&!sameReceipt(done,archived))throw Error('兴趣完成回执归档冲突');
    const saved=done??archived;
    if(saved){if(saved.mainSessionId!==main||saved.threadId!==threadId||saved.interestId!==interestId||saved.action!==action)throw Error('同一请求标识不能用于其他兴趣操作');return {ok:true,action,deduplicated:true,note:'该请求此前已完成；当前状态请刷新核对。'};}
    if(p&&(p.mainSessionId!==main||p.threadId!==threadId||p.interestId!==interestId||p.action!==action||(p.requestId!==undefined&&p.requestId!==requestId)))throw Error('已有未完成的兴趣操作，请先回到原会话核对并重试');
    if(!p){
      const link=this.links.list({includeMissing:true}).find(x=>x.threadId===threadId&&x.interestId===interestId);
      if(!link||link.threadMissing||link.interestMissing)throw Error('关联不存在或不属于当前主会话');
      if(link.conflict)throw Error('该聊天话题同时关联其他会话的兴趣，请先解除冲突关联');
      this.compact(journal);
      p={mainSessionId:main,threadId,interestId,action,requestId,threadDone:false,interestDone:false};this.save(p);
    }
    else if(p.requestId===undefined){p.requestId=requestId;this.save(p);}
    const checkMain=()=>{if(this.links.main()!==main)throw Error('主会话已变化');};
    try{
      const target=action==='pause'?'paused':'active';
      if(!p.threadDone){checkMain();const row=this.links.companion.snapshot().threads.find(x=>x.id===threadId);
        if(action==='forget'){if(row)this.links.companion.forget(threadId);}else{if(!row)throw Error('聊天话题已不存在');if(row.status!==target)this.links.companion.setStatus(threadId,target);}
        p.threadDone=true;this.save(p);
      }
      if(!p.interestDone){checkMain();const row=this.links.experiences.interests(main).find(x=>x.id===interestId);
        if(action==='forget'){if(row)this.links.experiences.forget(interestId);}else{if(!row)throw Error('探索兴趣已不存在');if(row.status!==target)this.links.experiences.setInterest(interestId,target);}
        p.interestDone=true;this.save(p);
      }
      checkMain();const thread=this.links.companion.snapshot().threads.find(x=>x.id===threadId),interest=this.links.experiences.interests(main).find(x=>x.id===interestId);
      if(action==='forget'?(thread||interest):(!thread||!interest||thread.status!==target||interest.status!==target))throw Error('兴趣状态已发生变化，请人工核对');
      checkMain();if(action==='forget'){const data=this.links.state();data.links=data.links.filter(x=>!(x.mainSessionId===main&&x.threadId===threadId&&x.interestId===interestId));atomic(this.links.file(),checked(data));}
      this.save(null,{mainSessionId:main,threadId,interestId,action,requestId});return {ok:true,action};
    }catch(error){return {ok:false,pending:true,action,threadDone:p.threadDone,interestDone:p.interestDone,error:'操作未完全完成，请在原会话核对并重试。'};}
  }
}
