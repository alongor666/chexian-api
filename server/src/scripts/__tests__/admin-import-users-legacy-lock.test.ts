/**
 * codex P2 (PR #389) 回归测试：admin-import-users-from-json 兼容 Phase 2 旧 lock
 *
 * 场景：Phase 2 已部署生产 VPS 上存在 `.state-migration.lock`（无 scope 后缀）。
 * Phase 3 把 lock 路径改为 `.state-migration-users.lock` → 旧锁将被忽略 →
 * `admin-import-users` 会被允许再次导入 → 用旧 user_store.json 覆盖运行期用户/角色变更。
 *
 * 修复策略：
 *  1. paths.ts 新增 getLegacyStateMigrationLockPath() 暴露旧路径
 *  2. admin-import-users-from-json 检查旧锁与新锁都视为「已迁移」
 *  3. 自动复制旧锁到新文件名（保留旧锁，防止其他工具回滚语义）
 *
 * 本测以源码 contract 形式锚定，避免回归。
 */

import { describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';

const repoRoot = path.resolve(__dirname, '../../../..');
const scriptPath = path.join(repoRoot, 'server/src/scripts/admin-import-users-from-json.ts');
const pathsPath = path.join(repoRoot, 'server/src/config/paths.ts');

const scriptSrc = fs.readFileSync(scriptPath, 'utf-8');
const pathsSrc = fs.readFileSync(pathsPath, 'utf-8');

describe('codex P2 PR#389: admin-import-users 兼容旧 lock', () => {
  it('paths.ts 暴露 getLegacyStateMigrationLockPath 返回旧路径', () => {
    expect(pathsSrc).toContain('export function getLegacyStateMigrationLockPath()');
    // 旧路径不带 scope 后缀，与 Phase 2 已部署文件一致
    expect(pathsSrc).toMatch(/getLegacyStateMigrationLockPath[\s\S]{0,200}'\.state-migration\.lock'/);
  });

  it('admin-import-users 同时检查新锁和旧锁路径', () => {
    expect(scriptSrc).toContain('getLegacyStateMigrationLockPath');
    expect(scriptSrc).toContain(`getStateMigrationLockPath('users')`);
    // 必须有「检测到旧 marker lock → 视为已迁移」的语义提示
    expect(scriptSrc).toMatch(/Phase 2.*?旧 marker lock|旧.*?lock.*?视为已迁移|legacy.*?lock/);
  });

  it('admin-import-users 自动把旧锁内容复制/升级到新文件名', () => {
    // 关键：保留旧锁不删（避免其他工具回滚语义），同时建立新锁让本工具下次识别
    expect(scriptSrc).toMatch(/copyFileSync|writeFileSync.*lockPath/);
  });
});
