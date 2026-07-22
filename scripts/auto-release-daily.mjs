#!/usr/bin/env node
/**
 * 全自动日常发布 watcher：监控 VPS auto_loadbi 出表 → 按批次齐全即在主仓跑 sync-and-reload --batch
 *
 * 解决的问题（2026-07-18 起上游改双批出表）：
 *   - 早批：01 签单 + 05 理赔，北京约 07:35 两省就绪 → 07:40 起触发
 *   - 晚批：02 报价 + 03 维修 + 04 厂牌，北京约 11:50 就绪（04 每周日更新）→ 12:00 起触发
 * 人工需要「每批等齐了再发布」。本脚本把等待变成机器的事，且两批各自独立就绪判定 / 幂等键 / 窗口：
 *
 *   launchd 每 15 分钟拉起本脚本（无常驻进程），一个 tick 内依次处理早批、晚批：
 *     → 每批：窗口/状态决策（auto-release-decision.mjs 纯函数 + selectBatchState/mergeBatchState，北京时区）
 *     → 轻量探测：ssh 只读 latest-manifest.json（一个 tick 只探一次，两批共用；不 rsync 135MB）
 *       → evaluateRemoteManifest(requiredCodes=本批 code)：本批 code 齐全 + mtime=北京今天 + sizeMB 兜空表
 *     → 就绪 → node scripts/sync-and-reload.mjs --batch <id>（其 Stage 0 pull-bi-exports --batch 再做
 *       本批 rsync + 字节比对 + 省份内容核验，双层校验；--batch 从 release-batches.mjs SSOT 取域/企微/报告）
 *     → 该批当天成功后写 slice 幂等跳过；失败重试至上限；窗口结束未成即告警 missed（批次粒度）
 *
 * 批次 SSOT：数据管理/lib/release-batches.mjs（code 子集 / ETL 域 / 窗口 / 报告·企微编排）。
 * 状态文件为「批次 × 天」（见 auto-release-decision.mjs 头注释），早批标 released 不会让晚批被幂等跳过。
 *
 * 告警通道：结构化日志（数据管理/logs/auto-release.log）+ macOS 系统通知（osascript）
 * + 飞书机器人（lark-cli bot 身份，默认推「AI 赋能车险经营」群，AUTO_RELEASE_LARK_CHAT_ID 可覆盖；
 * 2026-07-08 起默认开启——此前只有本地日志/桌面通知，人不在电脑前会错过 missed 告警）
 * + 可选企微群机器人 webhook（AUTO_RELEASE_WEBHOOK_URL，群机器人不受 IP 白名单限制）。
 *
 * 用法：
 *   node scripts/auto-release-daily.mjs                     # launchd 周期入口（两批各自窗口+状态决策）
 *   node scripts/auto-release-daily.mjs --once              # 忽略窗口手动探测一次，两批就绪即发布
 *   node scripts/auto-release-daily.mjs --once --batch early # 只处理指定批次（early / late）
 *   node scripts/auto-release-daily.mjs --once --dry-run    # 只探测判就绪，不真跑 release
 *   node scripts/auto-release-daily.mjs --status            # 看两批当天状态 + 最近日志
 *   node scripts/auto-release-daily.mjs --install-launchd   # 安装 launchd 定时器（须在主仓跑）
 *   node scripts/auto-release-daily.mjs --uninstall-launchd # 卸载
 *
 * 环境变量：
 *   AUTO_RELEASE_EARLY_WINDOW_START / _END                早批窗口，北京时间（默认 07:40 / 20:00）
 *   AUTO_RELEASE_LATE_WINDOW_START / _END                 晚批窗口，北京时间（默认 12:00 / 20:00）
 *     ⚠️ 旧的全局 AUTO_RELEASE_WINDOW_START/END 双批时代已失效（两批窗口不同，单值无法表达）
 *   AUTO_RELEASE_MAX_ATTEMPTS                            单批当日失败重试上限（默认 6）
 *   AUTO_RELEASE_LARK_CHAT_ID                            飞书告警群 chat_id（默认「AI 赋能车险经营」群，lark-cli bot 已入群免配）
 *   AUTO_RELEASE_WEBHOOK_URL                             企微群机器人 webhook（可选，与飞书并行发）
 *   AUTO_RELEASE_INTERVAL_SEC                            安装时写入 launchd 的轮询间隔（默认 900）
 *   PULL_BI_SSH_ALIAS / PULL_BI_REMOTE_DIR               复用拉取脚本的上游定位（默认 myvps / auto_loadbi）
 *
 * ⚠️ Mac 睡眠时 launchd 不触发（唤醒后下个周期补上）。若 Mac 白天常合盖，可用
 * `sudo pmset repeat wakeorpoweron MTWRFSU 07:30:00 07:35:00 11:45:00` 类定时唤醒（本脚本不代改电源设置）。
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
  statSync, unlinkSync, openSync, closeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { beijingDayOf, evaluateRemoteManifest } from '../数据管理/lib/bi-export-pull.mjs';
import {
  DEFAULT_MAX_ATTEMPTS, isValidHHMM, decideTickAction, nextState,
  selectBatchState, mergeBatchState, unmetDependencies,
} from '../数据管理/lib/auto-release-decision.mjs';
import {
  RELEASE_BATCHES, getReleaseBatch, batchAllCodes, RELEASE_BATCH_IDS,
} from '../数据管理/lib/release-batches.mjs';
import { resolveLaunchdNodeBin } from '../数据管理/lib/launchd-node-bin.mjs';
import { collectLedgerDiffFiles, evaluateLedgerUncommittedBulk } from './etl-ledger/governance-check.mjs';
// 企微失败独立告警（PR #1158 评审 F1）：企微失败不阻断发布（sync-and-reload 退出 0、批次照常
// released），失败清单落在标记文件——发布成功后读它，有失败则**独立**告警 + 提示独立重试。
import { WECOM_ALERT_MARKER_RELPATH } from './lib/wecom-sync-tasks.mjs';

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
  // batch=null → 处理全部批次（launchd 周期入口 / 手动 --once 补两批）；指定 → 只处理该批。
  const opts = { once: false, dryRun: false, status: false, install: false, uninstall: false, batch: null, allowMissingDep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') opts.once = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--status') opts.status = true;
    else if (a === '--allow-missing-dep') opts.allowMissingDep = true;
    else if (a === '--install-launchd') opts.install = true;
    else if (a === '--uninstall-launchd') opts.uninstall = true;
    else if (a === '--batch' || a.startsWith('--batch=')) {
      const id = a.includes('=') ? a.slice('--batch='.length) : argv[++i];
      try { opts.batch = getReleaseBatch(id).id; }
      catch (e) { process.stdout.write(`${e.message}\n`); process.exit(1); }
    }
    else if (a === '--help' || a === '-h') {
      process.stdout.write(`用法见文件头注释：--once / --dry-run / --status / --batch ${RELEASE_BATCH_IDS.join('|')} / --allow-missing-dep / --install-launchd / --uninstall-launchd\n`);
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

/**
 * 解析某批次的触发窗口（北京时间）。默认取 release-batches.mjs SSOT；
 * 可用 AUTO_RELEASE_EARLY_WINDOW_START/END、AUTO_RELEASE_LATE_WINDOW_START/END 分批覆盖
 *（测试/应急）。⚠️ 旧的全局 AUTO_RELEASE_WINDOW_START/END 在双批时代已失效——两批窗口不同，
 * 单一全局值无法表达；如需改窗请用分批 env。
 */
