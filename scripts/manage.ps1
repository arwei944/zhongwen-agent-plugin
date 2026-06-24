#!/usr/bin/env pwsh
<#
.SYNOPSIS
  zhongwen-agent-plugin 版本管理命令
.DESCRIPTION
  支持：rollback（回滚）、upgrade（升级）、status（状态）、snapshot（快照）、history（历史）
  
  使用方式：
    .\scripts\manage.ps1 status          # 查看当前状态
    .\scripts\manage.ps1 snapshot        # 手动创建快照
    .\scripts\manage.ps1 rollback        # 回滚到上一个版本
    .\scripts\manage.ps1 upgrade         # 从 GitHub 升级到最新版本
    .\scripts\manage.ps1 history         # 查看版本历史
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'snapshot', 'rollback', 'upgrade', 'history')]
    [string]$Command = 'status',

    [Parameter()]
    [string]$TargetVersion = ''  # rollback 到指定版本
)

# ============================================================
# 配置
# ============================================================

$PluginDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ConfigDir = "$env:USERPROFILE\.config\opencode"
$VersionsDir = "$ConfigDir\versions"
$ManifestPath = "$VersionsDir\manifest.json"
$LogPath = "$ConfigDir\logs\manage.log"
$GitHubRepo = "https://github.com/arwei944/zhongwen-agent-plugin.git"

# 核心文件清单（需要版本管理的文件）
$ManagedFiles = @(
    @{ Source = "zhongwen-agent.md"; RelPath = "agents\zhongwen-agent.md" },
    @{ Source = "chinese-rules.md"; RelPath = "chinese-rules.md" },
    @{ Source = "mcp\check_language.mjs"; RelPath = "mcp\check_language.mjs" }
)

# ============================================================
# 辅助函数
# ============================================================

function Write-Log {
    param([string]$Message, [string]$Color = 'White')
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
    $logEntry = "[$timestamp] $Message"
    $null = New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force -ErrorAction SilentlyContinue
    Add-Content -LiteralPath $LogPath -Value $logEntry -Encoding UTF8
}

function Confirm-Action {
    param([string]$Prompt)
    Write-Host $Prompt -ForegroundColor Yellow -NoNewline
    $response = Read-Host " (y/N)"
    return $response -eq 'y' -or $response -eq 'Y'
}

# ============================================================
# 状态命令
# ============================================================

function Show-Status {
    Write-Host ""
    Write-Host "╔════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║   zhongwen-agent-plugin 状态报告   ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # 版本信息
    if (Test-Path -LiteralPath $ManifestPath) {
        $manifest = Get-Content $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "当前版本: " -NoNewline
        Write-Host $manifest.current_version -ForegroundColor Green
        Write-Host "最后更新: " -NoNewline
        Write-Host $manifest.last_updated -ForegroundColor Green
        Write-Host "可用版本: " -NoNewline
        $versions = $manifest.versions | ForEach-Object { $_.version }
        Write-Host ($versions -join ', ') -ForegroundColor Green
    } else {
        Write-Host "当前版本: " -NoNewline
        Write-Host "未初始化" -ForegroundColor Yellow
    }

    Write-Host ""

    # 文件部署状态
    Write-Host "文件部署状态：" -ForegroundColor Cyan
    foreach ($file in $ManagedFiles) {
        $targetPath = "$ConfigDir\$($file.RelPath)"
        $gitPath = "$PluginDir\$($file.Source)"
        $targetExists = Test-Path -LiteralPath $targetPath
        $gitExists = Test-Path -LiteralPath $gitPath
        
        if ($targetExists) {
            $targetItem = Get-Item -LiteralPath $targetPath
            $targetSize = $targetItem.Length
            $targetTime = $targetItem.LastWriteTime.ToString('MM-dd HH:mm')
            
            if ($gitExists) {
                $gitItem = Get-Item -LiteralPath $gitPath
                $matchStatus = if ($targetItem.LastWriteTime -eq $gitItem.LastWriteTime -and $targetSize -eq $gitItem.Length) {
                    "✓ 一致"
                } else {
                    "⚠ 不同"
                }
                $matchColor = if ($targetItem.LastWriteTime -eq $gitItem.LastWriteTime -and $targetSize -eq $gitItem.Length) { "Green" } else { "Yellow" }
            } else {
                $matchStatus = "? 源文件缺失"
                $matchColor = "Red"
            }
            
            Write-Host "  $($file.RelPath)  $targetSize 字节  $targetTime  " -NoNewline
            Write-Host "$matchStatus" -ForegroundColor $matchColor
        } else {
            Write-Host "  $($file.RelPath)  " -NoNewline
            Write-Host "✗ 未部署" -ForegroundColor Red
        }
    }

    # 配置状态
    Write-Host ""
    Write-Host "MCP 服务器状态：" -ForegroundColor Cyan
    $configPath = "$ConfigDir\opencode.json"
    if (Test-Path -LiteralPath $configPath) {
        $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.mcp.'zhongwen-language-checker') {
            $mcp = $config.mcp.'zhongwen-language-checker'
            Write-Host "  名称: zhongwen-language-checker" -ForegroundColor Green
            Write-Host "  类型: $($mcp.type)" -ForegroundColor Green
            Write-Host "  启用: $($mcp.enabled)" -ForegroundColor Green
        } else {
            Write-Host "  未配置 MCP 服务器" -ForegroundColor Yellow
        }
        Write-Host "  默认 Agent: $($config.default_agent)" -ForegroundColor Green
    }

    # 统计信息
    Write-Host ""
    Write-Host "统计信息：" -ForegroundColor Cyan
    $snapshotCount = 0
    if (Test-Path -LiteralPath $VersionsDir) {
        $snapshotCount = (Get-ChildItem -LiteralPath $VersionsDir -Directory -ErrorAction SilentlyContinue).Count
    }
    Write-Host "  版本快照数: $snapshotCount" -ForegroundColor Green
    Write-Host "  仓库位置: $PluginDir" -ForegroundColor Green
}

