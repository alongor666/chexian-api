#!/usr/bin/env node
/**
 * 全流程入口：ETL → governance → PM2 reload → 健康检查 → 可选企微同步
 *
 * 设计哲学：daily.mjs 单一职责（ETL + rsync），本脚本负责"上线变更"全流程。
 *
 * 流程（严格顺序）：
 *   0.   node scripts/pull-bi-exports.mjs                    （拉取 VPS auto_loadbi 上游导出 → 校验 → 分发；
 *                                                              full_snapshot 单域模式自动跳过，--skip-pull 手动跳过）
 *   1.   node 数据管理/daily.mjs <subcommand>                （默认 all；可传 premium/claims_detail 等）
 *   1.5. node 数据管理/daily.mjs report --no-sync            （短中长期对照报告：省级 + branches/<省>
 *                                                              镜像 + 各注册省机构级 orgs/<省>/<机构>/）
 *   2.   bun run governance                                   （24+ 项校验，失败则中止）
 *   2.8. ssh 备份 state.db（PAT/用户/角色权威数据）到 VPS 独立目录，保留最近 N 份；
 *                                                              失败只告警不阻塞（STATE_DB_BACKUP_ENABLED=0 可关）
 *   3.   ssh sudo /usr/local/bin/deploy-chexian-api reload    （pm2 delete + start，可恢复 errored）
 *   4.   curl https://chexian.cretvalu.com/health             （重试 8 次 / 5 秒间隔）
 *   4.5. rsync public/reports/ → VPS frontend/dist/reports/   （Nginx 静态托管）
 *   5.   可选：批量同步企微机构续保追踪表 + 续保5月表 + 邮政经代签单表
 *
 * 双批发布（2026-07-18 起，上游改双批出表）：--batch early|late 从 release-batches.mjs SSOT
 * 取该批的 ETL 域集 + code 子集 + 报告/企微编排。企微 2026-07-22 起挂早批（01签单+05理赔）；
 * 晚批（02报价+03维修+04厂牌+尾部域）不跑企微。不带 --batch = 全量 daily.mjs all（12:00 后手动补全用）。
 *
 * 使用：
 *   node scripts/sync-and-reload.mjs                        # daily.mjs all（全量单批，兜底）
 *   node scripts/sync-and-reload.mjs --batch early          # 早批：premium + claims_detail（含企微）
 *   node scripts/sync-and-reload.mjs --batch late           # 晚批：quotes/repair/brand/...（不企微）
 *   node scripts/sync-and-reload.mjs premium                # 仅保费域
 *   node scripts/sync-and-reload.mjs --skip-governance      # 跳过 governance（不推荐）
 *   node scripts/sync-and-reload.mjs --skip-reload          # 仅 ETL+governance，不重启
 *   node scripts/sync-and-reload.mjs --wecom                # 线上健康后同步企微机构续保表 + 续保5月表 + 邮政经代表
 *   node scripts/sync-and-reload.mjs --wecom-dry-run        # 只打印企微同步计划
 *   node scripts/sync-and-reload.mjs --wecom --wecom-org 新都,资阳
 *   node scripts/sync-and-reload.mjs --dry-run              # 仅打印计划，不执行
 *
 * 任一阶段失败立即退出且告知排查方向，不进入后续阶段。
 * 🔴 例外：Stage 5 企微失败**非阻断**（PR #1158 评审 F1）——核心数据发布（Stage 0~4.5）已成功，
 * 企微失败只独立告警 + 独立重试（node scripts/wecom-sync.mjs），进程仍以 0 退出，
 * 避免 watcher 把批次标 failed 引发晚批连坐与 ETL/reload 重跑。
 *
 * 环境变量：
 *   SYNC_VPS_SSH_ALIAS         （默认 chexian-vps-deploy）
 *   SYNC_AND_RELOAD_HEALTH_URL （默认 https://chexian.cretvalu.com/health）
 *   STATE_DB_BACKUP_ENABLED    （默认启用；'0'/'false' 关闭 state.db 备份步骤）
 *   STATE_DB_REMOTE_PATH       （默认 /var/www/chexian/server/data/state.db）
 *   STATE_DB_BACKUP_DIR        （默认 /var/www/chexian/server/data/backups/state）
 *   STATE_DB_BACKUP_KEEP       （默认 14，保留最近 N 份按天备份）
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { recordEvent, LEDGER_ROOT } from './etl-ledger/record.mjs';
import { writeAllReport, loadAllEvents } from './etl-ledger/render.mjs';
// 多省 B2 分省编排：遍历注册的非 SC 省逐域生成 daily.mjs 步骤（省份枚举单一来源 source-file-routing）
import { buildBranchEtlSteps, shouldEnableValidationBranchSync, BRANCH_PUBLISH_DOMAINS } from '../数据管理/lib/branch-publish.mjs';
// 双批发布 SSOT（早批 01+05 / 晚批 02+03+04）：批次 → ETL 域 / code 子集 / 报告·企微编排
import { getReleaseBatch, batchAllCodes, RELEASE_BATCH_IDS } from '../数据管理/lib/release-batches.mjs';
// 晚批依赖早批 fail-closed：手动入口独立校验前置批当天已 released（与 watcher 防混新鲜度同）
import { unmetDependencies } from '../数据管理/lib/auto-release-decision.mjs';
// state.db 远程备份（575d2f）：reload 前在 VPS 上备份 PAT/用户/角色权威数据，失败不阻塞
import { resolveStateDbBackupConfig, buildStateDbBackupScript } from './lib/state-db-backup.mjs';
import { beijingDayOf } from '../数据管理/lib/bi-export-pull.mjs';
// 企微任务清单 + 到期停推 + 非阻断失败策略 SSOT（PR #1158 评审 F1/F2 拆出，单测锁定）
import {
  buildWecomTasks, filterActiveWecomTasks, summarizeWecomFailures, evaluateWecomOutcome,
  WECOM_ALERT_MARKER_RELPATH,
} from './lib/wecom-sync-tasks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const FULL_SNAPSHOT_DOMAINS = new Set(['customer_flow', 'new_energy_claims', 'new_energy']);
const FULL_SNAPSHOT_DOMAIN_ALIASES = {
  customer_flow: 'customer_flow',
  new_energy: 'new_energy_claims',
  new_energy_claims: 'new_energy_claims',
};

function log(color, msg) {
  process.stdout.write(`${COLORS[color] || ''}${msg}${COLORS.reset}\n`);
}

function loadDotEnvLocal() {
  const envPath = join(ROOT_DIR, '.env.local');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    skipPull: false,
    skipGovernance: false,
    skipReload: false,
    skipGate: false,
    skipGateReason: '',
    wecom: false,
    wecomDryRun: false,
    wecomExplicit: false, // 用户显式传了 --wecom/--wecom-dry-run（批次默认不覆盖它）
    wecomOrg: null,
    skipLarkArchive: false,
    batch: null,          // 双批发布：'early'|'late'；置位后覆盖 dailyArgs/wecom/report（见下）
    runReport: true,      // 是否跑 Stage 1.5 短中长期报告（批次可关；默认开）
    pullCodes: null,      // 传给 Stage 0 pull-bi-exports 的 code 子集（批次派生；null=全量）
    allowMissingDep: false, // 应急放行：跳过「前置批当天已 released」依赖闸（防混新鲜度）
    dailyArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--batch' || a.startsWith('--batch=')) {
      const id = a.includes('=') ? a.slice('--batch='.length) : argv[++i];
      let batch;
      try { batch = getReleaseBatch(id); } catch (e) { throw new Error(e.message); }
      opts.batch = batch.id;
    }
    else if (a === '--skip-pull') opts.skipPull = true;
    else if (a === '--skip-governance') opts.skipGovernance = true;
    else if (a === '--skip-reload') opts.skipReload = true;
    else if (a === '--skip-gate') opts.skipGate = true;
    else if (a === '--skip-gate-reason') {
      opts.skipGateReason = argv[++i] || '';
      if (!opts.skipGateReason) throw new Error('--skip-gate-reason 需要理由字符串');
    }
    else if (a.startsWith('--skip-gate-reason=')) {
      opts.skipGateReason = a.slice('--skip-gate-reason='.length);
    }
    else if (a === '--wecom') { opts.wecom = true; opts.wecomExplicit = true; }
    else if (a === '--wecom-dry-run') {
      opts.wecom = true;
      opts.wecomDryRun = true;
      opts.wecomExplicit = true;
    }
    else if (a === '--wecom-org') {
      opts.wecomOrg = argv[++i];
      if (!opts.wecomOrg) throw new Error('--wecom-org 需要机构列表，例如：--wecom-org 新都,资阳');
    }
    else if (a.startsWith('--wecom-org=')) {
      opts.wecomOrg = a.slice('--wecom-org='.length);
    }
    else if (a === '--skip-lark-archive') opts.skipLarkArchive = true;
    else if (a === '--allow-missing-dep') opts.allowMissingDep = true;
    else if (a === '--help' || a === '-h') {
      log('cyan', `用法：node scripts/sync-and-reload.mjs [--batch ${RELEASE_BATCH_IDS.join('|')}] [daily.mjs subcommand] [--dry-run] [--skip-pull] [--skip-governance] [--skip-reload] [--skip-gate [--skip-gate-reason "理由"]] [--wecom|--wecom-dry-run] [--wecom-org 机构列表] [--skip-lark-archive]`);
      log('cyan', '  --batch early：签单+理赔（premium/claims_detail，跑企微）；--batch late：报价+维修+厂牌+尾部域（不跑企微，依赖早批当天 released）。不带 --batch=全量 daily.mjs all。');
      log('cyan', '  --allow-missing-dep：应急放行晚批依赖闸（早批未 released 也发；可能混新鲜度）。');
      process.exit(0);
    } else opts.dailyArgs.push(a);
  }
  // 双批发布：--batch 覆盖 ETL 域 / 报告 / 企微 / pull code 子集（SSOT=release-batches.mjs）。
  if (opts.batch) {
    const batch = getReleaseBatch(opts.batch);
    if (opts.dailyArgs.length > 0) {
      log('yellow', `⚠ --batch ${opts.batch} 已指定 ETL 域集，忽略额外位置参数：${opts.dailyArgs.join(' ')}`);
    }
    opts.dailyArgs = [...batch.scDomains];
    opts.runReport = batch.runReport;
    opts.pullCodes = batchAllCodes(batch);
    // 企微：批次默认（早批 false / 晚批 true），除非用户显式 --wecom/--wecom-dry-run 覆盖
    if (!opts.wecomExplicit) opts.wecom = batch.runWecom;
  }
  if (opts.dailyArgs.length === 0) opts.dailyArgs = ['all'];
  // 环境变量兜底（CI / cron / 紧急运维）
  if (!opts.skipGate && (process.env.PREPUBLISH_GATE_SKIP === '1' || process.env.PREPUBLISH_GATE_SKIP === 'true')) {
    opts.skipGate = true;
    if (!opts.skipGateReason) opts.skipGateReason = process.env.PREPUBLISH_GATE_SKIP_REASON || '(env PREPUBLISH_GATE_SKIP)';
  }
  return opts;
}

function runCmd(label, cmd, args, { dryRun, cwd = ROOT_DIR, timeoutMs = 0, env = {} } = {}) {
  const envPrefix = Object.keys(env).length ? Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ') + ' ' : '';
  log('cyan', `\n▶ [${label}] ${envPrefix}${cmd} ${args.join(' ')}`);
  if (dryRun) {
    log('yellow', `  (dry-run，跳过实际执行)`);
    return Promise.resolve(0);
  }
  // 全链路耗时/断点打点（2026-07-11）：runCmd 是所有 Stage 子进程的必经收口点，在此
  // 统一记录每环节的耗时与终态（成功+失败都记）——此前台账只记成功的"点"事件，无 duration、
  // 无失败事件，当天 3 次发布失败在台账里完全不可见，事后只能翻 launchd 文本日志考古。
  const t0 = Date.now();
  // settled 哨兵：SIGKILL 杀进程后子进程的 exit 事件仍会到达（code=null），不拦住的话
  // 一次超时会记两条 failed 事件，analyze 的环节次数/失败数/总耗时全部双计。
  let settled = false;
  const record = (status, extra = {}) => {
    if (settled) return;
    settled = true;
    recordEvent({ stage: 'pipeline', step: label, status, duration_ms: Date.now() - t0, ...extra });
  };
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      log('red', `  ⏱ 超时 ${timeoutMs}ms，杀进程`);
      child.kill('SIGKILL');
      record('failed', { note: `超时 ${timeoutMs}ms 被杀` });
      reject(new Error(`${label} 超时`));
    }, timeoutMs) : null;
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) { record('success'); resolve(0); }
      else { record('failed', { exit_code: code }); reject(new Error(`${label} 退出码 ${code}`)); }
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      record('failed', { note: `spawn error: ${err.message}` });
      reject(err);
    });
  });
}

function resolveFullSnapshotDomains(dailyArgs) {
  const domains = dailyArgs
    .filter(arg => !arg.startsWith('--'))
    .flatMap(arg => arg.split(',').map(part => part.trim()).filter(Boolean))
    .map(arg => FULL_SNAPSHOT_DOMAIN_ALIASES[arg] || arg);
  if (domains.length === 0) return [];
  if (!domains.every(domain => FULL_SNAPSHOT_DOMAINS.has(domain))) return [];
  return [...new Set(domains)];
}

function buildEtlCommands(dailyArgs, fullSnapshotDomains) {
  if (fullSnapshotDomains.length > 0) {
    return fullSnapshotDomains.map(domain => ({
      label: `ETL:${domain}`,
      args: ['数据管理/daily.mjs', domain, '--no-sync', '--skip-report'],
    }));
  }
  // 报告由 Stage 1.5 统一跑一次（node 数据管理/daily.mjs report），故各 ETL 命令一律带
  // --skip-report 关掉 daily.mjs 内部的第 9 步，避免多域 / 分省 ETL 各自重复生成同一批报告。
  // ⚠ 前提：Stage 1.5 走的是 daily.mjs report（含机构级 orgs/ 循环）。若把 Stage 1.5 改回裸调
  // skill cli.py，机构级报告将无人生成 —— 这正是各机构/各部门报告长期停更的原历史根因。
  const args = dailyArgs.includes('--no-sync') ? [...dailyArgs] : [...dailyArgs, '--no-sync'];
  if (!args.includes('--skip-report')) args.push('--skip-report');
  return [{ label: 'ETL', args: ['数据管理/daily.mjs', ...args] }];
}

/**
 * 批次模式 ETL 命令：每个域一条 daily.mjs 子命令（daily.mjs 单次只处理一个 subcommand，
 * 传多个域只会跑第一个——故批次多域必须逐域调用，与 full_snapshot 多域路径同理）。
 * 一律带 --no-sync（同步统一交 Stage 3 sync-vps）+ --skip-report（报告统一交 Stage 1.5）。
 * @param {string[]} scDomains 批次 SC 默认链路 ETL 域（顺序即执行序）
 * @returns {Array<{label:string,args:string[]}>}
 */
