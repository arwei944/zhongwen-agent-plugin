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
// 数据获取（通过子进程调用 MCP 工具）
// ============================================================

/**
 * 通过子进程调用 MCP 工具获取数据
 * 
 * @param {string} toolName - 工具名称
 * @param {object} args - 参数
 * @returns {object} 工具返回结果
 */
async function callMCPTool(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    
    // 使用 check_language.mjs 作为数据源
    const mcpScript = join(CONFIG_DIR, 'mcp', 'check_language.mjs');
    
    if (!existsSync(mcpScript)) {
      reject(new Error('MCP 脚本不存在'));
      return;
    }
    
    const child = spawn('node', [mcpScript], {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };
    
    let responseData = '';
    
    child.stdout.on('data', (data) => {
      responseData += data.toString();
    });
    
    child.stdout.on('end', () => {
      try {
        const lines = responseData.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const response = JSON.parse(lastLine);
        
        if (response.error) {
          reject(new Error(response.error.message));
          return;
        }
        
        const content = response.result?.content?.[0]?.text;
        if (content) {
          resolve(JSON.parse(content));
        } else {
          reject(new Error('无效的响应格式'));
        }
      } catch (e) {
        reject(new Error(`解析响应失败: ${e.message}`));
      }
    });
    
    child.on('error', reject);
    
    // 发送请求
    child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
  });
}

/**
 * 获取仪表板数据
 * 
 * @param {string} range - 时间范围
 * @returns {object} 仪表板数据
 */
async function getDashboardData(range = '7d') {
  try {
    return await callMCPTool('zhongwen_dashboard', { range });
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
  const server = createDashboardServer();
  
  server.listen(PORT, HOST, () => {
    console.error(`[dashboard] 服务器已启动: http://${HOST}:${PORT}`);
    console.error(`[dashboard] 按 Ctrl+C 停止服务器`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export { createDashboardServer, startServer, getDashboardData };
