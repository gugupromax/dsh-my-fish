import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {inspectCompanionDependencies} from '../scripts/check-companion-deps.mjs';
test('dependency report reads only selected package metadata and never returns specs, paths or credentials',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fish-deps-'));t.after(()=>{assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});});
 const selected=path.join(temp,'profiles','fixture');fs.mkdirSync(selected,{recursive:true});fs.writeFileSync(path.join(selected,'package.json'),JSON.stringify({dependencies:{'dsh-pet':'https://user:SYNTHETIC_SENTINEL@example.invalid/private.tgz'}}));
 const value=inspectCompanionDependencies(temp,'fixture');assert.equal(value.plugins[0].declared,true);assert.equal(value.plugins[0].packagePresent,false);assert.ok(!JSON.stringify(value).includes('SYNTHETIC_SENTINEL'));assert.ok(!JSON.stringify(value).includes(temp));
 assert.equal(inspectCompanionDependencies(temp,'other').plugins[0].declared,false);assert.throws(()=>inspectCompanionDependencies(temp,'../other'));
});
