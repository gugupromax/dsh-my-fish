import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DEFAULTS,Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';

test('published role defaults are a neutral editable template with no preset personal interests or queries',()=>{
  assert.equal(DEFAULTS.name,'My Fish');assert.equal(DEFAULTS.ownerTitle,'你');assert.equal(DEFAULTS.selfClaim,'我');
  assert.deepEqual(DEFAULTS.interests,[]);assert.deepEqual(DEFAULTS.queries,[]);assert.match(DEFAULTS.persona,/角色模板/);
});
test('neutral source defaults do not overwrite a locally saved custom profile',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-local-profile-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),assistant=new AssistantStore(store);
  assert.equal(assistant.profile().name,'My Fish');
  const custom={name:'LOCAL_ONLY_ROLE',ownerTitle:'LOCAL_USER',selfClaim:'LOCAL_SELF',persona:'Synthetic local-only persona',interests:['Synthetic local-only subject']};
  assistant.saveProfile(custom);const raw=fs.readFileSync(assistant.file('profile.json'),'utf8');
  const reloaded=new AssistantStore(new Store(root));assert.deepEqual(reloaded.profile(),{id:'default',...custom});assert.equal(fs.readFileSync(reloaded.file('profile.json'),'utf8'),raw);
});
