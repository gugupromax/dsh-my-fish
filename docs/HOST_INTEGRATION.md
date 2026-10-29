# My Fish 宿主集成

已核对 DSH Desktop 0.2.1-rc.3、taskBoard 0.4.8 公开发布源码及本机安装的 0.4.11 纯源码契约。计划创建使用两版共有字段，省略 0.4.11 已移除的 `teamRun`（0.4.8 缺省不开启），保留明确只读、关闭 goal/历史会话复用及不采纳新卡片默认配置。源码契约/隔离验证不代表真实 profile 已安装 My Fish 或实际任务已创建。

## 主会话

```ts
sessionController.create({sessionId?, workspaceId?, cwd?, agentPreset?})
sessionController.prompt({sessionId, requestId, mode:'queue', content, clientTimeZone?}, signal)
uiWorkspace.openSession(sessionId)
```

create 没有 title，workspaceId 与 cwd 互斥；用宿主返回 ID 并持久保存。prompt 第二参数为 AbortSignal，accepted 仅是接收。首次入口只初始化；以后打开原会话，不投递、不计探索次数。改名不自动 rename 用户会话标题。

## 工作区变更（0.4.1）

可信设置页通过 sessionController.resolveAgent(sessionId) 取回同一会话，返回 {agent} 或 {error}，不新建替代。安装版 agent.runMaintenance(job) 在整个异步迁移期间独占 driver，新的 followup 等待完成；不存在该能力时拒绝有会话的迁移，不能只检查 idle 后冒险复制。

workingDirectory.get(agent.session) 读取实际 cwd，set(agent,existingAbsolutePath,signal) 规范化目录并持久化 working-directory/change。agent/created 已在宿主创建 maintenance 中，只直接 set，不能再次 runMaintenance 或 await whenIdle。

同会话的 immutable header.cwd、项目归属和 SandboxPolicy.workspaceRoot 不变，set 不授予新目录写权限。不能使用危险模式、改会话头或重建聊天来掩盖此限制。安装版 verify-workspace 验证真实维护锁、创建同步、取消、日志重放与原权限保持，模型调用数为零。

## 工具和上下文

tools.register 注册工具；systemPrompt.context(required:true) 每步重读角色/相关记录，仅主会话返回内容。完整预设与 runtime context 抑制下仍保留；卸载清理。普通会话不自动换人设。

公开仓库仅附带通用角色模板。这里的运行时角色和相关记录来自使用者本地工作区，不属于可上传 GitHub 的示例或发行资料；集成测试使用合成内容。

0.4.2基线已校验20个工具；0.5新增social_timeline/social_comments，最新22工具校验结果见VALIDATION.md。工具是否在当前预设可见、后端是否连接正常分别确认。

## 渠道服务（0.5.0）

myFishChannels提供version:1、register(adapter)和catalog(exec?)，仅通过Cordis服务供受信任插件注册，返回精确注销函数，不提供模型/HTTP注册入口。

B站搜索借宿主web_search，其真实参数为{queries:[string]}。先tools.get('web_search',exec.agent)确认可见，再tools.execute({name,arguments,agent,signal,callId,rootCallId,parent:exec.token})；成功读value，isError必须处理。全局注册不等于当前scope可见，不能伪造parent或直接执行definition.execute。

B站上游插件未注册可复用的bili_search等宿主工具；本版独立借鉴其公开只读API流程，不依赖它的安装、账号、人设或timer。详细契约见CHANNELS.md。

## 会话存在性与恢复（0.4.2）

打开入口通过 sessions.get(id) 检查live身份，否则在 sessionPersistence 服务就绪时调用 stat(id,{signal})。有效元数据为 {header:{id,...},revision:string,...}；严格 undefined 后再次确认live仍无、旧运行agent也已卸载，才允许人工恢复。缺少服务、IO异常、取消、坏响应、归档及普通运行态卸载不能作为删除证据。

安装版 JSONL 对坏header也可能返回undefined，所以结论只能是“没有有效会话记录”，不能证明物理文件已删除。sessionController.resolveAgent 在缺persistence时同样可报not-found，不能单凭error code重建。只检查header metadata，不读取聊天正文。

创建先持久保存请求ID和cwd，未知结果用同一ID探测/重试；成功才替换绑定并将旧未完成本地轮次标中断，保留账号不确定回执/限流和独立资料。原自主跟进开启时暂缓，人工解除只清恢复暂停。旧会话及其残留活跃子代撤权，普通会话保持原权限。

## taskBoard

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