function buildBatchEtlCommands(scDomains) {
  return scDomains.map((domain) => ({
    label: `ETL:${domain}`,
    args: ['数据管理/daily.mjs', domain, '--no-sync', '--skip-report'],
  }));
}

async function runDataReload(domains, { dryRun, healthUrl }) {
  const token = process.env.ADMIN_RELOAD_TOKEN || process.env.SYNC_AND_RELOAD_ADMIN_TOKEN;
  const payload = JSON.stringify({ domains });
  const url = `${healthUrl.replace(/\/health$/, '')}/api/admin/data/reload`;
  if (dryRun) {
    log('cyan', `\n▶ [data-reload] POST ${url} ${payload}`);
    log('yellow', '  (dry-run，full_snapshot 域将使用数据 reload，不选择 PM2 reload)');
    return true;
  }
  if (!token) {
    log('yellow', '\n⚠ 未设置 ADMIN_RELOAD_TOKEN，无法调用数据 reload，将回退 PM2 reload');
    return false;
  }
  log('cyan', `\n▶ [data-reload] POST ${url}`);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log('yellow', `  数据 reload 请求失败，将回退 PM2 reload: ${err.message}`);
    return false;
  }
  const body = await res.text();
  if (!res.ok) {
    log('yellow', `  数据 reload 失败 HTTP ${res.status}: ${body.slice(0, 200)}`);
    return false;
  }
  log('green', `  ✓ 数据 reload 完成: ${body.slice(0, 200)}`);
  return true;
}

