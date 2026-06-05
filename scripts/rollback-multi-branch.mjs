#!/usr/bin/env node
/**
 * 多分公司 RLS 一键回滚（plan v2 Phase 0F）
 *
 * 用途：山西上线后出现严重事故时，把 BRANCH_RLS_ENABLED 切回 false，
 *      用户立即回到 0C 之前的单租户行为（permissionMiddleware 不注入 branch_code），
 *      Parquet 的 branch_code 列保留（无需 backfill 回滚）。
 *
 * 行为：
 *   1. 读取 ecosystem.config.cjs 当前 env.BRANCH_RLS_ENABLED 值
 *   2. 若已是 'false' / 未设置 → 直接退出（no-op）
 *   3. dry-run 模式：打印将要执行的命令，不实际执行
 *   4. apply 模式：把 ecosystem.config.cjs 中 BRANCH_RLS_ENABLED 改为 'false'，
 *      并调用 sudo /usr/local/bin/deploy-chexian-api reload 让 PM2 加载新 env
 *
 * 用法：
 *   node scripts/rollback-multi-branch.mjs --dry-run    # 默认 dry-run
 *   node scripts/rollback-multi-branch.mjs --apply      # 实际执行
 *
 * 配套文档：.claude/rules/multi-branch-rollback-sop.md
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ECOSYSTEM_PATH = resolve(ROOT, 'ecosystem.config.cjs');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = !apply || args.includes('--dry-run');

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`ℹ️  ${msg}`);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

if (!existsSync(ECOSYSTEM_PATH)) {
  fail(`ecosystem.config.cjs 不存在: ${ECOSYSTEM_PATH}`);
}

const raw = readFileSync(ECOSYSTEM_PATH, 'utf-8');

// 检测当前值（容忍单/双引号 + 任意空白）
const re = /BRANCH_RLS_ENABLED\s*:\s*['"]([^'"]*)['"]/;
const match = raw.match(re);

if (!match) {
  info('ecosystem.config.cjs 未设置 BRANCH_RLS_ENABLED，运行时默认 false。');
  info('环境本身已经在回滚态，无需操作。');
  process.exit(0);
}

const currentValue = match[1];
info(`当前 BRANCH_RLS_ENABLED = '${currentValue}'`);

if (currentValue !== 'true') {
  info('已经是回滚态（非 true 值），no-op 退出。');
  process.exit(0);
}

const next = raw.replace(re, "BRANCH_RLS_ENABLED: 'false'");

if (dryRun) {
  console.log('\n=== DRY-RUN ===');
  console.log('将把 ecosystem.config.cjs 中 BRANCH_RLS_ENABLED 改为 \'false\'：');
  console.log("  -  BRANCH_RLS_ENABLED: 'true'");
  console.log("  +  BRANCH_RLS_ENABLED: 'false'");
  console.log('\n然后执行：');
  console.log('  sudo /usr/local/bin/deploy-chexian-api reload');
  console.log('\n💡 加 --apply 实际执行');
  process.exit(0);
}

// apply 模式
writeFileSync(ECOSYSTEM_PATH, next, 'utf-8');
ok(`ecosystem.config.cjs 已更新：BRANCH_RLS_ENABLED = 'false'`);

try {
  info('调用 sudo /usr/local/bin/deploy-chexian-api reload ...');
  execSync('sudo /usr/local/bin/deploy-chexian-api reload', { stdio: 'inherit' });
  ok('PM2 reload 完成，多分公司 RLS 已禁用，回到单租户行为');
} catch (err) {
  fail(`PM2 reload 失败: ${err.message}`);
}

console.log('\n📝 后续动作：');
console.log('  1. 检查 https://chexian.cretvalu.com/health 返回 200');
console.log('  2. 用 SC 超管账号 curl /api/query/kpi 验证返回行数与回滚前一致');
console.log('  3. 在 .claude/workflow/pr-evolution.md 登记本次回滚原因');
console.log('  4. 修复根因后，重新启用 RLS 需手动改回 ecosystem.config.cjs 并 reload');
