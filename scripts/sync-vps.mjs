#!/usr/bin/env node
/**
 * VPS 数据同步脚本（rsync 全目录版）
 * 支持 macOS / Linux
 *
 * 使用方法:
 *   node scripts/sync-vps.mjs                    # rsync 同步所有数据目录（默认不重启 PM2）
 *   node scripts/sync-vps.mjs --check            # 仅预检 SSH 与本地待同步文件
 *   node scripts/sync-vps.mjs --restart          # 同步后显式触发 PM2 restart
 *   node scripts/sync-vps.mjs --no-restart       # [已废弃] 等同默认行为；兼容旧调用
 *   node scripts/sync-vps.mjs --domain customer_flow
 *   node scripts/sync-vps.mjs --dry-run          # 仅打印执行计划，不连接 VPS
 *
 * 默认行为变更（2026-06-13 起）：
 *   - 文件同步与服务重启是两件事，默认混合是高危陷阱（曾撞 bcrypt 原生模块地雷）
 *   - 默认改为「纯文件同步」；reload/restart 走 sync-and-reload.mjs 或 deploy 链路
 *   - 兼容性：sync-and-reload.mjs:349 已显式传 --no-restart，GitHub Actions 不调用本脚本
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
import { recordEvent } from './etl-ledger/record.mjs';
import {
  inspectPolicyCurrentLayout,
  listPolicyCurrentShards,
  toDuckdbReadParquetList,
  findPolicyCurrentSyncGateViolations,
} from './lib/policy-current-shards.mjs';

/**
 * B3 sync 生产基准省（GATED 闸 + 任务构建用）——**固定 'SC'**（当前生产唯一在线省）。
 * 刻意**不读 ETL 的 `BRANCH_CODE` env**（codex 闸-2 P1）：该 env 在 SX ETL 时为 'SX'，若被 sync 闸采信
 * 会把 `current/SX/` 误判基准省放行 → 推生产，违 GATED 红线。B5 cutover 把 SX 真正上线时，由显式授权的
 * 部署/cutover 开关改这里（非读 BRANCH_CODE），届时再参数化；B3 范围内任何非 SC 子目录无条件 fail-closed。
 */
const SYNC_BASELINE_BRANCH = 'SC';

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
// GATED 多省：非 SC 省派生域隔离副本根（warehouse/validation/<省>/<域>），sync 推到 VPS data/validation/<省>/<域>（PR-2）
const LOCAL_VALIDATION_DIR = join(ROOT_DIR, '数据管理/warehouse/validation');

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
    noRestart: true,  // 默认不重启 — 2026-06-13 默认行为反转，详见文件头注释
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
        // 已废弃但保留向后兼容：等同默认行为（noRestart=true）
        parsed.noRestart = true;
        break;
      case '--restart':
        // 显式触发 PM2 restart（默认行为已反转为不重启）
        parsed.noRestart = false;
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

/**
 * 多省 Phase B B3 · policy/current 同步任务构建（**退役 #753 前缀方案**，改分省子目录 current/<省>/）。
 *
 * 设计（codex 闸-1 P0-1/P0-2 收紧）：
 *   - **扁平布局**（subdirCount===0，含今天 SC 生产现状 + 空目录）→ 单任务 `policy/current` → `data/current`，
 *     rsync 无 filter，**与退役前 branchCode=null 短路路径逐字节等价**（字节安全基线）。
 *   - **子目录独占**（subdirOnly）→ **仅基准省**子目录每省独立任务 `current/<省>/` → `data/current/<省>/`；
 *     --delete 作用域天然限于该子目录（每省隔离）。非基准省子目录**防御性排除**，由 GATED 预检大声 fail-closed
 *     （`findPolicyCurrentSyncGateViolations`，main 内 dryRun 前）——B3 不把非基准省推生产（B5 cutover 独立授权）。
 *   - **遍历实际子目录**（`inspectPolicyCurrentLayout` readdir 枚举），数据/配置驱动，禁硬编码 ['SC','SX'] 省常量。
 *
 * 所有 policy 任务带 `kind:'policy-current'`：供 main 的 `willSyncPolicy` 跨「扁平/子目录」两种 label 识别，
 * 不被「子目录 label = policy/current/<省>」绕过 freshness 完整性闸（codex 闸-1 P0-2）。
 *
 * @param {string} localCurrentDir policy/current 本地根目录
 * @param {string} remoteCurrent   VPS 远端 current 目录（如 `<remote>/current`）
 * @param {string} [deploymentBranch] 部署基准省（默认 SYNC_BASELINE_BRANCH='SC'，禁读 ETL BRANCH_CODE）
 * @returns {Array<{label:string, kind:string, local:string, remote:string, critical:boolean}>}
 */
