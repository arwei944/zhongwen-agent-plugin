#!/usr/bin/env node

/**
 * zhongwen-agent · 智能化引擎
 * 
 * 提供用户行为分析、自适应白名单、智能告警、质量评分、根因分析等功能。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ============================================================
// 配置与路径
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const DB_PATH = join(CONFIG_DIR, 'data', 'zhongwen.db');
const WHITELIST_PATH = join(CONFIG_DIR, 'whitelist.json');
const ALERT_RULES_PATH = join(CONFIG_DIR, 'alert-rules.json');

// ============================================================
// 数据库连接（延迟加载）
// ============================================================

let db = null;

async function getDatabase() {
  if (!db) {
    try {
      const { default: Database } = await import('better-sqlite3');
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
    } catch (e) {
      console.error('[intelligence] 数据库连接失败:', e.message);
      return null;
    }
  }
  return db;
}

// ============================================================
// 用户行为模式分析
// ============================================================

/**
 * 分析用户行为模式
 * 
 * @param {string} sessionId - 会话 ID（可选）
 * @param {number} days - 分析天数范围
 * @returns {object} 分析结果
 */
async function analyzeUserBehavior(sessionId = null, days = 30) {
  const database = await getDatabase();
  if (!database) return { error: '数据库不可用' };
  
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString();
    
    // 查询条件
    let sessionFilter = sessionId ? 'AND v.session_id = ?' : '';
    const params = sessionId ? [sinceStr, sessionId] : [sinceStr];
    
    // 1. 违规类型分布
    const violationDistribution = database.prepare(`
      SELECT v.violation_type, COUNT(*) as count,
             ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM violations WHERE timestamp >= ? ${sessionFilter}), 2) as percentage
      FROM violations v
      WHERE v.timestamp >= ? ${sessionFilter}
      GROUP BY v.violation_type
      ORDER BY count DESC
    `).all(...params);
    
    // 2. 高频违规词
    const topTerms = database.prepare(`
      SELECT v.content, COUNT(*) as count, v.violation_type
      FROM violations v
      WHERE v.timestamp >= ? ${sessionFilter}
        AND v.violation_type IN ('english_filler', 'english_sentence', 'mixed_phrase')
      GROUP BY v.content
      ORDER BY count DESC
      LIMIT 20
    `).all(...params);
    
    // 3. 时段分布
    const timeDistribution = database.prepare(`
      SELECT strftime('%H', timestamp) as hour, COUNT(*) as count
      FROM violations
      WHERE timestamp >= ? ${sessionFilter}
      GROUP BY hour
      ORDER BY count DESC
    `).all(...params);
    
    // 4. 违规趋势
    const violationTrend = database.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM violations
      WHERE timestamp >= ? ${sessionFilter}
      GROUP BY date
      ORDER BY date ASC
    `).all(...params);
    
    // 5. 会话质量对比
    const sessionComparison = database.prepare(`
      SELECT s.session_id, s.start_time, s.avg_purity, s.quality_score,
             s.total_checks, s.total_violations
      FROM sessions s
      WHERE s.start_time >= ?
      ORDER BY s.start_time DESC
      LIMIT 10
    `).all(sinceStr);
    
    return {
      violation_distribution: violationDistribution,
      top_terms: topTerms,
      time_distribution: timeDistribution,
      violation_trend: violationTrend,
      session_comparison: sessionComparison,
      summary: generateBehaviorSummary(violationDistribution, topTerms, timeDistribution)
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 生成行为分析摘要
 */
function generateBehaviorSummary(distribution, topTerms, timeDistribution) {
  const summary = [];
  
  // 分析主要违规类型
  if (distribution.length > 0) {
    const primaryType = distribution[0];
    summary.push(`主要违规类型: ${primaryType.violation_type} (${primaryType.percentage}%)`);
  }
  
  // 分析高频词
  if (topTerms.length > 0) {
    const topTerm = topTerms[0];
    summary.push(`最高频违规词: '${topTerm.content}' (${topTerm.count} 次)`);
  }
  
  // 分析时段
  if (timeDistribution.length > 0) {
    const peakHour = timeDistribution[0];
    summary.push(`最高发时段: ${peakHour.hour} 时 (${peakHour.count} 次)`);
  }
  
  // 生成建议
  summary.push('建议: 关注主要违规类型，针对性改进');
  
  return summary;
}

// ============================================================
// 自适应白名单
// ============================================================

/**
 * 分析白名单候选
 * 
 * @param {number} minFrequency - 最低使用频率
 * @returns {array} 候选术语列表
 */
async function analyzeWhitelistCandidates(minFrequency = 10) {
  const database = await getDatabase();
  if (!database) return { error: '数据库不可用' };
  
  try {
    // 查询高频非违规术语（出现在检查中但未触发违规的英文词）
    const candidates = database.prepare(`
      WITH candidate_terms AS (
        SELECT 
          LOWER(TRIM(value)) as term,
          COUNT(*) as frequency
        FROM checks,
          json_each('{"dummy": "placeholder"}')  -- 占位，实际需要从文本中提取
        WHERE status = 'PASS'
          AND english_chars > 0
        GROUP BY term
        HAVING frequency >= ?
      )
      SELECT * FROM candidate_terms
      ORDER BY frequency DESC
      LIMIT 50
    `).all(minFrequency);
    
    // 简化实现：从违规记录中反向分析
    // 实际上应该从通过的检查中提取英文术语
    
    return {
      candidates: candidates,
      suggestion: '暂无候选术语（需要更多数据）'
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 生成白名单建议
 * 
 * @returns {object} 白名单建议
 */
async function generateWhitelistSuggestions() {
  const database = await getDatabase();
  if (!database) return { error: '数据库不可用' };
  
  try {
    // 获取当前白名单
    let currentWhitelist = [];
    if (existsSync(WHITELIST_PATH)) {
      const whitelist = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
      currentWhitelist = whitelist.allowed_terms || [];
    }
    
    // 分析高频出现的术语（这些可能应该加入白名单）
    const frequentTerms = database.prepare(`
      SELECT content, COUNT(*) as count
      FROM violations
      WHERE violation_type = 'english_sentence'
      GROUP BY content
      HAVING count >= 5
      ORDER BY count DESC
      LIMIT 20
    `).all();
    
    // 找出不在白名单中的高频词
    const suggestions = frequentTerms
      .filter(item => !currentWhitelist.includes(item.content))
      .map(item => ({
        term: item.content,
        frequency: item.count,
        action: 'consider_adding'
      }));
    
    return {
      current_count: currentWhitelist.length,
      suggestions: suggestions,
      message: suggestions.length > 0 
        ? `发现 ${suggestions.length} 个高频术语建议加入白名单`
        : '当前白名单配置合理'
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
// 智能告警
// ============================================================

/**
 * 检查告警条件
 * 
 * @param {string} sessionId - 会话 ID
 * @returns {array} 告警列表
 */
async function checkAlerts(sessionId = null) {
  const database = await getDatabase();
  if (!database) return [];
  
  try {
    const alerts = [];
    const since = new Date();
    since.setMinutes(since.getMinutes() - 10); // 最近 10 分钟
    const sinceStr = since.toISOString();
    
    // 告警规则 1：连续 FAIL
    const recentChecks = database.prepare(`
      SELECT status FROM checks 
      WHERE timestamp >= ?
      ORDER BY timestamp DESC 
      LIMIT 10
    `).all(sinceStr);
    
    const recentFails = recentChecks.filter(c => c.status === 'FAIL').length;
    if (recentFails >= 3) {
      alerts.push({
        type: 'consecutive_failures',
        severity: 'CRITICAL',
        message: `连续 ${recentFails} 次检查 FAIL`,
        data: { recent_fails: recentFails }
      });
    }
    
    // 告警规则 2：违规率过高
    if (recentChecks.length >= 5) {
      const violationRate = (recentFails / recentChecks.length) * 100;
      if (violationRate > 20) {
        alerts.push({
          type: 'high_violation_rate',
          severity: 'WARNING',
          message: `违规率 ${violationRate.toFixed(1)}% 超过阈值`,
          data: { violation_rate: violationRate }
        });
      }
    }
    
    // 告警规则 3：纯度骤降
    const purityTrend = database.prepare(`
      SELECT purity FROM checks 
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
      LIMIT 5
    `).all(sinceStr);
    
    if (purityTrend.length >= 2) {
      const first = purityTrend[0].purity;
      const last = purityTrend[purityTrend.length - 1].purity;
      if (first - last > 20) {
        alerts.push({
          type: 'purity_drop',
          severity: 'WARNING',
          message: `中文纯度从 ${first.toFixed(1)}% 骤降至 ${last.toFixed(1)}%`,
          data: { from: first, to: last, drop: first - last }
        });
      }
    }
    
    return alerts;
  } catch (e) {
    return [];
  }
}

// ============================================================
// 会话质量评分
// ============================================================

/**
 * 计算会话质量评分
 * 
 * @param {string} sessionId - 会话 ID
 * @returns {object} 质量评分详情
 */
async function calculateQualityScore(sessionId) {
  const database = await getDatabase();
  if (!database) return { error: '数据库不可用' };
  
  try {
    // 获取会话统计
    const session = database.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `).get(sessionId);
    
    if (!session) {
      return { error: '会话不存在' };
    }
    
    // 获取检查记录
    const checks = database.prepare(`
      SELECT * FROM checks WHERE session_id = ? ORDER BY timestamp ASC
    `).all(sessionId);
    
    if (checks.length === 0) {
      return { score: 100, details: '无检查记录' };
    }
    
    // 计算各项指标
    const purities = checks.map(c => c.purity);
    const avgPurity = purities.reduce((a, b) => a + b, 0) / purities.length;
    const violationRate = session.total_violations / Math.max(session.total_checks, 1);
    
    // 计算趋势（近期表现权重更高）
    let trendWeight = 0;
    if (purities.length >= 3) {
      const recent = purities.slice(-3);
      const older = purities.slice(0, -3);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
      trendWeight = recentAvg - olderAvg;
    }
    
    // 计算评分
    // 基础分：纯度得分 × 0.6
    const purityScore = avgPurity * 0.6;
    // 违规惩罚：(1 - 违规率) × 40
    const violationPenalty = Math.min(violationRate * 40, 40);
    // 趋势加分：趋势为正时加分，为负时减分
    const trendBonus = Math.max(-10, Math.min(10, trendWeight * 0.5));
    
    const rawScore = purityScore + (40 - violationPenalty) + trendBonus;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    
    return {
      score: score,
      avg_purity: Math.round(avgPurity * 100) / 100,
      violation_rate: Math.round(violationRate * 10000) / 100,
      trend_weight: Math.round(trendWeight * 100) / 100,
      details: generateScoreDetails(score, avgPurity, violationRate, trendWeight)
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 生成评分详情
 */
function generateScoreDetails(score, avgPurity, violationRate, trendWeight) {
  const details = [];
  
  if (score >= 90) {
    details.push('优秀：中文使用非常规范');
  } else if (score >= 70) {
    details.push('良好：基本符合要求，有改进空间');
  } else if (score >= 60) {
    details.push('一般：需要关注英文使用情况');
  } else {
    details.push('需要改进：建议检查输出内容');
  }
  
  if (avgPurity < 80) {
    details.push(`中文纯度 ${avgPurity.toFixed(1)}% 偏低`);
  }
  
  if (violationRate > 0.1) {
    details.push(`违规率 ${(violationRate * 100).toFixed(1)}% 偏高`);
  }
  
  if (trendWeight > 5) {
    details.push('近期表现有改善');
  } else if (trendWeight < -5) {
    details.push('近期表现有所下降');
  }
  
  return details;
}

// ============================================================
// 违规根因分析
// ============================================================

/**
 * 分析违规根因
 * 
 * @param {string} sessionId - 会话 ID
 * @returns {object} 根因分析结果
 */
async function analyzeRootCause(sessionId = null) {
  const database = await getDatabase();
  if (!database) return { error: '数据库不可用' };
  
  try {
    let query = `
      SELECT v.*, c.purity, c.context
      FROM violations v
      JOIN checks c ON v.check_id = c.id
      WHERE 1=1
    `;
    const params = [];
    
    if (sessionId) {
      query += ' AND v.session_id = ?';
      params.push(sessionId);
    }
    
    query += ' ORDER BY v.timestamp DESC LIMIT 50';
    
    const violations = database.prepare(query).all(...params);
    
    // 分析违规上下文
    const analysis = {
      total_analyzed: violations.length,
      patterns: [],
      root_causes: [],
      suggestions: []
    };
    
    // 模式识别
    const patterns = {};
    for (const v of violations) {
      const key = v.violation_type;
      patterns[key] = (patterns[key] || 0) + 1;
    }
    
    analysis.patterns = Object.entries(patterns)
      .map(([type, count]) => ({ type, count, percentage: (count / violations.length * 100).toFixed(1) }))
      .sort((a, b) => b.count - a.count);
    
    // 根因分析
    for (const pattern of analysis.patterns) {
      switch (pattern.type) {
        case 'english_filler':
          analysis.root_causes.push({
            cause: '英文填充词使用频繁',
            description: '在思考或表达过程中习惯性使用英文连接词和填充词',
            severity: 'MEDIUM'
          });
          break;
        case 'english_sentence':
          analysis.root_causes.push({
            cause: '完整英文句子',
            description: '使用了完整的英文句子而非中文表达',
            severity: 'HIGH'
          });
          break;
        case 'mixed_phrase':
          analysis.root_causes.push({
            cause: '中英夹杂',
            description: '在中文表达中混杂英文术语，可能影响可读性',
            severity: 'LOW'
          });
          break;
        case 'comment':
          analysis.root_causes.push({
            cause: '代码注释使用英文',
            description: '代码中的注释使用了英文而非中文',
            severity: 'MEDIUM'
          });
          break;
      }
    }
    
    // 生成改进建议
    analysis.suggestions = generateImprovementSuggestions(analysis.patterns);
    
    return analysis;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 生成改进建议
 */
function generateImprovementSuggestions(patterns) {
  const suggestions = [];
  
  for (const pattern of patterns) {
    switch (pattern.type) {
      case 'english_filler':
        suggestions.push('练习使用中文连接词替代英文填充词（如"然而"替代 "however"）');
        break;
      case 'english_sentence':
        suggestions.push('尝试将英文句子翻译成中文表达，保持意思不变');
        break;
      case 'mixed_phrase':
        suggestions.push('在中文表达中，可以考虑对英文术语添加中文注释');
        break;
      case 'comment':
        suggestions.push('代码注释统一使用中文，提高代码可读性');
        break;
    }
  }
  
  return suggestions;
}

// ============================================================
// 导出接口
// ============================================================

export {
  analyzeUserBehavior,
  analyzeWhitelistCandidates,
  generateWhitelistSuggestions,
  checkAlerts,
  calculateQualityScore,
  analyzeRootCause
};
