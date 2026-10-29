# 渠道适配与扩展

My Fish 0.5.0 将个人助理与渠道实现分开。角色、记忆和计划保持独立；统一入口按照注册的适配器分发，不再在每个工具里判断是不是 X。

## 当前支持范围

| 渠道 | 查询 | 账号需求 | 写操作 |
| --- | --- | --- | --- |
| X | 搜索、可见正文、浏览器时间线 | 沿用现有本地账号配置 | 原收藏/回复/公开 @ 门禁保留，默认关闭且未做公开写入验收 |
| 哔哩哔哩 | 公共搜索摘要、公开视频元信息/简介、有限分页评论 | 本版匿名读取，不需要 Cookie | 本版不支持收藏、点赞、评论发布、私信或公开 @ |

B 站搜索借当前会话可见的宿主 web_search，限定并过滤规范视频链接；它不是 B 站站内完整搜索。视频资料和评论不等于观看视频、听取音频、读取字幕或完整评论区。遇到平台验证、限流或拒绝时停止，不尝试处理验证或切换账号。

其他渠道只有注册了实际适配器才可用。界面分别展示实现、基础运行能力、账号需求、连接检查与操作范围；“已实现”不能代替“当前会话可见”或“真实请求成功”。

## 统一工具

- social_status：当前渠道目录和能力，不发起平台连接请求。
- social_search：platform、query、可选 count。
- social_read：platform、reference；X 接受帖子 ID/规范链接，B 站接受 BV 号/规范视频链接。
- social_timeline：读取明确支持的信息流，目前为 X 浏览器后端。
- social_comments：读取明确支持的评论，目前为 B 站；reference、可选 count/page/sort。
- social_action：仅主会话可执行。先检查对应动作 supported 与 enabled，再进入适配器自身账号、证据、额度与回执门禁。未支持或未启用的动作不发起请求。

原 x_whale 工具和旧路由继续兼容。已有 X 配置、账号开关和配额不迁移到其他渠道，也不会因为注册新渠道而开启写入。

## 适配器契约

适配器提供 id、name、同步 capabilities(exec?)，以及其明确支持的方法：search/read/timeline/comments/action。方法收到已剔除 platform 的参数、AbortSignal 和原始工具执行上下文。每个适配器自行负责账号、网络限制、内容读取边界和动作回执。

capabilities 公开字段包括 implemented/installed/available/configured、accountRequired、connection、reads、readAvailability 和 actions。没有执行上下文时 currentSessionVisible 应为 null；不得把全局工具注册当成当前会话可见。能力目录不得包含凭据、私密配置或角色资料。

统一结果保留原始适配器的 data/source 等公开结果，追加 platform/scope/items。items 用于跨渠道展示来源和读取范围，不应将其当作完整原始内容或已核验事实。

## 在独立宿主插件中注册

宿主服务名为 myFishChannels，version 为 1。仅受信任的插件代码可以注册适配器，不提供模型工具或 HTTP 注册入口。

```js
ctx.inject(['myFishChannels'], child => {
  child.effect(() => child.myFishChannels.register(myAdapter));
});
```

register 返回注销函数，应随注册插件的生命周期清理。重复 ID、无效声明、未实现的方法或未启用的动作会被拒绝，不能通过注册覆盖 X 的门禁。新增渠道无需修改模型工具的分发条件或把账号资料塞进角色。

## 宿主工具桥接

B 站搜索通过 tools.get(name, exec.agent) 检查可见性，再由 tools.execute 传入原 agent、signal、真实 parent token 与唯一子调用标识。它经过宿主正常守卫和执行链，不直接调用 definition.execute。缺少搜索服务、预设隐藏工具或返回失败时，应说明不可用，不能给出伪造结果。

## 借鉴与隐私

B 站流程参考 dsh-bili-whale 的公开视频与评论命令，出处及 MIT 说明见 [第三方声明](../THIRD_PARTY_NOTICES.md)。没有加载其整包插件、读取其账号文件、复制其人设或启动它的定时器。个人设定仍只保存在本机工作区；公开仓库只提供通用模板。
