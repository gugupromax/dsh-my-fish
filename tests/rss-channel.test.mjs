import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createRssAdapter,parseFeed,publicAddress,publicRssUrl,validateRssFeeds,fetchPublicFeed} from '../lib/channels/rss.js';
const url='https://feed.example.org/rss.xml',feed={id:'example',name:'Synthetic feed',url};
const rss=(body='A &amp; B')=>`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title><item><title>Example article</title><link>https://article.example.org/post</link><description>${body}</description></item></channel></rss>`;
const exec=id=>({agent:{id,session:{id}}});
test('RSS and Atom parse bounded embedded text, CDATA, namespaces and relative links',()=>{
  assert.equal(parseFeed(rss(),url)[0].text,'A & B');
  const atom=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link href="/post?a=1&amp;b=2"/><content type="html"><![CDATA[<p>Hello <b>reader</b></p><script>do not retain</script>]]></content></entry></feed>`;
  const item=parseFeed(atom,url)[0];assert.equal(item.text,'Hello reader');assert.equal(item.url,'https://feed.example.org/post?a=1&b=2');assert.equal(item.contentKind,'feed-content');
  assert.equal(parseFeed('<feed><entry><title>X</title><link href="https://article.example.org/x"/><content type="xhtml"><div><p>First</p><p>Second</p></div></content></entry></feed>',url)[0].text,'First Second');
  assert.equal(parseFeed('<rss><channel><item><title>T</title><link>https://article.example.org/a</link><content:encoded xmlns:content="urn:content"><![CDATA[Full article]]></content:encoded></item></channel></rss>',url)[0].text,'Full article');
});
test('XML refuses external entities, malformed structures, excessive nesting and unsafe article links',()=>{
  for(const xml of ['<!DOCTYPE rss SYSTEM "file:///private"><rss/>','<!ENTITY x "evil"><rss/>','<rss><channel></rss>','<rss><X></x></rss>','<rss/><rss/>','text<rss/>','<feed>'+('<x>'.repeat(35))+('</x>'.repeat(35))+'</feed>'])assert.throws(()=>parseFeed(xml,url));
  assert.deepEqual(parseFeed(rss().replace('https://article.example.org/post','http://127.0.0.1/private'),url),[]);
  const item=parseFeed(rss('x'.repeat(13000)),url)[0];assert.equal(item.truncated,true);assert.equal(item.text.length,12000);
});
test('feed config rejects private or credential URLs, duplicate IDs and extra fields',()=>{
  assert.deepEqual(validateRssFeeds([feed]),[feed]);for(const u of ['http://example.org/feed','https://127.0.0.1/rss','https://10.0.0.1/rss','https://name:password@example.org/rss','https://feed.example.org:444/rss','https://feed.example.org/rss?%74oken=private'])assert.throws(()=>publicRssUrl(u));
  assert.throws(()=>validateRssFeeds([feed,feed]));assert.throws(()=>validateRssFeeds([{...feed,secret:'extra'}]));
  for(const ip of ['127.0.0.1','10.1.1.1','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('93.184.216.34'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('empty capabilities are honest and discovering candidates does not fetch external articles',async()=>{
  let calls=0;const empty=createRssAdapter({fetchFeed:()=>{calls++;}});assert.equal(empty.capabilities().available,false);await assert.rejects(empty.discover(),/尚未配置/);assert.equal(calls,0);
  const adapter=createRssAdapter({getFeeds:()=>[feed],fetchFeed:async requested=>{calls++;assert.equal(requested,url);return rss();}});
  const found=await adapter.discover({count:1},undefined,exec('main'));assert.equal(found.candidatesOnly,true);assert.equal(found.items.length,1);assert.equal(found.companionReceipts,undefined);assert.equal(found.items[0].text,undefined);
  const read=await adapter.read({reference:found.items[0].reference},undefined,exec('main'));assert.equal(read.items[0].text,'A & B');assert.match(read.scope,/没有读取文章外链/);assert.equal(calls,1);
});
test('read references belong to the last discover, session, configured feed and bounded lifetime',async()=>{
  let now=0,feeds=[feed];const adapter=createRssAdapter({getFeeds:()=>feeds,fetchFeed:async()=>rss(),now:()=>now});const row=(await adapter.discover({},undefined,exec('main'))).items[0];
  await assert.rejects(adapter.read({reference:row.reference},undefined,exec('other')),/有效reference/);feeds=[];await assert.rejects(adapter.read({reference:row.reference},undefined,exec('main')),/有效reference/);feeds=[feed];now=16*60000;await assert.rejects(adapter.read({reference:row.reference},undefined,exec('main')),/有效reference/);
});
test('rotation, concurrency, cancellation and facade visibility enforce limits before requests',async()=>{
  const requests=[];let release;const adapter=createRssAdapter({getFeeds:()=>[feed,{...feed,id:'second',url:'https://second.example.org/feed'}],fetchFeed:async u=>{requests.push(u);if(requests.length===1)await new Promise(r=>release=r);return rss();}});
  const first=adapter.discover();await new Promise(r=>setImmediate(r));await assert.rejects(adapter.discover(),/正在读取/);release();await first;await adapter.discover();assert.deepEqual(requests,[url,'https://second.example.org/feed']);
  await assert.rejects(adapter.discover({count:6}),/1–5/);const abort=new AbortController();abort.abort();await assert.rejects(adapter.discover({},abort.signal));assert.equal(requests.length,2);
  const hidden=createRssAdapter({getFeeds:()=>[feed],getTools:()=>({get:()=>undefined}),fetchFeed:()=>assert.fail()});await assert.rejects(hidden.discover({},undefined,exec('main')),/不可见/);
});
function transport({status=200,body=rss(),headers={},onLookup}={}){
  let requests=0,destroyed=false;
  return {get requests(){return requests;},get destroyed(){return destroyed;},request(requested,options,callback){requests++;assert.equal(requested,url);assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);assert.equal(options.headers['accept-encoding'],'identity');options.lookup('feed.example.org',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);onLookup?.(addresses);});const req=new EventEmitter();req.destroy=()=>{destroyed=true;};req.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.headers={'content-type':'application/rss+xml',...headers};response.statusCode=status;response.destroy=()=>{destroyed=true;};callback(response);response.emit('data',Buffer.from(body));response.emit('end');});return req;}};
}
test('HTTPS transport pins verified DNS answers and omits Cookie; redirects are not followed',async()=>{
  const good=transport();assert.equal(await fetchPublicFeed(url,undefined,{lookup:async()=>[{address:'93.184.216.34'}],request:good.request}),rss());assert.equal(good.requests,1);
  const redirect=transport({status:302});await assert.rejects(fetchPublicFeed(url,undefined,{lookup:async()=>[{address:'93.184.216.34'}],request:redirect.request}),/重定向/);assert.equal(redirect.requests,1);
});
test('transport refuses private DNS, oversized payloads, compression and cancellation',async()=>{
  const req=transport();await assert.rejects(fetchPublicFeed(url,undefined,{lookup:async()=>[{address:'127.0.0.1'}],request:req.request}),/非公开/);assert.equal(req.requests,0);
  for(const options of [{body:'x'.repeat(30)},{headers:{'content-encoding':'gzip'}},{headers:{'content-type':'text/html'}}]){const mock=transport(options);await assert.rejects(fetchPublicFeed(url,undefined,{lookup:async()=>[{address:'93.184.216.34'}],request:mock.request,maxBytes:20}));}
  const abort=new AbortController();const pending=fetchPublicFeed(url,abort.signal,{lookup:()=>new Promise(()=>{}),timeoutMs:1000,request:()=>assert.fail()});abort.abort();await assert.rejects(pending);
});
