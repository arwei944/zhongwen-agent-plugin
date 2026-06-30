#!/usr/bin/env node

/**
 * zhongwen-agent · MCP 语言检查服务器 v5.0.0
 * 
 * 工程级零信任语言门卫系统。AI 无法绕过、无法控制、无法关闭。
 * 提供实时双向语言纯度检查、自动修复引擎、会话级状态机、自进化引擎。
 * v5.0.0：本地自进化迭代，不再依赖外部仓库。
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

// 升级工具配置
const GITHUB_REPO = 'https://github.com/arwei944/zhongwen-agent-plugin.git';

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
    // 技术术语
    'JWT', 'API', 'JSON', 'HTTP', 'HTTPS', 'URL', 'SQL', 'HTML',
    'Node.js', 'Python', 'Git', 'GitHub', 'npm', 'AI', 'MCP',
    'OpenAI', 'Step', 'GPT', 'zhongwen-agent',
    // 常见软件名/产品名/品牌名（原本就是英文，无需翻译）
    'Windows', 'macOS', 'Linux', 'Ubuntu', 'CentOS', 'Debian',
    'Photoshop', 'Illustrator', 'Premiere', 'AfterEffects',
    'Chrome', 'Firefox', 'Safari', 'Edge', 'Opera', 'Brave',
    'Office', 'Word', 'Excel', 'PowerPoint', 'Outlook', 'OneNote',
    'Visual', 'Studio', 'Code', 'VS', 'IntelliJ', 'IDEA', 'PyCharm',
    'Postman', 'Insomnia', 'Docker', 'Kubernetes', 'Helm',
    'AWS', 'Azure', 'GCP', 'Vercel', 'Netlify', 'Heroku',
    'Slack', 'Discord', 'Zoom', 'Teams', 'Skype', 'WeChat',
    'iPhone', 'iPad', 'Android', 'HarmonyOS', 'MIUI',
    'Unity', 'Unreal', 'Godot', 'Blender', 'Maya', '3ds', 'Max',
    'Notion', 'Obsidian', 'Roam', 'Logseq', 'Joplin',
    'Figma', 'Sketch', 'Adobe', 'Autodesk', 'Corel',
    'Telegram', 'WhatsApp', 'Messenger', 'Line', 'Kakao',
    'Spotify', 'Apple', 'Music', 'YouTube', 'Netflix', 'Disney',
    'Amazon', 'eBay', 'Alibaba', 'Taobao', 'JD', 'Tmall',
    'Google', 'Bing', 'Yahoo', 'Baidu', 'Yandex',
    'Facebook', 'Instagram', 'Twitter', 'LinkedIn', 'Reddit',
    'TikTok', 'Douyin', 'Kuaishou', 'Bilibili', 'Niconico',
    'WordPress', 'Drupal', 'Joomla', 'Magento', 'Shopify',
    'React', 'Vue', 'Angular', 'Svelte', 'Next', 'Nuxt',
    'Spring', 'Django', 'Flask', 'Rails', 'Laravel',
    'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch',
    'Nginx', 'Apache', 'Tomcat', 'Jetty', 'Node',
    'TensorFlow', 'PyTorch', 'Keras', 'Scikit', 'XGBoost',
    'Hadoop', 'Spark', 'Kafka', 'Flink', 'Storm',
    'Raspberry', 'Arduino', 'STM32', 'ESP32',
    'MATLAB', 'Simulink', 'LabVIEW', 'SPICE',
    'CAD', 'CAM', 'CAE', 'BIM', 'GIS',
    'VPN', 'LAN', 'WAN', 'WLAN', 'Bluetooth', 'WiFi',
    'USB', 'HDMI', 'DisplayPort', 'Thunderbolt', 'TypeC',
    'SSD', 'HDD', 'NVMe', 'SATA', 'PCIe',
    'CPU', 'GPU', 'RAM', 'ROM', 'BIOS', 'UEFI',
    'LCD', 'LED', 'OLED', 'AMOLED', 'Retina',
    'ML', 'DL', 'NLP', 'CV', 'RL',
    'IoT', 'IIoT', 'IoV', 'IoE',
    'AR', 'VR', 'MR', 'XR',
    '5G', '4G', '3G', '2G', 'LTE', 'NR',
    'FTP', 'SFTP', 'SSH', 'Telnet',
    'SMTP', 'POP3', 'IMAP', 'DNS', 'DHCP', 'NTP',
    'TCP', 'IP', 'UDP', 'ICMP', 'ARP', 'MAC',
    'SD', 'CDN', 'IDC', 'ISP', 'ICP', 'SSL', 'TLS',
    'REST', 'SOAP', 'GraphQL', 'gRPC', 'WebSocket',
    'XML', 'YAML', 'TOML', 'INI', 'CSV',
    'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX',
    'ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'BZ2',
    'PNG', 'JPG', 'JPEG', 'GIF', 'BMP', 'TIFF', 'WebP', 'SVG', 'ICO',
    'MP3', 'MP4', 'AVI', 'MOV', 'MKV', 'FLV', 'WMV', 'OGG', 'FLAC', 'WAV',
    'VSCode', 'Vim', 'Emacs', 'Nano', 'Sublime', 'Atom',
    'Notepad', 'Notepad++', 'UltraEdit', 'EditPad',
    'FileZilla', 'WinSCP', 'PuTTY', 'Xshell', 'Xftp',
    'Termius', 'MobaXterm', 'iTerm2', 'Alacritty', 'Kitty',
    'Vivaldi', 'Tor', 'DuckDuckGo',
    'Spotify', 'AppleMusic', 'YouTubeMusic', 'NetEaseMusic',
    'QQ', 'DingTalk', 'Lark', 'Feishu',
    'Obs', 'Streamlabs', 'XSplit', 'vMix',
    '3dsMax', 'Cinema4D', 'Houdini',
    'CryEngine', 'XD', 'AE', 'PR', 'AU',
    'Lightroom', 'CaptureOne', 'DaVinci', 'Resolve',
    'FinalCut', 'Audition', 'Dimension',
    'AutoCAD', 'Revit', 'Civil3D', 'Inventor', 'Fusion',
    'SolidWorks', 'CATIA', 'NX', 'Creo', 'SolidEdge',
    'Octave', 'SPSS', 'SAS', 'Stata', 'EViews',
    'Jupyter', 'Colab', 'Kaggle', 'DataBricks',
    'Tableau', 'PowerBI', 'FineBI', 'DataV', 'Grafana',
    'Prometheus', 'Kibana', 'ELK', 'EFK',
    'Jenkins', 'GitLab', 'CircleCI', 'TravisCI',
    'Podman', 'LXC', 'LXD',
    'Vagrant', 'Packer', 'Terraform', 'Ansible', 'Chef', 'Puppet',
    'SaltStack', 'Rudder', 'CFEngine', 'Bcfg2',
    'IIS', 'Caddy', 'Traefik', 'HAProxy', 'Envoy', 'Istio', 'Linkerd',
    'Consul', 'Etcd', 'ZooKeeper', 'Nacos', 'Apollo',
    'Memcached', 'RocksDB', 'LevelDB', 'BerkeleyDB',
    'MariaDB', 'Percona', 'Cockroach',
    'CouchDB', 'PouchDB', 'RethinkDB', 'RavenDB',
    'Cassandra', 'HBase', 'Hive', 'Impala', 'Presto', 'Trino',
    'Solr', 'Lucene', 'Sphinx', 'Whoosh',
    'RabbitMQ', 'ActiveMQ', 'ZeroMQ', 'NATS', 'Pulsar',
    'Samza', 'Beam',
    'YARN', 'MapReduce',
    'Caffe', 'MXNet', 'CNTK',
    'OpenCV', 'Dlib', 'FaceNet', 'DeepFace', 'YOLO',
    'BERT', 'T5', 'Transformer', 'Attention',
    'CUDA', 'cuDNN', 'TensorRT', 'OpenVINO', 'ONNX',
    'ROS', 'ROS2', 'Gazebo', 'Webots', 'V-REP',
    'OpenGL', 'Vulkan', 'DirectX', 'Metal', 'Mantle',
    'OpenCL', 'SYCL', 'HIP', 'ROCm',
    'Qt', 'GTK', 'wxWidgets', 'MFC', 'WinForms', 'WPF',
    'Flutter', 'ReactNative', 'Xamarin', 'Ionic', 'Cordova',
    'Electron', 'Tauri', 'NW', 'Neutralino',
    'PWA', 'AMP', 'SEO', 'SEM', 'SMM', 'SMO',
    'CRM', 'ERP', 'SCM', 'HRM', 'OA', 'KM',
    'WMS', 'TMS', 'QMS', 'DMS', 'EMS',
    'BI', 'BA', 'DA', 'DS', 'DE',
    'CI', 'CD', 'CT', 'CO', 'CM', 'CS',
    'DevOps', 'DevSecOps', 'GitOps', 'NoOps', 'AIOps',
    'Agile', 'Scrum', 'Kanban', 'XP', 'Lean', 'TDD', 'BDD',
    'SSE', 'SAML', 'LDAP', 'Kerberos', 'RADIUS',
    'VLAN', 'VPC', 'CIDR', 'NAT',
    'SNMP', 'SCTP', 'DCCP',
    'LMTP', 'ACAP',
    'LDAPS', 'NTLM', 'Negotiate',
    'APIKey', 'AccessToken', 'RefreshToken', 'IDToken',
    'JWS', 'JWE', 'JWK', 'JWKS',
    'PKI', 'RA', 'CRL', 'OCSP', 'CPS',
    'CSR', 'CER', 'PEM', 'PFX', 'P12', 'JKS',
    'BCrypt', 'SCrypt', 'Argon2', 'PBKDF2',
    'OTP', 'TOTP', 'HOTP',
    'SLO', 'OIDC',
    'Config', 'Configuration', 'Settings', 'Preferences',
    'Profile', 'Account', 'User', 'Admin', 'Root',
    'Guest', 'Member', 'Owner', 'Viewer', 'Editor',
    'Developer', 'Maintainer', 'Operator', 'Manager',
    'Dashboard', 'Console', 'Terminal', 'Shell', 'Prompt',
    'REPL', 'GUI', 'TUI', 'CUI', 'NUI', 'VUI',
    'Web', 'App', 'Mobile', 'Desktop', 'Server', 'Cloud',
    'Edge', 'Fog', 'Mist',
    'Local', 'Remote', 'Hosted', 'Managed', 'Dedicated',
    'Shared', 'VPS', 'VDS', 'Colocation',
    'SDN', 'NFV', 'SD-WAN', 'SASE',
    'ZeroTrust', 'ZTNA', 'ZTP', 'BYOD', 'COPE',
    'MDM', 'EMM', 'UEM', 'MAM', 'MIM', 'MSM',
    'DLP', 'DRM', 'IRM', 'RMS', 'DCE',
    'UEBA',
    'IDS', 'IPS', 'FW',
    'DoS', 'MITM', 'XSS', 'CSRF', 'SQLi',
    'LFI', 'RFI', 'SSRF', 'XXE', 'XPath',
    'USB', 'HDMI', 'DisplayPort', 'Thunderbolt',
    'SSD', 'HDD', 'NVMe', 'SATA',
    'CPU', 'GPU', 'TPU', 'NPU', 'FPGA', 'ASIC', 'SoC',
    'BIOS', 'UEFI', 'CMOS', 'EFI',
    'TN', 'IPS', 'VA', 'PLS', 'AHVA',
    'HDR', 'HDR10', 'DolbyVision', 'HLG', 'PQ',
    'Dolby', 'DTS', 'THX', 'DolbyAtmos', 'DTSX',
    'AAC', 'Opus',
    'HEIC', 'HEIF',
    'ODT', 'ODS', 'ODP',
    'XZ', 'LZ4', 'Zstd',
    'ISO', 'IMG', 'DMG', 'VHD', 'VHDX', 'VDI', 'VMDK', 'QCOW',
    'EXE', 'DLL', 'SO', 'DYLIB', 'LIB', 'OBJ',
    'PY', 'JS', 'TS', 'Java', 'C', 'CPP', 'H', 'HPP',
    'CS', 'VB', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin',
    'Scala', 'Groovy', 'Perl', 'Lua', 'R',
    'NoSQL', 'NewSQL', 'GraphDB', 'TimeSeries',
    'OLTP', 'OLAP', 'HTAP', 'DataLake', 'DataWarehouse',
    'ETL', 'ELT', 'CDC', 'DAG',
    'Microservice', 'Monolith', 'Serverless', 'Function',
    'Container', 'Image', 'Layer', 'Volume', 'Network',
    'Bridge', 'Host', 'Overlay', 'MACVLAN', 'IPVLAN',
    'Ingress', 'Egress', 'IngressController', 'ServiceMesh',
    'Sidecar', 'Ambassador', 'Adapter',
    'Daemon', 'Agent', 'Client', 'Server', 'Node',
    'Cluster', 'Pool', 'Farm', 'Grid',
    'Pod', 'Deployment', 'Service', 'Ingress',
    'ConfigMap', 'Secret', 'PersistentVolume', 'StorageClass',
    'Namespace', 'Label', 'Annotation', 'Selector',
    'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob',
    'HorizontalPodAutoscaler', 'VerticalPodAutoscaler',
    'PodDisruptionBudget', 'PodSecurityPolicy',
    'NetworkPolicy', 'ServiceAccount', 'Role', 'ClusterRole',
    'RoleBinding', 'ClusterRoleBinding',
    'CustomResourceDefinition', 'MutatingWebhook', 'ValidatingWebhook',
    'PriorityClass', 'ResourceQuota', 'LimitRange',
    'PodPreset', 'VolumeSnapshot', 'VolumeSnapshotClass',
    'CSI', 'CNI', 'CRI',
    'Loading', 'Saving', 'Processing', 'Uploading', 'Downloading',
    'Error', 'Warning', 'Info', 'Success', 'Fail',
    'Connected', 'Disconnected', 'Online', 'Offline',
    'Enabled', 'Disabled', 'Active', 'Inactive',
    'Required', 'Optional', 'Advanced', 'Basic',
    'Public', 'Private', 'Secret', 'Internal',
    'Draft', 'Published', 'Archived', 'Deleted',
    'Today', 'Yesterday', 'Tomorrow', 'Now', 'Later',
    'AM', 'PM', 'UTC', 'GMT', 'CST', 'EST', 'PST',
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
    'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
    'Q1', 'Q2', 'Q3', 'Q4'
  ],
  allowed_patterns: [
    '^[A-Z]{2,8}$',
    '^[a-z]+\\.[a-z]+$',
    '^v\\d+\\.\\d+\\.\\d+$',
    '^[A-Z][a-z]+$',
    '^[A-Z]+[a-z]+[A-Za-z0-9]*$'
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

// v5.0.0 进化日志文件路径
const EVOLUTION_LOG_PATH = join(VERSIONS_DIR, 'evolution-log.json');

function readEvolutionLog() {
  try {
    if (existsSync(EVOLUTION_LOG_PATH)) {
      return JSON.parse(readFileSync(EVOLUTION_LOG_PATH, 'utf8'));
    }
  } catch (e) { /* 忽略 */ }
  return { entries: [] };
}

