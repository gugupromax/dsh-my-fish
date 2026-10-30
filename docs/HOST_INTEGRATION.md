# My Fish 宿主集成

已核对 DSH Desktop 0.2.1-rc.3 与0.2.1-rc.5；taskBoard历史基线为0.4.8公开发布源码、0.4.11纯源码契约，当前本机0.4.12的纯状态转换及工具接线也通过隔离验证。计划创建使用共有字段，省略0.4.11起移除的`teamRun`（0.4.8缺省不开启），保留明确只读、关闭goal/历史会话复用及不采纳新卡片默认配置。源码契约/隔离验证不代表实际任务已创建或完成。

2026-10-30在实际rc5可执行文件下重跑全部verify-installed：23工具/6状态JSON、计划26组成功及5组预先拒绝、上下文/陪伴事件、真实Tools守卫、搜索桥接、工作目录、会话元数据与Controller分组均通过；完整Node回归399项通过。rc5公开SessionController.prompt仍接受(request,signal)，内部生成source.kind=user及rpcId后委派给命令层；不能把内部commands.prompt(request,source)误当成公开签名变化。已有程序投递排除规则仍适用。create仍要求workspaceId与cwd互斥，attach仍核对原始header.cwd。

## 主会话

```ts
sessionController.create({sessionId?, workspaceId?, cwd?, agentPreset?})
sessionController.prompt({sessionId, requestId, mode:'queue', content, clientTimeZone?}, signal)
uiWorkspace.openSession(sessionId)
```

create 没有 title，workspaceId 与 cwd 互斥；用宿主返回 ID 并持久保存。prompt 第二参数为 AbortSignal，accepted 仅是接收。打开原会话不投递、不计探索次数。改名不自动 rename 用户会话标题。

0.6.1核实真实SessionController：create({sessionId})只尝试复用空会话，已发生turn/start时会mint另一ID；不能用于恢复或挂组一个已有非空会话。首次创建通过workspaceRegistry解析/注册目录，再传workspaceId，宿主在创建后attachSession；只传cwd不会自动归组。既有主会话只经sessions.get/stat确认后直接续用，必要时单独attach，不再create。

workspaceRegistry.list/get/resolveByPath/create与workspace.attachSession为公开服务。attachSession保持ID但要求realpath(header.cwd)与workspace.path相同；effective cwd变更不能改变这个约束。可信POSTsession/bind允许显式选中组内已有普通会话作为主会话，仅切换插件绑定，不改头、聊天或权限开关。它先检查旧/新main和活跃owned子代空闲、无未知投递，再保存mainSessionBinding并将旧main退役。候选只读live.header或persistence.stat，不读正文。

verify-session-binding直接使用真实安装版Controller/AgentRegistry/WorkspaceRegistry与临时合成日志，证明create反例、实际Scheduler多次打开/续聊只prompt不create、对象重载仍同ID、cold metadata绑定和真正workspaceId首建。它的3次合成prompt都在模型执行前拒绝，模型数为零，不等于真实进程重启或真人长期交互。

## 工作区变更（0.4.1）

可信设置页通过 sessionController.resolveAgent(sessionId) 取回同一会话，返回 {agent} 或 {error}，不新建替代。安装版 agent.runMaintenance(job) 在整个异步迁移期间独占 driver，新的 followup 等待完成；不存在该能力时拒绝有会话的迁移，不能只检查 idle 后冒险复制。

workingDirectory.get(agent.session) 读取实际 cwd，set(agent,existingAbsolutePath,signal) 规范化目录并持久化 working-directory/change。agent/created 已在宿主创建 maintenance 中，只直接 set，不能再次 runMaintenance 或 await whenIdle。

同会话的 immutable header.cwd、项目归属和 SandboxPolicy.workspaceRoot 不变，set 不授予新目录写权限。不能使用危险模式、改会话头或重建聊天来掩盖此限制。安装版 verify-workspace 验证真实维护锁、创建同步、取消、日志重放与原权限保持，模型调用数为零。

## 工具和上下文

tools.register 注册工具；systemPrompt.context(required:true) 每步重读角色/相关记录，仅主会话返回内容。完整预设与 runtime context 抑制下仍保留；卸载清理。普通会话不自动换人设。

公开仓库仅附带通用角色模板。这里的运行时角色和相关记录来自使用者本地工作区，不属于可上传 GitHub 的示例或发行资料；集成测试使用合成内容。

0.4.2基线已校验20个工具；0.5新增social_timeline/social_comments至22个，0.6.0再加assistant_companion共23个。实际SDK工具Schema与6种状态JSON校验见VALIDATION.md；注册不证明当前预设可见或模型实际调用成功。

## 陪伴与实时消息（0.6.0）

ctx.on('session/event',(session,event)=>...,{global:true})观察已提交的未来事件；event为{type,seq,time,data}。user/message的data就是宿主createUserMessage创建的消息，含id/source/content，time为宿主提交时间。只处理当前固定主会话，不调用已弃用的snapshotEvents/eventAt/ownEvents回扫历史。

