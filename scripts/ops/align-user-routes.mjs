#!/usr/bin/env node
/**
 * 用户级路由白名单 store ↔ 源码 preset 对齐工具
 *
 * 背景：既有 align-role-routes.mjs 只对齐 store.roles，不动 store.users。
 * 但登录/会话（/api/auth/me 与 /login）返回的 allowedRoutes 取自**用户级**记录 ——
 * 源码 ORG_ROLE_ALLOWED_ROUTES 自 2026-05-15 起已含 '/home'，角色级 store 也已
 * 对齐，用户级记录却停在旧三条（/performance-analysis /growth /specialty），
 * org_user 登录后始终看不到首页。生产实证（2026-07-10）：手工给 tianfu 补
 * '/home' 后 owner 实测恢复。本脚本把这一机制缺口补上。
 *
 * 用法（在 server/ 同级或用 --store 指定路径）：
 *   node scripts/ops/align-user-routes.mjs                # dry-run：只打印逐用户 diff
 *   node scripts/ops/align-user-routes.mjs --apply        # 备份后把缺失路由补进 store
 *   node scripts/ops/align-user-routes.mjs --store /var/www/chexian/server/data/user_store.json --apply
 *
 * 安全设计（与角色级工具的"整体覆盖"刻意不同）：
 * - **只补缺失、不删多余** —— 管理面可能给个别用户有意加过路由，多出项只提示不回收
 * - 只动 users[].allowedRoutes，绝不触碰 passwordHash / branchCode / active /
 *   organization 等其余字段（RLS-on 生产上 branchCode 丢失 = 全员 401 事故）
 * - 默认 dry-run，必须人工读过 diff 再 --apply
 * - --apply 先写 <store>.bak.<时间戳> 备份再原子替换（tmp + rename）
 * - 对齐后需 reload 服务生效：sudo /usr/local/bin/deploy-chexian-api reload
 *
 * 纯对齐逻辑在 scripts/lib/align-user-routes-core.mjs（vitest：
 * scripts/__tests__/align-user-routes.test.mjs 覆盖补缺/不删多余/字段不动/幂等）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { planUserRouteAdditions, applyUserRouteAdditions } from '../lib/align-user-routes-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const storeArgIdx = args.indexOf('--store');
const storePath = storeArgIdx >= 0
  ? args[storeArgIdx + 1]
  : path.join(repoRoot, 'server', 'data', 'user_store.json');

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法: node scripts/ops/align-user-routes.mjs [--store <path>] [--apply]');
  console.log('把 store 中用户级 allowedRoutes 与源码 PRESET_ROLES 对齐：只补缺失、不删多余。');
  console.log('默认 dry-run 只打印逐用户 diff；--apply 备份后写回。生产 store 位于');
  console.log('/var/www/chexian/server/data/user_store.json，改后需 wrapper reload 生效。');
  process.exit(0);
}

// preset 单一事实源在 server/src/config/preset-users.ts —— 用 dist 编译产物读取，
// 避免复制常量造成第二事实源（与 align-role-routes.mjs 同一做法）
const presetDist = path.join(repoRoot, 'server', 'dist', 'config', 'preset-users.js');
if (!fs.existsSync(presetDist)) {
  console.error(`✗ 未找到编译产物 ${presetDist}`);
  console.error('  先构建: cd server && bun run build（生产机上 dist 已随部署就位）');
  process.exit(1);
}
const { PRESET_ROLES } = await import(pathToFileURL(presetDist).href);

if (!fs.existsSync(storePath)) {
  console.error(`✗ store 不存在: ${storePath}（无 store 时启动走 seedFromPreset，本就无漂移）`);
  process.exit(1);
}
const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));

const plan = planUserRouteAdditions(store, PRESET_ROLES);
if (plan.length === 0) {
  console.log('结论：store 中没有角色级声明了 allowedRoutes 的用户（如 org_user），无需操作。');
  process.exit(0);
}

let driftCount = 0;
for (const entry of plan) {
  if (entry.missing.length === 0) {
    console.log(`✓ ${entry.username} (${entry.role}): 已含全部 preset 路由 (${entry.current.length} 条)`);
    if (entry.extra.length) console.log(`    store 多出: ${JSON.stringify(entry.extra)}（保留不删）`);
    continue;
  }
  driftCount += 1;
  console.log(`⚠ ${entry.username} (${entry.role}): 缺失 ${JSON.stringify(entry.missing)}`);
  console.log(`    store 现值: ${entry.hadRoutesField ? JSON.stringify(entry.current) : '（无 allowedRoutes 字段）'}`);
  if (entry.extra.length) console.log(`    store 多出: ${JSON.stringify(entry.extra)}（保留不删）`);
  if (apply) console.log(`    → 将补入缺失路由（其余字段不动）`);
}

if (driftCount === 0) {
  console.log('\n结论：全部用户已对齐，无需操作。');
  process.exit(0);
}
if (!apply) {
  console.log(`\n结论：${driftCount} 个用户缺失路由（dry-run 未写入）。确认 diff 无误后加 --apply 执行。`);
  process.exit(0);
}

const nextStore = applyUserRouteAdditions(store, plan);
const backupPath = `${storePath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(storePath, backupPath);
const tmpPath = `${storePath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(nextStore, null, 2));
fs.renameSync(tmpPath, storePath);
console.log(`\n✅ 已写回 ${storePath}（备份: ${backupPath}）`);
console.log('   生产上需 reload 生效: sudo /usr/local/bin/deploy-chexian-api reload');
