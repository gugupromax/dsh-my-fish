import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {resolveStoreRoot,Store} from '../lib/store.js';
import {readOptions,installedDependencies,installPlan,executeInstall} from '../scripts/install-local.mjs';
import {packageFiles,stagePackage} from '../scripts/stage-package.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-release-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}

test('fresh installs use my-fish; legacy data remains in place; new storage wins without merging',t=>{
  const home=fixture(t),current=path.join(home,'my-fish'),legacy=path.join(home,'x-whale');
  assert.equal(resolveStoreRoot(home),current);
  fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'state.json'),JSON.stringify({sessionId:'existing-main-session'}));
  assert.equal(resolveStoreRoot(home),legacy);
  const previous=new Store(resolveStoreRoot(home));
  assert.equal(previous.state().sessionId,'existing-main-session');
  assert.equal(fs.existsSync(current),false,'selection must never copy or create user data');
  fs.mkdirSync(current);fs.writeFileSync(path.join(current,'state.json'),JSON.stringify({sessionId:'new-main-session'}));
  assert.equal(new Store(resolveStoreRoot(home)).state().sessionId,'new-main-session');
  assert.equal(previous.state().sessionId,'existing-main-session','existing instances keep a stable data root');
});

test('migration is opt-in and removes legacy before adding the new link',()=>{
  const options=readOptions(['--home','./synthetic-dsh-home']);
  assert.throws(()=>installPlan(options,{'dsh-x-whale':'link:old-source'}),/migrate-legacy/);
  const plan=installPlan({...options,migrateLegacy:true},{'dsh-x-whale':'link:old-source'},'/new-source');
  const calls=[];
  executeInstall(plan,{prepare:()=>calls.push('prepare'),plugin:args=>calls.push(args)});
  assert.deepEqual(calls,['prepare',['remove','dsh-x-whale'],['add','link:/new-source']]);
  assert.equal(plan.userData,'keep-in-place');
});

test('dependency preparation failure never removes the working plugin',()=>{
  const plan=installPlan({...readOptions([]),migrateLegacy:true},{'dsh-x-whale':'link:old-source'});
  const calls=[];
  assert.throws(()=>executeInstall(plan,{prepare:()=>{throw Error('offline');},plugin:args=>calls.push(args)}),/offline/);
  assert.deepEqual(calls,[]);
});

test('migration installation failure is explicit and never claims an unverified rollback',()=>{
  const plan=installPlan({...readOptions([]),migrateLegacy:true},{'dsh-x-whale':'link:old-source'});
  const calls=[];
  assert.throws(()=>executeInstall(plan,{prepare:()=>{},plugin:args=>{calls.push(args);if(args[0]==='add')throw Error('failed');}}),/用户数据未移动/);
  assert.equal(calls.length,2);
});

test('prepare-only does not mutate host and invalid options fail before execution',()=>{
  const options=readOptions(['--prepare-only']);
  const plan=installPlan(options,{'dsh-x-whale':'link:old-source'});
  assert.deepEqual(plan.actions,[]);assert.equal(plan.requiresHostStopped,false);
  assert.throws(()=>readOptions(['--profile','../other']));
  assert.throws(()=>readOptions(['--app','--dry-run']));
  assert.throws(()=>readOptions(['--unknown']));
});

test('installer reads only the selected profile manifest and keeps dependency specifications',t=>{
  const home=fixture(t),profile=path.join(home,'profiles','fixture');
  assert.deepEqual(installedDependencies(home,'fixture'),{});
  fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({dependencies:{'dsh-x-whale':'link:fixture'},optionalDependencies:{other:'1'}}));
  assert.deepEqual(installedDependencies(home,'fixture'),{'dsh-x-whale':'link:fixture',other:'1'});
});

test('public staging excludes runtime data and replaces stale output rather than merging',t=>{
  const project=fixture(t);
  const write=(relative,value='synthetic')=>{const file=path.join(project,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write('package.json','{"name":"dsh-my-fish"}');write('lib/main.js');write('lib/credentials.json');write('lib/.env.local');write('recovery/private.txt');write('node_modules/private.txt');write('docs/README.md');write('scripts/cache.log');
  write('lib/my-fish-location.json');write('lib/my-fish-migration.json');write('lib/.operation.lock');write('lib/.my-fish-migration-synthetic/private.json');write('lib/companion.json');
  assert.deepEqual(packageFiles(project).map(f=>f.split(path.sep).join('/')).sort(),['docs/README.md','lib/main.js','package.json']);
  const target=stagePackage(project);write('dist/dsh-my-fish/stale.json');stagePackage(project);
  assert.equal(fs.existsSync(path.join(target,'stale.json')),false);
  assert.equal(fs.existsSync(path.join(target,'lib','credentials.json')),false);
  assert.equal(fs.existsSync(path.join(target,'recovery')),false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,'PUBLIC_FILES.json'),'utf8')).files.sort(),['docs/README.md','lib/main.js','package.json']);
});

test('package, lockfile and Cordis identity agree on the release name',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(pkg.name,'dsh-my-fish');assert.equal(lock.name,pkg.name);assert.equal(lock.packages[''].name,pkg.name);
  assert.equal(pkg.version,'0.6.0');assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
  assert.match(fs.readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8'),/id: dsh-my-fish\s+name: dsh-my-fish/);
});
