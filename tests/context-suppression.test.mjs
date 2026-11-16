import test from 'node:test';
import assert from 'node:assert/strict';
import explore from '../lib/explore-preset.js';
import plan from '../lib/plan-runtime.js';

for (const preset of [explore, plan]) {
  test(`${preset.name} requires scoped runtime-context suppression`, () => {
    let suppressed = 0, restrictions = 0;
    const ctx = {
      systemPrompt: {suppressRuntimeContext: () => { suppressed++; }},
      tools: {definitions: () => [], get: () => undefined, restrict: () => { restrictions++; return () => {}; }},
      on: () => {}, effect: () => {},
    };
    assert.throws(() => preset.apply({...ctx, systemPrompt: {}}), /上下文隔离接口/);
    assert.equal(restrictions, 0, 'missing protection must fail before exposing tools');
    preset.apply(ctx);
    assert.equal(suppressed, 1);
    assert.equal(restrictions, 1);
  });
}
