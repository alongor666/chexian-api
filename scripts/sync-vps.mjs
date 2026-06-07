#!/usr/bin/env node
/**
 * VPS 数据同步脚本（rsync 全目录版）
 * 支持 macOS / Linux
 *
 * 使用方法:
 *   node scripts/sync-vps.mjs                    # rsync 同步所有数据目录
 *   node scripts/sync-vps.mjs --check            # 仅预检 SSH 与本地待同步文件
 *   node scripts/sync-vps.mjs --no-restart       # 同步但不重启
 *   node scripts/sync-vps.mjs --domain customer_flow --no-restart
 *   node scripts/sync-vps.mjs --dry-run          # 仅打印执行计划，不连接 VPS
 *
 * 同步目录（本地 → VPS）:
 *   数据管理/warehouse/fact/policy/current/       →  data/current/
 *   数据管理/warehouse/dim/salesman/              →  data/dim/salesman/
 *   数据管理/warehouse/dim/plan/                  →  data/dim/plan/
 *   数据管理/warehouse/dim/brand/                 →  data/dim/brand/
 *   数据管理/warehouse/dim/repair/                →  data/dim/repair/
 *   数据管理/warehouse/dim/plate_region/          →  data/dim/plate_region/
 *   数据管理/warehouse/fact/quotes_conversion/    →  data/fact/quotes_conversion/
 *   数据管理/warehouse/fact/claims_detail/        →  data/fact/claims_detail/
 *   数据管理/warehouse/fact/cross_sell/           →  data/fact/cross_sell/
 *   数据管理/warehouse/fact/customer_flow/        →  data/fact/customer_flow/
 *   数据管理/warehouse/fact/renewal_tracker/      →  data/fact/renewal_tracker/
 *   数据管理/patrol_reports/                      →  data/patrol_reports/
 *   server/data/reports/                          →  data/reports/  （追加同步，不删除远端历史报告；后端鉴权访问）
 *   public/reports/                               →  frontend/dist/reports/  （追加同步；Nginx 静态托管，浏览器 /reports/* 可直达）
 *
 * 报告 manifest 生成：
 *   rsync 完成后，scp `scripts/gen-reports-manifest.mjs` 到 VPS `/tmp/` 并 ssh 执行
 *   `node /tmp/<script> <frontendDist>/reports`，按 VPS 真实存在的 HTML 文件清单
 *   写出每个 slug 目录下的 `manifest.json`。前端据此判 ready/stale/unavailable。
 *
 * 可选环境变量:
 *   SYNC_VPS_SSH_ALIAS, SYNC_VPS_HOST, SYNC_VPS_USER, SYNC_VPS_PORT,
 *   SYNC_VPS_KEY_PATH, SYNC_VPS_DATA_DIR, SYNC_VPS_FRONTEND_DIST, SYNC_VPS_HEALTH_URL
 */

