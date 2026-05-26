#!/usr/bin/env node
/**
 * 全流程入口：ETL → governance → PM2 reload → 健康检查 → 可选企微同步
 *
 * 设计哲学：daily.mjs 单一职责（ETL + rsync），本脚本负责"上线变更"全流程。
 *
 * 流程（严格顺序）：
 *   1. node 数据管理/daily.mjs <subcommand>      （默认 all；可传 premium/claims_detail 等）
 *   2. bun run governance                         （24+ 项校验，失败则中止）
 *   3. ssh sudo /usr/local/bin/deploy-chexian-api reload  （pm2 delete + start，可恢复 errored）
 *   4. curl https://chexian.cretvalu.com/health   （重试 8 次 / 5 秒间隔）
 *   5. 可选：批量同步企微机构续保追踪表 + 续保5月表 + 邮政经代签单表
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
import { fileURLToPath } from 'url';

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

  // Stage 1: ETL
  await runCmd('ETL', 'node', ['数据管理/daily.mjs', ...opts.dailyArgs], { dryRun: opts.dryRun });

  // Stage 2: governance
  if (opts.skipGovernance) {
    log('yellow', '\n⚠ 跳过 governance（--skip-governance）');
  } else {
    await runCmd('governance', 'bun', ['run', 'governance'], { dryRun: opts.dryRun });
  }

  // Stage 3: PM2 reload（reload = pm2 delete + start，可恢复 errored）
  if (opts.skipReload) {
    log('yellow', '\n⚠ 跳过 PM2 reload（--skip-reload）');
    log('green', '\n✅ ETL+governance 完成（未重启 PM2）');
    return;
  }
  await runCmd(
    'PM2 reload',
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshAlias, 'sudo /usr/local/bin/deploy-chexian-api reload'],
    { dryRun: opts.dryRun, timeoutMs: 60000 }
  );

  // Stage 4: 健康检查
  if (opts.dryRun) {
    log('yellow', '  (dry-run，跳过健康检查)');
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

main().catch(err => {
  log('red', `\n❌ 流程中断：${err.message}`);
  log('yellow', '提示：单步重试可使用：');
  log('yellow', '  node 数据管理/daily.mjs <subcommand>');
  log('yellow', '  bun run governance');
  log('yellow', '  ssh chexian-vps-deploy "sudo /usr/local/bin/deploy-chexian-api reload"');
  process.exit(1);
});
