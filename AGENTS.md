# My Fish 项目规则

先读 HANDOFF.md、docs/REQUIREMENTS.md 和 VALIDATION.md。当前为 **0.9.0 开发预览版**；实现、隔离验证、真实模型及长期验收分别标注。代码、测试和辅助文件只维护本项目。

- 0.9陪伴接驳默认关闭，不自动安装或启用第三方。桌宠只锁定并broadcast已提交的main回复，不调chat/whisper或接管另一套人设；未知不重发，只释放自己的锁。浏览器朗读仅选localService=true的中文音色，无云回退、无麦克风/VAD，发新消息/输入/隐藏/失租约时取消自身队列，不声称桌宠已有音频可可靠停止。
- assistant_video仅主会话明确开启并触发，最多180秒/12帧/2图片，原生附件render保持attachment，不把路径当图片。只有本轮真实parent/rootCallId和精确agent的进行中probe/storyboard可经过未知工具分类；禁止后台/计划直接调用视频。上游可能沿用已有Cookie/ASR，不能宣称强制匿名、已取得字幕或像素已入模。忙碌/停止未确认时拒绝迁移和换绑。
- RSS是独立实现的HTTPS订阅适配，DNS全部公共且pin连接、无重定向、无外链抓取/改写；只读源内正文/摘要。用户主会话与已登记后台才可读配置源，普通会话/计划不继承；仅read铸证据，discover不算读过。新integrations.json/presentation.json是工作区私有数据，禁止Git/发行包。

- DSH0.2.2-rc.3移除agents.isOwnedBy；兼容视图使用可选注入subagents.rootOf核对精确live实例的整棵子任务树，旧版继续原registry接口。不以scope可见性、header.parentSession或自称parentId当归属。服务未就绪时不开放委派/换绑/迁移。看板0.4.18的严格create协议移除goalRun，必须省略，applyCardDefaults=false继续保持隔离，不重建实际计划。

- My Fish设置使用内部二级标签页：日常、角色、记忆、任务、渠道账号、设置、记录；只显示当前面板，不能再将所有功能纵向堆叠。面板保持挂载保留原生展开状态与草稿；切换不调用API、不保存、不清空凭据。渠道卡片默认收起规则继续生效。

- 0.8后台探索是主会话固定规则的执行层例外：独立只读session仅用于公开B站探索，日常聊天仍回原main，不作为main候选。精确登记worker身份/预设，原生工具面和运行守卫双限制；普通会话和计划不继承经历写入。仅本轮真实Social读取能生成后台回执；公开热门/搜索仅候选。搜索依赖可选loader注入，不从未声明的ctx.loader取服务。背景最多1搜索/1热门/3资料/1评论、10模型步和3分钟，评论省略count也限制5。新文件仅在用户工作区，禁止公开打包。