# ============================================================
# 快照命令
# ============================================================

function New-Snapshot {
    param([string]$VersionName)

    if ([string]::IsNullOrEmpty($VersionName)) {
        $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $VersionName = "snapshot-$timestamp"
    }

    Write-Log "正在创建快照: $VersionName" -Color Cyan

    # 创建版本目录
    $snapshotDir = "$VersionsDir\$VersionName"
    $null = New-Item -ItemType Directory -Path $snapshotDir -Force

    # 复制受管理的文件
    $snapshotFiles = @()
    foreach ($file in $ManagedFiles) {
        $sourcePath = "$ConfigDir\$($file.RelPath)"
        $targetPath = "$snapshotDir\$($file.RelPath)"
        
        if (Test-Path -LiteralPath $sourcePath) {
            $null = New-Item -ItemType Directory -Path (Split-Path $targetPath) -Force
            Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
            $item = Get-Item -LiteralPath $sourcePath
            $snapshotFiles += @{
                path = $file.RelPath
                size = $item.Length
                modified = $item.LastWriteTime.ToString('o')
            }
            Write-Log "  已备份: $($file.RelPath)" -Color Green
        } else {
            Write-Log "  跳过: $($file.RelPath)（文件不存在）" -Color Yellow
        }
    }

    # 备份 opencode.json（仅相关部分）
    $configPath = "$ConfigDir\opencode.json"
    if (Test-Path -LiteralPath $configPath) {
        Copy-Item -LiteralPath $configPath -Destination "$snapshotDir\opencode.json" -Force
        Write-Log "  已备份: opencode.json" -Color Green
    }

    # 更新 manifest
    $manifest = @{
        current_version = $VersionName
        last_updated = (Get-Date).ToString('o')
        versions = @(
            @{
                version = $VersionName
                timestamp = (Get-Date).ToString('o')
                type = 'snapshot'
                files = $snapshotFiles
            }
        )
    }

    # 如果已存在 manifest，合并版本历史
    if (Test-Path -LiteralPath $ManifestPath) {
        $existing = Get-Content $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $existingVersions = @($existing.versions)
        $existingVersions += @{
            version = $VersionName
            timestamp = (Get-Date).ToString('o')
            type = 'snapshot'
            files = $snapshotFiles
        }
        $manifest.versions = $existingVersions
    }

    # 写入 manifest
    $manifest | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath -Encoding UTF8
    Write-Log "快照已创建: $VersionName" -Color Green
    Write-Log "位置: $snapshotDir" -Color Green

    return $VersionName
}

# ============================================================
# 回滚命令
# ============================================================