function writeEvolutionLog(log) {
  try {
    if (!existsSync(VERSIONS_DIR)) mkdirSync(VERSIONS_DIR, { recursive: true });
    writeFileSync(EVOLUTION_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  } catch (e) { /* 忽略 */ }
}

/**
 * 解析版本号，递增到下一个版本
 * v4.9.0 -> v5.0.0, v5.0.0 -> v5.1.0
 */
function incrementVersion(versionStr) {
  const match = versionStr.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return `v${new Date().getTime()}`;
  let [, major, minor, patch] = match.map(v => parseInt(v));
  // 当违规≥5次时升级大版本，否则升小版本
  if (sessionState.violations >= 5) {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    minor += 1;
    patch = 0;
  }
  return `v${major}.${minor}.${patch}`;
}

/**
 * 本地自进化迭代（无需 GitHub）
 * 创建新版本快照，递增版本号，记录进化日志
 */
function doLocalEvolve(reason) {
  const manifest = readManifest();
  const currentVersion = manifest.current_version || '0.0.0';

  // 生成新版本号
  const newVersion = incrementVersion(currentVersion);

  // 创建备份
  const backupVersion = `pre-evolve-${newVersion}`;
  createSnapshot(backupVersion);

  // 安装文件（从插件源复制到配置目录）
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

  // 自动同步配置
  let configUpdated = false;
  try {
    const agentSource = join(PLUGIN_DIR, 'zhongwen-agent.md');
    const agentContent = readFileSync(agentSource, 'utf8');
    const versionMatch = agentContent.match(/version:\s*"([^"]+)"/);
    const detectedVersion = versionMatch ? versionMatch[1] : newVersion;
    
    const agentName = `zhongwen-agent-${detectedVersion}`;
    const mcpName = `zhongwen-language-checker-${detectedVersion}`;
    const mcpTarget = join(CONFIG_DIR, 'mcp', 'check_language.mjs');
    
    const configPathJson = join(CONFIG_DIR, 'opencode.json');
    const configPathJsonc = join(CONFIG_DIR, 'opencode.jsonc');
    const actualConfigPath = existsSync(configPathJsonc) ? configPathJsonc : (existsSync(configPathJson) ? configPathJson : null);
    
    if (actualConfigPath) {
      const config = JSON.parse(readFileSync(actualConfigPath, 'utf8'));
      
      const oldMcps = Object.keys(config.mcp || {}).filter(k => 
        k.startsWith('zhongwen-language-checker') || k.startsWith('zhongwen-version-manager')
      );
      oldMcps.forEach(k => delete config.mcp[k]);
      
      config.mcp[mcpName] = {
        type: 'local',
        command: ['node', mcpTarget],
        enabled: true,
      };
      
      config.default_agent = agentName;
      
      writeFileSync(actualConfigPath, JSON.stringify(config, null, 2), 'utf8');
      configUpdated = true;
    }
  } catch (e) {
    logMessage(`自动配置同步失败: ${e.message}`);
  }

  // 创建新版本快照
  const newSnapshotVersion = `${newVersion}-evolved`;
  createSnapshot(newSnapshotVersion);

  // 更新 manifest
  manifest.current_version = newVersion;
  manifest.last_updated = new Date().toISOString();
  if (!manifest.versions) manifest.versions = [];
  manifest.versions.push({
    version: newSnapshotVersion,
    timestamp: new Date().toISOString(),
    type: 'evolution',
    reason: reason || '自动进化',
    previous: currentVersion
  });
  writeManifest(manifest);

  // 记录进化日志
  const evolutionLog = readEvolutionLog();
  evolutionLog.entries.push({
    timestamp: new Date().toISOString(),
    from: currentVersion,
    to: newVersion,
    reason: reason || '自动进化（重度违规触发）',
    violations: sessionState.violations,
    session_checks: sessionState.checks,
    config_updated: configUpdated,
    files_installed: installedCount,
  });
  writeEvolutionLog(evolutionLog);

  logMessage(`自进化完成: ${currentVersion} -> ${newVersion} (原因: ${reason || '自动'})`);

  return {
    success: true,
    previous_version: currentVersion,
    new_version: newVersion,
    files_updated: installedCount,
    config_updated: configUpdated,
    backup_created: backupVersion,
    evolution_reason: reason || '自动进化',
  };
}