import { existsSync, statSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { generateReportsManifests } from './gen-reports-manifest.mjs';
import os from 'os';
import { assertNoPolicyCurrentOverlap } from './lib/parquet-overlap-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

const DEFAULTS = {
  alias: process.env.SYNC_VPS_SSH_ALIAS || 'chexian-vps-deploy',
  host: process.env.SYNC_VPS_HOST || '162.14.113.44',
  username: process.env.SYNC_VPS_USER || 'deployer',
  port: Number(process.env.SYNC_VPS_PORT || 22),
  remoteDir: process.env.SYNC_VPS_DATA_DIR || '/var/www/chexian/server/data',
  frontendDistDir: process.env.SYNC_VPS_FRONTEND_DIST || '/var/www/chexian/frontend/dist',
  healthUrl: process.env.SYNC_VPS_HEALTH_URL || 'http://localhost:3000/health',
};

const LOCAL_CURRENT_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/policy/current');
const LOCAL_SALESMAN_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/salesman');
const LOCAL_PLAN_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/plan');
const LOCAL_BRAND_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/brand');
const LOCAL_QUOTES_CONVERSION_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/quotes_conversion');
const LOCAL_CLAIMS_DETAIL_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/claims_detail');
const LOCAL_CROSS_SELL_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/cross_sell');
const LOCAL_CUSTOMER_FLOW_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/customer_flow');
const LOCAL_NEW_ENERGY_CLAIMS_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/new_energy_claims');
const LOCAL_RENEWAL_TRACKER_DIR = join(ROOT_DIR, '数据管理/warehouse/fact/renewal_tracker');
const LOCAL_REPAIR_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/repair');
const LOCAL_PLATE_REGION_DIR = join(ROOT_DIR, '数据管理/warehouse/dim/plate_region');
const LOCAL_PATROL_REPORTS_DIR = join(ROOT_DIR, '数据管理/patrol_reports');
const LOCAL_HTML_REPORTS_DIR = join(ROOT_DIR, 'server/data/reports');
const LOCAL_PUBLIC_REPORTS_DIR = join(ROOT_DIR, 'public/reports');

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
    noCleanup: false,
    alias: undefined,
    host: undefined,
    username: undefined,
    port: undefined,
    keyPath: undefined,
    remoteDir: undefined,
    healthUrl: undefined,
    domains: [],
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
      case '--no-cleanup':
        parsed.noCleanup = true;
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
      case '--domain':
        parsed.domains = next.split(',').map((d) => d.trim()).filter(Boolean);
        i += 1;
        break;
      default:
        if (token.startsWith('--domain=')) {
          parsed.domains = token.slice('--domain='.length).split(',').map((d) => d.trim()).filter(Boolean);
          break;
        }
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
    frontendDistDir: DEFAULTS.frontendDistDir,
    healthUrl: parsedArgs.healthUrl || DEFAULTS.healthUrl,
    noRestart: parsedArgs.noRestart,
    dryRun: parsedArgs.dryRun,
    checkMode: parsedArgs.checkMode,
    helpMode: parsedArgs.helpMode,
    noCleanup: parsedArgs.noCleanup,
    domains: parsedArgs.domains || [],
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
// 防止 ETL 中间态/系统垃圾被推到 VPS（_incoming.parquet 曾导致生产读坏）
const RSYNC_EXCLUDES = ['_incoming.parquet', '*.tmp', '_tmp/', '.DS_Store'];
const RSYNC_EXCLUDE_ARGS = RSYNC_EXCLUDES.flatMap((p) => ['--exclude', p]);

async function rsyncDir(alias, localDir, remoteDir, label, options = {}) {
  // 确保 localDir 以 / 结尾（rsync 语义：同步目录内容而非目录本身）
  const src = localDir.endsWith('/') ? localDir : `${localDir}/`;
  const dst = remoteDir.endsWith('/') ? remoteDir : `${remoteDir}/`;
  const deleteRemote = options.deleteRemote !== false;
  const deleteArgs = deleteRemote ? ['--delete'] : [];

  log('yellow', `  rsync ${label}${deleteRemote ? '' : ' (no --delete)'}: ${src} → ${alias}:${dst}`);

  try {
    await runLocal('rsync', [
      '-azv',
      ...deleteArgs,
      ...RSYNC_EXCLUDE_ARGS,
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

async function rsyncLatestAtomically(config, localDir, remoteDir, label) {
  const latest = join(localDir, 'latest.parquet');
  if (!existsSync(latest)) {
    const message = 'latest.parquet 不存在';
    log('red', `  ✗ ${label} ${message}`);
    return { ok: false, label, error: message };
  }
  const tmpRemote = `${remoteDir}/latest.parquet.uploading`;
  const finalRemote = `${remoteDir}/latest.parquet`;
  try {
    await execRemote(config, `mkdir -p ${quoteForSingle(remoteDir)}`, { silent: true });
    log('yellow', `  rsync ${label} atomic latest: ${latest} → ${config.alias}:${tmpRemote}`);
    await runLocal('rsync', [
      '-azv',
      '-e', 'ssh',
      latest,
      `${config.alias}:${tmpRemote}`,
    ]);
    await execRemote(config, `mv ${quoteForSingle(tmpRemote)} ${quoteForSingle(finalRemote)}`);
    log('green', `  ✓ ${label} latest 原子同步完成`);
    return { ok: true, label };
  } catch (err) {
    log('red', `  ✗ ${label} atomic latest 失败: ${err.message}`);
    return { ok: false, label, error: err.message };
  }
}

/**
 * 完整性闸门：对比"本地 vs VPS 现役"的 policy maxDate + rowCount，
 * 本地更旧/更少则拒绝同步，防止 parquet 不全的机器覆盖生产数据。
 *
 * 纯决策函数，导出供单测。verdict:
 *   - 'block' → 本地数据倒退，必须拒绝
 *   - 'skip'  → 某一侧指纹拿不到（端点未部署/网络/duckdb CLI 缺失），降级放行
 *   - 'pass'  → 本地不低于现役
 */
function evaluateFreshness(local, vps) {
  if (!vps) {
    return {
      verdict: 'skip',
      reason: 'VPS 现役指纹不可用（/internal/data-fingerprint 未部署或网络失败）——本次同步未受完整性保护',
    };
  }
  if (!local) {
    return { verdict: 'skip', reason: '本地指纹查询失败（duckdb CLI 缺失或 parquet 读取异常），降级放行' };
  }
  const reasons = [];
  if (local.maxDate && vps.maxDate && local.maxDate < vps.maxDate) {
    reasons.push(`本地 policy maxDate ${local.maxDate} 早于 VPS 现役 ${vps.maxDate}`);
  }
  if (local.rowCount < vps.rowCount) {
    reasons.push(`本地 policy 行数 ${local.rowCount} 少于 VPS 现役 ${vps.rowCount}`);
  }
  if (reasons.length) {
    return {
      verdict: 'block',
      reason: `${reasons.join('；')} — 疑似本地数据不全或在错误机器上同步，拒绝以防覆盖生产`,
    };
  }
  return {
    verdict: 'pass',
    reason: `本地 policy ${local.maxDate}/${local.rowCount} 不低于 VPS 现役 ${vps.maxDate}/${vps.rowCount}`,
  };
}

async function queryLocalPolicyFingerprint(localCurrentDir) {
  const glob = join(localCurrentDir, '*.parquet').replace(/'/g, "''");
  // union_by_name=true 对齐后端加载器（duckdb-parquet-loader.ts）：分片间存在兼容字段差异时，
  // 不加会让 CLI 抛错 → queryLocalPolicyFingerprint 返回 null → 闸门 skip 降级放行，
  // 反而绕过本闸门要防的残缺数据同步。
  const sql = `SELECT MAX(CAST(policy_date AS DATE))::VARCHAR AS max_date, COUNT(*) AS row_count FROM read_parquet('${glob}', union_by_name=true)`;
  try {
    const { stdout } = await runLocal('duckdb', ['-json', '-c', sql], { silent: true });
    const rows = JSON.parse(stdout || '[]');
    const r = rows[0] || {};
    return { maxDate: r.max_date ?? null, rowCount: Number(r.row_count ?? 0) };
  } catch {
    return null; // duckdb CLI 缺失 / parquet 读取失败 → 降级
  }
}

async function queryVpsPolicyFingerprint(config) {
  const url = 'http://localhost:3000/internal/data-fingerprint';
  try {
    const { stdout } = await execRemote(config, `curl -s -m 5 ${quoteForSingle(url)}`, {
      silent: true,
      allowFailure: true,
    });
    const parsed = JSON.parse((stdout || '').trim()); // 端点未部署时返回非 JSON → 抛错降级
    if (!parsed?.success || !parsed?.data?.policy) return null;
    const p = parsed.data.policy;
    return { maxDate: p.maxDate ?? null, rowCount: Number(p.rowCount ?? 0) };
  } catch {
    return null; // 404 / 网络失败 / JSON 解析失败 → 降级
  }
}

async function assertLocalNotStaleVsVps(config, localCurrentDir, hooks = {}) {
  const onPass = hooks.onPass || (() => {});
  const onWarn = hooks.onWarn || (() => {});
  const onFail = hooks.onFail || (() => {});
  const [local, vps] = await Promise.all([
    queryLocalPolicyFingerprint(localCurrentDir),
    queryVpsPolicyFingerprint(config),
  ]);
  const { verdict, reason } = evaluateFreshness(local, vps);
  if (verdict === 'block') {
    onFail(reason);
    return false;
  }
  if (verdict === 'skip') {
    onWarn(reason);
    return true;
  }
  onPass(reason);
  return true;
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
  node scripts/sync-vps.mjs --domain customer_flow --no-restart
  node scripts/sync-vps.mjs --check     # 预检 SSH + 列出本地待同步文件
  node scripts/sync-vps.mjs --dry-run   # 仅打印执行计划，不连接 VPS
  node scripts/sync-vps.mjs --no-restart  # 同步但不重启 PM2

同步目录（默认使用 rsync --delete，VPS 多余文件会被清理）:
  数据管理/warehouse/fact/policy/current/       →  data/current/
  数据管理/warehouse/dim/salesman/              →  data/dim/salesman/
  数据管理/warehouse/dim/plan/                  →  data/dim/plan/
  数据管理/warehouse/dim/brand/                 →  data/dim/brand/
  数据管理/warehouse/fact/quotes_conversion/    →  data/fact/quotes_conversion/  (存在时)
  server/data/reports/                          →  data/reports/  (不使用 --delete，保留历史报告；后端鉴权访问)
  public/reports/                               →  frontend/dist/reports/  (不使用 --delete；Nginx 静态托管)

可选参数:
  --alias <name>       覆盖 SSH alias（默认 chexian-vps-deploy）
  --host <host>        覆盖远端主机
  --user <user>        覆盖远端用户名
  --port <port>        覆盖远端端口
  --key <path>         覆盖私钥路径
  --remote-dir <path>  覆盖远端数据根目录
  --health-url <url>   覆盖健康检查地址
  --domain <ids>       仅同步指定数据域（逗号分隔），如 customer_flow,new_energy_claims
`);
}

function buildStandardSyncTasks(remote, frontendDist) {
  return [
    { label: 'policy/current',       local: LOCAL_CURRENT_DIR,            remote: `${remote}/current`,               critical: true },
    { label: 'dim/salesman',         local: LOCAL_SALESMAN_DIR,           remote: `${remote}/dim/salesman`,          critical: true },
    { label: 'dim/plan',             local: LOCAL_PLAN_DIR,               remote: `${remote}/dim/plan`,              critical: true },
    { label: 'fact/quotes_conversion', local: LOCAL_QUOTES_CONVERSION_DIR, remote: `${remote}/fact/quotes_conversion`, critical: false },
    { label: 'dim/brand',            local: LOCAL_BRAND_DIR,              remote: `${remote}/dim/brand`,             critical: false },
    { label: 'fact/claims_detail',   local: LOCAL_CLAIMS_DETAIL_DIR,      remote: `${remote}/fact/claims_detail`,    critical: true },
    { label: 'fact/cross_sell',      local: LOCAL_CROSS_SELL_DIR,         remote: `${remote}/fact/cross_sell`,       critical: false },
    { label: 'fact/customer_flow',   local: LOCAL_CUSTOMER_FLOW_DIR,      remote: `${remote}/fact/customer_flow`,    critical: false },
    { label: 'fact/new_energy_claims', local: LOCAL_NEW_ENERGY_CLAIMS_DIR, remote: `${remote}/fact/new_energy_claims`, critical: false },
    { label: 'fact/renewal_tracker', local: LOCAL_RENEWAL_TRACKER_DIR,    remote: `${remote}/fact/renewal_tracker`,  critical: false },
    { label: 'dim/repair',           local: LOCAL_REPAIR_DIR,             remote: `${remote}/dim/repair`,            critical: false },
    { label: 'dim/plate_region',     local: LOCAL_PLATE_REGION_DIR,       remote: `${remote}/dim/plate_region`,      critical: false },
    { label: 'patrol_reports',       local: LOCAL_PATROL_REPORTS_DIR,     remote: `${remote}/patrol_reports`,        critical: false },
    { label: 'html_reports',         local: LOCAL_HTML_REPORTS_DIR,       remote: `${remote}/reports`,               critical: false, deleteRemote: false },
    { label: 'public_reports',       local: LOCAL_PUBLIC_REPORTS_DIR,     remote: `${frontendDist}/reports`,         critical: false, deleteRemote: false },
  ];
}

function buildDomainSyncTasks(remote, frontendDist, domainIds) {
  const domainTaskMap = {
    customer_flow: { label: 'fact/customer_flow', local: LOCAL_CUSTOMER_FLOW_DIR, remote: `${remote}/fact/customer_flow`, critical: true, atomicLatest: true },
    new_energy_claims: { label: 'fact/new_energy_claims', local: LOCAL_NEW_ENERGY_CLAIMS_DIR, remote: `${remote}/fact/new_energy_claims`, critical: true, atomicLatest: true },
  };
  const tasks = domainIds.map((domainId) => {
    const task = domainTaskMap[domainId];
    if (!task) throw new Error(`不支持 --domain ${domainId}`);
    return { ...task, domain: domainId };
  });
  // codex P2（PR #511）：domain 模式也必须带 public_reports，否则 full_snapshot 域
  // （customer_flow / new_energy_claims）专项发布走 `sync-and-reload <域>` 时，Stage 3 只同步
  // 该 fact 域、不同步报告 → Stage 1.5 新生成的报告/manifest 永远推不上去 → 首页报告卡指向旧期。
  // 由 public_reports 触发 generateManifestsLocal（本地 pull→生成→push），与全量模式行为一致。
  tasks.push({ label: 'public_reports', local: LOCAL_PUBLIC_REPORTS_DIR, remote: `${frontendDist}/reports`, critical: false, deleteRemote: false });
  return tasks;
}

function buildSyncTasks(runConfig) {
  if (runConfig.domains.length > 0) {
    return buildDomainSyncTasks(runConfig.remoteDir, runConfig.frontendDistDir, runConfig.domains);
  }
  return buildStandardSyncTasks(runConfig.remoteDir, runConfig.frontendDistDir);
}

function printDryRun(sshConfig, runConfig) {
  log('blue', '================================================================================');
  log('blue', 'DRY RUN - VPS rsync 同步执行计划');
  log('blue', '================================================================================');
  console.log(`SSH alias: ${sshConfig.alias}`);
  console.log(`SSH: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`);
  console.log(`Key: ${sshConfig.privateKeyPath}`);
  console.log(`Remote data root: ${runConfig.remoteDir}`);
  console.log(`Remote frontend dist: ${runConfig.frontendDistDir}`);
  console.log(`Restart: ${runConfig.noRestart ? 'no' : 'yes'}`);
  console.log(`Domains: ${runConfig.domains.length ? runConfig.domains.join(',') : '(all)'}`);
  console.log(`Health URL: ${runConfig.healthUrl}`);
  console.log('');
  if (!runConfig.noCleanup) {
    console.log('前置步骤: 依次清理两个累积目录（server/data/reports + public/reports）');
    console.log('  node scripts/cleanup-reports.mjs --dir server/data/reports --apply --quiet');
    console.log('  node scripts/cleanup-reports.mjs --dir public/reports        --apply --quiet');
  } else {
    console.log('前置步骤: ⊝ 跳过 reports 清理（--no-cleanup）');
  }
  console.log('');
  console.log('将执行以下同步:');

  const syncTasks = buildSyncTasks(runConfig);

  for (const task of syncTasks) {
    const exists = existsSync(task.local);
    const tag = task.critical ? '[CRITICAL]' : '[optional]';
    const suffix = exists ? '' : '  （本地目录不存在，跳过）';
    const excludeStr = RSYNC_EXCLUDES.map((p) => `--exclude '${p}'`).join(' ');
    const deleteArg = task.deleteRemote === false ? '' : '--delete ';
    if (task.atomicLatest) {
      console.log(`  ${tag} rsync -azv -e ssh ${task.local}/latest.parquet ${sshConfig.alias}:${task.remote}/latest.parquet.uploading && mv latest.parquet.uploading latest.parquet${suffix}`);
    } else {
      console.log(`  ${tag} rsync -azv ${deleteArg}${excludeStr} -e ssh ${task.local}/ ${sshConfig.alias}:${task.remote}/${suffix}`);
    }
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
async function runReportsCleanup(runConfig) {
  if (runConfig.noCleanup) {
    log('yellow', '⊝ 跳过 reports 清理（--no-cleanup）');
    return;
  }
  const script = join(__dirname, 'cleanup-reports.mjs');
  if (!existsSync(script)) {
    log('yellow', `⊝ cleanup-reports.mjs 不存在，跳过`);
    return;
  }
  // 同时覆盖两个 deleteRemote:false 累积目录（codex review P2）
  const targets = [
    { dir: LOCAL_HTML_REPORTS_DIR, label: 'server/data/reports' },
    { dir: LOCAL_PUBLIC_REPORTS_DIR, label: 'public/reports' },
  ];
  const mode = runConfig.dryRun ? 'dry-run' : 'apply';
  for (const t of targets) {
    if (!existsSync(t.dir)) {
      log('yellow', `  ⊝ ${t.label} 本地不存在，跳过`);
      continue;
    }
    const args = ['--dir', t.dir, '--quiet'];
    if (!runConfig.dryRun) args.push('--apply');
    log('blue', `▶ 同步前清理 ${t.label}（${mode}）...`);
    try {
      await runLocal('node', [script, ...args]);
    } catch (err) {
      log('yellow', `  ⚠ ${t.label} 清理失败（非致命）: ${err.message}`);
    }
  }
}

async function runStandardMode(sshConfig, runConfig) {
  const alias = sshConfig.alias;

  // 同步前清理本地 reports（与 html_reports/public_reports deleteRemote:false 累积问题配套）
  await runReportsCleanup(runConfig);

  const syncTasks = buildSyncTasks(runConfig);

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
    activeTasks.map(task => (
      task.atomicLatest
        ? rsyncLatestAtomically(sshConfig, task.local, task.remote, task.label)
        : rsyncDir(alias, task.local, task.remote, task.label, { deleteRemote: task.deleteRemote })
    ))
  );

  // 收集失败结果；optional 任务一次性重试（网络抖动/SSH 瞬时失败容错）
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const task = activeTasks[i];
    // Promise.allSettled rejected（不应发生，rsyncDir 内部已 catch）或 rsyncDir 返回 ok:false
    let rsyncResult = result.status === 'fulfilled' ? result.value : { ok: false, label: task.label, error: result.reason?.message };
    if (!rsyncResult.ok && !task.critical) {
      log('yellow', `  重试 optional ${task.label}（抖动容错）...`);
      rsyncResult = task.atomicLatest
        ? await rsyncLatestAtomically(sshConfig, task.local, task.remote, task.label)
        : await rsyncDir(alias, task.local, task.remote, task.label, { deleteRemote: task.deleteRemote });
    }
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

  // 生成 reports manifest.json（前端首页报告卡据此判 ready/stale/unavailable）
  // 设计要点（两次踩坑后定稿）：
  //   - 旧旧实现「纯本地生成」：CI/Mac 本地 public/reports/ 常只有 .gitkeep → entries=0 → 跳过 → VPS 永远没 manifest
  //   - 旧实现「VPS 端生成」：VPS deploy 用户无 node（node 仅在 root 的 /root/.nvm 下，deployer 够不到）
  //     → `ssh node /tmp/gen-...` 永远 "node not found"（try/catch 静默失败）→ manifest 仍永远缺失 → 首页 916B 空白页
  //   - 现实现「本地 pull→生成→push」：先把 VPS 已有报告（含历史日期 + 既有 manifest）拉回本地补齐 union，
  //     再用本机 node 生成（生成器自带"空不覆盖"防御），最后 push 回 VPS。绕开 deployer 无 node + entries=0 双坑。
  //   - manifest 失败不阻断重启（前端 resolveReport 会判 unavailable 并显式提示，不再回落到空白页）
  const reportsTask = activeTasks.find((t) => t.label === 'public_reports');
  if (reportsTask) {
    const manifestResult = await generateManifestsLocal(sshConfig, reportsTask);
    if (!manifestResult.ok) {
      log('yellow', `⚠ manifest 生成/同步失败（不阻断重启）：${manifestResult.error}`);
    }
  }

  // 写同步清单：记录本次同步的文件指纹，governance 用于检测数据漂移
  writeSyncManifest(activeTasks, runConfig);

  await maybeRestart(sshConfig, runConfig.noRestart, runConfig.healthUrl);
}

/**
 * 本地生成 reports manifest.json，再 rsync 推回 VPS（替换旧 on-VPS 生成）。
 *
 * 为什么本地生成：VPS deploy 用户无 node（node 仅在 root 的 /root/.nvm 下，deployer 够不到），
 * 旧 `ssh node /tmp/gen-...` 永远 "node not found"，manifest 从未生成。
 *
 * 流程（pull → 本地生成 → push）：
 *   1. pull VPS 已有报告（含历史日期 + 既有 manifest）回本地 → union 完整、不丢历史，
 *      消除旧旧实现「本地 entries=0 覆盖 / 漏远端历史」的坑。
 *   2. 本地 in-process 调 generateReportsManifests（生成器自带「空不覆盖非空」防御）。
 *   3. push 回 VPS（manifest.json + 报告 HTML，deleteRemote:false 追加不删）。
 */
async function generateManifestsLocal(sshConfig, reportsTask) {
  const alias = sshConfig.alias;
  const localDir = reportsTask.local;     // public/reports
  const remoteDir = reportsTask.remote;   // <frontendDist>/reports
  log('green', '\n▶ 本地生成 reports manifest（VPS 无 node，改本地 pull→生成→push）...');

  // 1. pull：VPS reports → 本地（merge，无 --delete，补齐 union）
  const pullSrc = remoteDir.endsWith('/') ? remoteDir : `${remoteDir}/`;
  const pullDst = localDir.endsWith('/') ? localDir : `${localDir}/`;
  log('yellow', `  rsync pull: ${alias}:${pullSrc} → ${pullDst}`);
  try {
    await runLocal('rsync', ['-az', ...RSYNC_EXCLUDE_ARGS, '-e', 'ssh', `${alias}:${pullSrc}`, pullDst]);
  } catch (err) {
    log('yellow', `  ⚠ pull VPS 报告失败（继续，manifest 可能仅含本地期）：${err.message}`);
  }

  // 2. 本地生成 manifest（node 本机可用）
  let summaries;
  try {
    summaries = generateReportsManifests(localDir);
  } catch (err) {
    return { ok: false, error: `本地 manifest 生成失败: ${err.message}` };
  }
  for (const s of summaries) {
    log('green', s.skipped
      ? `  ${s.slug}: 本地无报告文件，跳过（保留既有 manifest）`
      : `  ${s.slug}: ${s.count} 期，最新 ${s.latest ?? '（无）'}`);
  }

  // 3. push：本地 → VPS（含新 manifest.json）
  const pushed = await rsyncDir(alias, localDir, remoteDir, 'public_reports(manifest)', { deleteRemote: false });
  return pushed.ok ? { ok: true } : { ok: false, error: pushed.error };
}

/**
 * 扫描所有 LOCAL_*_DIR 目录中的 parquet 文件，生成指纹清单。
 * governance 对比此清单与当前文件状态，不一致则阻断 push。
 */
function taskLabelFromManifestKey(key) {
  return key.split('/').slice(0, -1).join('/');
}

function readExistingSyncManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeSyncManifest(tasks = buildStandardSyncTasks(DEFAULTS.remoteDir, DEFAULTS.frontendDistDir), runConfig = { domains: [] }) {
  const files = {};
  for (const dir of tasks.map(task => ({ label: task.label, path: task.local }))) {
    if (!existsSync(dir.path)) continue;
    const parquets = readdirSync(dir.path).filter(f => f.endsWith('.parquet'));
    for (const f of parquets) {
      const fullPath = join(dir.path, f);
      const stat = statSync(fullPath);
      const key = `${dir.label}/${f}`;
      files[key] = { size: stat.size, mtimeMs: Math.floor(stat.mtimeMs), sha256: createHash('sha256').update(readFileSync(fullPath)).digest('hex') };
    }
  }

  const manifestPath = join(ROOT_DIR, '.last-sync-manifest.json');
  const existing = readExistingSyncManifest(manifestPath);
  let mergedFiles = files;
  let scope = runConfig.domains?.length ? 'domain' : 'all';

  if (scope === 'domain' && existing?.files) {
    const activeLabels = new Set(tasks.map(task => task.label));
    mergedFiles = { ...existing.files };
    for (const key of Object.keys(mergedFiles)) {
      if (activeLabels.has(taskLabelFromManifestKey(key))) {
        delete mergedFiles[key];
      }
    }
    Object.assign(mergedFiles, files);
    scope = 'all';
  }

  const manifest = {
    syncedAt: new Date().toISOString(),
    scope,
    domains: runConfig.domains || [],
    fileCount: Object.keys(mergedFiles).length,
    files: mergedFiles,
  };

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

  // policy/current 重叠门禁：拒绝把翻倍数据推上 VPS
  // 共享逻辑 → scripts/lib/parquet-overlap-check.mjs（与 check-governance + daily.mjs 同源）
  const overlapOk = assertNoPolicyCurrentOverlap(LOCAL_CURRENT_DIR, {
    onPass: (msg) => log('green', `✓ ${msg}`),
    onFail: (msg) => log('red', `❌ ${msg}`),
  });
  if (!overlapOk) process.exit(1);

  // 完整性闸门：本地 policy 数据若比 VPS 现役更旧/更少则拒绝，防残缺数据覆盖生产。
  // 仅在本次确实会同步 policy/current 时执行——--domain（只传对应 fact 域 latest.parquet，
  // 不含 policy）和 --check（仅预检）不该被 policy 新鲜度阻断。
  const willSyncPolicy = buildSyncTasks(runConfig).some((t) => t.label === 'policy/current');
  if (!runConfig.checkMode && willSyncPolicy) {
    const freshnessOk = await assertLocalNotStaleVsVps(sshConfig, LOCAL_CURRENT_DIR, {
      onPass: (msg) => log('green', `✓ 完整性闸门: ${msg}`),
      onWarn: (msg) => log('yellow', `⚠ 完整性闸门: ${msg}`),
      onFail: (msg) => log('red', `❌ 完整性闸门: ${msg}`),
    });
    if (!freshnessOk) {
      log('red', '  本地数据疑似不全。若确属正常（如上游修正删重），请在数据完整的 ETL 机重跑，或人工核对后再同步。');
      process.exit(1);
    }
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
  buildDomainSyncTasks,
  buildStandardSyncTasks,
  buildSyncTasks,
  rsyncLatestAtomically,
  evaluateFreshness,
};

const isMain = process.env.RUN_MAIN || (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    log('red', `错误: ${e.message}`);
    process.exit(1);
  });
}
