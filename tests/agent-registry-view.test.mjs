import test from 'node:test';import assert from 'node:assert/strict';
import {agentRegistryView} from '../lib/agent-registry-view.js';
const agent=id=>({id,session:{id}});
test('new tree-root API recognizes only exact live members and ignores durable parent claims',()=>{
  const main=agent('main'),child=agent('child'),nested=agent('nested'),ordinary={...agent('ordinary'),parentId:main.id};let rows=[main,child,nested,ordinary];
  const roots=new Map([[child,main],[nested,main]]),view=agentRegistryView({list:()=>rows},{rootOf:subject=>roots.get(subject)??subject});
  assert.equal(view.isOwnedBy(child.id,main),true);assert.equal(view.isOwnedBy(nested.id,main),true);assert.equal(view.isOwnedBy(ordinary.id,main),false);
  rows=rows.filter(a=>a!==nested);assert.equal(view.isOwnedBy(nested.id,main),false);assert.equal(view.isOwnedBy(child.id,agent('main')),false);
  assert.equal(view.isOwnedBy(main.id,main),false);assert.equal(view.isOwnedBy(nested.id,agent('main')),false);
});
test('legacy registry identity is preserved and missing ancestry does not advertise a capability',()=>{
  const legacy={list:()=>[],isOwnedBy:()=>true};assert.equal(agentRegistryView(legacy,()=>undefined),legacy);
  const unknown={list:()=>[]};assert.equal(agentRegistryView(unknown),unknown);assert.equal(agentRegistryView(null),null);
});
test('unavailable subagent authority does not grant ancestry',()=>{
  const main=agent('main'),child=agent('child'),view=agentRegistryView({list:()=>[main,child]},{rootOf:()=>{throw Error('Not managed');}});
  assert.equal(view.isOwnedBy(child.id,main),false);
});
