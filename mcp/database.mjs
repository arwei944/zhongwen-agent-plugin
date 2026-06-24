#!/usr/bin/env node

/**
 * zhongwen-agent · 数据库模块
 * 
 * 提供 SQLite 数据持久化层，替代散落的日志文件和 JSON。
 * 支持会话追踪、检查记录、违规记录、版本快照、告警记录。
 * 
 * 使用 better-sqlite3 同步 API，确保数据一致性。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import Database from 'better-sqlite3';

// ============================================================
// 配置与路径
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const DATA_DIR = join(CONFIG_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'zhongwen.db');
const WHITELIST_PATH = join(CONFIG_DIR, 'whitelist.json');

// ============================================================
// 数据库初始化
// ============================================================

let db = null;

/**
 * 初始化数据库连接并创建表结构
 */
function initDatabase() {
  try {
    // 确保数据目录存在
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // 打开数据库连接
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // 启用 WAL 模式提升并发性能
    db.pragma('busy_timeout = 5000'); // 设置 busy timeout 为 5 秒

    // 创建所有表
    createTables();
    
    // 创建索引
    createIndexes();

    console.error('[zhongwen-db] 数据库初始化完成');
    return true;
  } catch (error) {
    console.error('[zhongwen-db] 数据库初始化失败:', error.message);
    return false;
  }
}

/**
 * 创建所有数据表
 */
function createTables() {
  // 会话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      start_time TEXT NOT NULL,
      end_time TEXT,
      model TEXT,
      agent TEXT,
      pid INTEGER,
      total_checks INTEGER DEFAULT 0,
      total_violations INTEGER DEFAULT 0,
      avg_purity REAL DEFAULT 100.0,
      quality_score REAL DEFAULT 100.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 检查记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      purity REAL NOT NULL,
      status TEXT NOT NULL,
      chinese_chars INTEGER DEFAULT 0,
      english_chars INTEGER DEFAULT 0,
      total_chars INTEGER DEFAULT 0,
      text_hash TEXT,
      context TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    )
  `);

  // 违规记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      violation_type TEXT NOT NULL,
      line_number INTEGER,
      content TEXT,
      suggestion TEXT,
      context TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (check_id) REFERENCES checks(id),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    )
  `);

  // 版本快照表
  db.exec(`
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT DEFAULT 'snapshot',
      files_count INTEGER DEFAULT 0,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 告警记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      acknowledged BOOLEAN DEFAULT 0,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    )
  `);
}

/**
 * 创建索引以提升查询性能
 */
function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_checks_session ON checks(session_id);
    CREATE INDEX IF NOT EXISTS idx_checks_timestamp ON checks(timestamp);
    CREATE INDEX IF NOT EXISTS idx_checks_status ON checks(status);
    CREATE INDEX IF NOT EXISTS idx_violations_check ON violations(check_id);
    CREATE INDEX IF NOT EXISTS idx_violations_session ON violations(session_id);
    CREATE INDEX IF NOT EXISTS idx_violations_type ON violations(violation_type);
    CREATE INDEX IF NOT EXISTS idx_violations_timestamp ON violations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model);
    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
  `);
}

// ============================================================
// 会话管理
// ============================================================

/**
 * 创建新会话
 * 
 * @param {string} model - 模型名称
 * @param {string} agent - Agent 名称
 * @param {number} pid - 进程 ID
 * @returns {string} 会话 ID
 */
function createSession(model = 'unknown', agent = 'unknown', pid = process.pid) {
  const sessionId = generateSessionId();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO sessions (session_id, start_time, model, agent, pid, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(sessionId, now, model, agent, pid, now);
  
  return sessionId;
}

/**
 * 生成会话 ID（格式：YYYYMMDD-HHMMSS-XXXXXXXX）
 */
function generateSessionId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${datePart}-${randomPart}`;
}

/**
 * 结束会话
 * 
 * @param {string} sessionId - 会话 ID
 */
