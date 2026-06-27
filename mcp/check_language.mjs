#!/usr/bin/env node

/**
 * zhongwen-agent · MCP 语言检查服务器 v4.8.0
 * 
 * 工程级零信任语言门卫系统。AI 无法绕过、无法控制、无法关闭。
 * 提供实时双向语言纯度检查、自动修复引擎、会话级状态机、自进化引擎。
 * 
 * 协议：JSON-RPC 2.0 over stdio
 */

import { createInterface } from 'readline';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { spawn, execSync } from 'child_process';

// ============================================================
// 配置与路径
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const WHITELIST_PATH = join(CONFIG_DIR, 'whitelist.json');
const VERSIONS_DIR = join(CONFIG_DIR, 'versions');
const MANIFEST_PATH = join(VERSIONS_DIR, 'manifest.json');
const PLUGIN_DIR = 'D:\\work\\opencode\\zhongwen-agent-plugin';

const MANAGED_FILES = [
  { source: join(PLUGIN_DIR, 'zhongwen-agent.md'), relPath: 'agents/zhongwen-agent.md' },
  { source: join(PLUGIN_DIR, 'chinese-rules.md'), relPath: 'chinese-rules.md' },
  { source: join(PLUGIN_DIR, 'mcp', 'check_language.mjs'), relPath: 'mcp/check_language.mjs' },
];

// ============================================================
// 白名单机制
// ============================================================

let WHITELIST = {
  allowed_terms: [
    'JWT', 'API', 'JSON', 'HTTP', 'HTTPS', 'URL', 'SQL', 'HTML',
    'Node.js', 'Python', 'Git', 'GitHub', 'npm', 'AI', 'MCP',
    'OpenAI', 'Step', 'GPT', 'zhongwen-agent'
  ],
  allowed_patterns: [
    '^[A-Z]{2,8}$',
    '^[a-z]+\\.[a-z]+$',
    '^v\\d+\\.\\d+\\.\\d+$'
  ],
  check_comments: true,
  thresholds: { purity_pass: 95, purity_warn: 80 }
};

function loadWhitelist() {
  try {
    if (existsSync(WHITELIST_PATH)) {
      const custom = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
      WHITELIST = { ...WHITELIST, ...custom };
    }
  } catch (e) {
    // 使用默认白名单
  }
}

loadWhitelist();

function isWhitelisted(word) {
  if (WHITELIST.allowed_terms.includes(word)) return true;
  for (const pattern of WHITELIST.allowed_patterns) {
    if (new RegExp(pattern).test(word)) return true;
  }
  return false;
}

// ============================================================
// 版本管理功能（从独立 MCP 合并而来）
// ============================================================

function logMessage(msg) {
  console.error(`[zhongwen-mcp] ${msg}`);
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return { current_version: null, versions: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    return { current_version: null, versions: [] };
  }
}

function writeManifest(manifest) {
  if (!existsSync(VERSIONS_DIR)) mkdirSync(VERSIONS_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

function getFileInfo(filePath) {
  try {
    const stats = statSync(filePath);
    return { exists: true, size: stats.size, modified: stats.mtime.toISOString() };
  } catch (e) {
    return { exists: false, size: 0, modified: null };
  }
}

function createSnapshot(versionName) {
  const snapshotDir = join(VERSIONS_DIR, versionName);
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });

  const snapshotFiles = [];
  for (const file of MANAGED_FILES) {
    const deployedPath = join(CONFIG_DIR, file.relPath);
    const snapshotPath = join(snapshotDir, file.relPath);
    const snapDir = dirname(snapshotPath);
    if (!existsSync(snapDir)) mkdirSync(snapDir, { recursive: true });

    if (existsSync(deployedPath)) {
      copyFileSync(deployedPath, snapshotPath);
      const info = getFileInfo(deployedPath);
      snapshotFiles.push({ path: file.relPath, size: info.size, modified: info.modified });
    }
  }

  // 备份 opencode.json
  const configPath = join(CONFIG_DIR, 'opencode.json');
  if (existsSync(configPath)) {
    copyFileSync(configPath, join(snapshotDir, 'opencode.json'));
  }

  return { version: versionName, files: snapshotFiles, location: snapshotDir };
}

