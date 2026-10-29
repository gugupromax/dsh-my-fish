window.__ModuleLoader__.load({id:'dsh-my-fish',factory:require=>{
  const R=require('react'),h=R.createElement,API='/my-fish/api/';
  const labels={checking:'检查中',running:'运行中',passed:'体检通过',blocked:'未启动',failed:'失败',interrupted:'已中断',queued:'已交给 DSH，等待执行',reported:'已汇报到动态盒',quiet:'安静结束',completed:'本轮已结束'};
  const readLabel={running:'读取中',passed:'读取成功',failed:'读取失败'},operationLabel={search:'搜索帖子',read:'读取单帖',timeline:'首页时间线'};
  const memoryLabel={preference:'偏好',fact:'事实',decision:'决定',observation:'待核实观察'},goalLabel={active:'跟进中',paused:'已暂停',done:'已完成'};
  const stamp=at=>at?new Date(at).toLocaleString('zh-CN',{hour12:false}):'暂无',serial=value=>JSON.stringify(value);
  const cleanMessage=value=>String(value||'请求失败').replace(/(?:auth_token|ct0|cookie|authorization)\s*[:=]\s*[^\s;,]+/gi,'[凭据已隐藏]');
  function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  async function call(route,body){
    const response=await fetch(API+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:serial(body)})});
    const result=await response.json();if(!response.ok||(result.ok===false&&!(route==='plans'&&body===undefined&&result.available===false)))throw Error(result.error||result.reason||'请求失败');return result;
  }
  let pendingSession=null;
  function ensureSession(){
    if(!pendingSession)pendingSession=call('session',{}).then(value=>{if(typeof value.sessionId!=='string'||!value.sessionId.trim())throw Error('未取得个人主会话，请在 My Fish 设置中重试。');return value;}).finally(()=>{pendingSession=null;});
    return pendingSession;
  }
  const css={root:{maxWidth:760,lineHeight:1.7,color:'var(--dsw-alias-label-primary,inherit)',paddingBottom:20,overflowWrap:'anywhere'},input:{width:'100%',boxSizing:'border-box',padding:'9px 10px',border:'1px solid #80808065',borderRadius:5,background:'transparent',color:'inherit',font:'inherit'},button:{padding:'7px 12px',margin:'4px 8px 4px 0',cursor:'pointer',border:'1px solid #80808065',borderRadius:5,background:'transparent',color:'inherit',font:'inherit'},primary:{background:'#355d7c',borderColor:'#6c95b3',color:'#fff'},hint:{opacity:.76,fontSize:12,lineHeight:1.75},section:{padding:'18px 0',borderBottom:'1px solid #80808045'},row:{padding:'12px 0',borderBottom:'1px solid #80808035'},muted:{opacity:.7},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,180px),1fr))',gap:'0 16px'}};
  const emptyMemory=()=>({text:'',category:'preference',source:'用户在设置页填写'}),emptyGoal=()=>({title:'',detail:'',mode:'watch'});
  const localTimeZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai';}catch{return 'Asia/Shanghai';}};
  const newRequestId=()=>globalThis.crypto?.randomUUID?.()||'my-fish-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const emptyPlan=()=>({title:'',instruction:'',frequency:'hourly',time:'09:00',at:'',timeZone:localTimeZone(),requestId:newRequestId()});
  const absolutePath=value=>typeof value==='string'&&(/^[a-z]:[\\/]/i.test(value.trim())||/^\\\\[^\\/]+[\\/][^\\/]+/.test(value.trim())||/^\//.test(value.trim()));
  function workspaceValue(value){if(typeof value?.path!=='string'||!value.path.trim()||typeof value.workingDirectory!=='string'||!value.workingDirectory.trim())throw Error('宿主未返回有效工作区位置，请刷新后重试');return value;}
  async function readWorkspace(){return workspaceValue(await call('workspace'));}
  let pendingChannels=null;
  function readChannels(){
    if(!pendingChannels)pendingChannels=call('channels').then(value=>{if(!Array.isArray(value?.platforms)||value.platforms.some(row=>!row||typeof row.id!=='string'||!row.id.trim()||typeof row.name!=='string'||!row.name.trim())||new Set(value.platforms.map(row=>row.id)).size!==value.platforms.length)throw Error('渠道目录返回格式无效，请刷新后重试');return value;}).finally(()=>{pendingChannels=null;});
    return pendingChannels;
  }
  function initialModel(){return {remote:null,assistant:null,cfg:null,profile:null,settings:null,policy:null,capabilities:null,permissionsError:'',channels:null,channelsError:'',channelsLoading:false,workspace:null,workspaceDraft:null,workspaceError:'',workspaceSaving:false,plans:null,plansError:'',planDraft:emptyPlan(),speech:null,assistantError:'',refreshError:'',saved:{cfg:'',profile:'',settings:'',policy:'',workspaceDraft:''},cookie:{auth_token:'',ct0:''},busy:false,message:'',diaries:null,task:'',memoryQuery:'',memoryDraft:emptyMemory(),goalDraft:emptyGoal()};}
  function Section({close,openAssistantSession,navigationError,checkSpeech}={}){
    const [m,set]=R.useState(initialModel());
    const operationBusy=!!(m.busy||m.workspace?.migrating);
    const patch=changes=>set(previous=>({...previous,...changes}));
    async function refreshChannels(allowApply=()=>true){
      if(allowApply())patch({channelsLoading:true});
      try{const channels=await readChannels();if(allowApply())patch({channels,channelsError:''});}
      catch(e){if(allowApply())patch({channelsError:cleanMessage(e.message)});}
      finally{if(allowApply())patch({channelsLoading:false});}
    }
    async function load(allowApply=()=>true){
      const pending=Promise.allSettled([call('state'),call('assistant'),call('plans'),call('permissions'),readWorkspace()]);
      void refreshChannels(allowApply);
      const [remoteResult,assistantResult,plansResult,permissionsResult,workspaceResult]=await pending;
      if(!allowApply())return;
      set(previous=>{
        const next={...previous,saved:{...previous.saved},assistantError:assistantResult.status==='fulfilled'?'':cleanMessage(assistantResult.reason?.message),plansError:plansResult.status==='fulfilled'?'':cleanMessage(plansResult.reason?.message),permissionsError:permissionsResult.status==='fulfilled'?'':cleanMessage(permissionsResult.reason?.message),workspaceError:workspaceResult.status==='fulfilled'?'':cleanMessage(workspaceResult.reason?.message)};
        const updates=[];
        if(remoteResult.status==='fulfilled'){next.remote=remoteResult.value;next.refreshError='';updates.push(['cfg',remoteResult.value.config]);}
        if(assistantResult.status==='fulfilled'){next.assistant=assistantResult.value;updates.push(['profile',assistantResult.value.profile],['settings',assistantResult.value.settings]);}
        if(plansResult.status==='fulfilled')next.plans=plansResult.value;
        if(permissionsResult.status==='fulfilled'){next.capabilities=permissionsResult.value.capabilities;updates.push(['policy',permissionsResult.value.policy]);}
        if(workspaceResult.status==='fulfilled'){next.workspace=workspaceResult.value;updates.push(['workspaceDraft',{path:workspaceResult.value.path}]);}
        for(const [key,value] of updates){
          if(previous[key]===null||serial(previous[key])===previous.saved[key]){next[key]=value;next.saved[key]=serial(value);}
        }
        return next;
      });
      if(remoteResult.status==='rejected')throw remoteResult.reason;
    }
    R.useEffect(()=>{
      let active=true,running=false;
      const refresh=async()=>{
        if(!active||running)return;
        running=true;
        try{await load(()=>active);if(active)set(previous=>previous.refreshError?{...previous,refreshError:''}:previous);}
        catch(e){if(active){const text=cleanMessage(e.message);set(previous=>previous.refreshError===text?previous:{...previous,refreshError:text});}}
        finally{running=false;}
      };
      refresh();
      const timer=setInterval(refresh,15000);
      return ()=>{active=false;clearInterval(timer);};
    },[]);
    async function action(fn){
      if(operationBusy)return;
      patch({busy:true,message:''});
      try{const result=await fn();patch({message:result?.note||'已更新'});await load();}
      catch(e){let text=cleanMessage(e.message);for(const value of Object.values(m.cookie))if(value)text=text.split(value).join('[凭据已隐藏]');patch({message:text});try{await load();}catch{}}
      finally{patch({busy:false});}
    }
    const button=(label,fn,disabled=false,primary=false)=>h('button',{type:'button',style:{...css.button,...(primary?css.primary:{})},disabled:operationBusy||disabled,onClick:()=>action(fn)},label);
    if(!m.remote||!m.cfg)return h('div',{style:css.root},h('p',{role:m.message||m.refreshError?'alert':'status'},m.message||m.refreshError||'正在读取个人助理…'),(m.message||m.refreshError)&&button('重试',()=>load()));
    const {remote,cfg}=m,assistant=m.assistant||{},profile=m.profile||{name:'个人助理'};
    const personalReady=!!(m.assistant&&m.profile&&m.settings&&!m.assistantError);
    const dirty=key=>m[key]!==null&&serial(m[key])!==m.saved[key],hasDraft=dirty('cfg')||dirty('profile')||dirty('settings')||dirty('policy')||dirty('workspaceDraft');
    const change=(group,key,value)=>set(previous=>({...previous,[group]:{...previous[group],[key]:value}}));
    function field(label,group,key,type='text',hint='',options={}){
      const value=m[group][key]??'',id=group+'-'+key;
      const props={id,'aria-label':label,style:css.input,disabled:operationBusy,value:Array.isArray(value)?value.join('\n'):value,onChange:e=>change(group,key,type==='number'?Number(e.target.value):type==='list'?e.target.value.split('\n'):e.target.value),...options};
      return h('label',{htmlFor:id,style:{display:'block',margin:'10px 0'}},h('div',null,label),type==='textarea'||type==='list'?h('textarea',{...props,rows:type==='textarea'?5:3}):h('input',{...props,type}),hint&&h('div',{style:css.hint},hint));
    }
    function select(label,group,key,options){const id=group+'-'+key;return h('label',{htmlFor:id,style:{display:'block',margin:'10px 0'}},h('div',null,label),h('select',{id,'aria-label':label,style:css.input,value:m[group][key],disabled:operationBusy,onChange:e=>change(group,key,e.target.value)},...options.map(([value,text])=>h('option',{key:value,value},text))));}
    function toggle(label,group,key,hint){return h('label',{style:{display:'block',margin:'12px 0'}},h('input',{type:'checkbox','aria-label':label,checked:!!m[group][key],disabled:operationBusy,onChange:e=>change(group,key,e.target.checked)}),' '+label,hint&&h('div',{style:css.hint},hint));}
    const section=(title,...children)=>h('section',{style:css.section},h('h3',{style:{fontSize:17,margin:'0 0 8px'}},title),...children);
    const disclosure=(title,...children)=>h('details',{style:css.section},h('summary',{style:{cursor:'pointer',fontSize:16,fontWeight:600}},title),...children);
    const save=(key,route)=>async()=>{const value=key==='profile'?{...m[key],interests:m[key].interests.map(text=>text.trim()).filter(Boolean)}:key==='policy'?{...m[key],privateTerms:m[key].privateTerms.map(text=>text.trim()).filter(Boolean)}:m[key],result=await call(route,value);set(previous=>({...previous,[key]:value,saved:{...previous.saved,[key]:serial(value)}}));return {...result,note:result.note||'已保存'};};
    const notices=assistant.inbox??[],goals=assistant.goals??[],memories=assistant.memories??[];
    const filtered=memories.filter(row=>(row.text+' '+row.source+' '+(memoryLabel[row.category]||'')).toLocaleLowerCase().includes(m.memoryQuery.trim().toLocaleLowerCase()));
    const ready=remote.identity&&remote.identity.username?.toLowerCase()===cfg.aiUsername.toLowerCase(),active=goals.filter(row=>row.status==='active');
    const sessionId=typeof remote.sessionId==='string'?remote.sessionId.trim():'';
    const chatDraft=!!(hasDraft||m.task.trim()||m.memoryDraft.text.trim()||m.goalDraft.title.trim()||m.goalDraft.detail.trim()||m.planDraft.title.trim()||m.planDraft.instruction.trim());
    const chatAvailable=!!sessionId&&typeof openAssistantSession==='function'&&typeof close==='function';
    const openChat=async()=>{
      if(operationBusy||!chatAvailable||chatDraft)return;
      patch({busy:true,message:''});
      let session;
      try{session=await ensureSession();set(previous=>({...previous,remote:{...previous.remote,sessionId:session.sessionId},message:session.note||''}));await openAssistantSession(session.sessionId);close();}
      catch(e){patch({message:[session?.recovered?session.note:'',cleanMessage(e.message)].filter(Boolean).join('\n')});}
      finally{patch({busy:false});}
    };
    const clearGoal=()=>patch({goalDraft:emptyGoal()}),clearMemory=()=>patch({memoryDraft:emptyMemory()});
    const payload=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
    const planAvailable=!!m.plans?.available,planRows=m.plans?.plans??[],plan=m.planDraft;
    const createPlan=async()=>{
      const schedule={mode:plan.frequency==='once'?'once':'cron',timeZone:plan.frequency==='once'?localTimeZone():plan.timeZone};
      if(plan.frequency==='hourly')schedule.cron='0 * * * *';
      else if(plan.frequency==='daily'){const [hour,minute]=plan.time.split(':').map(Number);if(!Number.isInteger(hour)||!Number.isInteger(minute))throw Error('请选择每天执行的时间');schedule.cron=minute+' '+hour+' * * *';}
      else if(plan.frequency==='custom')schedule.cron=plan.cron;
      else {schedule.at=new Date(plan.at).getTime();if(!Number.isFinite(schedule.at)||schedule.at<=Date.now())throw Error('请选择未来的执行时间');}
      if(plan.editingTaskId){schedule.enabled=plan.scheduleEnabled!==false;if(schedule.mode==='cron'&&Number.isInteger(plan.maxRuns))schedule.maxRuns=plan.maxRuns;}
      const request=plan.editingTaskId?{action:'update',taskId:plan.editingTaskId,requestId:plan.requestId,schedule}:{action:'create',requestId:plan.requestId,title:plan.title.trim(),instruction:plan.instruction.trim(),schedule};
      const result=await call('plans',request);patch({planDraft:emptyPlan()});return {...result,note:result.note||(plan.editingTaskId?'执行时间已更新':'计划已保存到宿主任务看板；实际执行结果将在记录中显示')};
    };
    const managePlan=(row,action)=>call('plans',{action,taskId:row.taskId||row.id,requestId:newRequestId()});
    const editPlan=async row=>{
      const schedule=row.schedule||{},daily=/^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.cron||''),at=new Date(schedule.at||Date.now()),pad=value=>String(value).padStart(2,'0');
      const dateValue=at.getFullYear()+'-'+pad(at.getMonth()+1)+'-'+pad(at.getDate())+'T'+pad(at.getHours())+':'+pad(at.getMinutes());
      patch({planDraft:{...emptyPlan(),editingTaskId:row.taskId||row.id,title:row.title||'',instruction:row.instruction||'',scheduleEnabled:schedule.enabled,maxRuns:schedule.maxRuns,frequency:schedule.mode==='once'?'once':schedule.cron==='0 * * * *'?'hourly':daily?'daily':'custom',time:daily?pad(Number(daily[2]))+':'+pad(Number(daily[1])):'09:00',at:schedule.mode==='once'?dateValue:'',cron:schedule.cron||'',timeZone:schedule.timeZone||m.plans?.hostTimeZone||localTimeZone()}});return {note:'已载入执行时间；任务要求需保留，若要更改要求，请取消后新建计划'};
    };
    const planSummary=row=>row.schedule?.mode==='once'?'一次性 · '+stamp(row.schedule.at):((row.schedule?.cron==='0 * * * *'?'每小时整点':row.schedule?.cron||'周期计划')+' · '+(row.schedule?.timeZone||m.plans?.hostTimeZone||'宿主时区'));
    const runText=row=>({success:'成功',succeeded:'成功',completed:'已完成',failed:'失败',cancelled:'已取消',canceled:'已取消',interrupted:'已中断',running:'运行中'}[row.result]||row.result||'状态未确认')+(row.startedAt?' · '+stamp(row.startedAt):'');
    const migrateWorkspace=async()=>{
      const path=m.workspaceDraft?.path?.trim();if(!absolutePath(path))throw Error('请输入新工作区的完整绝对路径');
      patch({workspaceSaving:true});
      try{
        const result=await call('workspace',{path}),workspace=workspaceValue(typeof result.path==='string'?result:await readWorkspace()),draft={path:workspace.path};
        set(previous=>({...previous,workspace,workspaceDraft:draft,workspaceError:'',saved:{...previous.saved,workspaceDraft:serial(draft)}}));
        return {...result,note:result.note||'工作区已迁移，同一主会话将使用新的工作目录；旧位置保留备份'};
      }finally{patch({workspaceSaving:false});}
    };
    const capabilityLabels={search:'搜索',read:'读取单条内容',comments:'读取评论',timeline:'时间线',feed:'信息流',profile:'账号资料',bookmark:'收藏',favorite:'收藏',like:'点赞',reply:'公开回复',comment:'公开评论',mention:'公开 @ 分享',publish:'公开发布',dm:'私信',follow:'关注'};
    const renderChannel=row=>{
      const capabilities=row.capabilities&&typeof row.capabilities==='object'?row.capabilities:{},reads=Array.isArray(row.reads)?row.reads:Array.isArray(capabilities.reads)?capabilities.reads:[];
      const actions=row.actions??capabilities.actions,actionEntries=Array.isArray(actions)?actions.filter(value=>typeof value==='string').map(value=>[value,{}]):actions&&typeof actions==='object'?Object.entries(actions):[];
      const connection=typeof row.connection==='string'?{state:row.connection}:row.connection&&typeof row.connection==='object'?row.connection:{};
      const state=connection.state??connection.status,connectionText={unconfigured:'未配置',unchecked:'尚未核验',unverified:'尚未核验',verified:'最近连接核验通过',configured:'已配置，尚未核验',ready:'连接可用，动作仍需单独验收',connected:'已连接，动作仍需单独验收',unavailable:'连接不可用',disconnected:'未连接',failed:'连接失败',unknown:'尚未确认'}[state]||'尚未确认';
      const verification=row.readVerification??capabilities.readVerification,readVerified=verification&&typeof verification==='object'?verification.liveVerified:undefined,readAvailability=row.readAvailability??capabilities.readAvailability??{};
      const readReady=value=>typeof value==='boolean'?value:value?.available;
      const compactStatus=row.implemented===false?'尚未接入':row.available===false?'当前未就绪':row.accountRequired!==false&&row.configured===false?'尚未配置账号':connectionText;
      return h('details',{key:row.id,'data-channel':row.id,style:css.row},h('summary',{style:{cursor:'pointer',fontSize:16,fontWeight:600}},row.name,h('span',{style:{...css.hint,fontWeight:400,marginLeft:12}},compactStatus)),typeof row.description==='string'&&row.description&&h('p',{style:css.hint},row.description),
        h('p',{style:css.hint},'接入状态：'+(row.implemented===true?'已实现':row.implemented===false?'尚未接入':'尚未确认')+' · 服务状态：'+(row.available===true?'适配服务已就绪':row.available===false?'当前未就绪':'尚未确认')),
        typeof row.installed==='boolean'&&h('p',{style:css.hint},'接入组件：'+(row.installed?'已检测到':'未检测到')),
        h('p',{style:css.hint},'账号配置：'+(row.accountRequired===false?'无需账号':row.configured===true?'已配置':row.configured===false?'尚未配置':'尚未确认')+' · 连接核验：'+connectionText),
        h('p',{style:css.hint},'当前会话可见性：'+(row.currentSessionVisible===true?'已确认可见':row.currentSessionVisible===false?'当前不可见':'尚未确认')),
        (connection.checkedAt||row.identityCheckedAt)&&h('p',{style:css.hint},'最近核验：'+stamp(connection.checkedAt||row.identityCheckedAt)),
        typeof connection.scope==='string'&&connection.scope&&h('p',{style:css.hint},'连接核验范围：'+connection.scope),
        typeof connection.message==='string'&&connection.message&&h('p',{style:css.hint},connection.message),
        row.available===false&&typeof (row.unavailableReason||row.reason)==='string'&&h('p',{role:'status',style:css.hint},row.unavailableReason||row.reason),
        h('p',{style:css.hint},'读取能力：'+(row.implemented===false?'渠道尚未接入，不可执行':reads.length?reads.filter(value=>typeof value==='string').map(value=>(capabilityLabels[value]||value)+(readReady(readAvailability[value])===false?'（当前不可用）':readReady(readAvailability[value])===true?'（运行条件就绪）':'')).join('、'):'尚未声明')),
        row.implemented!==false&&reads.filter(value=>readReady(readAvailability[value])===false).map(value=>h('p',{key:value,role:'status',style:css.hint},row.id==='bilibili'&&value==='search'?'宿主搜索未就绪':(capabilityLabels[value]||value)+'当前不可用',typeof readAvailability[value]?.reason==='string'?'：'+cleanMessage(readAvailability[value].reason):'')),
        h('p',{style:css.hint},'读取实测：'+(readVerified===true?'已有真实读取验证':readVerified===false?'尚未完成真实读取验证':'验证状态未声明')),
        verification&&typeof verification.note==='string'&&h('p',{style:css.hint},verification.note),
        typeof row.scope==='string'&&row.scope&&h('p',{style:css.hint},'读取范围：'+row.scope),
        actionEntries.length?h('div',null,h('p',{style:{...css.hint,marginBottom:2}},'操作能力与权限：'),...actionEntries.map(([name,value])=>{const action=value&&typeof value==='object'?value:{},supported=action.supported??action.implemented;return h('p',{key:name,style:{...css.hint,margin:'3px 0'}},(capabilityLabels[name]||name)+'：'+(row.implemented===false?'渠道尚未接入，不可执行':supported===false?'尚未支持':(supported===true?'已支持':'支持状态未确认')+' · '+(action.enabled===true?'开关已开启':action.enabled===false?'开关关闭':'权限未确认')+' · '+(action.liveVerified===true?'真实操作已验证':'真实操作未验证')));})):h('p',{style:css.hint},'未声明可执行写操作。'));
    };
    const renderGoal=row=>h('article',{key:row.id,style:css.row},h('strong',null,row.title),h('span',{style:{...css.hint,marginLeft:10}},goalLabel[row.status]||row.status,' · ',row.mode==='task'?'完成一次':'持续留意'),row.detail&&h('p',{style:{whiteSpace:'pre-wrap',margin:'4px 0'}},row.detail),row.progress&&h('p',{style:css.hint},'最近进展：'+row.progress),row.nextCheckAt&&h('p',{style:css.hint},'下次留意：'+stamp(row.nextCheckAt)),
      row.status!=='done'&&button(row.status==='paused'?'继续跟进':'暂停',()=>call('assistant/goal',{id:row.id,status:row.status==='paused'?'active':'paused'})),row.status!=='done'&&button('标为完成',()=>call('assistant/goal',{id:row.id,status:'done'})),
      button('编辑目标',async()=>{patch({goalDraft:{...row}});return {note:'已载入目标，修改后保存'};}),button('移除目标',()=>call('assistant/goal-delete',{id:row.id})));
    return h('div',{style:css.root},
      h('header',{style:{display:'flex',alignItems:'center',gap:14,padding:'8px 0 14px'}},h('div',{'aria-hidden':true,style:{width:44,height:44,border:'2px solid #6b91ad',borderRadius:'45% 55% 50% 50%',display:'grid',placeItems:'center',fontSize:22,flexShrink:0}},'鱼'),h('div',null,h('h2',{style:{fontSize:25,lineHeight:1.3,margin:0}},'My Fish'),h('p',{style:{...css.hint,margin:'4px 0 0'}},profile.name+' · 固定会话、可管理记忆与定时计划。'))),
      m.assistantError&&h('div',{role:'alert',style:{padding:'10px 12px',borderLeft:'3px solid #bd8d35'}},h('p',null,'个人记忆暂不可用：'+m.assistantError),h('p',{style:css.hint},'请检查本地记录后刷新。X 能力设置仍可使用，现有记忆没有被替换为空记录。'),button('重试个人记录',()=>load())),
      m.refreshError&&h('p',{role:'status',style:css.hint},'动态暂未刷新：'+m.refreshError+'。正在保留上次记录并等待重连。'),
      personalReady&&h('p',{style:css.hint},'记忆 '+(assistant.stats?.memoryCount??memories.length)+' 条　跟进 '+(assistant.stats?.activeGoals??active.length)+' 项　未读 '+(assistant.stats?.unread??notices.filter(row=>!row.readAt).length)+' 条'),
      m.message&&h('p',{role:'status',style:{whiteSpace:'pre-wrap',padding:'10px 12px',borderLeft:'3px solid #6b91ad'}},m.message),
      remote.sessionRecovery?.recovered&&remote.sessionRecovery.followupPaused&&h('div',{role:'status',style:{padding:'10px 12px',borderLeft:'3px solid #bd8d35'}},h('p',null,'原会话不可用，已建立新会话。自主跟进暂缓，记忆/账号配置保留。'),h('p',{style:css.hint},'新会话不会恢复已删除的聊天记录。恢复自主跟进只解除这次会话恢复暂停，不改变作息、账号暂停或社交开关，也不会立即唤醒模型。'),button('恢复自主跟进',()=>call('session/followup-resume',{}))),
      hasDraft&&h('p',{role:'status',style:css.hint},'有设置尚未保存。刷新会保留草稿；先保存对应设置，再唤醒助理。'),
      section('工作区',h('p',{style:css.hint},'选择 My Fish 在本机保存个人记录和处理文件的位置。更换位置后保存，插件会自动迁移现有资料。'),
        h('p',{style:css.hint},'迁移会切换原会话的实际工作目录，但不会改变 DSH 原会话的文件权限或项目归属；命令和文件操作继续遵循宿主权限与审批。'),
        m.workspaceError&&h('p',{role:'alert'},'工作区状态暂不可用：'+m.workspaceError+'。保留上次位置和未保存的路径，请刷新后重试。'),
        m.workspace?h('div',null,h('p',null,'个人资料位置：',h('span',{style:{overflowWrap:'anywhere'}},m.workspace.path)),h('p',null,'会话工作目录：',h('span',{style:{overflowWrap:'anywhere'}},m.workspace.workingDirectory)),
          (m.workspace.migrating||m.workspaceSaving)&&h('p',{role:'status'},'正在迁移工作区，请等待完成。迁移期间暂停本页操作。'),
          !m.workspace.canMigrate&&m.workspace.reason&&h('p',{role:'status'},m.workspace.reason),
          m.workspaceDraft&&field('新工作区绝对路径','workspaceDraft','path','text','填写新的空目录，例如 D:\\MyFish。目标已有内容时会拒绝覆盖。'),
          m.workspaceDraft?.path&&!absolutePath(m.workspaceDraft.path)&&h('p',{role:'status',style:css.hint},'请填写完整绝对路径。'),
          h('p',{style:css.hint},'会迁移角色、记忆、目标、配置、加密账号资料及工作文件；DSH 聊天记录留在宿主。原主会话会使用新工作目录，旧位置保留备份。'),
          h('p',{style:css.hint},'同一台电脑、同一系统用户下，加密文件原样迁移，无需重新登录；跨系统用户的解密不作保证。迁移前先停止正在运行的任务。'),
          button('保存并迁移工作区',migrateWorkspace,!!m.workspaceError||!m.workspace.canMigrate||!dirty('workspaceDraft')||!absolutePath(m.workspaceDraft?.path),true),
          dirty('workspaceDraft')&&button('取消路径修改',async()=>{const draft={path:m.workspace.path};set(previous=>({...previous,workspaceDraft:draft,saved:{...previous.saved,workspaceDraft:serial(draft)}}));return {note:'已恢复当前工作区路径'};}),
          m.workspace.lastMigration&&h('p',{style:css.hint},'最近迁移记录'+(m.workspace.lastMigration.at?' · '+stamp(m.workspace.lastMigration.at):'')+'，原位置保留备份。')):h('p',{style:css.muted},'尚未取得工作区位置；不会用空路径替代当前配置。')),
      personalReady&&section('现在找助理',h('label',{style:{display:'block'}},h('div',null,'本次任务（可选）'),h('textarea',{'aria-label':'本次任务（可选）',style:css.input,rows:2,value:m.task,disabled:operationBusy,onChange:e=>patch({task:e.target.value}),placeholder:'例如：检查我指定的公开信息来源，有重要变化时给出出处。'})),
        h('p',{style:css.hint},'不填临时任务时，助理会查看正在跟进的目标和相关记忆。'),h('button',{type:'button',style:css.button,disabled:operationBusy||!chatAvailable||chatDraft,onClick:openChat},'和助理聊天'),button('现在唤醒',async()=>{const result=await call('assistant/wake',m.task.trim()?{message:m.task.trim()}:{});patch({task:''});return result;},hasDraft,true),
        button('刷新动态',async()=>{await load();return {note:'动态已刷新，未保存的设置已保留'};}),
        h('p',{style:css.hint},'打开前检查常驻会话；原会话已删除时会建立新的空会话，个人记忆和配置保留。现在唤醒会交给助理一轮任务。'),
        !sessionId&&button('建立聊天会话',async()=>{const session=await ensureSession();return {note:session.note||'常驻会话已建立；现在可以打开聊天，没有投递任务'};},hasDraft),
        !sessionId&&h('p',{style:css.hint},'建立聊天会话后即可进入；这个操作不会唤醒模型或创建计划。'),
        sessionId&&(!openAssistantSession||!close)&&h('p',{style:css.hint},navigationError||'当前界面暂不能直接打开聊天，请从左侧进入助理的会话。'),
        chatDraft&&h('p',{style:css.hint},'有未保存内容，先保存或清空，再打开聊天。'),
        h('p',{style:css.hint},'本地记忆和目标不需要 X 登录。使用 X 时仍会核对账号与权限。')),
      section('定时计划',h('p',{style:css.hint},'使用宿主任务看板持久保存计划，与探索作息分开。DSH 和电脑需要保持运行；错过的触发不补跑。同一计划运行时不会重复启动。'),
        m.plansError&&h('p',{role:'alert'},'计划暂不可用：'+m.plansError),
        !m.plans&&h('p',{style:css.muted},'尚未取得宿主计划状态，请刷新动态。'),
        m.plans&&!planAvailable&&h('p',{role:'status'},m.plans.reason||'任务看板未启用，请在 DSH 启用任务看板后刷新。'),
        planAvailable&&h('div',null,planRows.length?planRows.slice(0,30).map(row=>h('article',{key:row.id||row.taskId,style:css.row},h('strong',null,row.title),h('p',{style:css.hint},planSummary(row)),row.instruction&&h('p',{style:{whiteSpace:'pre-wrap'}},row.instruction),h('p',{style:css.hint},'状态：'+({active:'已启用',scheduled:'已启用',paused:'已暂停',cancelled:'已取消',canceled:'已取消',archived:'已归档',running:'运行中',missed:'已错过',completed:'已完成',stopped:'已停止'}[row.status]||row.status||'已保存')+(row.nextRunAt?' · 下次 '+stamp(row.nextRunAt):'')),row.lastRun&&h('p',{style:css.hint},'最近执行：'+runText(row.lastRun)),row.lastRun?.error&&h('p',{role:'status',style:css.hint},'失败原因：'+cleanMessage(row.lastRun.error)),(row.runReports??[]).length>0&&h('p',{style:css.hint},'最近汇报：'+(row.runReports.at(-1).deduplicated?'相同发现已去重':row.runReports.at(-1).notified?'新发现已进入动态盒':row.runReports.at(-1).notify?'已有汇报，通知状态待核对':'安静结束')+' · '+stamp(row.runReports.at(-1).at)),(row.history??[]).length>0&&h('details',null,h('summary',null,'最近执行记录'),...row.history.slice(-5).reverse().map((run,index)=>h('p',{key:index,style:css.hint},runText(run),run.error?' · '+cleanMessage(run.error):''))),
          !row.archived&&!['cancelled','canceled','archived','completed'].includes(row.status)&&h('div',null,button(row.status==='paused'?'恢复计划':'暂停计划',()=>managePlan(row,row.status==='paused'?'resume':'pause')),button('修改时间',()=>editPlan(row)),button('取消计划',()=>managePlan(row,'cancel'))))):h('p',{style:css.muted},'还没有 My Fish 定时计划。'),
          h('details',{open:!!plan.editingTaskId,style:{marginTop:14}},h('summary',{style:{cursor:'pointer'}},plan.editingTaskId?'修改执行时间':'添加定时计划'),field('计划名称','planDraft','title','text','',{disabled:operationBusy||!!plan.editingTaskId}),field('执行要求','planDraft','instruction','textarea','写清要查看的信息来源、判断条件，以及有变化时应带回什么。',{disabled:operationBusy||!!plan.editingTaskId}),select('执行频率','planDraft','frequency',[['hourly','每小时整点'],['daily','每天'],['once','执行一次'],...(plan.frequency==='custom'?[['custom','自定义周期']]:[])]),
            plan.frequency==='custom'&&field('周期时间规则','planDraft','cron','text','保留已有五段周期规则，也可改为上面的常用执行频率。'),
            plan.frequency==='daily'&&field('每天执行时间','planDraft','time','time'),plan.frequency==='once'?field('执行日期与时间（本机时间）','planDraft','at','datetime-local','本机时区：'+localTimeZone()):field('计划时区','planDraft','timeZone','text','例如 Asia/Shanghai；会按此时区计算执行时间。'),
            h('p',{style:css.hint},'保存后会按时间自动执行。计划不会开启社交写入或本机执行权限；没有变化可以安静结束。'),plan.editingTaskId&&h('p',{style:css.hint},'这里只修改时间。更改执行要求请取消旧计划再新建，以保留清楚的执行记录。'),button(plan.editingTaskId?'保存执行时间':'保存定时计划',createPlan,!plan.title.trim()||!plan.instruction.trim()||(plan.frequency==='once'&&!plan.at),true),plan.editingTaskId&&button('取消修改时间',async()=>{patch({planDraft:emptyPlan()});return {note:'已取消修改'};})))),
      disclosure('个人工具权限',h('p',{style:css.hint},'这些权限只控制个人助理及已确认归属的计划执行，不改变其他 DSH 会话的权限。更换人设不会打开权限。'),
        m.permissionsError&&h('p',{role:'alert'},'权限暂不可用：'+m.permissionsError),
        m.policy?h('div',null,!m.capabilities?.guardAvailable&&h('p',{role:'alert'},'无法确认个人工具门禁，检查插件加载后再使用受控能力。'),toggle('允许本机命令、代码与终端','policy','shell','默认关闭。代码和终端可能间接联网或对外操作；打开后仍受 DSH 目录范围和审批限制。'),toggle('允许本地文件写入','policy','fileWrite','默认关闭。读取与修改分开控制。'),toggle('允许通用浏览器交互','policy','browserInteract','默认关闭。点击、填表可能产生外部操作；X 公开动作仍需单独授权。'),toggle('允许委派子任务','policy','delegation','默认关闭。宿主对子任务的实际权限继承仍需单独核验。'),field('禁止外发的私密词组，每行一项','policy','privateTerms','list','不要输入 Cookie、密码或密钥。命中规则时拒绝外发，错误信息不回显词组。'),button('保存个人权限',save('policy','permissions'),!dirty('policy'))):h('p',{style:css.muted},'尚未取得权限状态，请刷新后再配置。')),
      disclosure('语音输入',h('p',null,'打开固定主会话后，可使用 DSH 官方输入框的听写按钮。识别结果先进入草稿，由你检查后发送。'),h('p',{style:css.hint},'本版保留官方录音入口，不覆盖它的控件。回复朗读、连续语音和打断播报尚未接入。'),
        button('检查听写服务',async()=>{if(typeof checkSpeech!=='function')throw Error('当前 DSH 未提供语音服务检查入口，请查看官方语音插件设置。');const result=await checkSpeech();patch({speech:result});return {note:'听写服务状态已读取，没有启用麦克风或下载模型'};}),
        m.speech&&h('p',{role:'status'},m.speech.message)),
      personalReady&&section('助理消息',notices.length?h('div',null,...notices.slice(0,20).map(row=>h('article',{key:row.id,style:{...css.row,borderLeft:row.readAt?'none':'3px solid #6b91ad',paddingLeft:row.readAt?0:12}},h('strong',null,row.title),h('span',{style:{...css.hint,marginLeft:10}},row.readAt?'已读':'未读'),h('p',{style:css.hint},stamp(row.createdAt)),h('p',{style:{whiteSpace:'pre-wrap'}},row.body),...(row.links??[]).map((link,index)=>{const href=safeLink(link.url);return href?h('p',{key:index},h('a',{href,target:'_blank',rel:'noopener noreferrer',style:{color:'var(--dsw-alias-link-primary,#7eaed1)'}},link.title||link.url)):null;}),!row.readAt&&button('标为已读',()=>call('assistant/inbox-read',{id:row.id}))))):h('p',{style:css.muted},'还没有新消息。写下一个目标，再唤醒助理；有值得告诉你的发现会留在这里。'),h('p',{style:css.hint},'这里是本地消息盒。消息不会自动发到 X，也不会公开 @ 你。')),
      personalReady&&section('正在跟进',goals.filter(row=>row.status!=='done').length?goals.filter(row=>row.status!=='done').map(renderGoal):h('p',{style:css.muted},'还没有目标。可以写“持续留意什么”，也可以交给助理一件做完就结束的事。'),
        h('details',{open:!!m.goalDraft.id,style:{marginTop:14}},h('summary',{style:{cursor:'pointer'}},m.goalDraft.id?'修改目标':'交给助理一个目标'),field('目标','goalDraft','title'),field('补充要求','goalDraft','detail','textarea'),select('跟进方式','goalDraft','mode',[['watch','持续留意'],['task','完成一次']]),
          button(m.goalDraft.id?'保存目标':'添加目标',async()=>{const result=await call('assistant/goal',payload(m.goalDraft,['id','title','detail','mode','status','nextCheckAt','progress']));clearGoal();return result;},!m.goalDraft.title.trim()),m.goalDraft.id&&button('取消编辑',async()=>{clearGoal();return {note:'已取消编辑'};})),goals.some(row=>row.status==='done')&&h('details',null,h('summary',null,'已完成的目标'),...goals.filter(row=>row.status==='done').map(renderGoal))),
      personalReady&&disclosure('长期记忆（'+memories.length+'）',h('p',{style:css.hint},'这里是可检索、可纠正、可忘记的长期记录。日记不会自动变成事实；请勿填写 Cookie、密码或密钥。'),h('label',null,'查找记忆',h('input',{'aria-label':'查找记忆',style:css.input,value:m.memoryQuery,onChange:e=>patch({memoryQuery:e.target.value})})),
        filtered.length?filtered.map(row=>h('article',{key:row.id,style:css.row},h('span',{style:css.hint},memoryLabel[row.category]||row.category),h('p',{style:{whiteSpace:'pre-wrap',margin:'4px 0'}},row.text),h('p',{style:css.hint},'来源：'+row.source+' · 更新于 '+stamp(row.updatedAt)),row.expiresAt&&h('p',{style:css.hint},'有效至 '+stamp(row.expiresAt)),button('纠正这条记忆',async()=>{patch({memoryDraft:{...row}});return {note:'已载入这条记忆，修改后保存'};}),button('忘记这条',()=>call('assistant/forget',{id:row.id})))):h('p',{style:css.muted},m.memoryQuery?'没有找到相关记忆。':'还没有长期记忆。你可以在这里告诉助理，也可以在聊天中让助理记住。'),
        h('h4',null,m.memoryDraft.id?'纠正记忆':'告诉助理一件事'),field('记忆内容','memoryDraft','text','textarea'),select('记忆类型','memoryDraft','category',Object.entries(memoryLabel)),field('这条记忆的来源','memoryDraft','source'),button('保存记忆',async()=>{const result=await call('assistant/memory',payload(m.memoryDraft,['id','text','category','source','expiresAt']));clearMemory();return result;},!m.memoryDraft.text.trim()||!m.memoryDraft.source.trim()),m.memoryDraft.id&&button('取消纠正',async()=>{clearMemory();return {note:'已取消纠正'};})),
      personalReady&&disclosure('助理角色',h('p',{style:css.hint},'角色与平台能力分开保存。修改人设不会改变账号或操作权限。'),field('角色名','profile','name'),h('div',{style:css.grid},field('称呼你','profile','ownerTitle'),field('自称','profile','selfClaim')),field('人设正文','profile','persona','textarea','每轮使用前 3000 字。'),field('兴趣，每行一项','profile','interests','list'),button('保存角色',save('profile','assistant/profile'),!dirty('profile'))),
      personalReady&&disclosure('什么时候主动跟进',toggle('允许助理主动跟进','settings','enabled','DSH 运行时按作息唤醒；每轮先判断是否需要行动，没有新发现可以安静结束。开启此项不会开启发帖。'),h('div',{style:css.grid},... [['间隔分钟（30–1440）','intervalMinutes'],['开始小时（0–23）','startHour'],['结束小时（1–24）','endHour'],['每天最多唤醒次数（1–12）','maxRunsDaily'],['每轮最多帖子候选（1–20）','maxCandidates']].map(([label,key])=>field(label,'settings',key,'number'))),button('保存作息',save('settings','assistant/settings'),!dirty('settings'))),
      disclosure('渠道与账号',h('p',{style:css.hint},'分别显示渠道接入、服务就绪、账号配置和验证范围。已配置账号或服务可调用，不代表所有动作已经实测通过。'),
        m.channelsError&&h('p',{role:'alert'},'渠道目录暂不可用：'+m.channelsError+'。保留上次目录和账号设置，请刷新后核对。'),
        m.channels?(m.channels.platforms.length?m.channels.platforms.map(renderChannel):h('p',{style:css.muted},'当前没有已注册渠道；不能据此执行任何平台操作。')):h('p',{style:css.muted},'尚未取得渠道目录；未确认的渠道不会显示为已接入。'),
        h('button',{type:'button',style:css.button,disabled:operationBusy||m.channelsLoading,onClick:()=>refreshChannels()},'刷新渠道状态'),m.channelsLoading&&h('p',{role:'status',style:css.hint},'正在读取渠道目录，其他设置可继续使用。'),
        h('p',{style:css.hint},'刷新只读取本地渠道状态，不发起平台登录或真实操作。服务就绪不代表连接核验通过、当前会话可见或实际执行成功。'),
        h('p',{style:css.hint},'通用网页可复用另装的 BrowserSkill，需加载技能并检查连接。平台目录只表示各适配器声明的能力，不代表所有平台或动作均已支持。'),
        h('details',{'data-channel-account':'x',style:{marginTop:14}},h('summary',{style:{cursor:'pointer',fontWeight:600}},'X 账号设置'),h('p',{style:css.hint},'以下设置只作用于 X 适配器，不会给其他渠道配置账号或开启操作。'),
        select('账号模式','cfg','mode',[['solo','单账号'],['mention','双账号 · 可公开 @ 用户']]),field('AI 账号用户名','cfg','aiUsername','text','填 @ 后面的用户名，必须与 Cookie 对应。'),cfg.mode==='mention'&&field('接收通知的用户名','cfg','owner','text','公开 @ 会暴露两账号关联；不需要接收账号的 Cookie。'),
        h('p',null,'连接状态：',ready?'@'+remote.identity.username+'（上次体检通过）':remote.hasCredentials?'已保存 Cookie，尚未通过体检':'尚未配置'),
        ...['auth_token','ct0'].map(key=>h('label',{key,style:{display:'block',margin:'10px 0'}},key,h('input',{'aria-label':key,type:'password',autoComplete:'new-password',style:css.input,value:m.cookie[key],disabled:operationBusy,onChange:e=>set(previous=>({...previous,cookie:{...previous.cookie,[key]:e.target.value}}))}))),
        h('p',{style:css.hint},'在 AI 账号的 x.com 页面按 F12 → Application → Cookies，手动复制这两个值。Windows 使用当前用户 DPAPI 加密保存。空白输入框不会清除已存凭据；保存 Cookie 不等于登录成功。'),
        button('保存 AI Cookie',async()=>{const result=await call('credentials',m.cookie);patch({cookie:{auth_token:'',ct0:''}});return result;},!m.cookie.auth_token||!m.cookie.ct0),button('连接体检',()=>call('diagnose',{}),dirty('cfg')),
        select('接入方式','cfg','transport',[['browser','Cookie + 独立浏览器（推荐）'],['direct_api','旧 Cookie 接口（实验）']]),h('p',{style:css.hint},'两种方式由你明确选择，不会在失败时静默互相回退。Cookie 只在本机保存，不进入模型上下文。'),
        cfg.transport==='browser'&&h('div',null,h('p',{style:css.hint},'使用独立临时浏览器配置，不读取你日常 Chrome 的数据。首轮保留可见窗口以核对账号。'),field('浏览器路径（可选）','cfg','browserPath','text','Chrome 可执行文件完整路径，留空自动查找。'),toggle('后台无窗口','cfg','browserHeadless','默认关闭。遇到登录验证时停止操作，需要人工处理。')),
        field('代理地址（可选）','cfg','proxy','text','填写本机实际可用的地址，不填代理账号密码。'),cfg.transport==='direct_api'&&field('Python 路径（可选）','cfg','pythonPath'),
        h('h4',null,'X 操作权限'),toggle('允许收藏书签','cfg','allowBookmarks','只添加书签，不切换为取消收藏。'),toggle('允许公开回复','cfg','allowReplies','开启即允许专用任务自行回复相关帖子，会真实发布。'),toggle('允许公开 @ 用户分享','cfg','allowMentions','只在双账号模式生效。默认使用本地消息盒。'),h('div',{style:css.grid},field('每天最多写操作（0–20）','cfg','maxWritesDaily','number'),field('写操作最小间隔秒数（30–3600）','cfg','minWriteSeconds','number')),button('保存 X 设置',save('cfg','config'),!dirty('cfg')))),
      disclosure('运行记录与日记',h('p',null,'最近唤醒：',remote.lastRun?(labels[remote.lastRun.status]||remote.lastRun.status)+' · '+stamp(remote.lastRun.at):'尚未唤醒'),remote.lastRun?.reason&&h('p',{style:{whiteSpace:'pre-wrap'}},remote.lastRun.reason),h('p',{style:css.hint},'专用会话 ID：'+(remote.sessionId||remote.lastRun?.sessionId||'尚未创建')),h('p',null,'连接体检：',remote.lastDiagnosis?(labels[remote.lastDiagnosis.status]||remote.lastDiagnosis.status)+' · '+stamp(remote.lastDiagnosis.at):'尚未进行'),remote.lastDiagnosis?.message&&h('p',null,remote.lastDiagnosis.message),h('p',null,'最近读取：',remote.lastRead?(operationLabel[remote.lastRead.operation]||remote.lastRead.operation)+' · '+(readLabel[remote.lastRead.status]||remote.lastRead.status)+' · '+stamp(remote.lastRead.at):'尚未读取'),remote.lastRead?.message&&h('p',null,remote.lastRead.message),remote.lastRead?.kind&&h('p',{style:css.hint},'读取错误类型：'+remote.lastRead.kind),remote.lastRead?.status==='passed'&&h('p',{style:css.hint},'本次返回 '+remote.lastRead.count+' 条，仅表示读取结果。'),
        remote.pausedUntil>Date.now()&&h('p',null,'已暂停：'+remote.pauseReason),remote.inflight&&h('div',null,h('p',null,'有未确认的写操作。先到 X 核对实际结果，不要直接重发。'),button('核对：已成功',()=>call('reconcile',{confirmed:true})),button('核对：未成功',()=>call('reconcile',{confirmed:false}))),button('人工检查后恢复调度',()=>call('resume',{})),button('查看两本日记',async()=>{const result=await call('diary');patch({diaries:result.diaries});return {note:'日记已读取'};}),
        m.diaries&&Object.entries(m.diaries).map(([key,text])=>h('details',{key},h('summary',null,key==='master'?'给用户的摘要':'私人日记'),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:360,overflow:'auto'}},text||'暂无日记'))),
        h('details',null,h('summary',null,'最近唤醒记录（最多 20 次）'),...(remote.runHistory??[]).slice().reverse().map(row=>h('div',{key:row.id,style:css.row},stamp(row.at)+' · '+(row.manual?'手动':'自动')+' · '+(labels[row.status]||row.status),h('p',null,row.reason)))),
        h('details',null,h('summary',null,'最近写操作（收藏、回复、@）'),(remote.recent??[]).length?(remote.recent??[]).slice().reverse().map((row,index)=>h('p',{key:index},stamp(row.at)+' · '+({bookmark:'收藏',reply:'回复',mention:'@ 分享'}[row.type]||row.type)+' · '+row.status)):h('p',null,'尚无写操作。'))));
  }
  function SidebarEntry({wide=true,openAssistantSession,navigationError}={}){
    const [m,set]=R.useState({busy:false,error:''});
    const open=async()=>{
      if(m.busy)return;
      if(typeof openAssistantSession!=='function'){set({busy:false,error:navigationError||'当前会话导航不可用，请到 My Fish 设置中打开聊天。'});return;}
      set({busy:true,error:''});
      try{const session=await ensureSession();await openAssistantSession(session.sessionId);set({busy:false,error:''});}
      catch(e){set({busy:false,error:cleanMessage(e.message)});}
    };
    return h('div',{style:{padding:wide?'2px 8px':'2px',minWidth:0}},h('button',{type:'button','aria-label':'打开 My Fish',title:m.error||'打开 My Fish 固定主会话',disabled:m.busy,style:{...css.button,width:'100%',margin:0,textAlign:wide?'left':'center',padding:wide?'8px 12px':'8px 2px'},onClick:open},wide?(m.busy?'正在打开…':'鱼  My Fish'):'鱼'),m.error&&h('p',{role:'alert',style:{...css.hint,margin:'4px 0',overflowWrap:'anywhere'}},wide?m.error:'打开失败，请展开侧栏查看。'));
  }
  function apply(ctx){
    const checkSpeech=async()=>{
      let speech;try{speech=ctx.get?.('remote')?.speech;}catch{}
      if(typeof speech?.catalog!=='function')return {available:false,message:'官方听写服务未加载，请在 DSH 插件设置中启用语音输入。'};
      const result=await speech.catalog();if(result?.ok===false)throw Error(result.error?.message||'官方听写服务暂不可用');
      const catalog=result?.ok===true?result.value:result,providers=catalog?.providers??[],selected=providers.find(row=>row.id===catalog?.selection?.providerId);
      if(!selected)return {available:false,message:'未找到已选择的语音识别提供方，请查看官方语音设置。'};
      const phase=selected.preparation?.phase,ready=['ready','standby'].includes(phase);
      return {available:true,ready,message:selected.name+'：'+(ready?'已准备，可在固定会话中使用官方听写。':({unprepared:'尚未准备，请到官方语音设置手动准备。',downloading:'资源正在下载，请等待官方准备完成。',failed:'准备失败，请查看官方语音设置。',cancelled:'准备已取消。',loading:'识别服务正在加载。',checking:'正在检查识别资源。',waking:'识别服务正在唤醒。'}[phase]||'尚未确认就绪，请查看官方语音设置。'))};
    };
    const navigation=()=>{
      try{
        const workspace=ctx.get?.('uiWorkspace');
        if(typeof workspace?.openSession!=='function')throw Error('当前 DSH 会话导航暂不可用，请从左侧进入助理的会话。');
        return {checkSpeech,openAssistantSession:id=>{
          const current=ctx.get?.('uiWorkspace');
          if(typeof current?.openSession!=='function')throw Error('当前 DSH 会话导航暂不可用，请从左侧进入助理的会话。');
          return current.openSession(id);
        }};
      }catch(e){return {checkSpeech,navigationError:cleanMessage(e.message)};}
    };
    ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'my-fish',order:7,label:()=> 'My Fish',inject:navigation},Section),'My Fish settings'));
    ctx.effect(()=>ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'my-fish',order:7,inject:navigation},SidebarEntry),'My Fish fixed chat entry'));
  }
  return {apply,inject:['slots'],Section,SidebarEntry,initialModel};
}});
