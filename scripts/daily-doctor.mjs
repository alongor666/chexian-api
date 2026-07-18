#!/usr/bin/env node
/**
 * daily-doctor.mjs — 每日发布链「只读体检器」（零副作用）
 *
 * 一眼看清 6 层边界断在哪 + 若 watcher 失败自动挖出**真实崩溃栈**。
 * 由 2026-07-09 事故沉淀：症状日志 auto-release.log 只写 "exit=1"，
 * 真错误在 auto-release.launchd.log（release:daily 的 stdout/stderr）。
 *
 * 用法：cd 主仓 && bun run daily:doctor   （worktree 无 warehouse 数据，须在主仓跑）
 * 全部为只读探测（ssh cat/stat、curl /health、读本地日志），不写任何东西、不触发发布。
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// 双批发布：state 为「批次 × 天」schema，逐批体检（旧扁平 schema 由 selectBatchState 兼容读为早批）
import { RELEASE_BATCHES } from '../数据管理/lib/release-batches.mjs';
import { selectBatchState } from '../数据管理/lib/auto-release-decision.mjs';

const ROOT = process.cwd();
const LOGS_DIR = join(ROOT, '数据管理/logs');
const HEALTH_URL = 'https://chexian.cretvalu.com/health';
const MYVPS_MANIFEST = '/root/workspace/auto_loadbi/exports/latest-manifest.json';
const VPS_POLICY_DIR = '/var/www/chexian/server/data/current/SC';
const WECOM_LOGS = join(ROOT, '数据管理/integrations/wecom_smartsheet/logs');

const G = '🟢', R = '🔴', Y = '🟡';
const rows = [];
let redCount = 0;

function beijingDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function beijingClock(d = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}
function sh(cmd, timeout = 20000) {
  return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function add(light, name, detail) {
  if (light === R) redCount++;
  rows.push({ light, name, detail });
}

const TODAY = beijingDay();

// ── [1] 上游 myvps（BI 导出是否出今天的表）─────────────────
try {
  const raw = sh(`ssh -o ConnectTimeout=15 -o BatchMode=yes myvps 'cat ${MYVPS_MANIFEST}'`, 25000);
  const m = JSON.parse(raw);
  const genDay = beijingDay(new Date(m.generatedAt));
  const codes = [...new Set((m.reports || []).map((r) => r.code))].sort().join('/');
  add(genDay === TODAY ? G : R, '① 上游 myvps',
    `manifest 生成=${genDay}（${genDay === TODAY ? '今天' : '非今天·上游未出表?'}）· codes=${codes}`);
} catch (e) {
  add(R, '① 上游 myvps', `ssh/manifest 探测失败：${String(e.message || e).split('\n')[0]}`);
}

// ── [2] 本地发布收尾（.last-sync-manifest = rsync 成功指纹）──
try {
  const f = join(ROOT, '.last-sync-manifest.json');
  if (!existsSync(f)) { add(R, '② 本地→VPS 同步', '.last-sync-manifest.json 不存在'); }
  else {
    const day = beijingDay(statSync(f).mtime);
    add(day === TODAY ? G : R, '② 本地→VPS 同步',
      `.last-sync-manifest mtime=${day}（${day === TODAY ? '今天已同步' : '停在旧日·发布未跑完'}）`);
  }
} catch (e) { add(R, '② 本地→VPS 同步', String(e.message || e).split('\n')[0]); }

// ── [3] watcher 状态机 + 真实错误（本体检的核心价值）────────
let watcherFailed = false, realError = '';
try {
  const sf = join(LOGS_DIR, 'auto-release-state.json');
  if (!existsSync(sf)) { add(Y, '③ 自动发布 watcher', 'state 文件不存在（未装 launchd?）'); }
  else {
    const s = JSON.parse(readFileSync(sf, 'utf8'));
    // 逐批体检：任一批今日 failed → 红灯 + 触发真实错误挖掘；任一批今日 released → 至少绿
    const parts = [];
    let anyReleasedToday = false;
    const failedNotes = [];
    for (const batch of RELEASE_BATCHES) {
      const slice = selectBatchState(s, batch.id);
      if (!slice) { parts.push(`${batch.id}=（今日未跑）`); continue; }
      const fresh = slice.beijingDay === TODAY;
      const label = fresh ? slice.status : `${slice.status}@${slice.beijingDay}`;
      parts.push(`${batch.id}=${label}${slice.attempts ? `·att${slice.attempts}` : ''}`);
      if (fresh && slice.status === 'released') anyReleasedToday = true;
      if (fresh && slice.status === 'failed') { watcherFailed = true; if (slice.note) failedNotes.push(`${batch.id}:${slice.note}`); }
    }
    const light = watcherFailed ? R : (anyReleasedToday ? G : Y);
    add(light, '③ 自动发布 watcher', `${parts.join(' · ')}${failedNotes.length ? ` · ${failedNotes.join(' / ')}` : ''}`);
  }
} catch (e) { add(R, '③ 自动发布 watcher', String(e.message || e).split('\n')[0]); }

// 若失败 → 从 launchd.log 挖真实崩溃栈（关键：症状 log 不含错误正文）
if (watcherFailed) {
  try {
    const ll = join(LOGS_DIR, 'auto-release.launchd.log');
    if (existsSync(ll)) {
      const lines = readFileSync(ll, 'utf8').split('\n');
      // 抓最后一段包含硬错误信号的上下文
      const hits = [];
      const sig = /(Traceback|ConversionException|Conversion Error|Binder Error|❌|Error:|exit=1|退出码 1|中断于)/;
      for (let i = lines.length - 1; i >= 0 && hits.length < 14; i--) {
        if (sig.test(lines[i])) hits.unshift(lines[i].replace(/\x1b\[[0-9;]*m/g, '').trim());
      }
      realError = hits.slice(-14).join('\n');
    }
  } catch { /* 尽力而为 */ }
}

