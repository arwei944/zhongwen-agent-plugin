#!/usr/bin/env node

/**
 * zhongwen-agent · 日志轮转模块
 * 
 * 实现日志文件的自动轮转和压缩：
 * - 单文件超过 10MB 时自动轮转
 * - 超过 30 天的日志自动压缩归档
 * - 使用 gzip 压缩归档文件
 */

import { existsSync, statSync, createReadStream, createWriteStream } from 'fs';
import { join, dirname, basename } from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

// ============================================================
// 配置
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const LOGS_DIR = join(CONFIG_DIR, 'logs');
const ARCHIVE_DIR = join(LOGS_DIR, 'archive');

const CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  retentionDays: 30,
  compressArchive: true,
  checkInterval: 3600000 // 每小时检查一次
};

// 需要轮转的日志文件
const LOG_FILES = [
  'language-audit.log',
  'audit-full.log',
  'audit-violations.log',
  'audit-summary.log',
  'manage.log'
];

// ============================================================
// 轮转逻辑
// ============================================================

/**
 * 检查并执行日志轮转
 */
function rotateLogs() {
  try {
    if (!existsSync(LOGS_DIR)) return;
    
    // 确保归档目录存在
    if (!existsSync(ARCHIVE_DIR)) {
      // 使用同步方式创建目录
      const { mkdirSync } = require('fs');
      mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
    
    for (const logFile of LOG_FILES) {
      const logPath = join(LOGS_DIR, logFile);
      
      if (!existsSync(logPath)) continue;
      
      const stats = statSync(logPath);
      
      // 检查文件大小，超过阈值则轮转
      if (stats.size > CONFIG.maxFileSize) {
        rotateLogFile(logPath);
      }
    }
    
    // 压缩旧日志
    compressOldLogs();
    
    // 清理过期日志
    cleanOldLogs();
    
  } catch (error) {
    // 轮转失败不影响主流程
  }
}

/**
 * 轮转单个日志文件
 * 
 * @param {string} logPath - 日志文件路径
 */
function rotateLogFile(logPath) {
  try {
    const { renameSync, statSync } = require('fs');
    const fileName = basename(logPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rotatedName = `${fileName}.${timestamp}`;
    const rotatedPath = join(LOGS_DIR, rotatedName);
    
    // 重命名当前文件
    renameSync(logPath, rotatedPath);
    
    // 创建新文件
    const { writeFileSync } = require('fs');
    writeFileSync(logPath, '');
    
  } catch (error) {
    // 轮转失败不影响主流程
  }
}

/**
 * 压缩旧日志文件
 */
function compressOldLogs() {
  try {
    const { readdirSync, statSync } = require('fs');
    
    if (!existsSync(LOGS_DIR)) return;
    
    const files = readdirSync(LOGS_DIR);
    const now = Date.now();
    
    for (const file of files) {
      // 跳过目录和已压缩的文件
      if (file.endsWith('.gz') || file === 'archive') continue;
      
      const filePath = join(LOGS_DIR, file);
      const stats = statSync(filePath);
      
      // 只压缩超过 1 小时的文件
      if (stats.size > 0 && (now - stats.mtimeMs) > 3600000) {
        compressFile(filePath);
      }
    }
  } catch (error) {
    // 压缩失败不影响主流程
  }
}

/**
 * 压缩单个文件
 * 
 * @param {string} filePath - 文件路径
 */
async function compressFile(filePath) {
  try {
    const { existsSync, statSync, unlinkSync } = require('fs');
    const { createGzip } = require('zlib');
    const { pipeline } = require('stream/promises');
    const { createReadStream, createWriteStream } = require('fs');
    
    if (!existsSync(filePath)) return;
    
    const gzipPath = `${filePath}.gz`;
    
    // 如果压缩文件已存在，跳过
    if (existsSync(gzipPath)) {
      unlinkSync(filePath);
      return;
    }
    
    const source = createReadStream(filePath);
    const destination = createWriteStream(gzipPath);
    const gzip = createGzip();
    
    await pipeline(source, gzip, destination);
    
    // 删除原文件
    unlinkSync(filePath);
    
  } catch (error) {
    // 压缩失败保留原文件
  }
}

/**
 * 清理过期日志
 */
function cleanOldLogs() {
  try {
    const { readdirSync, statSync, unlinkSync, existsSync } = require('fs');
    const now = Date.now();
    const cutoffTime = now - (CONFIG.retentionDays * 24 * 60 * 60 * 1000);
    
    // 清理日志目录中的旧文件
    if (existsSync(LOGS_DIR)) {
      const files = readdirSync(LOGS_DIR);
      
      for (const file of files) {
        const filePath = join(LOGS_DIR, file);
        const stats = statSync(filePath);
        
        // 删除超过保留期的文件
        if (stats.mtimeMs < cutoffTime) {
          try {
            unlinkSync(filePath);
          } catch (e) {
            // 删除失败继续处理下一个
          }
        }
      }
    }
    
    // 清理归档目录中的旧文件
    if (existsSync(ARCHIVE_DIR)) {
      const archiveFiles = readdirSync(ARCHIVE_DIR);
      
      for (const file of archiveFiles) {
        const filePath = join(ARCHIVE_DIR, file);
        const stats = statSync(filePath);
        
        if (stats.mtimeMs < cutoffTime) {
          try {
            unlinkSync(filePath);
          } catch (e) {
            // 删除失败继续处理下一个
          }
        }
      }
    }
  } catch (error) {
    // 清理失败不影响主流程
  }
}

/**
 * 获取日志统计信息
 * 
 * @returns {object} 日志统计
 */
function getLogStats() {
  try {
    const { readdirSync, statSync } = require('fs');
    const stats = {
      files: [],
      totalSize: 0,
      archiveSize: 0
    };
    
    if (existsSync(LOGS_DIR)) {
      const files = readdirSync(LOGS_DIR);
      
      for (const file of files) {
        const filePath = join(LOGS_DIR, file);
        const fileStats = statSync(filePath);
        
        stats.files.push({
          name: file,
          size: fileStats.size,
          modified: fileStats.mtime.toISOString()
        });
        
        stats.totalSize += fileStats.size;
      }
    }
    
    if (existsSync(ARCHIVE_DIR)) {
      const archiveFiles = readdirSync(ARCHIVE_DIR);
      
      for (const file of archiveFiles) {
        const filePath = join(ARCHIVE_DIR, file);
        const fileStats = statSync(filePath);
        stats.archiveSize += fileStats.size;
      }
    }
    
    return stats;
  } catch (error) {
    return { files: [], totalSize: 0, archiveSize: 0 };
  }
}

// ============================================================
// 导出接口
// ============================================================

export {
  rotateLogs,
  rotateLogFile,
  compressFile,
  cleanOldLogs,
  getLogStats,
  CONFIG
};
