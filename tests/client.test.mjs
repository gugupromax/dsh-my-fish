import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { previewTree, previewHTML, previewData } from '../scripts/render-preview.mjs';

const source=fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
function flatten(node){if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(flatten).join('');if(typeof node!=='object')return String(node);return flatten(node.children);}
function findAll(node,predicate,out=[]){if(Array.isArray(node))for(const child of node)findAll(child,predicate,out);else if(node&&typeof node==='object'){if(predicate(node))out.push(node);findAll(node.children,predicate,out);}return out;}
function namedButton(tree,label){const nodes=findAll(tree,node=>node.type==='button'&&flatten(node.children)===label);assert.equal(nodes.length,1,'unique button: '+label);return nodes[0];}
function namedField(tree,label){const nodes=findAll(tree,node=>['input','select','textarea'].includes(node.type)&&node.props['aria-label']===label);assert.equal(nodes.length,1,'unique field: '+label);return nodes[0];}

function harness(options={}){
  const data=previewData(options.mode||'solo');
  Object.assign(data.remote,options.remote||{});
  Object.assign(data.assistant,options.assistant||{});
  data.plans={ok:true,available:true,plans:[],hostTimeZone:'Asia/Shanghai',...options.plans};
  data.permissions={ok:true,policy:{shell:false,fileWrite:false,browserInteract:false,delegation:false,privateTerms:[]},capabilities:{guardAvailable:true},...options.permissions};
  data.workspace={ok:true,path:'C:\\Synthetic\\my-fish',workingDirectory:'C:\\Synthetic\\my-fish\\workspace',migrating:false,canMigrate:true,lastMigration:null,...options.workspace};
  if(options.channels!==undefined)data.channels=options.channels;
  if(options.companion!==undefined)data.companion=options.companion;
  if(options.config)Object.assign(data.remote.config,options.config);
  const server=structuredClone(data),requests=[];
  const RuntimeDate=options.now===undefined?Date:class extends Date{constructor(...args){super(...(args.length?args:[options.now]));}static now(){return options.now;}};
  let model,plugin,effect,hasEffect=false,cleanup,intervalCallback,intervalDelay,clearedInterval;
  const react={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:initial=>{model??=initial;return [model,next=>{model=typeof next==='function'?next(model):next;}];},
    useEffect:fn=>{if(!hasEffect){hasEffect=true;effect=fn;}}
  };
  async function request(url,opts={}){
    assert.ok(url.startsWith('/my-fish/api/'),'only local plugin routes');
    const route=url.slice('/my-fish/api/'.length),body=opts.body?JSON.parse(opts.body):undefined;
    requests.push({route,method:opts.method||'GET',body});
    if(route==='channels'&&options.onChannelsGet)await options.onChannelsGet();
    if(route==='assistant'&&body===undefined&&options.onAssistantGet)await options.onAssistantGet();
    if(route==='channels/check'&&options.onChannelCheck)await options.onChannelCheck(body);
    if(route==='assistant/snooze'&&options.onSnooze)await options.onSnooze(body);
    if(route==='companion'&&body===undefined&&options.onCompanionGet)await options.onCompanionGet();
    if(route==='companion/chat'&&options.onCompanionChat)await options.onCompanionChat(body);
    if(options.failRoute===route)return {ok:false,json:async()=>({ok:false,error:options.error||'连接失败'})};
    if(body===undefined)return {ok:true,json:async()=>structuredClone(route==='state'?server.remote:route==='plans'?server.plans:route==='permissions'?server.permissions:route==='workspace'?server.workspace:route==='channels'?server.channels:route==='companion'?server.companion:server.assistant)};
    if(route==='assistant/profile')server.assistant.profile={...server.assistant.profile,...body};
    else if(route==='assistant/settings')server.assistant.settings={...server.assistant.settings,...body};
    else if(route==='assistant/snooze'){
      const now=RuntimeDate.now(),midnight=new RuntimeDate(now);midnight.setDate(midnight.getDate()+1);midnight.setHours(0,0,0,0);
      server.assistant.settings={...server.assistant.settings,snoozeUntil:body.preset==='resume'?null:body.preset==='today'?midnight.getTime():now+7200000};
      return {ok:true,json:async()=>({ok:true,settings:structuredClone(server.assistant.settings),note:'临时免打扰已更新，原作息保持'})};
    }
    else if(route==='config')server.remote.config=body;
    else if(route==='companion/chat'){const result=options.companionResult||{ok:true,queued:true,sessionId:server.remote.sessionId||'companion-main',requestId:body.requestId,note:'已交给同一主会话；真实读取尚未完成'};if(typeof result.sessionId==='string')server.remote.sessionId=result.sessionId;return {ok:true,json:async()=>structuredClone(result)};}
    else if(route==='companion/topic')server.companion.threads=server.companion.threads.map(row=>row.id===body.id?{...row,status:body.status}:row);
    else if(route==='companion/forget')server.companion.threads=server.companion.threads.filter(row=>row.id!==body.id);
    else if(route==='credentials')server.remote.hasCredentials=true;
    else if(route==='permissions')server.permissions.policy=body;
    else if(route==='channels/check'){
      const channel=server.channels.platforms.find(row=>row.id===body.platform),result=options.channelCheckResult||{ok:true,platform:body.platform,channel:{...channel,connection:{state:'verified',checkedAt:123,scope:body.platform==='x'?'仅账号身份接口':'仅匿名公共接口'}},checks:{identity:body.platform==='x'?{status:'verified',username:'synthetic_x',scope:'仅账号身份'}:{status:'not-applicable'},permissions:{status:'configuration-only',liveWritesChecked:false,scope:'仅核对配置，未做写入实测'},connection:{state:'verified'}},note:'检查已完成，仅核对配置，未做写入实测'};
      if(result.channel?.id===body.platform)server.channels.platforms=server.channels.platforms.map(row=>row.id===body.platform?result.channel:row);
      return {ok:true,json:async()=>structuredClone(result)};
    }
    else if(route==='session/followup-resume'){if(server.remote.sessionRecovery)server.remote.sessionRecovery={...server.remote.sessionRecovery,followupPaused:false};return {ok:true,json:async()=>({ok:true,note:'已解除会话恢复暂停，后续仍按原作息运行'})};}
    else if(route==='workspace'){
      if(options.onWorkspacePost)await options.onWorkspacePost(body);
      server.workspace={...server.workspace,path:body.path,workingDirectory:body.path+'\\workspace',lastMigration:{at:123,from:server.workspace.path,to:body.path}};
      return {ok:true,json:async()=>({...server.workspace,note:'工作区迁移成功，旧位置保留备份'})};
    }
    else if(route==='session'){if(options.onSessionPost)await options.onSessionPost();const result=options.sessionResult||{ok:true,sessionId:server.remote.sessionId||'initialized-main',created:!server.remote.sessionId};server.remote.sessionId=result.sessionId;return {ok:true,json:async()=>result};}
    else if(route==='plans'){
      if(body.action==='create')server.plans.plans.push({id:'created-plan',taskId:'created-plan',status:'active',...body});
      else {const row=server.plans.plans.find(row=>row.taskId===body.taskId||row.id===body.taskId);if(row){if(body.action==='update')row.schedule=body.schedule;else row.status=body.action==='pause'?'paused':body.action==='resume'?'active':'cancelled';if(body.action==='cancel')row.archived=true;}}
    }
    else if(route==='assistant/memory'){
      const row={...body,id:body.id||'new-memory',createdAt:1,updatedAt:2};
      const index=server.assistant.memories.findIndex(value=>value.id===row.id);
      if(index<0)server.assistant.memories.push(row);else server.assistant.memories[index]=row;
    }else if(route==='assistant/forget')server.assistant.memories=server.assistant.memories.filter(value=>value.id!==body.id);
    else if(route==='assistant/goal'){
      const index=server.assistant.goals.findIndex(value=>value.id===body.id);
      if(index<0)server.assistant.goals.push({id:'new-goal',status:'active',...body});else server.assistant.goals[index]={...server.assistant.goals[index],...body};
    }else if(route==='assistant/goal-delete')server.assistant.goals=server.assistant.goals.filter(value=>value.id!==body.id);
    else if(route==='assistant/inbox-read')server.assistant.inbox=server.assistant.inbox.map(value=>value.id===body.id?{...value,readAt:5}:value);
    return {ok:true,json:async()=>({ok:true,note:route==='assistant/wake'?'任务已交给 DSH，尚未执行完成':'已保存'})};
  }
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(()=>react);}}},Date:RuntimeDate,JSON,URL,fetch:request,setInterval:(fn,delay)=>{intervalCallback=fn;intervalDelay=delay;return 123;},clearInterval:id=>{clearedInterval=id;}});
  const render=()=>plugin.Section(options.props||{});
  render();
  if(options.loaded!==false)model={...model,remote:data.remote,assistant:data.assistant,companion:data.companion,cfg:data.remote.config,profile:data.assistant.profile,settings:data.assistant.settings,plans:data.plans,channels:data.channels,policy:data.permissions.policy,capabilities:data.permissions.capabilities,workspace:data.workspace,workspaceDraft:{path:data.workspace.path},saved:{cfg:JSON.stringify(data.remote.config),profile:JSON.stringify(data.assistant.profile),settings:JSON.stringify(data.assistant.settings),policy:JSON.stringify(data.permissions.policy),workspaceDraft:JSON.stringify({path:data.workspace.path})}};
  return {
    render,requests,server,getModel:()=>model,
    setModel:changes=>{model={...model,...changes};},
    async mount(){cleanup=effect();await new Promise(resolve=>setImmediate(resolve));return render();},
    async poll(){await intervalCallback();return render();},
    unmount(){cleanup?.();},getInterval:()=>({delay:intervalDelay,cleared:clearedInterval}),
    change(label,value,checked){namedField(render(),label).props.onChange({target:{value,checked}});return render();},
    async click(label){const button=namedButton(render(),label);assert.equal(button.props.disabled,false,'button enabled: '+label);await button.props.onClick();return render();},
    async checkChannel(id){const button=namedButton(channelCard(render(),id),'检查连接与权限');assert.equal(button.props.disabled,false,'channel check enabled: '+id);await button.props.onClick();return render();}
  };
}

test('personal assistant opens with honest empty states and keeps platform setup separate',()=>{
  const solo=flatten(previewTree('solo')),paired=flatten(previewTree('mention'));
  for(const label of ['现在唤醒','留给你的话','正在跟进','还没有新消息','还没有目标','长期记忆','角色名','人设正文','渠道与账号','检查连接与权限','允许公开回复','保存 X 设置'])assert.ok(solo.includes(label),label);
  assert.ok(!solo.includes('接收通知的用户名'));assert.ok(paired.includes('接收通知的用户名'));
  assert.ok(!solo.includes('搜索词，每行一项'));
  const html=previewHTML();
  assert.match(html,/type="password"/);assert.match(html,/设置 → My Fish/);assert.ok(!html.includes('<script'));
});

test('public previews use only a neutral role template with no preselected interests or queries',()=>{
  for(const mode of ['solo','mention']){
    const data=previewData(mode),profile=data.assistant.profile;
    assert.equal(profile.name,'My Fish');assert.equal(profile.ownerTitle,'你');assert.equal(profile.selfClaim,'我');
    assert.match(profile.persona,/通用本地助理/);assert.deepEqual(profile.interests,[]);assert.deepEqual(data.remote.config.queries,[]);
    assert.equal(data.remote.config.owner,mode==='mention'?'example_user':'');
    assert.deepEqual(data.assistant.memories,[]);assert.deepEqual(data.assistant.goals,[]);assert.deepEqual(data.assistant.inbox,[]);
  }
  const text=flatten(previewTree());for(const label of ['助理角色','长期记忆','本次任务（可选）','允许助理主动跟进'])assert.ok(text.includes(label),label);
});

test('mount loads the personal layer and X status independently without external traffic',async()=>{
  const ui=harness({loaded:false});
  assert.match(flatten(ui.render()),/正在读取个人助理/);
  await ui.mount();
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['state','GET'],['assistant','GET'],['plans','GET'],['permissions','GET'],['workspace','GET'],['channels','GET'],['companion','GET']]);
  assert.match(flatten(ui.render()),/My Fish/);
});

