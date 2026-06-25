# zhongwen-agent-plugin

> 中文语言纯度高强度工程约束插件 · 零干扰后台监控 · MCP 自动审计 · 智能体 CLI · 可视化仪表盘 · 智能分析

## 这是什么

这是一个为 opencode 设计的**工程级中文语言约束系统**。它不依赖模型的自觉性，而是从系统架构层面构建了一个**不可绕过、自动化、可度量**的语言检查闭环。

## 核心原理

传统规则是**软约束**——模型可以选择忽略。本插件采用**两层不可绕过约束**：

```
第一层 · MCP 外部检查器（不可控层，零干扰）
    ↓
第二层 · 系统提示身份定义（不可控层，零动作要求）
```

### 第一层：MCP 语言检查服务器

- 一个独立于 AI 运行的 Node.js 进程
- 提供 `check_chinese_purity`、`zhongwen_status`、`zhongwen_rollback`、`zhongwen_upgrade`、`zhongwen_history`、`zhongwen_dashboard`、`zhongwen_open_dashboard` 等工具
- AI 无法控制、无法绕过、无法关闭外部进程
- **零干扰模式**：不要求 AI 调用工具，后台自动记录审计日志
- 检测能力：英文句子、英文填充词、中英混合短语、代码块注释、翻译腔
- 支持白名单豁免和修复建议
- **v4.0.0 新增**：SQLite 数据持久化、可视化仪表盘、智能分析

### 第二层：系统提示身份定义

- Agent 定义仅 7 行：纯身份定义，零强制条款
- 全局指令仅 25 行：身份定义 + 中文化表达 + 可选自检
- opencode 在 API 层强制注入，模型无法阻止
- **零动作要求**：不要求调用工具、不要求改输出格式、不要求任何额外操作

## 文件结构

```
zhongwen-agent-plugin/
├── README.md                    ← 本文档
├── CHANGELOG.md                 ← 版本历史
├── chinese-rules.md             ← 系统指令文件（零干扰版，默认）
├── chinese-rules-guard.md       ← 系统指令文件（强制门卫版，可选升级）
├── zhongwen-agent.md            ← Agent 定义文件（零干扰版，默认）
├── zhongwen-agent-guard.md      ← Agent 定义文件（强制门卫版，可选升级）
├── mcp/
│   ├── check_language.mjs       ← MCP 语言检查服务器
│   ├── dashboard.mjs            ← Web 可视化仪表盘
│   ├── database.mjs             ← SQLite 数据库模块
│   ├── log-rotation.mjs         ← 日志轮转模块
│   └── manage.mjs              ← 版本管理工具
├── scripts/
│   ├── install.ps1              ← 一键安装脚本
│   ├── rollback.ps1             ← 一键回滚脚本
│   ├── upgrade.ps1              ← 一键升级脚本
│   ├── upgrade-to-guard.ps1     ← 升级到强制门卫模式
│   └── rollback-to-zero-interference.ps1 ← 回滚到零干扰模式
└── versions/                    ← 本地版本快照目录（自动生成）
```

## 版本管理

插件内置版本管理命令，支持回滚、升级、查看状态。

### 命令总览

```powershell
.\scripts\manage.ps1 status       # 查看当前状态
.\scripts\manage.ps1 snapshot     # 手动创建快照
.\scripts\manage.ps1 rollback     # 回滚到上一个版本
.\scripts\manage.ps1 upgrade      # 从 GitHub 升级到最新版
.\scripts\manage.ps1 history      # 查看版本历史
```

### 快捷脚本

也可以直接使用快捷脚本：

```powershell
.\scripts\rollback.ps1            # 一键回滚（同 manage.ps1 rollback）
.\scripts\upgrade.ps1             # 一键升级（同 manage.ps1 upgrade）
```

### 回滚示例

回滚到上一个版本（自动创建当前状态备份）：

```powershell
.\scripts\rollback.ps1
```

回滚到指定版本：

```powershell
.\scripts\manage.ps1 rollback -TargetVersion v2.0.0
```

### 升级示例

```powershell
.\scripts\upgrade.ps1
```

从 GitHub 拉取最新代码并安装。升级前会自动创建当前状态备份。

### 查看历史

