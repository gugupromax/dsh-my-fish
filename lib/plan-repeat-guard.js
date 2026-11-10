import crypto from 'node:crypto';
import {PLAN_INTEGRATION} from './plans.js';
import {sessionIdOf} from './permissions.js';

// Only reasons produced by the My Fish guard itself are classified. Provider
// failures, cancellations and arbitrary tool messages never reach this table.
const PERMANENT_REASONS=new Map([
  ['My Fish 的本地命令权限未开启。','machine-disabled'],
  ['My Fish 的本地文件写入权限未开启。','file-write-disabled'],
  ['My Fish 的浏览器交互权限未开启；请使用只读工具。','browser-disabled'],
  ['My Fish 的子任务委派未开启，或宿主无法核对子任务归属。','delegation-disabled'],
  ['本版定时计划仅允许只读执行。','plan-read-only'],
  ['计划会话只能执行只读任务并通过专用报告回流，不继承个人记录或社交写入权限。','plan-scope'],
  ['定时计划需要用户处理的问题请通过 assistant_plan_report 汇报，不直接弹出交互提问。','plan-no-question'],
  ['定时计划不读取个人看板卡片或关联子卡资料；请使用专用 assistant_plan_report 回报本轮结果。','plan-no-board'],
  ['定时计划暂不使用未限定目录范围的本机检索；请使用原生公共读取工具。','plan-no-grep'],
]);

export class PlanRepeatGuard {
  constructor({getHost,assistant,logger}={}){
    this.getHost=getHost;this.assistant=assistant;this.logger=logger;this.runs=new Map();
  }
  execution(agent){
    const sessionId=sessionIdOf({agent});
    if(typeof sessionId!=='string'||!sessionId)return null;
    try{
      const tasks=this.getHost?.()?.snapshot()?.tasks;
      if(!Array.isArray(tasks))return null;
      const candidates=[];
      for(const task of tasks){
        const marker=task?.integrations?.[PLAN_INTEGRATION];
        if(marker?.kind!=='personal-plan'||marker?.version!==1||typeof marker.fingerprint!=='string'||!Array.isArray(task.executions))continue;
        for(const row of task.executions)if(row?.sessionId===sessionId&&row.endedAt===undefined&&typeof row.id==='string'&&row.id)candidates.push({taskId:task.id,executionId:row.id,sessionId});
      }
      return candidates.length===1&&typeof candidates[0].taskId==='string'?candidates[0]:null;
    }catch{return null;}
  }
  record(exec,reason){
    const code=PERMANENT_REASONS.get(reason)??(typeof reason==='string'&&reason.startsWith('该工具尚未纳入 My Fish 权限分类，已拦截；请在普通会话使用宿主权限处理。运行版本：')?'unclassified':undefined);
    if(!code||typeof exec?.callId!=='string'||!exec.callId||typeof exec.name!=='string')return reason;
    const execution=this.execution(exec.agent);if(!execution)return reason;
    const identity=JSON.stringify([execution.taskId,execution.executionId,execution.sessionId]);
    let run=this.runs.get(identity);
    if(!run){
      if(this.runs.size>=1000)this.runs.delete(this.runs.keys().next().value);
      run={...execution,calls:new Set(),counts:new Map(),blocked:false,notified:false};this.runs.set(identity,run);
    }
    if(run.calls.has(exec.callId))return reason;
    run.calls.add(exec.callId);
    const key=JSON.stringify([exec.name,code]),count=(run.counts.get(key)??0)+1;run.counts.set(key,count);
    if(count>=2)run.blocked=true;
    return reason+(count>=2?' 本轮重复受限操作，已请求结束本轮。':' 如无法继续，请报告原因并结束本轮。');
  }
  preStep({agent}={}){
    const execution=this.execution(agent);if(!execution)return;
    const identity=JSON.stringify([execution.taskId,execution.executionId,execution.sessionId]);
    const run=this.runs.get(identity);if(!run?.blocked)return;
    if(!run.notified){
      run.notified=true;
      const key='plan-denial-'+crypto.createHash('sha256').update(identity).digest('hex');
      try{this.assistant?.addNotice({title:'计划需要处理',body:'计划重复尝试了被权限规则拒绝的操作，正在结束本轮。请在看板查看最终状态并核对工具权限。',links:[],key});}
      catch{this.logger?.warn?.('计划停止提示未能保存，请查看看板运行记录。');}
    }
    return {kind:'reject',reason:'计划重复触发相同权限拒绝，结束当前轮次。'};
  }
  observe(session,event){
    if(event?.type!=='turn/end')return;
    const id=session?.id??session?.header?.id;
    for(const [key,run] of this.runs)if(run.sessionId===id)this.runs.delete(key);
  }
}
