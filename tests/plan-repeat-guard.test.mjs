import test from 'node:test';
import assert from 'node:assert/strict';
import {PlanRepeatGuard} from '../lib/plan-repeat-guard.js';

const reason='本版定时计划仅允许只读执行。';
const main={id:'main',session:{id:'main'}},worker={id:'worker',session:{id:'worker'}},other={id:'other',session:{id:'other'}};
const call=(id,agent=worker,name='run_code')=>({callId:id,name,agent});
function fixture(){
  const task={id:'synthetic-plan',schedule:{enabled:true,nextRunAt:987654},executions:[{id:'synthetic-execution',sessionId:'worker',startedAt:1}],integrations:{'dsh-my-fish':{kind:'personal-plan',version:1,fingerprint:'synthetic'}}};
  const notices=[],assistant={addNotice(input){notices.push(structuredClone(input));return {notice:{id:'notice'},deduplicated:false};}};
  const guard=new PlanRepeatGuard({getHost:()=>({snapshot:()=>({tasks:[task]})}),assistant});
  return {task,notices,guard};
}

test('two distinct permanent guard denials stop only the matched open plan and write one notice',()=>{
  const {task,notices,guard}=fixture(),before=structuredClone(task);
  assert.match(guard.record(call('first'),reason),/报告/);
  assert.equal(guard.preStep({agent:worker}),undefined);
  assert.match(guard.record(call('second'),reason),/结束本轮/);
  assert.equal(guard.preStep({agent:other}),undefined);
  assert.equal(guard.preStep({agent:main}),undefined);
  assert.equal(guard.preStep({agent:worker}).kind,'reject');
  assert.equal(guard.preStep({agent:worker}).kind,'reject');
  assert.equal(notices.length,1);assert.match(notices[0].key,/^plan-denial-[a-f0-9]{64}$/);
  assert.deepEqual(task,before,'the guard does not alter the schedule or execution');
});

test('duplicate callbacks, different causes, unknown errors and foreign sessions do not falsely stop a plan',()=>{
  const {guard}=fixture();
  guard.record(call('one'),reason);guard.record(call('one'),reason);
  guard.record(call('two'),'My Fish 的本地文件写入权限未开启。');
  guard.record(call('three',other),reason);
  guard.record(call('four'), 'Synthetic network timeout');
  assert.equal(guard.preStep({agent:worker}),undefined);
});

test('repeated My Fish unclassified tool denial is treated as permanent',()=>{
  const {guard}=fixture();
  const unclassified='该工具尚未纳入 My Fish 权限分类，已拦截；请在普通会话使用宿主权限处理。运行版本：0.0.0；规则：test。';
  guard.record(call('one'),unclassified);guard.record(call('two'),unclassified);
  assert.equal(guard.preStep({agent:worker}).kind,'reject');
});

test('settled, unowned and ambiguous executions are never attributed to the plan',()=>{
  const {task,guard}=fixture();task.executions[0].endedAt=2;
  guard.record(call('one'),reason);guard.record(call('two'),reason);assert.equal(guard.preStep({agent:worker}),undefined);
  delete task.executions[0].endedAt;task.integrations={};
  guard.record(call('three'),reason);guard.record(call('four'),reason);assert.equal(guard.preStep({agent:worker}),undefined);
  task.integrations={'dsh-my-fish':{kind:'personal-plan',version:1,fingerprint:'synthetic'}};
  task.executions.push({id:'other-execution',sessionId:'worker',startedAt:2});
  guard.record(call('five'),reason);guard.record(call('six'),reason);assert.equal(guard.preStep({agent:worker}),undefined);
});

test('a finished turn clears in-memory counters and notice failure still prevents an infinite loop',()=>{
  const {guard,notices}=fixture();guard.record(call('one'),reason);guard.record(call('two'),reason);
  guard.assistant.addNotice=()=>{throw Error('synthetic storage error');};
  assert.equal(guard.preStep({agent:worker}).kind,'reject');assert.equal(notices.length,0);
  guard.observe(worker.session,{type:'turn/end'});
  assert.equal(guard.preStep({agent:worker}),undefined);
  guard.record(call('new-one'),reason);assert.equal(guard.preStep({agent:worker}),undefined);
});