function doRollback(targetVersion) {
  const manifest = readManifest();
  const versions = manifest.versions || [];
  const currentVersion = manifest.current_version || 'unknown';

  const target = versions.find(v => v.version === targetVersion);
  if (!target) {
    return { success: false, error: `版本 ${targetVersion} 不存在` };
  }

  const targetDir = join(VERSIONS_DIR, targetVersion);
  if (!existsSync(targetDir)) {
    return { success: false, error: `版本目录不存在: ${targetDir}` };
  }

  // 创建当前状态备份
  const backupVersion = `pre-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  createSnapshot(backupVersion);

  // 从快照恢复文件
  let restoredCount = 0;
  for (const file of MANAGED_FILES) {
    const snapshotPath = join(targetDir, file.relPath);
    const targetPath = join(CONFIG_DIR, file.relPath);
    if (existsSync(snapshotPath)) {
      const targetDirPath = dirname(targetPath);
      if (!existsSync(targetDirPath)) mkdirSync(targetDirPath, { recursive: true });
      copyFileSync(snapshotPath, targetPath);
      restoredCount++;
    }
  }

  // 恢复 opencode.json
  const snapshotConfig = join(targetDir, 'opencode.json');
  const configPath = join(CONFIG_DIR, 'opencode.json');
  if (existsSync(snapshotConfig)) {
    copyFileSync(snapshotConfig, configPath);
    restoredCount++;
  }

  // 更新 manifest
  manifest.current_version = targetVersion;
  manifest.last_updated = new Date().toISOString();
  writeManifest(manifest);

  logMessage(`回滚完成: ${currentVersion} -> ${targetVersion}`);

  return {
    success: true,
    from_version: currentVersion,
    to_version: targetVersion,
    files_restored: restoredCount,
    backup_created: backupVersion
  };
}

function doUpgrade(autoMode = false) {
  const manifest = readManifest();
  const currentVersion = manifest.current_version || 'unknown';

  // 创建备份
  const backupVersion = `pre-upgrade-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  createSnapshot(backupVersion);

  // Git 拉取
  try {
    execSync('git pull origin master', { cwd: PLUGIN_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git fetch --tags', { cwd: PLUGIN_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return { success: false, error: `Git 操作失败: ${e.message}` };
  }

  // 安装更新后的文件
  let installedCount = 0;
  for (const file of MANAGED_FILES) {
    const targetPath = join(CONFIG_DIR, file.relPath);
    const targetDirPath = dirname(targetPath);
    if (!existsSync(targetDirPath)) mkdirSync(targetDirPath, { recursive: true });
    if (existsSync(file.source)) {
      copyFileSync(file.source, targetPath);
      installedCount++;
    }
  }

  // 获取最新版本号
  let newVersion = 'unknown';
  try {
    const tags = execSync('git tag -l', { cwd: PLUGIN_DIR, encoding: 'utf8' })
      .trim().split('\n').filter(t => t);
    newVersion = tags.pop() || 'unknown';
  } catch (e) { /* ignore */ }

  // 自动同步版本化配置（opencode.json / opencode.jsonc）
  let configUpdated = false;
  try {
    const agentSource = join(PLUGIN_DIR, 'zhongwen-agent.md');
    const agentContent = readFileSync(agentSource, 'utf8');
    const versionMatch = agentContent.match(/version:\s*"([^"]+)"/);
    const detectedVersion = versionMatch ? versionMatch[1] : newVersion;
    
    const agentName = `zhongwen-agent-${detectedVersion}`;
    const mcpName = `zhongwen-language-checker-${detectedVersion}`;
    const mcpTarget = join(CONFIG_DIR, 'mcp', 'check_language.mjs');
    
    // 更新 opencode.json 或 opencode.jsonc
    const configPathJson = join(CONFIG_DIR, 'opencode.json');
    const configPathJsonc = join(CONFIG_DIR, 'opencode.jsonc');
    const actualConfigPath = existsSync(configPathJsonc) ? configPathJsonc : (existsSync(configPathJson) ? configPathJson : null);
    
    if (actualConfigPath) {
      const config = JSON.parse(readFileSync(actualConfigPath, 'utf8'));
      
      // 移除旧版本 MCP 配置
      const oldMcps = Object.keys(config.mcp || {}).filter(k => 
        k.startsWith('zhongwen-language-checker') || k.startsWith('zhongwen-version-manager')
      );
      oldMcps.forEach(k => delete config.mcp[k]);
      
      // 添加新版本 MCP 配置
      config.mcp[mcpName] = {
        type: 'local',
        command: ['node', mcpTarget],
        enabled: true,
        version: detectedVersion
      };
      
      // 更新 agent 名称
      config.default_agent = agentName;
      
      // 保存
      writeFileSync(actualConfigPath, JSON.stringify(config, null, 2), 'utf8');
      configUpdated = true;
    }
  } catch (e) {
    logMessage(`自动配置同步失败: ${e.message}`);
  }

  // 创建新状态快照
  const newSnapshotVersion = `${newVersion}-installed`;
  createSnapshot(newSnapshotVersion);

  // 更新 manifest
  manifest.current_version = newVersion;
  manifest.last_updated = new Date().toISOString();
  writeManifest(manifest);

  logMessage(`升级完成: ${currentVersion} -> ${newVersion}`);

  return {
    success: true,
    previous_version: currentVersion,
    new_version: newVersion,
    files_updated: installedCount,
    config_updated: configUpdated,
    backup_created: backupVersion
  };
}

// ============================================================
// 修复建议映射（自动修复引擎）
// ============================================================

const FIX_SUGGESTIONS = {
  'let me': '让我',
  'i need to': '我需要',
  'i want to': '我想要',
  'i will': '我将',
  'first of all': '首先',
  'first': '首先',
  'second': '其次',
  'third': '第三',
  'last': '最后',
  'as a result': '因此',
  'in other words': '也就是说',
  'on the other hand': '另一方面',
  'for example': '例如',
  'for instance': '比如',
  'in addition': '此外',
  'edge case': '边界情况',
  'fallback': '回退机制',
  'approach': '方法',
  'scenario': '场景',
  'perspective': '视角',
  'constraint': '约束条件',
  'trade-off': '权衡',
  'actually': '实际上',
  'basically': '基本上',
  'however': '然而',
  'therefore': '因此',
  'moreover': '此外',
  'furthermore': '此外',
  'instead': '取而代之',
  'rather': '相当',
  'otherwise': '否则',
  'nevertheless': '然而',
  'nonetheless': '然而',
  'consequently': '因此',
  'accordingly': '相应地',
  'meanwhile': '同时',
  'hence': '因此',
  'thus': '因此',
  'indeed': '确实',
  'notably': '尤其',
  'similarly': '类似地',
  'thereafter': '此后',
  'thereby': '从而',
  'whereas': '然而',
  'whereby': '借此',
  'lastly': '最后',
  'firstly': '首先',
  'secondly': '其次',
  'thirdly': '第三',
  'so': '所以',
  'well': '嗯',
  'now': '现在',
  'then': '然后',
  'also': '也',
  'but': '但是',
  'yet': '然而',
  'this': '这个',
  'that': '那个',
  'these': '这些',
  'those': '那些',
  'the': '这个/那个',
  'a': '一个',
  'an': '一个',
  'is': '是',
  'are': '是',
  'was': '是',
  'were': '是',
  'will': '将',
  'can': '可以',
  'could': '可以',
  'should': '应该',
  'would': '将会',
  'must': '必须',
  'have': '有',
  'has': '有',
  'had': '有',
  'do': '做',
  'does': '做',
  'did': '做',
  'it': '它',
  'he': '他',
  'she': '她',
  'they': '他们',
  'we': '我们',
  'i': '我',
  'you': '你',
  'me': '我',
  'him': '他',
  'her': '她',
  'us': '我们',
  'them': '他们',
};

function getFixSuggestion(englishText) {
  const lower = englishText.toLowerCase().trim();
  if (FIX_SUGGESTIONS[lower]) return FIX_SUGGESTIONS[lower];
  // 尝试部分匹配
  for (const [key, value] of Object.entries(FIX_SUGGESTIONS)) {
    if (lower.includes(key) || key.includes(lower)) {
      return value;
    }
  }
  return '';
}

// ============================================================
// 语言分析核心算法
// ============================================================

/** 中文字符 Unicode 范围 */
const CJK_RANGES = [
  [0x4E00, 0x9FFF],   // CJK 统一表意文字
  [0x3400, 0x4DBF],   // CJK 统一表意文字扩展 A
  [0xF900, 0xFAFF],   // CJK 兼容表意文字
  [0x2F800, 0x2FA1F], // CJK 兼容表意文字补充
];

/** 检测字符是否为中文 */
function isChineseChar(code) {
  return CJK_RANGES.some(([start, end]) => code >= start && code <= end);
}

/** 检测字符是否为英文字母 */
function isEnglishChar(code) {
  return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A);
}

