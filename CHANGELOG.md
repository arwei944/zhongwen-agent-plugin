# 版本历史

## v3.0.0 · 2026-06-24 · 零干扰强约束重构版

**核心理念**：约束施加在不可控层，零要求施加在可控层。

### 核心变更

- 重构 Agent 定义文件（178 行 → 7 行）：纯身份定义，零强制条款
- 重构全局指令文件（69 行 → 25 行）：身份定义 + 中文化表达 + 可选自检
- 从"前台强制"转为"后台监控 + 可选自检"
- 智能体正常工作流程零改变（无格式锁、无强制调用、无强制重写）

### 检测增强

- 新增混合短语检测（中英字符交替出现 ≥3 次）
- 新增代码块注释检查（`//`、`#`、`/*` 等注释行）
- 新增白名单/豁免机制（`~/.config/opencode/whitelist.json`）
- 新增修复建议映射（英文 → 中文自动翻译建议）
- 新增审计日志自动记录（`language-audit.log`）

### 架构变更

- 约束全在不可控层：系统提示身份定义 + MCP 外部进程
- 可控层零要求：不要求调用工具、不要求改输出格式、不要求任何额外操作

### 版本管理

- 新增 `zhongwen_status`、`zhongwen_snapshot`、`zhongwen_rollback`、`zhongwen_upgrade`、`zhongwen_history` MCP 工具
- 智能体可直接在对话中调用版本管理命令

## v2.2.0 · 2026-06-24 · MCP CLI 版

- 新增 `mcp/manage.mjs` 版本管理服务器
- 智能体可直接调用 `zhongwen_status`、`zhongwen_rollback`、`zhongwen_upgrade` 等工具

## v2.1.0 · 2026-06-24 · 版本管理增强版

- 新增 `scripts/manage.ps1` 统一管理入口
- 支持 `status`、`snapshot`、`rollback`、`upgrade`、`history` 五个命令
- 版本快照存储在 `~/.config/opencode/versions/` 目录
- 每次回滚/升级前自动备份当前状态

## v2.0.0 · 2026-06-24 · 工程学约束版

- 新增 MCP 外部语言检查服务器（独立外部进程）
- 引入输出格式锁机制
- 五维约束升级为三层工程锁
- 会话级违规计数器（外部进程维护）
- 可配置的纯度阈值

## v1.0.0 · 2026-06-24 · 初始版本

- 基础中文规则文件（chinese-rules.md）
- Agent 定义文件（zhongwen-agent.md）
- 文本规则约束体系