```powershell
.\scripts\manage.ps1 history
```

查看所有版本快照和变更记录。

## 安装方法

### 前提条件

- Node.js 16+（已内置，无需额外安装）
- opencode 已安装并配置

### 自动安装（推荐）

在 PowerShell 中运行：

```powershell
.\scripts\install.ps1
```

### 手动安装

1. **复制 MCP 服务器文件**
   ```powershell
   Copy-Item mcp\check_language.mjs "$env:USERPROFILE\.config\opencode\mcp\check_language.mjs"
   ```

2. **复制规则文件**
   ```powershell
   Copy-Item chinese-rules.md "$env:USERPROFILE\.config\opencode\chinese-rules.md"
   Copy-Item zhongwen-agent.md "$env:USERPROFILE\.config\opencode\agents\zhongwen-agent.md"
   ```

3. **更新 opencode.json**
   在 `opencode.json` 中添加：
   ```json
   "mcp": {
     "zhongwen-language-checker": {
       "type": "local",
       "command": ["node", "C:\\Users\\Administrator\\.config\\opencode\\mcp\\check_language.mjs"],
       "enabled": true
     }
   }
   ```
   并确保包含：
   ```json
   "instructions": ["chinese-rules.md"],
   "default_agent": "zhongwen-agent"
   ```

4. **重启 opencode**
   关闭并重新打开 opencode，让 MCP 服务器启动。

## 验证安装

启动 opencode 后，在对话中发送任意消息。如果一切正常：

1. AI 正常工作，输出格式**完全不变**
2. AI 思考内容**无强制要求**（无锚定格式、无强制自检）
3. 审计日志自动记录：`~/.config/opencode/logs/language-audit.log`
4. 可通过 `zhongwen_status()` 工具查看当前状态
5. 可通过 `zhongwen_history()` 工具查看版本历史

### 零干扰模式说明

v3.0.0 采用**零干扰模式**——检查系统在后台运行，不改变 AI 的：
- 思考内容（无锚定格式、无强制自检）
- 输出格式（末尾不附加任何内容）
- 工具调用行为（完全可选）

约束施加在**不可控层**（系统提示 + 外部进程），零要求施加在**可控层**（AI 的行为）。

### 检测能力

| 检测类型 | 说明 |
|:---|:---|
| 英文句子 | ≥3 个英文单词 + 句尾标点，或 ≥5 个英文单词 |
| 英文填充词 | however, therefore, actually, basically 等 40+ 词汇 |
| 中英混合短语 | 中英字符交替出现 ≥3 次 |
| 代码块注释 | 代码块中的 `//`、`#`、`/*` 等注释行 |
| 白名单豁免 | 可配置术语和正则表达式模式 |
| 修复建议 | 自动提供英文→中文映射建议 |
| 审计日志 | 自动写入 `language-audit.log`（JSON Lines 格式） |

## 技术细节

### MCP 协议

语言检查服务器使用 JSON-RPC 2.0 over stdio 协议，与 opencode 的 MCP 系统原生集成。

### 提供的工具

| 工具名 | 功能 |
|:---|:---|
| `check_chinese_purity` | 检查文本的中文语言纯度 |
| `zhongwen_status` | 查看插件当前状态 |
| `zhongwen_snapshot` | 创建版本快照 |
| `zhongwen_rollback` | 回滚到指定版本 |
| `zhongwen_upgrade` | 从 GitHub 升级 |
| `zhongwen_history` | 查看版本历史 |
| `zhongwen_dashboard` | **v4.0.0 新增**：获取完整仪表板数据 |
| `zhongwen_open_dashboard` | **v4.0.0 新增**：打开 Web 可视化仪表盘 |

### 纯度计算

```
纯度 = (中文字符数 / (中文字符数 + 英文字符数)) × 100%
```

- PASS: 纯度 ≥ 90% 且无违规
- WARN: 纯度 70%~89%
- FAIL: 纯度 < 70% 或检测到英文违规

### 审计日志

每次 `check_chinese_purity` 工具被调用时，自动写入审计日志：

```
~/.config/opencode/logs/language-audit.log
```

日志格式为 JSON Lines（每行一个 JSON 对象）：

