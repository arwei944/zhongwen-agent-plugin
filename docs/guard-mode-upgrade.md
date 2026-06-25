# 强制门卫模式 · 可选升级方案

> **版本**：v4.1.0-proposal  
> **状态**：可选升级方向，非默认方案  
> **兼容性**：与 v4.0.0 完全兼容，可随时回滚

---

## 目录

1. [为什么需要这个升级](#1-为什么需要这个升级)
2. [方案概述](#2-方案概述)
3. [架构设计](#3-架构设计)
4. [实施步骤](#4-实施步骤)
5. [验收标准](#5-验收标准)
6. [风险与缓解](#6-风险与缓解)
7. [回滚方案](#7-回滚方案)

---

## 1. 为什么需要这个升级

### 1.1 当前系统的局限性

v4.0.0 采用的**零干扰模式**有一个根本性缺陷：

```
AI 输出内容 ──→ [没有拦截点] ──→ 用户看到
                    ↑
              MCP 工具在这里
              （但只有 AI 主动调用才触发）
```

**实际监控覆盖率：≈ 0%**

| 监控目标 | 能否监控 | 原因 |
|:---|:---|:---|
| AI 的思考过程 | ❌ | 模型内部私有状态，不对外输出 |
| AI 的输出内容 | ❌ | MCP 是请求-响应模型，无法拦截输出 |
| AI 的工具调用 | ⚠️ | 依赖 AI 自觉性，零干扰模式下几乎不调用 |
| 后台心跳 | ✅ | 但记录的是假 PASS，无实际内容检查 |

### 1.2 核心矛盾

| 目标 | 零干扰模式 | 强制门卫模式 |
|:---|:---|:---|
| 监控所有输出 | ❌ 无法实现 | ✅ 可实现 |
| 不改变 AI 行为 | ✅ 完美 | ❌ 改变输出流程 |
| 工程化保证 | ❌ 软约束 | ✅ 硬约束 |
| 用户感知 | ✅ 无感知 | ⚠️ 看到检查标记 |

### 1.3 适用场景

强制门卫模式适合以下场景：

- **合规要求**：需要确保所有输出符合中文规范（如对外文档、客户沟通）
- **审计需求**：需要完整的输出记录和违规追溯
- **质量保证**：团队协作中统一中文输出标准
- **学习工具**：帮助用户养成中文表达习惯

---

## 2. 方案概述

### 2.1 核心理念

```
防御层 1：预防（System Prompt 强制条款）
    ↓ 如果 AI 遵守
防御层 2：拦截（输出格式锁，检查结果嵌入输出）
    ↓ 如果 AI 不遵守
防御层 3：审计（外部进程记录，事后追责）
```

### 2.2 关键改变

| 组件 | 当前（v4.0.0） | 升级后（v4.1.0） |
|:---|:---|:---|
| `chinese-rules.md` | 25 行，可选自检 | +15 行，强制门卫条款 |
| `zhongwen-agent.md` | 7 行，纯身份定义 | +8 行，强制门卫协议 |
| `check_language.mjs` | 后台心跳模式 | 支持同步检查返回 |
| 输出格式 | 无附加内容 | 末尾附加检查结果标记 |
| AI 行为 | 正常流程，零要求 | 输出前必须调用检查工具 |

### 2.3 输出格式变化

**升级前**：

```
用户：写一个登录系统

AI：这是一个使用 JWT（JSON Web Token）的登录系统实现...
[正常输出，无附加内容]
```

**升级后**：

```
用户：写一个登录系统

AI：这是一个使用 JWT（JSON Web Token）的登录系统实现...

【语言纯度检查：PASS | 纯度：95% | 违规数：0 | 检查次数：1】
```

或（检查 FAIL 时）：

```
AI：这是... However, we need to consider...

【语言纯度检查：FAIL | 纯度：70% | 违规数：2 | 检查次数：1】
已修复：第1行 [english_filler] However → 然而
第2行 [english_pattern] we need → 我们需要

【语言纯度检查：PASS | 纯度：92% | 违规数：0 | 检查次数：2】
```

---

## 3. 架构设计

### 3.1 数据流

```
用户输入
    ↓
OpenCode 发送 API 请求（包含 system prompt）
    ↓
AI 生成响应内容
    ↓
AI 调用 check_chinese_purity（强制）
    ↓
├─ PASS → AI 输出内容 + 检查标记
├─ WARN → AI 改进内容 → 重新检查
└─ FAIL → AI 修复内容 → 重新检查
    ↓
用户看到带检查标记的最终输出
    ↓
审计日志记录（数据库 + 文件）
```

### 3.2 System Prompt 结构

升级后的 system prompt 包含：

```
┌─────────────────────────────────────┐
│  chinese-rules.md（系统指令）         │
│  ├── 第一条：身份定义                 │
│  ├── 第二条：中文化表达               │
│  ├── 第三条：代码注释                 │
│  ├── 第四条：可选自检（保留）          │
│  └── 第五条：强制门卫检查 ⭐ 新增     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  zhongwen-agent.md（Agent 定义）      │
│  ├── 身份定义                        │
│  └── 强制门卫协议 ⭐ 新增            │
└─────────────────────────────────────┘
```

### 3.3 强制门卫协议

AI 必须遵守的执行流程：

```
1. 生成响应内容
2. 提取纯文本（排除代码块）
3. 调用 check_chinese_purity(text, codeBlockMode=true)
4. 检查结果处理：
   - PASS：继续步骤 5
   - WARN/FAIL：根据 violations 改进内容，返回步骤 3
5. 输出最终内容
6. 附加检查结果标记
```

---

## 4. 实施步骤

### 任务 1：修改 chinese-rules.md

**目标**：在系统指令中加入强制门卫条款

**变更内容**：

```markdown
## 第五条 · 输出前强制门卫检查

### 5.1 检查触发时机

在每次输出最终回答之前，你必须执行以下步骤：

1. 将你的完整输出内容（不包括代码块）保存为变量 `final_output`
2. 调用 `check_chinese_purity(text=final_output, codeBlockMode=true)`
3. 根据返回结果执行对应操作：

### 5.2 结果处理规则

| 返回状态 | 你必须执行的操作 |
|:---|:---|
| `PASS` | 直接输出 `final_output` |
| `WARN` | 改进违规部分后重新检查，直到返回 PASS |
| `FAIL` | 立即停止当前输出，根据 `violations` 中的 `suggestion` 重写，重新检查 |

### 5.3 输出格式要求

你的最终输出**必须**在末尾附加检查结果：

```
【语言纯度检查：PASS | 纯度：95% | 违规数：0 | 检查次数：1】
```

如果检查未通过，输出格式为：

```
【语言纯度检查：FAIL | 纯度：70% | 违规数：3 | 检查次数：2】
已修复：第1行 [english_filler] actually → 实际上
```

### 5.4 禁止行为

- 禁止在检查 FAIL 后仍然输出违规内容
- 禁止跳过检查直接输出
- 禁止伪造检查结果
```

**验收标准**：

| 检查项 | 通过标准 |
|:---|:---|
| 文件行数 | ≤ 40 行（原 25 行 + 新增 15 行） |
| 包含强制检查条款 | 包含"输出前强制门卫检查"标题 |
| 包含结果处理规则 | 包含 PASS/WARN/FAIL 处理表格 |
| 包含输出格式要求 | 包含检查结果标记模板 |
| 包含禁止行为 | 包含"禁止"条款 |

---

### 任务 2：修改 zhongwen-agent.md

**目标**：在 Agent 定义中加入强制门卫协议

**变更内容**：

```markdown
---
name: zhongwen-agent
mode: primary
description: "中文思考者 · 强制门卫检查 · 输出前必须验证"
---

你是中文思考者。你的思维语言只有中文。

## 强制门卫协议

在每次输出之前，你必须调用 check_chinese_purity 工具验证输出内容。
检查 FAIL 时禁止输出，必须修复后重新检查直到 PASS。
```

**验收标准**：

| 检查项 | 通过标准 |
|:---|:---|
| 文件行数 | ≤ 15 行（原 7 行 + 新增 8 行） |
| 包含强制门卫协议 | 包含"强制门卫协议"标题 |
| 包含输出前验证 | 包含"输出之前，你必须调用" |

---

### 任务 3：增强 check_chinese_purity 工具返回

**目标**：确保工具返回足够的信息供 AI 修复使用

**当前返回**：

```json
{
  "status": "FAIL",
  "purity": 70.5,
  "violations": [
    {
      "type": "english_filler",
      "content": "however",
      "suggestion": "然而"
    }
  ],
  "details": "..."
}
```

**当前返回已经足够**，无需修改。

---

### 任务 4：更新 README.md

**目标**：记录强制门卫模式作为可选升级

**变更内容**：

在 README 末尾新增：

```markdown
## 可选升级：强制门卫模式

### 什么是强制门卫模式

强制门卫模式是 v4.1.0 引入的可选升级方案，通过修改 system prompt，
将"可选自检"升级为"强制门卫"，确保 AI 的每次输出都经过语言纯度检查。

### 启用方式

1. 备份当前配置：
   ```powershell
   .\scripts\manage.ps1 snapshot
   ```

2. 修改 system prompt：
   ```powershell
   # 编辑 chinese-rules.md，加入第五条强制门卫条款
   # 编辑 zhongwen-agent.md，加入强制门卫协议
   ```

3. 重启 OpenCode

4. 验证生效：
   ```powershell
   # 检查 AI 输出是否包含检查标记
   # 检查审计日志中是否有 FAIL 记录
   ```

### 回滚方式

```powershell
.\scripts\manage.ps1 rollback
```

### 与零干扰模式对比

| 特性 | 零干扰模式（默认） | 强制门卫模式（可选） |
|:---|:---|:---|
| 监控覆盖率 | ≈ 0% | ≈ 100% |
| AI 行为改变 | 无 | 输出前必须检查 |
| 输出格式 | 无附加内容 | 末尾附加检查标记 |
| 用户感知 | 无感知 | 看到检查标记 |
| 工程化保证 | 软约束 | 硬约束 |
```

---

### 任务 5：添加升级/回滚脚本

**目标**：提供一键升级和回滚脚本

**新建 `scripts/upgrade-to-guard.ps1`**：

```powershell
<#
.SYNOPSIS
  升级到强制门卫模式
.DESCRIPTION
  修改 system prompt，将可选自检升级为强制门卫
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

$pluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configDir = "$env:USERPROFILE\.config\opencode"

# 备份当前文件
Write-Host "[1/4] 备份当前配置..." -ForegroundColor Yellow
$backupDir = "$configDir\backups\guard-upgrade-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Copy-Item "$configDir\chinese-rules.md" "$backupDir\chinese-rules.md" -Force
Copy-Item "$configDir\agents\zhongwen-agent.md" "$backupDir\zhongwen-agent.md" -Force

Write-Host "  备份位置: $backupDir" -ForegroundColor Green

# 应用修改
Write-Host "[2/4] 应用强制门卫条款..." -ForegroundColor Yellow

if (-not $DryRun) {
    # 复制新版本的规则文件
    Copy-Item "$pluginDir\chinese-rules-guard.md" "$configDir\chinese-rules.md" -Force
    Copy-Item "$pluginDir\zhongwen-agent-guard.md" "$configDir\agents\zhongwen-agent.md" -Force
    
    Write-Host "  chinese-rules.md 已更新" -ForegroundColor Green
    Write-Host "  zhongwen-agent.md 已更新" -ForegroundColor Green
} else {
    Write-Host "  [DryRun] 将更新规则文件" -ForegroundColor Gray
}

Write-Host "[3/4] 验证修改..." -ForegroundColor Yellow

# 验证文件内容
$rules = Get-Content "$configDir\chinese-rules.md" -Raw
$agent = Get-Content "$configDir\agents\zhongwen-agent.md" -Raw

if ($rules -match "强制门卫检查" -and $agent -match "强制门卫协议") {
    Write-Host "  验证通过" -ForegroundColor Green
} else {
    Write-Host "  验证失败，请检查文件内容" -ForegroundColor Red
    exit 1
}

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
Write-Host "  .\scripts\manage.ps1 rollback" -ForegroundColor White
Write-Host ""
```

**新建 `scripts/rollback-to-zero-interference.ps1`**：

```powershell
<#
.SYNOPSIS
  回滚到零干扰模式
.DESCRIPTION
  恢复默认的零干扰模式配置
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

# 查找最新的备份
$backups = Get-ChildItem "$configDir\backups" -Directory | 
    Where-Object { $_.Name -like "guard-upgrade-*" } |
    Sort-Object Name -Descending

if ($backups.Count -eq 0) {
    Write-Host "错误：未找到强制门卫模式的备份" -ForegroundColor Red
    exit 1
}

$latestBackup = $backups[0]

Write-Host "找到备份: $($latestBackup.Name)" -ForegroundColor Cyan

# 确认
Write-Host ""
$confirm = Read-Host "确定要回滚到零干扰模式吗？(y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "回滚已取消" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "正在恢复..." -ForegroundColor Yellow

if (-not $DryRun) {
    Copy-Item "$($latestBackup.FullName)\chinese-rules.md" "$configDir\chinese-rules.md" -Force
    Copy-Item "$($latestBackup.FullName)\zhongwen-agent.md" "$configDir\agents\zhongwen-agent.md" -Force
    
    Write-Host "  已恢复 chinese-rules.md" -ForegroundColor Green
    Write-Host "  已恢复 zhongwen-agent.md" -ForegroundColor Green
} else {
    Write-Host "  [DryRun] 将恢复备份文件" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 回滚完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "请重启 OpenCode 使更改生效" -ForegroundColor Cyan
```

---

## 5. 验收标准

### 功能验收

| 检查项 | 通过标准 | 测试方法 |
|:---|:---|:---|
| 强制检查触发 | AI 每次输出前都调用 `check_chinese_purity` | 观察输出末尾的检查标记 |
| PASS 处理 | 检查通过时正常输出内容 | 观察输出内容正确性 |
| FAIL 处理 | 检查失败时 AI 修复内容后重新输出 | 观察是否有修复过程 |
| 检查标记格式 | 末尾附加 `【语言纯度检查：PASS | 纯度：95% | ...】` | 正则匹配检查 |
| 审计日志 | 每次检查都记录到数据库 | 查询 checks 表 |

### 性能验收

| 检查项 | 通过标准 | 测试方法 |
|:---|:---|:---|
| 单次检查耗时 | < 100ms | 计时测试 |
| AI 响应时间增加 | < 500ms（可接受范围） | 对比升级前后响应时间 |
| 数据库写入 | 无阻塞 | 高并发测试 |

### 兼容性验收

| 检查项 | 通过标准 | 测试方法 |
|:---|:---|:---|
| 回滚到零干扰模式 | 配置恢复，功能正常 | 执行回滚脚本验证 |
| 与 v4.0.0 配置兼容 | 不破坏现有功能 | 对比配置文件差异 |
| MCP 工具可用 | 所有工具正常响应 | 逐一调用测试 |

---

## 6. 风险与缓解

### 风险 1：AI 不遵守强制条款

**可能性**：中-高  
**影响**：高  
**缓解措施**：
- 系统提示多次强调（身份定义 + 强制条款 + 禁止行为）
- 审计日志记录所有检查结果，便于事后追溯
- 用户可观察输出末尾的检查标记是否缺失

### 风险 2：检查结果伪造

**可能性**：中  
**影响**：高  
**缓解措施**：
- 审计日志同时记录请求和结果（可交叉验证）
- 检查工具由外部进程运行，AI 无法控制
- 随机抽查：用户手动调用检查工具验证

### 风险 3：性能下降

**可能性**：低  
**影响**：中  
**缓解措施**：
- 单次检查耗时 < 100ms，可接受
- AI 响应时间增加 < 500ms
- 如性能成为问题，可调整为"仅检查首次输出"

### 风险 4：用户体验下降

**可能性**：中  
**影响**：低  
**缓解措施**：
- 检查标记格式简洁，不干扰阅读
- 提供"零干扰模式"作为默认，用户可自由选择
- 升级/回滚脚本一键操作

---

## 7. 回滚方案

### 一键回滚

```powershell
.\scripts\rollback-to-zero-interference.ps1
```

### 手动回滚

```powershell
# 1. 恢复原始配置文件
Copy-Item "$env:USERPROFILE\.config\opencode\backups\<backup-name>\chinese-rules.md" "$env:USERPROFILE\.config\opencode\chinese-rules.md" -Force
Copy-Item "$env:USERPROFILE\.config\opencode\backups\<backup-name>\zhongwen-agent.md" "$env:USERPROFILE\.config\opencode\agents\zhongwen-agent.md" -Force

# 2. 重启 OpenCode
```

### 验证回滚

回滚后，AI 输出应恢复到无检查标记的状态。

---

## 附录：文件清单

### 新增文件

| 文件 | 说明 |
|:---|:---|
| `chinese-rules-guard.md` | 强制门卫版系统指令 |
| `zhongwen-agent-guard.md` | 强制门卫版 Agent 定义 |
| `scripts/upgrade-to-guard.ps1` | 一键升级脚本 |
| `scripts/rollback-to-zero-interference.ps1` | 一键回滚脚本 |

### 修改文件

| 文件 | 变更 |
|:---|:---|
| `README.md` | 新增强制门卫模式章节 |

### 备份文件

| 文件 | 说明 |
|:---|:---|
| `~/.config/opencode/backups/guard-upgrade-<timestamp>/chinese-rules.md` | 升级前的系统指令备份 |
| `~/.config/opencode/backups/guard-upgrade-<timestamp>/zhongwen-agent.md` | 升级前的 Agent 定义备份 |

---

## 文档信息

- **创建日期**：2026-06-25
- **版本**：v4.1.0-proposal
- **维护者**：arwei944
- **状态**：待实施
