import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
test('status with successful reads and partial receipts is already lossless JSON before rendering',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'x-status-json-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),state=store.state();
  state.lastRead={at:Date.now(),operation:'search',status:'passed',count:5,message:'已读取'};
  state.ledger=[{type:'bookmark',target:'123456',at:Date.now(),status:'pending'}];store.saveState(state);
  const value=store.publicStatus();
  assert.deepEqual(value,JSON.parse(JSON.stringify(value)));
});
