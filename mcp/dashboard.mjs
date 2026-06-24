#!/usr/bin/env node

/**
 * zhongwen-agent · Web 仪表盘服务器
 * 
 * 基于 Node.js 内置 http 模块的轻量级 Web 服务器。
 * 提供实时监控面板和统计图表。
 * 
 * 零外部依赖，使用原生 HTTP 服务器。
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { createServer } from 'http';

// ============================================================
// 配置
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const DASHBOARD_DIR = join(CONFIG_DIR, 'docs', 'dashboard');
const PORT = 3000;
const HOST = '127.0.0.1';

// ============================================================
// 数据获取（直接导入数据库模块）
// ============================================================

let dbModule = null;

async function loadDatabaseModule() {
  if (!dbModule) {
    try {
      dbModule = await import('./database.mjs');
      dbModule.initDatabase();
    } catch (e) {
      console.error('[dashboard] 加载数据库模块失败:', e.message);
    }
  }
  return dbModule;
}

/**
 * 获取仪表板数据
 * 
 * @param {string} range - 时间范围
 * @returns {object} 仪表板数据
 */
async function getDashboardData(range = '7d') {
  const module = await loadDatabaseModule();
  if (!module || !module.getDashboardData) {
    return getMockDashboardData();
  }
  
  try {
    return module.getDashboardData(range);
  } catch (e) {
    console.error('获取仪表板数据失败:', e.message);
    return getMockDashboardData();
  }
}

/**
 * 获取模拟仪表板数据（用于演示或降级）
 * 
 * @returns {object} 模拟数据
 */
function getMockDashboardData() {
  return {
    status: {
      current_purity: 0,
      total_checks: 0,
      total_violations: 0,
      violation_rate: 0,
      quality_score: 0,
      uptime: 0
    },
    trends: {
      purity_trend: [],
      violation_trend: []
    },
    distributions: {
      violation_types: [],
      model_distribution: []
    },
    heatmap: {
      data: Array(7).fill(null).map(() => Array(24).fill(0)),
      max_value: 0,
      labels: {
        days: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
        hours: Array.from({length: 24}, (_, i) => `${i}时`)
      }
    },
    rankings: {
      top_violation_terms: [],
      improvement_suggestions: ['暂无数据']
    }
  };
}

// ============================================================
// HTTP 服务器
// ============================================================

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * 创建 HTTP 服务器
 */
function createDashboardServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    
    console.error(`[dashboard] ${req.method} ${pathname}`);
    
    // API 路由
    if (pathname === '/api/dashboard') {
      const range = url.searchParams.get('range') || '7d';
      
      try {
        const data = await getDashboardData(range);
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    
    // 静态文件服务
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = join(DASHBOARD_DIR, filePath);
    
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      
      const stats = statSync(filePath);
      const ext = '.' + filePath.split('.').pop();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      const content = readFileSync(filePath);
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    } catch (e) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });
  
  return server;
}

// ============================================================
// 启动服务器
// ============================================================

function startServer() {
  console.error('[dashboard] 正在启动服务器...');
  const server = createDashboardServer();
  
  server.listen(PORT, HOST, () => {
    console.error(`[dashboard] 服务器已启动: http://${HOST}:${PORT}`);
    console.error(`[dashboard] 按 Ctrl+C 停止服务器`);
  });
  
  server.on('error', (err) => {
    console.error('[dashboard] 服务器错误:', err.message);
  });
  
  // 优雅关闭
  process.on('SIGINT', () => {
    console.error('\n[dashboard] 正在停止服务器...');
    server.close(() => {
      console.error('[dashboard] 服务器已停止');
      process.exit(0);
    });
  });
  
  return server;
}

// ============================================================
// 命令行入口
// ============================================================

const getFilePath = (url) => {
  if (url.startsWith('file:///')) {
    return url.slice(7).replace(/^\/([A-Z]:)/, '$1');
  }
  return url.slice(7);
};

const currentFile = getFilePath(import.meta.url);
const scriptFile = process.argv[1];

if (currentFile === scriptFile || currentFile.replace(/\\/g, '/') === scriptFile.replace(/\\/g, '/')) {
  startServer();
}

export { createDashboardServer, startServer, getDashboardData };
