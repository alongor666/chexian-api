#!/usr/bin/env node
/**
 * VPS 数据同步脚本（rsync 全目录版）
 * 支持 macOS / Linux
 *
 * 使用方法:
 *   node scripts/sync-vps.mjs                    # rsync 同步所有数据目录
 *   node scripts/sync-vps.mjs --check            # 仅预检 SSH 与本地待同步文件
 *   node scripts/sync-vps.mjs --no-restart       # 同步但不重启
 *   node scripts/sync-vps.mjs --dry-run          # 仅打印执行计划，不连接 VPS
 *
 * 同步目录（本地 → VPS）:
 *   数据管理/warehouse/fact/policy/current/       →  data/current/
 *   数据管理/warehouse/dim/salesman/              →  data/dim/salesman/
 *   数据管理/warehouse/dim/plan/                  →  data/dim/plan/
 *   数据管理/warehouse/dim/brand/                 →  data/dim/brand/
 *   数据管理/warehouse/dim/repair/                →  data/dim/repair/
 *   数据管理/warehouse/fact/renewal/              →  data/fact/renewal/
 *   数据管理/warehouse/fact/quotes_conversion/    →  data/fact/quotes_conversion/
 *   数据管理/warehouse/fact/claims_detail/        →  data/fact/claims_detail/
 *   数据管理/warehouse/fact/cross_sell/           →  data/fact/cross_sell/
 *   数据管理/warehouse/fact/customer_flow/        →  data/fact/customer_flow/
 *   数据管理/patrol_reports/                      →  data/patrol_reports/
 *
 * 可选环境变量:
 *   SYNC_VPS_SSH_ALIAS, SYNC_VPS_HOST, SYNC_VPS_USER, SYNC_VPS_PORT,
 *   SYNC_VPS_KEY_PATH, SYNC_VPS_DATA_DIR, SYNC_VPS_HEALTH_URL
 */

