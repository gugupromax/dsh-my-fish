import test from 'node:test';
import assert from 'node:assert/strict';
import {launchOptions,cookieObjects,authorizeMutation,authorizeGraphQL,acknowledgePost,browserBridge} from '../lib/browser-bridge.js';

test('browser uses installed Chrome with sandbox and no user profile or security-bypass arguments',()=>{
  const options=launchOptions({browserHeadless:false,proxy:'http://127.0.0.1:7897'});
  assert.equal(options.channel,'chrome');assert.equal(options.chromiumSandbox,true);assert.equal(options.headless,false);
  assert.equal(options.args,undefined);assert.equal(options.userDataDir,undefined);
  assert.deepEqual(options.proxy,{server:'http://127.0.0.1:7897'});
});
test('cookie injection is domain-bound and does not export browser state',()=>{
  const cookies=cookieObjects({auth_token:'FAKE_AUTH',ct0:'FAKE_CSRF'});
  assert.equal(cookies.length,2);assert.ok(cookies.every(c=>c.domain==='.x.com'&&c.path==='/'&&c.secure));
  assert.equal(cookies.find(c=>c.name==='auth_token').httpOnly,true);
});
test('read-only context cannot send any mutation',()=>{
  for(const op of ['CreateTweet','CreateBookmark','FavoriteTweet','DeleteTweet'])assert.equal(authorizeMutation(op,{tweet_id:'123456'},null,{sent:false}),false);
});
test('unknown GraphQL POST actions are denied while ordinary page reads remain available',()=>{
  assert.equal(authorizeGraphQL('POST','FuturePublishOperation',{},null,{sent:false}),false);
  assert.equal(authorizeGraphQL('POST','HomeTimeline',{},null,{sent:false}),true);
  assert.equal(authorizeGraphQL('GET','SearchTimeline',undefined,null,{sent:false}),true);
  assert.equal(authorizeGraphQL('GET','CreateTweet',{},null,{sent:false}),false);
});
test('backend refuses unauthorized writing before reading Cookie or launching a browser',async()=>{
  let cookieReads=0;
  const store={config:()=>({aiUsername:'fixture_bot',mode:'solo',allowReplies:false}),credentials:()=>{cookieReads++;throw Error('must not read');}};
  await assert.rejects(()=>browserBridge(store,'reply',{id:'123456',text:'hello'}),/尚未获得/);
  assert.equal(cookieReads,0);
});
test('publishing gate binds body and parent and permits one send only',()=>{
  const expected={operation:'reply',text:'A specific question',replyTo:'123456'},gate={sent:false};
  assert.equal(authorizeMutation('CreateTweet',{tweet_text:expected.text,reply:{in_reply_to_tweet_id:'999999'}},expected,gate),false);
  assert.equal(authorizeMutation('CreateTweet',{tweet_text:'unrelated',reply:{in_reply_to_tweet_id:'123456'}},expected,gate),false);
  const vars={tweet_text:expected.text,reply:{in_reply_to_tweet_id:'123456'},media:{media_entities:[]}};
  assert.equal(authorizeMutation('CreateTweet',vars,expected,gate),true);
  assert.equal(authorizeMutation('CreateTweet',vars,expected,gate),false);
});
test('mention cannot become a reply; bookmark cannot toggle or target another post',()=>{
  assert.equal(authorizeMutation('CreateTweet',{tweet_text:'@fixture_owner a link',reply:{in_reply_to_tweet_id:'123456'}},{operation:'mention',text:'@fixture_owner a link'},{sent:false}),false);
  const expected={operation:'bookmark',id:'123456'};
  assert.equal(authorizeMutation('DeleteBookmark',{tweet_id:'123456'},expected,{sent:false}),false);
  assert.equal(authorizeMutation('CreateBookmark',{tweet_id:'999999'},expected,{sent:false}),false);
  assert.equal(authorizeMutation('CreateBookmark',{tweet_id:'123456'},expected,{sent:false}),true);
});
function receipt(){return {data:{create_tweet:{tweet_results:{result:{rest_id:'999999',legacy:{full_text:'A question',in_reply_to_status_id_str:'123456',entities:{urls:[]}},core:{user_results:{result:{legacy:{screen_name:'fixture_bot'}}}}}}}}};}
test('post acknowledgement needs new id, exact account, text and reply parent',()=>{
  const expected={operation:'reply',text:'A question',replyTo:'123456'};
  assert.equal(acknowledgePost(receipt(),expected,'fixture_bot').id,'999999');
  assert.equal(acknowledgePost(receipt(),expected,'other'),null);
  assert.equal(acknowledgePost(receipt(),expected,'fixture_bot',['999999']),null);
  assert.equal(acknowledgePost(receipt(),{...expected,text:'Other'},'fixture_bot'),null);
  assert.equal(acknowledgePost(receipt(),{...expected,replyTo:'888888'},'fixture_bot'),null);
});