/** 标记的英文填充词列表 */
const ENGLISH_FILLER_WORDS = [
  'however', 'therefore', 'actually', 'basically', 'moreover', 'furthermore',
  'nevertheless', 'nonetheless', 'consequently', 'accordingly', 'meanwhile',
  'hence', 'thus', 'indeed', 'instead', 'likewise', 'moreover', 'notably',
  'otherwise', 'rather', 'regardless', 'similarly', 'thereafter', 'thereby',
  'whereas', 'whereby', 'further', 'lastly', 'firstly', 'secondly', 'thirdly',
  'so', 'well', 'now', 'then', 'also', 'but', 'yet', 'thus', 'hence',
];

/** 英文逻辑连接词（完整短语/句子） */
const ENGLISH_PATTERNS = [
  /\blet\s+(me|us)\b/i,
  /\bi\s+(need|want|have|will|would|can|could|shall|should|must|am|was)\b/i,
  /\b(this|that|these|those)\s+(is|are|was|were|will|can|could)\b/i,
  /\bin\s+(other\s+words|summary|conclusion|short|particular|general)\b/i,
  /\b(on\s+the\s+other\s+hand|as\s+a\s+result|in\s+addition|for\s+example|for\s+instance)\b/i,
  /\bit\s+(is|was|will|can|could|should|would|seems|appears)\b/i,
  /\bthe\s+(first|second|third|last|next|main|key|primary|best|worst)\b/i,
];