// ── [4] 生产 chexian-vps（服务活着 + 数据是今天）────────────
try {
  const code = sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 15 ${HEALTH_URL}`);
  let vpsDay = '?';
  try {
    const epoch = sh(`ssh -o ConnectTimeout=15 -o BatchMode=yes chexian-vps-deploy "cd ${VPS_POLICY_DIR} && stat -c %Y *.parquet 2>/dev/null | sort -n | tail -1"`);
    if (epoch) vpsDay = beijingDay(new Date(Number(epoch) * 1000));
  } catch { /* 保单目录探测失败不致命 */ }
  const ok = code === '200' && vpsDay === TODAY;
  add(ok ? G : (code === '200' ? Y : R), '④ 生产 chexian-vps',
    `/health=${code} · 保单 parquet=${vpsDay}（${vpsDay === TODAY ? '今天' : '未刷新'}）`);
} catch (e) { add(R, '④ 生产 chexian-vps', String(e.message || e).split('\n')[0]); }

// ── [5] 企微推送（上次成功推送是否今天）────────────────────
try {
  if (!existsSync(WECOM_LOGS)) { add(Y, '⑤ 企微推送', 'logs 目录不存在'); }
  else {
    const files = readdirSync(WECOM_LOGS).filter((f) => f.endsWith('.json'));
    if (!files.length) { add(Y, '⑤ 企微推送', '暂无推送日志'); }
    else {
      const newest = files.map((f) => statSync(join(WECOM_LOGS, f)).mtime).sort((a, b) => b - a)[0];
      const day = beijingDay(newest);
      add(day === TODAY ? G : Y, '⑤ 企微推送', `上次推送日志 mtime=${day}（${day === TODAY ? '今天' : '非今天'}）`);
    }
  }
} catch (e) { add(Y, '⑤ 企微推送', String(e.message || e).split('\n')[0]); }

// ── 输出 ───────────────────────────────────────────────────
const W = Math.max(...rows.map((r) => r.name.length));
console.log(`\n每日发布链体检 · 北京时间 ${TODAY} ${beijingClock()} · 运行目录 ${ROOT}\n`);
console.log('━'.repeat(72));
for (const r of rows) console.log(`${r.light}  ${r.name.padEnd(W)}  ${r.detail}`);
console.log('━'.repeat(72));

if (realError) {
  console.log('\n🔎 watcher 失败的真实崩溃栈（来自 auto-release.launchd.log，非 auto-release.log）：');
  console.log('┈'.repeat(72));
  console.log(realError);
  console.log('┈'.repeat(72));
}

// ── 结论 + 下一步 ─────────────────────────────────────────
const lightOf = (prefix) => (rows.find((r) => r.name.startsWith(prefix)) || {}).light;
const dataFresh = lightOf('②') === G && lightOf('④') === G; // 本地已同步 + 生产已是今天

console.log('\n下一步建议：');
if (redCount === 0) {
  console.log('  ✅ 全绿。若 watcher=released 则今天已自动发布完成，无需干预。');
} else if (watcherFailed && dataFresh) {
  console.log('  ✅ 数据其实已刷新到今天（②本地同步 · ④生产 · ⑤企微 均绿）——多为「watcher 失败后人工补发，');
  console.log('     但 watcher 自身状态未回写」。今天无需再动；watcher 明天双批窗口（早批 07:40 / 晚批 12:00）会自动重置重跑。');
  console.log('  • 若要根治不复发：把上方真实崩溃栈对应的代码修复合并到主仓当前分支即可。');
} else {
  const up = rows.find((r) => r.name.startsWith('①'));
  if (up && up.light === R) {
    console.log('  • ① 上游未出表/不可达 → 等上游（早批 01/05 约北京 07:35、晚批 02/03/04 约 11:50 出表）或查 ssh myvps 与 auto_loadbi。');
  } else if (watcherFailed) {
    console.log('  • ③ watcher 已停手等人工。看上方真实崩溃栈定位根因 → 修复后手动补发：');
    console.log('      cd <主仓> && bun run release:daily');
    console.log('  • 若卡在 rsync 的 kex_exchange_identification / Connection reset：是并发 SSH 节流，');
    console.log('    重跑幂等的 node scripts/sync-vps.mjs 即收敛（单/连 5 次 ssh 探测能过即 VPS 没挂）。');
  } else {
    console.log('  • 有红灯但 watcher 未标失败 → 逐层看上表 detail；本地②红=发布没跑完，生产④红=没 reload。');
  }
  console.log('  • 完整 SOP / 故障表：/chexian-daily-sync（§0 一键体检 · §4 故障排查）。');
}
console.log('');
process.exit(redCount === 0 ? 0 : 1);
