import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

const idOf=agent=>agent?.session?.id??agent?.session?.header?.id??agent?.id;
const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
const validId=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200&&!/[\u0000-\u001F]/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

class InvalidSessionMetadata extends Error{}

/** Workspace membership and explicit adoption of an existing ordinary session.
 * Reads headers only. Never creates, resumes, prompts, rewrites or merges a session.
 */
export class SessionBinding{
  constructor({store,getRegistry=()=>null,getSessions=()=>null,getPersistence=()=>null,getAgents=()=>null,signal}={}){
    if(typeof store?.state!=='function'||typeof store?.saveState!=='function'||typeof store?.root!=='string')throw Error('需要本地助理存储');
    Object.assign(this,{store,getRegistry,getSessions,getPersistence,getAgents,signal});
    this.initialRoot=path.resolve(store.root);this.freshRoot=!existsSync(store.root);
  }
  _check(){this.signal?.throwIfAborted();}
  _registry(){
    const registry=this.getRegistry();
    if(typeof registry?.list!=='function'||typeof registry?.get!=='function')throw Error('宿主工作区分组服务尚未就绪，请稍后重试');
    return registry;
  }
  async _path(value){
    if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw Error('工作区必须使用有效的完整目录路径');
    this._check();let canonical;
    try{canonical=await fs.realpath(value);if(!(await fs.stat(canonical)).isDirectory())throw Error();}catch{throw Error('工作区目录不可用，已停止会话绑定');}
    this._check();return canonical;
  }
  async _rootPath({initialize=false}={}){
    const root=this.store.root;
    if(typeof root!=='string'||!path.isAbsolute(root)||root.includes('\0'))throw Error('工作区必须使用有效的完整目录路径');
    try{const canonical=await this._path(root);this.freshRoot=false;return canonical;}catch(error){
      let missing=false;try{await fs.stat(root);}catch(reason){missing=reason?.code==='ENOENT';}
      if(!missing||!this.freshRoot||!samePath(path.resolve(root),this.initialRoot))throw error;
      if(!initialize)return null;
      this._check();await fs.mkdir(root,{recursive:true,mode:0o700});this.freshRoot=false;return this._path(root);
    }
  }
  async _workspace(id){
    if(!validId(id))throw Error('请选择有效的宿主工作区分组');
    const registry=this._registry(),workspace=registry.get(id);
    if(!workspace||workspace.id!==id||!Array.isArray(workspace.sessionIds)||workspace.sessionIds.some(value=>!validId(value)))throw Error('所选宿主工作区分组不存在或暂不可用');
    const canonical=await this._path(workspace.path);
    return {entity:workspace,id:workspace.id,path:canonical,title:typeof workspace.title==='string'&&workspace.title.trim()?workspace.title:workspace.id};
  }
  async _header(id){
    if(!validId(id))throw new InvalidSessionMetadata('会话标识无效');
    this._check();const sessions=this.getSessions();let header;
    if(typeof sessions?.get==='function'){
      const live=sessions.get(id);
      if(live!==undefined){
        if(!live||live.id!==id||!object(live.header))throw new InvalidSessionMetadata('宿主返回的会话元数据不一致');
        header=live.header;
      }
    }
    if(header===undefined){
      const persistence=this.getPersistence();
      if(typeof persistence?.stat!=='function')throw Error('宿主会话元数据服务尚未就绪，请稍后重试');
      let metadata;
      try{metadata=await persistence.stat(id,{signal:this.signal});}catch{this._check();throw Error('暂时无法读取会话元数据，未改变主会话绑定');}
      this._check();
      if(typeof sessions?.get==='function'){
        const live=sessions.get(id);
        if(live!==undefined){if(!live||live.id!==id||!object(live.header))throw new InvalidSessionMetadata('宿主返回的会话元数据不一致');header=live.header;}
      }
      if(header===undefined){
        if(metadata===undefined)return null;
        if(!object(metadata)||!object(metadata.header)||typeof metadata.revision!=='string')throw new InvalidSessionMetadata('宿主持久会话元数据无效');
        header=metadata.header;
      }
    }
    if(header.id!==id||typeof header.cwd!=='string'||!path.isAbsolute(header.cwd)||header.cwd.includes('\0'))throw new InvalidSessionMetadata('会话元数据缺少一致的原始工作目录');
    if(header.isSeeded===true||header.origin==='subagent'||header.parentSession!==undefined||header.delegationDepth>0)throw new InvalidSessionMetadata('不能把分支或子任务会话设为主会话');
    if(header.isSeeded!==undefined&&typeof header.isSeeded!=='boolean')throw new InvalidSessionMetadata('会话元数据的继承状态无效');
    const cwd=await this._path(header.cwd);
    return {id,cwd,...(Number.isSafeInteger(header.createdAt)&&header.createdAt>=0?{createdAt:header.createdAt}:{})};
  }
  _runtime(){
    const registry=this.getAgents();
    if(typeof registry?.list!=='function'||typeof registry?.isOwnedBy!=='function')throw Error('宿主会话运行状态尚未就绪，无法安全更换主会话');
    const rows=registry.list();if(!Array.isArray(rows))throw Error('宿主会话运行状态无法核对');return {registry,rows};
  }
  _subagent(sessionId){
    const registry=this.getAgents();if(typeof registry?.list!=='function'||typeof registry?.isOwnedBy!=='function')return false;
    const rows=registry.list();if(!Array.isArray(rows))throw Error('宿主会话运行状态无法核对');
    const candidate=rows.find(agent=>idOf(agent)===sessionId);
    return !!candidate&&rows.some(owner=>owner!==candidate&&registry.isOwnedBy(candidate.id,owner));
  }
  _idle(state,target){
    if(state.activeRun||state.dispatchPending||state.sessionCreation||state.inflight||state.companionChatPending)throw Error('助理有进行中或结果未确认的任务，请先停止并核对，再绑定已有会话');
    const {registry,rows}=this._runtime(),roots=new Set([state.sessionId,target].filter(validId));
    const queue=rows.filter(agent=>roots.has(idOf(agent))),seen=new Set();
    while(queue.length){
      const owner=queue.shift();if(seen.has(owner))continue;seen.add(owner);
      if(owner.status==='running')throw Error('原主会话、目标会话或其子任务仍在运行，请先停止后再绑定');
      for(const candidate of rows)if(!seen.has(candidate)&&registry.isOwnedBy(candidate.id,owner))queue.push(candidate);
    }
  }
  _binding(value){
    if(!object(value)||!validId(value.workspaceId)||!validId(value.sessionId)||typeof value.path!=='string'||!path.isAbsolute(value.path))throw Error('已保存的会话分组绑定无效，请重新选择已有会话');
    return value;
  }
  async _selected(workspaceId){
    if(workspaceId!==undefined)return this._workspace(workspaceId);
    const saved=this.store.state().mainSessionBinding;
    if(saved){const binding=this._binding(saved),workspace=await this._workspace(binding.workspaceId);if(!samePath(await this._path(binding.path),workspace.path))throw Error('已保存的工作区分组路径发生变化，请重新选择已有会话');return workspace;}
    const canonical=await this._rootPath(),registry=this._registry();if(canonical===null)return null;
    if(typeof registry.resolveByPath==='function'){
      const found=await registry.resolveByPath(canonical);this._check();if(found!==undefined)return this._workspace(found.id);
      return null;
    }
    for(const candidate of registry.list())if(typeof candidate.path==='string'&&path.isAbsolute(candidate.path)&&samePath(path.resolve(candidate.path),canonical))return this._workspace(candidate.id);
    return null;
  }
  async snapshot(workspaceId){
    const state=this.store.state(),current={sessionId:validId(state.sessionId)?state.sessionId:null};
    let registry;try{registry=this._registry();}catch(error){return {available:false,current,workspaces:[],selectedWorkspaceId:null,candidates:[],requiresBinding:false,reason:error.message};}
    this._check();const workspaces=[];
    for(const item of registry.list())if(item&&validId(item.id)&&typeof item.path==='string'&&path.isAbsolute(item.path)&&!item.path.includes('\0'))workspaces.push({id:item.id,title:typeof item.title==='string'&&item.title.trim()?item.title:item.id,path:item.path});
    const selected=await this._selected(workspaceId),candidates=[];
    if(current.sessionId){
      try{const header=await this._header(current.sessionId);if(header){current.cwd=header.cwd;const owner=registry.list().find(item=>item.sessionIds.includes(current.sessionId));if(owner)current.workspaceId=owner.id;}}catch(error){if(!(error instanceof InvalidSessionMetadata))throw error;}
    }
    if(selected){
      const archived=registry.archivedSessionIds??[];
      for(const id of selected.entity.sessionIds){
        if(archived.includes(id)||this._subagent(id))continue;
        try{const header=await this._header(id);if(header&&samePath(header.cwd,selected.path))candidates.push(header);}catch(error){if(!(error instanceof InvalidSessionMetadata))throw error;}
      }
    }
    return {available:true,current,workspaces,selectedWorkspaceId:selected?.id??null,candidates,requiresBinding:!!(current.sessionId&&current.cwd&&selected&&!samePath(current.cwd,selected.path))};
  }
  async bind(input){
    if(!object(input)||Object.keys(input).sort().join(',')!=='sessionId,workspaceId'||!validId(input.sessionId)||!validId(input.workspaceId))throw Error('请选择明确的工作区分组和已有会话');
    const expected=this.store.state().sessionId??null,workspace=await this._workspace(input.workspaceId);
    if(!workspace.entity.sessionIds.includes(input.sessionId)||(this._registry().archivedSessionIds??[]).includes(input.sessionId))throw Error('目标会话不属于所选工作区分组，或已归档');
    const header=await this._header(input.sessionId);
    if(!header||!samePath(header.cwd,workspace.path)||this._subagent(input.sessionId))throw Error('目标会话与所选工作区分组不匹配，请选择有效的已有普通会话');
    this._check();const state=this.store.state();if((state.sessionId??null)!==expected)throw Error('主会话绑定已经变化，请刷新后重新选择');
    const old=state.mainSessionBinding;
    if(state.sessionId===input.sessionId&&old?.workspaceId===workspace.id&&old.sessionId===input.sessionId&&typeof old.path==='string'&&samePath(old.path,workspace.path))return {ok:true,changed:false,sessionId:input.sessionId,workspaceId:workspace.id,path:workspace.path,binding:structuredClone(old),note:'已在使用这个工作区内的同一主会话。'};
    this._idle(state,input.sessionId);
    const binding={workspaceId:workspace.id,sessionId:input.sessionId,path:workspace.path,boundAt:Date.now()};
    state.retiredSessionIds=[...new Set([...(state.retiredSessionIds??[]).filter(id=>id!==input.sessionId),...(validId(state.sessionId)&&state.sessionId!==input.sessionId?[state.sessionId]:[])])].slice(-50);
    state.sessionId=input.sessionId;state.mainSessionBinding=binding;this.store.saveState(state);
    return {ok:true,changed:true,sessionId:input.sessionId,workspaceId:workspace.id,path:workspace.path,binding:structuredClone(binding),note:'已绑定所选工作区里的已有会话，后续聊天继续使用它；未新建或投递任务。'};
  }
  async creationLocation(){
    this._check();const registry=this._registry(),saved=this.store.state().mainSessionBinding;
    if(saved){const binding=this._binding(saved),workspace=await this._workspace(binding.workspaceId);if(!samePath(await this._path(binding.path),workspace.path))throw Error('已绑定工作区路径不一致，请选择已有会话');return {workspaceId:workspace.id,cwd:workspace.path};}
    let workspace=await this._selected();
    if(!workspace){
      if(typeof registry.create!=='function')throw Error('宿主尚不能注册工作区分组，不会创建未分组的新会话');
      const canonical=await this._rootPath({initialize:true}),created=await registry.create(canonical,'My Fish');this._check();workspace=await this._workspace(created?.id);
      if(!samePath(workspace.path,canonical))throw Error('宿主返回了不同的工作区路径，已停止创建会话');
    }
    return {workspaceId:workspace.id,cwd:workspace.path};
  }
  async ensureAttached(sessionId){
    if(!validId(sessionId))throw Error('需要有效的主会话标识');
    try{this._registry();}catch{return {available:false,grouped:false,sessionId,note:'宿主工作区分组服务尚未就绪，继续使用原主会话；未创建新会话。'};}
    let selected=await this._selected();
    if(!selected){
      const header=await this._header(sessionId),root=await this._path(this.store.root);
      if(header&&samePath(header.cwd,root)){const location=await this.creationLocation();selected=await this._workspace(location.workspaceId);}
    }
    if(!selected)throw Error('当前目录尚未绑定宿主工作区，请先选择分组内已有会话');
    return {available:true,grouped:true,...await this._attach(sessionId,selected)};
  }
  async _attach(sessionId,workspace){
    const header=await this._header(sessionId);
    if(!header||!samePath(header.cwd,workspace.path)||this._subagent(sessionId))throw Error('原主会话的创建目录与所选分组不同，请选择该分组里的已有会话；不会再创建替代会话');
    if((this._registry().archivedSessionIds??[]).includes(sessionId))throw Error('原主会话已归档，请先在宿主恢复它或选择已有会话');
    if(!workspace.entity.sessionIds.includes(sessionId)){
      if(typeof workspace.entity.attachSession!=='function')throw Error('宿主尚不能绑定会话分组，请先选择分组内已有会话');
      await workspace.entity.attachSession(sessionId);this._check();
      const updated=await this._workspace(workspace.id);
      if(!updated.entity.sessionIds.includes(sessionId))throw Error('宿主未确认会话已加入分组，原主会话引用保持不变');
    }
    return {workspaceId:workspace.id,sessionId,path:workspace.path};
  }
  async confirmCreated(sessionId,workspaceId){
    const workspace=await this._workspace(workspaceId),attached=await this._attach(sessionId,workspace),state=this.store.state();
    if(state.sessionId!==sessionId)throw Error('尚未采用宿主返回的会话标识，不能保存分组绑定');
    const previous=state.mainSessionBinding;
    if(previous?.workspaceId===workspace.id&&previous.sessionId===sessionId&&previous.path===workspace.path)return structuredClone(previous);
    const binding={...attached,boundAt:Date.now()};state.mainSessionBinding=binding;this.store.saveState(state);return structuredClone(binding);
  }
}