test('manual wake works without X identity and sends the one-time task instead of plan keywords',async()=>{
  const ui=harness();
  assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,false);
  ui.change('本次任务（可选）','检查指定的公开信息来源');
  const tree=await ui.click('现在唤醒');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/wake').body,{message:'检查指定的公开信息来源'});
  assert.equal(namedField(tree,'本次任务（可选）').props.value,'');
  assert.match(flatten(tree),/尚未执行完成/);
  assert.ok(!ui.requests.some(row=>['run','diagnose'].includes(row.route)));
});

const companionTopicId='11111111-1111-4111-8111-111111111111';
function companionFixture(){return {ok:true,receipts:[],threads:[{id:companionTopicId,title:'为什么同一段话会有两种理解',currentThought:'我倾向于先看原话，再比较评论里的解释。',openQuestion:'分歧出在语境还是措辞？',nextQuestion:'再找一段有上下文的原文。',status:'active',origin:'fish',createdAt:1,updatedAt:2,revision:1,userPositions:[{messageId:'synthetic-user-message',quote:'我觉得要看上下文',at:1}],latestSources:[{id:'synthetic-receipt',title:'合成公开视频资料',url:'https://www.bilibili.com/video/BV1GJ411x7h7/',platform:'bilibili',operation:'read',scope:'仅公开视频简介，不含音视频',readAt:2,truncated:true}],revisions:[{before:'我最初只注意到措辞。',after:'现在觉得上下文也很关键。',reason:'新读到的简介补充了背景。',sourceIds:['synthetic-receipt'],at:2}],episodes:[]}]};}
function companionCard(tree,id=companionTopicId){const rows=findAll(tree,node=>node.props['data-companion-topic']===id);assert.equal(rows.length,1);return rows[0];}

test('companion content precedes folded work settings without invented interests or platform activity',()=>{
  const tree=previewTree(),text=flatten(tree);
  assert.ok(text.indexOf('最近在琢磨')<text.indexOf('工作区'));assert.match(text,/还没有正在琢磨的话题/);assert.match(text,/还不能观看视频或读取音频/);
  for(const title of ['工作区','需要帮忙时','定时计划','正在跟进','渠道与账号']){
    const rows=findAll(tree,node=>node.type==='details'&&node.children?.[0]?.type==='summary'&&flatten(node.children[0])===title);assert.equal(rows.length,1,title);assert.notEqual(rows[0].props.open,true);
  }
  assert.equal(findAll(tree,node=>node.type==='button'&&flatten(node)==='和助理聊天').length,1);
  assert.equal(findAll(tree,node=>node.props['data-companion-topic']).length,0);assert.match(text,/留给你的话/);assert.ok(!text.includes('QQ已连接'));
});

test('companion topics render genuine thoughts, exact user quotes and bounded source scope safely',()=>{
  const data=companionFixture();data.threads[0].latestSources.push({title:'不安全链接',url:'javascript:alert(1)',scope:'未使用'});
  const ui=harness({companion:data}),card=companionCard(ui.render()),text=flatten(card);
  for(const value of ['先看原话','我觉得要看上下文','之前：','现在：','仅公开视频简介','内容有截断'])assert.ok(text.includes(value),value);
  assert.equal(findAll(card,node=>node.type==='a').length,1);assert.equal(ui.requests.length,0);
  const details=findAll(card,node=>node.type==='details');assert.ok(details.length);assert.notEqual(details[0].props.open,true);
});

test('topic pause, resume and forgetting change only the selected interest without prompting or enabling autonomy',async()=>{
  const ui=harness({companion:companionFixture()}),settings=structuredClone(ui.server.assistant.settings);
  await ui.click('先放一放');assert.equal(ui.server.companion.threads[0].status,'paused');
  await ui.click('继续琢磨');assert.equal(ui.server.companion.threads[0].status,'active');
  await ui.click('忘掉这条兴趣');assert.deepEqual(ui.server.companion.threads,[]);assert.deepEqual(ui.server.assistant.settings,settings);
  assert.deepEqual(ui.requests.filter(row=>row.method==='POST').map(row=>({route:row.route,body:row.body})),[{route:'companion/topic',body:{id:companionTopicId,status:'paused'}},{route:'companion/topic',body:{id:companionTopicId,status:'active'}},{route:'companion/forget',body:{id:companionTopicId}}]);
});

test('continuing a topic queues it explicitly and awaits navigation to the returned main session',async()=>{
  const calls=[];let finish;const navigation=new Promise(resolve=>{finish=resolve;}),ui=harness({companion:companionFixture(),props:{openAssistantSession:async id=>{calls.push(id);await navigation;},close:()=>calls.push('close')}});
  const pending=namedButton(companionCard(ui.render()),'接着聊').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['companion-main']);assert.equal(namedField(ui.render(),'角色名').props.disabled,true);assert.equal(ui.getModel().busy,true);
  const request=ui.requests.find(row=>row.route==='companion/chat');assert.equal(request.body.id,companionTopicId);assert.equal(typeof request.body.requestId,'string');assert.equal(request.body.reference,undefined);
  finish();await pending;assert.deepEqual(calls,['companion-main','close']);assert.match(flatten(ui.render()),/真实读取尚未完成/);
  assert.ok(!ui.requests.some(row=>['session','assistant/wake','config'].includes(row.route)&&row.method==='POST'));
});

test('continuing a topic without navigation keeps a useful local result and requires no close callback',async()=>{
  const ui=harness({companion:companionFixture()});await ui.click('接着聊');
  assert.match(flatten(ui.render()),/请从侧栏打开 My Fish 聊天/);assert.equal(ui.getModel().remote.sessionId,'companion-main');
});

test('companion actions protect every existing draft and preserve an unfinished Bilibili link',()=>{
  for(const [label,value] of [['人设正文','未保存人设'],['记忆内容','未保存记忆'],['目标','未保存目标'],['计划名称','未保存计划'],['本次任务（可选）','未发送文字']]){
    const ui=harness({companion:companionFixture()});ui.change(label,value);assert.equal(namedButton(companionCard(ui.render()),'接着聊').props.disabled,true,label);assert.equal(namedButton(ui.render(),'随便逛逛，回来聊').props.disabled,true,label);
    ui.change('想一起聊的B站链接','BV1GJ411x7h7');assert.equal(namedButton(ui.render(),'聊这个').props.disabled,true,label);assert.equal(ui.requests.length,0);
  }
  const ui=harness({companion:companionFixture(),remote:{sessionId:'main'},props:{openAssistantSession:()=>{},close:()=>{}}});ui.change('想一起聊的B站链接','BV1GJ411x7h7');assert.equal(namedButton(ui.render(),'和助理聊天').props.disabled,true);assert.equal(namedButton(companionCard(ui.render()),'接着聊').props.disabled,true);assert.equal(namedButton(ui.render(),'聊这个').props.disabled,false);
});

test('Bilibili companion input normalizes only strict video references and never forwards tracking',async()=>{
  for(const input of ['BV1GJ411x7h7',' https://www.bilibili.com/video/BV1GJ411x7h7/?share_source=synthetic#reply ']){
    const ui=harness();ui.change('想一起聊的B站链接',input);await ui.click('聊这个');const request=ui.requests.find(row=>row.route==='companion/chat');assert.equal(request.body.reference,'BV1GJ411x7h7');assert.equal(request.body.id,undefined);assert.equal(ui.getModel().companionReference,'');assert.match(flatten(ui.render()),/真实读取尚未完成/);
  }
  for(const input of ['https://b23.tv/short','https://example.com/video/BV1GJ411x7h7/','http://www.bilibili.com/video/BV1GJ411x7h7/','https://user:password@www.bilibili.com/video/BV1GJ411x7h7/','https://www.bilibili.com:444/video/BV1GJ411x7h7/','BV2GJ411x7h7','https://www.bilibili.com/video/BV1GJ411x7h7/extra']){
    const ui=harness();ui.change('想一起聊的B站链接',input);await ui.click('聊这个');assert.equal(ui.requests.some(row=>row.route==='companion/chat'),false,input);assert.equal(ui.getModel().companionReference,input);assert.match(flatten(ui.render()),/只接受|请填写/);
  }
});

test('unknown companion outcomes retry with the same request key and leave the reference draft intact',async()=>{
  const options={failRoute:'companion/chat',error:'synthetic timeout'},ui=harness(options);ui.change('想一起聊的B站链接','BV1GJ411x7h7');
  await ui.click('聊这个');await ui.click('聊这个');const requests=ui.requests.filter(row=>row.route==='companion/chat');assert.equal(requests.length,2);assert.equal(requests[0].body.requestId,requests[1].body.requestId);assert.match(flatten(ui.render()),/同一请求核对/);assert.equal(ui.getModel().companionReference,'BV1GJ411x7h7');
  options.failRoute='';await ui.click('聊这个');const success=ui.requests.filter(row=>row.route==='companion/chat').at(-1);assert.equal(success.body.requestId,requests[0].body.requestId);assert.equal(ui.getModel().companionReference,'');
});

test('a navigation failure reopens the accepted companion session without submitting it a second time',async()=>{
  let calls=0;const ui=harness({companion:companionFixture(),props:{openAssistantSession:()=>{calls++;if(calls===1)throw Error('synthetic navigation unavailable');}}});
  await ui.click('接着聊');assert.match(flatten(ui.render()),/再次点击只重试打开/);await ui.click('接着聊');assert.equal(calls,2);assert.equal(ui.requests.filter(row=>row.route==='companion/chat').length,1);
});

test('recovering the main session starts a new explicit companion request instead of reopening a cached retired main',async()=>{
  for(const outcome of ['navigation-failure','unknown','uncertain']){
    let failNavigation=outcome==='navigation-failure';const opened=[],options={remote:{sessionId:'retired-main'},companion:companionFixture(),...(outcome==='unknown'?{failRoute:'companion/chat',error:'synthetic dispatch interruption'}:outcome==='uncertain'?{companionResult:{ok:true,uncertain:true,sessionId:'retired-main'}}:{}),props:{openAssistantSession:id=>{opened.push(id);if(failNavigation){failNavigation=false;throw Error('synthetic navigation unavailable');}}}},ui=harness(options);
    await ui.click('接着聊');const first=ui.requests.find(row=>row.route==='companion/chat');assert.ok(first);
    ui.server.remote.sessionId='recovered-main';options.failRoute='';options.companionResult=undefined;await ui.click('刷新动态');assert.equal(ui.getModel().remote.sessionId,'recovered-main');
    await ui.click('接着聊');const posts=ui.requests.filter(row=>row.route==='companion/chat');assert.equal(posts.length,2,outcome);assert.notEqual(posts[0].body.requestId,posts[1].body.requestId,outcome);assert.equal(opened.at(-1),'recovered-main',outcome);
  }
});

test('a newly created companion main keeps its accepted request through navigation retry and clears every alias after success',async()=>{
  let navigationCalls=0;const ui=harness({companion:companionFixture(),props:{openAssistantSession:()=>{navigationCalls++;if(navigationCalls===1)throw Error('synthetic navigation unavailable');}}});
  assert.equal(ui.getModel().remote.sessionId,undefined);await ui.click('接着聊');assert.equal(ui.getModel().remote.sessionId,'companion-main');
  const first=ui.requests.find(row=>row.route==='companion/chat');await ui.click('接着聊');assert.equal(ui.requests.filter(row=>row.route==='companion/chat').length,1);
  await ui.click('接着聊');const posts=ui.requests.filter(row=>row.route==='companion/chat');assert.equal(posts.length,2);assert.notEqual(posts[1].body.requestId,first.body.requestId);
});