sessionController.prompt统一设置source={kind:'user',rpcId:requestId}，所以kind不是人类身份保证。所有My Fish程序投递先登记请求ID，并以my-fish-chat/wake固定前缀作补充排除，避免有界索引轮换后仍待消费的内部消息被记成用户态度。捕获文字先检查完整敏感内容再截断；模型只能引用已记录messageId和原文子串。

可信companion/chat通过原sessionController.prompt续聊，持久记录请求指纹、主会话和prepared/queued/unknown状态；unknown不重试。恢复失效主会话时核对companionChatPending的原归属，只中断旧投递，不重发。

Social成功读取回调在主会话生成有范围的资料回执；普通会话、独立计划、检查/写操作、空结果和失败不进入私人兴趣线。新工具权限仅主会话开放。安装版verify-companion使用真实Cordis/SessionStore/createUserMessage与合成事件验证这些契约，模型及网络调用数为零。

## 渠道服务（0.5.0）

myFishChannels提供version:1、register(adapter)和catalog(exec?)，仅通过Cordis服务供受信任插件注册，返回精确注销函数，不提供模型/HTTP注册入口。

B站搜索借宿主web_search，其真实参数为{queries:[string]}。先tools.get('web_search',exec.agent)确认可见，再tools.execute({name,arguments,agent,signal,callId,rootCallId,parent:exec.token})；成功读value，isError必须处理。全局注册不等于当前scope可见，不能伪造parent或直接执行definition.execute。

B站上游插件未注册可复用的bili_search等宿主工具；本版独立借鉴其公开只读API流程，不依赖它的安装、账号、人设或timer。详细契约见CHANNELS.md。

## 会话存在性与恢复（0.4.2）

打开入口通过 sessions.get(id) 检查live身份，否则在 sessionPersistence 服务就绪时调用 stat(id,{signal})。有效元数据为 {header:{id,...},revision:string,...}；严格 undefined 后再次确认live仍无、旧运行agent也已卸载，才允许人工恢复。缺少服务、IO异常、取消、坏响应、归档及普通运行态卸载不能作为删除证据。

安装版 JSONL 对坏header也可能返回undefined，所以结论只能是“没有有效会话记录”，不能证明物理文件已删除。sessionController.resolveAgent 在缺persistence时同样可报not-found，不能单凭error code重建。只检查header metadata，不读取聊天正文。

创建先持久保存请求ID和cwd，未知结果用同一ID探测/重试；成功才替换绑定并将旧未完成本地轮次标中断，保留账号不确定回执/限流和独立资料。原自主跟进开启时暂缓，人工解除只清恢复暂停。旧会话及其残留活跃子代撤权，普通会话保持原权限。

## taskBoard

0.6.5通过agentPresets.register/resolve注册专用dsh-my-fish-plan-native，固定dsh-agent-tool-presentation.mode=native；卡片mode字段指向此预设。不能把standard名称当作native保证。生产自有模块以自身file URL作为Loader插件，仅在计划作用域调用公共tools.restrict隐藏已知全局私有/写工具；全局模式与个人预设不变。预设本地只读FS/web工具和报告保留。

现有普通卡片通过公开update.patch.mode修复后续轮次，已执行的内容冻结不妨碍修改执行目标，但续接/交接、父子调度、复用/goal或权限变化会保护性阻断。现有活跃Agent不会被重新挂载或重放。verify-plan-native使用实际模型组装工具清单及实际Tools执行入口验证通道，补足此前仅校验接口和直接函数的边界。

```ts
taskBoard.snapshot()
taskBoard.apply(requestId, action, initiator?)
```

仅用公开 create/set-schedule/archive 操作 My Fish 标记卡片，固定 read-only、fresh session、不继承卡片默认提权。requestId 和计划 ID 确定性生成；未知结果保留同键重试。

registerExtension 不提供替换 runner 或指定任意主会话，因此计划独立只读执行。报告核对真实 open execution 的 sessionId，不信任模型自行提供的 executionId；只写本地回执/动态，不伪造宿主完成状态。

运行中不重叠。暂停只停未来触发，取消当前运行前须在宿主停止。重启/睡眠错过不补跑。详见 PLANS.md。

## 守卫和子孙

tools.guard 同步单调拒绝，参数冻结，返回精确注销函数。用 agents.list 与 isOwnedBy(childId,ownerAgent) 核对活跃所有权，不信任持久 parentId。个人与计划子孙继承相应限制，其他根会话不受影响。

PTC 内层工具进入 scheduler.prepare，但 run_code 程序可直接 import Node 文件/网络/进程能力，因此默认按机器代码权限拒绝。内层门禁不是整个程序沙箱；只读计划需原生工具模式。

## UI 与语音

sidebar.footer.action 为账号区附近可追加列表槽；settings.section 为设置入口。不覆盖官方单槽 activity。speech Remote catalog 返回 Result，按 ok/value 解包；只读查询不录音或下载。官方听写插入草稿，不提供本版已核实的公开启动录音方法。

## 验证层级

真实安装版 Cordis/SystemPrompt/Tools/AgentRegistry 使用合成 agents、临时记录和空操作工具。taskBoard 纯源码协议和时间计算在隔离目录校验。没有真实 GUI/模型计划、用户脚本或社交发布。
