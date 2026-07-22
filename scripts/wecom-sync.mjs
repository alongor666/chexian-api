#!/usr/bin/env node
/**
 * 企微智能表格同步——独立重试入口（PR #1158 评审 F1 配套）
 *
 * 只跑企微 5 张表的同步，不碰 ETL / governance / VPS 同步 / reload / 健康检查。
 * 用途：发布链 Stage 5 企微失败（非阻断，核心数据已发布成功）后的独立重试——
 * 企微 webhook / 凭据 / 单表异常不需要也不应该重跑整条发布链。
 *
 * 与发布链共享同一 SSOT（scripts/lib/wecom-sync-tasks.mjs）：任务清单 / 参数 /
 * 到期停推闸（5-7 月续保 2 表北京 2026-07-31 后自动退役）完全一致。
 *
 * 使用：
 *   node scripts/wecom-sync.mjs                 # 真跑 5 张表（到期表自动剔除）
 *   node scripts/wecom-sync.mjs --dry-run       # 只打印计划（python 侧 dry-run）
 *   node scripts/wecom-sync.mjs --org 新都,资阳  # 机构续保表限定机构
 *
 * 退出码：全部成功 = 0；存在失败 = 1（本脚本是独立入口，自身失败应对调用方可见——
 * 与发布链 Stage 5 的非阻断策略不矛盾：非阻断指企微失败不拖垮核心数据发布进程）。
 * 成功/失败均刷新告警标记文件（数据管理/logs/wecom-sync-alert.json，gitignored）：
 * 全部成功即清空当天失败清单，watcher 不再重复告警。
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { beijingDayOf } from '../数据管理/lib/bi-export-pull.mjs';
import { runWecomStage, WECOM_ALERT_MARKER_RELPATH } from './lib/wecom-sync-tasks.mjs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = { dryRun: false, org: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--org') {
      opts.org = argv[++i];
      if (!opts.org) throw new Error('--org 需要机构列表，例如：--org 新都,资阳');
    } else if (a.startsWith('--org=')) opts.org = a.slice('--org='.length);
    else if (a === '--help' || a === '-h') {
      console.log('用法：node scripts/wecom-sync.mjs [--dry-run] [--org 机构列表]');
      console.log('  只跑企微 5 张表同步（独立重试入口，不重跑 ETL/reload）。');
      process.exit(0);
    } else throw new Error(`未知参数：${a}`);
  }
  return opts;
}

function runTask(task) {
  console.log(`\n▶ [${task.label}] python3 ${task.args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn('python3', task.args, { cwd: ROOT_DIR, stdio: 'inherit' });
    const timer = task.timeoutMs > 0 ? setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${task.label} 超时 ${task.timeoutMs}ms`));
    }, task.timeoutMs) : null;
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(0);
      else reject(new Error(`${task.label} 退出码 ${code}`));
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // 与发布链 Stage 5 共用同一真实编排体 runWecomStage（任务清单/停推闸/标记语义完全一致）。
  // 本入口的 --dry-run 映射到企微级 dry-run（python --dry-run 真实跑通计划）；全局 dryRun=false。
  const result = await runWecomStage({
    dryRun: false,
    wecomDryRun: opts.dryRun,
    org: opts.org,
    todayBeijing: beijingDayOf(new Date()),
    runId: `wecom-retry-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`,
    runner: runTask,
    persistMarker: (marker) => writeFileSync(
      join(ROOT_DIR, WECOM_ALERT_MARKER_RELPATH),
      JSON.stringify(marker, null, 2) + '\n'
    ),
    log: (level, msg) => (level === 'error' ? console.error(msg) : level === 'warn' ? console.warn(msg) : console.log(msg)),
  });

  if (result.failures.length > 0) {
    console.error(`\n❌ 企微同步 ${result.failures.length}/${result.activeCount} 个任务失败`);
    process.exit(1);
  }
  console.log(`\n✅ WeCom 全部 ${result.activeCount} 个任务完成`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
}
