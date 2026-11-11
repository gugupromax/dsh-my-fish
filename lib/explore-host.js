import {EXPLORE_PRESET_ID} from './explore-preset.js';

const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(value);

/** Uses ordinary public host sessions; no hidden-session capability is assumed. */
export class ExploreHost{
  constructor({getController,getRegistry,getPresets}={}){Object.assign(this,{getController,getRegistry,getPresets});}
  identity(sessionId){
    const registry=this.getRegistry?.(),presets=this.getPresets?.();
    if(typeof registry?.get!=='function'||typeof presets?.composedPreset!=='function')return null;
    const agent=registry.get(sessionId);
    if(!agent||agent.session?.id!==sessionId||presets.composedPreset(agent.ctx)!==EXPLORE_PRESET_ID)return null;
    return agent;
  }
  async start({sessionId,requestId,cwd,prompt,modelSelection,workspaceId},signal){
    signal?.throwIfAborted();
    if(!id(sessionId)||!id(requestId)||typeof cwd!=='string'||!cwd||typeof prompt!=='string'||!prompt.trim()||prompt.length>24000||workspaceId!==undefined&&!id(workspaceId))throw Error('探索执行参数无效');
    const controller=this.getController?.(),presets=this.getPresets?.();
    if(typeof controller?.create!=='function'||typeof controller?.prompt!=='function'||typeof presets?.resolve!=='function')throw Error('宿主探索执行服务尚未就绪');
    const resolved=await presets.resolve(EXPLORE_PRESET_ID);
    if(resolved?.id!==EXPLORE_PRESET_ID||resolved.broken!==undefined)throw Error('探索预设未就绪，没有创建执行会话');
    signal?.throwIfAborted();
    if(this.getRegistry?.()?.get?.(sessionId))throw Error('探索会话身份已存在，不重复创建或重放');
    const created=await controller.create({sessionId,...(workspaceId===undefined?{cwd}:{workspaceId}),agentPreset:EXPLORE_PRESET_ID});
    if(created?.sessionId!==sessionId)throw Error('宿主返回了不同探索身份，未发送任务');
    const agent=this.identity(sessionId);if(!agent)throw Error('无法核验探索会话预设，未发送任务');
    if(modelSelection!==undefined){
      if(!modelSelection||typeof modelSelection.provider!=='string'||!modelSelection.provider||typeof modelSelection.model!=='string'||!modelSelection.model||typeof agent.model?.select!=='function')throw Error('无法继承主会话的模型选择');
      agent.model.select({provider:modelSelection.provider,model:modelSelection.model,...(modelSelection.reasoningEffort===undefined?{}:{reasoningEffort:modelSelection.reasoningEffort})});
    }
    signal?.throwIfAborted();
    const accepted=await controller.prompt({sessionId,requestId,mode:'queue',content:[{type:'text',text:prompt}]},signal);
    if(accepted?.accepted!==true)throw Error('探索任务投递结果未确认');
    return {ok:true,sessionId,accepted:true,presetId:EXPLORE_PRESET_ID,hidden:false};
  }
  async cancel(sessionId,reason='探索轮次已停止'){
    if(!id(sessionId))throw Error('探索会话标识无效');
    let agent=this.identity(sessionId);
    if(!agent){
      const controller=this.getController?.();
      if(typeof controller?.resolveAgent!=='function')return {ok:false,cancelled:false,reason:'探索会话当前不可核验'};
      const resolved=await controller.resolveAgent(sessionId);
      if(resolved?.error)return {ok:false,cancelled:false,reason:'探索会话当前不可核验'};
      agent=this.identity(sessionId);
    }
    if(!agent||typeof agent.cancel!=='function')return {ok:false,cancelled:false,reason:'探索会话当前不可核验'};
    agent.cancel({kind:'hook',reason:String(reason).slice(0,200)},{keepInbox:false});
    return {ok:true,cancelled:true};
  }
}
