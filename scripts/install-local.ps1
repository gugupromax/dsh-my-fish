param(
    [string]$Node = 'node',
    [string]$Profile = 'desktop',
    [string]$App = '',
    [string]$DshHome = '',
    [switch]$DryRun,
    [switch]$MigrateLegacy,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$installerArgs = @((Join-Path $PSScriptRoot 'install-local.mjs'), '--profile', $Profile)
if ($App) { $installerArgs += @('--app', $App) }
if ($DshHome) { $installerArgs += @('--home', $DshHome) }
if ($DryRun) { $installerArgs += '--dry-run' }
if ($MigrateLegacy) { $installerArgs += '--migrate-legacy' }
if ($PrepareOnly) { $installerArgs += '--prepare-only' }
& $Node @installerArgs
if ($LASTEXITCODE -ne 0) { throw 'My Fish 安装未成功，请保留上面的错误信息。' }
