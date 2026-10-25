param([string]$Python = 'D:\Program Files\Python314\python.exe', [switch]$UseBundledCA)
$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $Python)) { throw "找不到 Python：$Python；请用 -Python 指定 Python 3.11 或更新版本。" }
$venvPython = Join-Path $pluginRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $Python -m venv (Join-Path $pluginRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw '创建隔离环境失败' }
}
& $venvPython -m pip --version *> $null
if ($LASTEXITCODE -ne 0) {
    & $venvPython -m ensurepip --upgrade --default-pip
    if ($LASTEXITCODE -ne 0) { throw '初始化插件 pip 失败' }
}
$pipArgs = @('-m','pip','--isolated','install','--disable-pip-version-check','--no-input','--timeout','20','--retries','1')
if ($UseBundledCA) { $pipArgs += '--use-deprecated=legacy-certs' }
# pyjsparser is source-only. Keep its build local and use the same CA policy.
& $venvPython @pipArgs 'setuptools==84.2.1' 'wheel==0.48.0'
if ($LASTEXITCODE -ne 0) { throw '插件专用构建依赖安装失败' }
$pipArgs += '--no-build-isolation'
$requirementFile = Join-Path $pluginRoot 'requirements-lock.txt'
if (-not (Test-Path -LiteralPath $requirementFile)) { $requirementFile = Join-Path $pluginRoot 'requirements.txt' }
& $venvPython @pipArgs -r $requirementFile
if ($LASTEXITCODE -ne 0) { throw '插件依赖安装失败；未修改全局 Python 包。' }
& $venvPython -c 'from twikit import Client; print("Twikit 导入通过。请重启 DSH，在 设置 → 个人助理 → 能力与账号 中配置 Cookie 并运行连接体检。")'
if ($LASTEXITCODE -ne 0) { throw 'Twikit 导入失败；请尝试通过 -Python 指定本机 Python 3.11–3.13。' }
