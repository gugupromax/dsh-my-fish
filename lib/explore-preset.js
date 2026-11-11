/** Account-free exploration composition. Global permissions remain unchanged. */
export const EXPLORE_PRESET_ID='dsh-my-fish-explore-native';
export const EXPLORE_TOOLS=Object.freeze(['social_status','social_search','social_read','social_comments','social_discover','assistant_explore']);

export default {
  name:'my-fish-explore-read-surface',inject:['tools'],
  apply(ctx){
    // A global allow mask would hide scoped web_search when preset layers are
    // composed. Deny every other inherited capability and refresh on new global
    // registrations. Scoped search remains an internal, guarded dependency.
    if(typeof ctx.tools.definitions!=='function')throw Error('宿主探索工具目录接口不可用');
    const allowed=new Set([...EXPLORE_TOOLS,'web_search']);let release=null,signature=null,busy=false;
    const refresh=()=>{
      if(busy)return;const deny=ctx.tools.definitions().map(tool=>tool.name).filter(name=>!allowed.has(name)&&name!=='run_code').sort(),next=JSON.stringify(deny);
      if(next===signature)return;busy=true;signature=next;
      try{release?.();release=ctx.tools.restrict({deny});}finally{busy=false;}
    };
    refresh();ctx.on('tools/change',refresh);ctx.effect(()=>()=>{busy=true;release?.();});
  },
};

export function explorePresetDefinition(){
  return {id:EXPLORE_PRESET_ID,name:'My Fish 兴趣探索',description:'独立探索公开资料，结果由原主会话表达；不是隐藏会话。',plugins:[
    {id:'native-presentation',name:'@deepseek-ai/dsh-agent-tool-presentation',config:{mode:'native'}},
    {id:'public-search',name:'@deepseek-ai/dsh-tool-web',config:{search:true,fetch:false,searchTimeoutMs:30000}},
    {id:'read-surface',name:new URL('./explore-preset.js',import.meta.url).href},
  ]};
}

export function registerExplorePreset(registry){
  if(typeof registry?.register!=='function'||typeof registry?.resolve!=='function')throw Error('宿主探索预设服务不可用');
  let disposed=false,unregister=null,disposal=null;
  const ready=Promise.resolve().then(async()=>{const release=await registry.register(explorePresetDefinition());if(typeof release!=='function')throw Error('宿主未确认探索预设注册');unregister=release;});
  void ready.catch(()=>{});
  return {id:EXPLORE_PRESET_ID,ready,async ensureReady(){
    if(disposed)throw Error('探索预设已卸载');await ready;
    const resolved=await registry.resolve(EXPLORE_PRESET_ID);
    if(disposed||resolved?.id!==EXPLORE_PRESET_ID||resolved.broken!==undefined)throw Error('探索预设尚未就绪');return EXPLORE_PRESET_ID;
  },dispose(){if(disposal)return disposal;disposed=true;disposal=(async()=>{try{await ready;}catch{return;}await unregister?.();})();return disposal;}};
}
