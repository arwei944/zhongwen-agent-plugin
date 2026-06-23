# zhongwen-agent-plugin

> 中文语言纯度高强度工程约束插件 · MCP 外部检查器 · 格式锁 · 递进惩戒

## 这是什么

这是一个为 opencode 设计的**工程级中文语言约束系统**。它不依赖模型的自觉性，而是从系统架构层面构建了一个**不可绕过、自动化、可度量**的语言检查闭环。

## 核心原理

传统的"在系统提示中写入规则"是**软约束**——模型可以选择忽略。本插件采用**三层工程锁**：

```
第一层 · MCP 外部检查器（不可绕过）
    ↓
第二层 · 输出格式锁（破坏格式=无效输出）
    ↓
第三层 · 系统提示文本约束（最后防线）
```

### 第一层：MCP 语言检查服务器

- 一个独立于 AI 运行的 Node.js 进程
- 提供 `check_chinese_purity` 工具，实时分析文本的中文纯度
- AI 无法控制、无法绕过、无法关闭外部进程
- 会话级违规计数器在外部进程中维护，AI 无法自行重置

### 第二层：输出格式锁

- Agent 系统提示中强制规定：每次回答末尾必须包含检查结果
- 格式：`【语言纯度检查：PASS | 纯度：XX% | 违规数：X | 检查次数：X】`
- 检查 FAIL → 必须重写直到 PASS
- 跳过检查 = 输出格式不合格 = 无效回答

### 第三层：强效文本约束

- 强制思考前三行格式
- 句式绑定（禁止英文连接词）
- 递进惩戒（警告→反省→重建→重置）
- 代码块边界管理

## 文件结构

```
zhongwen-agent-plugin/
├── README.md                    ← 本文档
├── CHANGELOG.md                 ← 版本历史
├── chinese-rules.md             ← 全局指令文件（第二层防御）
├── zhongwen-agent.md            ← Agent 定义文件（第三层防御 + 格式锁）
├── mcp/
│   └── check_language.mjs       ← MCP 语言检查服务器（第一层防御）
└── scripts/
    └── install.ps1              ← 一键安装脚本（Windows PowerShell）
```

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