import { existsSync, statSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
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

const LOCAL_CURRENT_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');
const LOCAL_SALESMAN_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/salesman');
const LOCAL_PLAN_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/plan');
const LOCAL_BRAND_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/brand');
const LOCAL_RENEWAL_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/renewal');
const LOCAL_QUOTES_CONVERSION_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/quotes_conversion');
const LOCAL_CLAIMS_DETAIL_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/claims_detail');
const LOCAL_CROSS_SELL_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/cross_sell');
const LOCAL_CUSTOMER_FLOW_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/customer_flow');
const LOCAL_REPAIR_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/repair');
const LOCAL_RENEWAL_UNIVERSE_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/renewal_universe');
const LOCAL_PATROL_REPORTS_DIR = join(ROOT_DIR, '数据管理/patrol_reports');
const LOCAL_SNAPSHOTS_DIR = join(ROOT_DIR, '数据管理/warehouse/snapshots');

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
    noRestart: false,
    dryRun: false,
    checkMode: false,
    helpMode: false,
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

    switch (token) {
      case '--no-restart':
        parsed.noRestart = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--check':
        parsed.checkMode = true;
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
    noRestart: parsedArgs.noRestart,
    dryRun: parsedArgs.dryRun,
    checkMode: parsedArgs.checkMode,
    helpMode: parsedArgs.helpMode,
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

async function execRemote(config, remoteCommand, options = {}) {
  return runLocal('ssh', buildSshArgs(config, remoteCommand), options);
}

/**
 * rsync 单目录：localDir/ → alias:remoteDir/
 * 使用 SSH host alias，不硬编码 IP/端口/密钥。
 * 返回 { ok, label, error? } 供调用方判断是否中止。
 */
async function rsyncDir(alias, localDir, remoteDir, label) {
  // 确保 localDir 以 / 结尾（rsync 语义：同步目录内容而非目录本身）
  const src = localDir.endsWith('/') ? localDir : `${localDir}/`;
  const dst = remoteDir.endsWith('/') ? remoteDir : `${remoteDir}/`;

  log('yellow', `  rsync ${label}: ${src} → ${alias}:${dst}`);

  try {
    await runLocal('rsync', [
      '-azv',
      '--delete',
      '-e', 'ssh',
      src,
      `${alias}:${dst}`,
    ]);
    log('green', `  ✓ ${label} 同步完成`);
    return { ok: true, label };
  } catch (err) {
    log('red', `  ✗ ${label} rsync 失败: ${err.message}`);
    return { ok: false, label, error: err.message };
  }
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

function formatSize(path) {
  const bytes = statSync(path).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function collectCheckDirs() {
  const dirs = [
    { label: 'policy/current', path: LOCAL_CURRENT_DIR },
    { label: 'dim/salesman',   path: LOCAL_SALESMAN_DIR },
    { label: 'dim/plan',       path: LOCAL_PLAN_DIR },
    { label: 'dim/brand',     path: LOCAL_BRAND_DIR },
    { label: 'fact/renewal',            path: LOCAL_RENEWAL_DIR },
    { label: 'fact/quotes_conversion', path: LOCAL_QUOTES_CONVERSION_DIR },
  ];

  return dirs.map(({ label, path }) => {
    if (!existsSync(path)) return { label, path, files: [], exists: false };
    const files = readdirSync(path)
      .filter((f) => f.endsWith('.parquet'))
      .map((f) => join(path, f));
    return { label, path, files, exists: true };
  });
}

function printHelp() {
  console.log(`用法:
  node scripts/sync-vps.mjs              # rsync 同步所有数据目录
  node scripts/sync-vps.mjs --check     # 预检 SSH + 列出本地待同步文件
  node scripts/sync-vps.mjs --dry-run   # 仅打印执行计划，不连接 VPS
  node scripts/sync-vps.mjs --no-restart  # 同步但不重启 PM2

同步目录（使用 rsync --delete，VPS 多余文件会被清理）:
  数据管理/warehouse/fact/policy/current/       →  data/current/
  数据管理/warehouse/dim/salesman/              →  data/dim/salesman/
  数据管理/warehouse/dim/plan/                  →  data/dim/plan/
  数据管理/warehouse/dim/brand/                 →  data/dim/brand/
  数据管理/warehouse/fact/renewal/              →  data/fact/renewal/  (存在时)
  数据管理/warehouse/fact/quotes_conversion/    →  data/fact/quotes_conversion/  (存在时)

可选参数:
  --alias <name>       覆盖 SSH alias（默认 chexian-vps-deploy）
  --host <host>        覆盖远端主机
  --user <user>        覆盖远端用户名
  --port <port>        覆盖远端端口
  --key <path>         覆盖私钥路径
  --remote-dir <path>  覆盖远端数据根目录
  --health-url <url>   覆盖健康检查地址
`);
}

function printDryRun(sshConfig, runConfig) {
  log('blue', '================================================================================');
  log('blue', 'DRY RUN - VPS rsync 同步执行计划');
  log('blue', '================================================================================');
  console.log(`SSH alias: ${sshConfig.alias}`);
  console.log(`SSH: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`);
  console.log(`Key: ${sshConfig.privateKeyPath}`);
  console.log(`Remote data root: ${runConfig.remoteDir}`);
  console.log(`Restart: ${runConfig.noRestart ? 'no' : 'yes'}`);
  console.log(`Health URL: ${runConfig.healthUrl}`);
  console.log('');
  console.log('将执行以下 rsync（含 --delete）:');

  const syncTasks = [
    { label: 'policy/current',       local: LOCAL_CURRENT_DIR,            remote: `${runConfig.remoteDir}/current`,               critical: true },
    { label: 'dim/salesman',         local: LOCAL_SALESMAN_DIR,           remote: `${runConfig.remoteDir}/dim/salesman`,          critical: true },
    { label: 'dim/plan',             local: LOCAL_PLAN_DIR,               remote: `${runConfig.remoteDir}/dim/plan`,              critical: true },
    { label: 'fact/renewal',         local: LOCAL_RENEWAL_DIR,            remote: `${runConfig.remoteDir}/fact/renewal`,          critical: false },
    { label: 'fact/quotes_conversion', local: LOCAL_QUOTES_CONVERSION_DIR, remote: `${runConfig.remoteDir}/fact/quotes_conversion`, critical: false },
    { label: 'dim/brand',            local: LOCAL_BRAND_DIR,              remote: `${runConfig.remoteDir}/dim/brand`,             critical: false },
    { label: 'fact/claims_detail',   local: LOCAL_CLAIMS_DETAIL_DIR,      remote: `${runConfig.remoteDir}/fact/claims_detail`,    critical: true },
    { label: 'fact/cross_sell',      local: LOCAL_CROSS_SELL_DIR,         remote: `${runConfig.remoteDir}/fact/cross_sell`,       critical: false },
    { label: 'fact/customer_flow',   local: LOCAL_CUSTOMER_FLOW_DIR,      remote: `${runConfig.remoteDir}/fact/customer_flow`,    critical: false },
    { label: 'dim/repair',           local: LOCAL_REPAIR_DIR,             remote: `${runConfig.remoteDir}/dim/repair`,            critical: false },
    { label: 'patrol_reports',       local: LOCAL_PATROL_REPORTS_DIR,     remote: `${runConfig.remoteDir}/patrol_reports`,         critical: false },
    { label: 'snapshots',           local: LOCAL_SNAPSHOTS_DIR,          remote: `${runConfig.remoteDir}/snapshots`,              critical: false },
  ];

  for (const task of syncTasks) {
    const exists = existsSync(task.local);
    const tag = task.critical ? '[CRITICAL]' : '[optional]';
    const suffix = exists ? '' : '  （本地目录不存在，跳过）';
    console.log(`  ${tag} rsync -azv --delete -e ssh ${task.local}/ ${sshConfig.alias}:${task.remote}/${suffix}`);
  }
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

/**
 * rsync 全目录同步模式（并行）
 * 所有目录并行 rsync，按 critical/optional 分级：
 * - critical 目录失败 → 中止重启 + process.exit(1)
 * - optional 目录失败 → 打印警告，继续重启
 */
async function runStandardMode(sshConfig, runConfig) {
  const alias = sshConfig.alias;
  const remote = runConfig.remoteDir;

  // 声明式任务列表：critical=true 的目录失败会阻断重启
  const syncTasks = [
    { label: 'policy/current',       local: LOCAL_CURRENT_DIR,            remote: `${remote}/current`,               critical: true },
    { label: 'dim/salesman',         local: LOCAL_SALESMAN_DIR,           remote: `${remote}/dim/salesman`,          critical: true },
    { label: 'dim/plan',             local: LOCAL_PLAN_DIR,               remote: `${remote}/dim/plan`,              critical: true },
    { label: 'fact/renewal',         local: LOCAL_RENEWAL_DIR,            remote: `${remote}/fact/renewal`,          critical: false },
    { label: 'fact/quotes_conversion', local: LOCAL_QUOTES_CONVERSION_DIR, remote: `${remote}/fact/quotes_conversion`, critical: false },
    { label: 'dim/brand',            local: LOCAL_BRAND_DIR,              remote: `${remote}/dim/brand`,             critical: false },
    { label: 'fact/claims_detail',   local: LOCAL_CLAIMS_DETAIL_DIR,      remote: `${remote}/fact/claims_detail`,    critical: true },
    { label: 'fact/cross_sell',      local: LOCAL_CROSS_SELL_DIR,         remote: `${remote}/fact/cross_sell`,       critical: false },
    { label: 'fact/customer_flow',   local: LOCAL_CUSTOMER_FLOW_DIR,      remote: `${remote}/fact/customer_flow`,    critical: false },
    { label: 'dim/repair',           local: LOCAL_REPAIR_DIR,             remote: `${remote}/dim/repair`,            critical: false },
    { label: 'fact/renewal_universe', local: LOCAL_RENEWAL_UNIVERSE_DIR, remote: `${remote}/fact/renewal_universe`, critical: false },
    { label: 'patrol_reports',       local: LOCAL_PATROL_REPORTS_DIR,   remote: `${remote}/patrol_reports`,         critical: false },
    { label: 'snapshots',            local: LOCAL_SNAPSHOTS_DIR,        remote: `${remote}/snapshots`,              critical: false },
  ];

  // 过滤不存在的目录
  const activeTasks = [];
  for (const task of syncTasks) {
    if (existsSync(task.local)) {
      activeTasks.push(task);
    } else {
      log('yellow', `  跳过 ${task.label}（本地目录不存在）`);
    }
  }

  log('green', `▶ 并行同步 ${activeTasks.length} 个目录...`);

  // 并行 rsync 所有目录
  const results = await Promise.allSettled(
    activeTasks.map(task => rsyncDir(alias, task.local, task.remote, task.label))
  );

  // 收集失败结果
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const task = activeTasks[i];
    // Promise.allSettled rejected（不应发生，rsyncDir 内部已 catch）或 rsyncDir 返回 ok:false
    const rsyncResult = result.status === 'fulfilled' ? result.value : { ok: false, label: task.label, error: result.reason?.message };
    if (!rsyncResult.ok) {
      failures.push({ ...rsyncResult, critical: task.critical });
    }
  }

  // 报告失败
  if (failures.length > 0) {
    console.log('');
    log('red', `⚠ ${failures.length} 个目录同步失败：`);
    for (const f of failures) {
      log('red', `  ${f.critical ? '🔴 CRITICAL' : '🟡 OPTIONAL'} ${f.label}: ${f.error}`);
    }
  }

  // critical 目录失败 → 中止重启，防止上线不完整数据
  const criticalFailures = failures.filter(f => f.critical);
  if (criticalFailures.length > 0) {
    log('red', `\n❌ ${criticalFailures.length} 个关键目录同步失败，中止重启！`);
    log('red', '  修复网络/SSH 问题后重新运行 sync-vps.mjs');
    process.exit(1);
  }

  // optional 目录失败 → 警告但继续
  if (failures.length > 0) {
    log('yellow', '\n⚠ 非关键目录同步失败，继续重启（数据不完整但核心功能可用）');
  }

  // 写同步清单：记录本次同步的文件指纹，governance 用于检测数据漂移
  writeSyncManifest();

  await maybeRestart(sshConfig, runConfig.noRestart, runConfig.healthUrl);
}

/**
 * 扫描所有 LOCAL_*_DIR 目录中的 parquet 文件，生成指纹清单。
 * governance 对比此清单与当前文件状态，不一致则阻断 push。
 */
function writeSyncManifest() {
  const dirs = [
    { label: 'policy/current', path: LOCAL_CURRENT_DIR },
    { label: 'dim/salesman', path: LOCAL_SALESMAN_DIR },
    { label: 'dim/plan', path: LOCAL_PLAN_DIR },
    { label: 'dim/brand', path: LOCAL_BRAND_DIR },
    { label: 'fact/renewal', path: LOCAL_RENEWAL_DIR },
    { label: 'fact/quotes_conversion', path: LOCAL_QUOTES_CONVERSION_DIR },
    { label: 'fact/claims_detail', path: LOCAL_CLAIMS_DETAIL_DIR },
    { label: 'fact/cross_sell', path: LOCAL_CROSS_SELL_DIR },
    { label: 'fact/customer_flow', path: LOCAL_CUSTOMER_FLOW_DIR },
    { label: 'dim/repair', path: LOCAL_REPAIR_DIR },
    { label: 'patrol_reports', path: LOCAL_PATROL_REPORTS_DIR },
  ];

  const files = {};
  for (const dir of dirs) {
    if (!existsSync(dir.path)) continue;
    const parquets = readdirSync(dir.path).filter(f => f.endsWith('.parquet'));
    for (const f of parquets) {
      const fullPath = join(dir.path, f);
      const stat = statSync(fullPath);
      const key = `${dir.label}/${f}`;
      files[key] = { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
    }
  }

  const manifest = {
    syncedAt: new Date().toISOString(),
    fileCount: Object.keys(files).length,
    files,
  };

  const manifestPath = join(ROOT_DIR, '.last-sync-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  log('green', `✓ 同步清单已写入 .last-sync-manifest.json（${manifest.fileCount} 个文件）`);
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
    const dirs = collectCheckDirs();
    let totalFiles = 0;
    for (const dir of dirs) {
      if (!dir.exists) {
        log('yellow', `  [${dir.label}] 目录不存在: ${dir.path}`);
        continue;
      }
      log('green', `  [${dir.label}] ${dir.files.length} 个 parquet 文件`);
      dir.files.forEach((f) => console.log(`    - ${basename(f)} (${formatSize(f)})`));
      totalFiles += dir.files.length;
    }
    log('green', `✓ 本地待同步文件总数: ${totalFiles}`);
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
};

const isMain = process.env.RUN_MAIN || (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    log('red', `错误: ${e.message}`);
    process.exit(1);
  });
}
