#!/usr/bin/env node

/**
 * zhongwen-agent · MCP 语言检查服务器
 * 
 * 外部位独立进程，提供语言纯度检查工具。
 * AI 无法绕过此检查——检查逻辑在独立进程中运行。
 * 
 * 使用方式：通过 opencode 的 mcp 配置自动加载
 * 
 * 协议：JSON-RPC 2.0 over stdio
 */

import { createInterface } from 'readline';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
  initDatabase,
  createSession,
  endSession,
  updateSessionStats,
  getSessionStats,
  insertCheck,
  insertViolations,
  getDashboardData,
  hashText,
  calculateQualityScore
} from './database.mjs';
import { rotateLogs } from './log-rotation.mjs';

// ============================================================
// 配置与路径
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const AUDIT_LOG_PATH = join(CONFIG_DIR, 'logs', 'language-audit.log');
const AUDIT_VIOLATIONS_LOG = join(CONFIG_DIR, 'logs', 'audit-violations.log');
const WHITELIST_PATH = join(CONFIG_DIR, 'whitelist.json');

// ============================================================
// 白名单机制
// ============================================================

let WHITELIST = {
  allowed_terms: ['JWT', 'API', 'REST', 'HTTP', 'HTTPS', 'URL', 'JSON', 'SQL', 'NoSQL', 'CSS', 'HTML', 'XML', 'SDK', 'CLI', 'IDE', 'OAuth', 'TCP', 'IP', 'DNS', 'SSH', 'FTP', 'Git', 'GitHub', 'npm', 'Node.js', 'TypeScript', 'JavaScript', 'Python', 'PowerShell', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP'],
  allowed_patterns: ['^[A-Z]{2,8}$', '^[a-z]+\\.[a-z]+$', '^v\\d+\\.\\d+$'],
  check_comments: true,
  thresholds: { purity_pass: 90, purity_warn: 70 }
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
// 修复建议映射
// ============================================================

const FIX_SUGGESTIONS = {
  'let me': '让我',
  'i need to': '我需要',
  'i want to': '我想要',
  'first of all': '首先',
  'first': '首先',
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
// 审计日志
// ============================================================

function writeAuditLog(report, context = 'unknown', sessionId = null) {
  // 仅记录违规项到审计日志
  if (report.status !== 'FAIL') {
    return; // 非违规不记录
  }
  
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    context,
    status: report.status,
    purity: report.purity,
    violations_count: report.violations ? report.violations.length : 0,
    details: report.details ? report.details.substring(0, 200) : ''
  };
  
  // 写入违规日志（audit-violations.log）
  try {
    if (!existsSync(dirname(AUDIT_VIOLATIONS_LOG))) {
      mkdirSync(dirname(AUDIT_VIOLATIONS_LOG), { recursive: true });
    }
    writeFileSync(AUDIT_VIOLATIONS_LOG, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch (e) {
    // 写入失败不影响主流程
  }
  
  // 写入旧格式日志（保持向后兼容）
  try {
    if (!existsSync(dirname(AUDIT_LOG_PATH))) {
      mkdirSync(dirname(AUDIT_LOG_PATH), { recursive: true });
    }
    writeFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch (e) {
    // 审计日志写入失败不影响检查结果
  }
  
  // 写入数据库
  if (db && sessionId) {
    try {
      const checkId = insertCheck(sessionId, report, context);
      
      if (report.violations && report.violations.length > 0) {
        insertViolations(checkId, sessionId, report.violations);
      }
    } catch (e) {
      // 数据库写入失败不影响检查结果
    }
  }
}

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
  const englishWords = text.match(/\b[a-zA-Z]+\b/g) || [];
  
  // 过滤白名单术语
  const filteredWords = englishWords.filter(w => !isWhitelisted(w));
  
  if (filteredWords.length >= 3) {
    const joined = filteredWords.join(' ');
    const hasEnglishEnding = /[.!?]$/.test(text.trim());
    const hasEnglishStart = /^[A-Z]/.test(text.trim());

    if (hasEnglishEnding || filteredWords.length >= 5) {
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
        // 对注释行进行语言检查（略过字符统计，只检测违规）
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

  // 判定状态
  if (report.violations.length > 0) {
    report.status = 'FAIL';
    const violationSummary = report.violations
      .slice(0, 5)
      .map(v => `第${v.line}行: [${v.type}] ${v.content}`)
      .join('\n');
    report.details = `发现 ${report.violations.length} 处违规：\n${violationSummary}`;
  } else if (report.purity < 70) {
    report.status = 'FAIL';
    report.details = `中文纯度 ${report.purity}% 低于 70% 阈值`;
  } else if (report.purity < 90) {
    report.status = 'WARN';
    report.details = `中文纯度 ${report.purity}%，建议提高至 90% 以上`;
  } else {
    report.status = 'PASS';
    report.details = `中文纯度 ${report.purity}%，无违规，状态良好。`;
  }

  return report;
}

// ============================================================
// MCP 服务器
// ============================================================

const rl = createInterface({ input: process.stdin });

/** 会话违规计数器 */
const sessionTracker = {
  violations: 0,
  checks: 0,
  startTime: Date.now(),
};

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
      // 初始化数据库
      const dbInitialized = initDatabase();
      if (!dbInitialized) {
        console.error('[zhongwen-mcp] 警告：数据库初始化失败，将回退到内存模式');
      }
      
      // 创建或获取会话
      const currentSession = dbInitialized ? createSession(
        request.params?.meta?.model || 'unknown',
        'zhongwen-agent',
        process.pid
      ) : null;
      
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false,
          },
          prompts: {},
          resources: {},
        },
        serverInfo: {
          name: 'zhongwen-language-checker',
          version: '3.0.0',
        },
      });
      
      // 调试输出
      console.error('[zhongwen-mcp] initialize 完成', {
        dbInitialized,
        currentSession: currentSession || 'null/undefined',
        db_exists: !!db
      });
      
      // 在 initialize 后启动后台检查器（兼容不发送 notifications/initialized 的客户端）
      if (currentSession) {
        console.error('[zhongwen-mcp] 准备启动后台检查器...');
        startBackgroundChecker(currentSession);
      } else {
        console.error('[zhongwen-mcp] 未启动后台检查器：currentSession 为空');
      }
      
      break;

    // -------- 通知已初始化 --------
    case 'notifications/initialized':
      // 启动后台检查器
      startBackgroundChecker(currentSession);
      sendResponse(id, { ok: true });
      break;

    // -------- 列出工具 --------
    case 'tools/list':
      sendResponse(id, {
        tools: [
          {
            name: 'check_chinese_purity',
            description: `【工程级工具】检查文本的中文语言纯度。\n\n这个工具由一个外部独立进程运行，AI 无法绕过它的检查。\n它会分析文本中中文、英文的比例，检测英文句子、英文逻辑连接词、英文填充词等违规。\n返回通过/警告/失败状态，以及详细的违规报告。`,
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
            name: 'zhongwen_dashboard',
            description: '获取完整的仪表板数据，包括当前状态、趋势、分布、热力图和排名。',
            inputSchema: {
              type: 'object',
              properties: {
                range: {
                  type: 'string',
                  description: '时间范围：7d（7天）、30d（30天）、all（全部）',
                  default: '7d'
                }
              }
            },
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

        sessionTracker.checks++;

        if (text.trim().length === 0) {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: '文本为空，无法检查',
                  status: 'SKIP',
                  purity: -1,
                  sessionStats: {
                    totalChecks: sessionTracker.checks,
                    totalViolations: sessionTracker.violations,
                  },
                }),
              },
            ],
          });
          break;
        }

        const report = analyzePurity(text, { codeBlockMode });

        // 写入审计日志（同时写入文件和数据库）
        writeAuditLog(report, 'self-check', currentSession);

        if (report.status === 'FAIL') {
          sessionTracker.violations++;
        }

        // 更新数据库中的会话统计
        if (db && currentSession) {
          try {
            const stats = getSessionStats(currentSession);
            stats.total_checks = sessionTracker.checks;
            stats.total_violations = sessionTracker.violations;
            stats.quality_score = calculateQualityScore(stats);
            updateSessionStats(currentSession, stats);
          } catch (e) {
            // 更新统计失败不影响检查结果
          }
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
                  details: report.details,
                  sessionStats: {
                    totalChecks: sessionTracker.checks,
                    totalViolations: sessionTracker.violations,
                    uptime: Math.floor((Date.now() - sessionTracker.startTime) / 1000),
                  },
                },
                null,
                2
              ),
            },
          ],
        });
      } else if (toolName === 'get_session_stats') {
        let stats;
        if (db && currentSession) {
          try {
            stats = getSessionStats(currentSession);
          } catch (e) {
            stats = null;
          }
        }
        
        if (!stats) {
          stats = {
            totalChecks: sessionTracker.checks,
            totalViolations: sessionTracker.violations,
            uptime: Math.floor((Date.now() - sessionTracker.startTime) / 1000),
            status: sessionTracker.violations > 0 ? 'HAS_VIOLATIONS' : 'CLEAN'
          };
        } else {
          stats.uptime = Math.floor((Date.now() - sessionTracker.startTime) / 1000);
          stats.status = stats.total_violations > 0 ? 'HAS_VIOLATIONS' : 'CLEAN';
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
          sessionTracker.violations = 0;
          sessionTracker.checks = 0;
          
          // 同时重置数据库中的会话统计
          if (db && currentSession) {
            try {
              updateSessionStats(currentSession, {
                total_checks: 0,
                total_violations: 0,
                avg_purity: 100.0,
                quality_score: 100.0
              });
            } catch (e) {
              // 重置失败不影响操作
            }
          }
          
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'RESET',
                  message: '会话统计已重置（内存和数据库）',
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
      } else if (toolName === 'zhongwen_dashboard') {
        if (!db) {
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: '数据库未初始化',
                status: 'ERROR'
              })
            }]
          });
          break;
        }
        
        try {
          const range = args.range || '7d';
          const dashboardData = getDashboardData(range);
          
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify(dashboardData, null, 2)
            }]
          });
        } catch (error) {
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: '获取仪表板数据失败',
                message: error.message,
                status: 'ERROR'
              })
            }]
          });
        }
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