test('uncertain server dispatches stay uncertain and retain the same key and link for later reconciliation',async()=>{
  const opened=[],options={companionResult:{ok:true,uncertain:true,sessionId:'uncertain-main'},props:{openAssistantSession:id=>opened.push(id),close:()=>opened.push('close')}},ui=harness(options);
  ui.change('想一起聊的B站链接','BV1GJ411x7h7');await ui.click('聊这个');await ui.click('聊这个');
  const posts=ui.requests.filter(row=>row.route==='companion/chat');assert.equal(posts.length,2);assert.equal(posts[0].body.requestId,posts[1].body.requestId);assert.deepEqual(opened,['uncertain-main','uncertain-main']);assert.equal(ui.getModel().companionReference,'BV1GJ411x7h7');assert.match(flatten(ui.render()),/投递结果尚未确认/);assert.ok(!flatten(ui.render()).includes('真实读取尚未完成'));
  options.companionResult={ok:true,sessionId:'uncertain-main'};await ui.click('聊这个');assert.equal(ui.requests.filter(row=>row.route==='companion/chat').at(-1).body.requestId,posts[0].body.requestId);assert.equal(opened.length,2);assert.match(flatten(ui.render()),/续聊结果未能确认/);
});

test('concurrent companion clicks share one queued request and freeze other forms',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;}),ui=harness({onCompanionChat:()=>gate});const button=namedButton(ui.render(),'随便逛逛，回来聊');
  const first=button.props.onClick(),second=button.props.onClick();assert.equal(ui.requests.filter(row=>row.route==='companion/chat').length,1);assert.equal(namedField(ui.render(),'角色名').props.disabled,true);assert.equal(namedButton(ui.render(),'聊这个').props.disabled,true);finish();await Promise.all([first,second]);assert.equal(ui.getModel().busy,false);
});

test('a slow companion read leaves personal settings usable and ignores its response after unmount',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;}),ui=harness({loaded:false,onCompanionGet:()=>gate});await ui.mount();assert.match(flatten(ui.render()),/角色名/);assert.equal(namedField(ui.render(),'角色名').props.disabled,false);assert.equal(ui.getModel().companion,null);ui.unmount();finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.getModel().companion,null);
});

test('companion refresh errors retain prior topics and every draft without claiming current state',async()=>{
  const options={companion:companionFixture(),failRoute:'companion',error:'synthetic companion read failed'},ui=harness(options);ui.change('人设正文','保留草稿');ui.change('想一起聊的B站链接','BV1GJ411x7h7');
  await ui.click('刷新最近话题');assert.match(flatten(ui.render()),/下面保留上次记录/);assert.match(flatten(ui.render()),/为什么同一段话/);assert.equal(namedButton(companionCard(ui.render()),'先放一放').props.disabled,true);assert.equal(namedField(ui.render(),'人设正文').props.value,'保留草稿');assert.equal(ui.getModel().companionReference,'BV1GJ411x7h7');
  options.failRoute='';await ui.click('刷新最近话题');assert.equal(ui.getModel().companionError,'');assert.equal(namedField(ui.render(),'人设正文').props.value,'保留草稿');assert.equal(ui.getModel().companionReference,'BV1GJ411x7h7');
});

test('refresh preserves unsaved role, schedule and X drafts and blocks inconsistent wake',async()=>{
  const ui=harness();
  ui.change('角色名','新名字');
  ui.change('间隔分钟（30–1440）','90');
  ui.change('AI 账号用户名','another_user');
  assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,true);
  assert.equal(namedButton(channelCard(ui.render(),'x'),'检查连接与权限').props.disabled,true);
  ui.server.assistant.profile.name='远端名字';
  ui.server.remote.config.aiUsername='server_user';
  await ui.click('刷新动态');
  assert.equal(namedField(ui.render(),'角色名').props.value,'新名字');
  assert.equal(namedField(ui.render(),'间隔分钟（30–1440）').props.value,90);
  assert.equal(namedField(ui.render(),'AI 账号用户名').props.value,'another_user');
  assert.match(flatten(ui.render()),/刷新会保留草稿/);
});

test('role and schedule saves do not mutate account settings or write switches',async()=>{
  const ui=harness();
  ui.change('角色名','示例助理');
  ui.change('兴趣，每行一项','示例主题 A\n\n示例主题 B\n');
  await ui.click('保存角色');
  const profile=ui.requests.find(row=>row.route==='assistant/profile');
  assert.equal(profile.body.name,'示例助理');assert.equal(profile.body.ownerTitle,'你');
  assert.deepEqual(profile.body.interests,['示例主题 A','示例主题 B']);
  assert.ok(!('auth_token' in profile.body));assert.ok(!('aiUsername' in profile.body));
  ui.change('允许助理主动跟进',undefined,true);
  await ui.click('保存作息');
  assert.equal(ui.requests.find(row=>row.route==='assistant/settings').body.enabled,true);
  assert.ok(!ui.requests.some(row=>row.route==='config'));
  assert.equal(ui.getModel().cfg.allowReplies,false);
});

test('memory correction keeps the memory ID and forgetting removes it from the next view',async()=>{
  const ui=harness({assistant:{memories:[{id:'memory-1',text:'偏好示例方案 B',category:'preference',source:'用户之前说明',createdAt:1,updatedAt:2,expiresAt:null}]}});
  await ui.click('纠正这条记忆');
  ui.change('记忆内容','优先使用示例方案 A');
  await ui.click('保存记忆');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/memory').body,{id:'memory-1',text:'优先使用示例方案 A',category:'preference',source:'用户之前说明',expiresAt:null});
  assert.match(flatten(ui.render()),/优先使用示例方案 A/);assert.ok(!flatten(ui.render()).includes('偏好示例方案 B'));
  await ui.click('忘记这条');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/forget').body,{id:'memory-1'});
  assert.match(flatten(ui.render()),/还没有长期记忆/);
});

test('style shortcuts save separately while preserving the full original persona and identity',async()=>{
  const persona='用户自行编辑的合成人设。\n保留原有换行与标点！',profile={...previewData().assistant.profile,persona,interests:[' 合成兴趣（保留空格） ']};
  const ui=harness({assistant:{profile}});
  ui.change('说话风格','concise');ui.change('表情符号','none');
  await ui.click('保存角色');
  const body=ui.requests.find(row=>row.route==='assistant/profile').body;
  assert.equal(body.replyStyle,'concise');assert.equal(body.emojiStyle,'none');assert.equal(body.persona,persona);
  for(const key of ['id','name','ownerTitle','selfClaim','interests'])assert.deepEqual(body[key],profile[key]);
  assert.equal(ui.requests.filter(row=>row.method==='POST').length,1);
});

test('legacy role profiles default to following the existing persona without silently saving',async()=>{
  const profile={...previewData().assistant.profile};delete profile.replyStyle;delete profile.emojiStyle;
  const ui=harness({assistant:{profile}});
  assert.equal(namedField(ui.render(),'说话风格').props.value,'default');assert.equal(namedField(ui.render(),'表情符号').props.value,'default');
  assert.equal(ui.requests.length,0);assert.equal(namedButton(ui.render(),'保存角色').props.disabled,true);
  ui.change('说话风格','formal');await ui.click('保存角色');
  const body=ui.requests.find(row=>row.route==='assistant/profile').body;
  assert.equal(body.replyStyle,'formal');assert.equal(body.emojiStyle,'default');assert.equal(body.persona,profile.persona);
});

test('failed style saves retain both choices and the original unsaved persona',async()=>{
  const ui=harness({failRoute:'assistant/profile'});
  ui.change('人设正文','合成的未保存人设');ui.change('说话风格','natural');ui.change('表情符号','moderate');
  await ui.click('保存角色');
  assert.equal(namedField(ui.render(),'说话风格').props.value,'natural');assert.equal(namedField(ui.render(),'表情符号').props.value,'moderate');
  assert.equal(namedField(ui.render(),'人设正文').props.value,'合成的未保存人设');
  assert.notEqual(ui.server.assistant.profile.persona,'合成的未保存人设');
});

test('temporary snooze updates only its saved state and preserves every unrelated draft',async()=>{
  const now=new Date(2030,2,12,11,30).getTime(),ui=harness({now});
  ui.change('间隔分钟（30–1440）','90');ui.change('允许助理主动跟进',undefined,true);
  ui.change('人设正文','合成角色草稿');ui.change('说话风格','formal');ui.change('记忆内容','合成临时记忆');
  const initialSettings={...ui.server.assistant.settings};
  const tree=await ui.click('暂停2小时');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/snooze').body,{preset:'two-hours'});
  assert.equal(ui.server.assistant.settings.snoozeUntil,now+7200000);assert.equal(ui.server.assistant.settings.enabled,initialSettings.enabled);
  assert.equal(ui.server.assistant.settings.intervalMinutes,initialSettings.intervalMinutes);
  assert.equal(namedField(tree,'间隔分钟（30–1440）').props.value,90);assert.equal(namedField(tree,'允许助理主动跟进').props.checked,true);
  assert.equal(namedField(tree,'人设正文').props.value,'合成角色草稿');assert.equal(namedField(tree,'说话风格').props.value,'formal');assert.equal(namedField(tree,'记忆内容').props.value,'合成临时记忆');
  assert.equal(ui.requests.filter(row=>row.method==='POST').length,1);assert.match(flatten(tree),/自主跟进暂停至/);
  assert.match(flatten(tree),/手动唤醒和明确设置的定时计划照常可用/);
  await ui.click('保存作息');
  const saved=ui.requests.find(row=>row.route==='assistant/settings').body;
  assert.deepEqual(Object.keys(saved).sort(),['enabled','intervalMinutes','startHour','endHour','maxRunsDaily','maxCandidates'].sort());
  assert.equal(saved.intervalMinutes,90);assert.equal(ui.server.assistant.settings.snoozeUntil,now+7200000);
});

test('today snooze ends at local midnight and resuming does not enable autonomous followup',async()=>{
  const now=new Date(2030,2,12,23,58).getTime(),ui=harness({now});
  await ui.click('今天不主动跟进');
  assert.equal(ui.server.assistant.settings.snoozeUntil,new Date(2030,2,13).getTime());
  assert.equal(namedButton(ui.render(),'恢复主动跟进').props.disabled,false);
  await ui.click('恢复主动跟进');
  assert.equal(ui.server.assistant.settings.snoozeUntil,null);assert.equal(ui.server.assistant.settings.enabled,false);
  assert.equal(namedButton(ui.render(),'恢复主动跟进').props.disabled,true);
  assert.deepEqual(ui.requests.filter(row=>row.route==='assistant/snooze').map(row=>row.body),[{preset:'today'},{preset:'resume'}]);
  assert.ok(!ui.requests.some(row=>row.method==='POST'&&row.route!=='assistant/snooze'));
  const off=harness({now,assistant:{settings:{...previewData().assistant.settings,enabled:false,snoozeUntil:now-1}}});
  off.change('允许助理主动跟进',undefined,true);
  assert.match(flatten(off.render()),/临时暂停已到期；自主跟进总开关仍关闭/);
  const on=harness({now,assistant:{settings:{...previewData().assistant.settings,enabled:true,snoozeUntil:now-1}}});
  on.change('允许助理主动跟进',undefined,false);
  assert.match(flatten(on.render()),/临时暂停已到期，后续按已保存作息执行/);
  assert.ok(!flatten(on.render()).includes('自主跟进总开关仍关闭'));
});

test('snooze failure retains the previous deadline and schedule drafts',async()=>{
  const now=Date.now(),settings={...previewData().assistant.settings,snoozeUntil:now+900000},ui=harness({now,assistant:{settings},failRoute:'assistant/snooze'});
  ui.change('间隔分钟（30–1440）','60');await ui.click('恢复主动跟进');
  assert.equal(ui.getModel().assistant.settings.snoozeUntil,settings.snoozeUntil);assert.equal(namedField(ui.render(),'间隔分钟（30–1440）').props.value,60);
  assert.equal(namedButton(ui.render(),'恢复主动跟进').props.disabled,false);assert.match(flatten(ui.render()),/连接失败/);
});

test('an unknown snooze outcome with failed status refresh never presents the old deadline as current',async()=>{
  let attempted=false;const now=Date.now(),settings={...previewData().assistant.settings,snoozeUntil:now+900000};
  const ui=harness({now,assistant:{settings},failRoute:'assistant/snooze',onSnooze:()=>{attempted=true;},onAssistantGet:()=>{if(attempted)throw Error('状态读取失败');}});
  ui.change('间隔分钟（30–1440）','60');await ui.click('恢复主动跟进');
  const text=flatten(ui.render());
  assert.match(text,/临时免打扰修改未确认/);assert.match(text,/状态读取失败/);assert.ok(!text.includes('自主跟进暂停至'));assert.ok(!text.includes('当前没有临时暂停'));
  assert.equal(ui.getModel().settings.intervalMinutes,60);assert.equal(ui.getModel().assistant.settings.snoozeUntil,settings.snoozeUntil);
});

