#!/usr/bin/env node
/**
 * warehouse 源数据备份 CLI（BACKLOG 2026-07-12-claude-3dac98 · 审计FIND-002）
 *
 * 用法：
 *   node scripts/warehouse-backup.mjs backup [--src DIR] [--dest DIR] [--keep N] [--print]
 *   node scripts/warehouse-backup.mjs verify <archive.tar.gz> [--print]
 *   node scripts/warehouse-backup.mjs emit --out FILE [--src DIR] [--dest DIR] [--keep N]
 *
 * backup  在本机执行备份（默认路径为生产 VPS 布局，本地测试须显式 --src/--dest）
 * verify  从归档完整还原到临时目录并逐文件 sha256 对账（验收口径：还原对账）
 * emit    输出独立 POSIX sh 备份脚本（供后续挂 VPS crontab；挂定时是单独一步，本 CLI 不碰生产）
 * --print 只打印将执行的脚本，不执行
 *
 * 环境变量默认值见 scripts/lib/warehouse-backup.mjs（WAREHOUSE_BACKUP_SRC/DIR/KEEP）。
 */
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  beijingDateStamp,
  buildWarehouseBackupScript,
  buildWarehouseVerifyScript,
  resolveWarehouseBackupConfig,
} from './lib/warehouse-backup.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--print') args.print = true;
    else if (a === '--src' || a === '--dest' || a === '--keep' || a === '--out') {
      const key = a.slice(2);
      args[key] = argv[i + 1];
      i += 1;
      if (args[key] === undefined) {
        console.error(`❌ ${a} 缺少取值`);
        process.exit(2);
      }
    } else args._.push(a);
  }
  return args;
}

function configFromArgs(args) {
  const env = { ...process.env };
  if (args.src) env.WAREHOUSE_BACKUP_SRC = args.src;
  if (args.dest) env.WAREHOUSE_BACKUP_DIR = args.dest;
  if (args.keep) env.WAREHOUSE_BACKUP_KEEP = args.keep;
  return resolveWarehouseBackupConfig(env);
}

function runShell(script) {
  const r = spawnSync('sh', ['-c', script], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];

  if (mode === 'backup') {
    const cfg = configFromArgs(args);
    const script = buildWarehouseBackupScript({ ...cfg, dateStamp: beijingDateStamp() });
    if (args.print) return console.log(script);
    return runShell(script);
  }

  if (mode === 'verify') {
    const archivePath = args._[1];
    if (!archivePath) {
      console.error('❌ verify 需要归档路径：verify <archive.tar.gz>');
      process.exit(2);
    }
    const script = buildWarehouseVerifyScript({ archivePath: realpathSync(archivePath) });
    if (args.print) return console.log(script);
    return runShell(script);
  }

  if (mode === 'emit') {
    if (!args.out) {
      console.error('❌ emit 需要 --out FILE');
      process.exit(2);
    }
    const cfg = configFromArgs(args);
    // 独立 sh：日期戳改为脚本运行时自算（crontab 场景无 node），北京时区
    const stamped = buildWarehouseBackupScript({ ...cfg, dateStamp: '19700101', keep: cfg.keep })
      .replace("warehouse-19700101.tar.gz'", "warehouse-'$(TZ=Asia/Shanghai date +%Y%m%d)'.tar.gz'");
    writeFileSync(args.out, `#!/bin/sh\n${stamped}\n`, { mode: 0o755 });
    console.log(`✅ 已输出独立备份脚本：${args.out}（挂 crontab 前先在目标机手动跑一次验证）`);
    return undefined;
  }

  console.error('用法：node scripts/warehouse-backup.mjs <backup|verify|emit> ...（详见文件头注释）');
  process.exit(2);
}

// 中文路径下 import.meta.url 直比 argv 会静默不执行，须 realpathSync 归一
const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) main();
