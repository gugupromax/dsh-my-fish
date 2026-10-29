import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../lib/store.js';
export function previewData(mode='solo') {
  // Preview only uses a public neutral template, never any saved user profile.
  const template={name:'My Fish',ownerTitle:'你',selfClaim:'我',persona:'你是一位通用本地助理。根据用户明确要求协助任务，清晰说明事实、来源和能力边界；不擅自扩大权限。',interests:[],queries:[]};
  const config={...structuredClone(DEFAULTS),...template,mode,owner:mode==='mention'?'example_user':''};
  const profile=Object.fromEntries(['name','ownerTitle','selfClaim','persona','interests'].map(key=>[key,structuredClone(config[key])]));
  profile.id='default';
  const settings=Object.fromEntries(['enabled','intervalMinutes','startHour','endHour','maxRunsDaily','maxCandidates'].map(key=>[key,config[key]]));
  const channels={ok:true,platforms:[
    {id:'x',name:'X',installed:true,implemented:true,available:true,configured:false,accountRequired:true,diagnostics:{supported:true,kind:'identity',scope:'仅检查保存账号的身份与本地权限配置'},connection:{state:'unconfigured',checkedAt:null,scope:'尚未检查账号身份'},currentSessionVisible:null,reads:['search','read','timeline'],actions:Object.fromEntries(['bookmark','reply','mention'].map(name=>[name,{supported:true,enabled:false,liveVerified:false}])),scope:'配置 X 账号后读取；写操作需要独立授权。',description:'X 专用适配器；账号和写权限在此管理。'},
    {id:'bilibili',name:'B站',installed:true,implemented:true,available:true,configured:false,accountRequired:false,diagnostics:{supported:true,kind:'public-read',scope:'匿名检查公共接口；无需账号，不执行写入'},connection:{state:'unchecked',checkedAt:null,scope:'匿名公开视频资料与有限评论；尚未发起真实读取'},currentSessionVisible:null,reads:['search','read','comments'],readAvailability:{search:{available:false,currentSessionVisible:null,reason:'此离线预览没有可核验的宿主 web_search。'},read:{available:true,currentSessionVisible:null},comments:{available:true,currentSessionVisible:null}},actions:{},scope:'搜索复用宿主 web_search 的公共 BV 链接摘要；匿名读取视频资料、简介和有限评论。',description:'无需 Cookie，不支持收藏、评论、点赞等写操作。'}
  ]};
  return {remote:{ok:true,config,hasCredentials:false,identity:null,recent:[],root:'<DSH_HOME>/my-fish'},assistant:{ok:true,profile,settings,memories:[],goals:[],inbox:[],stats:{memoryCount:0,activeGoals:0,unread:0}},channels,workspace:{ok:true,path:'C:\\Synthetic\\my-fish',workingDirectory:'C:\\Synthetic\\my-fish\\workspace',migrating:false,canMigrate:true,lastMigration:null,permissionBoundaryUnchanged:true},plans:{ok:true,available:true,plans:[],hostTimeZone:'Asia/Shanghai'},permissions:{policy:{shell:false,fileWrite:false,browserInteract:false,delegation:false,privateTerms:[]},capabilities:{guardAvailable:true}}};
}
export function previewTree(mode='solo',overrides={}) {
  const {remote,assistant,plans,permissions,workspace,channels}=previewData(mode);
  let plugin;
  const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:initial=>[{...initial,remote,assistant,plans,channels,workspace,workspaceDraft:{path:workspace.path},policy:permissions.policy,capabilities:permissions.capabilities,cfg:remote.config,profile:assistant.profile,settings:assistant.settings,saved:{cfg:JSON.stringify(remote.config),profile:JSON.stringify(assistant.profile),settings:JSON.stringify(assistant.settings),policy:JSON.stringify(permissions.policy),workspaceDraft:JSON.stringify({path:workspace.path})},...overrides},()=>{}],useEffect:()=>{}};
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:o=>{plugin=o.factory(n=>{if(n==='react')return react;throw Error('Unexpected dependency');});}}},Date,JSON,URL,fetch:()=>{throw Error('Preview must never access network');}});
  return plugin.Section();
}
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(node,selection){
  if(node==null||typeof node==='boolean')return '';
  if(Array.isArray(node))return node.map(child=>render(child,selection)).join('');
  if(typeof node!=='object')return escape(node);
  const {type,props,children}=node;
  const attrs=Object.entries(props).filter(([key,value])=>!/^on/.test(key)&&key!=='key'&&key!=='value'&&value!==false&&value!=null).map(([key,value])=>key==='style'?' style="'+escape(Object.entries(value).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+(typeof v==='number'&&v!==0&&!['opacity','lineHeight','fontWeight','flexShrink'].includes(k)?v+'px':v)).join(';'))+'"':key==='htmlFor'?' for="'+escape(value)+'"':typeof value==='boolean'?' '+key:' '+key+'="'+escape(value)+'"').join('');
  if(type==='input')return '<input'+attrs+(props.value!==undefined?' value="'+escape(props.value)+'"':'')+'>';
  const selected=type==='option'&&selection===props.value?' selected':'';
  return '<'+type+attrs+selected+(type==='option'?' value="'+escape(props.value)+'"':'')+'>'+(type==='textarea'?escape(props.value||''):render(children,type==='select'?props.value:selection))+'</'+type+'>';
}
export function previewHTML(mode='mention',overrides={}){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Fish · 界面预览</title><style>body{background:#191b20;color:#edf0f7;font:14px/1.7 system-ui,"Microsoft Yahei",sans-serif;margin:24px auto;padding:0 20px;max-width:760px}input,textarea,select,button{font:inherit}option{background:#202124}button:disabled{opacity:.45;cursor:default!important}summary:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #89b8d8;outline-offset:3px}.notice{border-left:3px solid #6b91ad;padding:6px 14px;margin-bottom:20px}</style><div class="notice">静态界面预览，无账号、无网络，按钮不执行操作。实际入口：DSH → 设置 → My Fish。</div>'+render(previewTree(mode,overrides))+'</html>';}
if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url)).toLowerCase()===path.resolve(process.argv[1]).toLowerCase())fs.writeFileSync(new URL('../preview.html',import.meta.url),previewHTML());
