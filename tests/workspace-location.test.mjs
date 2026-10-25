import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store,resolveStoreRoot,atomic} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';

test('workspace locator survives reload and takes precedence over the two default directories',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-location-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const target=path.join(home,'custom-data');fs.mkdirSync(target);fs.mkdirSync(path.join(home,'my-fish'));fs.mkdirSync(path.join(home,'x-whale'));
  atomic(path.join(home,'my-fish-location.json'),{version:1,path:target});
  assert.equal(resolveStoreRoot(home),target);assert.equal(new Store(undefined,{home}).root,target);
  const store=new Store(target,{home});assert.equal(store.home,home);
});
test('invalid or missing configured workspace fails without creating a substitute empty account',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-location-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  for(const value of [{version:2,path:home},{version:1,path:'relative'},{version:1,path:path.join(home,'absent')}]){
    atomic(path.join(home,'my-fish-location.json'),value);assert.throws(()=>resolveStoreRoot(home),/工作区/);
  }
  assert.equal(fs.existsSync(path.join(home,'my-fish')),false);
});
test('existing assistant store follows the committed Store root after relocation',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-location-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const store=new Store(path.join(home,'old'),{home}),assistant=new AssistantStore(store);
  assistant.remember({text:'synthetic original memory',source:'synthetic fixture'});
  const next=path.join(home,'next');fs.cpSync(store.root,next,{recursive:true});store.root=next;
  assistant.remember({text:'synthetic next memory',source:'synthetic fixture'});
  assert.equal(assistant.memories().length,2);assert.equal(new AssistantStore(new Store(path.join(home,'old'))).memories().length,1);
});
