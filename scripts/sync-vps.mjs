#!/usr/bin/env node
/**
 * 跨平台 VPS 数据同步脚本
 * 支持 Windows / macOS / Linux
 *
 * 使用方法:
 *   node scripts/sync-vps.mjs                    # 同步最新数据
 *   node scripts/sync-vps.mjs --check            # 仅预检 SSH 与本地待同步文件
 *   node scripts/sync-vps.mjs --export           # 预聚合模式（推荐）
 *   node scripts/sync-vps.mjs 文件路径            # 指定文件
 *   node scripts/sync-vps.mjs --no-restart       # 同步但不重启
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { homedir, platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// 配置
const SSH_ALIAS = 'chexian-vps-deploy';
const DEFAULT_HOST = '162.14.113.44';
const DEFAULT_USER = 'deployer';
const DEFAULT_PORT = 22;
const DEFAULT_KEY_PATH = join(process.env.USERPROFILE || homedir(), '.ssh', 'chexian_deploy');
const VPS_DATA_DIR = '/var/www/chexian/server/data';
const LOCAL_DATA_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');
const VPS_EXPORT_DIR = join(ROOT_DIR, '数据管理/warehouse/vps-export');

// 颜色
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(color, msg) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteForSingle(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/**
 * 执行本地命令
 */
function runLocal(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd || ROOT_DIR,
      stdio: options.silent ? 'pipe' : 'inherit',
      shell: false,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`命令失败: ${cmd} ${args.join(' ')}\n${stderr || stdout}`));
      }
    });
  });
}

/**
 * 解析 SSH 配置文件，获取主机信息
 */
function parseSSHConfig(alias) {
  const configPath = join(process.env.USERPROFILE || process.env.HOME || homedir(), '.ssh', 'config');
  if (!existsSync(configPath)) return null;

  const content = readFileSync(configPath, 'utf-8');
  const lines = content.split('\n');

  let inHost = false;
  const hostConfig = {};

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.toLowerCase().startsWith('host ')) {
      const hosts = line.substring(5).trim().split(/\s+/);
      inHost = hosts.includes(alias);
      continue;
    }

    if (!inHost) continue;

    const [key, ...valueParts] = line.split(/\s+/);
    const value = valueParts.join(' ');

    switch (key.toLowerCase()) {
      case 'hostname':
        hostConfig.host = value;
        break;
      case 'user':
        hostConfig.username = value;
        break;
      case 'identityfile':
        hostConfig.privateKeyPath = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
        break;
      case 'port':
        hostConfig.port = Number.parseInt(value, 10);
        break;
      default:
        break;
    }
  }

  if (!hostConfig.host) return null;
  return {
    mode: 'direct',
    host: hostConfig.host,
    username: hostConfig.username || DEFAULT_USER,
    port: hostConfig.port || DEFAULT_PORT,
    privateKeyPath: hostConfig.privateKeyPath || DEFAULT_KEY_PATH,
  };
}

function resolveSshConfig() {
  const fromAlias = parseSSHConfig(SSH_ALIAS);
  if (fromAlias) return fromAlias;

  return {
    mode: 'direct',
    host: DEFAULT_HOST,
    username: DEFAULT_USER,
    port: DEFAULT_PORT,
    privateKeyPath: DEFAULT_KEY_PATH,
  };
}

function buildSshArgs(config, remoteCommand) {
  const args = [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'ConnectTimeout=10',
  ];

  if (config.mode === 'direct') {
    args.push('-p', String(config.port));
    args.push('-i', config.privateKeyPath);
    args.push(`${config.username}@${config.host}`);
  } else {
    args.push(SSH_ALIAS);
  }

  args.push(remoteCommand);
  return args;
}

function buildScpArgs(config, localPath, remotePath) {
  const args = ['-o', 'StrictHostKeyChecking=no'];

  if (config.mode === 'direct') {
    args.push('-P', String(config.port));
    args.push('-i', config.privateKeyPath);
    args.push(localPath, `${config.username}@${config.host}:${remotePath}`);
  } else {
    args.push(localPath, `${SSH_ALIAS}:${remotePath}`);
  }

  return args;
}

