import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {CompanionRuntime} from '../lib/companion-runtime.js';
import {GuessGame} from '../lib/guess-game.js';

function fixture(t,{fail=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-guess-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root);store.saveState({...store.state(),sessionId:'main'});const companion=new CompanionStore(store),game=new GuessGame(store,companion),calls=[];
  const scheduler={ensureSession:async()=>({sessionId:'main'})},controller={prompt:async input=>{calls.push(input);if(fail)throw Error('synthetic unknown dispatch');}};
  const runtime=new CompanionRuntime({store,companion,game,scheduler,controller,signal:new AbortController().signal});
  return {store,companion,game,calls,runtime};
}

test('trusted game entry dispatches to the fixed conversation once and locks the round before prompt',async t=>{
  const f=fixture(t),input={requestId:'synthetic-game-request',reference:'BV1GJ411x7h7',game:true};
  const first=await f.runtime.chat(input);assert.equal(first.sessionId,'main');assert.equal(first.queued,true);assert.equal(f.calls.length,1);
  const [round]=f.game.list('main');assert.equal(round.status,'prepare');assert.match(f.calls[0].content[0].text,/assistant_guess/);
  assert.equal((await f.runtime.chat(input)).queued,true);assert.equal(f.calls.length,1);assert.equal(f.game.list('main').length,1);
  await assert.rejects(f.runtime.chat({...input,game:false}),/不能更换/);assert.equal(f.calls.length,1);
});

test('unknown game dispatch remains uncertain without resending or duplicating the round',async t=>{
  const f=fixture(t,{fail:true}),input={requestId:'synthetic-unknown-game',reference:'BV1GJ411x7h7',game:true};
  await assert.rejects(f.runtime.chat(input),/未确认/);assert.equal(f.calls.length,1);
  const replay=await f.runtime.chat(input);assert.equal(replay.uncertain,true);assert.equal(f.calls.length,1);assert.equal(f.game.list('main').length,1);
});
