// Verify against the installed DSH SDK in an isolated, synthetic Cordis runtime.
// Run with ELECTRON_RUN_AS_NODE=1 and the installed DSH executable; never starts the GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../lib/store.js';
import {AssistantStore} from '../lib/assistant-store.js';
import {CompanionStore} from '../lib/companion-store.js';
import {registerPersonalContext} from '../lib/assistant-context.js';

const hostRoot=process.argv[2]||'D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules';
const hostImport=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-personal-host-'));
const fibers=[];
let cleanupComplete=false;
try {
  const [{Context},{default:SystemPrompt,renderContextSnapshot}]=await Promise.all([
    hostImport('cordis'),hostImport('dsh-system-prompt'),
  ]);
  const store=new Store(temporaryRoot),assistant=new AssistantStore(store).initialize();
  assistant.saveProfile({name:'HOST_PERSONA_SENTINEL',replyStyle:'concise',emojiStyle:'none'});
  store.saveState({...store.state(),sessionId:'synthetic-personal-session',activeRun:{id:'synthetic-active-run',query:'host-memory-probe'}});
  const companion=new CompanionStore(store),interest=companion.start({title:'SYNTHETIC_CONTINUING_INTEREST',openQuestion:'A synthetic unanswered question'},'synthetic-personal-session');
  const memory=assistant.remember({text:'host-memory-probe original-synthetic-value',category:'fact',source:'Synthetic local host integration fixture'});
  assistant.remember({text:'host-memory-probe EXPIRED_SYNTHETIC_VALUE',category:'fact',source:'Synthetic expired fixture',expiresAt:Date.now()-1});
  const ctx=new Context();
  const promptFiber=ctx.plugin(SystemPrompt,{includeHarnessIdentity:false});fibers.push(promptFiber);
  await promptFiber;
  const personalFiber=ctx.plugin({name:'synthetic-personal-context-verifier',apply:child=>registerPersonalContext(child,store,assistant,companion)});fibers.push(personalFiber);
  await personalFiber;
  // Optional injection is a nested fiber; allow its already-scheduled activation to settle.
  await new Promise(resolve=>setImmediate(resolve));
  const assemble=async id=>{
    const agent={id,session:{id,header:{id}}};
    return ctx.systemPrompt.assemble({agent,scope:agent,signal:new AbortController().signal});
  };
  const visible=assembly=>renderContextSnapshot(assembly);
  const ordinary=visible(await assemble('synthetic-ordinary-session'));
  assert.ok(!ordinary.includes('HOST_PERSONA_SENTINEL'));
  assert.ok(!ordinary.includes('original-synthetic-value'));
  assert.ok(!ordinary.includes('说话风格：简短'));
  assert.ok(!ordinary.includes('SYNTHETIC_CONTINUING_INTEREST'));
  const initial=visible(await assemble('synthetic-personal-session'));
  assert.ok(initial.includes('HOST_PERSONA_SENTINEL'));
  assert.ok(initial.includes('original-synthetic-value'));
  assert.ok(initial.includes('说话风格：简短'));assert.ok(initial.includes('表情符号：不使用'));
  assert.ok(!initial.includes('EXPIRED_SYNTHETIC_VALUE'));
  assert.ok(initial.includes('SYNTHETIC_CONTINUING_INTEREST'));assert.ok(initial.includes('不要把每次聊天都写成目标'));
  assistant.remember({id:memory.id,text:'host-memory-probe corrected-synthetic-value'});
  assistant.saveProfile({replyStyle:'formal'});
  const corrected=visible(await assemble('synthetic-personal-session'));
  assert.ok(corrected.includes('corrected-synthetic-value'));
  assert.ok(!corrected.includes('original-synthetic-value'));
  assert.ok(corrected.includes('说话风格：正式'));assert.ok(!corrected.includes('说话风格：简短'));
  const disposeComplete=ctx.systemPrompt.section({name:'synthetic:complete-preset',order:0,complete:true,text:'SYNTHETIC_COMPLETE_PROMPT'});
  const disposeSuppression=ctx.systemPrompt.suppressRuntimeContext();
  try {
    const complete=await assemble('synthetic-personal-session');
    assert.deepEqual(complete.sections.map(section=>section.text),['SYNTHETIC_COMPLETE_PROMPT']);
    assert.ok(visible(complete).includes('corrected-synthetic-value'));
    assert.ok(!visible(await assemble('synthetic-ordinary-session')).includes('HOST_PERSONA_SENTINEL'));
    assistant.forget(memory.id);
    const forgotten=visible(await assemble('synthetic-personal-session'));
    assert.ok(!forgotten.includes('corrected-synthetic-value'));
    assert.ok(!forgotten.includes('original-synthetic-value'));
    companion.setStatus(interest.id,'paused');assert.ok(!visible(await assemble('synthetic-personal-session')).includes('SYNTHETIC_CONTINUING_INTEREST'));
  } finally {
    await disposeSuppression();await disposeComplete();
  }
  await personalFiber.dispose();
  assert.ok(!visible(await assemble('synthetic-personal-session')).includes('HOST_PERSONA_SENTINEL'));
  cleanupComplete=true;
} catch(error) {
  console.error(JSON.stringify({hostPersonalContext:'failed',error:String(error.message)}));
  process.exitCode=1;
} finally {
  for(const fiber of fibers.reverse())await fiber.dispose();
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(temporaryRoot));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Temporary cleanup target must remain under the OS temporary directory');
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
}
if(cleanupComplete)console.log(JSON.stringify({hostPersonalContext:'passed',ordinarySessionIsolation:'passed',companionIsolationAndPauseRefresh:'passed',styleIsolationAndRefresh:'passed',expiredMemoryExclusion:'passed',currentMemory:'passed',correctionRefresh:'passed',forgetRefresh:'passed',completePresetWithSuppression:'passed',disposal:'passed',temporaryDataCleanup:'passed'}));
