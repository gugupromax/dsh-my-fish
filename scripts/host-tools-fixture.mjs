// Real installed-host execution helpers; never substitute a tool body or guard.
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function hostToolsFixture(hostRoot){
  const load=name=>import(pathToFileURL(path.join(hostRoot,'@deepseek-ai',name,'lib/index.js')).href);
  const sdk=await load('dsh-tools');
  const modern=typeof sdk.ToolRuntime.prototype.setExecutor==='function';
  if(!modern)return {
    modern:false,
    plugins:mode=>[[sdk.ToolRuntime,{mode}]],
    invoke:(ctx,input)=>ctx.tools.execute(input),
    presentation:(ctx,scope)=>ctx.tools.modeFor(scope),
    resolve:async()=>undefined,
    pipeline:ctx=>{
      const scheduler=ctx.tools[sdk.TOOL_RUNTIME_SCHEDULER];
      return {prepare:input=>scheduler.prepare(input),dispatch:exec=>scheduler.dispatch(exec),complete:(exec,outcome)=>outcome.kind==='post-result'?scheduler.finalize(exec,outcome.result):scheduler.finish(exec,outcome.result)};
    },
  };
  const [native,ptc,{ToolExecutionPipeline}]=await Promise.all([load('dsh-tool-executor-native'),load('dsh-tool-executor-ptc'),import(pathToFileURL(path.join(hostRoot,'@deepseek-ai/dsh-tools/lib/pipeline.js')).href)]);
  return {
    modern:true,
    plugins:mode=>[[sdk.ToolRuntime,{}],[mode==='native'?native:ptc,{}]],
    pipeline:ctx=>new ToolExecutionPipeline(ctx),
    resolve:(ctx,agent,signal)=>ctx.tools.resolve({agent,signal,modelSelection:{provider:'synthetic-provider',model:'synthetic-model'}}),
    presentation:(ctx,scope)=>ctx.tools.selectExecutor(scope) instanceof native.NativeToolExecutor?'native':'ptc',
    async invoke(ctx,input){
      if(input.parent){
        const pipeline=new ToolExecutionPipeline(ctx),prepared=await pipeline.prepare(input);
        return pipeline.complete(prepared.exec,prepared.kind==='dispatch'?await pipeline.dispatch(prepared.exec):prepared);
      }
      let settled;
      const ownedSet=input.toolSet===undefined?await ctx.tools.resolve({agent:input.agent,signal:input.signal,modelSelection:{provider:'synthetic-provider',model:'synthetic-model'}}):null;
      const toolSet=input.toolSet??ownedSet;
      const dispose=ctx.on('tools/result',(exec,result)=>{if(exec.callId===input.callId)settled=result;},{global:true});
      try{
        await ctx.tools.execute({agent:input.agent,signal:input.signal,calls:[{type:'tool_call',id:input.callId,name:input.name,arguments:JSON.stringify(input.arguments??{})}],...(toolSet===undefined?{}:{toolSet})});
        if(!settled)throw Error('Installed executor did not publish its settled tool result');
        return settled;
      }finally{dispose();ownedSet?.dispose();}
    },
  };
}
