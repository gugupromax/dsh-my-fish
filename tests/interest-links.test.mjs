import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {InterestLinks,InterestLinkOperations} from '../lib/interest-links.js';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fish-links-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let main='main-a',fail=false;
 const store={file:p=>path.join(root,p),state:()=>({sessionId:main})};let topics=[{id:'thread-a',status:'active'},{id:'thread-b',status:'active'}],interests=[{id:'interest-a',mainSessionId:'main-a',status:'active'},{id:'interest-b',mainSessionId:'main-b',status:'active'}];
 const companion={snapshot:()=>({threads:structuredClone(topics)}),setStatus:(id,status)=>{topics.find(x=>x.id===id).status=status;},forget:id=>{topics=topics.filter(x=>x.id!==id);}};
 const experiences={interests:session=>structuredClone(interests.filter(x=>x.mainSessionId===session)),setInterest:(id,status)=>{if(fail)throw Error('synthetic failure');interests.find(x=>x.id===id).status=status;},forget:id=>{if(fail)throw Error('synthetic failure');interests=interests.filter(x=>x.id!==id);}};
 const links=new InterestLinks({store,companion,experiences,now:()=>123}),ops=new InterestLinkOperations({links});
 const perform=ops.perform.bind(ops);ops.perform=args=>perform({requestId:'request-'+args.action,...args});
 return {links,ops,companion,experiences,setMain:id=>main=id,setFail:value=>fail=value};
}
test('link is explicit, one-to-one, scoped to main; deleted endpoints disappear without mutation',t=>{
 const f=fixture(t);assert.throws(()=>f.links.link({threadId:'thread-a',interestId:'interest-b'}),/不属于/);assert.deepEqual(f.links.list(),[]);
 f.links.link({threadId:'thread-a',interestId:'interest-a'});assert.equal(f.links.link({threadId:'thread-a',interestId:'interest-a'}).unchanged,true);
 assert.throws(()=>f.links.link({threadId:'thread-b',interestId:'interest-a'}),/已有/);f.setMain('main-b');assert.deepEqual(f.links.list(),[]);f.setMain('main-a');
 f.companion.forget('thread-a');assert.deepEqual(f.links.list(),[]);assert.equal(f.links.unlink({threadId:'thread-a',interestId:'interest-a'}).ok,true);
});
test('explicit listing exposes missing endpoints within the current session for manual unlink',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});f.companion.forget('thread-a');
 assert.deepEqual(f.links.list(),[]);const rows=f.links.list({includeMissing:true});assert.equal(rows.length,1);assert.equal(rows[0].threadMissing,true);assert.equal(rows[0].interestMissing,false);assert.equal(rows[0].conflict,false);
 f.setMain('main-b');assert.deepEqual(f.links.list({includeMissing:true}),[]);f.setMain('main-a');assert.equal(f.links.unlink({threadId:'thread-a',interestId:'interest-a'}).ok,true);assert.deepEqual(f.links.list({includeMissing:true}),[]);
});
test('legacy cross-session shared thread conflict is reported and prevents destructive operations',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});const value=f.links.state();value.links.push({mainSessionId:'main-b',threadId:'thread-a',interestId:'interest-b',at:124});fs.writeFileSync(f.links.file(),JSON.stringify(value));
 assert.equal(f.links.list({includeMissing:true})[0].conflict,true);
 for(const action of ['pause','resume','forget'])assert.throws(()=>f.ops.perform({threadId:'thread-a',interestId:'interest-a',action}),/解除冲突/);
 assert.equal(f.ops.pending(),null);assert.equal(f.companion.snapshot().threads.length,2);assert.equal(f.experiences.interests('main-a').length,1);
 f.setMain('main-b');assert.equal(f.links.list({includeMissing:true})[0].conflict,true);f.links.unlink({threadId:'thread-a',interestId:'interest-b'});f.setMain('main-a');assert.equal(f.links.list({includeMissing:true})[0].conflict,false);
});
test('full completion journal archives first and preserves replay after interrupted compaction',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});
 const completed=Array.from({length:5000},(_,i)=>({mainSessionId:'main-a',threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'old-'+i}));
 fs.mkdirSync(path.dirname(f.ops.file()),{recursive:true});fs.writeFileSync(f.ops.file(),JSON.stringify({version:1,pending:null,completed}));
 // Simulate a crash after archive write and before the journal was shortened.
 fs.writeFileSync(f.ops.archiveFile(),JSON.stringify({version:1,completed:completed.slice(0,500)}));
 const replay=f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'old-0'});assert.equal(replay.deduplicated,true);
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'new-request'}).ok,true);
 assert.equal(f.ops.archive().completed.length,500);assert.equal(f.ops.journal().completed.length,4501);assert.equal(f.ops.pending(),null);
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'old-0'}).deduplicated,true);
 assert.throws(()=>f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'resume',requestId:'old-0'}),/不能用于其他/);
});
test('partial linked pause survives reload, blocks conflicting actions and completes on explicit retry',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});f.setFail(true);
 assert.deepEqual(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause'}),{ok:false,pending:true,action:'pause',threadDone:true,interestDone:false,error:'操作未完全完成，请在原会话核对并重试。'});
 assert.throws(()=>f.links.unlink({threadId:'thread-a',interestId:'interest-a'}),/尚未完成/);assert.throws(()=>f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'resume'}),/未完成/);
 f.setMain('main-b');assert.throws(()=>f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause'}),/未完成/);f.setMain('main-a');f.setFail(false);
 assert.equal(new InterestLinkOperations({links:f.links}).perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'request-pause'}).ok,true);assert.equal(f.experiences.interests('main-a')[0].status,'paused');assert.equal(f.ops.pending(),null);
});
test('partial forget retries only explicitly linked targets, with no false success on changed state',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});f.setFail(true);
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'forget'}).pending,true);assert.equal(f.companion.snapshot().threads.some(x=>x.id==='thread-a'),false);
 f.setFail(false);assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'forget'}).ok,true);assert.equal(f.companion.snapshot().threads.some(x=>x.id==='thread-b'),true);assert.equal(f.experiences.interests('main-b').length,1);assert.deepEqual(f.links.list(),[]);
});
test('crash after first write can replay without duplicating or claiming success before both match',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});const save=f.ops.save.bind(f.ops);let count=0;
 f.ops.save=p=>{if(++count===2)throw Error('synthetic interruption');return save(p);};
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause'}).pending,true);
 const reloaded=new InterestLinkOperations({links:f.links});assert.equal(reloaded.pending().threadDone,false);
 assert.equal(reloaded.perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'request-pause'}).ok,true);
 assert.equal(f.companion.snapshot().threads[0].status,'paused');assert.equal(f.experiences.interests('main-a')[0].status,'paused');
});
test('lost forget response replays the exact persisted request but rejects ID reuse',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});
 const request={threadId:'thread-a',interestId:'interest-a',action:'forget',requestId:'lost-response'};
 assert.equal(f.ops.perform(request).ok,true);const replay=new InterestLinkOperations({links:f.links}).perform(request);
 assert.equal(replay.ok,true);assert.equal(replay.deduplicated,true);
 assert.deepEqual(f.ops.recent('main-a'),[{requestId:'lost-response',threadId:'thread-a',interestId:'interest-a',action:'forget'}]);assert.deepEqual(f.ops.recent('main-b'),[]);
 assert.throws(()=>f.ops.perform({...request,action:'pause'}),/不能用于其他/);
 assert.throws(()=>f.ops.perform({...request,requestId:'different-request'}),/关联不存在/);
});
test('legacy unfinished operations without requestId accept the exact retry and preserve replay evidence',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});
 f.ops.save({mainSessionId:'main-a',threadId:'thread-a',interestId:'interest-a',action:'pause',threadDone:false,interestDone:false});
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'legacy-retry'}).ok,true);
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause',requestId:'legacy-retry'}).deduplicated,true);
});
test('one shared thread cannot be linked across sessions and link requires matching active or paused states',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});f.setMain('main-b');
 assert.throws(()=>f.links.link({threadId:'thread-a',interestId:'interest-b'}),/已有其他/);
 f.companion.setStatus('thread-b','paused');assert.throws(()=>f.links.link({threadId:'thread-b',interestId:'interest-b'}),/状态/);
 f.companion.setStatus('thread-b','settled');f.experiences.setInterest('interest-b','settled');assert.throws(()=>f.links.link({threadId:'thread-b',interestId:'interest-b'}),/状态/);
});
test('partial operation never reports success if the first side changes independently',t=>{
 const f=fixture(t);f.links.link({threadId:'thread-a',interestId:'interest-a'});f.setFail(true);
 assert.equal(f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause'}).pending,true);
 f.companion.setStatus('thread-a','active');f.setFail(false);
 const result=f.ops.perform({threadId:'thread-a',interestId:'interest-a',action:'pause'});assert.equal(result.ok,false);assert.equal(result.pending,true);
});