function buildPolicyCurrentTasks(localCurrentDir, remoteCurrent, deploymentBranch = SYNC_BASELINE_BRANCH) {
  const layout = inspectPolicyCurrentLayout(localCurrentDir);
  if (layout.subdirOnly) {
    // 子目录独占：仅同步基准省子目录（非基准省由 GATED 预检 fail-closed，此处防御性排除不静默推生产）
    return layout.branches
      .filter((branch) => branch === deploymentBranch)
      .map((branch) => ({
        label: `policy/current/${branch}`,
        kind: 'policy-current',
        local: join(localCurrentDir, branch),
        remote: `${remoteCurrent}/${branch}`,
        critical: true,
      }));
  }
  // 扁平 / 空 / 并存 → 单任务（字节等价历史；扁平+子目录并存交 GATED 预检 fail-closed）
  return [{
    label: 'policy/current',
    kind: 'policy-current',
    local: localCurrentDir,
    remote: remoteCurrent,
    critical: true,
  }];
}

async function rsyncDir(alias, localDir, remoteDir, label, options = {}) {
  // 确保 localDir 以 / 结尾（rsync 语义：同步目录内容而非目录本身）
  const src = localDir.endsWith('/') ? localDir : `${localDir}/`;
  const dst = remoteDir.endsWith('/') ? remoteDir : `${remoteDir}/`;
  const deleteRemote = options.deleteRemote !== false;
  const deleteArgs = deleteRemote ? ['--delete'] : [];

  // B3：退役 #753 前缀 filter——分省隔离改由「每省独立 current/<省>/ → data/current/<省>/」
  // 提供（--delete 作用域天然限子目录）。此处回归纯 rsync，与退役前单省短路（branchCode=null）逐字节等价。
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
  // B3：用共享 helper 显式枚举 policy/current 分片（顶层扁平 + 省份子目录 current/<省>/），
  // 经 read_parquet([显式文件列表]) 读取 —— 跨「扁平/子目录」两种布局统一覆盖（不再 `*.parquet` 宽 glob，
  // 否则子目录文件失明）。扁平 SC 现状下：显式列表 = 同一批顶层文件 → COUNT/MAX 结果与历史逐行等价（字节安全）。
  const shards = listPolicyCurrentShards(localCurrentDir);
  if (shards.length === 0) return null; // 无分片 → 降级（read_parquet 空数组会报错）
  const fileList = toDuckdbReadParquetList(shards.map((s) => s.path));
  // union_by_name=true 对齐后端加载器（duckdb-parquet-loader.ts）：分片间存在兼容字段差异时，
  // 不加会让 CLI 抛错 → 返回 null → 闸门 skip 降级放行，反而绕过本闸门要防的残缺数据同步。
  const sql = `SELECT MAX(CAST(policy_date AS DATE))::VARCHAR AS max_date, COUNT(*) AS row_count FROM read_parquet(${fileList}, union_by_name=true)`;
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

/**
 * 完整性闸门主入口（B3 简化：退役 #753 前缀 + 分省降级分支）。
 *
 * 本地 policy 数据若比 VPS 现役更旧/更少则 block，防残缺数据覆盖生产。
 *
 * B3 安全前提（codex 闸-1 P1-2）：GATED 预检（findPolicyCurrentSyncGateViolations）已保证
 * **只有基准省**会进入同步（非基准省子目录无条件 fail-closed），故本地全量指纹 = 基准省全量，
 * 与 VPS 全量（基准省）可比——全量比较不会被异省行数掩盖 stale 基准省，无需分省降级路径。
 * 本地指纹由 queryLocalPolicyFingerprint 经 helper 显式枚举（覆盖扁平 + 基准省子目录两种布局）。
 */
// 导出供单元测试；生产调用路径通过 main() 内部间接使用。
export async function assertLocalNotStaleVsVps(config, localCurrentDir, hooks = {}) {
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
    // B3：policy/current 用共享 helper 枚举（含省份子目录 current/<省>/），其余目录扁平 readdir。
    const files = label === 'policy/current'
      ? listPolicyCurrentShards(path).map((s) => s.path)
      : readdirSync(path)
          .filter((f) => f.endsWith('.parquet'))
          .map((f) => join(path, f));
    return { label, path, files, exists: true };
  });
}