```json
{"timestamp":"2026-06-24T10:00:00.000Z","context":"self-check","status":"PASS","purity":95.5,"violations_count":0,"details":"..."}
```

### 白名单配置

创建 `~/.config/opencode/whitelist.json`：

```json
{
  "allowed_terms": ["JWT", "API", "REST"],
  "allowed_patterns": ["^[A-Z]{2,8}$", "^[a-z]+\\.[a-z]+$"],
  "check_comments": true,
  "thresholds": { "purity_pass": 90, "purity_warn": 70 }
}
```

### 修复建议

检测到英文违规时，自动提供中文修复建议。映射表位于 `mcp/check_language.mjs` 的 `FIX_SUGGESTIONS` 对象中，可自由扩展。

## 自定义

### 修改纯度阈值

编辑 `~/.config/opencode/whitelist.json`：

```json
{
  "thresholds": { "purity_pass": 90, "purity_warn": 70 }
}
```

### 添加自定义术语

编辑 `~/.config/opencode/whitelist.json`：

```json
{
  "allowed_terms": ["JWT", "API", "你的术语"],
  "allowed_patterns": ["^[A-Z]{2,8}$"]
}
```

### 添加自定义违规词

编辑 `mcp/check_language.mjs`，修改 `FIX_SUGGESTIONS` 对象：

```javascript
const FIX_SUGGESTIONS = {
  'your_word': '你的中文翻译',
  // ...
};
```

## v4.0.0 新功能（2026-06-25）

### 数据层增强

- **SQLite 数据库**：统一存储所有统计数据，支持跨会话持久化
- **多日志分级**：全量日志、违规日志、汇总日志三级分离
- **日志轮转**：超过 10MB 自动轮转，超过 30 天自动压缩归档
- **结构化日志**：每条记录包含 session_id、model、turn、text_hash 等字段

### 可视化仪表盘

- **Web 仪表盘**：基于 Node.js 原生 HTTP 服务器，零外部依赖
- **实时监控**：自动刷新（每 30 秒），显示当前纯度、违规次数、运行时间
- **趋势图表**：纯度和违规率趋势线图（最近 7 天/30 天/全部）
- **违规分布**：饼图显示各类型违规占比
- **时间热力图**：GitHub 风格 7×24 违规热力图
- **高频词排名**：Top 10 违规词展示
- **智能建议**：自动生成改进建议

### 智能化引擎

- **用户行为分析**：识别高频违规模式、最常违规时段
- **自适应白名单**：根据使用频率自动建议加入白名单
- **智能告警**：连续 FAIL、违规率过高、纯度骤降自动告警
- **质量评分**：0-100 分综合评分，考虑纯度、违规率、趋势
- **根因分析**：自动识别违规根因并生成改进建议

### 新增 MCP 工具

- `zhongwen_dashboard`：获取完整仪表板数据（支持 7d/30d/all 时间范围）
- `zhongwen_open_dashboard`：一键打开 Web 仪表盘

## 可选升级：强制门卫模式

> **版本**：v4.1.0-proposal · **状态**：可选升级，非默认方案  
> **兼容性**：与 v4.0.0 完全兼容，可随时回滚

### 什么是强制门卫模式

v4.0.0 采用**零干扰模式**——检查系统在后台运行，AI 可以选择是否调用检查工具，监控覆盖率接近 0%。

**强制门卫模式**将"可选自检"升级为"强制门卫"，要求 AI 在每次输出前必须调用 `check_chinese_purity` 工具验证。检查结果嵌入输出末尾，让中文约束**可执行、可验证、不可绕过**。

### 与零干扰模式对比

| 特性 | 零干扰模式（默认） | 强制门卫模式（可选升级） |
|:---|:---|:---|
| 监控覆盖率 | ≈ 0%（依赖 AI 自觉） | ≈ 100%（强制调用） |
| AI 行为改变 | 无 | 输出前必须检查 |
| 输出格式 | 无附加内容 | 末尾附加检查标记 |
| 用户感知 | 无感知 | 看到检查标记 |
| 工程化保证 | 软约束（可选） | 硬约束（强制） |

### 启用方式

```powershell
.\scripts\upgrade-to-guard.ps1
```