function endSession(sessionId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE sessions SET end_time = ? WHERE session_id = ?
  `);
  stmt.run(now, sessionId);
}

/**
 * 更新会话统计
 * 
 * @param {string} sessionId - 会话 ID
 * @param {object} stats - 统计数据
 */
function updateSessionStats(sessionId, stats) {
  const stmt = db.prepare(`
    UPDATE sessions 
    SET total_checks = ?, total_violations = ?, avg_purity = ?, quality_score = ?
    WHERE session_id = ?
  `);
  stmt.run(
    stats.total_checks,
    stats.total_violations,
    stats.avg_purity,
    stats.quality_score,
    sessionId
  );
}

/**
 * 获取会话信息
 * 
 * @param {string} sessionId - 会话 ID
 * @returns {object|null} 会话信息
 */
function getSession(sessionId) {
  const stmt = db.prepare(`
    SELECT * FROM sessions WHERE session_id = ?
  `);
  return stmt.get(sessionId) || null;
}

/**
 * 获取最近的会话列表
 * 
 * @param {number} limit - 返回数量限制
 * @returns {array} 会话列表
 */
function getRecentSessions(limit = 10) {
  const stmt = db.prepare(`
    SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?
  `);
  return stmt.all(limit);
}

// ============================================================
// 检查记录管理
// ============================================================

/**
 * 插入检查记录
 * 
 * @param {string} sessionId - 会话 ID
 * @param {object} report - 纯度分析报告
 * @param {string} context - 检查上下文
 * @returns {number} 检查记录 ID
 */
function insertCheck(sessionId, report, context = 'unknown') {
  const now = new Date().toISOString();
  const textHash = hashText(report.details || '');
  
  const stmt = db.prepare(`
    INSERT INTO checks (session_id, timestamp, purity, status, chinese_chars, english_chars, total_chars, text_hash, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    sessionId,
    now,
    report.purity,
    report.status,
    report.chineseChars,
    report.englishChars,
    report.totalChars,
    textHash,
    context,
    now
  );
  
  return result.lastInsertRowid;
}

/**
 * 获取检查记录
 * 
 * @param {number} checkId - 检查记录 ID
 * @returns {object|null} 检查记录
 */
function getCheck(checkId) {
  const stmt = db.prepare(`
    SELECT * FROM checks WHERE id = ?
  `);
  return stmt.get(checkId) || null;
}

/**
 * 获取会话的检查记录
 * 
 * @param {string} sessionId - 会话 ID
 * @param {number} limit - 返回数量限制
 * @param {number} offset - 偏移量
 * @returns {array} 检查记录列表
 */
