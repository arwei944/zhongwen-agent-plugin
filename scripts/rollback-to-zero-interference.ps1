#!/usr/bin/env pwsh
<#
.SYNOPSIS
  回滚到零干扰模式
.DESCRIPTION
  从升级备份中恢复 chinese-rules.md 和 zhongwen-agent.md，
  回到零干扰模式（可选自检，不做强制要求）。
  
  仅恢复由 upgrade-to-guard.ps1 创建的备份。
#>

param(
    [switch]$DryRun = $false
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host " 回滚到零干扰模式" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$configDir = "$env:USERPROFILE\.config\opencode"

# 查找最新的 guard-upgrade 备份
$backups = Get-ChildItem "$configDir\backups" -Directory -ErrorAction SilentlyContinue | 
    Where-Object { $_.Name -like "guard-upgrade-*" } |
    Sort-Object Name -Descending

if ($backups.Count -eq 0) {
    Write-Host "错误：未找到强制门卫模式的备份" -ForegroundColor Red
    Write-Host ""
    Write-Host "未找到 guard-upgrade-* 备份目录。" -ForegroundColor Yellow
    Write-Host "备份目录位置: $configDir\backups\" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "如果还需要恢复，请手动从 git 恢复零干扰版：" -ForegroundColor Cyan
    Write-Host "  git checkout -- chinese-rules.md" -ForegroundColor White
    Write-Host "  git checkout -- zhongwen-agent.md" -ForegroundColor White
    exit 1
}

$latestBackup = $backups[0]

Write-Host "找到备份: $($latestBackup.Name)" -ForegroundColor Cyan
Write-Host "备份时间: $($latestBackup.CreationTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan

# 列出备份中的文件
$backupFiles = Get-ChildItem -LiteralPath $latestBackup.FullName -Recurse -File
Write-Host "包含文件:"
foreach ($f in $backupFiles) {
    $relPath = $f.FullName.Substring($latestBackup.FullName.Length + 1)
    Write-Host "  - $relPath" -ForegroundColor Gray
}

Write-Host ""

# 确认
$confirm = Read-Host "确定要回滚到零干扰模式吗？(y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "回滚已取消" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "正在恢复..." -ForegroundColor Yellow

if (-not $DryRun) {
    # 恢复 chinese-rules.md
    $backupRules = "$($latestBackup.FullName)\chinese-rules.md"
    if (Test-Path -LiteralPath $backupRules) {
        Copy-Item $backupRules "$configDir\chinese-rules.md" -Force
        Write-Host "  ✓ 已恢复 chinese-rules.md" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 备份中无 chinese-rules.md" -ForegroundColor Yellow
    }

    # 恢复 zhongwen-agent.md
    $backupAgent = "$($latestBackup.FullName)\agents\zhongwen-agent.md"
    if (Test-Path -LiteralPath $backupAgent) {
        Copy-Item $backupAgent "$configDir\agents\zhongwen-agent.md" -Force
        Write-Host "  ✓ 已恢复 zhongwen-agent.md" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 备份中无 agents\zhongwen-agent.md" -ForegroundColor Yellow
    }

    # 验证恢复结果
    $rules = Get-Content "$configDir\chinese-rules.md" -Raw -Encoding UTF8
    $agent = Get-Content "$configDir\agents\zhongwen-agent.md" -Raw -Encoding UTF8
    
    $isZeroInterference = $rules -match "可选自检" -and (-not ($rules -match "强制门卫检查"))
    
    if ($isZeroInterference) {
        Write-Host "  ✓ 验证通过：已回到零干扰模式" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 验证注意：文件内容可能不完全匹配零干扰版" -ForegroundColor Yellow
        Write-Host "    如需完全恢复，请从 git 拉取：git checkout -- chinese-rules.md" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [DryRun] 将恢复备份文件到配置目录" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 回滚完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "请重启 OpenCode 使更改生效" -ForegroundColor Cyan
Write-Host ""
