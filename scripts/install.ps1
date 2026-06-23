#!/usr/bin/env pwsh
<#
.SYNOPSIS
  zhongwen-agent-plugin 一键安装脚本
.DESCRIPTION
  将中文语言检查插件安装到 opencode 全局配置目录
#>

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " zhongwen-agent-plugin 安装程序" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$pluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetDir = "$env:USERPROFILE\.config\opencode"

# 验证 Node.js
Write-Host "[1/5] 验证 Node.js 环境..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "错误：未找到 Node.js，请先安装 Node.js 16+" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js 版本: $(& node --version)" -ForegroundColor Green

# 验证目标目录
Write-Host "[2/5] 验证 opencode 配置目录..." -ForegroundColor Yellow
if (-not (Test-Path -LiteralPath $targetDir)) {
    Write-Host "  创建目录: $targetDir" -ForegroundColor Gray
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}
Write-Host "  目标目录: $targetDir" -ForegroundColor Green

# 复制 MCP 服务器
Write-Host "[3/5] 安装 MCP 语言检查服务器..." -ForegroundColor Yellow
$mcpSource = Join-Path $pluginDir "mcp\check_language.mjs"
$mcpTarget = Join-Path $targetDir "mcp\check_language.mjs"
if (-not (Test-Path -LiteralPath (Split-Path $mcpTarget))) {
    New-Item -ItemType Directory -Path (Split-Path $mcpTarget) -Force | Out-Null
}
if ($DryRun) {
    Write-Host "  [DryRun] 将复制: $mcpSource -> $mcpTarget" -ForegroundColor Gray
} else {
    Copy-Item -LiteralPath $mcpSource -Destination $mcpTarget -Force
    Write-Host "  已复制: check_language.mjs" -ForegroundColor Green
}

# 复制规则文件
Write-Host "[4/5] 安装规则文件..." -ForegroundColor Yellow
$files = @(
    @{Source = Join-Path $pluginDir "chinese-rules.md"; Target = Join-Path $targetDir "chinese-rules.md"},
    @{Source = Join-Path $pluginDir "zhongwen-agent.md"; Target = Join-Path $targetDir "agents\zhongwen-agent.md"}
)

foreach ($f in $files) {
    $targetPath = $f.Target
    $targetFolder = Split-Path $targetPath
    if (-not (Test-Path -LiteralPath $targetFolder)) {
        New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
    }
    if ($DryRun) {
        Write-Host "  [DryRun] 将复制: $($f.Source) -> $($f.Target)" -ForegroundColor Gray
    } else {
        Copy-Item -LiteralPath $f.Source -Destination $f.Target -Force
        Write-Host "  已复制: $(Split-Path $f.Target -Leaf)" -ForegroundColor Green
    }
}

# 更新 opencode.json
Write-Host "[5/5] 配置 opencode.json..." -ForegroundColor Yellow
$configPath = Join-Path $targetDir "opencode.json"
if (-not (Test-Path -LiteralPath $configPath)) {
    Write-Host "  警告：未找到 opencode.json，请手动配置 MCP 服务器" -ForegroundColor Red
} else {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    
    # 添加 MCP 配置
    $mcpConfig = @{
        type = "local"
        command = @("node", $mcpTarget)
        enabled = $true
    } | ConvertTo-Json
    $config.mcp | Add-Member -NotePropertyName "zhongwen-language-checker" -NotePropertyValue ($mcpConfig | ConvertFrom-Json) -Force
    
    # 确保 instructions 包含 chinese-rules.md
    if (-not $config.instructions -or $config.instructions -notcontains "chinese-rules.md") {
        if (-not $config.instructions) {
            $config | Add-Member -NotePropertyName "instructions" -NotePropertyValue @() -Force
        }
        $config.instructions += "chinese-rules.md"
    }
    
    # 确保 default_agent 为 zhongwen-agent
    if ($config.default_agent -ne "zhongwen-agent") {
        $config.default_agent = "zhongwen-agent"
    }
    
    if ($DryRun) {
        Write-Host "  [DryRun] 将更新 opencode.json" -ForegroundColor Gray
    } else {
        $config | ConvertTo-Json -Depth 20 | Set-Content $configPath -Encoding UTF8
        Write-Host "  opencode.json 已更新" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 安装完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1. 关闭 opencode" -ForegroundColor White
Write-Host "  2. 重新打开 opencode" -ForegroundColor White
Write-Host "  3. 开始新会话，插件将自动加载" -ForegroundColor White
Write-Host ""