function printHelp() {
  console.log(`用法:
  node scripts/sync-vps.mjs              # rsync 同步所有数据目录（默认不重启 PM2）
  node scripts/sync-vps.mjs --domain customer_flow
  node scripts/sync-vps.mjs --check      # 预检 SSH + 列出本地待同步文件
  node scripts/sync-vps.mjs --dry-run    # 仅打印执行计划，不连接 VPS
  node scripts/sync-vps.mjs --restart    # 同步后显式触发 PM2 restart

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

// loader（data-bootstrapper resolveBranchFactExtras + resolveBranchClaimsDetailExtras）从 validation/<省>
// 读取的派生域集合。维度域（salesman/plan/repair）SX 未隔离（validation/<省> 无 dim/ 子层），不在此列。
const VALIDATION_SYNCED_DOMAINS = ['claims_detail', 'quotes_conversion', 'renewal_tracker', 'cross_sell', 'new_energy_claims'];

/**
 * validation 分省同步总开关（codex 闸-2 CRITICAL 修复）。
 *
 * 把非 SC 省 validation 派生域推到生产是 GATED cutover **显式数据发布步**（类比 #790），**绝不**
 * 随日常 sync 自动发生：RLS-off 时若 SX validation 进生产，bootstrapper resolveBranch*Extras 不检查
 * BRANCH_RLS_ENABLED、loader 无条件 UNION ALL BY NAME → SX 数据进派生关系。PR-1 仅对 claims 经
 * PolicyFact JOIN 丢弃验证过字节安全，quotes_conversion/renewal_tracker 等直接聚合域未必丢弃 SX 行
 * → 违反「RLS-on 前 SX 绝不进生产」。故默认 off：日常 sync 逐字节等价历史。操作者在 cutover 数据
 * 发布步显式设 SYNC_VALIDATION_BRANCHES=1 才推。
 */
function validationBranchSyncEnabled() {
  const v = (process.env.SYNC_VALIDATION_BRANCHES ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * 某 validation 派生域目录是否含真实数据文件（codex 闸-2 HIGH 修复，与 bootstrapper 文件级对称）。
 * 缺数据文件即不同步：rsyncDir 默认 --delete，空/半成品目录会清空 VPS data/validation/<省>/<域>。
 * - claims_detail：CDC 年度分区 → 须有 `claims_*.parquet`（同 resolveBranchClaimsDetailExtras）。
 * - 其余派生域：单文件 → 须有 `latest.parquet`（同 getBranchValidationFactPath）。
 */
function validationDomainHasData(domainDir, domain) {
  if (domain === 'claims_detail') {
    return readdirSync(domainDir).some((f) => f.startsWith('claims_') && f.endsWith('.parquet'));
  }
  return existsSync(join(domainDir, 'latest.parquet'));
}

/**
 * GATED 多省：非 SC 省派生域 validation 隔离副本的同步任务（PR-2 · 部署链 cutover 能力）。
 *
 * 枚举 warehouse/validation/<省>/<派生域>，构建 rsync 任务推到 VPS data/validation/<省>/<域>，
 * 让 VPS 服务端经 getValidationRootDir VPS 回退读到 SX 派生域。省份枚举与 data-bootstrapper
 * resolveBranch*Extras 严格一致（`^[A-Z]{2}$` + 排除 SC + 升序 + 文件级存在性）→「loader 读取域」==
 * 「sync 推送域」对称，开 RLS 后不漏域。SC 走 fact/ 标准同步、premium 走 current/ promote，均不经 validation。
 *
 * **字节安全双闸**：
 *   1. 总开关 SYNC_VALIDATION_BRANCHES 默认 off → 返回 [] → 日常 sync 逐字节等价历史，SX 绝不进生产。
 *   2. validationRoot / 域数据文件不存在 → 跳过该域（防 rsync --delete 误删 VPS）。
 * GATED：critical=false，RLS-off 时 VPS 不消费、任务失败不阻断日常同步。
 *
 * @param {string} remote - VPS 远端数据根目录
 * @param {string} [validationRoot=LOCAL_VALIDATION_DIR] - validation 隔离区根（测试可注入临时目录）
 * @returns {Array<{label:string, local:string, remote:string, critical:boolean}>}
 */
function buildValidationBranchSyncTasks(remote, validationRoot = LOCAL_VALIDATION_DIR) {
  if (!validationBranchSyncEnabled()) return []; // GATED 总开关：默认不推（字节安全：日常 sync 不变）
  if (!existsSync(validationRoot)) return [];
  const provinces = readdirSync(validationRoot)
    .filter((entry) => entry !== 'SC' && /^[A-Z]{2}$/.test(entry))
    .sort((a, b) => a.localeCompare(b));
  const tasks = [];
  for (const province of provinces) {
    for (const domain of VALIDATION_SYNCED_DOMAINS) {
      const localDomainDir = join(validationRoot, province, domain);
      if (!existsSync(localDomainDir) || !statSync(localDomainDir).isDirectory()) continue;
      if (!validationDomainHasData(localDomainDir, domain)) continue; // 防空目录 rsync --delete 误删 VPS
      tasks.push({
        label: `validation/${province}/${domain}`,
        local: localDomainDir,
        remote: `${remote}/validation/${province}/${domain}`,
        critical: false,
      });
    }
  }
  return tasks;
}

/**
 * 非 SC 省维度隔离副本同步任务（warehouse/validation/<省>/dim/<域> → VPS data/validation/<省>/dim/<域>）。
 *
 * 与 buildValidationBranchSyncTasks 的关键区别：
 * - 目标是维度元数据（salesman/plan/repair），不含保单/理赔个人信息
 * - 不受 SYNC_VALIDATION_BRANCHES 门控：日常 sync 自动推，无需手动开关
 *   （门控目的是防止 RLS-off 时 SX 个人数据进生产；元数据无此风险）
 * - bootstrapper.resolveBranchDimExtras 探测 data/validation/<省>/dim/<域>/latest.parquet
 *   就位后自动 UNION ALL BY NAME 加入多省维度（ADR G3）
 *
 * 前置条件：generate_dim_tables.py --branch-code SX 已生成 validation/SX/dim/ 目录。
 */
function buildValidationDimSyncTasks(remote, validationRoot = LOCAL_VALIDATION_DIR) {
  if (!existsSync(validationRoot)) return [];
  const DIM_SUBDOMAINS = ['salesman', 'plan', 'repair'];
  const tasks = [];
  const provinces = readdirSync(validationRoot)
    .filter((entry) => entry !== 'SC' && /^[A-Z]{2}$/.test(entry))
    .sort((a, b) => a.localeCompare(b));
  for (const province of provinces) {
    const dimDir = join(validationRoot, province, 'dim');
    if (!existsSync(dimDir) || !statSync(dimDir).isDirectory()) continue;
    for (const subdomain of DIM_SUBDOMAINS) {
      const localSubDir = join(dimDir, subdomain);
      if (!existsSync(localSubDir) || !statSync(localSubDir).isDirectory()) continue;
      if (!existsSync(join(localSubDir, 'latest.parquet'))) continue;
      tasks.push({
        label: `validation/${province}/dim/${subdomain}`,
        local: localSubDir,
        remote: `${remote}/validation/${province}/dim/${subdomain}`,
        critical: false,
      });
    }
  }
  return tasks;
}

/**
 * 构建标准同步任务列表。
 *
 * 多省 Phase B B3（退役 #753 前缀方案）：policy/current 同步任务改由 `buildPolicyCurrentTasks` 按布局展开
 *   —— 扁平（SC 现状）→ 单任务 `policy/current`（字节等价历史）；子目录独占 → 仅基准省 `current/<省>/` 每省独立任务。
 *   分省隔离由「每省独立目标目录 + --delete 限子目录」提供，不再用 rsync 前缀 filter / safeDeleteBranch。
 *
 * @param {string} remote - VPS 远端数据根目录
 * @param {string} frontendDist - VPS 前端 dist 目录
 * @param {{localCurrentDir?: string}} [opts] - 可选配置（localCurrentDir 供测试注入，默认 LOCAL_CURRENT_DIR）
 */
function buildStandardSyncTasks(remote, frontendDist, opts = {}) {
  // LOCAL_CURRENT_DIR 引用保留在本函数体内（governance #20 数据域覆盖闸扫描区间 = buildStandardSyncTasks→runStandardMode）
  const policyCurrentTasks = buildPolicyCurrentTasks(opts.localCurrentDir ?? LOCAL_CURRENT_DIR, `${remote}/current`);
  return [
    ...policyCurrentTasks,
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
    // 多省维度元数据（salesman/plan/repair）→ VPS data/validation/<省>/dim/<域>
    // 不受 SYNC_VALIDATION_BRANCHES 门控（dim 是元数据，无 PII 风险，bootstrapper 探测即生效）
    ...buildValidationDimSyncTasks(remote, LOCAL_VALIDATION_DIR),
    // GATED 多省：validation/<非SC省>/<派生域> → VPS data/validation/<省>/<域>
    // 默认 off（需 SYNC_VALIDATION_BRANCHES=1，cutover 数据发布步显式开）→ 日常 sync 字节安全
    ...buildValidationBranchSyncTasks(remote, LOCAL_VALIDATION_DIR),
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
    // B3：退役 #753 前缀 filter——分省隔离改由每省独立 current/<省>/ 目标目录提供（task.remote 已带省份后缀）。
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

  // 并行 rsync 所有目录（B3：分省隔离由每省独立 current/<省>/ 目标目录提供，rsyncDir 已退役前缀 filter）
  const results = await Promise.allSettled(
    activeTasks.map(task => (
      task.atomicLatest
        ? rsyncLatestAtomically(sshConfig, task.local, task.remote, task.label)
        : rsyncDir(alias, task.local, task.remote, task.label, {
            deleteRemote: task.deleteRemote,
          })
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
        : await rsyncDir(alias, task.local, task.remote, task.label, {
            deleteRemote: task.deleteRemote,
          });
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
  // B3：每个 task 的 local 已是具体目录（扁平 policy/current 根 / 子目录 current/<省>/），readdir 该目录即得本省文件。
  // key=`${task.label}/${f}` 随 label 自然成扁平 `policy/current/<f>` 或子目录 `policy/current/<省>/<f>` 形态，
  // 与 governance #21 checkDataDrift（同用 listPolicyCurrentShards 枚举 + 同 key 规则）保持一致（codex 闸-1 P1-1）。
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

  // 🔴 GATED 省份子目录预检（B3 · 纯本地 · 最先执行 · 覆盖 dry-run/check/real · codex 闸-1 P1-3）：
  // current/ 出现非基准省子目录（如 SX）或扁平+子目录并存 → fail-closed，绝不把非基准省推生产
  // （SX 仍走 validation/SX 隔离；真正上线是 B5 独立 GATED cutover，须用户授权）。
  // 镜像 data-bootstrapper.ts:enforceProvinceSubdirGate，但比 B1 严（不给 BRANCH_RLS_ENABLED 放行口）。
  // 置于 SSH 配置解析之前：纯本地 fail-closed 闸不应被 SSH/密钥状态阻断或绕过。
  // 基准省固定 SYNC_BASELINE_BRANCH='SC'（禁读 ETL BRANCH_CODE，codex 闸-2 P1）。
  // 今天 current/ 扁平无子目录 → 返回 [] 休眠，生产路径行为不变。
  const gateViolations = findPolicyCurrentSyncGateViolations(LOCAL_CURRENT_DIR, { deploymentBranch: SYNC_BASELINE_BRANCH });
  if (gateViolations.length > 0) {
    log('red', '❌ GATED 省份子目录闸（sync 前 fail-closed）：');
    for (const v of gateViolations) log('red', `   ${v}`);
    process.exit(1);
  }

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
  // B3（codex 闸-1 P0-2）：用 kind:'policy-current' 跨「扁平 policy/current」与「子目录 policy/current/<省>」
  // 两种 label 统一识别，防子目录布局下精确 label 比对漏判 → 绕过 freshness 完整性闸。
  const willSyncPolicy = buildSyncTasks(runConfig).some((t) => t.kind === 'policy-current');
  if (!runConfig.checkMode && willSyncPolicy) {
    const freshnessOk = await assertLocalNotStaleVsVps(sshConfig, LOCAL_CURRENT_DIR, {
      onPass: (msg) => log('green', `✓ 完整性闸门: ${msg}`),
      onWarn: (msg) => log('yellow', `⚠ 完整性闸门: ${msg}`),
      onFail: (msg) => log('red', `❌ 完整性闸门: ${msg}`),
    });
    if (!freshnessOk) {
      log('red', '  本地数据疑似不全。若确属正常（如上游修正删重），请在数据完整的 ETL 机重跑，或人工核对后再同步。');
      // ④vps_sync 埋点（失败）：完整性闸门拒绝 = 典型断点（本地数据倒退被拦）
      recordEvent({ stage: 'vps_sync', step: 'integrity_gate', status: 'failure', error: '完整性闸门拒绝：本地 policy 数据比 VPS 现役更旧/更少，疑似不全' });
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
  // ④vps_sync 埋点（成功）：runStandardMode 正常返回 = rsync 全目录同步成功
  // （内部 critical 目录失败会 process.exit(1) 不到此，属已知边界——细粒度失败暂不单记）
  recordEvent({ stage: 'vps_sync', step: 'rsync_all', status: 'success' });
}

// 注：assertLocalNotStaleVsVps / queryLocalPolicyFingerprint 已在上方用 export 声明，无需在此 re-export。
// #753 前缀方案 5 函数（branchOfFile/fileBelongsToBranch/branchFilePatterns/buildRsyncBranchFilterArgs/
// isFileInBranch）+ getSyncBranchCode + queryLocalPolicyFingerprintForBranch 已于 B3 退役删除（改分省子目录）。
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
  buildValidationBranchSyncTasks,
  validationBranchSyncEnabled,
  buildPolicyCurrentTasks,
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
