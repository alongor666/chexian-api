#!/usr/bin/env node
/**
 * 全自动日常发布 watcher：监控 VPS auto_loadbi 出表 → 五张齐全即在主仓跑 release:daily
 *
 * 解决的问题：上游五张表分两批出（北京约 09:30 出 01/03/04/05，10:30 出 02 报价），
 * 人工需要「等齐了再跑 release:daily」。本脚本把等待变成机器的事：
 *
 *   launchd 每 15 分钟拉起本脚本（无常驻进程）
 *     → 窗口/状态决策（数据管理/lib/auto-release-decision.mjs，北京时区）
 *     → 轻量探测：ssh 只读 latest-manifest.json（不 rsync 135MB）
 *       → evaluateRemoteManifest：5 code 齐全 + mtime=北京今天 + sizeMB 兜空表
 *     → 就绪 → bun run release:daily（其 Stage 0 pull-bi-exports 再做完整
 *       rsync + 字节比对 + 省份内容核验，双层校验）
 *     → 当天成功后写状态幂等跳过；失败重试至上限；窗口结束未成即告警 missed
 *
 * 告警通道：结构化日志（数据管理/logs/auto-release.log）+ macOS 系统通知（osascript）
 * + 可选企微群机器人 webhook（AUTO_RELEASE_WEBHOOK_URL，群机器人不受 IP 白名单限制）。
 *
 * 用法：
 *   node scripts/auto-release-daily.mjs                     # launchd 周期入口（窗口+状态决策）
 *   node scripts/auto-release-daily.mjs --once              # 忽略窗口手动探测一次，就绪即发布
 *   node scripts/auto-release-daily.mjs --once --dry-run    # 只探测判就绪，不真跑 release
 *   node scripts/auto-release-daily.mjs --status            # 看当天状态 + 最近日志
 *   node scripts/auto-release-daily.mjs --install-launchd   # 安装 launchd 定时器（须在主仓跑）
 *   node scripts/auto-release-daily.mjs --uninstall-launchd # 卸载
 *
 * 环境变量：
 *   AUTO_RELEASE_WINDOW_START / AUTO_RELEASE_WINDOW_END  发布窗口，北京时间（默认 10:35 / 14:00）
 *   AUTO_RELEASE_MAX_ATTEMPTS                            当日失败重试上限（默认 2）
 *   AUTO_RELEASE_WEBHOOK_URL                             企微群机器人 webhook（可选）
 *   AUTO_RELEASE_INTERVAL_SEC                            安装时写入 launchd 的轮询间隔（默认 900）
 *   PULL_BI_SSH_ALIAS / PULL_BI_REMOTE_DIR               复用拉取脚本的上游定位（默认 myvps / auto_loadbi）
 *
 * ⚠️ Mac 睡眠时 launchd 不触发（唤醒后下个周期补上）。若 Mac 白天常合盖，可用
 * `sudo pmset repeat wakeorpoweron MTWRFSU 10:30:00` 定时唤醒（本脚本不代改电源设置）。
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
  statSync, unlinkSync, openSync, closeSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { beijingDayOf, evaluateRemoteManifest } from '../数据管理/lib/bi-export-pull.mjs';
import {
  DEFAULT_WINDOW, DEFAULT_MAX_ATTEMPTS, isValidHHMM, decideTickAction, nextState,
} from '../数据管理/lib/auto-release-decision.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '../..');
const LOGS_DIR = join(PROJECT_ROOT, '数据管理', 'logs');
const STATE_PATH = join(LOGS_DIR, 'auto-release-state.json');
const LOG_PATH = join(LOGS_DIR, 'auto-release.log');
const LOCK_PATH = join(LOGS_DIR, '.auto-release.lock');
const LAUNCHD_LABEL = 'com.chexian.auto-release-daily';
const LAUNCHD_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

// launchd 环境 PATH 极简；bun/ssh/rsync/python3/duckdb 都在这些前缀下
const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.bun', 'bin')];
process.env.PATH = [...EXTRA_PATHS, ...(process.env.PATH || '').split(':')].filter(Boolean).join(':');

const COLORS = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };

function log(color, msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(`${COLORS[color] || ''}${line}${COLORS.reset}\n`);
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(LOG_PATH, line + '\n');
  } catch { /* 日志落盘尽力而为 */ }
}

