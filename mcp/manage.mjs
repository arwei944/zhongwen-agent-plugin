#!/usr/bin/env node

/**
 * zhongwen-agent · MCP 版本管理服务器
 * 
 * 提供版本管理工具，智能体可直接调用：
 * - zhongwen_status    查看当前状态
 * - zhongwen_snapshot  创建版本快照
 * - zhongwen_rollback  回滚到指定版本
 * - zhongwen_upgrade   从 GitHub 升级
 * - zhongwen_history   查看版本历史
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

// ============================================================
// 路径配置
// ============================================================

const CONFIG_DIR = 'C:\\Users\\Administrator\\.config\\opencode';
const VERSIONS_DIR = join(CONFIG_DIR, 'versions');
const MANIFEST_PATH = join(VERSIONS_DIR, 'manifest.json');
const PLUGIN_DIR = 'D:\\work\\opencode\\zhongwen-agent-plugin';
const LOG_PATH = join(CONFIG_DIR, 'logs', 'manage.log');
const HOST = '127.0.0.1';
const PORT = 3000;

const MANAGED_FILES = [
  { source: join(PLUGIN_DIR, 'zhongwen-agent.md'), relPath: 'agents/zhongwen-agent.md' },
  { source: join(PLUGIN_DIR, 'chinese-rules.md'), relPath: 'chinese-rules.md' },
  { source: join(PLUGIN_DIR, 'mcp', 'check_language.mjs'), relPath: 'mcp/check_language.mjs' },
];

// ============================================================
// 辅助函数
// ============================================================

function logMessage(message) {
  const timestamp = new Date().toISOString();
  try {
    if (!existsSync(dirname(LOG_PATH))) mkdirSync(dirname(LOG_PATH), { recursive: true });
    writeFileSync(LOG_PATH, `[${timestamp}] ${message}\n`, { flag: 'a' });
  } catch (e) { /* ignore */ }
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

function doUpgrade() {
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
    backup_created: backupVersion
  };
}

// ============================================================
// MCP 服务器
// ============================================================

const rl = createInterface({ input: process.stdin });

function sendResponse(id, result, error = null) {
  const response = { jsonrpc: '2.0', id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}

function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'zhongwen-version-manager', version: '1.0.0' }
      });
      break;

    case 'notifications/initialized':
      sendResponse(id, { ok: true });
      break;

    case 'tools/list':
      sendResponse(id, {
        tools: [
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
          {
            name: 'zhongwen_open_dashboard',
            description: '打开 Web 可视化仪表盘。自动启动仪表盘服务器并在浏览器中打开。',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      switch (toolName) {
        case 'zhongwen_status': {
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
          break;
        }

        case 'zhongwen_snapshot': {
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
          break;
        }

        case 'zhongwen_rollback': {
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
          break;
        }

        case 'zhongwen_upgrade': {
          const result = doUpgrade();

          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          });
          break;
        }

        case 'zhongwen_history': {
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
          break;
        }

        case 'zhongwen_open_dashboard': {
          try {
            const { spawn } = require('child_process');
            const dashboardScript = join(CONFIG_DIR, 'mcp', 'dashboard.mjs');
            
            // 检查是否已经在运行
            const { existsSync } = require('fs');
            if (!existsSync(dashboardScript)) {
              sendResponse(id, {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: '仪表盘服务器脚本不存在'
                  })
                }]
              });
              break;
            }
            
            // 启动仪表盘服务器
            const child = spawn('node', [dashboardScript], {
              detached: true,
              stdio: 'ignore'
            });
            
            child.unref();
            
            // 等待服务器启动
            setTimeout(() => {
              // 打开浏览器
              const url = `http://${HOST}:${PORT}`;
              
              try {
                const { exec } = require('child_process');
                exec(`start ${url}`, (error) => {
                  if (error) {
                    console.error('打开浏览器失败:', error);
                  }
                });
              } catch (e) {
                console.error('打开浏览器失败:', e.message);
              }
            }, 1500);
            
            sendResponse(id, {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  url: `http://${HOST}:${PORT}`,
                  pid: child.pid,
                  message: '仪表盘服务器已启动'
                }, null, 2)
              }]
            });
          } catch (error) {
            sendResponse(id, {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: error.message
                })
              }]
            });
          }
          break;
        }

        default:
          sendResponse(id, null, { code: -32601, message: `未知工具: ${toolName}` });
      }
      break;
    }

    default:
      sendResponse(id, null, { code: -32601, message: `不支持的请求方法: ${method}` });
  }
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const request = JSON.parse(trimmed);
    handleRequest(request);
  } catch (e) {
    // ignore invalid JSON
  }
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

logMessage('版本管理 MCP 服务器已启动');