test('pending snooze freezes settings and leaves existing plans unchanged',async()=>{
  let release;const plan={id:'synthetic-plan',taskId:'synthetic-plan',title:'既有明确计划',status:'active',schedule:{mode:'cron',cron:'0 9 * * *',timeZone:'Asia/Shanghai'}};
  const ui=harness({plans:{plans:[plan]},onSnooze:()=>new Promise(resolve=>{release=resolve;})});
  const pending=ui.click('暂停2小时');
  assert.equal(namedField(ui.render(),'说话风格').props.disabled,true);assert.equal(namedField(ui.render(),'记忆有效期').props.disabled,true);
  assert.equal(namedButton(ui.render(),'今天不主动跟进').props.disabled,true);assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,true);
  release();await pending;
  assert.deepEqual(ui.server.plans.plans,[plan]);assert.ok(!ui.requests.some(row=>row.route==='plans'&&row.method==='POST'));
});

test('memory today and week presets use local calendar boundaries including Sunday and Monday',async()=>{
  for(const [now,mode,expected] of [[new Date(2026,10,1,17,45).getTime(),'today',new Date(2026,10,2).getTime()],[new Date(2026,10,1,17,45).getTime(),'week',new Date(2026,10,2).getTime()],[new Date(2026,10,2,8,15).getTime(),'week',new Date(2026,10,9).getTime()]]){
    const ui=harness({now});ui.change('记忆内容','合成的临时偏好');ui.change('记忆有效期',mode);await ui.click('保存记忆');
    const body=ui.requests.find(row=>row.route==='assistant/memory').body;
    assert.equal(body.expiresAt,expected);assert.ok(!('expiryMode' in body));assert.ok(!('expiryAt' in body));
  }
});

test('memory corrections preserve the precise existing expiry and allow explicit long-term retention',async()=>{
  const now=new Date(2030,2,12).getTime(),expiresAt=now+987654321;
  const ui=harness({now,assistant:{memories:[{id:'timed-memory',text:'合成记忆旧正文',category:'fact',source:'用户说明',expiresAt,createdAt:1,updatedAt:2}]}});
  await ui.click('纠正这条记忆');assert.equal(namedField(ui.render(),'记忆有效期').props.value,'keep');
  ui.change('记忆内容','合成记忆新正文');await ui.click('保存记忆');
  assert.equal(ui.requests.find(row=>row.route==='assistant/memory').body.expiresAt,expiresAt);
  await ui.click('纠正这条记忆');ui.change('记忆有效期','never');await ui.click('保存记忆');
  assert.equal(ui.requests.filter(row=>row.route==='assistant/memory')[1].body.expiresAt,null);
});

test('custom memory expiry rejects empty invalid or past dates before submitting and preserves drafts',async()=>{
  const now=new Date(2030,1,1,12).getTime(),ui=harness({now});
  ui.change('记忆内容','合成自定记忆');ui.change('记忆有效期','custom');
  for(const value of ['', 'not-a-date', '2030-02-30T15:00', '2030-01-31T15:00']){
    ui.change('记忆到期时间',value);await ui.click('保存记忆');
    assert.equal(ui.requests.filter(row=>row.route==='assistant/memory').length,0);assert.equal(namedField(ui.render(),'记忆内容').props.value,'合成自定记忆');
  }
  ui.change('记忆到期时间','2030-02-02T15:30');await ui.click('保存记忆');
  assert.equal(ui.requests.find(row=>row.route==='assistant/memory').body.expiresAt,new Date(2030,1,2,15,30).getTime());
  assert.equal(namedField(ui.render(),'记忆有效期').props.value,'never');
});

test('polling and failed memory saves retain custom expiry drafts and style choices',async()=>{
  const ui=harness({failRoute:'assistant/memory'});await ui.mount();
  ui.change('记忆内容','合成记忆草稿');ui.change('记忆有效期','custom');ui.change('记忆到期时间','2099-02-01T15:30');ui.change('说话风格','natural');
  await ui.poll();await ui.click('保存记忆');
  assert.equal(namedField(ui.render(),'记忆有效期').props.value,'custom');assert.equal(namedField(ui.render(),'记忆到期时间').props.value,'2099-02-01T15:30');
  assert.equal(namedField(ui.render(),'记忆内容').props.value,'合成记忆草稿');assert.equal(namedField(ui.render(),'说话风格').props.value,'natural');ui.unmount();
});

test('an unfinished expiry choice protects navigation even before memory text is entered',()=>{
  const ui=harness({remote:{sessionId:'synthetic-main'},props:{openAssistantSession:async()=>{},close:()=>{}}});
  assert.equal(namedButton(ui.render(),'和助理聊天').props.disabled,false);
  ui.change('记忆有效期','custom');
  assert.equal(namedButton(ui.render(),'和助理聊天').props.disabled,true);
});

test('goal pause and completion update status without overwriting its details or check time',async()=>{
  const ui=harness({assistant:{goals:[{id:'goal-1',title:'留意公开资料',detail:'只看公开来源',mode:'watch',status:'active',nextCheckAt:999,progress:'已有两个线索'}]}});
  await ui.click('暂停');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/goal').body,{id:'goal-1',status:'paused'});
  assert.equal(ui.server.assistant.goals[0].detail,'只看公开来源');assert.equal(ui.server.assistant.goals[0].nextCheckAt,999);
  await ui.click('继续跟进');
  await ui.click('标为完成');
  assert.equal(ui.server.assistant.goals[0].status,'done');
  assert.match(flatten(ui.render()),/已完成的目标/);
});

test('new goals use the personal route and keep empty drafts from submitting',async()=>{
  const ui=harness();
  assert.equal(namedButton(ui.render(),'添加目标').props.disabled,true);
  ui.change('目标','整理公开资料');ui.change('补充要求','给出可用原始来源');ui.change('跟进方式','task');
  await ui.click('添加目标');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/goal').body,{title:'整理公开资料',detail:'给出可用原始来源',mode:'task'});
  assert.equal(namedField(ui.render(),'目标').props.value,'');
});

test('inbox keeps source links safe and marking read stays local',async()=>{
  const ui=harness({assistant:{inbox:[{id:'notice-1',title:'找到一个线索',body:'<img src=x onerror=alert(1)>',createdAt:3,readAt:null,links:[{title:'原帖',url:'https://x.com/example/status/123456789'},{title:'危险链接',url:'javascript:alert(1)'},{url:'https://name:secret@example.com/'}]}]}});
  const anchors=findAll(ui.render(),node=>node.type==='a');
  assert.equal(anchors.length,1);assert.equal(anchors[0].props.href,'https://x.com/example/status/123456789');
  assert.equal(anchors[0].props.rel,'noopener noreferrer');
  assert.match(flatten(ui.render()),/<img src=x/);
  assert.equal(findAll(ui.render(),node=>node.type==='img'||node.props.dangerouslySetInnerHTML).length,0);
  await ui.click('标为已读');
  assert.deepEqual(ui.requests.find(row=>row.route==='assistant/inbox-read').body,{id:'notice-1'});
  assert.equal(ui.server.assistant.inbox[0].readAt,5);
  assert.ok(!ui.requests.some(row=>/reply|mention|bookmark/.test(row.route)));
});

test('X failures stay visible, errors hide Cookie assignments, and sensitive remote fields never render',async()=>{
  const ui=harness({remote:{credentials:{auth_token:'REMOTE_SECRET_CANARY'},lastDiagnosis:{at:5,status:'failed',message:'无法连接 X，请检查代理'},lastRead:{at:6,operation:'search',status:'failed',kind:'ReadTimeout',message:'读取失败',details:'DO_NOT_RENDER'},sessionId:'dedicated-session'},failRoute:'channels/check',error:'auth_token=entered-secret ct0=another-secret'});
  await ui.checkChannel('x');
  const text=flatten(ui.render());
  assert.match(text,/无法连接 X/);assert.match(text,/ReadTimeout/);assert.match(text,/dedicated-session/);
  assert.ok(!text.includes('REMOTE_SECRET_CANARY'));assert.ok(!text.includes('DO_NOT_RENDER'));assert.ok(!text.includes('entered-secret'));assert.ok(!text.includes('another-secret'));
});

test('browser transport stays explicit and writing remains separately controlled',()=>{
  const ui=harness(),text=flatten(ui.render());
  for(const label of ['接入方式','Cookie + 独立浏览器（推荐）','旧 Cookie 接口（实验）','独立临时浏览器配置','不读取你日常 Chrome 的数据','不会在失败时静默互相回退','X 操作权限','接入状态：已实现'])assert.ok(text.includes(label),label);
  for(const label of ['允许收藏书签','允许公开回复','允许公开 @ 用户分享'])assert.equal(namedField(ui.render(),label).props.checked,false);
  ui.change('接入方式','direct_api');
  assert.ok(!flatten(ui.render()).includes('浏览器路径（可选）'));assert.match(flatten(ui.render()),/Python 路径/);
});

test('settings and persistent sidebar slots use the My Fish identity',()=>{
  const registered=[];let loaded;
  const react={createElement:()=>{},useState:()=>{},useEffect:()=>{}};
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{loaded=entry;}}}});
  const plugin=loaded.factory(()=>react);
  plugin.apply({effect:fn=>fn(),slots:{inject:(_slot,fn)=>fn(),register:entry=>{registered.push(entry);}}});
  assert.equal(loaded.id,'dsh-my-fish');assert.equal(registered.find(row=>row.name==='settings.section').label(),'My Fish');
  assert.equal(registered.find(row=>row.name==='sidebar.footer.action').id,'my-fish');
});

test('unavailable personal records leave X setup usable without inventing empty memories',async()=>{
  const ui=harness({loaded:false,failRoute:'assistant',error:'本地状态文件损坏：memories.json'});
  await ui.mount();
  const tree=ui.render(),text=flatten(tree);
  assert.match(text,/个人记忆暂不可用/);assert.match(text,/memories.json/);assert.match(text,/渠道与账号/);
  assert.ok(!text.includes('还没有长期记忆'));assert.ok(!text.includes('还没有新消息'));
  assert.equal(findAll(tree,node=>node.type==='button'&&flatten(node.children)==='现在唤醒').length,0);
  ui.change('AI 账号用户名','test_user');
  await ui.click('保存 X 设置');
  assert.equal(ui.requests.find(row=>row.route==='config').body.aiUsername,'test_user');
  assert.ok(!ui.requests.some(row=>row.route==='assistant/memory'));
});

test('a failed personal refresh retains cached records and unsaved role content',async()=>{
  const ui=harness({assistant:{memories:[{id:'known',text:'保留的偏好',category:'preference',source:'用户说明',updatedAt:2}]},failRoute:'assistant',error:'暂时读取失败'});
  ui.change('角色名','还没保存的名字');
  await ui.click('刷新动态');
  assert.equal(ui.getModel().assistant.memories[0].text,'保留的偏好');
  assert.equal(ui.getModel().profile.name,'还没保存的名字');
  assert.match(flatten(ui.render()),/个人记忆暂不可用/);
  assert.ok(!flatten(ui.render()).includes('还没有长期记忆'));
});

test('inbox preserves the server newest-first order and completion labels reflect personal runs',()=>{
  const ui=harness({remote:{lastRun:{status:'quiet',at:1,reason:'暂无新进展'}},assistant:{inbox:[{id:'new',title:'较新的发现',body:'新',createdAt:20,readAt:1,links:[]},{id:'old',title:'较旧的发现',body:'旧',createdAt:10,readAt:1,links:[]}]}});
  const text=flatten(ui.render());
  assert.ok(text.indexOf('较新的发现')<text.indexOf('较旧的发现'));
  assert.match(text,/安静结束/);
  ui.server.remote.lastRun.status='reported';
  ui.setModel({remote:ui.server.remote});
  assert.match(flatten(ui.render()),/已汇报到动态盒/);
});