function parseArgs(argv) {
  const opts = { once: false, dryRun: false, status: false, install: false, uninstall: false };
  for (const a of argv) {
    if (a === '--once') opts.once = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--status') opts.status = true;
    else if (a === '--install-launchd') opts.install = true;
    else if (a === '--uninstall-launchd') opts.uninstall = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('用法见文件头注释：--once / --dry-run / --status / --install-launchd / --uninstall-launchd\n');
      process.exit(0);
    } else {
      process.stdout.write(`未知参数：${a}（--help 查看用法）\n`);
      process.exit(1);
    }
  }
  return opts;
}

function isWorktreeCheckout() {
  try {
    return statSync(join(PROJECT_ROOT, '.git')).isFile(); // linked worktree 的 .git 是指针文件
  } catch {
    return false;
  }
}

function beijingNowHHMM() {
  return new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function resolveWindow() {
  const start = process.env.AUTO_RELEASE_WINDOW_START || DEFAULT_WINDOW.start;
  const end = process.env.AUTO_RELEASE_WINDOW_END || DEFAULT_WINDOW.end;
  if (!isValidHHMM(start) || !isValidHHMM(end) || start >= end) {
    log('red', `❌ 窗口配置非法：start=${start} end=${end}（须 HH:MM 且 start < end）`);
    process.exit(1);
  }
  return { start, end };
}

// ── 告警（日志 + macOS 通知 + 可选企微群机器人）──

async function notify(title, body) {
  log('yellow', `🔔 ${title}：${body}`);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  spawnSync('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`], { stdio: 'ignore' });
  const url = process.env.AUTO_RELEASE_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: `[chexian 自动发布] ${title}\n${body}` } }),
    });
    if (!res.ok) log('yellow', `⚠ webhook 通知失败：HTTP ${res.status}`);
  } catch (e) {
    log('yellow', `⚠ webhook 通知失败：${e.message}`);
  }
}

// ── 远程探测（只读 manifest，不 rsync）──

function probeRemoteManifest() {
  const alias = process.env.PULL_BI_SSH_ALIAS || 'myvps';
  const remoteDir = (process.env.PULL_BI_REMOTE_DIR || '/root/workspace/auto_loadbi/exports/').replace(/\/$/, '');
  const r = spawnSync('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    alias, `cat ${remoteDir}/latest-manifest.json`,
  ], { encoding: 'utf-8', timeout: 60 * 1000 });
  if (r.status !== 0) {
    return { error: `ssh 探测失败（exit=${r.status ?? r.error?.message}）：${(r.stderr || '').trim().split('\n').pop() || '无 stderr'}` };
  }
  try {
    return { manifest: JSON.parse(r.stdout) };
  } catch (e) {
    return { error: `远程 manifest 解析失败：${e.message}` };
  }
}

// ── 互斥锁（防 launchd tick 与手动 --once 并发触发两次 release）──

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function acquireLock() {
  mkdirSync(LOGS_DIR, { recursive: true });
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let holder = null;
    try { holder = parseInt(readFileSync(LOCK_PATH, 'utf-8').trim(), 10) || null; } catch { /* 读锁失败按陈旧处理 */ }
    if (isProcessAlive(holder)) {
      log('yellow', `⚠ 另一个 auto-release 实例运行中（pid=${holder}），本次退出`);
      process.exit(0);
    }
    unlinkSync(LOCK_PATH); // 陈旧锁接管
    return acquireLock();
  }
  const release = () => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* 尽力而为 */ } };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
}

