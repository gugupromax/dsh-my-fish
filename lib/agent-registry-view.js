// Compatibility boundary for live runtime ancestry, never durable parent IDs.
export function agentRegistryView(registry,subagents){
  if(!registry||typeof registry.list!=='function'||typeof registry.isOwnedBy==='function'||typeof subagents?.rootOf!=='function')return registry;
  return {
    list:()=>registry.list(),
    ...(typeof registry.get==='function'?{get:id=>registry.get(id)}:{}),
    isOwnedBy(id,owner){
      const live=registry.list(),candidate=live.find(agent=>agent.id===id);
      if(!candidate||candidate===owner||!live.includes(owner))return false;
      // rc.3 manages continuable children by their exact live subagent-tree
      // root. Scope visibility and durable parentSession are not ownership.
      try{const root=subagents.rootOf(candidate);return root===owner&&live.includes(root);}catch{return false;}
    },
  };
}
