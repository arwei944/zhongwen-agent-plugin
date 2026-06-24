#!/usr/bin/env pwsh
<#
.SYNOPSIS
  zhongwen-agent 一键回滚脚本
.DESCRIPTION
  快速回滚到上一个版本。相当于运行:
    .\scripts\manage.ps1 rollback
#>

param(
    [string]$TargetVersion = ''
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$manageScript = Join-Path $scriptPath "manage.ps1"

if (-not (Test-Path -LiteralPath $manageScript)) {
    Write-Host "错误：找不到 manage.ps1" -ForegroundColor Red
    exit 1
}

$argsList = @('rollback')
if (-not [string]::IsNullOrEmpty($TargetVersion)) {
    $argsList += @('-TargetVersion', $TargetVersion)
}

& $manageScript @argsList
exit $LASTEXITCODE
