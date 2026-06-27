#!/usr/bin/env node
/**
 * 全流程入口：ETL → governance → PM2 reload → 健康检查 → 可选企微同步
 *
 * 设计哲学：daily.mjs 单一职责（ETL + rsync），本脚本负责"上线变更"全流程。
 *
 * 流程（严格顺序）：
 *   1.   node 数据管理/daily.mjs <subcommand>                （默认 all；可传 premium/claims_detail 等）
 *   1.5. python3 ~/.claude/skills/diagnose-period-trend/lib/cli.py --view v1  （生成驾驶舱 HTML）
 *   2.   bun run governance                                   （24+ 项校验，失败则中止）
 *   3.   ssh sudo /usr/local/bin/deploy-chexian-api reload    （pm2 delete + start，可恢复 errored）
 *   4.   curl https://chexian.cretvalu.com/health             （重试 8 次 / 5 秒间隔）
 *   4.5. rsync public/reports/ → VPS frontend/dist/reports/   （Nginx 静态托管）
 *   5.   可选：批量同步企微机构续保追踪表 + 续保5月表 + 邮政经代签单表
 *
 * 使用：
 *   node scripts/sync-and-reload.mjs                        # daily.mjs all
 *   node scripts/sync-and-reload.mjs premium                # 仅保费域
 *   node scripts/sync-and-reload.mjs --skip-governance      # 跳过 governance（不推荐）
 *   node scripts/sync-and-reload.mjs --skip-reload          # 仅 ETL+governance，不重启
 *   node scripts/sync-and-reload.mjs --wecom                # 线上健康后同步企微机构续保表 + 续保5月表 + 邮政经代表
 *   node scripts/sync-and-reload.mjs --wecom-dry-run        # 只打印企微同步计划
 *   node scripts/sync-and-reload.mjs --wecom --wecom-org 新都,资阳
 *   node scripts/sync-and-reload.mjs --dry-run              # 仅打印计划，不执行
 *
 * 任一阶段失败立即退出且告知排查方向，不进入后续阶段。
 *
 * 环境变量：
 *   SYNC_VPS_SSH_ALIAS         （默认 chexian-vps-deploy）
 *   SYNC_AND_RELOAD_HEALTH_URL （默认 https://chexian.cretvalu.com/health）
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import os from 'os';
import { recordEvent, LEDGER_PATH } from './etl-ledger/record.mjs';
import { writeReport } from './etl-ledger/render.mjs';

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
    skipGovernance: false,
    skipReload: false,
    skipGate: false,
    skipGateReason: '',
    wecom: false,
    wecomDryRun: false,
    wecomOrg: null,
    skipLarkArchive: false,
    dailyArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
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
    else if (a === '--wecom') opts.wecom = true;
    else if (a === '--wecom-dry-run') {
      opts.wecom = true;
      opts.wecomDryRun = true;
    }
    else if (a === '--wecom-org') {
      opts.wecomOrg = argv[++i];
      if (!opts.wecomOrg) throw new Error('--wecom-org 需要机构列表，例如：--wecom-org 新都,资阳');
    }
    else if (a.startsWith('--wecom-org=')) {
      opts.wecomOrg = a.slice('--wecom-org='.length);
    }
    else if (a === '--skip-lark-archive') opts.skipLarkArchive = true;
    else if (a === '--help' || a === '-h') {
      log('cyan', '用法：node scripts/sync-and-reload.mjs [daily.mjs subcommand] [--dry-run] [--skip-governance] [--skip-reload] [--skip-gate [--skip-gate-reason "理由"]] [--wecom|--wecom-dry-run] [--wecom-org 机构列表] [--skip-lark-archive]');
      process.exit(0);
    } else opts.dailyArgs.push(a);
  }
  if (opts.dailyArgs.length === 0) opts.dailyArgs = ['all'];
  // 环境变量兜底（CI / cron / 紧急运维）
  if (!opts.skipGate && (process.env.PREPUBLISH_GATE_SKIP === '1' || process.env.PREPUBLISH_GATE_SKIP === 'true')) {
    opts.skipGate = true;
    if (!opts.skipGateReason) opts.skipGateReason = process.env.PREPUBLISH_GATE_SKIP_REASON || '(env PREPUBLISH_GATE_SKIP)';
  }
  return opts;
}

function runCmd(label, cmd, args, { dryRun, cwd = ROOT_DIR, timeoutMs = 0 } = {}) {
  log('cyan', `\n▶ [${label}] ${cmd} ${args.join(' ')}`);
  if (dryRun) {
    log('yellow', `  (dry-run，跳过实际执行)`);
    return Promise.resolve(0);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      log('red', `  ⏱ 超时 ${timeoutMs}ms，杀进程`);
      child.kill('SIGKILL');
      reject(new Error(`${label} 超时`));
    }, timeoutMs) : null;
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(0);
      else reject(new Error(`${label} 退出码 ${code}`));
    });
    child.on('error', reject);
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
  // sync-and-reload 自有 period-trend 报告生成阶段（Stage 1.5），daily.mjs 内部跳过避免重复
  const args = dailyArgs.includes('--no-sync') ? [...dailyArgs] : [...dailyArgs, '--no-sync'];
  if (!args.includes('--skip-report')) args.push('--skip-report');
  return [{ label: 'ETL', args: ['数据管理/daily.mjs', ...args] }];
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

async function main() {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  const sshAlias = process.env.SYNC_VPS_SSH_ALIAS || 'chexian-vps-deploy';
  const healthUrl = process.env.SYNC_AND_RELOAD_HEALTH_URL || 'https://chexian.cretvalu.com/health';
  // ETL 台账 run_id：贯穿全链路（透传给 daily.mjs 子进程 + 本脚本各埋点），串起一次发布的所有事件
  process.env.ETL_RUN_ID = process.env.ETL_RUN_ID || new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

  log('bold', '════════════════════════════════════════════════');
  log('bold', '  sync-and-reload：ETL → governance → reload → /health');
  log('bold', '════════════════════════════════════════════════');
  log('cyan', `  daily.mjs args:    ${opts.dailyArgs.join(' ')}`);
  log('cyan', `  ssh alias:         ${sshAlias}`);
  log('cyan', `  health url:        ${healthUrl}`);
  log('cyan', `  skip governance:   ${opts.skipGovernance}`);
  log('cyan', `  skip reload:       ${opts.skipReload}`);
  log('cyan', `  skip gate:         ${opts.skipGate}${opts.skipGate && opts.skipGateReason ? ` (${opts.skipGateReason})` : ''}`);
  log('cyan', `  wecom:             ${opts.wecom}${opts.wecomDryRun ? ' (dry-run)' : ''}`);
  if (opts.wecomOrg) log('cyan', `  wecom org:         ${opts.wecomOrg}`);
  log('cyan', `  dry-run:           ${opts.dryRun}`);

  const fullSnapshotDomains = resolveFullSnapshotDomains(opts.dailyArgs);

  // Stage 1: ETL
  for (const step of buildEtlCommands(opts.dailyArgs, fullSnapshotDomains)) {
    await runCmd(step.label, 'node', step.args, { dryRun: opts.dryRun });
  }

  // Stage 1.5: 生成周期趋势诊断报告（V1 驾驶舱）——ETL 完成后数据最新
  const skillCli = join(os.homedir(), '.claude/skills/diagnose-period-trend/lib/cli.py');
  if (existsSync(skillCli)) {
    await runCmd(
      'period-trend report',
      'python3',
      [skillCli, '--view', 'all', '--project-root', ROOT_DIR],
      { dryRun: opts.dryRun, timeoutMs: 3 * 60 * 1000 }
    );
  } else {
    log('yellow', `\n⚠ 跳过报告生成（技能文件不存在：${skillCli}）`);
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
  if (opts.dryRun) {
    log('cyan', `\n▶ [VPS sync] node ${syncArgs.join(' ')}`);
    log('yellow', '  (dry-run，跳过实际上传)');
  } else {
    await runCmd('VPS sync', 'node', syncArgs, { dryRun: false });
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
  // 三个脚本独立 webhook、互不依赖，并行执行；任一失败仍记录但不中断其他（Promise.allSettled）。
  // 失败统一在 Stage 5 末尾抛出，便于人工排查。
  if (opts.wecom) {
    const orgRenewalArgs = ['数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py'];
    if (!opts.wecomDryRun) orgRenewalArgs.push('--execute');
    if (opts.wecomOrg) orgRenewalArgs.push('--org', opts.wecomOrg);

    const renewalMayArgs = [
      '数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py',
      'sync',
    ];
    if (!opts.wecomDryRun) renewalMayArgs.push('--execute');

    const postalArgs = [
      '数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py',
      '--instance',
      '数据管理/integrations/wecom_smartsheet/instances/postal-policy-since-20260420.yaml',
      '--mode',
      'sync',
    ];
    if (opts.wecomDryRun) postalArgs.push('--dry-run');

    const wecomTasks = [
      {
        label: opts.wecomDryRun ? 'WeCom renewal dry-run' : 'WeCom renewal sync',
        args: orgRenewalArgs,
        timeoutMs: 90 * 60 * 1000,
      },
      {
        label: opts.wecomDryRun ? 'WeCom 电销5-7月续保 dry-run' : 'WeCom 电销5-7月续保 sync',
        args: renewalMayArgs,
        timeoutMs: 30 * 60 * 1000,
      },
      {
        label: opts.wecomDryRun ? 'WeCom postal dry-run' : 'WeCom postal sync',
        args: postalArgs,
        timeoutMs: 30 * 60 * 1000,
      },
    ];

    log('cyan', `\n▶ [WeCom] 并行启动 ${wecomTasks.length} 个智能表格同步任务`);
    const results = await Promise.allSettled(
      wecomTasks.map(task =>
        runCmd(task.label, 'python3', task.args, { dryRun: opts.dryRun, timeoutMs: task.timeoutMs })
      )
    );
    const failures = results
      .map((r, i) => ({ r, label: wecomTasks[i].label }))
      .filter(({ r }) => r.status === 'rejected');
    if (failures.length > 0) {
      for (const { r, label } of failures) {
        log('red', `  ❌ ${label}: ${r.reason?.message || r.reason}`);
      }
      throw new Error(`WeCom 同步存在 ${failures.length}/${wecomTasks.length} 个失败任务`);
    }
    log('green', `  ✓ WeCom 全部 ${wecomTasks.length} 个任务完成`);
  }

  log('green', `\n✅ 全流程完成（ETL → governance → reload → /health${opts.wecom ? ' → WeCom' : ''}）`);

  // 全流程结束：从台账 JSONL 重渲染中文报告（数据流转台账.md）
  try {
    const mdPath = join(dirname(LEDGER_PATH), '数据流转台账.md');
    writeReport(LEDGER_PATH, mdPath);
    log('green', `  📊 数据流转台账已刷新 → ${mdPath}`);
  } catch (e) {
    log('yellow', `  ⚠ 台账报告刷新失败（不阻断）：${e.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
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
  parseArgs,
  runDataReload,
  resolveFullSnapshotDomains,
};