// ── 触发发布 ──

function runReleaseDaily() {
  log('cyan', '▶ 五张表就绪，触发 bun run release:daily（Stage 0 会做完整 rsync+字节校验+省份核验）');
  const r = spawnSync('bun', ['run', 'release:daily'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit', // launchd 模式下由 StandardOutPath 收进 launchd 日志
    timeout: 90 * 60 * 1000,
  });
  if (r.error) return { ok: false, detail: r.error.message };
  return { ok: r.status === 0, detail: `exit=${r.status}` };
}

// ── launchd 安装 / 卸载 ──

function resolveNodeBin() {
  if (basename(process.execPath) === 'node') return process.execPath;
  const r = spawnSync('sh', ['-lc', 'command -v node'], { encoding: 'utf-8' });
  const p = (r.stdout || '').trim();
  if (!p) { log('red', '❌ 找不到 node 可执行文件（launchd 需要绝对路径）'); process.exit(1); }
  return p;
}

function installLaunchd() {
  if (isWorktreeCheckout()) {
    log('red', '❌ 当前是 git worktree（.git 为文件）。launchd 必须指向主仓，请在主仓目录运行：');
    log('red', '   cd <主仓> && bun run auto-release:install');
    process.exit(1);
  }
  const nodeBin = resolveNodeBin();
  const scriptPath = join(PROJECT_ROOT, 'scripts', 'auto-release-daily.mjs');
  const interval = parseInt(process.env.AUTO_RELEASE_INTERVAL_SEC || '900', 10) || 900;
  const launchdLog = join(LOGS_DIR, 'auto-release.launchd.log');
  const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const envPath = [...EXTRA_PATHS, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEsc(nodeBin)}</string>
    <string>${xmlEsc(scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEsc(PROJECT_ROOT)}</string>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xmlEsc(launchdLog)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(launchdLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEsc(envPath)}</string>
    <key>HOME</key><string>${xmlEsc(homedir())}</string>
  </dict>
</dict>
</plist>
`;
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(LAUNCHD_PLIST, plist);
  const uid = process.getuid();
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`], { stdio: 'ignore' }); // 幂等重装
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, LAUNCHD_PLIST], { encoding: 'utf-8' });
  if (r.status !== 0) {
    log('red', `❌ launchctl bootstrap 失败：${(r.stderr || '').trim()}`);
    process.exit(1);
  }
  log('green', `✅ launchd 定时器已安装并启动：${LAUNCHD_LABEL}（每 ${interval}s 一次，北京窗口内探测）`);
  log('cyan', `   plist：${LAUNCHD_PLIST}`);
  log('cyan', `   看状态：bun run auto-release:status · 日志：${LOG_PATH}`);
  log('cyan', `   卸载：node scripts/auto-release-daily.mjs --uninstall-launchd`);
  log('yellow', '   ⚠ Mac 睡眠时不触发（唤醒后下个周期补上）；白天常合盖可配 pmset 定时唤醒');
}

function uninstallLaunchd() {
  const uid = process.getuid();
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`], { stdio: 'ignore' });
  if (existsSync(LAUNCHD_PLIST)) unlinkSync(LAUNCHD_PLIST);
  log('green', `✅ 已卸载 ${LAUNCHD_LABEL}（plist 已删除）`);
}

function printStatus() {
  const state = readState();
  process.stdout.write(`状态文件（${STATE_PATH}）：\n${state ? JSON.stringify(state, null, 2) : '（无——尚未运行过）'}\n`);
  const uid = process.getuid();
  const r = spawnSync('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`], { encoding: 'utf-8' });
  process.stdout.write(`launchd：${r.status === 0 ? '已安装 ✓' : '未安装（bun run auto-release:install）'}\n`);
  if (existsSync(LOG_PATH)) {
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    process.stdout.write(`最近日志（${LOG_PATH}）：\n${lines.slice(-10).join('\n')}\n`);
  }
}