function Invoke-Rollback {
    param([string]$Version = '')

    Write-Host ""
    Write-Host "╔════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "║           一键回滚                  ║" -ForegroundColor Yellow
    Write-Host "╚════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""

    # 读取 manifest
    if (-not (Test-Path -LiteralPath $ManifestPath)) {
        Write-Log "错误：没有找到版本记录，无法回滚" -Color Red
        return
    }

    $manifest = Get-Content $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $versions = @($manifest.versions)

    if ($versions.Count -lt 2 -and [string]::IsNullOrEmpty($Version)) {
        Write-Log "错误：只有一个版本记录，无法回滚。使用 -TargetVersion 指定目标版本" -Color Red
        Write-Log "可用版本: $($versions.version -join ', ')" -Color Yellow
        return
    }

    # 确定目标版本
    if ([string]::IsNullOrEmpty($Version)) {
        # 默认回滚到上一个版本
        $currentIndex = -1
        for ($i = 0; $i -lt $versions.Count; $i++) {
            if ($versions[$i].version -eq $manifest.current_version) {
                $currentIndex = $i
                break
            }
        }
        if ($currentIndex -le 0) {
            Write-Log "错误：没有更早的版本可以回滚" -Color Red
            return
        }
        $targetVersion = $versions[$currentIndex - 1].version
    } else {
        $targetVersion = $Version
        # 验证目标版本存在
        $found = $false
        foreach ($v in $versions) {
            if ($v.version -eq $targetVersion) { $found = $true; break }
        }
        if (-not $found) {
            Write-Log "错误：版本 '$targetVersion' 不存在" -Color Red
            return
        }
    }

    $currentVersion = $manifest.current_version
    $targetDir = "$VersionsDir\$targetVersion"

    if (-not (Test-Path -LiteralPath $targetDir)) {
        Write-Log "错误：版本目录不存在: $targetDir" -Color Red
        return
    }

    # 确认
    Write-Log "当前版本: $currentVersion" -Color Cyan
    Write-Log "目标版本: $targetVersion" -Color Cyan
    Write-Host ""
    
    if (-not (Confirm-Action "确定要回滚到 $targetVersion 吗？")) {
        Write-Log "回滚已取消" -Color Yellow
        return
    }

    Write-Host ""

    # 先创建当前版本的快照（以防需要再次回滚）
    $backupVersion = "pre-rollback-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Log "正在备份当前状态到 $backupVersion ..." -Color Cyan
    New-Snapshot -VersionName $backupVersion | Out-Null

    # 执行回滚
    Write-Log "正在回滚到 $targetVersion ..." -Color Cyan
    $successCount = 0
    $failCount = 0

    foreach ($file in $ManagedFiles) {
        $snapshotFile = "$targetDir\$($file.RelPath)"
        $targetFile = "$ConfigDir\$($file.RelPath)"

        if (Test-Path -LiteralPath $snapshotFile) {
            $null = New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force -ErrorAction SilentlyContinue
            Copy-Item -LiteralPath $snapshotFile -Destination $targetFile -Force
            Write-Log "  ✓ 已恢复: $($file.RelPath)" -Color Green
            $successCount++
        } else {
            Write-Log "  ⚠ 快照中不存在: $($file.RelPath)" -Color Yellow
            $failCount++
        }
    }

    # 恢复 opencode.json
    $snapshotConfig = "$targetDir\opencode.json"
    $configFile = "$ConfigDir\opencode.json"
    if (Test-Path -LiteralPath $snapshotConfig) {
        Copy-Item -LiteralPath $snapshotConfig -Destination $configFile -Force
        Write-Log "  ✓ 已恢复: opencode.json" -Color Green
        $successCount++
    }

    # 更新 manifest 中的当前版本
    $manifest.current_version = $targetVersion
    $manifest.last_updated = (Get-Date).ToString('o')
    $manifest | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath -Encoding UTF8

    Write-Host ""
    Write-Log "回滚完成！" -Color Green
    Write-Log "成功恢复 $successCount 个文件" -Color Green
    if ($failCount -gt 0) {
        Write-Log "$failCount 个文件未找到" -Color Yellow
    }
    Write-Log "当前版本: $targetVersion" -Color Cyan
    Write-Host ""
    Write-Host "建议：重启 opencode 使更改生效" -ForegroundColor Cyan
}

# ============================================================
# 升级命令
# ============================================================

