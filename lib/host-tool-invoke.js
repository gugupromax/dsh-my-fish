/** Invoke nested host tools through their public, guarded execution boundary. */
export function createHostToolInvoker(ctx,{getLoader=()=>ctx.loader}={}){
  let pipeline,lastLoader;
  const loader=()=>{try{return getLoader();}catch{return null;}};
  const modern=()=>typeof ctx.tools?.setExecutor==='function';
  const invoke=async input=>{
    if(!input?.agent||!input.parent)throw Error('宿主嵌套工具调用缺少真实执行来源，未发起搜索');
    if(!modern())return ctx.tools.execute(input);
    const service=loader();if(typeof service?.import!=='function')throw Error('宿主模块加载服务未就绪，未发起搜索');
    if(lastLoader!==service){pipeline=null;lastLoader=service;}
    pipeline??=Promise.resolve().then(()=>service.import('@deepseek-ai/dsh-tools/pipeline')).then(module=>{
      if(typeof module.ToolExecutionPipeline!=='function')throw Error('宿主嵌套工具接口不兼容，未发起搜索');
      return new module.ToolExecutionPipeline(ctx);
    }).catch(error=>{pipeline=null;throw error;});
    const boundary=await pipeline;
    const prepared=await boundary.prepare(input);
    const outcome=prepared.kind==='dispatch'?await boundary.dispatch(prepared.exec):prepared;
    return boundary.complete(prepared.exec,outcome);
  };
  invoke.available=()=>typeof ctx.tools?.get==='function'&&(modern()?typeof loader()?.import==='function':typeof ctx.tools?.execute==='function');
  return invoke;
}