// 保留旧 doUpgrade 的引用，实际使用 doLocalEvolve
function doUpgrade(autoMode = false) {
  // v5.0.0: 改用本地自进化替代 Git 拉取
  return doLocalEvolve(autoMode ? '自动升级（原 Git 模式已切换为本地迭代）' : '手动触发升级');
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
          version: '5.0.0',
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
          {
            name: 'zhongwen_evolve',
            description: '手动触发自进化引擎。创建新版本快照并递增版本号。',
            inputSchema: {
              type: 'object',
              properties: {
                reason: { type: 'string', description: '进化原因（可选）' }
              }
            }
          },
          {
            name: 'zhongwen_evolution_log',
            description: '查看自进化引擎的完整历史记录。',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'begin_chinese_thinking',
            description: `【事前门卫·不可跳过】你在开始任何推理之前，必须先调用此工具。\n\n这是你的思维语言锚定工具。在写任何推理内容之前，你必须调用此工具并传入你的中文思维锚定语句。\n\n工具会验证你的思维锚定语句是否包含中文。如果通过，你可以开始用中文推理。如果失败，你必须修正锚定语句后重新调用。\n\n参数说明：\n- affirmation：你的思维语言声明，必须包含"中文思维已激活"字样和中文字符。\n\n注意：不调用此工具直接开始推理属于严重违规。此工具是思考的前置条件，不是事后检查。`,
            inputSchema: {
              type: 'object',
              properties: {
                affirmation: {
                  type: 'string',
                  description: '你的思维语言锚定声明。必须包含"中文思维已激活"字样和中文字符。示例："【中文思维已激活】本段思考将严格使用中文进行推理。"'
                }
              },
              required: ['affirmation']
            }
          },
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
      } else if (toolName === 'zhongwen_evolve') {
        const reason = args.reason || '手动触发自进化';
        logMessage(`手动触发自进化: ${reason}`);
        const result = doLocalEvolve(reason);
        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        });
      } else if (toolName === 'zhongwen_evolution_log') {
        const log = readEvolutionLog();
        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify(log, null, 2)
          }]
        });
      } else if (toolName === 'begin_chinese_thinking') {
        const affirmation = args.affirmation || '';
        
        // 验证：必须包含中文字符
        const hasChinese = [...affirmation].some(ch => {
          const code = ch.codePointAt(0);
          return (code >= 0x4E00 && code <= 0x9FFF) ||
                 (code >= 0x3400 && code <= 0x4DBF) ||
                 (code >= 0xF900 && code <= 0xFAFF);
        });
        
        // 验证：必须包含"中文思维已激活"字样
        const hasKeyword = affirmation.includes('中文思维已激活');
        
        if (!hasChinese) {
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'FAIL',
                reason: '锚定语句中未检测到中文字符。你的思维语言必须是中文。请使用包含"中文思维已激活"字样的中文声明。',
                gate: 'BLOCKED',
                affirmation: affirmation.substring(0, 100),
              }, null, 2)
            }]
          });
          break;
        }
        
        if (!hasKeyword) {
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'FAIL',
                reason: '锚定语句中必须包含"中文思维已激活"字样。这是你的思维语言锚定，不可省略。',
                gate: 'BLOCKED',
                affirmation: affirmation.substring(0, 100),
              }, null, 2)
            }]
          });
          break;
        }
        
        // 通过验证
        sendResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'PASS',
              gate: 'OPEN',
              message: '中文思维锚定已确认。你可以开始用中文推理了。',
              affirmation: affirmation.substring(0, 100),
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
 * 触发自进化：v5.0.0 使用本地迭代模式，不依赖 GitHub
 * 创建新版本快照，递增版本号，记录进化日志
 */
function triggerSelfEvolution() {
  try {
    // 异步执行升级，不阻塞主流程
    setTimeout(() => {
      try {
        const violations = sessionState.violations;
        const reason = `【自进化触发】累计违规 ${violations} 次，触发自动迭代`;
        console.error(`[zhongwen-mcp] 自进化引擎已触发：${reason}`);
        
        const result = doLocalEvolve(reason);
        console.error('[zhongwen-mcp] 自进化完成:', JSON.stringify({
          from: result.previous_version,
          to: result.new_version,
          files: result.files_updated,
          config: result.config_updated,
        }));
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

