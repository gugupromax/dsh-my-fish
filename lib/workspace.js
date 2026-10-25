import path from 'node:path';
import fs from 'node:fs';
import {WorkspaceMigration} from './workspace-migration.js';
import {sessionIdOf} from './permissions.js';

const samePath=(left,right)=>typeof left==='string'&&typeof right==='string'&&(process.platform==='win32'?path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase():path.resolve(left)===path.resolve(right));

/** Trusted settings-only relocation; never registered as a model tool. */
export class WorkspaceController {
  constructor({store,scheduler,engine,plans,sessionController,getRegistry=()=>null,getWorkingDirectory=()=>null,signal}={}){
    Object.assign(this,{store,scheduler,engine,plans,sessionController,getRegistry,getWorkingDirectory,signal});
    this.transition=false;this.readyState=false;this.error=null;this.migrationAgent=null;this.previousCwd=null;
    this.migration=new WorkspaceMigration({store,getHome:()=>store.home,canMigrate:()=>this.eligibility(),getWorkingDirectory:()=>this.previousCwd??this.store.file('workspace'),getSignal:()=>this.maintenanceSignal??this.signal,getOperationLock:()=>this.operationLease,updateWorkingDirectory:(cwd,context)=>this.updateWorkingDirectory(cwd,context)});
    this.initialization=this.initialize();
  }
  initialize(){this.error=null;return Promise.resolve().then(()=>this.migration.recover()).then(()=>{this.readyState=true;},error=>{this.error=error;this.readyState=false;});}
  async retryRecovery(){await this.initialization;if(!this.readyState){this.initialization=this.initialize();await this.initialization;}}
  async ready(){await this.initialization;if(this.error)throw this.error;}
  get migrating(){return this.transition||this.migration.busy===true||this.migration.status().migrationInProgress===true;}
  mainAgent(){const id=this.store.state().sessionId;return this.getRegistry()?.list?.().find(agent=>sessionIdOf({agent})===id);}
  personalAgents(){
    const main=this.mainAgent();if(!main)return [];
    const registry=this.getRegistry(),rows=registry?.list?.()??[],seen=new Set(),queue=[main];
    while(queue.length){const owner=queue.shift();if(seen.has(owner))continue;seen.add(owner);if(typeof registry?.isOwnedBy==='function')for(const child of rows)if(!seen.has(child)&&registry.isOwnedBy(child.id,owner))queue.push(child);}
    return [...seen];
  }
  eligibility(){
    const state=this.store.state();
    if(this.error)return {allowed:false,reason:'工作区恢复未完成，请检查迁移记录后重试。'};
    if(this.scheduler.busy||state.activeRun||state.dispatchPending||state.inflight)return {allowed:false,reason:'助理仍有进行中或结果未确认的任务，请先停止并核对，再迁移工作区。'};
    if(state.sessionCreation)return {allowed:false,reason:'主会话创建结果尚待核对，请先点击 My Fish 入口完成恢复，再迁移工作区。'};
    if(this.personalAgents().some(agent=>agent.status==='running'))return {allowed:false,reason:'助理或子任务仍在运行，请停止后再迁移工作区。'};
    const main=this.mainAgent();if(main&&typeof main.runMaintenance!=='function')return {allowed:false,reason:'当前宿主缺少安全目录迁移支持，请更新兼容宿主后重试。'};
    if(this.plans.list().plans.some(plan=>plan.status==='running'))return {allowed:false,reason:'定时计划正在执行，请本轮结束后再迁移工作区。'};
    if(state.sessionId&&(!this.getWorkingDirectory()||typeof this.sessionController?.resolveAgent!=='function'))return {allowed:false,reason:'当前宿主工作目录服务尚未就绪，不能同步现有主会话，请稍后重试。'};
    return {allowed:true};
  }
  snapshot(){
    const status=this.migration.status(),main=this.mainAgent(),service=this.getWorkingDirectory();let cwd=status.workspacePath;
    if(main&&service?.get)cwd=service.get(main.session);
    const eligibility=this.eligibility();
    return {ok:true,path:this.store.root,workingDirectory:cwd||this.store.file('workspace'),migrating:this.migrating,canMigrate:this.readyState&&!this.migrating&&eligibility.allowed,reason:this.error?.message||(!this.readyState?'正在检查工作区迁移记录':eligibility.reason)||'',lastMigration:status.lastMigration??null,pendingRecovery:status.pendingRecovery??false,permissionBoundaryUnchanged:true};
  }
  async resolveMain(){
    const id=this.store.state().sessionId;if(!id)return null;
    const found=await this.sessionController.resolveAgent(id);if(found?.error)throw found.error;
    if(!found?.agent)throw Error('宿主未返回原主会话，迁移已停止；不会新建替代会话。');return found.agent;
  }
  async updateWorkingDirectory(cwd,context={}){
    if(!this.store.state().sessionId)return;
    const agent=this.migrationAgent??await this.resolveMain(),service=this.getWorkingDirectory();
    if(typeof service?.set!=='function')throw Error('宿主工作目录服务不可用，迁移已停止。');
    const destination=context.phase==='rollback'&&this.previousCwd?this.previousCwd:cwd;
    const operation=async signal=>{const actual=await service.set(agent,destination,signal);if(!samePath(actual,destination))throw Error('宿主未确认新的实际工作目录，迁移已停止。');};
    if(this.migrationAgent)await operation(this.maintenanceSignal??this.signal);
    else{
      if(typeof agent.runMaintenance!=='function')throw Error('当前宿主不支持安全恢复工作目录。');
      await agent.runMaintenance(signal=>operation(AbortSignal.any([signal,this.signal].filter(Boolean))));
    }
  }
  async migrate(input){
    await this.ready();if(this.migrating)throw Error('工作区正在迁移，请等待完成。');this.transition=true;
    let result;try{result=await this.engine.serial(async lease=>{
      this.operationLease=lease;
      const eligibility=this.eligibility();if(!eligibility.allowed)throw Error(eligibility.reason);
      this.migrationAgent=await this.resolveMain();
      if(this.migrationAgent?.status==='running')throw Error('助理正在运行，请停止后再迁移。');
      this.previousCwd=this.migrationAgent?this.getWorkingDirectory().get(this.migrationAgent.session):this.store.file('workspace');
      if(this.migrationAgent&&typeof this.migrationAgent.runMaintenance!=='function')throw Error('当前宿主不支持安全迁移，原工作区保持不变。');
      const operation=async signal=>{this.maintenanceSignal=AbortSignal.any([signal,this.signal].filter(Boolean));return this.migration.migrate(input);};
      return this.migrationAgent?this.migrationAgent.runMaintenance(operation):operation();
    });}catch(error){
      try{if(this.migration.status().pendingRecovery){this.error=error;this.readyState=false;}}catch{this.error=error;this.readyState=false;}
      throw error;
    }finally{this.transition=false;this.migrationAgent=null;this.previousCwd=null;this.maintenanceSignal=null;this.operationLease=null;}
    return {...result,...this.snapshot(),note:result.note+' 原会话的项目归属和文件权限未改变，外部目录操作仍由宿主审批。'};
  }
  async reconcileAgent(agent){
    if(!this.readyState||this.migrating||sessionIdOf({agent})!==this.store.state().sessionId)return;
    const service=this.getWorkingDirectory();if(!service?.get||!service?.set)return;
    const status=this.migration.status(),last=status.lastMigration;
    if(!last)return;
    const expected=this.store.file('workspace'),actual=service.get(agent.session);
    // Only an old managed directory is corrected; a user's unrelated `cd` is respected.
    const previous=last.previousPath??last.source??last.from;
    if(samePath(actual,expected)||!previous||!samePath(actual,path.join(previous,'workspace')))return;
    fs.mkdirSync(expected,{recursive:true});await service.set(agent,expected,this.signal);
  }
  guard(exec){
    if(!this.readyState)return 'My Fish 工作区尚未完成恢复检查，暂不执行个人工具。';
    if(this.migrating)return 'My Fish 正在迁移工作区，暂不执行个人工具。';
  }
}