function Invoke-Upgrade {
    Write-Host ""
    Write-Host "╔════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║           一键升级                  ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # 检查 git 是否可用
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Log "错误：未找到 git 命令" -Color Red
        return
    }

    # 检查插件目录是否是 git 仓库
    if (-not (Test-Path "$PluginDir\.git")) {
        Write-Log "错误：插件目录不是 git 仓库" -Color Red
        Write-Log "请先运行: git clone $GitHubRepo" -Color Yellow
        return
    }

    # 确认
    Write-Log "将从 GitHub 拉取最新代码并安装" -Color Cyan
    if (-not (Confirm-Action "确定要升级到最新版本吗？")) {
        Write-Log "升级已取消" -Color Yellow
        return
    }

    Write-Host ""

    # 先创建当前版本的快照
    Write-Log "正在备份当前状态..." -Color Cyan
    $backupVersion = "pre-upgrade-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    New-Snapshot -VersionName $backupVersion | Out-Null

    # 拉取最新代码
    Write-Log "正在从 GitHub 拉取最新代码..." -Color Cyan
    Push-Location $PluginDir
    try {
        $pullResult = git pull origin master 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "代码拉取成功" -Color Green

            # 检查是否有新标签
            git fetch --tags 2>&1 | Out-Null
            $latestTag = git tag -l | Select-Object -Last 1
            if ($latestTag) {
                Write-Log "最新标签: $latestTag" -Color Green
            }

            # 显示更新内容
            $logResult = git log --oneline -5 origin/master 2>&1
            Write-Host "最近的提交：" -ForegroundColor Cyan
            $logResult | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

        } else {
            Write-Log "代码拉取失败: $pullResult" -Color Red
            return
        }
    } finally {
        Pop-Location
    }

    # 安装新版本的文件到配置目录
    Write-Log "正在安装新版本..." -Color Cyan
    $installCount = 0
    $errorCount = 0

    foreach ($file in $ManagedFiles) {
        $sourceFile = "$PluginDir\$($file.Source)"
        $targetFile = "$ConfigDir\$($file.RelPath)"

        if (Test-Path -LiteralPath $sourceFile) {
            $null = New-Item -ItemType Directory -Path (Split-Path $targetFile) -Force -ErrorAction SilentlyContinue
            Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
            Write-Log "  ✓ 已安装: $($file.RelPath)" -Color Green
            $installCount++
        } else {
            Write-Log "  ⚠ 源文件不存在: $($file.Source)" -Color Yellow
            $errorCount++
        }
    }

    # 更新版本号
    $versionName = if ($latestTag) { $latestTag } else { "upgrade-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
    New-Snapshot -VersionName "$versionName-installed" | Out-Null

    Write-Host ""
    Write-Log "升级完成！" -Color Green
    Write-Log "安装了 $installCount 个文件" -Color Green
    if ($errorCount -gt 0) {
        Write-Log "$errorCount 个文件安装失败" -Color Yellow
    }
    Write-Host ""
    Write-Host "建议：" -ForegroundColor Cyan
    Write-Host "  1. 检查 CHANGELOG.md 了解更新内容" -ForegroundColor White
    Write-Host "  2. 重启 opencode 使更改生效" -ForegroundColor White
    Write-Host ""
    Write-Host "如果新版本有问题，请运行：" -ForegroundColor Cyan
    Write-Host "  .\scripts\manage.ps1 rollback" -ForegroundColor Yellow
}

# ============================================================
# 历史命令
# ============================================================

function Show-History {
    Write-Host ""
    Write-Host "╔════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║           版本历史                  ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path -LiteralPath $ManifestPath)) {
        Write-Log "暂无版本历史" -Color Yellow
        return
    }

    $manifest = Get-Content $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $versions = @($manifest.versions)

    if ($versions.Count -eq 0) {
        Write-Log "暂无版本历史" -Color Yellow
        return
    }

    # 反向排序（最新的在前面）
    $sortedVersions = $versions | Sort-Object -Property timestamp -Descending

    foreach ($v in $sortedVersions) {
        $isCurrent = ($v.version -eq $manifest.current_version)
        $marker = if ($isCurrent) { "← 当前" } else { "" }
        $timestamp = if ($v.timestamp) { 
            try { ([DateTime]::Parse($v.timestamp)).ToString('yyyy-MM-dd HH:mm:ss') } 
            catch { $v.timestamp }
        } else { "未知" }
        
        Write-Host "  $($v.version)" -NoNewline -ForegroundColor $(if ($isCurrent) { "Green" } else { "White" })
        if ($isCurrent) { Write-Host " $marker" -ForegroundColor Green }
        else { Write-Host "" }
        Write-Host "    时间: $timestamp" -ForegroundColor Gray
        Write-Host "    类型: $($v.type)" -ForegroundColor Gray
        
        if ($v.files -and $v.files.Count -gt 0) {
            Write-Host "    文件: $($v.files.Count) 个" -ForegroundColor Gray
        }
        Write-Host ""
    }
}

# ============================================================
# 主入口
# ============================================================

Write-Host "╔════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  zhongwen-agent 版本管理工具 v1.0  ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════╝" -ForegroundColor Cyan

switch ($Command) {
    'status' { Show-Status }
    'snapshot' { 
        $name = "manual-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        New-Snapshot -VersionName $name
    }
    'rollback' { Invoke-Rollback -Version $TargetVersion }
    'upgrade' { Invoke-Upgrade }
    'history' { Show-History }
}