/**
 * 检测中英混合短语
 * 
 * @param {string} line - 单行文本
 * @returns {Array} 过渡点数组
 */
function detectMixedPhrases(line) {
  const transitions = [];
  let lastType = null;
  for (const ch of line) {
    const code = ch.codePointAt(0);
    const type = isChineseChar(code) ? 'zh' : isEnglishChar(code) ? 'en' : null;
    if (type && lastType && type !== lastType) {
      transitions.push({ from: lastType, to: type, char: ch });
    }
    lastType = type;
  }
  return transitions;
}

/**
 * 检查代码块注释行
 * 
 * @param {string} line - 代码行
 * @returns {boolean} 是否为注释行
 */
function isCommentLine(line) {
  const trimmed = line.trimStart();
  return /^(\/\/|#|;|\/\*|\*|<!--|--|{-#|#-})/.test(trimmed);
}

/**
 * 在文本中检测英文违规（句子/模式/填充词/混合短语）
 * 
 * @param {string} text - 要检查的文本
 * @param {number} lineNumber - 行号
 * @param {object} report - 纯度分析报告对象
 */
function checkEnglishInText(text, lineNumber, report) {
  // 跳过 think 块的标准中文锚定文本
  const trimmed = text.trim();
  if (/^【.*?】/.test(trimmed) && /[\u4e00-\u9fff]/.test(trimmed)) {
    const anchorKeywords = ['中文思维已激活', '思维锚定激活', '语言纯度承诺', '当前任务', '检查承诺', '禁止声明', '纯度承诺'];
    const hasAnchorKeyword = anchorKeywords.some(kw => trimmed.includes(kw));
    if (hasAnchorKeyword) {
      return; // 跳过 think 块锚定行
    }
  }

  const englishWords = text.match(/\b[a-zA-Z]+\b/g) || [];
  
  // 过滤白名单术语
  const filteredWords = englishWords.filter(w => !isWhitelisted(w));
  
  if (filteredWords.length >= 1) {
    const joined = filteredWords.join(' ');
    const hasEnglishEnding = /[.!?]$/.test(text.trim());
    const hasEnglishStart = /^[A-Z]/.test(text.trim());

    if (hasEnglishEnding || filteredWords.length >= 3) {
      const suggestion = getFixSuggestion(joined);
      report.violations.push({
        line: lineNumber,
        type: 'english_sentence',
        content: text.trim().substring(0, 120),
        wordCount: filteredWords.length,
        suggestion: suggestion,
      });
      report.englishSegments.push(text.trim());
    }

    // 检查英文逻辑连接词
    for (const pattern of ENGLISH_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const suggestion = getFixSuggestion(match[0]);
        report.violations.push({
          line: lineNumber,
          type: 'english_pattern',
          content: match[0],
          context: text.trim().substring(0, 100),
          suggestion: suggestion,
        });
        break;
      }
    }
  }

  // 检查英文填充词（白名单过滤后）
  for (const word of ENGLISH_FILLER_WORDS) {
    if (isWhitelisted(word)) continue;
    const regex = new RegExp('\\b' + word + '\\b', 'i');
    if (regex.test(text)) {
      const suggestion = getFixSuggestion(word);
      report.violations.push({
        line: lineNumber,
        type: 'english_filler',
        content: word,
        context: text.trim().substring(0, 100),
        suggestion: suggestion,
      });
    }
  }

  // 检查中英混合短语
  if (filteredWords.length > 0 && filteredWords.length < 5) {
    const transitions = detectMixedPhrases(text);
    if (transitions.length >= 3) {
      report.violations.push({
        line: lineNumber,
        type: 'mixed_phrase',
        content: text.trim().substring(0, 120),
        transition_count: transitions.length,
        suggestion: '考虑将英文片段替换为中文表达',
      });
    }
  }
}

