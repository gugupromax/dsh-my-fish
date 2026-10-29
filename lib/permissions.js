import {atomic,readJSON} from './store.js';

export const DEFAULT_POLICY=Object.freeze({shell:false,fileWrite:false,browserInteract:false,delegation:false,privateTerms:[]});
const LOCAL=new Set(['assistant_companion','assistant_context','assistant_memory','assistant_goal','assistant_wake','assistant_finish','assistant_capabilities','assistant_plan','assistant_plan_report','social_status','social_search','social_read','social_timeline','social_comments','social_action','x_whale_status','x_whale_search','x_whale_timeline','x_whale_read','x_whale_bookmark','x_whale_reply','x_whale_share','x_whale_diary']);
const READ=new Set(['read','read_image','web_search','web_fetch','skill','bsk_session','bsk_page','bsk_inspect','bsk_tabs','terminal_read','terminal_list','terminal_close','terminal_signal','job_list','job_output','job_kill','list_agents','wait_agent','list_subagent_models']);
const SHELL=new Set(['pwsh','bash','terminal_open','terminal_send','run_code']);
const WRITE=new Set(['write','edit']);
const BROWSER=new Set(['bsk_interact','bsk_assist']);
const DELEGATE=new Set(['subagent','spawn_teammate','send_message']);
const OUTBOUND=new Set(['web_search','web_fetch','social_search','social_read','social_timeline','social_comments','social_action','x_whale_search','x_whale_reply','x_whale_share','bsk_page','bsk_interact','bsk_assist']);
const CREDENTIAL=/(?:["']?(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)["']?\s*[:=]\s*["']?[^\s"',;}&]+|bearer\s+[a-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^/\s:@]+:[^/\s@]+@)/i;

function normalized(value){let text=String(value).normalize('NFKC');for(let i=0;i<3;i++){try{const next=decodeURIComponent(text);if(next===text)break;text=next;}catch{break;}}return text.toLowerCase();}
export function sessionIdOf(exec){return exec?.agent?.session?.id??exec?.agent?.session?.header?.id??exec?.agent?.id;}
export function validatePolicy(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_POLICY,key)))throw Error('权限配置包含不支持的字段');
  const value={...DEFAULT_POLICY,...input};
  for(const key of ['shell','fileWrite','browserInteract','delegation'])if(typeof value[key]!=='boolean')throw Error('权限必须是开关');
  if(!Array.isArray(value.privateTerms)||value.privateTerms.length>100||value.privateTerms.some(term=>typeof term!=='string'||!term.trim()||term.length>200))throw Error('私密词最多 100 条，每条 1–200 字');
  value.privateTerms=[...new Set(value.privateTerms.map(term=>term.trim()))];return value;
}

/** Restricts this assistant and live runtime-owned descendants; other chats retain host policy. */
export class Permissions {
  constructor(store,{getRegistry=()=>null,isPlanSession=()=>false}={}){this.store=store;this.getRegistry=getRegistry;this.isPlanSession=isPlanSession;this.guardAvailable=false;}
  policy(){return validatePolicy(readJSON(this.store.file('assistant/permissions.json'),DEFAULT_POLICY));}
  save(input){const policy=validatePolicy({...this.policy(),...input});atomic(this.store.file('assistant/permissions.json'),policy);return policy;}
  snapshot(){return {policy:this.policy(),capabilities:{guardAvailable:this.guardAvailable,descendantScopeAvailable:this.lineageAvailable(),publicSearch:'host-tool-required',desktopControl:false,voice:'host-dictation-only',continuousVoice:false,toolMode:'native-tools-recommended',notice:'宿主仍决定工具是否可见、连接是否就绪及是否批准执行；代码工具 run_code 也属于本机执行权限。默认使用原生工具；允许代码、终端或浏览器交互后，不保证拦截其中的间接社交写入。'}};}
  lineageAvailable(){const registry=this.getRegistry();return typeof registry?.list==='function'&&typeof registry?.isOwnedBy==='function';}
  scope(exec){
    const id=sessionIdOf(exec),state=this.store.state(),main=state.sessionId,retired=new Set(state.retiredSessionIds??[]);
    if(main&&id===main)return 'personal';
    if(id&&retired.has(id))return 'retired';
    if(this.isPlanSession(exec))return 'plan';
    const registry=this.getRegistry();if(!id||!this.lineageAvailable())return null;
    const agents=registry.list(),seen=new Set();
    const queue=agents.filter(agent=>(main&&sessionIdOf({agent})===main)||retired.has(sessionIdOf({agent}))||this.isPlanSession({agent})).map(agent=>({agent,plan:this.isPlanSession({agent}),retired:retired.has(sessionIdOf({agent}))}));
    while(queue.length){const {agent:owner,plan,retired:revoked}=queue.shift();if(seen.has(owner))continue;seen.add(owner);
      for(const candidate of agents){if(seen.has(candidate)||!registry.isOwnedBy(candidate.id,owner))continue;if(candidate===exec.agent)return revoked?'retired':plan?'plan-descendant':'descendant';queue.push({agent:candidate,plan,retired:revoked});}
    }return null;
  }
  outgoing(value){
    const text=normalized(typeof value==='string'?value:JSON.stringify(value));
    if(CREDENTIAL.test(text))return '外发内容疑似包含凭据，已拦截；请移除敏感信息。';
    if(/(?:(?:^|[^a-z0-9])[a-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:home|users|mnt)\/)/i.test(text))return '外发内容包含本机或共享目录路径，已拦截。';
    if(this.policy().privateTerms.some(term=>text.includes(normalized(term))))return '外发内容命中已保存的私密词，已拦截。';
  }
  guard(exec){
    let scope;try{scope=this.scope(exec);}catch{return 'My Fish 无法核对会话归属，暂不执行工具。';}
    if(!scope)return;
    if(scope==='retired')return '此个人会话引用已失效，请从 My Fish 入口进入当前主会话。';
    try{
      const name=exec.name,policy=this.policy();
      if(scope.startsWith('plan')&&['assistant_companion','assistant_context','assistant_memory','assistant_goal','assistant_wake','assistant_finish','assistant_plan','social_action','x_whale_bookmark','x_whale_reply','x_whale_share','x_whale_diary'].includes(name))return '计划会话只能执行只读任务并通过专用报告回流，不继承个人记录或社交写入权限。';
      if(SHELL.has(name)&&!policy.shell)return 'My Fish 的本地命令权限未开启。';
      if(WRITE.has(name)&&!policy.fileWrite)return 'My Fish 的本地文件写入权限未开启。';
      if(BROWSER.has(name)&&!policy.browserInteract)return 'My Fish 的浏览器交互权限未开启；请使用只读工具。';
      if(DELEGATE.has(name)&&(!policy.delegation||!this.lineageAvailable()))return 'My Fish 的子任务委派未开启，或宿主无法核对子任务归属。';
      if(scope.startsWith('plan')&&(SHELL.has(name)||WRITE.has(name)||BROWSER.has(name)||DELEGATE.has(name)))return '本版定时计划仅允许只读执行。';
      if(!LOCAL.has(name)&&!READ.has(name)&&!SHELL.has(name)&&!WRITE.has(name)&&!BROWSER.has(name)&&!DELEGATE.has(name))return '该工具尚未纳入 My Fish 权限分类，已拦截；请在普通会话使用宿主权限处理。';
      if(OUTBOUND.has(name))return this.outgoing(exec.arguments??{});
    }catch{return 'My Fish 权限配置无法读取，已停止本次工具调用。';}
  }
}
