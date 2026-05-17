/**
 * admin-import-users-from-json — 一次性 users / roles JSON → SQLite 迁移工具
 *
 * v5 状态持久层 Phase 2（B297）的一次性命令。**禁止**做成 env-driven 启动钩子：
 *   - 迁移是非幂等的语义动作（首次成功后必须拒绝二次执行，否则覆盖运行期变动）
 *   - env 一旦设错就在每次 PM2 reload 都触发，无法区分意图
 *
 * 调用方式（VPS deployer 用户）：
 *
 *   cd /var/www/chexian/server
 *   STATE_STORE_BACKEND=sqlite STATE_DB_PATH=./data/state.db \
 *     node dist/scripts/admin-import-users-from-json.js
 *
 * 外部 marker：`server/data/.state-migration.lock`
 *   - 存在 → 拒绝重导入（防止误执行擦掉运行期写入）
 *   - 内容：JSON { migrated_at, source_hash, scope }
 *   - 删 state.db 后再跑：本命令仍拒绝（lock 还在）→ 必须人工 rm lock 后重跑（明确意图）
 *
 * 退出码：
 *   0 = 成功导入 / 已有 lock 直接跳过（再跑也不破坏数据）
 *   1 = JSON 文件缺失、解析失败、SQLite 写入失败、env 配置错误
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbEnv } from '../config/env.js';
import { getUserStorePath, getStateMigrationLockPath } from '../config/paths.js';
import * as stateDb from '../services/state-db.js';
import * as accessControlStore from '../services/access-control-store.js';
import type { AccessUser, AccessRole } from '../services/access-control.js';

interface UserStoreJson {
  version: number;
  exportedAt: string;
  users: AccessUser[];
  roles: AccessRole[];
}

interface MigrationLock {
  migrated_at: string;
  source_hash: string;
  scope: 'users';
}

function exitWith(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

function main(): void {
  if (dbEnv.STATE_STORE_BACKEND !== 'sqlite') {
    exitWith(
      1,
      `[admin-import] 拒绝执行: 需 STATE_STORE_BACKEND=sqlite，当前=${dbEnv.STATE_STORE_BACKEND}`,
    );
  }

  const lockPath = getStateMigrationLockPath('users');
  if (fs.existsSync(lockPath)) {
    const existing = fs.readFileSync(lockPath, 'utf-8');
    console.log(`[admin-import] 已存在 migration lock，跳过重导入:\n${existing}`);
    console.log(`[admin-import] 若需强制重导入，先删除 ${lockPath} 并确认运行期 state.db 数据可丢弃。`);
    return;
  }

  const jsonPath = getUserStorePath();
  if (!fs.existsSync(jsonPath)) {
    exitWith(1, `[admin-import] user_store.json 不存在: ${jsonPath}`);
  }

  let parsed: UserStoreJson;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    parsed = JSON.parse(raw) as UserStoreJson;
  } catch (err) {
    exitWith(1, `[admin-import] user_store.json 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.roles)) {
    exitWith(1, '[admin-import] JSON 缺少 users 或 roles 数组');
  }

  console.log(
    `[admin-import] source=${jsonPath} users=${parsed.users.length} roles=${parsed.roles.length}`,
  );

  stateDb.init();
  try {
    if (accessControlStore.hasData()) {
      exitWith(
        1,
        '[admin-import] state.db 已存在 access_users 数据但 marker lock 缺失（异常状态）。手工核查后再决定是否清表。',
      );
    }
    accessControlStore.replaceAll({ users: parsed.users, roles: parsed.roles });
  } catch (err) {
    exitWith(1, `[admin-import] SQLite 写入失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    stateDb.close();
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf-8');
  const sourceHash = crypto.createHash('sha256').update(rawJson).digest('hex').slice(0, 16);
  const lock: MigrationLock = {
    migrated_at: new Date().toISOString(),
    source_hash: sourceHash,
    scope: 'users',
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
  console.log(`[admin-import] 完成。lock 写入: ${lockPath}`);
  console.log(`[admin-import] 现在可重启 PM2 让 backend=sqlite 双写生效。`);
}

main();