一键升级脚本会自动：
1. 备份当前配置（`~/.config/opencode/backups/guard-upgrade-<timestamp>/`）
2. 将 `chinese-rules-guard.md` 和 `zhongwen-agent-guard.md` 部署到配置目录
3. 验证文件内容是否正确

### 手动启用

将 guard 文件复制到配置目录：

```powershell
# 备份当前配置
Copy-Item "$env:USERPROFILE\.config\opencode\chinese-rules.md" "<备份目录>\chinese-rules.md"
Copy-Item "$env:USERPROFILE\.config\opencode\agents\zhongwen-agent.md" "<备份目录>\zhongwen-agent.md"

# 部署 guard 版
Copy-Item chinese-rules-guard.md "$env:USERPROFILE\.config\opencode\chinese-rules.md"
Copy-Item zhongwen-agent-guard.md "$env:USERPROFILE\.config\opencode\agents\zhongwen-agent.md"
```

### 回滚方式

```powershell
.\scripts\rollback-to-zero-interference.ps1
```

会自动从最近的 `guard-upgrade-*` 备份中恢复。

### 输出格式变化

**启用前（零干扰模式）**：
```
用户：写一个登录系统

AI：这是一个使用 JWT（JSON Web Token）的登录系统实现...
[正常输出，无附加内容]
```

**启用后（强制门卫模式）**：
```
用户：写一个登录系统

AI：这是一个使用 JWT（JSON Web Token）的登录系统实现...

【语言纯度检查：PASS | 纯度：95% | 违规数：0 | 检查次数：1】
```

### 文件说明

| 文件 | 说明 |
|:---|:---|
| `chinese-rules.md` | 零干扰版系统指令（默认，可选自检） |
| `chinese-rules-guard.md` | 强制门卫版系统指令（可选升级，强制检查） |
| `zhongwen-agent.md` | 零干扰版 Agent 定义（默认，纯身份定义） |
| `zhongwen-agent-guard.md` | 强制门卫版 Agent 定义（可选升级，含强制门卫协议） |
| `scripts/upgrade-to-guard.ps1` | 一键升级脚本 |
| `scripts/rollback-to-zero-interference.ps1` | 一键回滚脚本 |

---

## 版本历史

### v4.1.0-proposal (2026-06-25) · 强制门卫模式（可选升级）

**核心变更：**
- 新增 `chinese-rules-guard.md`：强制门卫版系统指令（强制检查 + 输出标记 + 禁止行为）
- 新增 `zhongwen-agent-guard.md`：强制门卫版 Agent 定义（含强制门卫协议）
- 新增 `scripts/upgrade-to-guard.ps1`：一键升级到强制门卫模式
- 新增 `scripts/rollback-to-zero-interference.ps1`：一键回滚到零干扰模式
- 零干扰版文件（`chinese-rules.md` / `zhongwen-agent.md`）恢复为纯身份定义
- 零干扰与强制门卫双版本共存，用户可自由选择

### v3.0.0 (2026-06-24) · 零干扰强约束重构版

**核心变更：**
- 重构 Agent 定义文件（178 行 → 7 行）
- 重构全局指令文件（69 行 → 25 行）
- 从"前台强制"转为"后台监控 + 可选自检"
- 智能体正常工作流程零改变

**检测增强：**
- 新增混合短语检测（中英夹杂）
- 新增代码块注释检查
- 新增白名单/豁免机制
- 新增修复建议映射
- 新增审计日志自动记录

### v2.2.0 (2026-06-24)
- 新增 MCP 版本管理服务器（智能体可自主调用）
- 支持 `zhongwen_status`、`zhongwen_rollback`、`zhongwen_upgrade`、`zhongwen_history`

### v2.1.0 (2026-06-24)
- 新增 PowerShell 版本管理脚本
- 支持 `rollback`、`upgrade`、`status`、`history` 命令

### v2.0.0 (2026-06-24)
- 新增 MCP 外部语言检查服务器
- 引入输出格式锁机制
- 五维约束升级为三层工程锁
- 会话级违规计数器（外部进程维护）
- 可配置的纯度阈值

## 许可证

MIT

---

**记住：工程学方法的核心是"不可绕过"。这套系统不是靠 AI 的自觉性，而是靠架构设计来保证约束的执行。**
