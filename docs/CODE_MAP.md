# My Fish 代码地图

当前 0.6.3，包和宿主/前端模块 dsh-my-fish。

session-binding.js负责宿主真实分组、元数据候选及显式绑定既有会话；Scheduler有效main只probe/attach，创建用workspaceId与实际returnedID。verify-session-binding.mjs通过真实SessionController/WorkspaceRegistry验证已开始会话不能再用create续聊。

陪伴层：companion-store.js保存连续兴趣、真实读回执与用户原话；companion-tools.js注册主会话工具；companion-evidence.js在Social成功读取边界生成资料证据；companion-context.js追加日常交流/连续探索指引；companion-runtime.js负责可信设置续聊幂等与未来live事件捕获。均不改原profile或权限。

| 文件 | 职责 |
| --- | --- |
| lib/index.js | 22 个工具、可信本机 API、渠道服务与生命周期 |
| lib/client.js | 常驻入口、个人记录、计划/权限、听写状态 |
| lib/store.js | 新旧数据选择、配置、DPAPI 凭据与运行状态 |
| lib/workspace.js | 可信路径设置、宿主 maintenance 排他与同会话目录同步 |
| lib/workspace-migration.js | 路径校验、逐文件迁移、稳定定位、回滚与中断恢复 |
| lib/assistant-store.js | 角色、作息、来源记忆、目标和动态盒 |
| lib/assistant-context.js | 主会话每步重读；普通会话隔离 |
| lib/assistant-tools.js | 记忆、目标、唤醒与本轮结束 |
| lib/scheduler.js | 主会话初始化、手动任务、自主探索；不是通用 cron |
| lib/session-presence.js | 仅live与持久元数据核验，无有效记录/临时错误分离 |
| lib/plans.js | taskBoard 持久计划、幂等管理、运行会话核对和回报 |
| lib/permissions.js | 个人/活跃子孙门禁、只读计划、外发规则 |
| lib/social.js | 统一渠道门面，注册适配器并保留旧调用 |
| lib/channels/registry.js | 渠道目录、能力/动作检查、统一结果与精确注销 |
| lib/channels/x.js | 现有X能力包装，继续使用Engine全部门禁 |
| lib/channels/bilibili.js | 匿名视频资料/评论与宿主搜索桥接，不读上游账号 |
| lib/engine.js | X 身份/证据、开关、额度、去重和不确定回执锁 |
| lib/browser-bridge.js | 独立 Chrome、可见内容与受控 X 动作 |
| lib/browser-data.js | 正文/作者/URL/标识与截断规范化 |
| bridge/ | 可选旧 Twikit 后端，不是默认依赖 |

## 数据

公开角色定义使用 [通用模板](ROLE_TEMPLATE.md)。个人角色、人设和兴趣只作为本地运行设置保存，不能把实际 profile 或其内容复制进源码、夹具和公开文档。

Store 先读宿主目录 my-fish-location.json；未配置时 my-fish 优先/x-whale 原位兼容。迁移成功后原 Store 与 AssistantStore 同步使用新位置，重启仍沿用定位。缺失或无效定位明确报错，不静默创建空账号。my-fish-migration.json 是中断恢复日志，仅保存事务元数据。

- config/credentials/state：账号、加密凭据、固定会话、运行及计划回执。
- assistant/profile/settings：角色与自主作息。
- assistant/memories/goals/inbox：来源记忆、目标和动态。
- assistant/permissions：设置页保存的工具开关及私密词。
- workspace：个人会话运行目录，不是开发目录。
- 旧日记保留复盘，不自动恢复成事实记忆。

taskBoard 自己维护调度/执行账本，My Fish 只调用公开服务；DSH 自己保存会话历史。

## 验证与发行

tests 为本地回归及可用时的安装版纯源码契约；verify-installed 使用合成 Cordis/SDK，不启 GUI 或模型。stage 生成 dist/dsh-my-fish 和 PUBLIC_FILES.json，排除运行数据、依赖、缓存、recovery 与历史包。
