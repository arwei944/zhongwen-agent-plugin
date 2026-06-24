# zhongwen-agent-plugin

> 中文语言纯度高强度工程约束插件 · MCP 外部检查器 · 格式锁 · 递进惩戒

## 这是什么

这是一个为 opencode 设计的**工程级中文语言约束系统**。它不依赖模型的自觉性，而是从系统架构层面构建了一个**不可绕过、自动化、可度量**的语言检查闭环。

## 核心原理

传统的"在系统提示中写入规则"是**软约束**——模型可以选择忽略。本插件采用**三层工程锁**：

```
第一层 · MCP 外部检查器（不可绕过）
    ↓
第二层 · 系统提示文本约束（不可控层）
    ↓
第三层 · 可选工具自检（可控层）
```

### 第一层：MCP 语言检查服务器

- 一个独立于 AI 运行的 Node.js 进程
- 提供 `check_chinese_purity` 工具，实时分析文本的中文纯度
- AI 无法控制、无法绕过、无法关闭外部进程
- 会话级违规计数器在外部进程中维护，AI 无法自行重置
- **零干扰模式**：不要求 AI 调用工具，自动记录审计日志

### 第二层：系统提示文本约束

- Agent 定义和全局指令文件，opencode 在 API 层强制注入
- 模型无法阻止这些文件被加载到系统提示中
- 约束施加在**模型不可控的层面**

### 第三层：可选工具自检

- `check_chinese_purity` 工具可供模型自愿调用进行自我检查
- 不是强制要求，不影响正常输出流程
- **零干扰**：模型可以选择不使用该工具

## 文件结构

```
zhongwen-agent-plugin/
├── README.md                    ← 本文档
├── CHANGELOG.md                 ← 版本历史
├── chinese-rules.md             ← 全局指令文件
├── zhongwen-agent.md            ← Agent 定义文件
├── mcp/
│   ├── check_language.mjs       ← MCP 语言检查服务器
│   └── manage.mjs              ← 版本管理工具
├── scripts/
│   ├── install.ps1              ← 一键安装脚本
│   ├── rollback.ps1             ← 一键回滚脚本
│   └── upgrade.ps1              ← 一键升级脚本
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

1. AI 的思考块前三行会是中文锚定格式
2. AI 的输出末尾会包含 `【语言纯度检查：PASS | ...】`
3. 如果出现英文违规，AI 会自动重写直到通过检查

### 零干扰模式说明

新版本采用**零干扰模式**——检查系统在后台运行，不改变 AI 的：
- 思考内容
- 输出格式
- 工具调用行为

AI 正常完成工作，检查系统在旁路记录结果。用户可以通过审计日志查看违规记录。

## 技术细节

### MCP 协议

语言检查服务器使用 JSON-RPC 2.0 over stdio 协议，与 opencode 的 MCP 系统原生集成。

### 纯度计算

```
纯度 = (中文字符数 / (中文字符数 + 英文字符数)) × 100%
```

- PASS: 纯度 ≥ 90% 且无违规
- WARN: 纯度 70%~89%
- FAIL: 纯度 < 70% 或检测到英文违规

### 违规检测

- 完整英文句子（≥5 个英文单词 + 句尾标点）
- 英文逻辑连接词（however, therefore, actually...）
- 英文填充词（basically, actually, so, well...）
- 代码块默认跳过（可配置）

## 自定义

### 修改纯度阈值

编辑 `mcp/check_language.mjs`，修改 `analyzePurity` 函数中的阈值：

```javascript
// 第 ~340 行附近
if (report.violations.length > 0) {
  report.status = 'FAIL';
} else if (report.purity < 70) {  // ← 修改这里
  report.status = 'FAIL';
} else if (report.purity < 90) {  // ← 修改这里
  report.status = 'WARN';
}
```

### 添加自定义违规词

编辑 `mcp/check_language.mjs`，修改 `ENGLISH_FILLER_WORDS` 数组：

```javascript
const ENGLISH_FILLER_WORDS = [
  'however', 'therefore', 'actually',
  // 在这里添加你的词
  'your_word_here',
];
```

## 版本历史

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