function getSessionChecks(sessionId, limit = 100, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM checks WHERE session_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `);
  return stmt.all(sessionId, limit, offset);
}

// ============================================================
// 违规记录管理
// ============================================================

/**
 * 插入违规记录
 * 
 * @param {number} checkId - 检查记录 ID
 * @param {string} sessionId - 会话 ID
 * @param {object} violation - 违规信息
 * @returns {number} 违规记录 ID
 */
function insertViolation(checkId, sessionId, violation) {
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO violations (check_id, session_id, timestamp, violation_type, line_number, content, suggestion, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    checkId,
    sessionId,
    now,
    violation.type,
    violation.line || null,
    violation.content || '',
    violation.suggestion || '',
    violation.context || '',
    now
  );
  
  return result.lastInsertRowid;
}

/**
 * 批量插入违规记录
 * 
 * @param {number} checkId - 检查记录 ID
 * @param {string} sessionId - 会话 ID
 * @param {array} violations - 违规列表
 */
function insertViolations(checkId, sessionId, violations) {
  const stmt = db.prepare(`
    INSERT INTO violations (check_id, session_id, timestamp, violation_type, line_number, content, suggestion, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const now = new Date().toISOString();
  
  const insertMany = db.transaction((violations) => {
    for (const v of violations) {
      stmt.run(
        checkId,
        sessionId,
        now,
        v.type,
        v.line || null,
        v.content || '',
        v.suggestion || '',
        v.context || '',
        now
      );
    }
  });
  
  insertMany(violations);
}

/**
 * 获取违规记录
 * 
 * @param {object} filters - 过滤条件
 * @returns {array} 违规记录列表
 */
function getViolations(filters = {}) {
  let query = 'SELECT * FROM violations WHERE 1=1';
  const params = [];
  
  if (filters.session_id) {
    query += ' AND session_id = ?';
    params.push(filters.session_id);
  }
  if (filters.violation_type) {
    query += ' AND violation_type = ?';
    params.push(filters.violation_type);
  }
  if (filters.start_time) {
    query += ' AND timestamp >= ?';
    params.push(filters.start_time);
  }
  if (filters.end_time) {
    query += ' AND timestamp <= ?';
    params.push(filters.end_time);
  }
  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  query += ' ORDER BY timestamp DESC';
  
  const stmt = db.prepare(query);
  return stmt.all(...params);
}

// ============================================================
// 版本快照管理
// ============================================================

/**
 * 插入版本快照
 * 
 * @param {string} version - 版本名称
 * @param {string} type - 类型（snapshot/rollback/upgrade）
 * @param {number} filesCount - 文件数量
 * @param {object} metadata - 元数据
 * @returns {number} 版本 ID
 */
function insertVersion(version, type = 'snapshot', filesCount = 0, metadata = {}) {
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO versions (version, timestamp, type, files_count, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(version, now, type, filesCount, JSON.stringify(metadata), now);
  return result.lastInsertRowid;
}

/**
 * 获取版本历史
 * 
 * @param {number} limit - 返回数量限制
 * @returns {array} 版本列表
 */
function getVersions(limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM versions ORDER BY timestamp DESC LIMIT ?
  `);
  return stmt.all(limit);
}

// ============================================================
// 告警管理
// ============================================================

/**
 * 插入告警记录
 * 
 * @param {string} sessionId - 会话 ID
 * @param {string} alertType - 告警类型
 * @param {string} severity - 严重程度
 * @param {string} message - 告警消息
 * @param {object} data - 附加数据
 * @returns {number} 告警 ID
 */
function insertAlert(sessionId, alertType, severity, message, data = {}) {
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO alerts (session_id, alert_type, severity, message, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(sessionId, alertType, severity, message, JSON.stringify(data), now);
  return result.lastInsertRowid;
}

/**
 * 获取未确认的告警
 * 
 * @returns {array} 告警列表
 */
function getUnacknowledgedAlerts() {
  const stmt = db.prepare(`
    SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY timestamp DESC
  `);
  return stmt.all();
}

/**
 * 确认告警
 * 
 * @param {number} alertId - 告警 ID
 */
function acknowledgeAlert(alertId) {
  const stmt = db.prepare(`
    UPDATE alerts SET acknowledged = 1 WHERE id = ?
  `);
  stmt.run(alertId);
}

// ============================================================
// 统计分析
// ============================================================

/**
 * 获取会话统计
 * 
 * @param {string} sessionId - 会话 ID
 * @returns {object} 统计信息
 */
function getSessionStats(sessionId) {
  const checks = db.prepare(`
    SELECT COUNT(*) as total_checks, 
           AVG(purity) as avg_purity,
           SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) as violations
    FROM checks WHERE session_id = ?
  `).get(sessionId);
  
  return {
    total_checks: checks.total_checks || 0,
    avg_purity: Math.round((checks.avg_purity || 100) * 100) / 100,
    total_violations: checks.violations || 0,
    violation_rate: checks.total_checks > 0 
      ? Math.round((checks.violations / checks.total_checks) * 10000) / 100 
      : 0
  };
}

/**
 * 获取全局统计
 * 
 * @returns {object} 全局统计信息
 */
function getGlobalStats() {
  const checks = db.prepare(`
    SELECT COUNT(*) as total_checks,
           AVG(purity) as avg_purity,
           SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) as violations,
           COUNT(DISTINCT session_id) as total_sessions
    FROM checks
  `).get();
  
  const violations = db.prepare(`
    SELECT violation_type, COUNT(*) as count
    FROM violations
    GROUP BY violation_type
    ORDER BY count DESC
  `).all();
  
  return {
    total_checks: checks.total_checks || 0,
    avg_purity: Math.round((checks.avg_purity || 100) * 100) / 100,
    total_violations: checks.violations || 0,
    total_sessions: checks.total_sessions || 0,
    violation_rate: checks.total_checks > 0
      ? Math.round((checks.violations / checks.total_checks) * 10000) / 100
      : 0,
    violation_types: violations
  };
}

/**
 * 获取时间维度聚合数据
 * 
 * @param {string} granularity - 粒度（hour/day/week/month）
 * @param {number} days - 天数范围
 * @returns {array} 聚合数据
 */
function getTimeAggregation(granularity = 'day', days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();
  
  let groupBy;
  switch (granularity) {
    case 'hour':
      groupBy = "strftime('%Y-%m-%d %H:00', timestamp)";
      break;
    case 'week':
      groupBy = "strftime('%Y-%W', timestamp)";
      break;
    case 'month':
      groupBy = "strftime('%Y-%m', timestamp)";
      break;
    case 'day':
    default:
      groupBy = "DATE(timestamp)";
  }
  
  const stmt = db.prepare(`
    SELECT 
      ${groupBy} as period,
      COUNT(*) as check_count,
      AVG(purity) as avg_purity,
      SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) as violation_count,
      SUM(CASE WHEN status = 'WARN' THEN 1 ELSE 0 END) as warn_count,
      SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as pass_count
    FROM checks
    WHERE timestamp >= ?
    GROUP BY period
    ORDER BY period ASC
  `);
  
  return stmt.all(sinceStr);
}

/**
 * 获取热力图数据
 * 
 * @param {number} days - 天数范围
 * @returns {object} 热力图数据
 */
function getHeatmapData(days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();
  
  // 获取每小时每天的违规次数
  const stmt = db.prepare(`
    SELECT 
      strftime('%w', timestamp) as day_of_week,
      strftime('%H', timestamp) as hour,
      COUNT(*) as violation_count
    FROM violations
    WHERE timestamp >= ?
    GROUP BY day_of_week, hour
  `);
  
  const rows = stmt.all(sinceStr);
  
  // 构建 7×24 矩阵
  const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
  
  for (const row of rows) {
    const day = parseInt(row.day_of_week);
    const hour = parseInt(row.hour);
    if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
      matrix[day][hour] = row.violation_count;
    }
  }
  
  // 找到最大值用于归一化
  const maxValue = Math.max(...matrix.flat(), 1);
  
  return {
    data: matrix,
    max_value: maxValue,
    labels: {
      days: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      hours: Array.from({length: 24}, (_, i) => `${i}时`)
    }
  };
}

/**
 * 获取仪表板完整数据
 * 
 * @param {string} range - 时间范围（7d/30d/all）
 * @returns {object} 仪表板数据
 */
function getDashboardData(range = '7d') {
  let days = 7;
  switch (range) {
    case '30d':
      days = 30;
      break;
    case 'all':
      days = 36500; // 约 100 年
      break;
    default:
      days = 7;
  }
  
  const globalStats = getGlobalStats();
  const timeAggregation = getTimeAggregation('day', days);
  const heatmap = getHeatmapData(days);
  
  // 获取违规类型分布
  const violationTypes = db.prepare(`
    SELECT violation_type, COUNT(*) as count,
           ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM violations), 2) as percentage
    FROM violations
    GROUP BY violation_type
    ORDER BY count DESC
  `).all();
  
  // 获取高频违规词
  const topTerms = db.prepare(`
    SELECT content, COUNT(*) as count
    FROM violations
    WHERE violation_type IN ('english_filler', 'english_sentence', 'mixed_phrase')
    GROUP BY content
    ORDER BY count DESC
    LIMIT 10
  `).all();
  
  // 获取当前会话
  const recentSessions = getRecentSessions(1);
  const currentSession = recentSessions.length > 0 ? recentSessions[0] : null;
  
  return {
    status: {
      current_purity: globalStats.avg_purity,
      total_checks: globalStats.total_checks,
      total_violations: globalStats.total_violations,
      violation_rate: globalStats.violation_rate,
      quality_score: calculateQualityScore(globalStats),
      uptime: currentSession ? Math.floor((Date.now() - new Date(currentSession.start_time).getTime()) / 1000) : 0
    },
    trends: {
      purity_trend: timeAggregation.map(row => ({
        date: row.period,
        purity: Math.round(row.avg_purity * 100) / 100
      })),
      violation_trend: timeAggregation.map(row => ({
        date: row.period,
        count: row.violation_count
      }))
    },
    distributions: {
      violation_types: violationTypes,
      model_distribution: getModelDistribution()
    },
    heatmap: heatmap,
    rankings: {
      top_violation_terms: topTerms,
      improvement_suggestions: generateImprovementSuggestions(violationTypes, topTerms)
    }
  };
}

/**
 * 计算质量评分
 * 
 * @param {object} stats - 统计数据
 * @returns {number} 质量评分（0-100）
 */
function calculateQualityScore(stats) {
  if (stats.total_checks === 0) return 100;
  
  // 质量评分 = 纯度得分 × 0.6 + (1 - 违规率) × 40
  const purityScore = stats.avg_purity;
  const violationPenalty = Math.min(stats.violation_rate * 2, 40);
  
  return Math.round(purityScore * 0.6 + (40 - violationPenalty));
}

/**
 * 获取模型分布
 * 
 * @returns {array} 模型分布数据
 */
function getModelDistribution() {
  const stmt = db.prepare(`
    SELECT model, COUNT(*) as count
    FROM sessions
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
  `);
  return stmt.all();
}

/**
 * 生成改进建议
 * 
 * @param {array} violationTypes - 违规类型分布
 * @param {array} topTerms - 高频违规词
 * @returns {array} 改进建议列表
 */
function generateImprovementSuggestions(violationTypes, topTerms) {
  const suggestions = [];
  
  for (const type of violationTypes.slice(0, 3)) {
    switch (type.violation_type) {
      case 'english_filler':
        suggestions.push('减少使用英文填充词，建议使用中文连接词替代');
        break;
      case 'english_sentence':
        suggestions.push('避免使用完整英文句子，尝试用中文表达');
        break;
      case 'mixed_phrase':
        suggestions.push('减少中英夹杂表达，保持语言一致性');
        break;
      case 'comment':
        suggestions.push('代码注释使用中文，提高可读性');
        break;
    }
  }
  
  for (const term of topTerms.slice(0, 2)) {
    suggestions.push(`减少使用 '${term.content}'，建议替换为中文表达`);
  }
  
  return suggestions.slice(0, 5);
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 计算文本哈希（SHA256 前 8 位）
 * 
 * @param {string} text - 文本内容
 * @returns {string} 哈希值
 */
function hashText(text) {
  // 使用简单哈希算法（避免引入 crypto 依赖）
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
}

/**
 * 获取数据库连接
 * 
 * @returns {Database} SQLite 数据库实例
 */
function getDatabase() {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

/**
 * 关闭数据库连接
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================================
// 导出接口
// ============================================================

export {
  initDatabase,
  getDatabase,
  closeDatabase,
  createSession,
  endSession,
  updateSessionStats,
  getSession,
  getRecentSessions,
  insertCheck,
  getCheck,
  getSessionChecks,
  insertViolation,
  insertViolations,
  getViolations,
  insertVersion,
  getVersions,
  insertAlert,
  getUnacknowledgedAlerts,
  acknowledgeAlert,
  getSessionStats,
  getGlobalStats,
  getTimeAggregation,
  getHeatmapData,
  getDashboardData,
  hashText,
  calculateQualityScore
};