function resolveBatchWindow(batch) {
  const key = batch.id.toUpperCase();
  const start = process.env[`AUTO_RELEASE_${key}_WINDOW_START`] || batch.window.start;
  const end = process.env[`AUTO_RELEASE_${key}_WINDOW_END`] || batch.window.end;
  if (!isValidHHMM(start) || !isValidHHMM(end) || start >= end) {
    log('red', `❌ 批次 ${batch.id} 窗口配置非法：start=${start} end=${end}（须 HH:MM 且 start < end）`);
    process.exit(1);
  }
  return { start, end };
}

// ── 告警（日志 + macOS 通知 + 可选企微群机器人 + 可选飞书机器人）──

// 「AI 赋能车险经营」群（bot 已入群，lark-cli auth 已配好，无需额外 env 也能推）；
// 2026-07-08 用户要求把自动发布状态接进飞书报告机制后固定使用此群，可用
// AUTO_RELEASE_LARK_CHAT_ID 覆盖。
const DEFAULT_LARK_CHAT_ID = 'oc_07c20f22eb5828000452a2be8ae26df0';

async function notify(title, body) {
  log('yellow', `🔔 ${title}：${body}`);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  spawnSync('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`], { stdio: 'ignore' });

  const chatId = process.env.AUTO_RELEASE_LARK_CHAT_ID || DEFAULT_LARK_CHAT_ID;
  const larkResult = spawnSync('lark-cli', [
    'im', '+messages-send', '--as', 'bot', '--chat-id', chatId,
    '--text', `[chexian 自动发布] ${title}\n${body}`, '--json',
  ], { encoding: 'utf-8', timeout: 30_000 });
  if (larkResult.error || larkResult.status !== 0) {
    log('yellow', `⚠ 飞书通知失败：${larkResult.error?.message || (larkResult.stderr || '').trim().slice(0, 300)}`);
  }

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

/**
 * 告警升级（2026-07-12）：单日故障只告警一次容易被忽略——07-08/07-09 两天都是这样悄悄拖过去的，
 * 首页报告卡「数据未更新」正是这个滞后攒了 2~3 天后才被人注意到。consecutiveMissedDays
 * （见 auto-release-decision.mjs computeConsecutiveMissedDays）记录了「今天之前已经连续
 * 多少天没成功发布」——一旦 ≥1（即已经跨天拖过），说明上一次同等力度的告警没被处理，
 * 必须用更醒目的标题+更强烈的措辞让人不能再当作日常噪声划过。
 * @returns {[string, string]} 传给 notify(title, body) 的参数
 */
function escalatedAlert(title, body, consecutiveMissedDays) {
  if (!consecutiveMissedDays || consecutiveMissedDays < 1) return [title, body];
  const daysStuck = consecutiveMissedDays + 1; // +1 把今天也算进去，即“已连续 N 天”
  return [
    `🚨🚨🚨 已连续 ${daysStuck} 天未自动发布 —— ${title}`,
    `${body}\n⚠ 这不是今天第一次：过去 ${consecutiveMissedDays} 天也未成功发布，请立即人工介入排查，不要再等下一轮自动重试。`,
  ];
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

let __lockAcquired = false;
function acquireLock() {
  // 幂等：一个 tick 内两批发布共用同一把锁（首批 acquire，次批 no-op），退出时统一释放。
  // 若直接为每批 acquire/release，次批会撞上首批自己的锁（EEXIST + 同进程 pid 存活 → 误退出）。
  // ⚠️ __lockAcquired 只在真正成功持锁后置位——陈旧锁接管走 return acquireLock() 递归重试，
  // 若提前置位会让递归被顶部 guard 短路、锁永不重新拿到。
  if (__lockAcquired) return;
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
  __lockAcquired = true;
  const release = () => { try { if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH); } catch { /* 尽力而为 */ } };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
}

// ── 触发发布 ──

function runReleaseDaily(batch) {
  log('cyan', `▶ ${batch.label} 就绪，触发 sync-and-reload --batch ${batch.id}（Stage 0 做本批 rsync+字节校验+省份核验；企微=${batch.runWecom}）`);
  // 全链路打点（2026-07-11）：watcher 预生成 run_id 传给发布链，使 watcher 侧事件与
  // release 全链路事件在台账里同 run_id 可关联；AUTO_RELEASE_TRIGGER 标记触发方式
  //（sync-and-reload 的 run start/end 事件 trigger 字段据此区分 watcher/ai/manual）。
  // 直接调 sync-and-reload.mjs（不走 bun run release:daily，后者硬编 --wecom）：--batch 从 SSOT
  // 决定 ETL 域 / code 子集 / 报告 / 企微。用 process.execPath（当前 node 绝对路径）避免 PATH 依赖。
  const runId = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const r = spawnSync(process.execPath, ['scripts/sync-and-reload.mjs', '--batch', batch.id], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit', // launchd 模式下由 StandardOutPath 收进 launchd 日志
    timeout: 90 * 60 * 1000,
    env: { ...process.env, ETL_RUN_ID: runId, AUTO_RELEASE_TRIGGER: 'watcher' },
  });
  if (r.error) return { ok: false, detail: r.error.message };
  return { ok: r.status === 0, detail: `exit=${r.status}` };
}

/**
 * 发布成功收尾：提醒入库台账文件的未提交 diff 体量（2419ed）。
 * 本脚本刻意不自动 commit/push（launchd 无人环境跑 git push+gh 的故障面 > 收益，
 * 取舍详见 2419ed 落账）；只复用 governance 同一判定函数打日志提醒，
 * 用户经 auto-release:status / governance 均可见。失败降级静默，不影响发布结果。
 */
function remindLedgerUncommitted() {
  try {
    const files = collectLedgerDiffFiles(PROJECT_ROOT);
    const { level, message } = evaluateLedgerUncommittedBulk({ files });
    log(level === 'ok' ? 'cyan' : 'yellow', `📒 ${message}`);
  } catch { /* 提醒失败不影响发布结果 */ }
}

// ── launchd 安装 / 卸载 ──

function resolveNodeBin() {
  const r = resolveLaunchdNodeBin();
  if (!r.ok) { log('red', '❌ 找不到 node 可执行文件（launchd 需要绝对路径）'); process.exit(1); }
  return r.path;
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
  // 按批次概览（双批发布：early / late 各一 slice）
  const todayBeijing = beijingDayOf(new Date());
  process.stdout.write(`\n批次状态（北京今天 ${todayBeijing}）：\n`);
  for (const batch of RELEASE_BATCHES) {
    const slice = selectBatchState(state, batch.id);
    const win = resolveBatchWindow(batch);
    const desc = slice
      ? `${slice.status}（北京日 ${slice.beijingDay}${slice.beijingDay === todayBeijing ? '·今天' : '·非今天'}，attempts=${slice.attempts ?? 0}）`
      : '（今天尚未跑过）';
    process.stdout.write(`  ${batch.id.padEnd(6)} 窗口 ${win.start}~${win.end} code ${batchAllCodes(batch).join('/')}：${desc}\n`);
  }
  const uid = process.getuid();
  const r = spawnSync('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`], { encoding: 'utf-8' });
  process.stdout.write(`\nlaunchd：${r.status === 0 ? '已安装 ✓' : '未安装（bun run auto-release:install）'}\n`);
  if (existsSync(LOG_PATH)) {
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    process.stdout.write(`最近日志（${LOG_PATH}）：\n${lines.slice(-10).join('\n')}\n`);
  }
}

// ── 主流程 ──

/**
 * 处理单个批次的一次 tick。返回本批终态供 main 汇总退出码。
 * 状态读写走 selectBatchState/mergeBatchState（批次 slice 独立），决策仍用不感知批次的纯函数。
 * @returns {Promise<'skip'|'missed'|'probe-error'|'not-ready'|'dry-ready'|'released'|'failed'>}
 */
async function processBatch(batch, ctx) {
  const { todayBeijing, nowHHMM, maxAttempts, opts, getManifest } = ctx;
  const window = resolveBatchWindow(batch);
  const prev = selectBatchState(ctx.stateRef.value, batch.id);
  const decision = decideTickAction({ state: prev, todayBeijing, nowHHMM, window, maxAttempts, once: opts.once });
  const tag = `[${batch.id}]`;

  if (decision.action === 'skip') {
    // 窗口前的静默 tick 不写日志（每 15 分钟一条噪声）；其余 skip 原因值得留痕
    if (nowHHMM >= window.start || opts.once) log('yellow', `⏭ ${tag} ${decision.reason}`);
    return 'skip';
  }
  if (decision.action === 'mark-missed') {
    const slice = nextState('missed', { todayBeijing, prevState: prev, note: decision.reason, nowISO: new Date().toISOString() });
    ctx.stateRef.value = mergeBatchState(ctx.stateRef.value, batch.id, slice);
    writeState(ctx.stateRef.value);
    const body = `${batch.label}：${decision.reason}。请人工检查上游出表（ssh myvps 看 auto_loadbi/exports），需要时手动 node scripts/sync-and-reload.mjs --batch ${batch.id}`;
    await notify(...escalatedAlert(`今天 ${batch.label} 未自动发布`, body, slice.consecutiveMissedDays));
    return 'missed';
  }

  // action === 'probe'
  log('cyan', `▶ ${tag} ${decision.reason}（北京 ${todayBeijing} ${nowHHMM}·code ${batchAllCodes(batch).join('/')}）`);
  const probe = getManifest();
  if (probe.error) {
    log('red', `❌ ${tag} ${probe.error}`);
    return 'probe-error'; // 周期模式：下个 tick 重试，窗口结束由 mark-missed 兜底告警
  }
  const verdict = evaluateRemoteManifest(probe.manifest, {
    todayBeijing, requiredCodes: batchAllCodes(batch), optionalCodes: batch.optionalCodes,
  });
  // 可选表（04 厂牌，低频维表/周日更新）异常是 warn：不拦就绪，但始终留痕（分发层跳过异常份保留旧维表）
  for (const i of verdict.issues.filter((x) => x.level === 'warn')) log('yellow', `  ⚠ ${tag} ${i.message}`);
  if (!verdict.ready) {
    for (const i of verdict.issues.filter((x) => x.level === 'error')) log('yellow', `  ⏳ ${tag} ${i.message}`);
    log('yellow', `⏳ ${tag} 上游未就绪（${verdict.reports.length}/${batchAllCodes(batch).length} 张已出今天的表），${opts.once ? '' : '下个周期再探'}`);
    return 'not-ready';
  }
  log('green', `✓ ${tag} 上游必需报表就绪（均为北京 ${todayBeijing}）：${verdict.reports.map((r) => `${r.code}=${r.sizeMB}MB`).join(' ')}`);

  // 🔴 依赖闸（fail-closed）：前置批（如早批）当天未 released → 不发本批，防混新鲜度发布
  //（晚批 renewal_tracker / 企微依赖早批 policy）。应急 --allow-missing-dep 放行。
  const unmet = unmetDependencies(batch, ctx.stateRef.value, todayBeijing);
  if (unmet.length > 0 && !opts.allowMissingDep) {
    log('yellow', `⏸ ${tag} 前置批未就绪（${unmet.join(',')} 今日未 released），暂不发布本批（防混新鲜度）；待前置批成功或 --allow-missing-dep 再发`);
    return 'dep-unmet';
  }

  if (opts.dryRun) {
    log('cyan', `（dry-run）${tag} 就绪但不触发 release`);
    return 'dry-ready';
  }
  if (isWorktreeCheckout()) {
    log('red', '❌ 当前是 git worktree，禁止在 worktree 触发 release（数据/同步/reload 会错位）。请在主仓运行。');
    process.exit(1);
  }

  acquireLock(); // 幂等：两批共用一把锁
  const result = runReleaseDaily(batch);
  const now = new Date().toISOString();
  if (result.ok) {
    const slice = nextState('released', { todayBeijing, prevState: prev, note: '自动发布成功', nowISO: now });
    ctx.stateRef.value = mergeBatchState(ctx.stateRef.value, batch.id, slice);
    writeState(ctx.stateRef.value);
    await notify(`${batch.label} 自动发布成功`, `sync-and-reload --batch ${batch.id} 完成（北京 ${todayBeijing} ${beijingNowHHMM()}）`);
    // 企微失败独立告警（非阻断，见 wecom-sync-tasks.mjs evaluateWecomOutcome）：核心数据已
    // released，但当天企微若有失败任务，单独告警 + 给出独立重试命令，不改批次状态、不触发重跑。
    if (batch.runWecom) {
      try {
        const markerPath = join(PROJECT_ROOT, WECOM_ALERT_MARKER_RELPATH);
        const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf-8')) : null;
        if (marker?.beijingDay === todayBeijing && Array.isArray(marker.failures) && marker.failures.length > 0) {
          const labels = marker.failures.map((f) => f.label).join('、');
          await notify(
            '企微同步部分失败（发布未受阻断）',
            `${labels} 失败；核心数据已正常发布。独立重试：node scripts/wecom-sync.mjs（不重跑 ETL/reload）`
          );
        }
      } catch (e) {
        log('yellow', `⚠ 企微告警标记读取失败（不阻断）：${e.message}`);
      }
    }
    return 'released';
  }
  const slice = nextState('failed', { todayBeijing, prevState: prev, note: `release --batch ${batch.id} 失败 ${result.detail}`, nowISO: now });
  ctx.stateRef.value = mergeBatchState(ctx.stateRef.value, batch.id, slice);
  writeState(ctx.stateRef.value);
  const body = `${batch.label} sync-and-reload ${result.detail}（第 ${slice.attempts}/${maxAttempts} 次）。日志：${LOG_PATH} 与 launchd 日志；上限内下个周期自动重试`;
  await notify(...escalatedAlert(`${batch.label} 自动发布失败`, body, slice.consecutiveMissedDays));
  return 'failed';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.status) return printStatus();
  if (opts.install) return installLaunchd();
  if (opts.uninstall) return uninstallLaunchd();

  const todayBeijing = beijingDayOf(new Date());
  const nowHHMM = beijingNowHHMM();
  const maxAttempts = parseInt(process.env.AUTO_RELEASE_MAX_ATTEMPTS || '', 10) || DEFAULT_MAX_ATTEMPTS;
  // stateRef.value 在两批间累积（早批写入后晚批据此判定，避免读到落盘前的旧文件）
  const stateRef = { value: readState() };
  // 上游 manifest 一个 tick 只探测一次（两批共用，避免重复 ssh）
  let _probe;
  const getManifest = () => (_probe ??= probeRemoteManifest());

  const batches = opts.batch ? [getReleaseBatch(opts.batch)] : RELEASE_BATCHES;
  const ctx = { todayBeijing, nowHHMM, maxAttempts, opts, stateRef, getManifest };

  let anyReleased = false;
  let hardFailure = false; // release 真正跑了但失败 → 无论模式都非零退出
  let onceUnpublished = false; // --once 模式下本批没能发布（probe-error/not-ready/failed）
  for (const batch of batches) {
    const outcome = await processBatch(batch, ctx);
    if (outcome === 'released') anyReleased = true;
    if (outcome === 'failed') hardFailure = true;
    if (opts.once && (outcome === 'failed' || outcome === 'not-ready' || outcome === 'probe-error')) onceUnpublished = true;
  }

  if (anyReleased) remindLedgerUncommitted();
  if (hardFailure || (opts.once && onceUnpublished)) process.exit(1);
}

main().catch(async (e) => {
  log('red', `❌ watcher 未捕获异常：${e.message}`);
  await notify('自动发布 watcher 异常', e.message);
  process.exit(1);
});