// 进程退出处理
process.on('SIGINT', () => {
  process.exit(0);
});
process.on('SIGTERM', () => {
  process.exit(0);
});

// ============================================================
// 后台检查器（零干扰模式）
// ============================================================

/** 后台检查器状态 */
let backgroundChecker = {
  intervalId: null,
  isRunning: false,
  checkInterval: 30000, // 默认 30 秒
  sessionId: null
};

/**
 * 启动后台检查器
 * 
 * @param {string} sessionId - 会话 ID
 */
function startBackgroundChecker(sessionId) {
  if (!sessionId || !db) return;
  
  backgroundChecker.sessionId = sessionId;
  backgroundChecker.isRunning = true;
  
  // 立即执行一次检查
  performBackgroundCheck();
  
  // 设置定时器
  backgroundChecker.intervalId = setInterval(() => {
    performBackgroundCheck();
  }, backgroundChecker.checkInterval);
  
  // 每小时执行一次日志轮转
  setInterval(() => {
    rotateLogs();
  }, 3600000);
  
  // 启动时立即执行一次轮转
  rotateLogs();
  
  console.error(`[zhongwen-mcp] 后台检查器已启动，间隔 ${backgroundChecker.checkInterval}ms`);
}

/**
 * 停止后台检查器
 */
function stopBackgroundChecker() {
  if (backgroundChecker.intervalId) {
    clearInterval(backgroundChecker.intervalId);
    backgroundChecker.intervalId = null;
  }
  backgroundChecker.isRunning = false;
  console.error('[zhongwen-mcp] 后台检查器已停止');
}

