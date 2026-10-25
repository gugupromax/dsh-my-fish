import test from 'node:test';
import assert from 'node:assert/strict';
import {Social} from '../lib/social.js';

test('social adapter advertises only implemented abilities and preserves platform guards',async()=>{
  const requests=[],engine={read:async(...args)=>{requests.push(args);return {data:[]};},write:async(...args)=>{requests.push(args);return {ok:true};}};
  const store={config:()=>({aiUsername:'fish',transport:'browser',allowBookmarks:false,allowReplies:false,allowMentions:false,mode:'solo'}),state:()=>({identity:{username:'fish'}})};
  const social=new Social(engine,store);
  const capabilities=social.capabilities();assert.deepEqual(capabilities.platforms.map(p=>p.id),['x']);
  assert.equal(capabilities.platforms[0].actions.reply.enabled,false);
  assert.equal(capabilities.platforms[0].actions.reply.liveVerified,false);
  assert.throws(()=>social.search({platform:'bilibili',query:'test'}),/尚未接入/);assert.equal(requests.length,0);
  await social.search({platform:'x',query:'用户自己的词',count:3});assert.deepEqual(requests[0].slice(0,2),['search',{query:'用户自己的词',count:3}]);
  await social.read({platform:'x',reference:'https://x.com/example/status/123456'});assert.equal(requests[1][1].id,'123456');
  assert.throws(()=>social.read({platform:'x',reference:'https://evil.example/status/123456'}),/有效/);
});
