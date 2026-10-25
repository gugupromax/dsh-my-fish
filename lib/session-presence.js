const idOf=agent=>agent?.session?.id??agent?.session?.header?.id??agent?.id;

/** Inspect only live identity and persistence metadata, never conversation bodies. */
export function createSessionProbe({getSessions,getPersistence,getRegistry}={}){
  return async(id,signal)=>{
    signal?.throwIfAborted();
    const sessions=getSessions?.();
    if(typeof sessions?.get!=='function')throw Error('宿主会话检查服务尚未就绪，请稍后重试；原会话引用已保留。');
    const live=()=>{const found=sessions.get(id);if(found===undefined)return false;if(!found||(found.id??found.header?.id)!==id)throw Error('宿主返回了不一致的会话记录，原引用已保留。');return true;};
    if(live())return 'exists';
    const persistence=getPersistence?.();
    if(typeof persistence?.stat!=='function')throw Error('宿主持久会话服务尚未就绪，请稍后重试；不会另建会话。');
    const metadata=await persistence.stat(id,{signal});signal?.throwIfAborted();
    if(live())return 'exists';
    if(metadata!==undefined){
      if(!metadata||typeof metadata!=='object'||metadata.header?.id!==id||typeof metadata.revision!=='string')throw Error('宿主会话元数据无法核验，请检查原会话；不会自动替换。');
      return 'exists';
    }
    const registry=getRegistry?.();
    if(typeof registry?.list!=='function')throw Error('宿主会话运行状态尚未就绪，请稍后重试。');
    if(registry.list().some(agent=>idOf(agent)===id))throw Error('原会话仍在卸载或运行，请等待停止后再次打开 My Fish。');
    // Some providers also return undefined for an invalid header. This proves
    // no valid record is observable, not that a physical log was deleted.
    return 'missing';
  };
}
