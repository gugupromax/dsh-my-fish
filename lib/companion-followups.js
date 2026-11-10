import crypto from 'node:crypto';
import {atomic,readJSON} from './store.js';

const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Durable notification deduplication, separate from inbox retention. */
export class CompanionFollowups {
  constructor(store,companion,assistant){this.store=store;this.companion=companion;this.assistant=assistant;}
  file(){return this.store.file('assistant/followups.json');}
  state(){
    const value=readJSON(this.file(),{version:1,entries:[]});
    if(value?.version!==1||!Array.isArray(value.entries)||value.entries.some(row=>!row||typeof row.key!=='string'||typeof row.threadId!=='string'||typeof row.sessionId!=='string'||!Number.isSafeInteger(row.at)||!['prepared','published'].includes(row.status)))throw Error('主动续聊记录格式无效');
    return value;
  }
  publish(input,sessionId,run){
    const quiet=reason=>({notified:false,deduplicated:true,reason});
    const state=this.store.state(),settings=this.assistant.settings();
    if(!settings.enabled||settings.snoozeUntil>Date.now()||state.sessionRecovery?.followupPaused)return quiet('自主跟进目前已暂停');
    if(!run||run.manual!==false||!Number.isSafeInteger(run.at)||state.sessionId!==sessionId||state.activeRun?.id!==run.id||state.activeRun.sessionId!==sessionId)return quiet('没有可确认的自主探索轮次');
    const snapshot=this.companion.snapshot();
    const thread=snapshot.threads.find(row=>row.id===input.threadId&&row.status==='active');
    const message=snapshot.recentUserMessages.find(row=>row.id===input.messageId&&row.sessionId===sessionId);
    const position=thread?.userPositions.find(row=>row.messageId===message?.id&&message.text.includes(row.quote));
    const receipt=snapshot.receipts.find(row=>row.id===input.receiptId&&row.sessionId===sessionId);
    const episode=thread?.episodes.at(-1);
    if(!thread||!message||!position||!receipt||receipt.operation==='search'||!episode||episode.runId!==run.id||!episode.sourceIds.includes(receipt.id)||receipt.readAt<run.at)return quiet('没有关联本轮新读取资料及用户原话');
    if(thread.userPositions.some(row=>row.at>position.at))return quiet('已有更新的用户回应，请先重新核对');
    const fingerprint=hash([thread.id,receipt.platform,receipt.operation,receipt.reference,receipt.url,receipt.excerpt,receipt.truncated]);
    const key='fish-followup:'+fingerprint,ledger=this.state(),existing=ledger.entries.find(row=>row.key===key);
    if(existing?.status==='published')return quiet('这条发现已分享过');
    if(existing?.status==='prepared'){
      if(this.assistant.notices?.().some(row=>row.key===key)){existing.status='published';atomic(this.file(),ledger);}
      return quiet('上次发现的投递结果尚未确认，请先核对动态盒，未重复发送');
    }
    const last=ledger.entries.filter(row=>row.threadId===thread.id&&row.sessionId===sessionId&&row.status==='published').at(-1);
    if(last&&!thread.userPositions.some(row=>row.at>last.at&&snapshot.recentUserMessages.some(msg=>msg.id===row.messageId&&msg.sessionId===sessionId&&msg.text.includes(row.quote))))return quiet('这个话题还有一条发现等待回应');
    if(input.links?.some(link=>link.url!==receipt.url))return quiet('分享链接与实际读取来源不一致');
    const entry={key,threadId:thread.id,sessionId,at:Date.now(),status:'prepared'};ledger.entries.push(entry);atomic(this.file(),ledger);
    const result=this.assistant.addNotice({title:input.title,body:input.summary,links:[{url:receipt.url,title:receipt.title||'读取来源'}],key});
    entry.status='published';atomic(this.file(),ledger);
    return {notified:!result.deduplicated,deduplicated:result.deduplicated,notice:result.notice,reason:result.deduplicated?'同一发现已在动态盒':'新发现已写入动态盒'};
  }
}
