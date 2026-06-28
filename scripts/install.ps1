#!/usr/bin/env pwsh
<#
.SYNOPSIS
  zhongwen-agent-plugin 一键安装脚本（支持动态版本化名称）
.DESCRIPTION
  将中文语言检查插件安装到 opencode 全局配置目录。
  自动从 zhongwen-agent.md 读取版本号，生成带版本后缀的 MCP 名称和 Agent 名称。
#>

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " zhongwen-agent-plugin 安装程序 v4.5.0" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$pluginDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$targetDir = "$env:USERPROFILE\.config\opencode"

# 动态检测版本号
Write-Host "[0/6] 检测版本号..." -ForegroundColor Yellow
$agentSource = Join-Path $pluginDir "zhongwen-agent.md"
$version = "4.2.0"  # 默认版本
if (Test-Path $agentSource) {
    $agentContent = Get-Content $agentSource -Raw -Encoding UTF8
    if ($agentContent -match 'version:\s*"([^"]+)"') {
        $version = $matches[1]
    }
}
$agentName = "zhongwen-agent-$version"
$mcpName = "zhongwen-language-checker-$version"
Write-Host "  检测到版本: $version" -ForegroundColor Green
Write-Host "  Agent 名称: $agentName" -ForegroundColor Green
Write-Host "  MCP 名称: $mcpName" -ForegroundColor Green
Write-Host ""

# 验证 Node.js
Write-Host "[1/6] 验证 Node.js 环境..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "错误：未找到 Node.js，请先安装 Node.js 16+" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js 版本: $(& node --version)" -ForegroundColor Green

# 验证目标目录
Write-Host "[2/6] 验证 opencode 配置目录..." -ForegroundColor Yellow
if (-not (Test-Path -LiteralPath $targetDir)) {
    Write-Host "  创建目录: $targetDir" -ForegroundColor Gray
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}
Write-Host "  目标目录: $targetDir" -ForegroundColor Green

# 复制 MCP 服务器
Write-Host "[3/6] 安装 MCP 语言检查服务器..." -ForegroundColor Yellow
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
Write-Host "[4/6] 安装规则文件..." -ForegroundColor Yellow
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

# 更新 opencode 配置（支持 json 和 jsonc）
Write-Host "[5/6] 配置 opencode..." -ForegroundColor Yellow
$configPathJson = Join-Path $targetDir "opencode.json"
$configPathJsonc = Join-Path $targetDir "opencode.jsonc"
$configPath = if (Test-Path $configPathJsonc) { $configPathJsonc } elseif (Test-Path $configPathJson) { $configPathJson } else { $null }

if (-not $configPath) {
    Write-Host "  警告：未找到 opencode.json 或 opencode.jsonc，请手动配置 MCP 服务器" -ForegroundColor Red
} else {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    
    # 移除旧版本的 MCP 配置（不带版本后缀的）
    $oldMcps = $config.mcp.PSObject.Properties | Where-Object { $_.Name -match "^zhongwen-(language-checker|version-manager)$" }
    foreach ($old in $oldMcps) {
        $config.mcp.PSObject.Properties.Remove($old.Name)
    }
    
    # 添加新版本 MCP 配置（带版本后缀）
    $mcpConfig = @{
        type = "local"
        command = @("node", $mcpTarget)
        enabled = $true
    } | ConvertTo-Json
    $config.mcp | Add-Member -NotePropertyName $mcpName -NotePropertyValue ($mcpConfig | ConvertFrom-Json) -Force
    
    # 确保 instructions 包含 chinese-rules.md
    if (-not $config.instructions -or $config.instructions -notcontains "chinese-rules.md") {
        if (-not $config.instructions) {
            $config | Add-Member -NotePropertyName "instructions" -NotePropertyValue @() -Force
        }
        $config.instructions += "chinese-rules.md"
    }
    
    # 更新 default_agent 为带版本的名字
    if ($config.default_agent -ne $agentName) {
        $config.default_agent = $agentName
    }
    
    if ($DryRun) {
        Write-Host "  [DryRun] 将更新 $configPath" -ForegroundColor Gray
    } else {
        $config | ConvertTo-Json -Depth 20 | Set-Content $configPath -Encoding UTF8
        Write-Host "  $([System.IO.Path]::GetFileName($configPath)) 已更新" -ForegroundColor Green
    }
}

# 清理旧版本管理 MCP（如果存在）
Write-Host "[6/6] 清理旧配置..." -ForegroundColor Yellow
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $removed = $false
    foreach ($prop in $config.mcp.PSObject.Properties) {
        if ($prop.Name -match "^zhongwen-version-manager") {
            $config.mcp.PSObject.Properties.Remove($prop.Name)
            $removed = $true
            Write-Host "  已移除旧版本: $($prop.Name)" -ForegroundColor Yellow
        }
    }
    if ($removed) {
        $config | ConvertTo-Json -Depth 20 | Set-Content $configPath -Encoding UTF8
        Write-Host "  配置已清理" -ForegroundColor Green
    } else {
        Write-Host "  无需清理" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 安装完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "配置摘要：" -ForegroundColor Cyan
Write-Host "  版本: $version" -ForegroundColor White
Write-Host "  Agent: $agentName" -ForegroundColor White
Write-Host "  MCP: $mcpName" -ForegroundColor White
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1. 关闭 opencode" -ForegroundColor White
Write-Host "  2. 重新打开 opencode" -ForegroundColor White
Write-Host "  3. 开始新会话，插件将自动加载" -ForegroundColor White
Write-Host ""