/**
 * 前端可见性闭环验证：调用 /api/filters/options，检查 dateRange.max_date 非空。
 * 失败不抛错（返回 false），由调用方决定是否阻断。
 * 设计为软警告：不带凭据的 401/403 也算"未通过"但不阻断 — 不强依赖鉴权配置。
 */
async function verifyFrontendDataVisibility(healthUrl) {
  const baseUrl = healthUrl.replace(/\/health$/, '');
  const optionsUrl = `${baseUrl}/api/filters/options`;
  log('cyan', `\n▶ [closure-check] GET ${optionsUrl}`);
  try {
    const headers = {};
    if (process.env.FILTERS_OPTIONS_COOKIE) headers.Cookie = process.env.FILTERS_OPTIONS_COOKIE;
    if (process.env.FILTERS_OPTIONS_BEARER) headers.Authorization = `Bearer ${process.env.FILTERS_OPTIONS_BEARER}`;
    const res = await fetch(optionsUrl, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) {
      log('yellow', `  filters/options 需要鉴权（HTTP ${res.status}）；设置 FILTERS_OPTIONS_COOKIE 或 FILTERS_OPTIONS_BEARER 启用闭环验证`);
      return false;
    }
    if (!res.ok) {
      log('yellow', `  filters/options HTTP ${res.status}`);
      return false;
    }
    const body = await res.json().catch(() => null);
    const maxDate = body?.data?.dateRange?.max_date ?? body?.dateRange?.max_date ?? null;
    if (!maxDate) {
      log('yellow', `  filters/options 返回无 dateRange.max_date 字段`);
      return false;
    }
    log('green', `  ✓ 前端可见 max_date = ${maxDate}`);
    return true;
  } catch (err) {
    log('yellow', `  filters/options 请求异常：${err.message}`);
    return false;
  }
}

