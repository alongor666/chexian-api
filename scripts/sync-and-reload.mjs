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
import { generateReportsManifests } from './gen-reports-manifest.mjs';

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
    wecom: false,
    wecomDryRun: false,
    wecomOrg: null,
    dailyArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--skip-governance') opts.skipGovernance = true;
    else if (a === '--skip-reload') opts.skipReload = true;
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
    else if (a === '--help' || a === '-h') {
      log('cyan', '用法：node scripts/sync-and-reload.mjs [daily.mjs subcommand] [--dry-run] [--skip-governance] [--skip-reload] [--wecom|--wecom-dry-run] [--wecom-org 机构列表]');
      process.exit(0);
    } else opts.dailyArgs.push(a);
  }
  if (opts.dailyArgs.length === 0) opts.dailyArgs = ['all'];
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
  const args = dailyArgs.includes('--no-sync') ? [...dailyArgs] : [...dailyArgs, '--no-sync'];
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

  log('bold', '════════════════════════════════════════════════');
  log('bold', '  sync-and-reload：ETL → governance → reload → /health');
  log('bold', '════════════════════════════════════════════════');
  log('cyan', `  daily.mjs args:    ${opts.dailyArgs.join(' ')}`);
  log('cyan', `  ssh alias:         ${sshAlias}`);
  log('cyan', `  health url:        ${healthUrl}`);
  log('cyan', `  skip governance:   ${opts.skipGovernance}`);
  log('cyan', `  skip reload:       ${opts.skipReload}`);
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

  // Stage 1.7: 数据就绪校验（数据状态质量，已从代码门禁 governance 解耦至此）
  // ETL 完成后、发布前校验：Parquet 重叠 / Claims 去重 / 知识库规模 / 同步漂移。
  if (opts.skipGovernance) {
    log('yellow', '\n⚠ 跳过 data-readiness（--skip-governance）');
  } else {
    await runCmd('data-readiness', 'node', ['scripts/check-data-readiness.mjs'], { dryRun: opts.dryRun });
  }

  // Stage 2: governance（纯代码治理；数据状态校验见 Stage 1.7）
  if (opts.skipGovernance) {
    log('yellow', '\n⚠ 跳过 governance（--skip-governance）');
  } else {
    await runCmd('governance', 'bun', ['run', 'governance'], { dryRun: opts.dryRun });
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

  // Stage 4: 健康检查
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
  }

  // Stage 4.5: 同步静态报告到 VPS（Nginx 直接 serve）
  if (!opts.skipReload) {
    const frontendDistDir = process.env.SYNC_VPS_FRONTEND_DIST || '/var/www/chexian/frontend/dist';
    const localReportsDir = join(ROOT_DIR, 'public/reports/');
    if (existsSync(localReportsDir)) {
      // 同步前刷新 manifest.json，让前端能感知“哪几期报告真实存在”
      // （ETL 推进了 etlDate 但报告未重新生成时，前端据此提醒“数据未更新”而非打开空白页）
      if (opts.dryRun) {
        log('cyan', '\n▶ [reports-manifest] node scripts/gen-reports-manifest.mjs  (dry-run，跳过)');
      } else {
        const summaries = generateReportsManifests(join(ROOT_DIR, 'public/reports'));
        for (const s of summaries) {
          if (s.skipped) {
            log('yellow', `  ⚠ manifest ${s.slug}: 本地无报告文件，跳过（保留既有 manifest，不清空远端）`);
          } else {
            log('green', `  ✓ manifest ${s.slug}: ${s.count} 期，最新 ${s.latest ?? '（无）'}`);
          }
        }
      }
      await runCmd(
        'sync reports → VPS',
        'rsync',
        ['-azv', '-e', 'ssh', localReportsDir, `${sshAlias}:${frontendDistDir}/reports/`],
        { dryRun: opts.dryRun, timeoutMs: 60 * 1000 }
      );
    } else {
      log('yellow', '\n⚠ 跳过报告同步（public/reports/ 不存在）');
    }
  }

  // Stage 5: 企业微信同步（显式开关）
  if (opts.wecom) {
    const wecomArgs = ['数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py'];
    if (!opts.wecomDryRun) wecomArgs.push('--execute');
    if (opts.wecomOrg) wecomArgs.push('--org', opts.wecomOrg);
    await runCmd(
      opts.wecomDryRun ? 'WeCom renewal dry-run' : 'WeCom renewal sync',
      'python3',
      wecomArgs,
      { dryRun: opts.dryRun, timeoutMs: 90 * 60 * 1000 }
    );

    const renewalMayArgs = [
      '数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py',
      'sync',
    ];
    if (!opts.wecomDryRun) renewalMayArgs.push('--execute');
    await runCmd(
      opts.wecomDryRun ? 'WeCom 电销5-7月续保 dry-run' : 'WeCom 电销5-7月续保 sync',
      'python3',
      renewalMayArgs,
      { dryRun: opts.dryRun, timeoutMs: 30 * 60 * 1000 }
    );

    const postalArgs = [
      '数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py',
      '--instance',
      '数据管理/integrations/wecom_smartsheet/instances/postal-policy-since-20260420.yaml',
      '--mode',
      'sync',
    ];
    if (opts.wecomDryRun) postalArgs.push('--dry-run');
    await runCmd(
      opts.wecomDryRun ? 'WeCom postal dry-run' : 'WeCom postal sync',
      'python3',
      postalArgs,
      { dryRun: opts.dryRun, timeoutMs: 30 * 60 * 1000 }
    );
  }

  log('green', `\n✅ 全流程完成（ETL → governance → reload → /health${opts.wecom ? ' → WeCom' : ''}）`);
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
