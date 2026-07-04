#!/usr/bin/env node
/**
 * 角色路由白名单 store ↔ 源码 preset 对齐工具（BACKLOG 45faef）
 *
 * 背景：user_store.json 存在时启动走 loadFromStore（store 是运维权威，管理面
 * updateRole 可改），源码 PRESET_ROLES 的 allowedRoutes 演进（如 ORG_ROLE_
 * ALLOWED_ROUTES 新增 /home）不会自动落到生产 store —— 两套事实静默漂移。
 * 生产实证（2026-06-27）：org_user 登录返回缺 /home。
 *
 * 用法（在 server/ 同级或用 --store 指定路径）：
 *   node scripts/ops/align-role-routes.mjs                # dry-run：只打印 diff
 *   node scripts/ops/align-role-routes.mjs --apply        # 备份后把 preset 值写入 store
 *   node scripts/ops/align-role-routes.mjs --store /var/www/chexian/server/data/user_store.json --apply
 *
 * 安全设计：
 * - 默认 dry-run，必须人工读过 diff 再 --apply（管理面可能有故意的修改）
 * - --apply 先写 <store>.bak.<时间戳> 备份再原子替换（tmp + rename）
 * - 只改 roles[].allowedRoutes / defaultRoute，users 与其余字段原样保留
 * - 对齐后需 reload 服务生效：sudo /usr/local/bin/deploy-chexian-api reload
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const storeArgIdx = args.indexOf('--store');
const storePath = storeArgIdx >= 0
  ? args[storeArgIdx + 1]
  : path.join(repoRoot, 'server', 'data', 'user_store.json');

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法: node scripts/ops/align-role-routes.mjs [--store <path>] [--apply]');
  console.log('默认 dry-run 只打印 diff；--apply 备份后写回。生产 store 位于');
  console.log('/var/www/chexian/server/data/user_store.json，改后需 wrapper reload 生效。');
  process.exit(0);
}

// 动态 import TS 编译产物不可用（脚本独立运行），preset 单一事实源在
// server/src/config/preset-users.ts —— 用 dist 编译产物读取，避免复制常量造成第二事实源
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
const roles = store.roles || [];

let driftCount = 0;
for (const preset of PRESET_ROLES) {
  if (!preset.allowedRoutes) continue;
  const stored = roles.find((r) => r.role === preset.role);
  if (!stored) continue;
  const storedRoutes = stored.allowedRoutes || [];
  const missing = preset.allowedRoutes.filter((r) => !storedRoutes.includes(r));
  const extra = storedRoutes.filter((r) => !preset.allowedRoutes.includes(r));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${preset.role}: 与源码 preset 一致 (${storedRoutes.length} 条)`);
    continue;
  }
  driftCount += 1;
  console.log(`⚠ ${preset.role}: 漂移`);
  console.log(`    store 现值: ${JSON.stringify(storedRoutes)}`);
  console.log(`    源码 preset: ${JSON.stringify(preset.allowedRoutes)}`);
  if (missing.length) console.log(`    store 缺少: ${JSON.stringify(missing)}`);
  if (extra.length) console.log(`    store 多出: ${JSON.stringify(extra)}（若为管理面有意添加，请勿 --apply，改用管理面校正）`);
  if (apply) {
    stored.allowedRoutes = [...preset.allowedRoutes];
    if (preset.defaultRoute !== undefined) stored.defaultRoute = preset.defaultRoute;
    console.log(`    → 已按源码 preset 覆盖`);
  }
}

if (driftCount === 0) {
  console.log('\n结论：无漂移，无需操作。');
  process.exit(0);
}
if (!apply) {
  console.log(`\n结论：${driftCount} 个角色漂移（dry-run 未写入）。确认 diff 无误后加 --apply 执行。`);
  process.exit(0);
}

const backupPath = `${storePath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(storePath, backupPath);
const tmpPath = `${storePath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2));
fs.renameSync(tmpPath, storePath);
console.log(`\n✅ 已写回 ${storePath}（备份: ${backupPath}）`);
console.log('   生产上需 reload 生效: sudo /usr/local/bin/deploy-chexian-api reload');