test('mounted view refreshes notices and run status every fifteen seconds without saving drafts',async()=>{
  const ui=harness();await ui.mount();
  assert.equal(ui.getInterval().delay,15000);
  ui.change('角色名','保持这个角色草稿');ui.change('间隔分钟（30–1440）','75');ui.change('AI 账号用户名','draft_user');
  ui.server.assistant.inbox=[{id:'new-notice',title:'后台新发现',body:'带回原始来源',links:[],createdAt:9,readAt:null}];
  ui.server.remote.lastRun={status:'reported',at:9,reason:'本轮已经汇报'};
  await ui.poll();
  const tree=ui.render();
  assert.match(flatten(tree),/后台新发现/);assert.match(flatten(tree),/已汇报到动态盒/);
  assert.equal(namedField(tree,'角色名').props.value,'保持这个角色草稿');
  assert.equal(namedField(tree,'间隔分钟（30–1440）').props.value,75);
  assert.equal(namedField(tree,'AI 账号用户名').props.value,'draft_user');
  assert.ok(ui.requests.every(row=>row.method==='GET'));
  const before=ui.requests.length;ui.unmount();
  assert.equal(ui.getInterval().cleared,123);
  await ui.poll();assert.equal(ui.requests.length,before);
});

test('poll failures use one quiet status and keep the last records visible until recovery',async()=>{
  const options={assistant:{memories:[{id:'known',text:'保留记录',category:'fact',source:'用户',updatedAt:1}]}};
  const ui=harness(options);await ui.mount();
  options.failRoute='state';options.error='本机连接暂不可用';
  await ui.poll();await ui.poll();
  const text=flatten(ui.render());
  assert.equal((text.match(/动态暂未刷新/g)||[]).length,1);assert.match(text,/本机连接暂不可用/);assert.match(text,/保留记录/);
  assert.equal(ui.getModel().message,'');
  options.failRoute=null;await ui.poll();
  assert.ok(!flatten(ui.render()).includes('动态暂未刷新'));
  ui.unmount();
});

test('chat confirms the existing main session then closes settings without waking or creating a plan',async()=>{
  const calls=[],ui=harness({remote:{sessionId:'existing-main-session'},props:{openAssistantSession:id=>calls.push(['open',id]),close:()=>calls.push(['close'])}});
  await ui.click('和助理聊天');
  assert.deepEqual(calls,[['open','existing-main-session'],['close']]);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method,row.body]),[['session','POST',{}]]);
});

test('chat is disabled without an existing session, navigation or settings close callback',()=>{
  const calls=[],props={openAssistantSession:id=>calls.push(id),close:()=>calls.push('close')};
  const noSession=harness({props});
  const noService=harness({remote:{sessionId:'existing'},props:{close:props.close,navigationError:'导航服务暂未就绪'}});
  const noClose=harness({remote:{sessionId:'existing'},props:{openAssistantSession:props.openAssistantSession}});
  for(const ui of [noSession,noService,noClose]){
    const button=namedButton(ui.render(),'和助理聊天');assert.equal(button.props.disabled,true);button.props.onClick();
    assert.deepEqual(ui.requests,[]);
  }
  assert.match(flatten(noSession.render()),/建立聊天会话后即可进入/);assert.match(flatten(noService.render()),/导航服务暂未就绪/);assert.deepEqual(calls,[]);
});

test('chat protects settings and unfinished task, memory and goal drafts from being discarded',()=>{
  for(const [label,value] of [['角色名','尚未保存'],['本次任务（可选）','临时任务'],['记忆内容','尚未保存的记忆'],['目标','尚未添加的目标']]){
    const calls=[],ui=harness({remote:{sessionId:'existing'},props:{openAssistantSession:id=>calls.push(id),close:()=>calls.push('close')}});
    ui.change(label,value);
    const button=namedButton(ui.render(),'和助理聊天');assert.equal(button.props.disabled,true);button.props.onClick();
    assert.deepEqual(calls,[]);assert.match(flatten(ui.render()),/先保存或清空/);
  }
});

test('chat navigation failure keeps settings open and shows the actual failure',async()=>{
  let closed=false;
  const ui=harness({remote:{sessionId:'existing'},props:{openAssistantSession:()=>{throw Error('会话已不可用，请刷新记录');},close:()=>{closed=true;}}});
  await ui.click('和助理聊天');
  assert.equal(closed,false);assert.match(flatten(ui.render()),/会话已不可用/);assert.deepEqual(ui.requests.map(row=>row.route),['session']);
});

test('slot navigation uses the public uiWorkspace service and leaves host close props untouched',()=>{
  let registered,loaded;const calls=[];
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{loaded=entry;}}}});
  const plugin=loaded.factory(()=>({}));
  const context={get:name=>{assert.equal(name,'uiWorkspace');return {openSession:id=>calls.push(id)};},effect:fn=>fn(),slots:{inject:(_slot,fn)=>fn(),register:entry=>{registered=entry;}}};
  plugin.apply(context);
  const injected=registered.inject();assert.equal(Object.hasOwn(injected,'close'),false);
  injected.openAssistantSession('existing');assert.deepEqual(calls,['existing']);
  context.get=()=>{throw Error('导航服务暂未就绪');};
  const missing=registered.inject();assert.equal(missing.openAssistantSession,undefined);assert.match(missing.navigationError,/导航服务暂未就绪/);
});

test('initializing chat creates only the fixed session without queuing a wake or a plan',async()=>{
  const calls=[],ui=harness({props:{openAssistantSession:id=>calls.push(id),close:()=>calls.push('closed')}});
  await ui.click('建立聊天会话');
  assert.deepEqual(ui.requests.filter(row=>row.method==='POST').map(row=>row.route),['session']);
  assert.match(flatten(ui.render()),/没有投递任务/);
  await ui.click('和助理聊天');
  assert.deepEqual(calls,['initialized-main','closed']);
});

test('plan creation preserves hourly timing and uses task-board management routes',async()=>{
  const ui=harness();
  assert.equal(namedButton(ui.render(),'保存定时计划').props.disabled,true);
  ui.change('计划名称','检查公开额度消息');ui.change('执行要求','只看指定公告来源，有明确变化才通知');ui.change('计划时区','Asia/Shanghai');
  await ui.click('保存定时计划');
  const post=ui.requests.find(row=>row.route==='plans'&&row.method==='POST');
  assert.equal(post.body.action,'create');assert.ok(post.body.requestId);
  assert.deepEqual(post.body.schedule,{mode:'cron',timeZone:'Asia/Shanghai',cron:'0 * * * *'});
  assert.equal(namedField(ui.render(),'计划名称').props.value,'');
  await ui.click('暂停计划');
  assert.equal(ui.requests.filter(row=>row.route==='plans'&&row.method==='POST').at(-1).body.action,'pause');
  await ui.click('恢复计划');await ui.click('取消计划');
  assert.equal(ui.server.plans.plans[0].status,'cancelled');
  assert.ok(!ui.requests.some(row=>row.route==='assistant/settings'||row.route==='assistant/wake'));
});

test('daily and once schedules keep explicit local time and reject expired dates before saving',async()=>{
  const daily=harness();daily.change('计划名称','每日整理');daily.change('执行要求','整理公开消息');daily.change('执行频率','daily');daily.change('每天执行时间','08:35');daily.change('计划时区','Asia/Shanghai');
  await daily.click('保存定时计划');
  assert.deepEqual(daily.requests.find(row=>row.route==='plans'&&row.method==='POST').body.schedule,{mode:'cron',timeZone:'Asia/Shanghai',cron:'35 8 * * *'});
  const once=harness();once.change('计划名称','一次检查');once.change('执行要求','检查公开状态');once.change('执行频率','once');once.change('执行日期与时间（本机时间）','2000-01-01T09:00');
  await once.click('保存定时计划');assert.match(flatten(once.render()),/请选择未来/);
  assert.ok(!once.requests.some(row=>row.route==='plans'&&row.method==='POST'));
  once.change('执行日期与时间（本机时间）','2099-01-01T09:00');await once.click('保存定时计划');
  const schedule=once.requests.find(row=>row.route==='plans'&&row.method==='POST').body.schedule;
  assert.equal(schedule.mode,'once');assert.equal(schedule.at,new Date('2099-01-01T09:00').getTime());assert.ok(schedule.timeZone);
});

test('unknown plan outcome keeps its request key and draft for an idempotent retry',async()=>{
  const ui=harness({failRoute:'plans',error:'连接中断，结果尚未确认'});
  ui.change('计划名称','保留计划');ui.change('执行要求','只读检查');
  await ui.click('保存定时计划');await ui.click('保存定时计划');
  const posts=ui.requests.filter(row=>row.route==='plans'&&row.method==='POST');
  assert.equal(posts.length,2);assert.equal(posts[0].body.requestId,posts[1].body.requestId);
  assert.equal(namedField(ui.render(),'计划名称').props.value,'保留计划');
});

test('a missing task board remains separate from working personal records',async()=>{
  const ui=harness({loaded:false,plans:{ok:false,available:false,plans:[],reason:'任务看板尚未启用'}});
  await ui.mount();const text=flatten(ui.render());
  assert.match(text,/任务看板尚未启用/);assert.match(text,/长期记忆/);
  assert.equal(findAll(ui.render(),node=>node.type==='button'&&flatten(node.children)==='保存定时计划').length,0);
});

test('permission drafts survive refresh and save without changing role or social switches',async()=>{
  const ui=harness();ui.change('允许本机命令、代码与终端',undefined,true);ui.change('禁止外发的私密词组，每行一项','内部项目代号\n私有测试词\n');
  assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,true);
  await ui.click('刷新动态');
  assert.equal(namedField(ui.render(),'允许本机命令、代码与终端').props.checked,true);
  await ui.click('保存个人权限');
  assert.deepEqual(ui.requests.find(row=>row.route==='permissions'&&row.method==='POST').body,{shell:true,fileWrite:false,browserInteract:false,delegation:false,privateTerms:['内部项目代号','私有测试词']});
  assert.equal(ui.server.remote.config.allowReplies,false);assert.equal(ui.server.assistant.profile.name,'My Fish');
  assert.ok(!ui.requests.some(row=>['config','assistant/profile'].includes(row.route)&&row.method==='POST'));
});

function sidebarHarness({sessionId,recoveredId,fail=false}={}){
  let plugin,state;const calls=[];
  const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:initial=>{state??=initial;return [state,next=>{state=typeof next==='function'?next(state):next;}];}};
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(()=>react);}}},Date,JSON,URL,fetch:async(url,options={})=>{const route=url.split('/api/')[1];calls.push(route);return {ok:!fail,json:async()=>fail?{ok:false,error:'无法读取会话'}:route==='state'?{sessionId}:{ok:true,sessionId:recoveredId||sessionId||'first-main',created:!!recoveredId||!sessionId,recovered:!!recoveredId}};}});
  const render=()=>plugin.SidebarEntry({wide:true,openAssistantSession:id=>calls.push(['open',id])});
  return {calls,render,async open(){await namedButton(render(),'鱼  My Fish').props.onClick();return render();}};
}

test('persistent sidebar opens the existing session and initializes only when absent',async()=>{
  const existing=sidebarHarness({sessionId:'saved-main'});await existing.open();assert.deepEqual(existing.calls,['session',['open','saved-main']]);
  const first=sidebarHarness();await first.open();assert.deepEqual(first.calls,['session',['open','first-main']]);
  const failed=sidebarHarness({fail:true});await failed.open();assert.match(flatten(failed.render()),/无法读取会话/);assert.deepEqual(failed.calls,['session']);
});

test('persistent sidebar checks session existence and uses the recovered session after deletion',async()=>{
  const ui=sidebarHarness({sessionId:'deleted-main',recoveredId:'recovered-main'});await ui.open();
  assert.deepEqual(ui.calls,['session',['open','recovered-main']]);
});

