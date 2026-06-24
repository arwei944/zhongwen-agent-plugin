#!/usr/bin/env pwsh
<#
.SYNOPSIS
  zhongwen-agent 一键升级脚本
.DESCRIPTION
  从 GitHub 拉取最新代码并安装。相当于运行:
    .\scripts\manage.ps1 upgrade
#>

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$manageScript = Join-Path $scriptPath "manage.ps1"

if (-not (Test-Path -LiteralPath $manageScript)) {
    Write-Host "错误：找不到 manage.ps1" -ForegroundColor Red
    exit 1
}

& $manageScript upgrade
exit $LASTEXITCODE
