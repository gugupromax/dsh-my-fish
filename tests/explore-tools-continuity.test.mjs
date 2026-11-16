import test from 'node:test';import assert from 'node:assert/strict';import {registerExploreTools} from '../lib/explore-tools.js';
function fixture(){
  let main='main',status='active',exists=true,cancelResult={ok:true,cancelled:1},reject=false,linked=false;const calls=[];let definition;
  const store={state:()=>({sessionId:main})},experiences={interests:id=>exists&&id==='main'?[{id:'topic',status}]:[],setInterest:(_id,value)=>{calls.push('set:'+value);status=value;return {id:'topic',status};},forget:()=>{calls.push('forget');exists=false;return {ok:true,id:'topic'};}};
  const exploration={owns:()=>false,cancelQueuedForInterest:async id=>{calls.push('cancel:'+id);if(reject)throw Error('synthetic');return cancelResult;}};
  registerExploreTools({tool:(_n,_d,_p,fn)=>definition=fn,exploration,experiences,companion:{},store,engine:{serial:fn=>fn()},requirePersonal:()=>{},assertUnlinked:()=>{calls.push('check');if(linked)throw Error('linked');}});
  const run=(action,id='topic')=>definition({action,interestId:id},null,{});
  return {run,calls,setCancel:value=>cancelResult=value,setReject:value=>reject=value,setMain:value=>main=value,setLinked:value=>linked=value,exploration};
}
test('pause and forget verify before cancelling and retain exact acknowledgement',async()=>{
  for(const action of ['pause','forget']){const f=fixture(),result=await f.run(action);assert.deepEqual(f.calls,['check','cancel:topic','check',action==='pause'?'set:paused':'forget']);assert.equal(result.openingCancellation.cancelled,1);assert.equal(result.ok,true);}
});
test('unconfirmed cancellation does not claim it was withdrawn, and resume never cancels',async()=>{
  const f=fixture();f.setCancel({ok:false,uncertain:true,note:'已经领取，请核对'});const result=await f.run('pause');assert.equal(result.interest.status,'paused');assert.match(result.note,/已经领取/);assert.equal(result.openingCancellation.uncertain,true);
  f.calls.length=0;await f.run('resume');assert.deepEqual(f.calls,['check','set:active']);
  const g=fixture();g.setReject(true);const failure=await g.run('forget');assert.equal(failure.ok,true);assert.match(failure.note,/无法确认/);assert.equal(failure.openingCancellation.uncertain,true);
});
test('unowned or linked interest cannot trigger queue cancellation; main change prevents mutation',async()=>{
  const f=fixture();await assert.rejects(()=>f.run('pause','foreign'),/不属于/);assert.deepEqual(f.calls,[]);
  const h=fixture();h.setLinked(true);await assert.rejects(()=>h.run('pause'),/linked/);assert.deepEqual(h.calls,['check']);
  const g=fixture();g.exploration.cancelQueuedForInterest=async()=>{g.calls.push('cancel');g.setMain('other');return {ok:true,cancelled:1};};await assert.rejects(()=>g.run('pause'),/主会话已变化/);assert.deepEqual(g.calls,['check','cancel']);
});