test('settings chat uses the confirmed recovered session and keeps personal records unchanged',async()=>{
  const calls=[],ui=harness({remote:{sessionId:'deleted-main'},assistant:{memories:[{id:'kept-memory',text:'保留的明确偏好',category:'preference',source:'用户说明'}]},sessionResult:{ok:true,sessionId:'restored-main',created:true,recovered:true},props:{openAssistantSession:id=>calls.push(['open',id]),close:()=>calls.push(['close'])}});
  const before=structuredClone(ui.server.assistant),config=structuredClone(ui.server.remote.config);
  await ui.click('和助理聊天');
  assert.deepEqual(calls,[['open','restored-main'],['close']]);assert.equal(ui.getModel().remote.sessionId,'restored-main');
  assert.deepEqual(ui.server.assistant,before);assert.deepEqual(ui.server.remote.config,config);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['session','POST']]);
});

test('a temporary session check failure keeps settings open and retries only when clicked again',async()=>{
  const calls=[],options={remote:{sessionId:'preserved-old'},failRoute:'session',error:'会话索引暂不可用，请稍后重试',props:{openAssistantSession:id=>calls.push(id),close:()=>calls.push('closed')}};
  const ui=harness(options);await ui.click('和助理聊天');
  assert.deepEqual(calls,[]);assert.equal(ui.getModel().remote.sessionId,'preserved-old');assert.match(flatten(ui.render()),/会话索引暂不可用/);
  assert.deepEqual(ui.requests.map(row=>row.route),['session']);
  options.failRoute=null;await ui.click('和助理聊天');assert.deepEqual(calls,['preserved-old','closed']);
  assert.deepEqual(ui.requests.map(row=>row.route),['session','session']);
});

test('settings waits for asynchronous navigation and does not rebuild when navigation rejects',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;}),calls=[];
  const ui=harness({remote:{sessionId:'confirmed-main'},props:{openAssistantSession:async id=>{calls.push(['open',id]);await gate;},close:()=>calls.push(['close'])}});
  const pending=namedButton(ui.render(),'和助理聊天').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[['open','confirmed-main']]);assert.equal(namedButton(ui.render(),'和助理聊天').props.disabled,true);
  finish();await pending;assert.deepEqual(calls,[['open','confirmed-main'],['close']]);
  let closed=false;const failing=harness({remote:{sessionId:'confirmed-main'},props:{openAssistantSession:async()=>{throw Error('导航暂时失败');},close:()=>{closed=true;}}});
  await failing.click('和助理聊天');assert.equal(closed,false);assert.match(flatten(failing.render()),/导航暂时失败/);
  assert.deepEqual(failing.requests.map(row=>row.route),['session']);
});

test('concurrent sidebar and settings clicks share one session check and open the same recovered session',async()=>{
  const data=previewData(),requests=[],opened=[];let plugin,finish,closed=0;
  const gate=new Promise(resolve=>{finish=resolve;});
  const loaded={remote:{...data.remote,sessionId:'deleted-main'},assistant:data.assistant,cfg:data.remote.config,profile:data.assistant.profile,settings:data.assistant.settings,plans:data.plans,policy:data.permissions.policy,capabilities:data.permissions.capabilities,saved:{cfg:JSON.stringify(data.remote.config),profile:JSON.stringify(data.assistant.profile),settings:JSON.stringify(data.assistant.settings),policy:JSON.stringify(data.permissions.policy)}};
  const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState:initial=>[Object.hasOwn(initial,'remote')?{...initial,...loaded}:initial,()=>{}],useEffect:()=>{}};
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(()=>react);}}},Date,JSON,URL,fetch:async(url,options={})=>{requests.push({url,method:options.method});await gate;return {ok:true,json:async()=>({ok:true,sessionId:'one-recovered-main',created:true,recovered:true})};}});
  const settings=plugin.Section({openAssistantSession:id=>opened.push(id),close:()=>{closed++;}}),sidebar=plugin.SidebarEntry({openAssistantSession:id=>opened.push(id)});
  const settingsClick=namedButton(settings,'和助理聊天').props.onClick(),sidebarClick=namedButton(sidebar,'鱼  My Fish').props.onClick();
  assert.equal(requests.length,1);finish();await Promise.all([settingsClick,sidebarClick]);
  assert.deepEqual(requests,[{url:'/my-fish/api/session',method:'POST'}]);assert.deepEqual(opened,['one-recovered-main','one-recovered-main']);assert.equal(closed,1);
});

test('public navigation injection returns the host promise so callers can await failures',async()=>{
  let plugin,registered,finish;const gate=new Promise(resolve=>{finish=resolve;});
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(()=>({}));}}}});
  plugin.apply({get:()=>({openSession:()=>gate}),effect:fn=>fn(),slots:{inject:(_name,fn)=>fn(),register:entry=>{if(entry.name==='settings.section')registered=entry;}}});
  const result=registered.inject().openAssistantSession('confirmed-main');assert.equal(result,gate);finish();await result;
});

test('session recovery pause is explicit and resuming it changes no schedule or account permission',async()=>{
  const recovery={recovered:true,at:123,followupPaused:true,note:'原会话不可用，个人资料保留'};
  const ui=harness({remote:{sessionId:'new-empty-main',pausedUntil:9999999999999,pauseReason:'账号连接暂停',sessionRecovery:recovery}});
  const text=flatten(ui.render());assert.match(text,/原会话不可用，已建立新会话。自主跟进暂缓，记忆\/账号配置保留/);assert.match(text,/新会话不会恢复已删除的聊天记录/);
  const config=structuredClone(ui.server.remote.config),settings=structuredClone(ui.server.assistant.settings);
  await ui.click('恢复自主跟进');
  assert.equal(ui.server.remote.sessionRecovery.followupPaused,false);assert.equal(ui.server.remote.pausedUntil,9999999999999);assert.equal(ui.server.remote.pauseReason,'账号连接暂停');
  assert.deepEqual(ui.server.remote.config,config);assert.deepEqual(ui.server.assistant.settings,settings);
  assert.deepEqual(ui.requests.filter(row=>row.method==='POST').map(row=>[row.route,row.body]),[['session/followup-resume',{}]]);
  assert.equal(findAll(ui.render(),node=>node.type==='button'&&flatten(node.children)==='恢复自主跟进').length,0);
});

test('failed recovery resume keeps the pause notice and does not fall back to general resume',async()=>{
  const ui=harness({remote:{sessionRecovery:{recovered:true,at:123,followupPaused:true}},failRoute:'session/followup-resume',error:'恢复状态暂不可写入'});
  await ui.click('恢复自主跟进');assert.match(flatten(ui.render()),/恢复状态暂不可写入/);assert.match(flatten(ui.render()),/自主跟进暂缓/);
  assert.equal(ui.getModel().remote.sessionRecovery.followupPaused,true);assert.deepEqual(ui.requests.filter(row=>row.method==='POST').map(row=>row.route),['session/followup-resume']);
});

test('recovered-session note is shown while opening and retained with any navigation error',async()=>{
  let fail;const gate=new Promise((_resolve,reject)=>{fail=reject;});let closed=false;
  const ui=harness({remote:{sessionId:'deleted-main'},sessionResult:{ok:true,sessionId:'new-empty-main',created:true,recovered:true,note:'原会话已删除，已建立新的空会话；个人资料保留'},props:{openAssistantSession:()=>gate,close:()=>{closed=true;}}});
  const pending=namedButton(ui.render(),'和助理聊天').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.match(flatten(ui.render()),/已建立新的空会话；个人资料保留/);fail(Error('导航暂不可用'));await pending;
  assert.equal(closed,false);assert.match(flatten(ui.render()),/已建立新的空会话；个人资料保留/);assert.match(flatten(ui.render()),/导航暂不可用/);
  assert.deepEqual(ui.requests.map(row=>row.route),['session']);
});

test('interrupted personal runs are labeled accurately in recent status and history',()=>{
  const ui=harness({remote:{lastRun:{status:'interrupted',at:123,reason:'原会话已删除'},runHistory:[{id:'interrupted-run',status:'interrupted',at:123,manual:false,reason:'原会话已删除'}]}});
  assert.equal((flatten(ui.render()).match(/已中断/g)||[]).length,2);assert.match(flatten(ui.render()),/原会话已删除/);
});

test('voice service status uses the public Remote result without preparing or recording audio',async()=>{
  let plugin;const calls=[],registrations=[];
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(()=>({}));}}}});
  const context={get:name=>name==='uiWorkspace'?{openSession:()=>{}}:name==='remote'?{speech:{catalog:async()=>{calls.push('catalog');return {ok:true,value:{selection:{providerId:'local'},providers:[{id:'local',name:'本地听写',preparation:{phase:'standby'}}]}};}}}:undefined,effect:fn=>fn(),slots:{inject:(_slot,fn)=>fn(),register:entry=>registrations.push(entry)}};
  plugin.apply(context);
  const actions=registrations.find(row=>row.name==='settings.section').inject();
  const result=await actions.checkSpeech();assert.equal(result.ready,true);assert.match(result.message,/已准备/);assert.deepEqual(calls,['catalog']);
  context.get=name=>name==='uiWorkspace'?{openSession:()=>{}}:undefined;
  const unavailable=await actions.checkSpeech();assert.equal(unavailable.available,false);assert.match(unavailable.message,/未加载/);
});

test('editing a paused plan changes only time and preserves pause state and run limit',async()=>{
  const ui=harness({plans:{plans:[{id:'known-plan',taskId:'known-plan',title:'已有计划',instruction:'保留已有要求',status:'paused',schedule:{mode:'cron',cron:'0 9 * * *',timeZone:'Asia/Shanghai',enabled:false,maxRuns:8}}]}});
  await ui.click('修改时间');
  assert.equal(namedField(ui.render(),'计划名称').props.disabled,true);assert.equal(namedField(ui.render(),'执行要求').props.disabled,true);
  ui.change('每天执行时间','10:25');await ui.click('保存执行时间');
  const post=ui.requests.find(row=>row.route==='plans'&&row.method==='POST');
  assert.equal(post.body.action,'update');assert.equal(post.body.taskId,'known-plan');
  assert.deepEqual(post.body.schedule,{mode:'cron',timeZone:'Asia/Shanghai',cron:'25 10 * * *',enabled:false,maxRuns:8});
  assert.equal(post.body.title,undefined);assert.equal(post.body.instruction,undefined);
});

test('plan rows display host execution result, failure and quiet reports from actual response fields',()=>{
  const ui=harness({plans:{plans:[{id:'failed-plan',title:'检查计划',instruction:'只读要求',status:'paused',schedule:{mode:'cron',cron:'0 * * * *',timeZone:'Asia/Shanghai'},lastRun:{result:'failed',startedAt:123,error:'公开检索服务不可用'},history:[{result:'failed',startedAt:123,error:'公开检索服务不可用'}],runReports:[{at:124,notify:false,notified:false,deduplicated:false}]}]}});
  const text=flatten(ui.render());assert.match(text,/最近执行：失败/);assert.match(text,/公开检索服务不可用/);assert.match(text,/最近汇报：安静结束/);assert.match(text,/最近执行记录/);
  const noGuard=harness({permissions:{policy:{shell:false,fileWrite:false,browserInteract:false,delegation:false,privateTerms:[]},capabilities:{guardAvailable:false}}});
  assert.match(flatten(noGuard.render()),/无法确认个人工具门禁/);assert.ok(!flatten(noGuard.render()).includes('受控能力会被拒绝'));
});

test('workspace shows the actual data and working locations and accepts only absolute destinations',()=>{
  const ui=harness(),text=flatten(ui.render());
  assert.match(text,/个人资料位置：C:\\Synthetic\\my-fish/);assert.match(text,/会话工作目录：C:\\Synthetic\\my-fish\\workspace/);
  assert.match(text,/加密文件原样迁移，无需重新登录/);assert.match(text,/DSH 聊天记录留在宿主/);
  assert.match(text,/不会改变 DSH 原会话的文件权限或项目归属；命令和文件操作继续遵循宿主权限与审批/);
  assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,true);
  ui.change('新工作区绝对路径','relative-folder');assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,true);assert.match(flatten(ui.render()),/请填写完整绝对路径/);
  for(const path of ['D:\\My Fish','\\\\server\\share\\MyFish','/home/example/my-fish']){ui.change('新工作区绝对路径',path);assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,false,path);}
});