// ── 主流程 ──

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.status) return printStatus();
  if (opts.install) return installLaunchd();
  if (opts.uninstall) return uninstallLaunchd();

  const todayBeijing = beijingDayOf(new Date());
  const nowHHMM = beijingNowHHMM();
  const window = resolveWindow();
  const maxAttempts = parseInt(process.env.AUTO_RELEASE_MAX_ATTEMPTS || '', 10) || DEFAULT_MAX_ATTEMPTS;
  const state = readState();

  const decision = decideTickAction({ state, todayBeijing, nowHHMM, window, maxAttempts, once: opts.once });

  if (decision.action === 'skip') {
    // 窗口前的静默 tick 不写日志文件（每 15 分钟一条噪声）；其余 skip 原因值得留痕
    if (nowHHMM >= window.start || opts.once) log('yellow', `⏭ ${decision.reason}`);
    return;
  }
  if (decision.action === 'mark-missed') {
    writeState(nextState('missed', { todayBeijing, prevState: state, note: decision.reason, nowISO: new Date().toISOString() }));
    await notify('今天未自动发布', `${decision.reason}。请人工检查上游出表情况（ssh myvps 看 auto_loadbi/exports），需要时手动 bun run release:daily`);
    return;
  }

  // action === 'probe'
  log('cyan', `▶ ${decision.reason}（北京 ${todayBeijing} ${nowHHMM}）`);
  const probe = probeRemoteManifest();
  if (probe.error) {
    log('red', `❌ ${probe.error}`);
    if (opts.once) process.exit(1);
    return; // 周期模式：下个 tick 重试，窗口结束由 mark-missed 兜底告警
  }
  const verdict = evaluateRemoteManifest(probe.manifest, { todayBeijing });
  // 可选表（04 厂牌，低频维表）的异常是 warn：不拦就绪，但始终留痕（分发层会跳过异常份保留旧维表）
  for (const i of verdict.issues.filter((x) => x.level === 'warn')) log('yellow', `  ⚠ ${i.message}`);
  if (!verdict.ready) {
    for (const i of verdict.issues.filter((x) => x.level === 'error')) log('yellow', `  ⏳ ${i.message}`);
    log('yellow', `⏳ 上游未就绪（${verdict.reports.length}/5 张已出今天的表），${opts.once ? '' : '下个周期再探'}`);
    if (opts.once) process.exit(1);
    return;
  }
  log('green', `✓ 上游必需报表就绪（均为北京 ${todayBeijing}）：${verdict.reports.map((r) => `${r.code}=${r.sizeMB}MB`).join(' ')}`);

  if (opts.dryRun) {
    log('cyan', '（dry-run）就绪但不触发 release:daily');
    return;
  }
  if (isWorktreeCheckout()) {
    log('red', '❌ 当前是 git worktree，禁止在 worktree 触发 release:daily（数据/同步/reload 会错位）。请在主仓运行。');
    process.exit(1);
  }

  acquireLock();
  const result = runReleaseDaily();
  const now = new Date().toISOString();
  if (result.ok) {
    writeState(nextState('released', { todayBeijing, prevState: state, note: '自动发布成功', nowISO: now }));
    await notify('自动发布成功', `release:daily 完成（北京 ${todayBeijing} ${beijingNowHHMM()}），五张表 mtime 均为今天`);
  } else {
    const st = nextState('failed', { todayBeijing, prevState: state, note: `release:daily 失败 ${result.detail}`, nowISO: now });
    writeState(st);
    await notify('自动发布失败', `release:daily ${result.detail}（第 ${st.attempts}/${maxAttempts} 次）。日志：${LOG_PATH} 与 launchd 日志；上限内下个周期自动重试`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  log('red', `❌ watcher 未捕获异常：${e.message}`);
  await notify('自动发布 watcher 异常', e.message);
  process.exit(1);
});
