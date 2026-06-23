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

// ============================================================
// 语言纯度分析引擎
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

    // 如果处于代码块模式且启用跳过
    if (inCodeBlock && options.codeBlockMode) {
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

    // 检测英文句子/短语
    if (report.englishChars > 0) {
      // 检查完整英文句子（超过5个英文单词 + 句尾标点）
      const englishWords = currentLine.match(/\b[a-zA-Z]+\b/g) || [];
      if (englishWords.length >= 3) {
        const joined = englishWords.join(' ');
        const hasEnglishEnding = /[.!?]$/.test(currentLine.trim());
        const hasEnglishStart = /^[A-Z]/.test(currentLine.trim());

        if (hasEnglishEnding || englishWords.length >= 5) {
          report.violations.push({
            line: i + 1,
            type: 'english_sentence',
            content: currentLine.trim().substring(0, 120),
            wordCount: englishWords.length,
          });
          report.englishSegments.push(currentLine.trim());
        }

        // 检查英文逻辑连接词
        for (const pattern of ENGLISH_PATTERNS) {
          const match = currentLine.match(pattern);
          if (match) {
            report.violations.push({
              line: i + 1,
              type: 'english_pattern',
              content: match[0],
              context: currentLine.trim().substring(0, 100),
            });
            break;
          }
        }
      }

      // 检查英文填充词
      for (const word of ENGLISH_FILLER_WORDS) {
        const regex = new RegExp('\\b' + word + '\\b', 'i');
        if (regex.test(currentLine)) {
          report.violations.push({
            line: i + 1,
            type: 'english_filler',
            content: word,
            context: currentLine.trim().substring(0, 100),
          });
        }
      }
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
          version: '2.0.0',
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

        if (report.status === 'FAIL') {
          sessionTracker.violations++;
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
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalChecks: sessionTracker.checks,
                  totalViolations: sessionTracker.violations,
                  uptime: Math.floor((Date.now() - sessionTracker.startTime) / 1000),
                  status: sessionTracker.violations > 0 ? 'HAS_VIOLATIONS' : 'CLEAN',
                },
                null,
                2
              ),
            },
          ],
        });
      } else if (toolName === 'reset_session_stats') {
        if (args.confirm === true) {
          sessionTracker.violations = 0;
          sessionTracker.checks = 0;
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

// 服务器就绪通知
console.error('[zhongwen-mcp] 语言检查服务器已启动');