test('workspace path drafts survive refresh and protect chat and wake until saved or cancelled',async()=>{
  const calls=[],ui=harness({remote:{sessionId:'same-main'},props:{openAssistantSession:id=>calls.push(id),close:()=>calls.push('closed')}});
  ui.change('新工作区绝对路径','D:\\NewFish');
  assert.equal(namedButton(ui.render(),'和助理聊天').props.disabled,true);assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,true);
  ui.server.workspace.path='C:\\ServerCurrent';ui.server.workspace.workingDirectory='C:\\ServerCurrent\\workspace';await ui.click('刷新动态');
  assert.equal(namedField(ui.render(),'新工作区绝对路径').props.value,'D:\\NewFish');assert.match(flatten(ui.render()),/个人资料位置：C:\\ServerCurrent/);
  namedButton(ui.render(),'和助理聊天').props.onClick();assert.deepEqual(calls,[]);
  await ui.click('取消路径修改');assert.equal(namedField(ui.render(),'新工作区绝对路径').props.value,'C:\\ServerCurrent');assert.equal(namedButton(ui.render(),'和助理聊天').props.disabled,false);
});

test('saving a workspace sends only its path and preserves the fixed session without waking it',async()=>{
  const ui=harness({remote:{sessionId:'preserved-main'}});ui.change('新工作区绝对路径',' D:\\Personal Fish ');
  await ui.click('保存并迁移工作区');
  assert.deepEqual(ui.requests.find(row=>row.route==='workspace'&&row.method==='POST').body,{path:'D:\\Personal Fish'});
  assert.equal(ui.getModel().workspace.path,'D:\\Personal Fish');assert.equal(ui.getModel().workspace.workingDirectory,'D:\\Personal Fish\\workspace');
  assert.equal(namedField(ui.render(),'新工作区绝对路径').props.value,'D:\\Personal Fish');assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,true);
  assert.match(flatten(ui.render()),/迁移成功/);assert.equal(ui.getModel().remote.sessionId,'preserved-main');
  assert.ok(!ui.requests.some(row=>row.method==='POST'&&row.route!=='workspace'));
});

test('a workspace request failure keeps the last known location and destination draft',async()=>{
  const ui=harness({failRoute:'workspace',error:'目标目录已有文件，拒绝覆盖'});ui.change('新工作区绝对路径','D:\\Existing');
  await ui.click('保存并迁移工作区');
  const text=flatten(ui.render());assert.match(text,/目标目录已有文件/);assert.match(text,/个人资料位置：C:\\Synthetic\\my-fish/);
  assert.equal(namedField(ui.render(),'新工作区绝对路径').props.value,'D:\\Existing');assert.equal(ui.getModel().workspace.path,'C:\\Synthetic\\my-fish');
  assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,true);assert.ok(!text.includes('工作区迁移成功'));
});

test('missing or malformed workspace responses never invent an empty path',async()=>{
  for(const options of [{failRoute:'workspace',error:'旧版接口不存在'},{workspace:{path:'',workingDirectory:''}}]){
    const ui=harness({loaded:false,...options});await ui.mount();const text=flatten(ui.render());
    assert.match(text,/工作区状态暂不可用/);assert.match(text,/不会用空路径替代当前配置/);assert.match(text,/长期记忆/);
    assert.equal(ui.getModel().workspace,null);assert.equal(findAll(ui.render(),node=>node.props['aria-label']==='新工作区绝对路径').length,0);
    assert.ok(!ui.requests.some(row=>row.method==='POST'));
  }
});

test('local and remote migration states disable settings operations until completion',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const ui=harness({onWorkspacePost:()=>gate});ui.change('新工作区绝对路径','D:\\NewFish');
  const pending=namedButton(ui.render(),'保存并迁移工作区').props.onClick();
  assert.match(flatten(ui.render()),/正在迁移工作区/);
  assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,true);assert.equal(namedField(ui.render(),'新工作区绝对路径').props.disabled,true);assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,true);
  finish();await pending;assert.equal(ui.getModel().busy,false);assert.equal(namedField(ui.render(),'新工作区绝对路径').props.disabled,false);
  const remote=harness({workspace:{migrating:true,canMigrate:false,reason:'工作区正在迁移'}});
  assert.match(flatten(remote.render()),/正在迁移工作区/);assert.equal(namedField(remote.render(),'角色名').props.disabled,true);assert.equal(namedButton(remote.render(),'现在唤醒').props.disabled,true);
  await namedButton(remote.render(),'现在唤醒').props.onClick();assert.deepEqual(remote.requests,[]);
});

test('workspace migration is unavailable while the backend reports active work',()=>{
  const ui=harness({workspace:{canMigrate:false,reason:'请先停止正在运行的个人任务'}});ui.change('新工作区绝对路径','D:\\AfterStop');
  assert.match(flatten(ui.render()),/请先停止正在运行的个人任务/);assert.equal(namedButton(ui.render(),'保存并迁移工作区').props.disabled,true);
});

function channelCard(tree,id){const cards=findAll(tree,node=>node.props['data-channel']===id);assert.equal(cards.length,1,'unique channel: '+id);return cards[0];}

test('Bilibili has an anonymous check and X settings live inside its single channel card',()=>{
  const ui=harness(),tree=ui.render(),bili=channelCard(tree,'bilibili'),text=flatten(bili);
  for(const label of ['B站','无需账号','无需 Cookie','读取评论','公共 BV 链接摘要','宿主搜索未就绪','尚未核验','当前会话可见性：尚未确认','未声明可执行写操作'])assert.ok(text.includes(label),label);
  assert.ok(!text.includes('账号配置：已配置'));assert.equal(findAll(bili,node=>['input','select','textarea'].includes(node.type)).length,0);
  assert.equal(namedButton(bili,'检查连接与权限').props.disabled,false);
  const groups=findAll(tree,node=>node.props['data-channel-account']);assert.deepEqual(groups.map(node=>node.props['data-channel-account']),['x']);
  assert.equal(namedField(groups[0],'auth_token').props.type,'password');assert.equal(namedField(groups[0],'允许公开回复').props.checked,false);
  assert.equal(findAll(channelCard(tree,'x'),node=>node.props['data-channel-account']==='x').length,1);assert.equal(groups[0].type,'div');
  assert.equal(findAll(tree,node=>node.type==='summary'&&flatten(node)==='X 账号设置').length,0);
  assert.deepEqual(ui.requests,[]);
});

test('newly registered providers appear automatically without inheriting X account fields',async()=>{
  const ui=harness(),future={id:'synthetic-provider',name:'示例公共渠道',installed:true,implemented:true,available:true,configured:false,accountRequired:false,connection:{state:'unchecked',scope:'公开摘要'},currentSessionVisible:false,reads:['read'],actions:{bookmark:{supported:true,enabled:false,liveVerified:false}},scope:'仅示例公开数据'};
  ui.server.channels.platforms.push(future);await ui.click('刷新渠道列表');
  const card=channelCard(ui.render(),future.id),text=flatten(card);
  assert.match(text,/示例公共渠道/);assert.match(text,/当前会话可见性：当前不可见/);assert.match(text,/收藏：已支持 · 开关关闭 · 真实操作未验证/);
  assert.equal(findAll(card,node=>['input','select','textarea'].includes(node.type)).length,0);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['channels','GET']]);
});

test('runtime readiness, account configuration, connection scope and session visibility remain distinct',()=>{
  const base=previewData().channels.platforms[0];
  for(const [connection,visible,expected] of [
    [{state:'unchecked',checkedAt:null,scope:'尚未读取身份'},null,'尚未核验'],
    [{state:'verified',checkedAt:123,scope:'仅身份接口'},true,'最近连接核验通过'],
    [{state:'failed',checkedAt:123,scope:'仅身份接口',message:'合成连接失败'},false,'连接失败'],
    [{state:'unavailable',checkedAt:null,scope:'运行依赖缺失'},null,'连接不可用']
  ]){
    const ui=harness({channels:{ok:true,platforms:[{...base,configured:true,available:true,connection,currentSessionVisible:visible}]}}),text=flatten(channelCard(ui.render(),'x'));
    assert.match(text,/适配服务已就绪/);assert.match(text,/账号配置：已配置/);assert.ok(text.includes('连接核验：'+expected));
    assert.ok(text.includes('连接核验范围：'+connection.scope));
    assert.ok(text.includes('当前会话可见性：'+(visible===true?'已确认可见':visible===false?'当前不可见':'尚未确认')));
    assert.match(text,/真实操作未验证/);assert.ok(!text.includes('真实操作已验证'));
  }
});

test('unimplemented directory entries never claim executable reads or actions',()=>{
  const ui=harness({channels:{ok:true,platforms:[{id:'future',name:'未来渠道',installed:false,implemented:false,available:false,configured:false,accountRequired:true,connection:{state:'unavailable'},currentSessionVisible:null,reads:['search','read'],actions:{publish:{supported:true,enabled:true,liveVerified:true}},unavailableReason:'尚未提供适配器'}]}}),text=flatten(channelCard(ui.render(),'future'));
  assert.match(text,/尚未接入/);assert.match(text,/尚未提供适配器/);assert.match(text,/读取能力：渠道尚未接入，不可执行/);assert.match(text,/公开发布：渠道尚未接入，不可执行/);
  assert.ok(!text.includes('已支持'));assert.ok(!text.includes('真实操作已验证'));assert.ok(!text.includes('搜索（'));
});

test('read availability supports booleans and operation metadata without asserting real execution',()=>{
  for(const search of [false,{available:false,currentSessionVisible:null,reason:'宿主公共搜索未加载'}]){
    const bili={...previewData().channels.platforms[1],readAvailability:{search,read:true,comments:{available:true,currentSessionVisible:null}}};
    const ui=harness({channels:{ok:true,platforms:[bili]}}),text=flatten(channelCard(ui.render(),'bilibili'));
    assert.match(text,/搜索（当前不可用）/);assert.match(text,/宿主搜索未就绪/);assert.match(text,/读取单条内容（运行条件就绪）/);assert.match(text,/读取评论（运行条件就绪）/);
    assert.match(text,/读取实测：验证状态未声明/);if(typeof search==='object')assert.match(text,/宿主公共搜索未加载/);
  }
});

test('unsupported action metadata cannot appear as enabled or live verified',()=>{
  const base=previewData().channels.platforms[1],ui=harness({channels:{ok:true,platforms:[{...base,actions:{reply:{supported:false,enabled:true,liveVerified:true},like:{supported:false,enabled:false,liveVerified:false}}}]}}),text=flatten(channelCard(ui.render(),'bilibili'));
  assert.match(text,/公开回复：尚未支持/);assert.match(text,/点赞：尚未支持/);assert.ok(!text.includes('开关已开启'));assert.ok(!text.includes('真实操作已验证'));
});

test('a failed channel refresh preserves cached cards, X credentials state and unsaved account drafts',async()=>{
  const options={failRoute:'channels',error:'渠道目录暂时离线'},ui=harness(options),cached=JSON.stringify(ui.getModel().channels);
  ui.change('AI 账号用户名','synthetic_draft');ui.change('auth_token','synthetic-secret');await ui.click('刷新渠道列表');
  assert.equal(JSON.stringify(ui.getModel().channels),cached);assert.equal(namedField(ui.render(),'AI 账号用户名').props.value,'synthetic_draft');assert.equal(namedField(ui.render(),'auth_token').props.value,'synthetic-secret');
  assert.match(flatten(ui.render()),/渠道目录暂不可用：渠道目录暂时离线/);channelCard(ui.render(),'bilibili');
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['channels','GET']]);
  options.failRoute=null;await ui.click('刷新渠道列表');assert.equal(ui.getModel().channelsError,'');assert.equal(ui.getModel().channelsLoading,false);
});