async function healthCheck(url, maxAttempts = 8, intervalMs = 5000) {
  for (let i = 1; i <= maxAttempts; i++) {
    log('cyan', `  健康检查 ${i}/${maxAttempts}：GET ${url}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const body = await res.text();
        log('green', `  ✓ HTTP ${res.status} ${body.slice(0, 120)}`);
        return true;
      }
      log('yellow', `  HTTP ${res.status}（重试中）`);
    } catch (e) {
      log('yellow', `  请求失败：${e.message}（重试中）`);
    }
    if (i < maxAttempts) await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// run 级打点（2026-07-11）：每次发布（无论 watcher 自动 / AI 驱动 / 人工）都在台账留
// start/end 一对事件——end 带总耗时与终态，断在哪一环节由 pipeline 级 failed 事件定位。
// trigger 判定：watcher spawn 注入 AUTO_RELEASE_TRIGGER=watcher；Claude Code 会话有
// CLAUDECODE env → ai；其余 → manual。
const RUN_T0 = Date.now();
function detectTrigger() {
  if (process.env.AUTO_RELEASE_TRIGGER === 'watcher') return 'watcher';
  if (process.env.CLAUDECODE) return 'ai';
  return 'manual';
}

async function main() {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const sshAlias = process.env.SYNC_VPS_SSH_ALIAS || 'chexian-vps-deploy';
  const healthUrl = process.env.SYNC_AND_RELOAD_HEALTH_URL || 'https://chexian.cretvalu.com/health';
  // ETL 台账 run_id：贯穿全链路（透传给 daily.mjs 子进程 + 本脚本各埋点），串起一次发布的所有事件
  process.env.ETL_RUN_ID = process.env.ETL_RUN_ID || new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  if (!opts.dryRun) {
    recordEvent({ stage: 'run', step: 'start', trigger: detectTrigger(), note: process.argv.slice(2).join(' ') || '(默认参数)' });
  }

  log('bold', '════════════════════════════════════════════════');
  log('bold', '  sync-and-reload：ETL → governance → reload → /health');
  log('bold', '════════════════════════════════════════════════');
  log('cyan', `  批次:              ${opts.batch ? `${opts.batch}（code ${opts.pullCodes.join('/')}；报告=${opts.runReport}）` : '全量（不分批）'}`);
  log('cyan', `  daily.mjs args:    ${opts.dailyArgs.join(' ')}`);
  log('cyan', `  skip pull:         ${opts.skipPull}`);
  log('cyan', `  ssh alias:         ${sshAlias}`);
  log('cyan', `  health url:        ${healthUrl}`);
  log('cyan', `  skip governance:   ${opts.skipGovernance}`);
  log('cyan', `  skip reload:       ${opts.skipReload}`);
  log('cyan', `  skip gate:         ${opts.skipGate}${opts.skipGate && opts.skipGateReason ? ` (${opts.skipGateReason})` : ''}`);
  log('cyan', `  wecom:             ${opts.wecom}${opts.wecomDryRun ? ' (dry-run)' : ''}`);
  if (opts.wecomOrg) log('cyan', `  wecom org:         ${opts.wecomOrg}`);
  log('cyan', `  dry-run:           ${opts.dryRun}`);

  // 🔴 晚批依赖早批 fail-closed：前置批当天未 released → 拒绝发布（防混新鲜度：晚批 renewal_tracker /
  // 企微依赖早批产出的 policy）。独立于 watcher 再校验一次（手动 sync-and-reload --batch late 也受护）。
  // dry-run 只告警不中止（便于查看计划）；应急 --allow-missing-dep 放行。
  if (opts.batch) {
    const batch = getReleaseBatch(opts.batch);
    if ((batch.dependsOn?.length ?? 0) > 0) {
      let releaseState = null;
      try { releaseState = JSON.parse(readFileSync(join(ROOT_DIR, '数据管理/logs/auto-release-state.json'), 'utf-8')); } catch { /* 无状态文件视为依赖未满足 */ }
      const unmet = unmetDependencies(batch, releaseState, beijingDayOf(new Date()));
      if (unmet.length > 0) {
        if (opts.allowMissingDep) {
          log('yellow', `\n⚠ 前置批未就绪（${unmet.join(',')} 今日未 released），但 --allow-missing-dep 已放行（应急：可能发布混新鲜度数据）`);
        } else if (opts.dryRun) {
          log('yellow', `\n⚠ (dry-run) 前置批未就绪（${unmet.join(',')} 今日未 released）：真实发布会 fail-closed 中止（--allow-missing-dep 可放行）`);
        } else {
          log('red', `\n❌ 前置批未就绪（${unmet.join(',')} 今日未 released），拒绝发布 ${opts.batch} 批（防混新鲜度：晚批依赖早批产出的 policy）。`);
          log('yellow', `   请先成功发布早批（node scripts/sync-and-reload.mjs --batch early），或应急 --allow-missing-dep 显式放行。`);
          if (!opts.dryRun) {
            recordEvent({ stage: 'run', step: 'end', status: 'failed', trigger: detectTrigger(), duration_ms: Date.now() - RUN_T0, note: `依赖闸拒绝：前置批 ${unmet.join(',')} 未 released` });
          }
          process.exit(1);
        }
      }
    }
  }

  // 批次模式不参与 full_snapshot 单域路径（批次 ETL 域集由 SSOT 固定）。
  const fullSnapshotDomains = opts.batch ? [] : resolveFullSnapshotDomains(opts.dailyArgs);

  // Stage 0: 拉取上游 BI 导出（VPS auto_loadbi manifest 契约 → inbox → 校验 → 分发 ETL 源目录）。
  // 失败即中止（上游断线兜底：宁可发布失败也不默默用旧数据）；full_snapshot 单域模式
  // （customer_flow / new_energy_claims 源不来自 auto_loadbi）自动跳过，避免无关发布被上游波动阻断。
  // 批次模式：透传 --batch，pull 只校验/分发该批 code 子集（早批 01/05、晚批 02/03/04）。
  if (opts.skipPull) {
    log('yellow', '\n⚠ 跳过上游 BI 导出拉取（--skip-pull），使用现有本地源文件');
  } else if (fullSnapshotDomains.length > 0) {
    log('yellow', `\n⚠ full_snapshot 单域模式（${fullSnapshotDomains.join(',')}）：源不来自 auto_loadbi，自动跳过上游拉取`);
  } else {
    const pullArgs = ['scripts/pull-bi-exports.mjs'];
    if (opts.batch) pullArgs.push('--batch', opts.batch);
    await runCmd('pull:bi-exports', 'node', pullArgs, { dryRun: opts.dryRun });
  }

  // Stage 1: ETL（先 SC 默认链路）。批次模式逐域调用（daily.mjs 单次只处理一个域）。
  const etlCommands = opts.batch
    ? buildBatchEtlCommands(opts.dailyArgs)
    : buildEtlCommands(opts.dailyArgs, fullSnapshotDomains);
  for (const step of etlCommands) {
    await runCmd(step.label, 'node', step.args, { dryRun: opts.dryRun });
  }
  // Stage 1.1: 多省 B2 分省发布——遍历注册的非 SC 省逐域跑（产物落 warehouse/validation/<省>）。
  // BRANCH_PUBLISH=1 让无源域 graceful skip 不中断；有源但转换失败 → fail-fast + 明确定位
  // （闸-1 P1-E），不让生产数据处于"部分省成功"混合状态。full_snapshot 单域模式不追加分省。
  // 批次模式：非 SC 省也只跑本批的核心域（BRANCH_PUBLISH_DOMAINS ∩ 本批 SC 域，保序）。
  const branchCoreDomains = opts.batch
    ? BRANCH_PUBLISH_DOMAINS.filter((d) => opts.dailyArgs.includes(d))
    : BRANCH_PUBLISH_DOMAINS;
  const branchSteps = fullSnapshotDomains.length === 0 ? buildBranchEtlSteps(undefined, branchCoreDomains) : [];
  if (fullSnapshotDomains.length === 0) {
    if (branchSteps.length > 0) {
      const provinces = [...new Set(branchSteps.map(s => s.env.BRANCH_CODE))].join(', ');
      log('cyan', `\n▶ 分省发布：${branchSteps.length} 个非 SC 省·域步骤（${provinces}）`);
      for (const step of branchSteps) {
        try {
          await runCmd(step.label, 'node', step.args, { dryRun: opts.dryRun, env: step.env });
        } catch (err) {
          log('red', `\n❌ 分省发布中断于 ${step.label}（有源但转换失败）：${err.message}`);
          throw err;
        }
      }
    }
  }

  // Stage 1.2: 多省 B4 跨省 claims 新鲜度巡检（ETL 后数据最新、sync 前可人工干预）。
  // 仅告警不阻断（闸-1 P0-2/P0-3）：daily.mjs freshness 即使 stale 也 exit 0；外层 try/catch 兜
  // findPython 等偶发异常，绝不让巡检中断已成功的 ETL 与后续 sync/reload。
  try {
    await runCmd('claims 新鲜度巡检', 'node', ['数据管理/daily.mjs', 'freshness'], { dryRun: opts.dryRun });
  } catch (err) {
    log('yellow', `\n⚠ claims 新鲜度巡检异常（不阻断发布）：${err.message}`);
  }
  // 健康汇总 + 企微文案接入（BACKLOG 2026-06-09-claude-530bf5）：daily.mjs freshness 子进程已把
  // hasStale 写入共享台账（recordEvent status:'warning'，同 run_id）；此处读回供本进程感知，
  // 不改变"仅告警不阻断"的设计（P0-2），只让信号在健康汇总与企微文案里可见。
  let claimsFreshnessWarning = null;
  if (!opts.dryRun) {
    try {
      const runId = process.env.ETL_RUN_ID;
      const warn = loadAllEvents()
        .filter((e) => e.run_id === runId && e.step === 'claims_freshness_patrol' && e.status === 'warning')
        .at(-1);
      if (warn) claimsFreshnessWarning = warn.error || '赔案报案截止日落后阈值';
    } catch { /* 读回失败不阻断，仅丢失文案增强 */ }
  }

  // Stage 1.45: 非 SC 省晋升（validation/<省> → current/<省>）——必须早于 Stage 1.5 报告生成。
  // 根因（2026-07-18 发布死锁）：非 SC 省 premium ETL 产物落 warehouse/validation/<省>（Stage 1.1），
  // 而晋升到 fact/policy/current/<省> 原本只发生在 Stage 3 的 sync-vps.runSxAutoPromote()——晚于
  // 报告生成（Stage 1.5）与报告 scope 新鲜度闸（Stage 1.6）。period-trend 报告的省级/机构级取数
  // 走 current/<省>（skill query.policy_glob），故报告读到的是上一周期晋升的旧 current/<省>：当四川
  // 根基准前进到新一天、而 current/<省> 还停在旧日，freshness gate 判「磁盘 latest ≠ 根基准」中止，
  // 又阻断了本能修复它的 Stage 3 晋升 → 死锁。此处提前把晋升做掉，让报告读到已晋升的当日数据。
  // 复用 sync-vps --promote-only（同一 RLS 实时核实 + sx-promote 安全内核）；与 Stage 3 的
  // runSxAutoPromote 幂等（sha256 一致自动 skip），不重复搬运。仅在本批要生成报告时才需要。
  if (opts.runReport) {
    await runCmd(
      '非 SC 省晋升（报告前）',
      'node',
      ['scripts/sync-vps.mjs', '--promote-only'],
      { dryRun: opts.dryRun }
    );
  }

  // Stage 1.5: 生成短中长期对照报告 — ETL 完成后数据最新。
  // 覆盖省级根目录 + branches/<省>/ 镜像 + 各注册省机构级 orgs/<省>/<机构>/。
  //
  // 必须走 daily.mjs report，不可直接调 skill cli.py：裸调 cli.py（不带 --org/--branch）只产出
  // 根目录省级那一份。本阶段此前正是裸调 cli.py，而所有 ETL 命令又统一带 --skip-report 关掉了
  // daily.mjs 内含机构级循环的第 9 步（runPeriodTrendReport）——两者叠加使 B004/B346 的机构级
  // 报告自落地起从未进入日常发布链：省级天天更新，各机构/各部门用户的报告却长期冻结在最后一次
  // 人工补跑 `daily.mjs report` 的日期。报告生成的唯一实现在 runPeriodTrendReport，此处不再另起
  // 影子实现（ETL 命令保留 --skip-report，避免多域/分省 ETL 各自重复生成，报告统一在此跑一次）。
  //
  // --no-sync：报告同步由 Stage 3 的 sync-vps（public_reports 任务）统一负责，不在此重复 rsync。
  // 超时放宽至 30 分钟：覆盖全部注册省 × 全部机构（当前 SC 14 + SX 11），远超原省级单次调用。
  // skill 缺失时 daily.mjs 目前只告警跳过；版本能力闸未过则 exit 1。前者由紧随其后的
  // Stage 1.6 “本批次必须刷新”约束补齐 fail-loud，后者由 runCmd 直接阻断。
  // 批次可关报告（当前早/晚批 runReport 均为 true，故两批都跑；保留开关供未来某批不需报告时用）。
  const reportGenerationStartedAt = Date.now();
  if (!opts.runReport) {
    log('yellow', `\n⚠ 批次 ${opts.batch} 不生成短中长期报告（runReport=false），跳过 Stage 1.5/1.6`);
  } else {
    await runCmd(
      'period-trend report',
      'node',
      ['数据管理/daily.mjs', 'report', '--no-sync'],
      { dryRun: opts.dryRun, timeoutMs: 30 * 60 * 1000 }
    );

    // Stage 1.6: 报告 scope 新鲜度一致性闸。daily.mjs 的逐机构生成失败目前仅告警，
    // 因此子进程 exit 0 仍不足以证明 branches/orgs 全部更新；这里按配置 SSOT 枚举全部
    // 应生成 scope，并以真实磁盘产物 + manifest 对账。任一缺失/日期不一致/本批次未刷新即非零阻断，
    // 绝不进入后续 sync-vps 把“根目录新、部分 scope 旧”的混合批次推上线。
    await runCmd(
      'report scope freshness gate',
      'node',
      [
        'scripts/report-scope-freshness-gate.mjs',
        '--not-before-epoch-ms',
        String(reportGenerationStartedAt),
      ],
      { dryRun: opts.dryRun }
    );
  }


  // Stage 1.7: 数据就绪校验（pre-sync）— ETL 完成后、sync-vps 前
  // 只跑 Parquet 重叠 / Claims 去重 / 知识库规模；同步漂移留到 Stage 3.5（sync-vps 后）
  // 原因：刚完成 ETL，本地必然领先 VPS，把"同步漂移"放在这里必然失败。
  if (opts.skipGovernance) {
    log('yellow', '\n⚠ 跳过 data-readiness pre-sync（--skip-governance）');
  } else {
    await runCmd(
      'data-readiness:pre',
      'node',
      ['scripts/check-data-readiness.mjs', '--phase=pre'],
      { dryRun: opts.dryRun }
    );
  }

  // Stage 2: governance（纯代码治理；数据状态校验见 Stage 1.7）
  if (opts.skipGovernance) {
    log('yellow', '\n⚠ 跳过 governance（--skip-governance）');
  } else {
    await runCmd('governance', 'bun', ['run', 'governance'], { dryRun: opts.dryRun });
  }

  // Stage 2.5: 发布前准入闸门（pre-publish gate）— governance 后、sync-vps 前
  // 对本地刚 ETL 出的 parquet 做指标体检（月签单保费 / 件数 / 出险金额 / 出险件数 Z-score）。
  // 任一指标统计触发即非零退出，本流程中断、不 rsync、不 reload。
  // 与 scripts/sentinel/ 互补：sentinel 是发布后监控（查 live API），gate 是发布前阻断（查本地 parquet）。
  if (opts.skipGate) {
    // 旁路审计由 prepublish-gate.mjs 自身负责（写 logs/prepublish-gate-bypass.log），
    // 这里也跑一遍 --skip-gate 让审计落地，避免直接绕过脚本写不到审计日志。
    const gateArgs = ['scripts/prepublish-gate/prepublish-gate.mjs', '--skip-gate'];
    if (opts.skipGateReason) gateArgs.push('--skip-reason', opts.skipGateReason);
    await runCmd('prepublish-gate (bypass)', 'node', gateArgs, { dryRun: opts.dryRun });
  } else {
    await runCmd(
      'prepublish-gate',
      'node',
      ['scripts/prepublish-gate/prepublish-gate.mjs'],
      { dryRun: opts.dryRun, timeoutMs: 5 * 60 * 1000 }
    );
  }

  // Stage 3: 数据同步。sync-and-reload 统一控制上传范围，daily.mjs 固定 --no-sync。
  const syncArgs = ['scripts/sync-vps.mjs', '--no-restart'];
  if (fullSnapshotDomains.length > 0) syncArgs.push('--domain', fullSnapshotDomains.join(','));
  // 多省派生域随发布同步（2026-07-07 owner 授权）：Stage 1.1 已重算非 SC 省派生域到
  // warehouse/validation/<省>，此处显式携带 SYNC_VALIDATION_BRANCHES=1 让 sync-vps 把
  // validation/<省>/<派生域> 推到生产，否则山西理赔明细/报价转化/续保追踪等页面停更。
  // 操作者显式设置该 env（含 '0'）时发布链不注入，保留人工关闭出口；判定逻辑见
  // branch-publish.mjs shouldEnableValidationBranchSync（纯函数 + 单测）。
  const syncEnv = {};
  if (shouldEnableValidationBranchSync({
    explicitEnv: process.env.SYNC_VALIDATION_BRANCHES,
    branchStepCount: branchSteps.length,
    fullSnapshotDomainCount: fullSnapshotDomains.length,
  })) {
    syncEnv.SYNC_VALIDATION_BRANCHES = '1';
  }
  if (opts.dryRun) {
    const envPrefix = syncEnv.SYNC_VALIDATION_BRANCHES ? 'SYNC_VALIDATION_BRANCHES=1 ' : '';
    log('cyan', `\n▶ [VPS sync] ${envPrefix}node ${syncArgs.join(' ')}`);
    log('yellow', '  (dry-run，跳过实际上传)');
  } else {
    await runCmd('VPS sync', 'node', syncArgs, { dryRun: false, env: syncEnv });
  }

  // Stage 3.5: 数据就绪校验（post-sync）— sync-vps 完成后，检查同步漂移
  if (opts.skipGovernance) {
    log('yellow', '\n⚠ 跳过 data-readiness post-sync（--skip-governance）');
  } else {
    await runCmd(
      'data-readiness:post',
      'node',
      ['scripts/check-data-readiness.mjs', '--phase=post'],
      { dryRun: opts.dryRun }
    );
  }

  // Stage 3.6: 归档 period-trend 报告链接到飞书多维表（可选，meta.json/manifest 缺失则 skip；失败不阻断主流程）
  // 必须在 sync-vps 后跑：sync-vps.generateManifestsLocal 写 manifest.json，URL 才指向真实可访问的 VPS 资源
  const larkMeta = join(ROOT_DIR, '数据管理/integrations/lark_bitable/state/meta.json');
  const pushReportCli = join(ROOT_DIR, '数据管理/integrations/lark_bitable/push_report.py');
  const ptManifest = join(ROOT_DIR, 'public/reports/diagnose-period-trend/manifest.json');
  if (opts.skipLarkArchive) {
    log('yellow', '\n⚠ 跳过飞书归档（--skip-lark-archive）');
  } else if (!existsSync(larkMeta)) {
    log('cyan', '\n  (跳过飞书归档：未跑 bootstrap.py 初始化 base — 跑一次后自动启用)');
  } else if (!existsSync(ptManifest)) {
    log('yellow', '\n⚠ 跳过飞书归档：manifest.json 不存在（sync-vps generateManifestsLocal 未执行？）');
  } else {
    try {
      const manifest = JSON.parse(readFileSync(ptManifest, 'utf8'));
      const latest = manifest.latest;
      const latestFile = manifest.latestFile;
      if (!latest || !latestFile) throw new Error('manifest 缺 latest/latestFile 字段');
      // period-trend 是前端静态资源：/reports/<slug>/<file>（扁平文件名含日期，无日期子目录）
      // 与 loss-development 的 /api/reports/<slug>/<date>/<entrypoint> 鉴权 API 路径不同
      const url = `https://chexian.cretvalu.com/reports/diagnose-period-trend/${latestFile}`;
      const archiveArgs = [
        pushReportCli,
        '--report-type', 'diagnose-period-trend',
        '--date', latest,
        '--url', url,
        '--report-name', latestFile,
        '--note', 'auto-archived by sync-and-reload',
      ];
      if (opts.dryRun) {
        log('cyan', `\n▶ [lark archive] python3 ${archiveArgs.join(' ')}`);
        log('yellow', '  (dry-run，跳过实际归档)');
      } else {
        await runCmd('lark archive', 'python3', archiveArgs, { dryRun: false, timeoutMs: 30000 });
      }
    } catch (err) {
      log('yellow', `⚠ 飞书归档失败（不阻断主流程）：${err.message}`);
    }
  }

  // Stage 3.8: state.db 远程备份（575d2f）— reload 前把 PAT/用户/角色权威数据备份到独立目录。
  // 失败只告警不阻塞发布（备份是兜底手段，不能反过来拦住数据上线）；
  // deployer 若无读权限可设 STATE_DB_BACKUP_ENABLED=0 关闭并由 owner 在 VPS 授权后再开。
  try {
    const backupCfg = resolveStateDbBackupConfig(process.env);
    if (!backupCfg.enabled) {
      log('yellow', '\n⚠ 跳过 state.db 备份（STATE_DB_BACKUP_ENABLED=0）');
    } else {
      const dateStamp = (beijingDayOf(new Date()) || '').replaceAll('-', '');
      const script = buildStateDbBackupScript({
        remoteDbPath: backupCfg.remoteDbPath,
        backupDir: backupCfg.backupDir,
        dateStamp,
        keep: backupCfg.keep,
      });
      await runCmd(
        'state.db backup',
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshAlias, script],
        { dryRun: opts.dryRun, timeoutMs: 60000 }
      );
    }
  } catch (err) {
    log('yellow', `\n⚠ state.db 备份失败（不阻断发布，请尽快人工排查权限/路径）：${err.message}`);
  }

  // Stage 4: full_snapshot 域优先数据 reload，其他域才 PM2 reload
  if (opts.skipReload) {
    log('yellow', '\n⚠ 跳过 reload（--skip-reload）');
  }
  let shouldRunProcessReload = !opts.skipReload;
  let shouldRunHealthCheck = !opts.skipReload;
  if (!opts.skipReload && fullSnapshotDomains.length > 0) {
    const dataReloaded = await runDataReload(fullSnapshotDomains, { dryRun: opts.dryRun, healthUrl });
    if (dataReloaded) {
      shouldRunProcessReload = false;
      log('green', '\n✅ full_snapshot 数据 reload 完成（不执行 PM2 reload）');
    }
  }
  if (shouldRunProcessReload) {
    await runCmd(
      'PM2 reload',
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshAlias, 'sudo /usr/local/bin/deploy-chexian-api reload'],
      { dryRun: opts.dryRun, timeoutMs: 180000 }
    );
  }
  // ⑤reload 埋点：reload 完成（runCmd 失败会 throw → main catch，故到此即成功）
  if (!opts.skipReload && !opts.dryRun) {
    recordEvent({ stage: 'reload', step: shouldRunProcessReload ? 'pm2_reload' : 'data_reload', status: 'success' });
  }

  // Stage 4: 健康检查 + 闭环验证 + 稳定性二次确认
  if (opts.dryRun) {
    log('yellow', '  (dry-run，跳过健康检查)');
  } else if (!shouldRunHealthCheck) {
    log('yellow', '  (skip-reload，跳过健康检查)');
  } else {
    log('cyan', '\n▶ [health-check] 等待 5s 让进程稳定');
    await new Promise(r => setTimeout(r, 5000));
    const healthy = await healthCheck(healthUrl);
    if (!healthy) {
      log('red', '\n❌ 健康检查失败！PM2 可能未正常启动');
      log('yellow', '  排查：ssh ' + sshAlias + ' "sudo /usr/local/bin/deploy-chexian-api logs 50"');
      // process.exit 不走 main().catch，须在此补记 run end，否则健康检查失败在台账里"无终态"
      recordEvent({ stage: 'run', step: 'end', status: 'failed', trigger: detectTrigger(), duration_ms: Date.now() - RUN_T0, note: '健康检查失败（/health 不通）' });
      process.exit(1);
    }
    // 闭环验证：前端可见性（filters/options 必须能返回最新 max_date）
    // — /health 只验进程活着，不验数据加载完整；用 filters/options 看后端能否给出 dateRange
    const closureOk = await verifyFrontendDataVisibility(healthUrl);
    if (!closureOk) {
      log('yellow', '⚠ filters/options 闭环验证未通过（不阻断，但请人工核对数据可见性）');
    }
    // 稳定性二次确认：等 30s 让进程跑过启动期，再查一次 /health（jlist 需要 ssh + sudo，
    // 这里只做 HTTP 二次探测：如果 30s 内进程崩了，第二次 /health 会失败）
    log('cyan', '\n▶ [stability-recheck] 等待 30s 后二次探测 /health');
    await new Promise(r => setTimeout(r, 30000));
    const stillHealthy = await healthCheck(healthUrl, 2, 3000);
    if (!stillHealthy) {
      log('red', '\n❌ 稳定性二次校验失败：进程在启动 30s 内崩溃，疑似 OOM/启动后崩溃');
      log('yellow', '  排查：ssh ' + sshAlias + ' "sudo /usr/local/bin/deploy-chexian-api logs 100"');
      // 同上：exit 旁路必须自带 run end 打点
      recordEvent({ stage: 'run', step: 'end', status: 'failed', trigger: detectTrigger(), duration_ms: Date.now() - RUN_T0, note: '稳定性二次校验失败（启动 30s 内崩溃）' });
      process.exit(1);
    }
    log('green', '  ✓ 30s 稳定性二次校验通过');
    // ⑥health + ⑦frontend 埋点：回读 VPS 当前对外数据版本（= 前端将消费的版本，见设计诚实边界）
    let dataVersion = null;
    try {
      const resp = await fetch(`${healthUrl.replace(/\/health$/, '')}/api/data/version`);
      if (resp.ok) {
        const dv = await resp.json();
        dataVersion = dv?.etlDate || dv?.buildTime || null;
      }
    } catch { /* 回读失败不阻断 */ }
    recordEvent({ stage: 'health', step: 'health_check', status: 'success', data_version: dataVersion });
    recordEvent({ stage: 'frontend', step: 'data_version_readback', status: 'success', data_version: dataVersion, note: 'VPS 当前对外版本=前端将消费版本' });
  }

  // Stage 4.5: 静态报告同步 + manifest 生成 —— 已统一下沉到 Stage 3 的 sync-vps.mjs
  //（public_reports 任务 rsync 报告 + generateManifestsLocal 本地 pull→生成→push）。
  // 此处原本重复一遍 rsync + 一份「VPS 端 node 生成 manifest」，但 VPS deployer 无 node，
  // 那份永远静默失败；且与 Stage 3 完全冗余。删除以消除重复与失效代码路径。

  // Stage 5: 企业微信同步（显式开关）
  // 5 个脚本独立 webhook、互不依赖，并行执行（Promise.allSettled）。
  // 🔴 非阻断策略（PR #1158 评审 F1）：企微失败**不**抛错、不让本进程非零退出——否则 watcher
  // 会把本批（现为早批）标 failed → 晚批 fail-closed 连坐拒发 + 早批 ETL/reload 整链重跑。
  // 失败改走独立告警（标记文件 → watcher 通知）+ 独立重试（node scripts/wecom-sync.mjs）。
  // 策略 SSOT = scripts/lib/wecom-sync-tasks.mjs evaluateWecomOutcome（单测锁定恒不阻断）。
  let wecomOutcome = null;
  if (opts.wecom) {
    if (claimsFreshnessWarning) {
      log('yellow', `\n⚠ claims 报案截止日落后 N 天：${claimsFreshnessWarning}（见 Stage 1.2 新鲜度巡检；不阻断本次企微同步）`);
    }
    // 任务清单 + 到期停推闸（5-7 月续保 2 表 2026-07-31 后自动退役）SSOT：wecom-sync-tasks.mjs
    const todayBeijing = beijingDayOf(new Date());
    const allWecomTasks = buildWecomTasks({ dryRun: opts.wecomDryRun, org: opts.wecomOrg });
    const { active: activeWecomTasks, retired } = filterActiveWecomTasks(allWecomTasks, todayBeijing);
    for (const task of retired) {
      log('yellow', `  ⏹ 跳过「${task.label}」：已过停推日 ${task.retireAfterBeijingDay}（北京今天 ${todayBeijing}），该表已退役。`);
    }

    log('cyan', `\n▶ [WeCom] 并行启动 ${activeWecomTasks.length}/${allWecomTasks.length} 个智能表格同步任务`);
    const results = await Promise.allSettled(
      activeWecomTasks.map(task =>
        runCmd(task.label, 'python3', task.args, { dryRun: opts.dryRun, timeoutMs: task.timeoutMs })
      )
    );
    const failures = summarizeWecomFailures(results, activeWecomTasks);
    wecomOutcome = evaluateWecomOutcome(failures);
    // 标记文件：失败写清单、成功清空（幂等覆盖当天态）。watcher 发布成功后读它做独立告警；
    // dry-run（全局或企微级）不落盘，避免演练污染真实告警态。
    if (!opts.dryRun && !opts.wecomDryRun) {
      try {
        writeFileSync(join(ROOT_DIR, WECOM_ALERT_MARKER_RELPATH), JSON.stringify({
          beijingDay: todayBeijing,
          failures,
          updatedAt: new Date().toISOString(),
        }, null, 2) + '\n');
      } catch (e) {
        log('yellow', `  ⚠ 企微告警标记写入失败（不阻断）：${e.message}`);
      }
    }
    if (failures.length > 0) {
      for (const f of failures) {
        log('red', `  ❌ ${f.label}: ${f.reason}`);
      }
      log('yellow', `⚠ 企微同步 ${failures.length}/${activeWecomTasks.length} 个任务失败——按非阻断策略继续（核心数据发布成功不受影响，晚批不被连坐）。`);
      log('yellow', '  独立重试（只跑企微，不重跑 ETL/reload）：node scripts/wecom-sync.mjs');
    } else {
      log('green', `  ✓ WeCom 全部 ${activeWecomTasks.length} 个任务完成`);
    }
  }

  if (!opts.dryRun) {
    recordEvent({
      stage: 'run', step: 'end', status: 'success', trigger: detectTrigger(), duration_ms: Date.now() - RUN_T0,
      ...(wecomOutcome?.alertNeeded ? { note: wecomOutcome.note } : {}),
    });
  }
  log('green', `\n✅ 全流程完成（ETL → governance → reload → /health${opts.wecom ? ' → WeCom' : ''}）`);
  if (claimsFreshnessWarning) {
    log('yellow', `⚠ 健康汇总：claims 报案截止日新鲜度告警未解除——${claimsFreshnessWarning}`);
  }

  // 全流程结束：从台账 JSONL 重渲染中文报告（数据流转台账.md）
  try {
    const mdPath = join(LEDGER_ROOT, '数据流转台账.md');
    writeAllReport(mdPath);
    log('green', `  📊 数据流转台账已刷新 → ${mdPath}`);
  } catch (e) {
    log('yellow', `  ⚠ 台账报告刷新失败（不阻断）：${e.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
  // 断点入账：err.message 含失败环节 label（runCmd reject 消息），run end 事件据此定位断在哪一环。
  // dry-run 不打点（与 run start/end success 的守护对称，否则 dry-run 失败会留下无 start 配对的孤儿事件）；
  // opts 不在本作用域，与 parseArgs 同源地看 argv。
  if (!process.argv.includes('--dry-run')) {
    recordEvent({ stage: 'run', step: 'end', status: 'failed', trigger: detectTrigger(), duration_ms: Date.now() - RUN_T0, note: err.message });
  }
  log('red', `\n❌ 流程中断：${err.message}`);
  log('yellow', '提示：单步重试可使用：');
  log('yellow', '  node 数据管理/daily.mjs <subcommand>');
  log('yellow', '  bun run governance');
  log('yellow', '  ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api reload"');
  process.exit(1);
  });
}

export {
  buildEtlCommands,
  buildBatchEtlCommands,
  parseArgs,
  runDataReload,
  resolveFullSnapshotDomains,
};
