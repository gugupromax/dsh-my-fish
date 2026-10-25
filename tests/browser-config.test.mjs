import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, Store, validateConfig } from '../lib/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('old configs without browser fields adopt visible independent-browser defaults without enabling writes',()=>{
  const legacy=structuredClone(DEFAULTS);
  delete legacy.transport;delete legacy.browserPath;delete legacy.browserHeadless;
  const got=validateConfig(legacy);
  assert.equal(got.transport,'browser');assert.equal(got.browserPath,'');assert.equal(got.browserHeadless,false);
  for(const key of ['enabled','allowBookmarks','allowReplies','allowMentions'])assert.equal(got[key],false);
});
test('transport is explicit and only browser and direct_api are accepted',()=>{
  assert.equal(validateConfig({...DEFAULTS,transport:'browser'}).transport,'browser');
  assert.equal(validateConfig({...DEFAULTS,transport:'direct_api'}).transport,'direct_api');
  assert.throws(()=>validateConfig({...DEFAULTS,transport:'auto'}),/接入方式/);
  assert.throws(()=>validateConfig({...DEFAULTS,transport:null}),/接入方式/);
});
test('browser path is a string and headless is a strict boolean',()=>{
  assert.equal(validateConfig({...DEFAULTS,browserPath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',browserHeadless:true}).browserHeadless,true);
  assert.throws(()=>validateConfig({...DEFAULTS,browserPath:{path:'chrome.exe'}}),/browserPath/);
  assert.throws(()=>validateConfig({...DEFAULTS,browserHeadless:'false'}),/browserHeadless/);
});
test('connection changes invalidate old identity and diagnosis without changing write permissions',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'x-whale-connection-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root);store.saveConfig({...DEFAULTS,aiUsername:'fixture_bot'});
  for(const update of [{aiUsername:'other_bot'},{transport:'direct_api'},{browserPath:'C:\\Chrome\\chrome.exe'},{browserHeadless:true},{proxy:'http://127.0.0.1:7890'}]){
    const s=store.state();s.identity={username:store.config().aiUsername};s.lastDiagnosis={status:'passed'};s.ledger=[{status:'uncertain',id:'preserve'}];s.inflight='preserve';store.saveState(s);
    const config=store.saveConfig({...store.config(),...update});
    assert.equal(store.state().identity,null);assert.equal(store.state().lastDiagnosis,null);
    assert.equal(store.state().inflight,'preserve');assert.equal(store.state().ledger[0].id,'preserve');
    for(const key of ['enabled','allowBookmarks','allowReplies','allowMentions'])assert.equal(config[key],false);
  }
});
test('unrelated preference edits keep a valid connection check',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'x-whale-preference-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root);store.saveConfig({...DEFAULTS,aiUsername:'fixture_bot'});
  const s=store.state();s.identity={username:'fixture_bot'};s.lastDiagnosis={status:'passed'};store.saveState(s);
  store.saveConfig({...store.config(),name:'Fixture Role B'});
  assert.equal(store.state().identity.username,'fixture_bot');assert.equal(store.state().lastDiagnosis.status,'passed');
});
