# My Fish 改名与安装迁移

0.4.0 的产品名称为 **My Fish**，npm 包和 DSH 模块标识为 `dsh-my-fish`。X 仍是一项可选平台能力，X 适配器及旧 `x_whale_*` 工具名保留兼容，不能据此把其他平台视为已支持。

## 用户数据原位兼容

公开版本使用 [通用角色模板](ROLE_TEMPLATE.md)。已经保存的个人角色、人设、称呼和兴趣保持本地原值，升级不覆盖，也不导出到公开源码包。

0.4.1 起先读取 `<DSH_HOME>/my-fish-location.json` 自定义定位；迁移成功后已运行实例和重启均使用该位置。未配置定位时选择：

1. `<DSH_HOME>/my-fish` 已存在时使用新目录。
2. 新目录不存在，而 `<DSH_HOME>/x-whale` 存在时，继续使用旧目录。
3. 两者均不存在时，新数据写入 `<DSH_HOME>/my-fish`。

未设置 DSH_HOME 时，宿主目录为当前用户的 `.dsh`。安装改名本身不复制或合并数据；如需搬迁，在设置中保存新的空工作区，自动逐项核验迁移，同一台电脑/Windows 用户的加密凭据原字节保留，主会话不重建。新旧默认目录都存在且没有定位时新目录优先。具体步骤、备份及权限限制见 [工作区迁移](WORKSPACE.md)。

## 安装前审阅

在项目目录运行。下面的 dry run 不安装依赖、不改变 profile，只读取目标 profile 的插件依赖清单并输出步骤：

```powershell
node scripts/install-local.mjs --profile desktop --dry-run --migrate-legacy
```

首次安装或无旧插件时不需要 `--migrate-legacy`。可用 `--app` 指定 DSH 应用路径，用 `--home` 指定 DSH 数据根目录；自定义根目录必须与实际启动宿主使用的 DSH_HOME 一致。

退出 DSH 后执行安装：

```powershell
node scripts/install-local.mjs --profile desktop --migrate-legacy
```

安装器先准备项目本地依赖，随后通过宿主公开 CLI 在同一 profile 移除 `dsh-x-whale` 并添加 `link:<当前目录>`。旧版存在但未明确提供迁移参数时拒绝安装，防止两个插件同时唤醒同一主会话。安装器不能替用户确认宿主已经退出；迁移前须自行关闭全部 DSH 窗口和进程。

依赖准备失败不会移除旧插件。旧依赖移除后若新安装失败，保持 DSH 关闭，修复错误后重新运行安装器。旧 link 可能已经指向改名后的同一源码，因此不承诺自动恢复旧版实现；运行数据保持原位。恢复旧版需要另有可信的旧源码副本，并使用宿主 CLI 安装它，不能把改名后的目录冒充旧版。

只准备项目依赖可用 `--prepare-only`，它不修改 profile。PowerShell 包装入口 `scripts/install-local.ps1` 调用同一 Node 安装器；默认浏览器模式不再自动创建 Python 环境。

## 发行前检查

```powershell
npm run check
node scripts/verify-installed.mjs
npm run stage
```

`dist/dsh-my-fish` 只由明确允许的源码、通用模板、合成测试、文档和安装脚本生成；每次替换旧 staging 目录，避免旧文件残留。私人角色、人设、固定私人兴趣、运行环境、Cookie、profile、个人数据库、recovery、截图、日志和旧发行包不在发行包内。`PUBLIC_FILES.json` 提供可审阅文件清单。Git 忽略规则排除运行数据；上传 GitHub 前仍须检查最终待提交内容，尤其是手工新增文档。生成发行目录不等于已经创建或发布远程仓库。

实际宿主 SDK 校验使用临时独立 DSH_HOME，不读取当前账号、个人记忆或任务账本。通过此校验不代表已在实际 profile 安装升级，也不代表新语音、任务或平台动作已经真实运行验收。