test('initial channel failure leaves personal records and X account settings usable',async()=>{
  const ui=harness({loaded:false,failRoute:'channels',error:'旧版没有渠道目录接口'});await ui.mount();
  assert.match(flatten(ui.render()),/长期记忆/);assert.match(flatten(ui.render()),/渠道目录暂不可用/);assert.match(flatten(ui.render()),/未确认的渠道不会显示为已接入/);
  assert.equal(ui.getModel().channels,null);assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,false);assert.equal(namedField(ui.render(),'AI 账号用户名').props.disabled,false);
  const fallback=channelCard(ui.render(),'x');assert.match(flatten(fallback.children[0]),/目录未确认/);assert.equal(namedButton(fallback,'检查连接与权限').props.disabled,true);
  assert.ok(!flatten(fallback).includes('接入状态：已实现'));assert.ok(ui.requests.every(row=>row.method==='GET'));
});

test('a slow channel directory does not delay the personal view or its settings',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;}),ui=harness({loaded:false,onChannelsGet:()=>gate});
  await ui.mount();assert.match(flatten(ui.render()),/长期记忆/);assert.equal(namedField(ui.render(),'角色名').props.disabled,false);assert.equal(namedButton(ui.render(),'现在唤醒').props.disabled,false);
  assert.equal(ui.getModel().channels,null);assert.equal(ui.getModel().channelsLoading,true);assert.equal(namedButton(ui.render(),'刷新渠道列表').props.disabled,true);
  finish();await new Promise(resolve=>setImmediate(resolve));channelCard(ui.render(),'bilibili');assert.equal(ui.getModel().channelsLoading,false);ui.unmount();
});

test('polling shares a pending channel read and ignores its result after unmount',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;}),ui=harness({loaded:false,onChannelsGet:()=>gate});
  await ui.mount();await ui.poll();assert.equal(ui.requests.filter(row=>row.route==='channels').length,1);
  ui.unmount();finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.getModel().channels,null);assert.equal(ui.getModel().channelsError,'');
});

test('malformed channel responses retain the last valid directory instead of inventing support',async()=>{
  for(const malformed of [{}, {platforms:{}}, {platforms:[{id:'broken'}]}, {platforms:[{id:'same',name:'甲'},{id:'same',name:'乙'}]}]){
    const ui=harness(),cached=JSON.stringify(ui.getModel().channels);ui.server.channels=malformed;await ui.click('刷新渠道列表');
    assert.equal(JSON.stringify(ui.getModel().channels),cached);assert.match(flatten(ui.render()),/渠道目录返回格式无效/);assert.equal(ui.getModel().channelsLoading,false);
  }
});

test('empty channel catalogs and channel errors do not change account permissions or cause platform calls',async()=>{
  const ui=harness(),before=JSON.stringify(ui.server.remote.config);ui.server.channels={ok:true,platforms:[]};await ui.click('刷新渠道列表');
  assert.match(flatten(ui.render()),/当前没有已注册渠道/);assert.equal(JSON.stringify(ui.server.remote.config),before);assert.equal(ui.getModel().cfg.allowReplies,false);assert.equal(findAll(ui.render(),node=>node.props['data-channel']).length,0);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['channels','GET']]);
});

test('channel error text hides credential assignments and refreshes no personal or platform routes',async()=>{
  const ui=harness({failRoute:'channels',error:'cookie=synthetic-canary authorization=synthetic-other'});await ui.click('刷新渠道列表');
  const text=flatten(ui.render());assert.ok(!text.includes('synthetic-canary'));assert.ok(!text.includes('synthetic-other'));assert.match(text,/凭据已隐藏/);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['channels','GET']]);
});

test('channel summaries stay compact and configuration precedes collapsed diagnostic metadata',()=>{
  const tree=previewTree();
  for(const id of ['x','bilibili']){
    const card=channelCard(tree,id),summary=card.children[0],metadata=findAll(card,node=>node.props['data-channel-status']===id);
    assert.equal(card.type,'details');assert.equal(card.props.open,undefined);assert.equal(summary.type,'summary');
    assert.ok(flatten(summary).length<35);assert.ok(!flatten(summary).includes('接入状态'));
    assert.equal(metadata.length,1);assert.equal(metadata[0].type,'details');assert.equal(metadata[0].props.open,undefined);assert.equal(flatten(metadata[0].children[0]),'详细状态');
    assert.equal(findAll(metadata[0],node=>['input','select','textarea','button'].includes(node.type)).length,0);
    const primary=card.children.filter(child=>child!==metadata[0]);
    assert.ok(flatten(primary).includes('检查连接与权限'));assert.ok(!flatten(primary).includes('当前会话可见性'));
  }
  const x=channelCard(tree,'x');for(const label of ['AI 账号用户名','auth_token','ct0','接入方式','允许公开回复'])namedField(x,label);
  for(const label of ['保存 X 设置','保存 AI Cookie','检查连接与权限'])namedButton(x,label);
});

test('X check refuses unsaved settings or even a partial Cookie and never diagnoses an old account',async()=>{
  for(const edit of [ui=>ui.change('AI 账号用户名','synthetic_next'),ui=>ui.change('auth_token','synthetic-pending-cookie'),ui=>ui.change('允许公开回复',undefined,true)]){
    const ui=harness();edit(ui);const before=JSON.stringify({cfg:ui.getModel().cfg,cookie:ui.getModel().cookie}),card=channelCard(ui.render(),'x'),button=namedButton(card,'检查连接与权限');
    assert.equal(button.props.disabled,true);assert.match(flatten(card),/请先保存 X 设置和已填写的 Cookie/);
    await button.props.onClick();assert.deepEqual(ui.requests,[]);assert.equal(JSON.stringify({cfg:ui.getModel().cfg,cookie:ui.getModel().cookie}),before);
  }
});

test('X checks only the selected saved channel and reports identity separately from configured permissions',async()=>{
  const ui=harness(),config=JSON.stringify(ui.getModel().cfg),policy=JSON.stringify(ui.getModel().policy),bili=JSON.stringify(ui.getModel().channels.platforms[1]);
  ui.change('角色名','尚未保存的合成角色');await ui.checkChannel('x');
  const text=flatten(channelCard(ui.render(),'x'));assert.match(text,/账号身份：已核验 · @synthetic_x/);assert.match(text,/未做写入实测/);assert.match(text,/不等于真实发帖验收/);
  assert.equal(JSON.stringify(ui.getModel().cfg),config);assert.equal(JSON.stringify(ui.getModel().policy),policy);assert.equal(JSON.stringify(ui.getModel().channels.platforms[1]),bili);assert.equal(ui.getModel().profile.name,'尚未保存的合成角色');
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method,row.body]),[['channels/check','POST',{platform:'x'}]]);
  assert.equal(ui.getModel().channelChecking,'');assert.equal(ui.getModel().channelChecks.x.checks.permissions.liveWritesChecked,false);
});

test('Bilibili check uses the shared route without inventing login or writable permissions',async()=>{
  const ui=harness();await ui.checkChannel('bilibili');const card=channelCard(ui.render(),'bilibili'),text=flatten(card);
  assert.match(text,/无需核验个人身份/);assert.match(text,/不核验个人账号或写权限/);assert.match(text,/本版仅匿名只读/);assert.ok(!text.includes('@synthetic_x'));assert.ok(!text.includes('真实操作已验证'));
  assert.equal(findAll(card,node=>['input','select','textarea'].includes(node.type)).length,0);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method,row.body]),[['channels/check','POST',{platform:'bilibili'}]]);
});

test('a failed channel check refreshes failure metadata while preserving every draft and local record',async()=>{
  const base=previewData().channels.platforms,options={channels:{ok:true,platforms:[{...base[0],configured:true,connection:{state:'verified'}},base[1]]},failRoute:'channels/check',error:'cookie=synthetic-secret 检查失败'},ui=harness(options),before=JSON.stringify(ui.server.assistant);
  ui.change('角色名','未保存的角色');ui.change('允许本地文件写入',undefined,true);
  options.onChannelCheck=()=>{ui.server.channels.platforms[0].connection={state:'failed',scope:'仅账号身份接口'};ui.setModel({cfg:{...ui.getModel().cfg,aiUsername:'draft_during_check'},cookie:{auth_token:'synthetic-draft',ct0:''}});};
  await ui.checkChannel('x');const text=flatten(channelCard(ui.render(),'x'));
  assert.match(text,/连接核验：连接失败/);assert.match(text,/检查未完成：/);assert.ok(!text.includes('synthetic-secret'));
  assert.equal(ui.getModel().profile.name,'未保存的角色');assert.equal(ui.getModel().policy.fileWrite,true);assert.equal(ui.getModel().cfg.aiUsername,'draft_during_check');assert.equal(ui.getModel().cookie.auth_token,'synthetic-draft');assert.equal(JSON.stringify(ui.server.assistant),before);
  assert.deepEqual(ui.requests.map(row=>[row.route,row.method]),[['channels/check','POST'],['channels','GET']]);assert.equal(ui.getModel().channelChecking,'');
});

test('saving X settings or Cookie does not automatically check the platform and invalidates the old check result',async()=>{
  const ui=harness();await ui.checkChannel('x');ui.change('AI 账号用户名','synthetic_saved');await ui.click('保存 X 设置');
  assert.equal(ui.getModel().channelChecks.x,null);assert.equal(ui.requests.filter(row=>row.route==='channels/check').length,1);
  ui.change('auth_token','synthetic-auth');ui.change('ct0','synthetic-ct0');assert.equal(namedButton(channelCard(ui.render(),'x'),'检查连接与权限').props.disabled,true);
  await ui.click('保存 AI Cookie');assert.equal(ui.getModel().cookie.auth_token,'');assert.equal(ui.getModel().channelChecks.x,null);assert.equal(ui.requests.filter(row=>row.route==='channels/check').length,1);
  await ui.checkChannel('x');assert.equal(ui.requests.filter(row=>row.route==='channels/check').length,2);assert.ok(!ui.requests.some(row=>['diagnose','assistant/wake','run'].includes(row.route)));
});

test('an active check freezes account changes until its own result arrives',async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;}),ui=harness({onChannelCheck:()=>gate}),pending=ui.checkChannel('x');
  assert.equal(ui.getModel().channelChecking,'x');assert.equal(namedField(ui.render(),'AI 账号用户名').props.disabled,true);assert.equal(namedButton(channelCard(ui.render(),'bilibili'),'检查连接与权限').props.disabled,true);
  const pendingButton=namedButton(channelCard(ui.render(),'x'),'检查中…');assert.equal(pendingButton.props.disabled,true);await pendingButton.props.onClick();assert.equal(ui.requests.filter(row=>row.route==='channels/check').length,1);
  finish();await pending;assert.equal(ui.getModel().channelChecking,'');assert.equal(namedField(ui.render(),'AI 账号用户名').props.disabled,false);
});

test('future channels share one collapsed entry and cannot run an undeclared diagnostic',async()=>{
  const future={id:'future-checkless',name:'未来公共渠道',implemented:true,available:true,accountRequired:false,reads:['read']},ui=harness({channels:{ok:true,platforms:[future]}}),card=channelCard(ui.render(),future.id),button=namedButton(card,'检查连接与权限');
  assert.equal(card.type,'details');assert.equal(card.props.open,undefined);assert.equal(button.props.disabled,true);assert.match(flatten(card),/尚未提供连接检查/);
  assert.equal(findAll(ui.render(),node=>node.props['data-channel-account']).length,0);await button.props.onClick();assert.deepEqual(ui.requests,[]);
});

test('failure to refresh after a failed check labels the old verified result as cached',async()=>{
  const base=previewData().channels.platforms,options={channels:{ok:true,platforms:[{...base[0],configured:true,connection:{state:'verified'}},base[1]]},failRoute:'channels/check',error:'合成检查失败'},ui=harness(options);
  options.onChannelsGet=()=>{throw Error('合成目录离线');};await ui.checkChannel('x');
  const card=channelCard(ui.render(),'x'),text=flatten(card);assert.match(flatten(card.children[0]),/检查未完成/);assert.match(text,/账号身份：本次未能核验/);assert.match(text,/本次检查未完成，上次状态待刷新/);assert.match(text,/上次目录连接状态：最近连接核验通过/);
  assert.ok(!text.includes('连接核验：最近连接核验通过'));assert.equal(ui.getModel().channels.platforms[0].connection.state,'verified');assert.equal(ui.getModel().channelChecking,'');
});
