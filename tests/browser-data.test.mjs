import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, normalizePosts, currentAccountUsername } from '../lib/browser-data.js';

const post={permalink:'https://x.com/ExampleUser/status/2114188667870961738?s=20',text:'  Useful project\nwith evidence.  ',author:'@ExampleUser',datetime:'2026-10-25T04:10:00.000Z',links:['https://github.com/example/project','https://github.com/example/project'],likes:'1.2K'};
test('normalizes a page DTO without losing post identity or multiline text',()=>{
  assert.deepEqual(normalizePost(post),{id:'2114188667870961738',text:'Useful project\nwith evidence.',author:'ExampleUser',url:'https://x.com/ExampleUser/status/2114188667870961738',createdAt:'2026-10-25T04:10:00.000Z',links:['https://github.com/example/project'],likes:1200});
});
test('accepts page-relative permalinks but rejects cross-host, internal and malformed URLs',()=>{
  assert.equal(normalizePost({...post,permalink:'/ExampleUser/status/2114188667870961738'})?.id,'2114188667870961738');
  for(const permalink of ['http://x.com/ExampleUser/status/2114188667870961738','https://evil.example/ExampleUser/status/2114188667870961738','https://x.com.evil.example/ExampleUser/status/2114188667870961738','https://user:pass@x.com/ExampleUser/status/2114188667870961738','https://x.com/i/status/2114188667870961738','//evil.example/ExampleUser/status/2114188667870961738','https://x.com/ExampleUser/../evil/status/2114188667870961738','https://x.com/ExampleUser/status/no-id'])assert.equal(normalizePost({...post,permalink}),null,permalink);
});
test('rejects author conflicts, missing text and overlong content',()=>{
  assert.equal(normalizePost({...post,author:'@DifferentUser'}),null);
  assert.equal(normalizePost({...post,text:' '}),null);
  assert.equal(normalizePost({...post,text:'\u200B\uFEFF'}),null);
  assert.equal(normalizePost({...post,text:'x'.repeat(20001)}),null);
  assert.equal(normalizePost({...post,author:undefined})?.author,'ExampleUser');
});
test('deduplicates by global post id, preserves reading order and limits results',()=>{
  const next={...post,permalink:'https://x.com/ExampleUser/status/2114188667870961739'};
  assert.equal(normalizePosts([post,post,next],{limit:10}).length,2);
  assert.equal(normalizePosts([post,next],{limit:1})[0].id,'2114188667870961738');
  assert.deepEqual(normalizePosts([post],{limit:0}),[]);
  assert.deepEqual(normalizePosts(null),[]);
  assert.equal(normalizePosts(Array.from({length:30},(_,i)=>({...post,permalink:`https://x.com/ExampleUser/status/${2114188000000000000n+BigInt(i)}`})),{limit:50}).length,20);
});
test('keeps unknown counts distinct from zero and filters unsafe links',()=>{
  const row=normalizePost({...post,likes:undefined,datetime:'yesterday',links:['javascript:alert(1)','file:///C:/secret','https://user:pass@example.com/','http://127.0.0.1:3000/','https://github.com/example/project']});
  assert.equal(row.likes,null);assert.equal(row.createdAt,'');assert.deepEqual(row.links,['https://github.com/example/project']);
  assert.equal(normalizePost({...post,likes:'3.4万'}).likes,34000);
  assert.equal(normalizePost({...post,likes:'1,234'}).likes,1234);
  assert.equal(normalizePost({...post,likes:'0'}).likes,0);
  assert.equal(normalizePost({...post,datetime:'2026-02-30T00:00:00Z'}).createdAt,'');
});
test('current identity uses only account switcher and own-profile UI, never post authors',()=>{
  assert.equal(currentAccountUsername({accountSwitcherText:'Fixture Fish\n@fixturefish',profileHref:'https://x.com/fixturefish'}),'fixturefish');
  assert.equal(currentAccountUsername({profileHref:'/fixturefish'}),'fixturefish');
  assert.equal(currentAccountUsername({accountSwitcherText:'Fixture Fish\n@fixturefish'}),'fixturefish');
  assert.equal(currentAccountUsername({author:'fixturefish',text:'@fixturefish'}),null);
  assert.equal(currentAccountUsername({accountSwitcherText:'Fixture Fish'}),null);
  assert.equal(currentAccountUsername({accountSwitcherText:'@first @second'}),null);
  assert.equal(currentAccountUsername({accountSwitcherText:'@first',profileHref:'/second'}),null);
  assert.equal(currentAccountUsername({accountSwitcherText:'@first',profileHref:'https://evil.example/first'}),null);
});
