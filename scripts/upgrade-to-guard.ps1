#!/usr/bin/env pwsh
<#
.SYNOPSIS
  升级到强制门卫模式
.DESCRIPTION
  将零干扰模式升级为强制门卫模式。修改 chinese-rules.md 和 zhongwen-agent.md，
  要求 AI 在每次输出前必须调用 check_chinese_purity 工具验证。
  
  升级前会自动备份当前配置，可通过 rollback-to-zero-interference.ps1 一键回滚。
#>

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host " 升级到强制门卫模式" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$pluginDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$configDir = "$env:USERPROFILE\.config\opencode"

# 验证 guard 文件存在
$guardRules = "$pluginDir\chinese-rules-guard.md"
$guardAgent = "$pluginDir\zhongwen-agent-guard.md"

if (-not (Test-Path -LiteralPath $guardRules)) {
    Write-Host "错误：找不到 chinese-rules-guard.md" -ForegroundColor Red
    Write-Host "路径：$guardRules" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $guardAgent)) {
    Write-Host "错误：找不到 zhongwen-agent-guard.md" -ForegroundColor Red
    Write-Host "路径：$guardAgent" -ForegroundColor Red
    exit 1
}

# 备份当前配置
Write-Host "[1/4] 备份当前配置..." -ForegroundColor Yellow
$backupDir = "$configDir\backups\guard-upgrade-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$null = New-Item -ItemType Directory -Path "$backupDir\agents" -Force

Copy-Item "$configDir\chinese-rules.md" "$backupDir\chinese-rules.md" -Force
Copy-Item "$configDir\agents\zhongwen-agent.md" "$backupDir\agents\zhongwen-agent.md" -Force

Write-Host "  备份位置: $backupDir" -ForegroundColor Green

# 应用修改
Write-Host "[2/4] 应用强制门卫条款..." -ForegroundColor Yellow

if (-not $DryRun) {
    Copy-Item $guardRules "$configDir\chinese-rules.md" -Force
    Copy-Item $guardAgent "$configDir\agents\zhongwen-agent.md" -Force
    
    Write-Host "  ✓ chinese-rules.md 已更新为强制门卫版" -ForegroundColor Green
    Write-Host "  ✓ zhongwen-agent.md 已更新为强制门卫版" -ForegroundColor Green
} else {
    Write-Host "  [DryRun] 将复制 guard 文件到配置目录" -ForegroundColor Gray
}

# 验证修改
Write-Host "[3/4] 验证修改..." -ForegroundColor Yellow

$rules = Get-Content "$configDir\chinese-rules.md" -Raw -Encoding UTF8
$agent = Get-Content "$configDir\agents\zhongwen-agent.md" -Raw -Encoding UTF8

$rulesOk = $rules -match "强制门卫检查"
$agentOk = $agent -match "强制门卫协议"

if ($rulesOk -and $agentOk) {
    Write-Host "  ✓ 验证通过" -ForegroundColor Green
} else {
    if (-not $rulesOk) { Write-Host "  ✗ chinese-rules.md 缺少'强制门卫检查'条款" -ForegroundColor Red }
    if (-not $agentOk) { Write-Host "  ✗ zhongwen-agent.md 缺少'强制门卫协议'" -ForegroundColor Red }
    exit 1
}

# 完成
Write-Host "[4/4] 完成" -ForegroundColor Yellow

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 升级完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1. 关闭 OpenCode" -ForegroundColor White
Write-Host "  2. 重新打开 OpenCode" -ForegroundColor White
Write-Host "  3. 开始新会话，验证检查标记是否出现" -ForegroundColor White
Write-Host ""
Write-Host "如需回滚：" -ForegroundColor Yellow
Write-Host "  .\scripts\rollback-to-zero-interference.ps1" -ForegroundColor White
Write-Host ""