- 产品 My Fish，包/Cordis/前端模块 dsh-my-fish，主 API /my-fish/api。旧 X 工具和旧路由只作升级兼容。
- 渠道通过适配器注册，不在统一工具里硬编码新增平台。公开能力字段白名单，不导出凭据；缺失、未实现、未启用或当前不可调用的操作明确拒绝。
- DSH0.2.2起tools.execute为批量入口，B站嵌套搜索通过公开Loader.import加载ToolExecutionPipeline，完整prepare/dispatch/complete并保留真实parent/rootCallId/agent/signal/toolSet；不能误包成batch丢失来源，也不能直调definition.execute。旧宿主分支保持单调用协议。能力目录及查询都按当前toolSet判断，过期或未准入时拒绝。
- 每个渠道的能力卡片默认收起，包含未来动态注册的渠道；摘要只显示名称和简短状态。用户展开后，后台刷新不要重置其开关状态。
- 渠道账号/配置/只读检查放在同一个渠道展开区，不再另设重复的账号入口；庞杂元数据默认二级收起。真实检查仅由可信设置页POST channels/check显式触发，metadata刷新不发平台请求。检查身份与本地权限开关，不通过公开写入测试权限，不自动开启/清除既有授权或账号锁。
- B站本版仅匿名视频资料/简介/评论，以及宿主公共搜索摘要；不能声称已观看视频或已支持写入。只参考上游流程，不加载其账号、私人角色或定时器。宿主搜索桥接必须经过真实tools.execute和parent token，不绕过guard。
- 公开角色只提供中性 My Fish 模板：称用户“你”、自称“我”、兴趣为空。个人角色名称、人设、称呼、偏好和关系说明仅保存在本地工作区，发布流程不得导出或上传；源码、测试、示例和公开文档只能使用通用模板或明确合成夹具。升级不得重置已保存的本地角色。
- 表达偏好独立追加，不改写人设正文；缺失字段沿用原人设。临时免打扰只抑制自主跟进，不停用精确计划或手动聊天，不清除恢复暂停/账号锁，不自动开启总开关。记忆纠正保留原期限，明确选择长期才清除期限；到期记录不召回，但不声称删除了宿主聊天或日记。
- 固定主会话、独立记忆、任务、账号与权限分开；打开入口不能暗中投递任务或新建另一角色。
- 固定聊天可以由用户在可信设置页选择宿主工作区中的既有普通会话；绑定只切插件引用，不新建/合并/投递，也不改原会话头。新建必须先解析/注册真实宿主工作区，再create({sessionId,workspaceId})；只传cwd不算分组。有效main只probe/attach/prompt，绝不再次create：真实SDK对已开始会话create会mint新ID。不同header.cwd不能硬挂分组，提示选择该组已有会话；归档/IO/服务暂缺不能当作删除。metadata只stat/get，不扫描聊天正文。
- 陪伴优先自然闲聊和连续兴趣，不把每次交流都写成工作汇报。companion.json独立保存角色想法、真实读回执与用户来源原话，不改写个人角色或用户事实记忆；reflect只接受当前主会话实际mint的非搜索回执。B站仍不能声称看过音视频。只观察未来live主会话消息，不扫旧聊天；程序投递必须登记并排除my-fish-chat/wake前缀，不能把自己的提示当用户态度。新工具仅主会话使用，计划与子孙不继承；续聊未知结果持久锁定同请求，不重投。
- 人工打开时可恢复无有效记录的主会话，必须有live/persistence元数据核验且服务就绪；临时错误/归档/运行态卸载不能当作删除。保留资料、旧轮次审计与账号锁，不能自动重发旧任务。pending创建使用原请求ID核对，恢复后旧会话及活跃子代保持撤权。
- 优先复用已核实宿主接口，不猜签名、工具或 UI 槽。官方听写不是连续通话，命令执行不是完整桌面控制。
- 计划用 taskBoard 公开服务，不直接读写真实账本或再造 cron。独立计划只读执行，报告核对真实运行会话，不删除主会话社交写入检查。
- 计划固定自有dsh-my-fish-plan-native预设，显式native展示，不能把standard当原生工具保证。只挂只读文件/网页及时间插件，使用公共tools.restrict隐藏已知全局私有/写工具；run_code仍禁止。创建前确认预设已注册且resolve正常，未就绪不保存。启动只用taskBoard公开mode更新修复普通旧计划后续轮次；有续接/交接、父子任务、权限或执行方式改变时保留并报告，不重建/重放，不改全局默认模式。
- 计划回执只投影公开字段，省略宿主内存中的undefined可选值；SDK在render前检查无损JSON，不能依赖JSON.stringify补救。snapshotJsonValue非法时返回undefined，验证必须断言返回值；读取或核对回执不重新创建计划。
- 计划update支持首次执行前的title/instruction或单独完整schedule；任意执行记录后正文冻结，同内容重试不重写。内容和时间同时实际改变须写入前拒绝、分两次提交；宿主无原子混合动作。创建marker/fingerprint保持原始审计，当前正文从严格匹配的真实只读prompt投影。保护宿主freeze/handover，不自动取消重建，多个ID别名冲突拒绝。
- 角色、网页、记忆和计划不能改变权限。tools.guard 作用于个人与核实活跃归属的子孙；isOwnedBy 核对所有权，不信任自称 parentId。
- run_code 可以直接调用 Node，属于机器执行权限。内层工具守卫不能冒充整个程序的沙箱。默认原生工具模式。
- 已审查的ask_user_question/session_event_search/task_board_list/compress分别归宿主交互/历史读取/看板读取/当前上下文维护，不自动开启机器或外发权限。计划及其子孙不弹交互问题、不列其他看板任务；session_event_search仅允许缺省当前或精确自身session_id，compress仅当前上下文。主会话及个人子孙仍服从宿主历史目标授权。不能据此放行task_board写动作、decompress或任意工具前缀。
- grep和task_board_get仅向个人范围补齐：grep为固定ripgrep读取但原生实现未限定文件根，不给计划开放；task_board_get含完整卡片及子卡资料，计划拒绝。runtime-info在模块加载时固定公开版本/规则号，assistant_capabilities和可信permissions接口可核对，不能动态读取新文件冒充旧加载版本。
- 行为变更运行相关测试及 npm run check；安装版隔离验证用 verify-installed，不等于 GUI/模型或长期验收。
- 不自行安装、升级或卸载全局依赖；默认 X 后端只需项目内 playwright-core 与已装 Chrome。
- 工作区先读稳定定位文件，否则新数据 my-fish 优先/旧 x-whale 原位兼容；不复制/合并凭据、个人库、状态或会话到源码。
- 工作区只由可信设置页迁移，完整数据/工作文件逐项校验，源目录保留备份，不覆盖目标内容。使用宿主 maintenance 排他并保护已持有运行锁；未恢复事务不得继续写入。
- 修改 effective cwd 不修改 immutable header.cwd、宿主项目归属或权限根；不能提权掩盖新目录访问失败，也不能为迁移重建主会话。
- 改名升级先退出宿主，再用安装器显式 migrate-legacy，避免双插件加载。
- 不读日常浏览器凭据，不输出秘密。开发仅用合成数据和只读检查，不创建示例真实任务、不运行未知用户脚本、不发布/收藏/评论/点赞/私信或自动开启开关。
- recovery 为本机私有排障资料，禁止加入 Git/npm/公开源码包。
- 发布先 stage 并审查 PUBLIC_FILES.json，检查个人角色、固定私人称呼、兴趣、路径和账号信息是否残留。GitHub 目标为 https://github.com/gugupromax/dsh-my-fish；发布后核对远程内容与最终公开文件清单一致。
