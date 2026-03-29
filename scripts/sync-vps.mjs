#!/usr/bin/env node
/**
 * 跨平台 VPS 数据同步脚本
 * 支持 Windows / macOS / Linux
 *
 * 使用方法:
 *   node scripts/sync-vps.mjs                    # 同步最新数据（默认清理 current/，防重复）
 *   node scripts/sync-vps.mjs --check            # 仅预检 SSH 与本地待同步文件
 *   node scripts/sync-vps.mjs --export           # 预聚合模式（推荐）
 *   node scripts/sync-vps.mjs 文件路径            # 指定文件
 *   node scripts/sync-vps.mjs --keep-old         # 保留 current/ 旧文件（谨慎使用，会导致重复数据）
 *   node scripts/sync-vps.mjs --no-restart       # 同步但不重启
 *   node scripts/sync-vps.mjs --dry-run          # 仅打印执行计划，不连接 VPS
 *
 * 可选环境变量:
 *   SYNC_VPS_SSH_ALIAS, SYNC_VPS_HOST, SYNC_VPS_USER, SYNC_VPS_PORT,
 *   SYNC_VPS_KEY_PATH, SYNC_VPS_DATA_DIR, SYNC_VPS_HEALTH_URL
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

const DEFAULTS = {
  alias: process.env.SYNC_VPS_SSH_ALIAS || 'chexian-vps-deploy',
  host: process.env.SYNC_VPS_HOST || '162.14.113.44',
  username: process.env.SYNC_VPS_USER || 'deployer',
  port: Number(process.env.SYNC_VPS_PORT || 22),
  remoteDir: process.env.SYNC_VPS_DATA_DIR || '/var/www/chexian/server/data',
  healthUrl: process.env.SYNC_VPS_HEALTH_URL || 'http://localhost:3000/health',
};

const LOCAL_DATA_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');
const VPS_EXPORT_DIR = join(ROOT_DIR, '数据管理/warehouse/vps-export');

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

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    exportMode: false,
    noRestart: false,
    dryRun: false,
    checkMode: false,
    keepOld: false,
    helpMode: false,
    targetFile: null,
    alias: undefined,
    host: undefined,
    username: undefined,
    port: undefined,
    keyPath: undefined,
    remoteDir: undefined,
    healthUrl: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (!token.startsWith('-')) {
      parsed.targetFile = token;
      continue;
    }

    switch (token) {
      case '--export':
        parsed.exportMode = true;
        break;
      case '--no-restart':
        parsed.noRestart = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--check':
        parsed.checkMode = true;
        break;
      case '--keep-old':
        parsed.keepOld = true;
        break;
      case '--help':
      case '-h':
        parsed.helpMode = true;
        break;
      case '--alias':
        parsed.alias = next;
        i += 1;
        break;
      case '--host':
        parsed.host = next;
        i += 1;
        break;
      case '--user':
        parsed.username = next;
        i += 1;
        break;
      case '--port':
        parsed.port = Number(next);
        i += 1;
        break;
      case '--key':
        parsed.keyPath = next;
        i += 1;
        break;
      case '--remote-dir':
        parsed.remoteDir = next;
        i += 1;
        break;
      case '--health-url':
        parsed.healthUrl = next;
        i += 1;
        break;
      default:
        throw new Error(`未知参数: ${token}`);
    }
  }

  return parsed;
}

function expandHomePath(inputPath) {
  if (!inputPath) return inputPath;
  if (!inputPath.startsWith('~/')) return inputPath;
  return join(os.homedir(), inputPath.slice(2));
}

function getSSHConfigPaths() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return [join(home, '.ssh', 'config')];
}

function parseSSHConfig(alias, configContent) {
  const hostConfig = {};
  const lines = configContent.split('\n');

  let inMatchingHost = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^host\s+/i.test(line)) {
      const hosts = line.replace(/^host\s+/i, '').trim().split(/\s+/);
      inMatchingHost = hosts.includes(alias);
      continue;
    }

    if (!inMatchingHost) continue;

    const [key, ...parts] = line.split(/\s+/);
    const value = parts.join(' ');
    switch (key.toLowerCase()) {
      case 'hostname':
        hostConfig.host = value;
        break;
      case 'user':
        hostConfig.username = value;
        break;
      case 'port':
        hostConfig.port = Number(value);
        break;
      case 'identityfile':
        hostConfig.privateKeyPath = expandHomePath(value);
        break;
      default:
        break;
    }
  }

  if (!hostConfig.host && !hostConfig.username && !hostConfig.privateKeyPath) {
    return null;
  }

  return hostConfig;
}

function loadSSHConfigFromFiles(alias) {
  for (const configPath of getSSHConfigPaths()) {
    if (!existsSync(configPath)) continue;

    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseSSHConfig(alias, content);
    if (parsed) return parsed;
  }

  return null;
}

function getFallbackKeyCandidates() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return [
    process.env.SYNC_VPS_KEY_PATH,
    join(home, '.ssh', 'chexian_deploy'),
    join(home, '.ssh', 'id_ed25519'),
    join(home, '.ssh', 'id_rsa'),
  ].filter(Boolean);
}

function resolveSSHConfig(parsedArgs) {
  const alias = parsedArgs.alias || DEFAULTS.alias;
  const fileConfig = loadSSHConfigFromFiles(alias) || {};

  const merged = {
    alias,
    host: parsedArgs.host || fileConfig.host || DEFAULTS.host,
    username: parsedArgs.username || fileConfig.username || DEFAULTS.username,
    port: Number(parsedArgs.port || fileConfig.port || DEFAULTS.port || 22),
    privateKeyPath: expandHomePath(
      parsedArgs.keyPath ||
      process.env.SYNC_VPS_KEY_PATH ||
      fileConfig.privateKeyPath ||
      getFallbackKeyCandidates().find((candidate) => existsSync(expandHomePath(candidate)))
    ),
  };

  if (!merged.privateKeyPath || !existsSync(merged.privateKeyPath)) {
    throw new Error(
      `未找到可用 SSH 私钥，请通过 --key 或环境变量 SYNC_VPS_KEY_PATH 指定（当前 alias: ${alias}）`
    );
  }

  return merged;
}

function resolveRunConfig(parsedArgs) {
  return {
    remoteDir: parsedArgs.remoteDir || DEFAULTS.remoteDir,
    healthUrl: parsedArgs.healthUrl || DEFAULTS.healthUrl,
    exportMode: parsedArgs.exportMode,
    noRestart: parsedArgs.noRestart,
    dryRun: parsedArgs.dryRun,
    checkMode: parsedArgs.checkMode,
    keepOld: parsedArgs.keepOld,
    helpMode: parsedArgs.helpMode,
    targetFile: parsedArgs.targetFile,
  };
}

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

function buildSshArgs(config, remoteCommand) {
  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'ConnectTimeout=10',
    '-p',
    String(config.port),
    '-i',
    config.privateKeyPath,
    `${config.username}@${config.host}`,
    remoteCommand,
  ];
}

function buildScpArgs(config, localPath, remotePath) {
  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-P',
    String(config.port),
    '-i',
    config.privateKeyPath,
    localPath,
    `${config.username}@${config.host}:${remotePath}`,
  ];
}

async function execRemote(config, remoteCommand, options = {}) {
  return runLocal('ssh', buildSshArgs(config, remoteCommand), options);
}

async function uploadFile(config, localPath, remotePath) {
  await runLocal('scp', buildScpArgs(config, localPath, remotePath));
}

async function ensureSshReady(config) {
  const sshProbe = await runLocal('ssh', ['-V'], { silent: true, allowFailure: true });
  if (sshProbe.code !== 0) {
    throw new Error('未检测到 OpenSSH 客户端（ssh/scp），请先安装并加入 PATH');
  }

  await execRemote(config, 'true', { silent: true });
}

async function healthCheck(config, healthUrl, maxAttempts = 8) {
  for (let i = 1; i <= maxAttempts; i += 1) {
    await sleep(5000);

    const result = await execRemote(config, `curl -s ${quoteForSingle(healthUrl)}`, {
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

function resolveTargetFile(inputTarget) {
  if (!inputTarget) {
    const latest = getLatestParquet(LOCAL_DATA_DIR);
    if (!latest) {
      throw new Error(`未找到 Parquet 文件: ${LOCAL_DATA_DIR}`);
    }
    return latest.path;
  }

  if (existsSync(inputTarget)) return inputTarget;

  const tryPath = join(LOCAL_DATA_DIR, inputTarget);
  if (existsSync(tryPath)) return tryPath;

  throw new Error(`文件不存在: ${inputTarget}`);
}

function printHelp() {
  console.log(`用法:
  node scripts/sync-vps.mjs [文件路径] [--no-restart]
  node scripts/sync-vps.mjs --check
  node scripts/sync-vps.mjs --export [--dry-run]

⚠️  默认行为：上传前自动清理 current/ 旧文件（归档到 archive/），防止重复数据。

可选参数:
  --keep-old           保留 current/ 旧文件（谨慎：会导致多文件叠加，数据翻倍）
  --alias <name>       覆盖 SSH alias
  --host <host>        覆盖远端主机
  --user <user>        覆盖远端用户名
  --port <port>        覆盖远端端口
  --key <path>         覆盖私钥路径
  --remote-dir <path>  覆盖远端数据目录
  --health-url <url>   覆盖健康检查地址
`);
}

function printDryRun(sshConfig, runConfig) {
  log('blue', '================================================================================');
  log('blue', 'DRY RUN - VPS 同步执行计划');
  log('blue', '================================================================================');
  console.log(`模式: ${runConfig.exportMode ? 'export' : 'standard'}`);
  console.log(`SSH: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port} (alias=${sshConfig.alias})`);
  console.log(`Key: ${sshConfig.privateKeyPath}`);
  console.log(`Remote dir: ${runConfig.remoteDir}`);
  console.log(`Restart: ${runConfig.noRestart ? 'no' : 'yes'}`);
  console.log(`Health URL: ${runConfig.healthUrl}`);
  console.log(`Check only: ${runConfig.checkMode ? 'yes' : 'no'}`);
  console.log(`清理旧文件: ${runConfig.keepOld ? '跳过（--keep-old）' : '是（默认，防重复数据）'}`);
  if (!runConfig.exportMode) {
    console.log(`Target file: ${runConfig.targetFile || '(auto latest parquet)'}`);
  }
}

async function ensureRemoteDirs(config, remoteDir) {
  await execRemote(
    config,
    `mkdir -p ${quoteForSingle(`${remoteDir}/current`)} ${quoteForSingle(`${remoteDir}/archive`)}`,
  );
}

async function cleanVpsCurrent(config, remoteDir) {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('') + `_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  const backupDir = `${remoteDir}/archive/backup_${ts}`;
  await execRemote(
    config,
    `mkdir -p ${quoteForSingle(backupDir)} && mv ${remoteDir}/current/*.parquet ${quoteForSingle(`${backupDir}/`)} 2>/dev/null || true`,
    { allowFailure: true },
  );
  await execRemote(
    config,
    `find ${quoteForSingle(`${remoteDir}/archive`)} -type d -name 'backup_*' -mtime +15 -exec rm -rf {} + 2>/dev/null || true`,
    { allowFailure: true },
  );
}

async function maybeRestart(config, noRestart, healthUrl) {
  if (noRestart) {
    log('green', '✓ 上传完成（跳过重启）');
    return;
  }

  log('green', '▶ 重启服务...');
  await execRemote(config, 'sudo /usr/local/bin/deploy-chexian-api restart');

  log('yellow', '  健康检查中（最多 40 秒）...');
  const healthy = await healthCheck(config, healthUrl);
  if (healthy) {
    log('green', '✓ 同步完成！VPS 服务运行正常');
  } else {
    log('red', '⚠ 上传完成，但健康检查失败');
    log('yellow', '  查看日志: ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api logs 20"');
    process.exit(1);
  }
}

async function runExportMode(config, runConfig) {
  log('green', '▶ 步骤 1: 运行预聚合导出...');
  const exportScript = join(ROOT_DIR, 'scripts/export-for-vps.mjs');
  if (!existsSync(exportScript)) {
    throw new Error(`导出脚本不存在: ${exportScript}`);
  }

  await runLocal('node', [exportScript]);

  log('green', '▶ 步骤 2: 上传预聚合文件...');
  await ensureRemoteDirs(config, runConfig.remoteDir);

  if (!runConfig.keepOld) {
    log('yellow', '  清理 VPS 的 current 目录（默认行为，防止重复数据）...');
    await cleanVpsCurrent(config, runConfig.remoteDir);
  } else {
    log('yellow', '  跳过清理（--keep-old）');
  }

  const exportFiles = ['aggregated.parquet', 'cross_sell_agg.parquet', 'renewal_agg.parquet'];

  for (const file of exportFiles) {
    const localPath = join(VPS_EXPORT_DIR, file);
    if (!existsSync(localPath)) {
      log('yellow', `  跳过 ${file}（文件不存在）`);
      continue;
    }

    const size = formatSize(localPath);
    const remotePath = `${runConfig.remoteDir}/current/${file}`;
    log('yellow', `  上传 ${file} (${size})...`);
    await uploadFile(config, localPath, remotePath);
    await execRemote(config, `chmod 600 ${quoteForSingle(remotePath)}`);
    log('green', `  ✓ ${file} 上传完成`);
  }

  // ── 续保漏斗数据 ──
  const renewalDir = join(ROOT_DIR, '数据管理/warehouse/fact/renewal');
  if (existsSync(renewalDir)) {
    const renewalFiles = readdirSync(renewalDir).filter((f) => f.endsWith('.parquet'));
    if (renewalFiles.length > 0) {
      const remoteRenewalDir = `${runConfig.remoteDir}/fact/renewal`;
      await execRemote(config, `mkdir -p ${quoteForSingle(remoteRenewalDir)}`);
      for (const file of renewalFiles) {
        const localPath = join(renewalDir, file);
        const size = formatSize(localPath);
        const remotePath = `${remoteRenewalDir}/${file}`;
        log('yellow', `  上传续保漏斗 ${file} (${size})...`);
        await uploadFile(config, localPath, remotePath);
        await execRemote(config, `chmod 600 ${quoteForSingle(remotePath)}`);
        log('green', `  ✓ ${file} 上传完成`);
      }
    }
  }

  await maybeRestart(config, runConfig.noRestart, runConfig.healthUrl);
}

async function runStandardMode(config, runConfig) {
  const targetFile = resolveTargetFile(runConfig.targetFile);
  const fileName = basename(targetFile);
  const size = formatSize(targetFile);
  const remotePath = `${runConfig.remoteDir}/current/${fileName}`;

  log('green', `[同步] ${fileName} (${size})`);

  await ensureRemoteDirs(config, runConfig.remoteDir);
  if (!runConfig.keepOld) {
    log('yellow', '  清理 VPS 的 current 目录（默认行为，防止重复数据）...');
    await cleanVpsCurrent(config, runConfig.remoteDir);
  } else {
    log('yellow', '  跳过清理（--keep-old）');
  }

  log('yellow', '  上传中...');
  await uploadFile(config, targetFile, remotePath);
  await execRemote(config, `chmod 600 ${quoteForSingle(remotePath)}`);
  log('green', '  ✓ 上传完成');

  await maybeRestart(config, runConfig.noRestart, runConfig.healthUrl);
}

async function main(argv = process.argv.slice(2)) {
  const parsedArgs = parseArgs(argv);

  if (parsedArgs.helpMode) {
    printHelp();
    return;
  }

  const runConfig = resolveRunConfig(parsedArgs);
  const sshConfig = resolveSSHConfig(parsedArgs);

  log('blue', '================================================================================');
  log('blue', 'VPS 数据同步工具（跨平台版）');
  log('blue', '================================================================================');
  log('green', `✓ SSH 配置: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`);
  log('green', `✓ 密钥: ${sshConfig.privateKeyPath}`);

  if (runConfig.dryRun) {
    printDryRun(sshConfig, runConfig);
    return;
  }

  try {
    log('yellow', '▶ SSH 连通性预检...');
    await ensureSshReady(sshConfig);
    log('green', '✓ SSH 连接成功');
  } catch (e) {
    log('red', `错误：SSH 预检失败: ${e.message}`);
    process.exit(1);
  }

  if (runConfig.checkMode) {
    const files = collectCheckFiles();
    log('green', `✓ 本地待同步文件数: ${files.length}`);
    files.forEach((file) => {
      console.log(`  - ${basename(file)} (${formatSize(file)})`);
    });
    return;
  }

  if (runConfig.exportMode) {
    await runExportMode(sshConfig, runConfig);
    return;
  }

  await runStandardMode(sshConfig, runConfig);
}

export {
  DEFAULTS,
  expandHomePath,
  getSSHConfigPaths,
  parseArgs,
  parseSSHConfig,
  resolveSSHConfig,
  resolveRunConfig,
  resolveTargetFile,
};

const isMain = process.env.RUN_MAIN || (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    log('red', `错误: ${e.message}`);
    process.exit(1);
  });
}
