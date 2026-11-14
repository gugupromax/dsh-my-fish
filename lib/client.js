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
  function createBrowserSpeechController({request,synthesis,Utterance,isVisible=()=>true,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,timeoutMs=2500}){
    let running=false,generation=0,timer=null,current=null,queue=[],cursor=0,epoch=null,enabled=false,initialized=false,hidden=false,mutedUntil=0,requestAbort=null,message='本地朗读未启动';
    const voices=()=>typeof synthesis?.getVoices==='function'?synthesis.getVoices().filter(v=>v.localService===true&&/^zh(?:-|_|$)/i.test(v.lang)):[];
    function interrupt(){queue=[];if(current){current=null;synthesis?.cancel?.();}}
    function pump(){
      if(!running||!enabled||!isVisible()||now()<mutedUntil||current||!queue.length)return;
      const voice=voices()[0];if(!voice||typeof Utterance!=='function'){queue=[];message='没有可确认的本地中文音色，请先在系统配置中文语音';return;}
      if(synthesis.speaking||synthesis.pending)return;
      const item=queue.shift(),utterance=new Utterance(item.text);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=1;current=utterance;message='已请求本地朗读';
      utterance.onstart=()=>{if(current===utterance)message='正在本地朗读';};
      utterance.onend=()=>{if(current!==utterance)return;current=null;message='本地朗读待命';pump();};
      utterance.onerror=()=>{if(current!==utterance)return;current=null;queue=[];message='浏览器未能播放，请点击试听并检查本地音色';};
      try{synthesis.speak(utterance);}catch{current=null;queue=[];message='浏览器朗读不可用';}
    }
    async function poll(){
      if(!running)return;if(!isVisible()){hidden=true;interrupt();message='窗口不可见，已暂停朗读';return;}
      let watch;const turn=generation,control=new AbortController();requestAbort=control;
      try{
        const result=await Promise.race([request({after:cursor,signal:control.signal}),new Promise((_,reject)=>{watch=setTimer(()=>{control.abort();reject(Error('timeout'));},timeoutMs);})]);
        if(!running||turn!==generation)return;if(!result||typeof result.enabled!=='boolean'||!Number.isSafeInteger(result.seq)||result.seq<0||!Number.isSafeInteger(result.epoch)||result.epoch<0||!Array.isArray(result.items))throw Error('speech format');
        if(!initialized||hidden||result.seq<cursor||!result.enabled||!enabled){interrupt();initialized=true;hidden=false;cursor=result.seq;epoch=result.epoch;enabled=result.enabled;message=enabled?'本地朗读待命':'未开启浏览器本地朗读';return;}
        if(!result.claimed){interrupt();cursor=result.seq;message='其它窗口正在使用朗读';return;}
        if(epoch!==result.epoch){interrupt();mutedUntil=0;epoch=result.epoch;}
        const previous=cursor;cursor=result.seq;
        if(now()>=mutedUntil)for(const item of result.items.filter(item=>Number.isSafeInteger(item.seq)&&item.seq>previous&&typeof item.text==='string'&&item.text.trim()&&item.text.length<=1600)){
          const clean=item.text.replace(/```[\s\S]*?```/g,'（省略代码）').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/^#{1,6}\s*/gm,'').replace(/[*`]/g,'').trim();
          const sentences=clean.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g)||[];for(const sentence of sentences)for(let offset=0;offset<sentence.length;offset+=120){const text=sentence.slice(offset,offset+120).trim();if(text)queue.push({...item,text});}
        }
        queue=queue.slice(0,40);pump();
      }catch{if(turn===generation){interrupt();message='朗读连接暂不可用，已停止待播内容';}}
      finally{clearTimer(watch);if(requestAbort===control)requestAbort=null;}
    }
    async function tick(){const turn=generation;await poll();if(running&&turn===generation)timer=setTimer(tick,1000);}
    return {
      start(){if(running||!synthesis||typeof Utterance!=='function')return;running=true;generation++;initialized=false;void tick();},
      stop(){running=false;generation++;clearTimer(timer);requestAbort?.abort();interrupt();message='本地朗读已停止';},
      interrupt(){mutedUntil=now()+15000;interrupt();message='正在输入，已暂停待播内容';},
      async poll(){await poll();},
      status:()=>({message,localVoices:voices().map(v=>({name:v.name,lang:v.lang})),active:!!current}),
      preview(){const voice=voices()[0];if(!synthesis||typeof Utterance!=='function'||!voice)throw Error('没有可确认的本地中文音色，请先在系统配置中文语音');interrupt();if(synthesis.speaking||synthesis.pending)throw Error('其它语音正在播放，请稍后试听');const utterance=new Utterance('你好，这是 My Fish 的本地朗读试听。');utterance.voice=voice;utterance.lang=voice.lang;current=utterance;utterance.onend=utterance.onerror=()=>{if(current===utterance)current=null;};synthesis.speak(utterance);return {note:'已请求本地试听，是否听到声音请实际确认。'};},
    };
  }
  let speechController=null,speechMounts=0;
  function ensureSpeechController(){
    if(!speechController){const consumer='fish-browser-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
      speechController=createBrowserSpeechController({synthesis:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,isVisible:()=>window.document?.visibilityState!=='hidden',request:async({after,signal})=>{const response=await fetch(API+'presentation/speech?after='+after+'&consumer='+consumer,{signal});if(!response.ok)throw Error('朗读连接不可用');return response.json();}});
    }return speechController;
  }
  let pendingSession=null;
  function ensureSession(){
    if(!pendingSession)pendingSession=call('session',{}).then(value=>{if(typeof value.sessionId!=='string'||!value.sessionId.trim())throw Error('未取得个人主会话，请在 My Fish 设置中重试。');return value;}).finally(()=>{pendingSession=null;});
    return pendingSession;
  }
  const css={root:{maxWidth:760,lineHeight:1.7,color:'var(--dsw-alias-label-primary,inherit)',paddingBottom:20,overflowWrap:'anywhere'},input:{width:'100%',boxSizing:'border-box',padding:'9px 10px',border:'1px solid #80808065',borderRadius:5,background:'transparent',color:'inherit',font:'inherit'},button:{padding:'7px 12px',margin:'4px 8px 4px 0',cursor:'pointer',border:'1px solid #80808065',borderRadius:5,background:'transparent',color:'inherit',font:'inherit'},primary:{background:'#355d7c',borderColor:'#6c95b3',color:'#fff'},hint:{opacity:.76,fontSize:12,lineHeight:1.75},section:{padding:'18px 0',borderBottom:'1px solid #80808045'},row:{padding:'12px 0',borderBottom:'1px solid #80808035'},muted:{opacity:.7},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,180px),1fr))',gap:'0 16px'}};
  const emptyMemory=()=>({text:'',category:'preference',source:'用户在设置页填写',expiryMode:'never',expiryAt:''}),emptyGoal=()=>({title:'',detail:'',mode:'watch'});
  const localTimeZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai';}catch{return 'Asia/Shanghai';}};
  function memoryExpiry(draft,now=Date.now()){
    const mode=draft.expiryMode||(draft.id?'keep':'never');
    if(mode==='keep')return draft.expiresAt??null;
    if(mode==='never')return null;
    const date=new Date(now);
    if(mode==='today'){date.setDate(date.getDate()+1);date.setHours(0,0,0,0);return date.getTime();}
    if(mode==='week'){date.setDate(date.getDate()+((8-date.getDay())%7||7));date.setHours(0,0,0,0);return date.getTime();}
    if(mode!=='custom')throw Error('请选择有效的记忆有效期');
    const value=draft.expiryAt;
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))throw Error('请选择记忆到期的日期与时间');
    const at=new Date(value),parts=value.split(/[-T:]/).map(Number);
    if(!Number.isFinite(at.getTime())||at.getFullYear()!==parts[0]||at.getMonth()+1!==parts[1]||at.getDate()!==parts[2]||at.getHours()!==parts[3]||at.getMinutes()!==parts[4]||at.getSeconds()!==(parts[5]||0))throw Error('记忆到期时间无效，请重新选择');
    if(at.getTime()<=now)throw Error('请选择未来的记忆到期时间');
    return at.getTime();
  }
  const newRequestId=()=>globalThis.crypto?.randomUUID?.()||'my-fish-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const emptyPlan=()=>({title:'',instruction:'',frequency:'hourly',time:'09:00',at:'',timeZone:localTimeZone(),requestId:newRequestId()});
  function bilibiliReference(value){
    const text=String(value||'').trim();if(/^BV1[1-9A-HJ-NP-Za-km-z]{9}$/.test(text))return text;
    let url;try{url=new URL(text);}catch{throw Error('请填写 BV 号或完整的 B站视频链接');}
    const match=url.pathname.match(/^\/video\/(BV1[1-9A-HJ-NP-Za-km-z]{9})\/?$/);
    if(url.protocol!=='https:'||!['www.bilibili.com','bilibili.com'].includes(url.hostname)||url.port||url.username||url.password||!match)throw Error('只接受 BV 号或 bilibili.com/video/ 下的完整视频链接，不接受短链接');
    return match[1];
  }
  const companionRequests=new Map();
  const companionRequestKey=(intent,sessionId)=>serial([typeof sessionId==='string'&&sessionId.trim()?sessionId.trim():null,intent]);
  function clearCompanionRequest(request){for(const [key,value] of companionRequests)if(value===request)companionRequests.delete(key);}
  function queueCompanion(intent,sessionId){
    const key=companionRequestKey(intent,sessionId);let request=companionRequests.get(key);
    if(!request){request={requestId:newRequestId()};companionRequests.set(key,request);}
    if(request.result&&!request.result.uncertain)return Promise.resolve({request,result:request.result});
    if(!request.pending)request.pending=call('companion/chat',{...intent,requestId:request.requestId}).then(result=>{if(typeof result.sessionId!=='string'||!result.sessionId.trim()||(result.queued!==true&&result.uncertain!==true))throw Error('续聊结果未能确认，请使用同一入口重试核对');request.result=result;companionRequests.set(companionRequestKey(intent,result.sessionId),request);return {request,result};}).finally(()=>{request.pending=null;});
    return request.pending;
  }
  const absolutePath=value=>typeof value==='string'&&(/^[a-z]:[\\/]/i.test(value.trim())||/^\\\\[^\\/]+[\\/][^\\/]+/.test(value.trim())||/^\//.test(value.trim()));
  function workspaceValue(value){if(typeof value?.path!=='string'||!value.path.trim()||typeof value.workingDirectory!=='string'||!value.workingDirectory.trim())throw Error('宿主未返回有效工作区位置，请刷新后重试');return value;}
  async function readWorkspace(){return workspaceValue(await call('workspace'));}
  let pendingChannels=null;
  function readChannels(){
    if(!pendingChannels)pendingChannels=call('channels').then(value=>{if(!Array.isArray(value?.platforms)||value.platforms.some(row=>!row||typeof row.id!=='string'||!row.id.trim()||typeof row.name!=='string'||!row.name.trim())||new Set(value.platforms.map(row=>row.id)).size!==value.platforms.length)throw Error('渠道目录返回格式无效，请刷新后重试');return value;}).finally(()=>{pendingChannels=null;});
    return pendingChannels;
  }
  let pendingCompanion=null;
  function readCompanion(){
    if(!pendingCompanion)pendingCompanion=call('companion').then(value=>{if(!Array.isArray(value?.threads)||value.threads.some(row=>!row||typeof row.id!=='string'||!row.id.trim()||typeof row.title!=='string'||!['active','paused','settled'].includes(row.status))||new Set(value.threads.map(row=>row.id)).size!==value.threads.length)throw Error('最近话题返回格式无效，请刷新后核对');return value;}).finally(()=>{pendingCompanion=null;});
    return pendingCompanion;
  }
  const pendingBindings=new Map();
  function readSessionBinding(workspaceId){
    const key=workspaceId||'',route='session-binding'+(key?'?workspaceId='+encodeURIComponent(key):'');
    if(!pendingBindings.has(key))pendingBindings.set(key,call(route).then(value=>{
      if(typeof value?.available!=='boolean'||typeof value.requiresBinding!=='boolean'||!Array.isArray(value.workspaces)||!Array.isArray(value.candidates)||value.workspaces.some(row=>!row||typeof row.id!=='string'||!row.id||typeof row.path!=='string'||!row.path)||value.candidates.some(row=>!row||typeof row.id!=='string'||!row.id||typeof row.cwd!=='string')||new Set(value.workspaces.map(row=>row.id)).size!==value.workspaces.length||new Set(value.candidates.map(row=>row.id)).size!==value.candidates.length)throw Error('会话分组列表格式无效，请刷新后核对');
      if(value.current!==null&&value.current!==undefined&&(typeof value.current!=='object'||Array.isArray(value.current)||(value.current.sessionId!==undefined&&value.current.sessionId!==null&&typeof value.current.sessionId!=='string')))throw Error('当前固定会话状态无效，请刷新后核对');
      if(key&&value.selectedWorkspaceId!==key)throw Error('返回的会话分组不一致，请重新选择');
      return value;
    }).finally(()=>pendingBindings.delete(key)));
    return pendingBindings.get(key);
  }
  function initialModel(){return {activePage:'daily',integrations:null,integrationDraft:null,presentationDraft:null,petCheck:null,remote:null,assistant:null,cfg:null,profile:null,settings:null,policy:null,capabilities:null,permissionsError:'',channels:null,channelsError:'',channelsLoading:false,channelChecks:{},channelChecking:'',companion:null,companionError:'',companionLoading:false,companionReference:'',workspace:null,workspaceDraft:null,workspaceError:'',workspaceSaving:false,sessionBinding:null,bindingError:'',bindingLoading:false,bindingSaving:false,bindingWorkspaceId:'',bindingSessionId:'',plans:null,plansError:'',planDraft:emptyPlan(),speech:null,assistantError:'',refreshError:'',saved:{cfg:'',profile:'',settings:'',policy:'',workspaceDraft:''},cookie:{auth_token:'',ct0:''},busy:false,message:'',diaries:null,task:'',memoryQuery:'',memoryDraft:emptyMemory(),goalDraft:emptyGoal()};}
  function Section({close,openAssistantSession,navigationError,checkSpeech}={}){
    const [m,set]=R.useState(initialModel());
    const bindingControl=R.useRef({sequence:0,workspaceId:'',sessionId:'',dirty:false,sessionChosen:false,active:true});
    const operationBusy=!!(m.busy||m.bindingSaving||m.channelChecking||m.workspace?.migrating);
    const patch=changes=>set(previous=>({...previous,...changes}));
    async function refreshChannels(allowApply=()=>true){
      if(allowApply())patch({channelsLoading:true});
      try{const channels=await readChannels();if(allowApply())patch({channels,channelsError:''});}
      catch(e){if(allowApply())patch({channelsError:cleanMessage(e.message)});}
      finally{if(allowApply())patch({channelsLoading:false});}
    }
    async function refreshCompanion(allowApply=()=>true){
      if(allowApply())patch({companionLoading:true});
      try{const companion=await readCompanion();if(allowApply())patch({companion,companionError:''});}
      catch(e){if(allowApply())patch({companionError:cleanMessage(e.message)});}
      finally{if(allowApply())patch({companionLoading:false});}
    }
    async function refreshSessionBinding(allowApply=()=>true,workspaceId){
      const control=bindingControl.current,sequence=++control.sequence,wanted=workspaceId===undefined?control.workspaceId:workspaceId;
      const apply=()=>control.active&&sequence===control.sequence&&allowApply();
      if(apply())patch({bindingLoading:true});
      try{
        const binding=await readSessionBinding(wanted);
        if(!apply())return;
        if(binding.available!==true){
          const error=cleanMessage(binding.reason||'宿主会话分组服务暂不可用，请检查后刷新');
          set(previous=>({...previous,sessionBinding:previous.sessionBinding?{...previous.sessionBinding,available:false}:binding,bindingError:error}));
          return;
        }
        const selected=typeof binding.selectedWorkspaceId==='string'?binding.selectedWorkspaceId:'',rows=binding.candidates;
        let chosen=control.sessionId;
        if(!control.sessionChosen)chosen=binding.current?.workspaceId===selected&&rows.some(row=>row.id===binding.current?.sessionId)?binding.current.sessionId:rows.length===1?rows[0].id:'';
        else if(!rows.some(row=>row.id===chosen))chosen='';
        control.workspaceId=selected;control.sessionId=chosen;
        patch({sessionBinding:binding,bindingWorkspaceId:selected,bindingSessionId:chosen,bindingError:''});
      }catch(error){if(apply())patch({bindingError:cleanMessage(error.message)});}
      finally{if(apply())patch({bindingLoading:false});}
    }
    async function load(allowApply=()=>true){
      const pending=Promise.allSettled([call('state'),call('assistant'),call('plans'),call('permissions'),readWorkspace()]);
      void refreshChannels(allowApply);
      void refreshCompanion(allowApply);
      void refreshSessionBinding(allowApply);
      const [remoteResult,assistantResult,plansResult,permissionsResult,workspaceResult]=await pending;
      if(!allowApply())return;
      set(previous=>{
        const next={...previous,saved:{...previous.saved},assistantError:assistantResult.status==='fulfilled'?'':cleanMessage(assistantResult.reason?.message),plansError:plansResult.status==='fulfilled'?'':cleanMessage(plansResult.reason?.message),permissionsError:permissionsResult.status==='fulfilled'?'':cleanMessage(permissionsResult.reason?.message),workspaceError:workspaceResult.status==='fulfilled'?'':cleanMessage(workspaceResult.reason?.message)};
        const updates=[];
        if(remoteResult.status==='fulfilled'){if(previous.remote?.sessionId!==remoteResult.value.sessionId)next.exploration=null;next.remote=remoteResult.value;next.refreshError='';updates.push(['cfg',remoteResult.value.config]);}
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
      bindingControl.current.active=true;
      const refresh=async()=>{
        if(!active||running)return;
        running=true;
        try{await load(()=>active);if(active)set(previous=>previous.refreshError?{...previous,refreshError:''}:previous);}
        catch(e){if(active){const text=cleanMessage(e.message);set(previous=>previous.refreshError===text?previous:{...previous,refreshError:text});}}
        finally{running=false;}
      };
      refresh();
      const timer=setInterval(refresh,15000);
      return ()=>{active=false;bindingControl.current.active=false;bindingControl.current.sequence++;clearInterval(timer);};
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
    const dirty=key=>m[key]!==null&&serial(m[key])!==m.saved[key],hasDraft=dirty('integrationDraft')||dirty('presentationDraft')||dirty('cfg')||dirty('profile')||dirty('settings')||dirty('policy')||dirty('workspaceDraft');
    const change=(group,key,value)=>set(previous=>({...previous,[group]:{...previous[group],[key]:value}}));
    function field(label,group,key,type='text',hint='',options={}){
      const value=m[group][key]??'',id=group+'-'+key;
      const props={id,'aria-label':label,style:css.input,disabled:operationBusy,value:Array.isArray(value)?value.join('\n'):value,onChange:e=>change(group,key,type==='number'?Number(e.target.value):type==='list'?e.target.value.split('\n'):e.target.value),...options};
      return h('label',{htmlFor:id,style:{display:'block',margin:'10px 0'}},h('div',null,label),type==='textarea'||type==='list'?h('textarea',{...props,rows:type==='textarea'?5:3}):h('input',{...props,type}),hint&&h('div',{style:css.hint},hint));
    }
    function select(label,group,key,options){const id=group+'-'+key;return h('label',{htmlFor:id,style:{display:'block',margin:'10px 0'}},h('div',null,label),h('select',{id,'aria-label':label,style:css.input,value:m[group][key]??options[0]?.[0],disabled:operationBusy,onChange:e=>change(group,key,e.target.value)},...options.map(([value,text])=>h('option',{key:value,value},text))));}
    function toggle(label,group,key,hint){return h('label',{style:{display:'block',margin:'12px 0'}},h('input',{type:'checkbox','aria-label':label,checked:!!m[group][key],disabled:operationBusy,onChange:e=>change(group,key,e.target.checked)}),' '+label,hint&&h('div',{style:css.hint},hint));}
    const section=(page,title,...children)=>h('section',{'data-fish-page':page,style:css.section},h('h3',{style:{fontSize:17,margin:'0 0 8px'}},title),...children);
    const disclosure=(page,title,...children)=>h('details',{'data-fish-page':page,style:css.section},h('summary',{style:{cursor:'pointer',fontSize:16,fontWeight:600}},title),...children);
    const profileForSave=()=>{const value={...m.profile,replyStyle:m.profile.replyStyle??'default',emojiStyle:m.profile.emojiStyle??'default'};let saved;try{saved=JSON.parse(m.saved.profile);}catch{}if(saved&&serial(value.interests)!==serial(saved.interests))value.interests=value.interests.map(text=>text.trim()).filter(Boolean);return value;};
    const save=(key,route)=>async()=>{const value=key==='profile'?profileForSave():key==='settings'?Object.fromEntries(['enabled','intervalMinutes','startHour','endHour','maxRunsDaily','maxCandidates'].map(field=>[field,m.settings[field]])):key==='policy'?{...m[key],privateTerms:m[key].privateTerms.map(text=>text.trim()).filter(Boolean)}:m[key],result=await call(route,value),savedValue=key==='settings'?{...m.settings,...value,...(result.settings||{})}:value;set(previous=>({...previous,[key]:savedValue,...(key==='cfg'?{channelChecks:{...previous.channelChecks,x:null}}:{}),saved:{...previous.saved,[key]:serial(savedValue)}}));return {...result,note:result.note||'已保存'};};
    const notices=assistant.inbox??[],goals=assistant.goals??[],memories=assistant.memories??[];
    const capabilityPage=m.capabilityPage??'expression',capabilityPages=[['expression','桌宠与语音'],['video','视频理解'],['rss','RSS 来源']];
    const capabilityPanel=(id,...children)=>h('div',{key:id,id:'fish-cap-panel-'+id,role:'tabpanel','aria-labelledby':'fish-cap-tab-'+id,hidden:capabilityPage!==id,style:{display:capabilityPage===id?'block':'none'}},...children);
    const capabilityNav=()=>h('div',{role:'tablist','aria-label':'陪伴能力分类',style:{display:'flex',flexWrap:'wrap',gap:4,borderBottom:'1px solid #80808045',margin:'12px 0'}},...capabilityPages.map(([id,label],index)=>h('button',{key:id,id:'fish-cap-tab-'+id,type:'button',role:'tab','aria-selected':capabilityPage===id,'aria-controls':'fish-cap-panel-'+id,tabIndex:capabilityPage===id?0:-1,onClick:()=>patch({capabilityPage:id}),onKeyDown:event=>{const target=event.key==='Home'?0:event.key==='End'?2:event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:null;if(target===null)return;event.preventDefault();patch({capabilityPage:capabilityPages[target][0]});event.currentTarget?.parentElement?.querySelector('#fish-cap-tab-'+capabilityPages[target][0])?.focus();},style:{...css.button,margin:0,border:0,borderBottom:capabilityPage===id?'2px solid #6b91ad':'2px solid transparent',borderRadius:0,minHeight:44}},label)));
    const refreshIntegrations=async()=>{const value=await call('integrations');if(typeof value.settings?.rssEnabled!=='boolean'||typeof value.settings?.videoEnabled!=='boolean'||typeof value.settings?.rssFeedLines!=='string'||typeof value.presentation?.settings?.enabled!=='boolean')throw Error('陪伴能力配置返回格式无效');const draft={rssEnabled:value.settings.rssEnabled,videoEnabled:value.settings.videoEnabled,rssFeedLines:value.settings.rssFeedLines};set(previous=>{const next={...previous,integrations:value,saved:{...previous.saved}};for(const [key,data]of [['integrationDraft',draft],['presentationDraft',value.presentation.settings]])if(previous[key]===null||serial(previous[key])===previous.saved[key]){next[key]=data;next.saved[key]=serial(data);}return next;});return {note:'已读取本地能力状态，没有安装插件或连接平台账号。'};};
    const filtered=memories.filter(row=>(row.text+' '+row.source+' '+(memoryLabel[row.category]||'')).toLocaleLowerCase().includes(m.memoryQuery.trim().toLocaleLowerCase()));
    const active=goals.filter(row=>row.status==='active');
    const sessionId=typeof remote.sessionId==='string'?remote.sessionId.trim():'';
    const binding=m.sessionBinding,bindingCurrent=binding?.current||{},bindingGroups=binding?.workspaces||[],bindingCandidates=binding?.candidates||[];
    const bindingRequired=binding?.requiresBinding===true;
    const sessionBlocked=!binding||!!m.bindingError||m.bindingLoading||binding.available!==true||bindingRequired;
    const bindingDraft=!!(bindingControl.current.dirty&&(m.bindingWorkspaceId!==(bindingCurrent.workspaceId||'')||m.bindingSessionId!==(bindingCurrent.sessionId||'')));
    const otherChatDraft=!!(hasDraft||m.task.trim()||m.memoryDraft.text.trim()||m.memoryDraft.expiryAt||(m.memoryDraft.expiryMode&&m.memoryDraft.expiryMode!=='never')||m.goalDraft.title.trim()||m.goalDraft.detail.trim()||m.planDraft.title.trim()||m.planDraft.instruction.trim());
    const chatDraft=otherChatDraft||!!m.companionReference.trim()||bindingDraft;
    const chatAvailable=!!sessionId&&!sessionBlocked&&typeof openAssistantSession==='function'&&typeof close==='function';
    const openChat=async()=>{
      if(operationBusy||!chatAvailable||chatDraft)return;
      patch({busy:true,message:''});
      let session;
      try{session=await ensureSession();set(previous=>({...previous,remote:{...previous.remote,sessionId:session.sessionId},message:session.note||''}));await openAssistantSession(session.sessionId);close();}
      catch(e){patch({message:[session?.recovered?session.note:'',cleanMessage(e.message)].filter(Boolean).join('\n')});}
      finally{patch({busy:false});}
    };
    const clearGoal=()=>patch({goalDraft:emptyGoal()}),clearMemory=()=>patch({memoryDraft:emptyMemory()});
    const changeBindingWorkspace=value=>{
      const control=bindingControl.current;control.workspaceId=value;control.sessionId='';control.dirty=true;control.sessionChosen=false;
      patch({bindingWorkspaceId:value,bindingSessionId:''});void refreshSessionBinding(()=>true,value);
    };
    const changeBindingSession=value=>{const control=bindingControl.current;control.sessionId=value;control.sessionChosen=true;control.dirty=true;patch({bindingSessionId:value});};
    const bindSession=async()=>{
      if(bindingControl.current.binding)return {note:'正在固定使用这条会话，请等待核对。'};
      if(otherChatDraft||m.companionReference.trim())throw Error('请先保存或清空其他草稿，再固定使用这条会话');
      const requested={workspaceId:m.bindingWorkspaceId,sessionId:m.bindingSessionId};
      if(!binding?.available||m.bindingError||m.bindingLoading||!bindingGroups.some(row=>row.id===requested.workspaceId)||!bindingCandidates.some(row=>row.id===requested.sessionId))throw Error('请先核对分组并选择其中已有的会话');
      bindingControl.current.binding=true;patch({bindingSaving:true});
      try{
        const result=await call('session/bind',requested);if(result.sessionId!==requested.sessionId)throw Error('固定会话结果未能确认，请刷新后核对');
        bindingControl.current.dirty=false;bindingControl.current.sessionChosen=false;
        set(previous=>({...previous,exploration:null,remote:{...previous.remote,sessionId:result.sessionId},sessionBinding:previous.sessionBinding?{...previous.sessionBinding,current:{sessionId:result.sessionId,workspaceId:requested.workspaceId,cwd:bindingCandidates.find(row=>row.id===requested.sessionId)?.cwd||''}}:previous.sessionBinding}));
        await refreshSessionBinding();return {...result,note:result.note||'已固定使用这条已有会话；没有创建聊天或发送消息。'};
      }finally{bindingControl.current.binding=false;patch({bindingSaving:false});}
    };
    const companionChat=async(id,withReference=false,game=false,video=false)=>{
      if(sessionBlocked||bindingDraft)return {note:'请先在工作区核对分组，并固定使用其中已有的会话。'};
      if(otherChatDraft||(!withReference&&m.companionReference.trim()))return {note:'先保存或清空其他草稿，再接着聊。'};
      const intent={...(id?{id}:{}),...(withReference?{reference:bilibiliReference(m.companionReference)}:{}),...(game?{game:true}:{}),...(video?{video:true}:{})};let queued;
      try{queued=await queueCompanion(intent,remote.sessionId);}catch(e){throw Error('这次续聊是否已接收尚未确认；再次点击会使用同一请求核对。'+cleanMessage(e.message));}
      const {request,result}=queued;
      patch({remote:{...remote,sessionId:result.sessionId}});
      if(typeof openAssistantSession==='function'){
        try{await openAssistantSession(result.sessionId);}catch(e){throw Error((result.uncertain?'投递结果尚未确认，打开主会话核对失败；再次点击会继续核对。':'话题已交给主会话，打开聊天失败；再次点击只重试打开。')+cleanMessage(e.message));}
        if(!result.uncertain){clearCompanionRequest(request);if(withReference)patch({companionReference:''});if(typeof close==='function')close();}
      }else if(!result.uncertain){clearCompanionRequest(request);if(withReference)patch({companionReference:''});}
      return {...result,note:(result.uncertain?'这次投递结果尚未确认，请到主会话核对；再次点击会使用同一请求核对，不会重新投递。':result.note||'话题已交给主会话，等它实际读取后再聊。')+(typeof openAssistantSession==='function'?'':'请从侧栏打开 My Fish 聊天。')};
    };
    const changeTopic=async(row,status)=>{const result=await call('companion/topic',{id:row.id,status});await refreshCompanion();return result;};
    const topicSources=row=>{
      if(Array.isArray(row.latestSources))return row.latestSources;
      const ids=new Set((row.episodes||[]).flatMap(episode=>episode.sourceIds||episode.receiptIds||[]));return (m.companion?.receipts||[]).filter(receipt=>ids.has(receipt.id));
    };
    const renderTopic=row=>{
      const sources=topicSources(row),revisions=(row.revisions||row.episodes||[]).filter(item=>typeof item.before==='string'||typeof item.after==='string');
      return h('article',{key:row.id,'data-companion-topic':row.id,style:css.row},h('h4',{style:{fontSize:16,margin:'0 0 6px',lineHeight:1.5}},row.title),
        h('p',{style:{whiteSpace:'pre-wrap',margin:'6px 0',fontSize:15}},row.currentThought||'刚起了个念头，还没有形成看法。'),
        row.openQuestion&&h('p',{style:{whiteSpace:'pre-wrap',margin:'6px 0'}},'还想弄明白：'+row.openQuestion),
        (row.userPositions||[]).slice(-1).map(position=>h('blockquote',{key:position.messageId,style:{...css.hint,margin:'8px 0',paddingLeft:12,borderLeft:'2px solid #80808065'}},'你上次说：“'+position.quote+'”')),
        h('div',null,button('接着聊',()=>companionChat(row.id),sessionBlocked||bindingDraft||otherChatDraft||!!m.companionReference.trim()||!!m.companionError,true),button(row.status==='active'?'先放一放':'继续琢磨',()=>changeTopic(row,row.status==='active'?'paused':'active'),!!m.companionError)),
        h('details',null,h('summary',{style:{cursor:'pointer',...css.hint}},'想法和出处'),
          row.nextQuestion&&h('p',{style:css.hint},'接下来想看看：'+row.nextQuestion),
          revisions.length?h('div',null,...revisions.slice(-4).map((change,index)=>h('div',{key:index,style:{padding:'7px 0'}},change.before&&h('p',{style:css.hint},'之前：'+change.before),change.after&&h('p',null,'现在：'+change.after),change.reason&&h('p',{style:css.hint},change.reason),change.at&&h('p',{style:css.hint},stamp(change.at))))):h('p',{style:css.hint},'还没有新的观点变化。'),
          sources.length?sources.slice(-6).map((source,index)=>{const href=safeLink(source.url);return h('div',{key:source.id||index,style:{padding:'5px 0'}},href?h('a',{href,target:'_blank',rel:'noopener noreferrer',style:{color:'var(--dsw-alias-link-primary,#7eaed1)'}},source.title||source.url):h('span',null,source.title||'本地读取记录'),h('p',{style:{...css.hint,margin:'2px 0'}},source.scope||'读取范围未说明',source.truncated?'；内容有截断':'',source.readAt?' · '+stamp(source.readAt):''));}):h('p',{style:css.hint},'还没有已读取的来源。'),
          button('忘掉这条兴趣',async()=>{const result=await call('companion/forget',{id:row.id});await refreshCompanion();return result;},!!m.companionError)));
    };
    const payload=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
    const saveMemory=async()=>{const request={...payload(m.memoryDraft,['id','text','category','source']),expiresAt:memoryExpiry(m.memoryDraft)};const result=await call('assistant/memory',request);clearMemory();return result;};
    const snooze=async preset=>{
      let result;try{result=await call('assistant/snooze',{preset});}catch(error){throw Error('临时免打扰修改未确认，请刷新核对：'+cleanMessage(error.message));}
      const settings=result.settings;
      if(!settings||typeof settings!=='object'||!(settings.snoozeUntil===null||(Number.isSafeInteger(settings.snoozeUntil)&&settings.snoozeUntil>=0&&settings.snoozeUntil<=8640000000000000)))throw Error('临时免打扰状态未能确认，请刷新后核对');
      set(previous=>({...previous,assistant:{...previous.assistant,settings},settings:serial(previous.settings)===previous.saved.settings?settings:{...previous.settings,snoozeUntil:settings.snoozeUntil},saved:{...previous.saved,settings:serial(settings)}}));
      return result;
    };
    const snoozeUntil=assistant.settings?.snoozeUntil??null,snoozed=Number.isSafeInteger(snoozeUntil)&&snoozeUntil>Date.now();
    let expiryHint='长期保留，直到你纠正或忘记。';
    try{const expiry=memoryExpiry(m.memoryDraft);if(expiry!==null)expiryHint='有效至 '+stamp(expiry)+'；到期后不再参与记忆检索。';}catch{expiryHint='请选择未来的日期与时间，保存前会检查有效期。';}
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
    const capabilityLabels={discover:'公开热门候选',search:'搜索',read:'读取单条内容',comments:'读取评论',timeline:'时间线',feed:'信息流',profile:'账号资料',bookmark:'收藏',favorite:'收藏',like:'点赞',reply:'公开回复',comment:'公开评论',mention:'公开 @ 分享',publish:'公开发布',dm:'私信',follow:'关注'};
    const cookieDraft=Object.values(m.cookie).some(Boolean),xDraft=dirty('cfg')||cookieDraft;
    const checkChannel=async row=>{
      if(operationBusy||row.directoryUnknown||row.diagnostics?.supported!==true||(row.id==='x'&&xDraft))return;
      patch({channelChecking:row.id});
      try{
        const result=await call('channels/check',{platform:row.id});
        if(result.platform!==row.id||result.channel?.id!==row.id||typeof result.channel.name!=='string')throw Error('渠道检查返回格式无效，请刷新后重试');
        set(previous=>({...previous,channels:previous.channels?{...previous.channels,platforms:previous.channels.platforms.map(value=>value.id===row.id?result.channel:value)}:previous.channels,channelChecks:{...previous.channelChecks,[row.id]:{checks:result.checks,note:cleanMessage(result.note||'检查已完成')}}}));
      }catch(e){
        let error=cleanMessage(e.message);for(const value of Object.values(m.cookie))if(value)error=error.split(value).join('[凭据已隐藏]');
        set(previous=>({...previous,channelChecks:{...previous.channelChecks,[row.id]:{error}}}));
        await refreshChannels();
      }finally{patch({channelChecking:''});}
    };
    const renderXSettings=()=>h('div',{'data-channel-account':'x'},
      select('账号模式','cfg','mode',[['solo','单账号'],['mention','双账号 · 可公开 @ 用户']]),field('AI 账号用户名','cfg','aiUsername','text','填 @ 后面的用户名，必须与 Cookie 对应。'),cfg.mode==='mention'&&field('接收通知的用户名','cfg','owner','text','公开 @ 会暴露两账号关联；不需要接收账号的 Cookie。'),
      h('p',{style:css.hint},remote.hasCredentials?'Cookie：已在本机保存；留空保留已有凭据。':'Cookie：尚未保存。'),
      ...['auth_token','ct0'].map(key=>h('label',{key,style:{display:'block',margin:'10px 0'}},key,h('input',{'aria-label':key,type:'password',autoComplete:'new-password',style:css.input,value:m.cookie[key],disabled:operationBusy,onChange:e=>set(previous=>({...previous,cookie:{...previous.cookie,[key]:e.target.value}}))}))),
      h('p',{style:css.hint},'在 AI 账号的 x.com 页面按 F12 → Application → Cookies，手动复制这两个值。Windows 使用当前用户 DPAPI 加密保存。空白输入框不会清除已存凭据；保存 Cookie 不等于登录成功。'),
      button('保存 AI Cookie',async()=>{const result=await call('credentials',m.cookie);set(previous=>({...previous,cookie:{auth_token:'',ct0:''},channelChecks:{...previous.channelChecks,x:null}}));return result;},!m.cookie.auth_token||!m.cookie.ct0),
      select('接入方式','cfg','transport',[['browser','Cookie + 独立浏览器（推荐）'],['direct_api','旧 Cookie 接口（实验）']]),h('p',{style:css.hint},'两种方式由你明确选择，不会在失败时静默互相回退。Cookie 只在本机保存，不进入模型上下文。'),
      cfg.transport==='browser'&&h('div',null,h('p',{style:css.hint},'使用独立临时浏览器配置，不读取你日常 Chrome 的数据。首轮保留可见窗口以核对账号。'),field('浏览器路径（可选）','cfg','browserPath','text','Chrome 可执行文件完整路径，留空自动查找。'),toggle('后台无窗口','cfg','browserHeadless','默认关闭。遇到登录验证时停止操作，需要人工处理。')),
      field('代理地址（可选）','cfg','proxy','text','填写本机实际可用的地址，不填代理账号密码。'),cfg.transport==='direct_api'&&field('Python 路径（可选）','cfg','pythonPath'),
      h('h4',null,'X 操作权限'),toggle('允许收藏书签','cfg','allowBookmarks','只添加书签，不切换为取消收藏。'),toggle('允许公开回复','cfg','allowReplies','开启即允许专用任务自行回复相关帖子，会真实发布。'),toggle('允许公开 @ 用户分享','cfg','allowMentions','只在双账号模式生效。默认使用本地消息盒。'),h('div',{style:css.grid},field('每天最多写操作（0–20）','cfg','maxWritesDaily','number'),field('写操作最小间隔秒数（30–3600）','cfg','minWriteSeconds','number')),button('保存 X 设置',save('cfg','config'),!dirty('cfg')));
    const renderChannel=row=>{
      const capabilities=row.capabilities&&typeof row.capabilities==='object'?row.capabilities:{},reads=Array.isArray(row.reads)?row.reads:Array.isArray(capabilities.reads)?capabilities.reads:[];
      const actions=row.actions??capabilities.actions,actionEntries=Array.isArray(actions)?actions.filter(value=>typeof value==='string').map(value=>[value,{}]):actions&&typeof actions==='object'?Object.entries(actions):[];
      const connection=typeof row.connection==='string'?{state:row.connection}:row.connection&&typeof row.connection==='object'?row.connection:{};
      const state=connection.state??connection.status,connectionText={unconfigured:'未配置',unchecked:'尚未核验',unverified:'尚未核验',verified:'最近连接核验通过',configured:'已配置，尚未核验',ready:'连接可用，动作仍需单独验收',connected:'已连接，动作仍需单独验收',unavailable:'连接不可用',disconnected:'未连接',failed:'连接失败',unknown:'尚未确认'}[state]||'尚未确认';
      const verification=row.readVerification??capabilities.readVerification,readVerified=verification&&typeof verification==='object'?verification.liveVerified:undefined,readAvailability=row.readAvailability??capabilities.readAvailability??{};
      const readReady=value=>typeof value==='boolean'?value:value?.available;
      const report=m.channelChecks[row.id],checks=report?.checks,checkSupported=row.diagnostics?.supported===true;
      const compactStatus=row.directoryUnknown?'目录未确认':row.id==='x'&&xDraft?'有未保存修改':report?.error?'检查未完成':row.implemented===false?'尚未接入':row.available===false?'当前未就绪':row.accountRequired!==false&&row.configured===false?'尚未配置账号':connectionText;
      const identityText=row.accountRequired===false?'无需账号，无需核验个人身份':row.id==='x'&&xDraft?'有未保存修改，保存后重新核验':report?.error?'本次未能核验':checks?.identity?.status==='verified'&&state==='verified'?'已核验'+(checks.identity.username?' · @'+checks.identity.username:''):state==='verified'&&row.id==='x'&&remote.identity?.username?'最近已核验 · @'+remote.identity.username:'尚未核验';
      return h('details',{key:row.id,'data-channel':row.id,style:css.row},h('summary',{style:{cursor:'pointer',fontSize:16,fontWeight:600}},row.name,h('span',{style:{...css.hint,fontWeight:400,marginLeft:12}},compactStatus)),
        row.id==='x'?renderXSettings():h('div',null,h('p',null,row.accountRequired===false?'无需账号 · 无需 Cookie':'此渠道暂未提供账号配置表单。'),typeof row.description==='string'&&row.description&&h('p',{style:css.hint},row.description),row.id==='bilibili'&&h('p',{style:css.hint},'本版仅匿名只读，不支持登录、收藏、发布、评论或点赞。')),
        h('p',null,'账号身份：'+identityText),h('p',null,'连接核验：'+(report?.error&&state!=='failed'?'本次检查未完成，上次状态待刷新':connectionText)),
        h('p',{style:css.hint},row.id==='x'?'权限检查仅核对已保存的开关配置，未做写入实测；身份核验通过不等于真实发帖验收。':row.accountRequired===false?'权限说明：匿名读取公开资料；不核验个人账号或写权限。':'权限检查仅核对渠道已声明的配置，不执行公开写操作。'),
        h('button',{type:'button','aria-label':row.name+' 检查连接与权限',style:css.button,disabled:operationBusy||!checkSupported||!!row.directoryUnknown||(row.id==='x'&&xDraft),onClick:()=>checkChannel(row)},m.channelChecking===row.id?'检查中…':'检查连接与权限'),
        row.id==='x'&&xDraft&&h('p',{role:'status',style:css.hint},'请先保存 X 设置和已填写的 Cookie，再检查当前账号的连接与权限。'),
        !checkSupported&&h('p',{style:css.hint},'此渠道尚未提供连接检查。'),
        report?.error&&h('p',{role:'alert'},'检查未完成：'+report.error),
        report?.note&&h('p',{role:'status',style:css.hint},report.note),
        h('details',{'data-channel-status':row.id,style:{marginTop:10}},h('summary',{style:{cursor:'pointer'}},'详细状态'),
        h('p',{style:css.hint},'接入状态：'+(row.implemented===true?'已实现':row.implemented===false?'尚未接入':'尚未确认')+' · 服务状态：'+(row.available===true?'适配服务已就绪':row.available===false?'当前未就绪':'尚未确认')),
        typeof row.installed==='boolean'&&h('p',{style:css.hint},'接入组件：'+(row.installed?'已检测到':'未检测到')),
        h('p',{style:css.hint},'账号配置：'+(row.accountRequired===false?'无需账号':row.configured===true?'已配置':row.configured===false?'尚未配置':'尚未确认')+(report?.error?' · 上次目录连接状态：':' · 连接核验：')+connectionText),
        h('p',{style:css.hint},'当前会话可见性：'+(row.currentSessionVisible===true?'已确认可见':row.currentSessionVisible===false?'当前不可见':'尚未确认')),
        (connection.checkedAt||row.identityCheckedAt)&&h('p',{style:css.hint},'最近核验：'+stamp(connection.checkedAt||row.identityCheckedAt)),
        typeof connection.scope==='string'&&connection.scope&&h('p',{style:css.hint},'连接核验范围：'+connection.scope),
        typeof connection.message==='string'&&connection.message&&h('p',{style:css.hint},connection.message),
        checks?.permissions?.scope&&h('p',{style:css.hint},'权限核对范围：'+cleanMessage(checks.permissions.scope)),
        checks?.identity?.scope&&h('p',{style:css.hint},'身份核验范围：'+cleanMessage(checks.identity.scope)),
        row.available===false&&typeof (row.unavailableReason||row.reason)==='string'&&h('p',{role:'status',style:css.hint},row.unavailableReason||row.reason),
        h('p',{style:css.hint},'读取能力：'+(row.implemented===false?'渠道尚未接入，不可执行':reads.length?reads.filter(value=>typeof value==='string').map(value=>(capabilityLabels[value]||value)+(readReady(readAvailability[value])===false?'（当前不可用）':readReady(readAvailability[value])===true?'（运行条件就绪）':'')).join('、'):'尚未声明')),
        row.implemented!==false&&reads.filter(value=>readReady(readAvailability[value])===false).map(value=>h('p',{key:value,role:'status',style:css.hint},row.id==='bilibili'&&value==='search'?'宿主搜索未就绪':(capabilityLabels[value]||value)+'当前不可用',typeof readAvailability[value]?.reason==='string'?'：'+cleanMessage(readAvailability[value].reason):'')),
        h('p',{style:css.hint},'读取实测：'+(readVerified===true?'已有真实读取验证':readVerified===false?'尚未完成真实读取验证':'验证状态未声明')),
        verification&&typeof verification.note==='string'&&h('p',{style:css.hint},verification.note),
        typeof row.scope==='string'&&row.scope&&h('p',{style:css.hint},'读取范围：'+row.scope),
        actionEntries.length?h('div',null,h('p',{style:{...css.hint,marginBottom:2}},'操作能力与权限：'),...actionEntries.map(([name,value])=>{const action=value&&typeof value==='object'?value:{},supported=action.supported??action.implemented;return h('p',{key:name,style:{...css.hint,margin:'3px 0'}},(capabilityLabels[name]||name)+'：'+(row.implemented===false?'渠道尚未接入，不可执行':supported===false?'尚未支持':(supported===true?'已支持':'支持状态未确认')+' · '+(action.enabled===true?'开关已开启':action.enabled===false?'开关关闭':'权限未确认')+' · '+(action.liveVerified===true?'真实操作已验证':'真实操作未验证')));})):h('p',{style:css.hint},'未声明可执行写操作。')));
    };
    const renderGoal=row=>h('article',{key:row.id,style:css.row},h('strong',null,row.title),h('span',{style:{...css.hint,marginLeft:10}},goalLabel[row.status]||row.status,' · ',row.mode==='task'?'完成一次':'持续留意'),row.detail&&h('p',{style:{whiteSpace:'pre-wrap',margin:'4px 0'}},row.detail),row.progress&&h('p',{style:css.hint},'最近进展：'+row.progress),row.nextCheckAt&&h('p',{style:css.hint},'下次留意：'+stamp(row.nextCheckAt)),
      row.status!=='done'&&button(row.status==='paused'?'继续跟进':'暂停',()=>call('assistant/goal',{id:row.id,status:row.status==='paused'?'active':'paused'})),row.status!=='done'&&button('标为完成',()=>call('assistant/goal',{id:row.id,status:'done'})),
      button('编辑目标',async()=>{patch({goalDraft:{...row}});return {note:'已载入目标，修改后保存'};}),button('移除目标',()=>call('assistant/goal-delete',{id:row.id})));
    const content=[
      h('header',{style:{display:'flex',alignItems:'center',gap:14,padding:'8px 0 14px'}},h('div',{'aria-hidden':true,style:{width:44,height:44,border:'2px solid #6b91ad',borderRadius:'45% 55% 50% 50%',display:'grid',placeItems:'center',fontSize:22,flexShrink:0}},'鱼'),h('div',null,h('h2',{style:{fontSize:25,lineHeight:1.3,margin:0}},'My Fish'),h('p',{style:{...css.hint,margin:'4px 0 0'}},profile.name+' · 和你聊天，也有自己想弄明白的事。'))),
      personalReady&&h('button',{type:'button',style:css.button,disabled:operationBusy||!chatAvailable||chatDraft,onClick:openChat},'和助理聊天'),
      m.assistantError&&h('div',{role:'alert',style:{padding:'10px 12px',borderLeft:'3px solid #bd8d35'}},h('p',null,'个人记忆暂不可用：'+m.assistantError),h('p',{style:css.hint},'请检查本地记录后刷新。X 能力设置仍可使用，现有记忆没有被替换为空记录。'),button('重试个人记录',()=>load())),
      m.refreshError&&h('p',{role:'status',style:css.hint},'动态暂未刷新：'+m.refreshError+'。正在保留上次记录并等待重连。'),
      personalReady&&h('p',{style:css.hint},'记忆 '+(assistant.stats?.memoryCount??memories.length)+' 条　跟进 '+(assistant.stats?.activeGoals??active.length)+' 项　未读 '+(assistant.stats?.unread??notices.filter(row=>!row.readAt).length)+' 条'),
      m.message&&h('p',{role:'status',style:{whiteSpace:'pre-wrap',padding:'10px 12px',borderLeft:'3px solid #6b91ad'}},m.message),
      (bindingRequired||bindingDraft)&&h('div',{role:'status',style:{...css.hint,padding:'8px 12px',borderLeft:'3px solid #bd8d35'}},'请在“设置 → 工作区”选择分组内已有的会话，并点击“固定使用这条会话”。这里不会再创建未分组聊天。',h('button',{type:'button',style:css.button,onClick:()=>patch({activePage:'settings'})},'打开会话设置')),
      (!binding||m.bindingError||binding.available===false)&&h('p',{role:'status',style:css.hint},m.bindingError?'固定会话状态未确认，请在工作区刷新后核对。':binding?.available===false?(binding.reason||'宿主会话分组服务暂不可用，请检查后在工作区刷新。'):'正在核对固定会话与分组…'),
      remote.sessionRecovery?.recovered&&remote.sessionRecovery.followupPaused&&h('div',{role:'status',style:{padding:'10px 12px',borderLeft:'3px solid #bd8d35'}},h('p',null,'原会话不可用，已建立新会话。自主跟进暂缓，记忆/账号配置保留。'),h('p',{style:css.hint},'新会话不会恢复已删除的聊天记录。恢复自主跟进只解除这次会话恢复暂停，不改变作息、账号暂停或社交开关，也不会立即唤醒模型。'),button('恢复自主跟进',()=>call('session/followup-resume',{}))),
      hasDraft&&h('p',{role:'status',style:css.hint},'有设置尚未保存。刷新会保留草稿；先保存对应设置，再唤醒助理。'),
      personalReady&&section('daily','最近在琢磨',
        m.companionError&&h('p',{role:'status',style:css.hint},'最近的话题暂未更新：'+m.companionError+'。'+(m.companion?'下面保留上次记录，请刷新后再操作。':'其余设置仍可使用。')),
        !m.companion?h('p',{style:css.muted},m.companionLoading?'在找最近聊到哪儿了…':'还没有取得最近的话题。'):
          m.companion.threads.some(row=>row.status==='active')?m.companion.threads.filter(row=>row.status==='active').slice(0,3).map(renderTopic):h('p',{style:css.muted},'还没有正在琢磨的话题。可以一起聊一条链接，或让它自己去找点有意思的东西。'),
        m.companion&&m.companion.threads.filter(row=>row.status!=='active').length>0&&h('details',null,h('summary',{style:{cursor:'pointer'}},'先前的念头'),...m.companion.threads.filter(row=>row.status!=='active').slice(0,10).map(renderTopic)),
        m.companion&&m.companion.threads.filter(row=>row.status==='active').length>3&&h('details',null,h('summary',{style:{cursor:'pointer'}},'还有几件在想的事'),...m.companion.threads.filter(row=>row.status==='active').slice(3,10).map(renderTopic)),
        button('随便逛逛，回来聊',()=>companionChat(),sessionBlocked||bindingDraft||otherChatDraft||!!m.companionReference.trim()||!m.companion||!!m.companionError),
        h('details',null,h('summary',{style:{cursor:'pointer'}},'一起聊条 B站链接'),h('label',{style:{display:'block',margin:'10px 0'}},h('div',null,'想一起聊的B站链接'),h('input',{'aria-label':'想一起聊的B站链接',style:css.input,disabled:operationBusy,value:m.companionReference,onChange:e=>patch({companionReference:e.target.value}),placeholder:'BV 号或 https://www.bilibili.com/video/BV…'})),button('聊这个',()=>companionChat(undefined,true),sessionBlocked||bindingDraft||otherChatDraft||!m.companionReference.trim()||!m.companion||!!m.companionError,true),button('猜猜评论',()=>companionChat(undefined,true,true),sessionBlocked||bindingDraft||otherChatDraft||!m.companionReference.trim()||!m.companion||!!m.companionError),button('看片段',()=>companionChat(undefined,true,false,true),sessionBlocked||bindingDraft||otherChatDraft||!m.companionReference.trim()||!m.companion||!!m.companionError),h('p',{style:css.hint},'普通聊链接模式目前能读公开视频简介和部分评论，聊观点、接着找线索；还不能观看视频或读取音频。看片段需在设置开启视频理解，只返回抽样画面与文字，不代表完整观看。')),
        button('取消当前猜评论',()=>call('companion/guess-cancel',{}),operationBusy),
        h('details',null,h('summary',{style:{cursor:'pointer'}},'公开内容探索与最近经历'),
          h('p',{style:css.hint},'无需账号，可浏览B站公共热门或按问题搜索。简介和评论不等于看过视频。后台执行记录可能显示在会话列表里，交流仍回到原主会话。'),
          button('自己逛一会儿',()=>call('exploration/start',{}),operationBusy||sessionBlocked||bindingDraft),
          button('停止探索或结束等待',()=>call('exploration/cancel',{}),operationBusy),
          button('看看最近的经历',async()=>{const value=await call('exploration');if(!Array.isArray(value.experiences?.episodes)||!Array.isArray(value.active))throw Error('探索记录返回格式无效');patch({exploration:value});return {note:value.active.length?'正在逛公开内容':'已刷新实际阅读经历'};},operationBusy),
          m.exploration?.active?.length>0&&h('p',{role:'status',style:css.hint},'正在后台探索，有新发现才会回来聊。'),
          ...(m.exploration?.experiences?.episodes||[]).slice(-3).map(row=>h('article',{key:row.id,style:css.row},h('strong',null,row.title),h('p',{style:{whiteSpace:'pre-wrap'}},row.thought),h('p',{style:css.hint},'还想弄清：'+(row.nextQuestion||row.question)),...(row.sources||[]).slice(0,2).map(source=>safeLink(source.url)?h('a',{key:source.id,href:safeLink(source.url),target:'_blank',rel:'noreferrer',style:{display:'block'}},source.title||'实际读取来源'):null))),
          m.exploration&&m.exploration.experiences.episodes.length===0&&h('p',{style:css.hint},'还没有已保存的阅读经历；没有内容时也可以安静结束。')),
        (otherChatDraft||m.companionReference.trim())&&h('p',{style:css.hint},otherChatDraft?'有其他内容还没保存，先保存或清空，再接着聊。':'链接草稿会保留。先聊这条链接或清空输入，再换话题。'),
        h('button',{type:'button',style:{...css.button,fontSize:12},disabled:operationBusy||m.companionLoading,onClick:()=>refreshCompanion()},m.companionLoading?'正在刷新话题…':'刷新最近话题'),
        h('p',{style:css.hint},'点击续聊会把话题交给同一个 My Fish 主会话。自行探索仍按你保存的作息和权限进行。')),
      disclosure('settings','工作区',h('p',{style:css.hint},'选择 My Fish 在本机保存个人记录和处理文件的位置。更换位置后保存，插件会自动迁移现有资料。'),
        h('p',{style:css.hint},'迁移会切换原会话的实际工作目录，但不会改变 DSH 原会话的文件权限或项目归属；命令和文件操作继续遵循宿主权限与审批。'),
        h('div',{'data-session-binding':true,style:{padding:'8px 0 14px',borderBottom:'1px solid #80808035'}},h('h4',{style:{margin:'8px 0'}},'固定聊天会话'),
          m.bindingError&&h('p',{role:'alert'},'会话分组暂未核对：'+m.bindingError+'。下面仅保留上次记录和选择，请刷新后再固定会话。'),
          binding?h('div',null,
            h('p',null,(m.bindingError?'上次固定会话：':'当前固定会话：'),bindingCurrent.sessionId||'尚未建立'),
            h('p',null,(m.bindingError?'上次所属分组：':'所属分组：'),bindingCurrent.workspaceId?(bindingGroups.find(row=>row.id===bindingCurrent.workspaceId)?.title||bindingCurrent.workspaceId):bindingCurrent.sessionId?'未分组':'尚未绑定'),
            bindingCurrent.cwd&&h('p',{style:css.hint},'会话目录：'+bindingCurrent.cwd),
            binding.available===false&&h('p',{role:'status'},binding.reason||'当前宿主暂不能核对会话分组，请检查服务后刷新。'),
            h('label',{style:{display:'block',margin:'10px 0'}},h('div',null,'会话所属分组'),h('select',{'aria-label':'会话所属分组',style:css.input,value:m.bindingWorkspaceId,disabled:operationBusy||binding.available!==true,onChange:e=>changeBindingWorkspace(e.target.value)},h('option',{value:''},'请选择分组'),...bindingGroups.map(row=>h('option',{key:row.id,value:row.id},(row.title||row.path)+' · '+row.path)))),
            h('label',{style:{display:'block',margin:'10px 0'}},h('div',null,'分组内已有会话'),h('select',{'aria-label':'分组内已有会话',style:css.input,value:m.bindingSessionId,disabled:operationBusy||m.bindingLoading||binding.available!==true||!m.bindingWorkspaceId,onChange:e=>changeBindingSession(e.target.value)},h('option',{value:''},bindingCandidates.length?'请选择要一直使用的会话':'这个分组暂未发现可用会话'),...bindingCandidates.map(row=>h('option',{key:row.id,value:row.id},(row.title||row.id)+' · '+row.id)))),
            binding.available===true&&bindingCurrent.workspaceId===m.bindingWorkspaceId&&bindingCurrent.sessionId===m.bindingSessionId&&m.bindingSessionId&&!m.bindingError&&h('p',{role:'status',style:css.hint},'已固定使用这条会话，聊天和自主探索会继续投递到同一处。'),
            !bindingCandidates.length&&m.bindingWorkspaceId&&!m.bindingLoading&&binding.available&&h('p',{style:css.hint},'这里只列出分组中有有效元数据的已有会话。可先在 DSH 的该分组中建立会话，再刷新列表。'),
            button('固定使用这条会话',bindSession,otherChatDraft||!!m.companionReference.trim()||m.bindingLoading||!!m.bindingError||binding.available!==true||!m.bindingWorkspaceId||!m.bindingSessionId||(bindingCurrent.workspaceId===m.bindingWorkspaceId&&bindingCurrent.sessionId===m.bindingSessionId),true),
            (otherChatDraft||m.companionReference.trim())&&h('p',{style:css.hint},'其他内容还有草稿，请先保存或清空；选择会话不会提交这些内容。')):h('p',{style:css.muted},'尚未取得固定会话列表，请刷新后核对。'),
          h('button',{type:'button',style:css.button,disabled:operationBusy||m.bindingLoading,onClick:()=>refreshSessionBinding()},m.bindingLoading?'正在核对会话…':'刷新分组与会话'),
          h('p',{style:css.hint},'固定使用已有会话不会新建聊天、搬动旧聊天或发送消息；旧的未分组会话会保留。')),
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
      personalReady&&disclosure('tasks','需要帮忙时',h('label',{style:{display:'block'}},h('div',null,'本次任务（可选）'),h('textarea',{'aria-label':'本次任务（可选）',style:css.input,rows:2,value:m.task,disabled:operationBusy,onChange:e=>patch({task:e.target.value}),placeholder:'例如：检查我指定的公开信息来源，有重要变化时给出出处。'})),
        h('p',{style:css.hint},'不填临时任务时，助理会查看正在跟进的目标和相关记忆。'),button('现在唤醒',async()=>{const result=await call('assistant/wake',m.task.trim()?{message:m.task.trim()}:{});patch({task:''});return result;},hasDraft||sessionBlocked||bindingDraft,true),
        button('刷新动态',async()=>{await load();return {note:'动态已刷新，未保存的设置已保留'};}),
        h('p',{style:css.hint},'打开前检查常驻会话；原会话已删除时会建立新的空会话，个人记忆和配置保留。现在唤醒会交给助理一轮任务。'),
        !sessionId&&!bindingRequired&&button('建立聊天会话',async()=>{const session=await ensureSession();return {note:session.note||'常驻会话已建立；现在可以打开聊天，没有投递任务'};},hasDraft||sessionBlocked||bindingDraft),
        !sessionId&&!bindingRequired&&h('p',{style:css.hint},'建立聊天会话后即可进入；这个操作不会唤醒模型或创建计划。'),
        sessionId&&(!openAssistantSession||!close)&&h('p',{style:css.hint},navigationError||'当前界面暂不能直接打开聊天，请从左侧进入助理的会话。'),
        chatDraft&&h('p',{style:css.hint},'有未保存内容，先保存或清空，再打开聊天。'),
        h('p',{style:css.hint},'本地记忆和目标不需要 X 登录。使用 X 时仍会核对账号与权限。')),
      disclosure('tasks','定时计划',h('p',{style:css.hint},'使用宿主任务看板持久保存计划，与探索作息分开。DSH 和电脑需要保持运行；错过的触发不补跑。同一计划运行时不会重复启动。'),
        m.plansError&&h('p',{role:'alert'},'计划暂不可用：'+m.plansError),
        !m.plans&&h('p',{style:css.muted},'尚未取得宿主计划状态，请刷新动态。'),
        m.plans&&!planAvailable&&h('p',{role:'status'},m.plans.reason||'任务看板未启用，请在 DSH 启用任务看板后刷新。'),
        planAvailable&&h('div',null,planRows.length?planRows.slice(0,30).map(row=>h('article',{key:row.id||row.taskId,style:css.row},h('strong',null,row.title),h('p',{style:css.hint},planSummary(row)),row.instruction&&h('p',{style:{whiteSpace:'pre-wrap'}},row.instruction),h('p',{style:css.hint},'状态：'+({active:'已启用',scheduled:'已启用',paused:'已暂停',cancelled:'已取消',canceled:'已取消',archived:'已归档',running:'运行中',missed:'已错过',completed:'已完成',stopped:'已停止'}[row.status]||row.status||'已保存')+(row.nextRunAt?' · 下次 '+stamp(row.nextRunAt):'')),row.lastRun&&h('p',{style:css.hint},'最近执行：'+runText(row.lastRun)),row.lastRun?.error&&h('p',{role:'status',style:css.hint},'失败原因：'+cleanMessage(row.lastRun.error)),(row.runReports??[]).length>0&&h('p',{style:css.hint},'最近汇报：'+(row.runReports.at(-1).deduplicated?'相同发现已去重':row.runReports.at(-1).notified?'新发现已进入动态盒':row.runReports.at(-1).notify?'已有汇报，通知状态待核对':'安静结束')+' · '+stamp(row.runReports.at(-1).at)),(row.history??[]).length>0&&h('details',null,h('summary',null,'最近执行记录'),...row.history.slice(-5).reverse().map((run,index)=>h('p',{key:index,style:css.hint},runText(run),run.error?' · '+cleanMessage(run.error):''))),
          !row.archived&&!['cancelled','canceled','archived','completed'].includes(row.status)&&h('div',null,button(row.status==='paused'?'恢复计划':'暂停计划',()=>managePlan(row,row.status==='paused'?'resume':'pause')),button('修改时间',()=>editPlan(row)),button('取消计划',()=>managePlan(row,'cancel'))))):h('p',{style:css.muted},'还没有 My Fish 定时计划。'),
          h('details',{open:!!plan.editingTaskId,style:{marginTop:14}},h('summary',{style:{cursor:'pointer'}},plan.editingTaskId?'修改执行时间':'添加定时计划'),field('计划名称','planDraft','title','text','',{disabled:operationBusy||!!plan.editingTaskId}),field('执行要求','planDraft','instruction','textarea','写清要查看的信息来源、判断条件，以及有变化时应带回什么。',{disabled:operationBusy||!!plan.editingTaskId}),select('执行频率','planDraft','frequency',[['hourly','每小时整点'],['daily','每天'],['once','执行一次'],...(plan.frequency==='custom'?[['custom','自定义周期']]:[])]),
            plan.frequency==='custom'&&field('周期时间规则','planDraft','cron','text','保留已有五段周期规则，也可改为上面的常用执行频率。'),
            plan.frequency==='daily'&&field('每天执行时间','planDraft','time','time'),plan.frequency==='once'?field('执行日期与时间（本机时间）','planDraft','at','datetime-local','本机时区：'+localTimeZone()):field('计划时区','planDraft','timeZone','text','例如 Asia/Shanghai；会按此时区计算执行时间。'),
            h('p',{style:css.hint},'保存后会按时间自动执行。计划不会开启社交写入或本机执行权限；没有变化可以安静结束。'),plan.editingTaskId&&h('p',{style:css.hint},'这里只修改时间。更改执行要求请取消旧计划再新建，以保留清楚的执行记录。'),button(plan.editingTaskId?'保存执行时间':'保存定时计划',createPlan,!plan.title.trim()||!plan.instruction.trim()||(plan.frequency==='once'&&!plan.at),true),plan.editingTaskId&&button('取消修改时间',async()=>{patch({planDraft:emptyPlan()});return {note:'已取消修改'};})))),
      disclosure('settings','个人工具权限',h('p',{style:css.hint},'这些权限只控制个人助理及已确认归属的计划执行，不改变其他 DSH 会话的权限。更换人设不会打开权限。'),
        m.permissionsError&&h('p',{role:'alert'},'权限暂不可用：'+m.permissionsError),
        m.policy?h('div',null,!m.capabilities?.guardAvailable&&h('p',{role:'alert'},'无法确认个人工具门禁，检查插件加载后再使用受控能力。'),toggle('允许本机命令、代码与终端','policy','shell','默认关闭。代码和终端可能间接联网或对外操作；打开后仍受 DSH 目录范围和审批限制。'),toggle('允许本地文件写入','policy','fileWrite','默认关闭。读取与修改分开控制。'),toggle('允许通用浏览器交互','policy','browserInteract','默认关闭。点击、填表可能产生外部操作；X 公开动作仍需单独授权。'),toggle('允许委派子任务','policy','delegation','默认关闭。宿主对子任务的实际权限继承仍需单独核验。'),field('禁止外发的私密词组，每行一项','policy','privateTerms','list','不要输入 Cookie、密码或密钥。命中规则时拒绝外发，错误信息不回显词组。'),button('保存个人权限',save('policy','permissions'),!dirty('policy'))):h('p',{style:css.muted},'尚未取得权限状态，请刷新后再配置。')),
      disclosure('settings','语音输入',h('p',null,'打开固定主会话后，可使用 DSH 官方输入框的听写按钮。识别结果先进入草稿，由你检查后发送。'),h('p',{style:css.hint},'本版保留官方录音入口，不覆盖它的控件。回复朗读、连续语音和打断播报尚未接入。'),
        button('检查听写服务',async()=>{if(typeof checkSpeech!=='function')throw Error('当前 DSH 未提供语音服务检查入口，请查看官方语音插件设置。');const result=await checkSpeech();patch({speech:result});return {note:'听写服务状态已读取，没有启用麦克风或下载模型'};}),
        m.speech&&h('p',{role:'status'},m.speech.message)),
      personalReady&&section('records','留给你的话',notices.length?h('div',null,...notices.slice(0,20).map(row=>h('article',{key:row.id,style:{...css.row,borderLeft:row.readAt?'none':'3px solid #6b91ad',paddingLeft:row.readAt?0:12}},h('strong',null,row.title),h('span',{style:{...css.hint,marginLeft:10}},row.readAt?'已读':'未读'),h('p',{style:css.hint},stamp(row.createdAt)),h('p',{style:{whiteSpace:'pre-wrap'}},row.body),...(row.links??[]).map((link,index)=>{const href=safeLink(link.url);return href?h('p',{key:index},h('a',{href,target:'_blank',rel:'noopener noreferrer',style:{color:'var(--dsw-alias-link-primary,#7eaed1)'}},link.title||link.url)):null;}),!row.readAt&&button('标为已读',()=>call('assistant/inbox-read',{id:row.id}))))):h('p',{style:css.muted},'还没有新消息。有了新发现或想接着聊的话，会留在这里。'),h('p',{style:css.hint},'这些话留在本地，不会自动发到 X 或公开 @ 你。')),
      personalReady&&disclosure('tasks','正在跟进',goals.filter(row=>row.status!=='done').length?goals.filter(row=>row.status!=='done').map(renderGoal):h('p',{style:css.muted},'还没有目标。可以写“持续留意什么”，也可以交给助理一件做完就结束的事。'),
        h('details',{open:!!m.goalDraft.id,style:{marginTop:14}},h('summary',{style:{cursor:'pointer'}},m.goalDraft.id?'修改目标':'交给助理一个目标'),field('目标','goalDraft','title'),field('补充要求','goalDraft','detail','textarea'),select('跟进方式','goalDraft','mode',[['watch','持续留意'],['task','完成一次']]),
          button(m.goalDraft.id?'保存目标':'添加目标',async()=>{const result=await call('assistant/goal',payload(m.goalDraft,['id','title','detail','mode','status','nextCheckAt','progress']));clearGoal();return result;},!m.goalDraft.title.trim()),m.goalDraft.id&&button('取消编辑',async()=>{clearGoal();return {note:'已取消编辑'};})),goals.some(row=>row.status==='done')&&h('details',null,h('summary',null,'已完成的目标'),...goals.filter(row=>row.status==='done').map(renderGoal))),
      personalReady&&section('memory','长期记忆（'+memories.length+'）',h('p',{style:css.hint},'这里是可检索、可纠正、可忘记的长期记录。日记不会自动变成事实；请勿填写 Cookie、密码或密钥。'),h('label',null,'查找记忆',h('input',{'aria-label':'查找记忆',style:css.input,value:m.memoryQuery,onChange:e=>patch({memoryQuery:e.target.value})})),
        filtered.length?filtered.map(row=>h('article',{key:row.id,style:css.row},h('span',{style:css.hint},memoryLabel[row.category]||row.category),h('p',{style:{whiteSpace:'pre-wrap',margin:'4px 0'}},row.text),h('p',{style:css.hint},'来源：'+row.source+' · 更新于 '+stamp(row.updatedAt)),row.expiresAt&&h('p',{style:css.hint},'有效至 '+stamp(row.expiresAt)),button('纠正这条记忆',async()=>{patch({memoryDraft:{...row,expiryMode:'keep',expiryAt:''}});return {note:'已载入这条记忆，原有效期保持不变'};}),button('忘记这条',()=>call('assistant/forget',{id:row.id})))):h('p',{style:css.muted},m.memoryQuery?'没有找到相关记忆。':'还没有长期记忆。你可以在这里告诉助理，也可以在聊天中让助理记住。'),
        h('h4',null,m.memoryDraft.id?'纠正记忆':'告诉助理一件事'),field('记忆内容','memoryDraft','text','textarea'),select('记忆类型','memoryDraft','category',Object.entries(memoryLabel)),field('这条记忆的来源','memoryDraft','source'),
        select('记忆有效期','memoryDraft','expiryMode',[...(m.memoryDraft.id?[['keep','保持原有效期']]:[]),['never','长期'],['today','今天'],['week','本周'],['custom','自定']]),
        m.memoryDraft.expiryMode==='custom'&&field('记忆到期时间','memoryDraft','expiryAt','datetime-local','按本机时区 '+localTimeZone()+' 保存。'),
        h('p',{style:css.hint},expiryHint),h('p',{style:css.hint},'“今天”截至本机明天 00:00；“本周”截至下周一 00:00。有效期按保存时计算。到期不会删除旧聊天或日记。'),
        button('保存记忆',saveMemory,!m.memoryDraft.text.trim()||!m.memoryDraft.source.trim()),m.memoryDraft.id&&button('取消纠正',async()=>{clearMemory();return {note:'已取消纠正'};})),
      personalReady&&section('persona','助理角色',h('p',{style:css.hint},'角色与平台能力分开保存。修改人设不会改变账号或操作权限。'),field('角色名','profile','name'),h('div',{style:css.grid},field('称呼你','profile','ownerTitle'),field('自称','profile','selfClaim')),field('人设正文','profile','persona','textarea','每轮使用前 3000 字。'),
        h('div',{style:css.grid},select('说话风格','profile','replyStyle',[['default','跟随原人设'],['concise','简短'],['natural','自然'],['formal','正式']]),select('表情符号','profile','emojiStyle',[['default','跟随原人设'],['none','不用'],['moderate','适量']])),h('p',{style:css.hint},'快捷设置补充说话方式，保留上面的人设正文、名称和称呼；不会改变工具权限。'),
        field('兴趣，每行一项','profile','interests','list'),button('保存角色',save('profile','assistant/profile'),!dirty('profile'))),
      disclosure('settings','陪伴能力：桌宠、语音、视频与 RSS',
        h('p',{style:css.hint},'可选功能都在这里配置。默认关闭；读取配置不会安装插件、登录或播放声音。'),button('读取陪伴能力设置',refreshIntegrations),
        m.integrations&&m.integrationDraft&&m.presentationDraft&&h('div',null,capabilityNav(),
          capabilityPanel('expression',h('h4',null,'表达与声音'),toggle('启用回复表达','presentationDraft','enabled','只转发固定主会话实际提交的回复，不生成另一套角色。'),
          select('表达方式','presentationDraft','mode',[['pet','桌宠气泡与动作'],['browser','浏览器本地中文朗读']]),
          m.presentationDraft.mode==='pet'?h('div',null,
            h('p',{style:css.hint},'需要另装dsh-pet。使用其现有宠物；显示与发声是否成功仍需实际核对。'),field('桌宠 ID','presentationDraft','petId'),select('桌宠显示端','presentationDraft','surface',[['desktop','桌面窗口'],['web','DSH页面']]),
            field('已有动画名称（可选）','presentationDraft','animation'),toggle('让桌宠朗读气泡','presentationDraft','speak','使用桌宠自己的语音服务；当前接口不保证停止已经播放的音频。'),
            button('检查桌宠连接',async()=>{const result=await call('presentation/check',{});patch({petCheck:result});return result;}),m.petCheck&&h('p',{role:'status',style:css.hint},m.petCheck.note,(m.petCheck.pets||[]).length?' 可见宠物ID：'+m.petCheck.pets.map(p=>p.id).join('、'):'')
          ):h('div',null,h('p',{style:css.hint},'只选择浏览器明确标记为本地的中文音色，不回退云语音。需要系统已安装中文语音；新用户消息、输入和窗口隐藏会停止待播内容，不启用麦克风或持续听音。'),button('试听本地中文语音',()=>ensureSpeechController().preview()),button('检查本地音色',()=>{const status=ensureSpeechController().status();return {note:status.localVoices.length?status.localVoices.map(v=>v.name).join('、'):'没有可确认的本地中文音色，请在系统语音设置中配置。'};})),
          button('保存表达设置',save('presentationDraft','presentation'),!dirty('presentationDraft')),button('停止当前表达',async()=>{speechController?.interrupt();return call('presentation/stop',{});})),
          capabilityPanel('video',h('h4',null,'视频片段理解'),toggle('允许明确读取指定视频片段','integrationDraft','videoEnabled','需另装dsh-video-storyboard及其ffmpeg/下载/转写依赖；上游可能使用它已配置的Cookie或ASR服务。'),
          h('p',{style:css.hint},m.integrations.video?.note||'当前视频插件可用性尚未核验。',' 开启后在原主会话给出BV或YouTube链接，让它用assistant_video读取默认90秒的片段；每次最多180秒，不代表完整观看。'),button('停止等待视频结果',()=>call('video/stop',{}))),
          capabilityPanel('rss',h('h4',null,'RSS 兴趣来源'),toggle('启用 RSS 兴趣来源','integrationDraft','rssEnabled','保存后纳入已开启的自主探索；不自动开启主动跟进总开关。'),
          field('公开 RSS 来源，每行一个','integrationDraft','rssFeedLines','textarea','填写 https://...，或 名称 | https://...；仅公开订阅，不填写带密钥的私有源。读取仅订阅内嵌正文或摘要，不自动抓文章外链。')),
          capabilityPage!=='expression'&&button('保存视频与 RSS 设置',save('integrationDraft','integrations'),!dirty('integrationDraft')))),
      personalReady&&disclosure('settings','什么时候主动跟进',
        h('div',{'data-followup-snooze':true},h('p',{role:'status',style:{margin:'12px 0 4px'}},snoozed?'自主跟进暂停至 '+stamp(snoozeUntil):snoozeUntil?(assistant.settings?.enabled===false?'临时暂停已到期；自主跟进总开关仍关闭':'临时暂停已到期，后续按已保存作息执行。'):'当前没有临时暂停。'),button('暂停2小时',()=>snooze('two-hours')),button('今天不主动跟进',()=>snooze('today')),button('恢复主动跟进',()=>snooze('resume'),!snoozed),h('p',{style:css.hint},'只暂停后续自主跟进，不中止已开始的任务；手动唤醒和明确设置的定时计划照常可用。到期后按原作息执行，恢复不会打开下方总开关。')),
        toggle('允许助理主动跟进','settings','enabled','DSH 运行时按作息唤醒；每轮先判断是否需要行动，没有新发现可以安静结束。开启此项不会开启发帖。'),h('div',{style:css.grid},... [['间隔分钟（30–1440）','intervalMinutes'],['开始小时（0–23）','startHour'],['结束小时（1–24）','endHour'],['每天最多唤醒次数（1–12）','maxRunsDaily'],['每轮最多帖子候选（1–20）','maxCandidates']].map(([label,key])=>field(label,'settings',key,'number'))),button('保存作息',save('settings','assistant/settings'),!dirty('settings'))),
      section('channels','渠道与账号',h('p',{style:css.hint},'分别显示渠道接入、服务就绪、账号配置和验证范围。已配置账号或服务可调用，不代表所有动作已经实测通过。'),
        m.channelsError&&h('p',{role:'alert'},'渠道目录暂不可用：'+m.channelsError+'。保留上次目录和账号设置，请刷新后核对。'),
        m.channels?(m.channels.platforms.length?m.channels.platforms.map(renderChannel):h('p',{style:css.muted},'当前没有已注册渠道；不能据此执行任何平台操作。')):h('div',null,h('p',{style:css.muted},'尚未取得渠道目录；未确认的渠道不会显示为已接入。'),renderChannel({id:'x',name:'X',directoryUnknown:true,accountRequired:true,configured:remote.hasCredentials,connection:{state:'unknown'}})),
        h('button',{type:'button',style:css.button,disabled:operationBusy||m.channelsLoading,onClick:()=>refreshChannels()},'刷新渠道列表'),m.channelsLoading&&h('p',{role:'status',style:css.hint},'正在读取渠道目录，其他设置可继续使用。'),
        h('p',{style:css.hint},'刷新只读取本地渠道状态，不发起平台登录或真实操作。服务就绪不代表连接核验通过、当前会话可见或实际执行成功。'),
        h('p',{style:css.hint},'通用网页可复用另装的 BrowserSkill，需加载技能并检查连接。平台目录只表示各适配器声明的能力，不代表所有平台或动作均已支持。')),
      disclosure('records','运行记录与日记',h('p',null,'最近唤醒：',remote.lastRun?(labels[remote.lastRun.status]||remote.lastRun.status)+' · '+stamp(remote.lastRun.at):'尚未唤醒'),remote.lastRun?.reason&&h('p',{style:{whiteSpace:'pre-wrap'}},remote.lastRun.reason),h('p',{style:css.hint},'专用会话 ID：'+(remote.sessionId||remote.lastRun?.sessionId||'尚未创建')),h('p',null,'连接体检：',remote.lastDiagnosis?(labels[remote.lastDiagnosis.status]||remote.lastDiagnosis.status)+' · '+stamp(remote.lastDiagnosis.at):'尚未进行'),remote.lastDiagnosis?.message&&h('p',null,remote.lastDiagnosis.message),h('p',null,'最近读取：',remote.lastRead?(operationLabel[remote.lastRead.operation]||remote.lastRead.operation)+' · '+(readLabel[remote.lastRead.status]||remote.lastRead.status)+' · '+stamp(remote.lastRead.at):'尚未读取'),remote.lastRead?.message&&h('p',null,remote.lastRead.message),remote.lastRead?.kind&&h('p',{style:css.hint},'读取错误类型：'+remote.lastRead.kind),remote.lastRead?.status==='passed'&&h('p',{style:css.hint},'本次返回 '+remote.lastRead.count+' 条，仅表示读取结果。'),
        remote.pausedUntil>Date.now()&&h('p',null,'已暂停：'+remote.pauseReason),remote.inflight&&h('div',null,h('p',null,'有未确认的写操作。先到 X 核对实际结果，不要直接重发。'),button('核对：已成功',()=>call('reconcile',{confirmed:true})),button('核对：未成功',()=>call('reconcile',{confirmed:false}))),button('人工检查后恢复调度',()=>call('resume',{})),button('查看两本日记',async()=>{const result=await call('diary');patch({diaries:result.diaries});return {note:'日记已读取'};}),
        m.diaries&&Object.entries(m.diaries).map(([key,text])=>h('details',{key},h('summary',null,key==='master'?'给用户的摘要':'私人日记'),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:360,overflow:'auto'}},text||'暂无日记'))),
        h('details',null,h('summary',null,'最近唤醒记录（最多 20 次）'),...(remote.runHistory??[]).slice().reverse().map(row=>h('div',{key:row.id,style:css.row},stamp(row.at)+' · '+(row.manual?'手动':'自动')+' · '+(labels[row.status]||row.status),h('p',null,row.reason)))),
        h('details',null,h('summary',null,'最近写操作（收藏、回复、@）'),(remote.recent??[]).length?(remote.recent??[]).slice().reverse().map((row,index)=>h('p',{key:index},stamp(row.at)+' · '+({bookmark:'收藏',reply:'回复',mention:'@ 分享'}[row.type]||row.type)+' · '+row.status)):h('p',null,'尚无写操作。')))];
    const pages=[
      ['daily','日常','聊天、一起看内容，以及自己的兴趣探索。'],
      ['persona','角色','名称、称呼、人设和表达风格。'],
      ['memory','记忆','查找、纠正或忘记长期记忆。'],
      ['tasks','任务','临时任务、定时计划和持续跟进的目标。'],
      ['channels','渠道账号','各渠道的账号、配置与连接检查。'],
      ['settings','设置','固定会话、工作区、主动跟进作息和工具权限。'],
      ['records','记录','留给你的话、运行状态和日记。'],
    ];
    const selected=pages.some(([id])=>id===m.activePage)?m.activePage:'daily';
    const pageDirty=id=>({daily:!!m.companionReference.trim(),persona:dirty('profile'),memory:!!m.memoryDraft.text.trim(),tasks:!!(m.task.trim()||m.goalDraft.title.trim()||m.goalDraft.detail.trim()||m.planDraft.title.trim()||m.planDraft.instruction.trim()),channels:dirty('cfg')||!!(m.cookie.auth_token||m.cookie.ct0),settings:dirty('integrationDraft')||dirty('presentationDraft')||dirty('settings')||dirty('policy')||dirty('workspaceDraft')||bindingDraft}[id]||false);
    const selectPage=(id,event)=>{patch({activePage:id});if(event){const target=event.currentTarget?.parentElement?.querySelector('[data-fish-tab="'+id+'"]');target?.focus();}};
    const tabKey=(event,index)=>{let next;if(event.key==='ArrowRight')next=(index+1)%pages.length;else if(event.key==='ArrowLeft')next=(index+pages.length-1)%pages.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=pages.length-1;else return;event.preventDefault();selectPage(pages[next][0],event);};
    const navigation=h('div',{role:'tablist','aria-label':'My Fish 功能分类',style:{display:'flex',flexWrap:'wrap',gap:'0 4px',borderBottom:'1px solid #80808050',margin:'10px 0 4px'}},...pages.map(([id,label],index)=>h('button',{key:id,id:'my-fish-tab-'+id,'data-fish-tab':id,type:'button',role:'tab','aria-selected':selected===id,'aria-controls':'my-fish-panel-'+id,tabIndex:selected===id?0:-1,onClick:()=>selectPage(id),onKeyDown:event=>tabKey(event,index),style:{minHeight:44,padding:'10px 12px',border:0,borderBottom:selected===id?'2px solid #6b91ad':'2px solid transparent',borderRadius:0,background:selected===id?'#6b91ad20':'transparent',color:'inherit',font:'inherit',fontWeight:selected===id?600:400,cursor:'pointer',whiteSpace:'nowrap'}},label,pageDirty(id)&&h('span',{style:{fontSize:10,marginLeft:4,opacity:.8}},'未保存'),id==='records'&&notices.filter(row=>!row.readAt).length>0&&h('span',{style:{fontSize:11,marginLeft:5}},String(notices.filter(row=>!row.readAt).length)))));
    const common=content.filter(node=>!node?.props?.['data-fish-page']);
    return h('div',{className:'my-fish-settings',style:css.root},h('style',null,'.my-fish-settings [role=tab]:hover{background:#6b91ad18!important}.my-fish-settings [role=tab]:focus-visible{outline:2px solid #6b91ad;outline-offset:-3px}.my-fish-settings [role=tabpanel][hidden]{display:none!important}'),common[0],navigation,...common.slice(1),...pages.map(([id,label,description])=>h('div',{key:id,id:'my-fish-panel-'+id,role:'tabpanel','aria-labelledby':'my-fish-tab-'+id,hidden:selected!==id,tabIndex:0,style:{display:selected===id?'block':'none',paddingTop:8}},h('p',{style:{...css.hint,margin:'0 0 8px'}},description),...content.filter(node=>node?.props?.['data-fish-page']===id))));
  }
  function SidebarEntry({wide=true,openAssistantSession,navigationError}={}){
    const [m,set]=R.useState({busy:false,error:''});
    if(typeof R.useEffect==='function')R.useEffect(()=>{const speech=ensureSpeechController(),input=()=>speech.interrupt(),visibility=()=>{if(window.document?.visibilityState==='hidden')speech.interrupt();};speechMounts++;speech.start();window.document?.addEventListener('input',input,true);window.document?.addEventListener('visibilitychange',visibility);return ()=>{window.document?.removeEventListener('input',input,true);window.document?.removeEventListener('visibilitychange',visibility);if(--speechMounts===0)speech.stop();};},[]);
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
    ctx.effect(()=>()=>{speechController?.stop();speechController=null;});
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
  return {apply,inject:['slots'],Section,SidebarEntry,initialModel,createBrowserSpeechController};
}});