/**
 * 执行后台检查
 */
function performBackgroundCheck() {
  if (!db || !backgroundChecker.sessionId) return;
  
  try {
    // 仅检查告警条件，不写入日志（避免无意义的 PASS 记录）
    checkAlerts();
  } catch (e) {
    // 后台检查失败不影响主流程
  }
}

/**
 * 检查告警条件
 */
function checkAlerts() {
  if (!db || !backgroundChecker.sessionId) return;
  
  try {
    const stats = getSessionStats(backgroundChecker.sessionId);
    
    // 告警规则 1：连续 FAIL（这里简化处理，检查最近 10 次记录）
    const recentChecks = db.prepare(`
      SELECT status FROM checks 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 10
    `).all(backgroundChecker.sessionId);
    
    const recentFails = recentChecks.filter(c => c.status === 'FAIL').length;
    
    if (recentFails >= 3) {
      // 检查是否已经发送过告警（5 分钟内不重复告警）
      const recentAlert = db.prepare(`
        SELECT id FROM alerts 
        WHERE session_id = ? AND alert_type = 'consecutive_failures'
        AND timestamp > datetime('now', '-5 minutes')
        LIMIT 1
      `).get(backgroundChecker.sessionId);
      
      if (!recentAlert) {
        insertAlert(
          backgroundChecker.sessionId,
          'consecutive_failures',
          'CRITICAL',
          `连续 ${recentFails} 次检查 FAIL，请检查输出内容`,
          { recent_fails: recentFails, total_checks: recentChecks.length }
        );
      }
    }
    
    // 告警规则 2：违规率过高
    if (stats.violation_rate > 20 && stats.total_checks >= 5) {
      const recentAlert = db.prepare(`
        SELECT id FROM alerts 
        WHERE session_id = ? AND alert_type = 'high_violation_rate'
        AND timestamp > datetime('now', '-10 minutes')
        LIMIT 1
      `).get(backgroundChecker.sessionId);
      
      if (!recentAlert) {
        insertAlert(
          backgroundChecker.sessionId,
          'high_violation_rate',
          'WARNING',
          `违规率 ${stats.violation_rate}% 超过阈值 20%`,
          { violation_rate: stats.violation_rate, total_checks: stats.total_checks }
        );
      }
    }
  } catch (e) {
    // 告警检查失败不影响主流程
  }
}

// 导出后台检查器控制函数
export {
  startBackgroundChecker,
  stopBackgroundChecker,
  backgroundChecker,
  analyzePurity,
  writeAuditLog
};

// 服务器就绪通知
console.error('[zhongwen-mcp] 语言检查服务器已启动');