/**
 * 分析文本的语言纯度
 * 
 * @param {string} text - 要分析的文本
 * @param {object} options - 配置选项
 * @param {boolean} options.codeBlockMode - true=跳过代码块内的检查
 * @returns {object} 纯度分析报告
 */
function analyzePurity(text, options = {}) {
  const report = {
    totalChars: 0,
    chineseChars: 0,
    englishChars: 0,
    digitChars: 0,
    spaceChars: 0,
    otherChars: 0,
    purity: 0,
    violations: [],
    englishSegments: [],
    status: 'unknown',
    details: '',
  };

  // 分段处理：区分代码块和自然语言
  const lines = text.split('\n');
  let inCodeBlock = false;
  let currentLine = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测代码块开始/结束
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // 代码块处理：根据配置决定是否跳过
    if (inCodeBlock && options.codeBlockMode) {
      // 如果启用了注释检查，仍然检查注释行
      if (WHITELIST.check_comments && isCommentLine(line)) {
        const commentText = line.replace(/^(\/\/|#|;|\/\*|\*|<!--|--|{-#|#-})\s*/, '');
        checkEnglishInText(commentText, i + 1, report);
      }
      continue;
    }

    currentLine = line;
    const chars = [...currentLine];

    // 统计字符
    for (const ch of chars) {
      const code = ch.codePointAt(0);
      report.totalChars++;

      if (isChineseChar(code)) {
        report.chineseChars++;
      } else if (isEnglishChar(code)) {
        report.englishChars++;
      } else if (code >= 0x30 && code <= 0x39) {
        report.digitChars++;
      } else if (code === 0x20 || code === 0x09) {
        report.spaceChars++;
      } else {
        report.otherChars++;
      }
    }

    // 检测英文违规（句子/模式/填充词/混合短语）
    if (report.englishChars > 0) {
      checkEnglishInText(currentLine, i + 1, report);
    }
  }

  // 计算纯度
  const meaningfulChars = report.chineseChars + report.englishChars;
  if (meaningfulChars > 0) {
    report.purity = Math.round((report.chineseChars / meaningfulChars) * 10000) / 100;
  } else {
    report.purity = 100; // 没有中英文字符默认100%
  }

  // 判定状态（v4.0.0 阻断式门卫）
  if (report.violations.length > 0) {
    report.status = 'BLOCKED';
    const violationSummary = report.violations
      .slice(0, 5)
      .map(v => `第${v.line}行: [${v.type}] ${v.content}`)
      .join('\n');
    report.details = `【输出被阻断】发现 ${report.violations.length} 处违规，必须修复后才能输出：\n${violationSummary}`;
  } else if (report.purity < 70) {
    report.status = 'BLOCKED';
    report.details = `【输出被阻断】中文纯度 ${report.purity}% 低于 70% 阈值，必须修复`;
  } else if (report.purity < 95) {
    report.status = 'WARN';
    report.details = `中文纯度 ${report.purity}%，建议提高至 95% 以上`;
  } else {
    report.status = 'PASS';
    report.details = `中文纯度 ${report.purity}%，无违规，状态良好。`;
  }

  return report;
}

// ============================================================
// 会话级状态机
// ============================================================

const sessionState = {
  violations: 0,
  checks: 0,
  startTime: Date.now(),
  purityHistory: [], // 纯度历史记录，用于漂移检测
  lastDriftWarning: 0, // 上次漂移警告时间
  lastEvolutionTime: 0, // 上次自进化时间
};

function recordViolation() {
  sessionState.violations++;
  
  // 自进化引擎：重度违规时自动触发升级（防抖动：10分钟内不重复触发）
  if (sessionState.violations >= 4) {
    const now = Date.now();
    if (now - sessionState.lastEvolutionTime > 600000) { // 10分钟冷却
      triggerSelfEvolution();
      sessionState.lastEvolutionTime = now;
    }
  }
}

function recordCheck() {
  sessionState.checks++;
}

function getSessionStatus() {
  const now = Date.now();
  const uptime = Math.floor((now - sessionState.startTime) / 1000);
  
  // 根据违规次数确定等级
  let severity = 'none';
  let message = '';
  let evolutionTriggered = false;
  if (sessionState.violations === 1) {
    severity = 'light';
    message = '轻度违规，下次回答需附加简短反省';
  } else if (sessionState.violations >= 2 && sessionState.violations <= 3) {
    severity = 'medium';
    message = '中度违规，下次回答需附加 ≥100 字反省及 3 条改正措施';
  } else if (sessionState.violations >= 4) {
    severity = 'heavy';
    message = '重度违规，下次回答需附加完整改正报告';
    evolutionTriggered = true;
  }
  
  // 漂移检测：检查最近纯度是否持续下降
  let driftWarning = null;
  if (sessionState.purityHistory.length >= 3) {
    const recent = sessionState.purityHistory.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const maxEarlier = Math.max(...sessionState.purityHistory.slice(0, -3));
    
    if (avgRecent < maxEarlier - 10) {
      driftWarning = `检测到漂移：近期平均纯度 ${avgRecent.toFixed(1)}%，低于历史最高 ${maxEarlier.toFixed(1)}%。请立即回到中文思维模式。`;
    }
  }
  
  return {
    status: 'ACTIVE',
    severity,
    message,
    driftWarning,
    evolutionTriggered,
    totalChecks: sessionState.checks,
    totalViolations: sessionState.violations,
    uptime,
  };
}

// ============================================================
// MCP 服务器
// ============================================================

const rl = createInterface({ input: process.stdin });

/**
 * 发送 JSON-RPC 响应
 */
function sendResponse(id, result, error = null) {
  const response = { jsonrpc: '2.0', id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * 发送 JSON-RPC 通知（无 id）
 */
function sendNotification(method, params) {
  const notification = {
    jsonrpc: '2.0',
    method,
    params,
  };
  process.stdout.write(JSON.stringify(notification) + '\n');
}

/**
 * 处理收到的 JSON-RPC 请求
 */
function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    // -------- 初始化握手 --------
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          prompts: {},
          resources: {},
        },
        serverInfo: {
          name: 'zhongwen-language-checker',
          version: '4.8.0',
        },
      });
      break;

    // -------- 通知已初始化 --------
    case 'notifications/initialized':
      sendResponse(id, { ok: true });
      break;

    // -------- 列出工具 --------
    case 'tools/list':
      sendResponse(id, {
        tools: [
          {
            name: 'check_chinese_purity',
            description: `【工程级工具】检查文本的中文语言纯度。\n\n这个工具由一个外部独立进程运行，AI 无法绕过它的检查。\n它会分析文本中中文、英文的比例，检测英文句子、英文逻辑连接词、英文填充词等违规。\n返回通过/警告/阻断状态，以及详细的违规报告。\n当状态为 BLOCKED 时，AI 禁止输出，必须修复后重新检查。\n注意：任何非白名单英文单词都会触发 BLOCKED。`,
            inputSchema: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: '要检查的文本内容',
                },
                codeBlockMode: {
                  type: 'boolean',
                  description: '是否跳过代码块内的检查（默认 true）',
                  default: true,
                },
              },
              required: ['text'],
            },
          },
          {
            name: 'get_session_stats',
            description: '获取当前会话的语言检查统计数据，包括总检查次数、违规次数、时间等。',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'reset_session_stats',
            description: '重置当前会话的违规计数器（谨慎使用，需要确认）。',
            inputSchema: {
              type: 'object',
              properties: {
                confirm: {
                  type: 'boolean',
                  description: '确认重置，必须为 true',
                },
              },
              required: ['confirm'],
            },
          },
          {
            name: 'zhongwen_status',
            description: '查看 zhongwen-agent 插件的当前状态，包括版本、文件部署状态、MCP 配置等。',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'zhongwen_snapshot',
            description: '创建当前状态的版本快照，以便后续回滚。',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '快照名称（可选，默认自动生成时间戳）' }
              }
            }
          },
          {
            name: 'zhongwen_rollback',
            description: '回滚到指定版本。回滚前会自动创建当前状态的备份。',
            inputSchema: {
              type: 'object',
              properties: {
                target_version: { type: 'string', description: '目标版本（可选，默认回滚到上一个版本）' }
              }
            }
          },
          {
            name: 'zhongwen_upgrade',
            description: '从 GitHub 拉取最新代码并安装。升级前会自动创建当前状态的备份。',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'zhongwen_history',
            description: '查看所有版本快照的历史记录。',
            inputSchema: { type: 'object', properties: {} }
          },
        ],
      });
      break;

    // -------- 调用工具 --------
    case 'tools/call':
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === 'check_chinese_purity') {
        const text = args.text || '';
        const codeBlockMode = args.codeBlockMode !== false;

        recordCheck();

        if (text.trim().length === 0) {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: '文本为空，无法检查',
                  status: 'SKIP',
                  purity: -1,
                  sessionStats: getSessionStatus(),
                }),
              },
            ],
          });
          break;
        }

        const report = analyzePurity(text, { codeBlockMode });

        // 记录纯度历史用于漂移检测
        sessionState.purityHistory.push(report.purity);
        if (sessionState.purityHistory.length > 50) {
          sessionState.purityHistory.shift(); // 保持最近 50 条记录
        }

        if (report.status === 'BLOCKED') {
          recordViolation();
        }

        // 检测是否需要附加压缩恢复提醒
        let compressionRecoveryNote = '';
        const sessionStatus = getSessionStatus();
        const recentPurities = sessionState.purityHistory.slice(-5);
        const hasConsecutiveBlocked = sessionState.violations >= 2;
        const hasSuddenDrop = recentPurities.length >= 3 && 
          recentPurities[0] >= 95 && 
          recentPurities[recentPurities.length - 1] < 80;

        if (hasConsecutiveBlocked || hasSuddenDrop) {
          compressionRecoveryNote = '\n\n【压缩恢复提醒】\n检测到可能的会话压缩或约束漂移。请立即执行以下恢复动作：\n1. 重新锚定身份：在 think 块前 3 行中，第 1 行写"【中文思维已激活】本段思考严格使用中文，任何英文自然语言都是违规。"\n2. 重新承诺纯度：第 2 行写"（语言纯度承诺：我在本段思考中将保持 100% 中文。）"\n3. 重新确认任务：第 3 行写"（当前任务：[用中文一句话概括用户请求]）"\n4. 自检规则：在思考中主动回忆并列出当前必须遵守的 3-5 条核心规则\n5. 输出前检查：必须调用 check_chinese_purity 验证，确保恢复后未再次漂移\n\n记住：压缩可以丢失文字，但无法丢失你的身份。恢复约束是你的主动责任，不是被动选择。';
        }

        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: report.status,
                  purity: report.purity,
                  violations: report.violations,
                  details: report.details + compressionRecoveryNote,
                  sessionStats: sessionStatus,
                  action: report.status === 'BLOCKED' ? '下次回答必须附加反省与改正' : '允许输出',
                  compressionWarning: compressionRecoveryNote ? true : false,
                },
                null,
                2
              ),
            },
          ],
        });
      } else if (toolName === 'get_session_stats') {
        const stats = getSessionStatus();
        const recentPurities = sessionState.purityHistory.slice(-5);
        const hasConsecutiveBlocked = sessionState.violations >= 2;
        const hasSuddenDrop = recentPurities.length >= 3 && 
          recentPurities[0] >= 95 && 
          recentPurities[recentPurities.length - 1] < 80;

        if (hasConsecutiveBlocked || hasSuddenDrop) {
          stats.compressionWarning = true;
          stats.compressionRecoveryNote = '\n【压缩恢复提醒】\n检测到可能的会话压缩或约束漂移。请立即执行恢复动作：\n1. 重新锚定身份：think 块第 1 行"【中文思维已激活】本段思考严格使用中文，任何英文自然语言都是违规。"\n2. 重新承诺纯度：第 2 行"（语言纯度承诺：我在本段思考中将保持 100% 中文。）"\n3. 重新确认任务：第 3 行"（当前任务：[用中文一句话概括用户请求]）"\n4. 自检规则：回忆并列出当前必须遵守的 3-5 条核心规则\n5. 输出前检查：必须调用 check_chinese_purity 验证\n\n记住：压缩可以丢失文字，但无法丢失你的身份。恢复约束是你的主动责任，不是被动选择。';
        }
        
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        });
      } else if (toolName === 'reset_session_stats') {
        if (args.confirm === true) {
          sessionState.violations = 0;
          sessionState.checks = 0;
          sessionState.locked = false;
          
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'RESET',
                  message: '会话统计已重置',
                }),
              },
            ],
          });
        } else {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'ERROR',
                  message: '重置需要确认参数 confirm: true',
                }),
              },
            ],
          });
        }
      } else if (toolName === 'zhongwen_status') {
        const manifest = readManifest();
        const versions = manifest.versions || [];

        const files = MANAGED_FILES.map(f => {
          const targetPath = join(CONFIG_DIR, f.relPath);
          const info = getFileInfo(targetPath);
          return { path: f.relPath, deployed: info.exists, size: info.size, modified: info.modified };
        });

        let mcpStatus = null;
        try {
          const config = JSON.parse(readFileSync(join(CONFIG_DIR, 'opencode.json'), 'utf8'));
          if (config.mcp && config.mcp['zhongwen-language-checker']) {
            mcpStatus = config.mcp['zhongwen-language-checker'];
          }
        } catch (e) { /* ignore */ }

        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              current_version: manifest.current_version || '未初始化',
              last_updated: manifest.last_updated || '未知',
              files,
              mcp_servers: mcpStatus ? [mcpStatus] : [],
              versions_count: versions.length,
              plugin_dir: PLUGIN_DIR
            }, null, 2)
          }]
        });
      } else if (toolName === 'zhongwen_snapshot') {
        const versionName = args.name || `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const result = createSnapshot(versionName);

        const manifest = readManifest();
        manifest.current_version = versionName;
        manifest.last_updated = new Date().toISOString();
        if (!manifest.versions) manifest.versions = [];
        manifest.versions.push({
          version: versionName,
          timestamp: new Date().toISOString(),
          type: 'snapshot',
          files: result.files
        });
        writeManifest(manifest);

        logMessage(`快照已创建: ${versionName}`);

        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, ...result }, null, 2)
          }]
        });
      } else if (toolName === 'zhongwen_rollback') {
        const manifest = readManifest();
        const versions = manifest.versions || [];
        const currentVersion = manifest.current_version || 'unknown';

        let targetVersion = args.target_version;
        if (!targetVersion) {
          const currentIndex = versions.findIndex(v => v.version === currentVersion);
          if (currentIndex <= 0) {
            sendResponse(id, {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: false, error: '没有更早的版本可以回滚' }, null, 2)
              }]
            });
            break;
          }
          targetVersion = versions[currentIndex - 1].version;
        }

        const result = doRollback(targetVersion);

        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        });
      } else if (toolName === 'zhongwen_upgrade') {
        const autoMode = args.auto === true;
        const result = doUpgrade(autoMode);

        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        });
      } else if (toolName === 'zhongwen_history') {
        const manifest = readManifest();
        const versions = (manifest.versions || []).map(v => ({
          version: v.version,
          timestamp: v.timestamp,
          type: v.type || 'snapshot',
          files_count: v.files ? v.files.length : 0
        }));

        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              current_version: manifest.current_version,
              total_versions: versions.length,
              versions: versions.reverse()
            }, null, 2)
          }]
        });
      } else {
        sendResponse(id, null, {
          code: -32601,
          message: `未知工具: ${toolName}`,
        });
      }
      break;

    // -------- 其他方法 --------
    default:
      sendResponse(id, null, {
        code: -32601,
        message: `不支持的请求方法: ${method}`,
      });
  }
}

// 主循环：逐行读取 stdin 并处理 JSON-RPC 请求
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    handleRequest(request);
  } catch (err) {
    // 不是有效的 JSON，忽略
  }
});

// ============================================================
// 自进化引擎（重度违规自动升级）
// ============================================================

/**
 * 触发自进化：直接调用内置升级函数
 */
function triggerSelfEvolution() {
  try {
    // 异步执行升级，不阻塞主流程
    setTimeout(() => {
      try {
        const result = doUpgrade(true);
        console.error('[zhongwen-mcp] 自进化引擎已触发：检测到重度违规，正在自动升级...');
        console.error('[zhongwen-mcp] 升级结果:', JSON.stringify(result));
      } catch (e) {
        console.error('[zhongwen-mcp] 自进化引擎异常:', e.message);
      }
    }, 100);
  } catch (e) {
    console.error('[zhongwen-mcp] 自进化引擎异常:', e.message);
  }
}

// 进程退出处理
process.on('SIGINT', () => {
  process.exit(0);
});
process.on('SIGTERM', () => {
  process.exit(0);
});

export {
  analyzePurity
};

// 服务器就绪通知
console.error('[zhongwen-mcp] 语言检查服务器 v4.0.0 已启动');