async function execRemote(config, remoteCommand, options = {}) {
  const args = buildSshArgs(config, remoteCommand);
  return runLocal('ssh', args, options);
}

async function uploadFile(config, localPath, remotePath) {
  const args = buildScpArgs(config, localPath, remotePath);
  await runLocal('scp', args);
}

async function ensureSshReady(config) {
  const sshProbe = await runLocal('ssh', ['-V'], { silent: true, allowFailure: true });
  if (sshProbe.code !== 0) {
    throw new Error('未检测到 OpenSSH 客户端（ssh/scp），请先安装并加入 PATH');
  }

  if (config.mode === 'direct' && !existsSync(config.privateKeyPath)) {
    throw new Error(`SSH 私钥不存在: ${config.privateKeyPath}`);
  }

  await execRemote(config, 'true', { silent: true });
}

async function healthCheck(config, maxAttempts = 8) {
  for (let i = 1; i <= maxAttempts; i += 1) {
    await sleep(5000);

    const result = await execRemote(config, 'curl -s http://localhost:3000/health', {
      silent: true,
      allowFailure: true,
    });

    if ((result.stdout || '').includes('success')) {
      return true;
    }

    log('yellow', `  等待服务启动... (${i}/${maxAttempts})`);
  }
  return false;
}

function getLatestParquet(dir) {
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.parquet'))
    .map((f) => ({
      name: f,
      path: join(dir, f),
      mtime: statSync(join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files[0] || null;
}

function formatSize(path) {
  const bytes = statSync(path).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function collectCheckFiles() {
  const currentFiles = existsSync(LOCAL_DATA_DIR)
    ? readdirSync(LOCAL_DATA_DIR)
      .filter((f) => f.endsWith('.parquet'))
      .map((f) => join(LOCAL_DATA_DIR, f))
    : [];

  const exportFiles = existsSync(VPS_EXPORT_DIR)
    ? readdirSync(VPS_EXPORT_DIR)
      .filter((f) => f.endsWith('.parquet'))
      .map((f) => join(VPS_EXPORT_DIR, f))
    : [];

  return [...currentFiles, ...exportFiles];
}

async function main() {
  const args = process.argv.slice(2);

  let exportMode = false;
  let noRestart = false;
  let checkMode = false;
  let cleanVps = false;
  let targetFile = null;

  for (const arg of args) {
    if (arg === '--export') exportMode = true;
    else if (arg === '--no-restart') noRestart = true;
    else if (arg === '--clean-vps') cleanVps = true;
    else if (arg === '--check') checkMode = true;
    else if (!arg.startsWith('-')) targetFile = arg;
  }

  log('blue', '================================================================================');
  log('blue', 'VPS 数据同步工具（跨平台版）');
  log('blue', '================================================================================');

  const sshConfig = resolveSshConfig();
  log('green', `✓ SSH 目标: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`);
  log('green', `✓ 密钥路径: ${sshConfig.privateKeyPath}`);

  try {
    log('yellow', '▶ SSH 连通性预检...');
    await ensureSshReady(sshConfig);
    log('green', '✓ SSH 连接成功');
  } catch (e) {
    log('red', `错误：SSH 预检失败: ${e.message}`);
    process.exit(1);
  }

  if (checkMode) {
    const files = collectCheckFiles();
    log('green', `✓ 本地待同步文件数: ${files.length}`);
    files.forEach((f) => {
      console.log(`  - ${basename(f)} (${formatSize(f)})`);
    });
    return;
  }

  if (exportMode) {
    log('green', '▶ 步骤 1: 运行预聚合导出...');
    const exportScript = join(ROOT_DIR, 'scripts/export-for-vps.mjs');
    if (!existsSync(exportScript)) {
      log('red', `错误：导出脚本不存在: ${exportScript}`);
      process.exit(1);
    }

    try {
      await runLocal('node', [exportScript]);
    } catch (e) {
      log('red', `错误：导出脚本失败: ${e.message}`);
      process.exit(1);
    }
  }

  let filesToUpload = [];

  if (exportMode) {
    const exportFileNames = ['aggregated.parquet', 'cross_sell_agg.parquet', 'renewal_agg.parquet'];
    filesToUpload = exportFileNames
      .map((name) => join(VPS_EXPORT_DIR, name))
      .filter((filePath) => existsSync(filePath));

    if (filesToUpload.length === 0) {
      log('red', `错误：未找到可上传的预聚合文件: ${VPS_EXPORT_DIR}`);
      process.exit(1);
    }
  } else {
    if (!targetFile) {
      const latest = getLatestParquet(LOCAL_DATA_DIR);
      if (!latest) {
        log('red', `错误：未找到 Parquet 文件: ${LOCAL_DATA_DIR}`);
        process.exit(1);
      }
      targetFile = latest.path;
    } else if (!existsSync(targetFile)) {
      const tryPath = join(LOCAL_DATA_DIR, targetFile);
      if (existsSync(tryPath)) {
        targetFile = tryPath;
      } else {
        log('red', `错误：文件不存在: ${targetFile}`);
        process.exit(1);
      }
    }

    filesToUpload = [targetFile];
  }

  log('green', `▶ 步骤 ${exportMode ? 2 : 1}: 上传文件 (${filesToUpload.length} 个)...`);

  try {
    await execRemote(
      sshConfig,
      `mkdir -p ${quoteForSingle(`${VPS_DATA_DIR}/current`)} ${quoteForSingle(`${VPS_DATA_DIR}/archive`)}`,
    );

    if (cleanVps) {
      log('yellow', '  清理 VPS 的 current 目录...');
      const d = new Date();
      const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
      await execRemote(
        sshConfig,
        `mkdir -p ${VPS_DATA_DIR}/archive/backup_${ts} && mv ${VPS_DATA_DIR}/current/*.parquet ${VPS_DATA_DIR}/archive/backup_${ts}/ 2>/dev/null || true`,
        { allowFailure: true }
      );
      
      log('yellow', '  清理 VPS 上超过 30 天的过期归档...');
      await execRemote(
        sshConfig,
        `find ${VPS_DATA_DIR}/archive -type d -name 'backup_*' -mtime +30 -exec rm -rf {} + 2>/dev/null || true`,
        { allowFailure: true }
      );
    }
  } catch (e) {
    log('red', `错误：创建远端目录失败: ${e.message}`);
    process.exit(1);
  }

  for (const filePath of filesToUpload) {
    const fileName = basename(filePath);
    const remotePath = `${VPS_DATA_DIR}/current/${fileName}`;
    const size = formatSize(filePath);

    log('yellow', `  上传 ${fileName} (${size})...`);
    try {
      await uploadFile(sshConfig, filePath, remotePath);
      await execRemote(sshConfig, `chmod 600 ${quoteForSingle(remotePath)}`);
      log('green', `  ✓ ${fileName} 上传完成`);
    } catch (e) {
      log('red', `错误：上传失败（${fileName}）: ${e.message}`);
      process.exit(1);
    }
  }

  if (noRestart) {
    log('green', '✓ 上传完成（跳过重启）');
    return;
  }

  log('green', `▶ 步骤 ${exportMode ? 3 : 2}: 重启服务...`);
  try {
    await execRemote(sshConfig, 'sudo /usr/local/bin/deploy-chexian-api restart');
  } catch (e) {
    log('red', `错误：重启失败: ${e.message}`);
    process.exit(1);
  }

  log('yellow', '  健康检查中（最多 40 秒）...');
  const healthy = await healthCheck(sshConfig);

  if (healthy) {
    log('green', '✓ 同步完成！VPS 服务运行正常');
  } else {
    log('red', '⚠ 上传完成，但健康检查失败');
    log('yellow', '  查看日志: ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api logs 20"');
    process.exit(1);
  }
}

main().catch((e) => {
  log('red', `错误: ${e.message}`);
  process.exit(1);
});
