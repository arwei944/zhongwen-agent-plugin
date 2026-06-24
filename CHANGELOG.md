# 版本历史

## v2.1.0 · 2026-06-24 · 版本管理增强版

- 新增 `scripts/manage.ps1` 统一管理入口
- 支持 `status`、`snapshot`、`rollback`、`upgrade`、`history` 五个命令
- 版本快照存储在 `~/.config/opencode/versions/` 目录
- 每次回滚/升级前自动备份当前状态
- 一键回滚到任意历史版本
- 一键从 GitHub 拉取最新代码并安装
- 新增 `scripts/rollback.ps1` 和 `scripts/upgrade.ps1` 快捷脚本

### 使用方式

```powershell
.\scripts\manage.ps1 status       # 查看状态
.\scripts\manage.ps1 rollback     # 回滚到上一个版本
.\scripts\manage.ps1 upgrade      # 从 GitHub 升级
.\scripts\manage.ps1 history      # 查看版本历史
```

## v2.0.0 · 2026-06-24 · 工程学约束版

- 新增 MCP 语言检查服务器（独立外部进程）
- 引入输出格式锁机制
- 五维约束升级为三层工程锁
- 会话级违规计数器（外部进程维护）
- 可配置的纯度阈值
- 支持 Git 标签管理（v2.0.0）

## v1.0.0 · 2026-06-24 · 初始版本

- 基础中文规则文件（chinese-rules.md）
- Agent 定义文件（zhongwen-agent.md）
- 文本规则约束体系
