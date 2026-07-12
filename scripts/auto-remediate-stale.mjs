#!/usr/bin/env node
/**
 * 发布停更「自动接手」执行壳（Mac 侧 · BACKLOG 2026-07-12-claude-966ae7 · 审计 FIND-001）
 *
 * 数据巡检（VPS）负责发现停更 + 告警；本脚本（Mac，launchd 定时拉起）负责「自动接手」——
 * 把 FIND-001 从「只告警」升级为「分级自主处置」。release:daily 依赖 Mac 的 ETL 管道，
 * 只能在 Mac 跑，故接手方在 Mac。
 *
 * 分级自主（用户 2026-07-12 决策 · 决策逻辑见 数据管理/lib/auto-remediate-decision.mjs）：
 *   Tier 1（轻风险自处置）：今日发布 failed/missed → 自动重跑一次 release:daily。
 *     成功 → 数据恢复 → 回帖群，标记 recovered。
 *   Tier 2（重风险待确认）：Tier 1 仍失败 → 诊断失败类别（governance/ETL/网络/上游）→
 *     把原因 + 建议命令回帖群，标记 tier2-awaiting，**绝不自动改配置/密钥/生产数据**。
 *   幂等：每北京日只接手一次（auto-remediate-state.json），防死循环。
 *
 * 用法：
 *   node scripts/auto-remediate-stale.mjs --once        # 探测一次，按决策执行（launchd 用）
 *   node scripts/auto-remediate-stale.mjs --dry-run      # 只决策 + 打印，不跑 release 不发通知
 *   node scripts/auto-remediate-stale.mjs --status       # 今日发布态 + 接手态
 *   node scripts/auto-remediate-stale.mjs --install-launchd | --uninstall-launchd
 *
 * ⚠️ 必须在主仓跑（release:daily 依赖 Mac 主仓管道）；worktree 内 fail-closed 拒绝。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beijingDayOf } from '../数据管理/lib/bi-export-pull.mjs';
import { classifyReleaseFailure, decideRemediation, nextRemediateState } from '../数据管理/lib/auto-remediate-decision.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');
const LOGS_DIR = join(PROJECT_ROOT, '数据管理', 'logs');
const RELEASE_STATE_PATH = join(LOGS_DIR, 'auto-release-state.json');
const RELEASE_LOCK_PATH = join(LOGS_DIR, '.auto-release.lock'); // auto-release-daily 运行时持有，接手前查它防并发
const REMEDIATE_STATE_PATH = join(LOGS_DIR, 'auto-remediate-state.json');
const LAST_FAILURE_LOG = join(LOGS_DIR, 'auto-remediate-last-failure.log');
const LOG_PATH = join(LOGS_DIR, 'auto-remediate.log');
const LAUNCHD_LABEL = 'com.chexian.auto-remediate-stale';
const LAUNCHD_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

// launchd 环境 PATH 极简；bun/ssh/rsync/python3/lark-cli 都在这些前缀下（与 auto-release-daily 同）
const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.bun', 'bin')];
process.env.PATH = [...EXTRA_PATHS, ...(process.env.PATH || '').split(':')].filter(Boolean).join(':');

// 飞书目标群：默认「AI 赋能车险经营」，与 auto-release 告警同群（用户 2026-07-12 拍板）
const DEFAULT_LARK_CHAT_ID = 'oc_07c20f22eb5828000452a2be8ae26df0';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(line + '\n');
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(LOG_PATH, line + '\n');
  } catch { /* 日志落盘尽力而为 */ }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeRemediateState(state) {
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(REMEDIATE_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

/** 推飞书群（lark-cli --as bot，与 auto-release-daily 同款；失败只告警不中止）。 */
function notify(text) {
  log(`🔔 通知群：${text.replace(/\n/g, ' / ')}`);
  const chatId = process.env.AUTO_RELEASE_LARK_CHAT_ID || DEFAULT_LARK_CHAT_ID;
  const r = spawnSync('lark-cli', ['im', '+messages-send', '--as', 'bot', '--chat-id', chatId, '--text', text, '--json'], {
    encoding: 'utf-8',
    timeout: 30_000,
  });
  if (r.error || r.status !== 0) {
    log(`⚠ 飞书通知失败：${r.error?.message || (r.stderr || '').trim().slice(0, 300)}`);
  }
}

function isWorktreeCheckout() {
  try {
    return statSync(join(PROJECT_ROOT, '.git')).isFile(); // linked worktree 的 .git 是指针文件
  } catch {
    return false;
  }
}

/** 跑 release:daily，返回 {ok, log}。 */
function runReleaseDaily() {
  log('▶ Tier 1 自处置：重跑 bun run release:daily');
  const r = spawnSync('bun', ['run', 'release:daily'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30 * 60_000, // 30 分钟上限
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  return { ok: r.status === 0, log: out };
}

function statusReport() {
  const rel = readJson(RELEASE_STATE_PATH);
  const rem = readJson(REMEDIATE_STATE_PATH);
  log(`发布态：${rel ? JSON.stringify(rel) : '（无）'}`);
  log(`接手态：${rem ? JSON.stringify(rem) : '（无）'}`);
}

function installLaunchd() {
  if (isWorktreeCheckout()) {
    log('❌ 拒绝在 worktree 安装 launchd（release:daily 依赖主仓管道，须主仓安装）');
    process.exit(1);
  }
  const interval = parseInt(process.env.AUTO_REMEDIATE_INTERVAL_SEC || '', 10) || 1800; // 默认 30 分钟
  const nodeBin = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${nodeBin}</string><string>${__filename}</string><string>--once</string></array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>StandardOutPath</key><string>${join(LOGS_DIR, 'auto-remediate.launchd.log')}</string>
  <key>StandardErrorPath</key><string>${join(LOGS_DIR, 'auto-remediate.launchd.log')}</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
`;
  mkdirSync(dirname(LAUNCHD_PLIST), { recursive: true });
  writeFileSync(LAUNCHD_PLIST, plist);
  spawnSync('launchctl', ['unload', LAUNCHD_PLIST], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['load', LAUNCHD_PLIST], { encoding: 'utf-8' });
  if (r.status !== 0) {
    log(`❌ launchctl load 失败：${(r.stderr || '').trim()}`); process.exit(1);
  }
  log(`✅ 已安装 launchd 定时器（每 ${interval}s 探测一次）：${LAUNCHD_PLIST}`);
}

function uninstallLaunchd() {
  spawnSync('launchctl', ['unload', LAUNCHD_PLIST], { stdio: 'ignore' });
  log(`✅ 已卸载 launchd 定时器：${LAUNCHD_PLIST}`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--install-launchd')) return installLaunchd();
  if (argv.includes('--uninstall-launchd')) return uninstallLaunchd();
  if (argv.includes('--status')) return statusReport();

  const dryRun = argv.includes('--dry-run');
  if (isWorktreeCheckout()) {
    log('❌ 拒绝在 worktree 执行接手（release:daily 依赖主仓管道，须主仓运行）');
    process.exit(1);
  }

  const todayBeijing = beijingDayOf(new Date());
  const releaseState = readJson(RELEASE_STATE_PATH);
  const remediateState = readJson(REMEDIATE_STATE_PATH);
  const maxTier1 = parseInt(process.env.AUTO_REMEDIATE_MAX_TIER1 || '', 10) || undefined;
  const decision = decideRemediation({ releaseState, remediateState, todayBeijing, maxTier1 });
  log(`决策：${decision.action} —— ${decision.reason}`);

  if (decision.action === 'skip') return undefined;
  if (dryRun) {
    log('（dry-run，跳过实际执行与通知）');
    return undefined;
  }

  const nowISO = new Date().toISOString();

  if (decision.action === 'tier1-retry') {
    // 并发闸（第二道）：auto-release 正持锁运行 → 本 tick 让路，下轮再接手，绝不并发跑 release:daily
    if (existsSync(RELEASE_LOCK_PATH)) {
      log('⏸ auto-release 正在运行（.auto-release.lock 存在），本 tick 让路，不接手');
      return undefined;
    }
    const { ok, log: relLog } = runReleaseDaily();
    if (ok) {
      writeRemediateState(nextRemediateState('recovered', { todayBeijing, prevState: remediateState, note: 'Tier1 重跑 release:daily 成功', nowISO }));
      notify('🟢 车险数据已自动补发\n\n发现　当日发布曾失败，Mac 侧自动接手已重跑成功\n结果　数据已恢复，无需人工处理');
      log('✅ Tier 1 自处置成功：数据已恢复');
      return undefined;
    }
    // Tier 1 失败 → 落盘失败日志 + 计一次尝试；若达上限即同轮升级 Tier 2
    try { writeFileSync(LAST_FAILURE_LOG, relLog); } catch { /* 尽力 */ }
    const afterTier1 = nextRemediateState('tier1-failed', { todayBeijing, prevState: remediateState, note: 'Tier1 重跑仍失败', nowISO });
    writeRemediateState(afterTier1);
    log('🔴 Tier 1 重跑仍失败');
    const reDecide = decideRemediation({ releaseState, remediateState: afterTier1, todayBeijing, maxTier1 });
    if (reDecide.action !== 'tier2-diagnose') return undefined; // 还有 Tier1 余量（maxTier1>1 时）
    escalateTier2(relLog, todayBeijing, afterTier1, nowISO);
    return undefined;
  }

  if (decision.action === 'tier2-diagnose') {
    const relLog = existsSync(LAST_FAILURE_LOG) ? readFileSync(LAST_FAILURE_LOG, 'utf-8') : '';
    escalateTier2(relLog, todayBeijing, remediateState, nowISO);
    return undefined;
  }
  return undefined;
}

/** Tier 2：诊断失败类别 + 回帖群待确认（绝不自动改配置/密钥）。 */
function escalateTier2(relLog, todayBeijing, prevState, nowISO) {
  const { category, hint } = classifyReleaseFailure(relLog);
  writeRemediateState(nextRemediateState('tier2-awaiting', { todayBeijing, prevState, note: `Tier2 待确认（${category}）`, nowISO }));
  notify(
    '🔴 车险数据自动补发失败，需人工确认\n\n' +
      `发现　当日发布失败，Mac 侧自动重跑仍未成功（类别：${category}）\n` +
      '安排　转人工 / AI 值守确认（重风险动作不自动执行）\n' +
      `做什么　${hint}\n` +
      '怎么做　发布机核查后手动 bun run release:daily 补发',
  );
  log(`🔴 Tier 2 已诊断（${category}）并回帖群待确认`);
}

main();
