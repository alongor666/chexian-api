/**
 * admin-import-pat-from-json — 一次性 PAT JSON → SQLite 迁移工具（v5 Phase 3, B298）
 *
 * 与 admin-import-users-from-json 同构，scope='pat'，独立 lock 文件。
 * **禁止**做成 env-driven 启动钩子（同 Phase 2 决策）：
 *   - 迁移是非幂等的语义动作（首次成功后必须拒绝二次执行，否则覆盖运行期变动）
 *   - env 一旦设错就在每次 PM2 reload 都触发，无法区分意图
 *
 * 调用方式（VPS deployer 用户）：
 *
 *   cd /var/www/chexian/server
 *   STATE_STORE_BACKEND=sqlite STATE_DB_PATH=./data/state.db \
 *     node dist/scripts/admin-import-pat-from-json.js
 *
 * 外部 marker：`server/data/.state-migration-pat.lock`
 *   - 存在 → 拒绝重导入（防止误执行擦掉运行期写入）
 *   - 内容：JSON { migrated_at, source_hash, scope: 'pat' }
 *   - 删 state.db 后再跑：本命令仍拒绝（lock 还在）→ 必须人工 rm lock 后重跑（明确意图）
 *
 * 退出码：
 *   0 = 成功导入 / 已有 lock 直接跳过（再跑也不破坏数据）
 *   1 = JSON 文件缺失、解析失败、SQLite 写入失败、env 配置错误、state.db 已有数据但 lock 缺失
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbEnv } from '../config/env.js';
import { getApiTokenStorePath, getStateMigrationLockPath } from '../config/paths.js';
import * as stateDb from '../services/state-db.js';
import {
  hasPatDataInSqlite,
  replaceAllPatsInSqlite,
  type PatRecord,
} from '../services/personal-access-token-store.js';

interface ApiTokenStoreJson {
  version: number;
  exportedAt: string;
  tokens: Array<{
    token_id: string;
    token_hash: string;
    user_id: string;
    username: string;
    name: string;
    expires_at: string;
    last_used_at: string | null;
    last_used_ip: string | null;
    created_at: string;
    revoked_at: string | null;
  }>;
}

interface MigrationLock {
  migrated_at: string;
  source_hash: string;
  scope: 'pat';
}

function exitWith(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

async function main(): Promise<void> {
  if (dbEnv.STATE_STORE_BACKEND !== 'sqlite') {
    exitWith(
      1,
      `[admin-import-pat] 拒绝执行: 需 STATE_STORE_BACKEND=sqlite，当前=${dbEnv.STATE_STORE_BACKEND}`,
    );
  }

  const lockPath = getStateMigrationLockPath('pat');
  if (fs.existsSync(lockPath)) {
    const existing = fs.readFileSync(lockPath, 'utf-8');
    console.log(`[admin-import-pat] 已存在 PAT migration lock，跳过重导入:\n${existing}`);
    console.log(`[admin-import-pat] 若需强制重导入，先删除 ${lockPath} 并确认运行期 state.db api_tokens 可丢弃。`);
    return;
  }

  const jsonPath = getApiTokenStorePath();
  if (!fs.existsSync(jsonPath)) {
    exitWith(1, `[admin-import-pat] api_tokens.json 不存在: ${jsonPath}`);
  }

  let parsed: ApiTokenStoreJson;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    parsed = JSON.parse(raw) as ApiTokenStoreJson;
  } catch (err) {
    exitWith(
      1,
      `[admin-import-pat] api_tokens.json 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed.tokens)) {
    exitWith(1, '[admin-import-pat] JSON 缺少 tokens 数组');
  }

  console.log(`[admin-import-pat] source=${jsonPath} tokens=${parsed.tokens.length}`);

  stateDb.init();
  try {
    if (await hasPatDataInSqlite()) {
      exitWith(
        1,
        '[admin-import-pat] state.db 已存在 api_tokens 数据但 marker lock 缺失（异常状态）。手工核查后再决定是否清表。',
      );
    }
    const records: PatRecord[] = parsed.tokens.map((t) => ({
      token_id: t.token_id,
      token_hash: t.token_hash,
      user_id: t.user_id,
      username: t.username,
      name: t.name,
      expires_at: t.expires_at,
      last_used_at: t.last_used_at,
      last_used_ip: t.last_used_ip,
      created_at: t.created_at,
      revoked_at: t.revoked_at,
    }));
    await replaceAllPatsInSqlite(records);
  } catch (err) {
    exitWith(
      1,
      `[admin-import-pat] SQLite 写入失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    stateDb.close();
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf-8');
  const sourceHash = crypto.createHash('sha256').update(rawJson).digest('hex').slice(0, 16);
  const lock: MigrationLock = {
    migrated_at: new Date().toISOString(),
    source_hash: sourceHash,
    scope: 'pat',
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
  console.log(`[admin-import-pat] 完成。lock 写入: ${lockPath}`);
  console.log('[admin-import-pat] 现在可重启 PM2 让 backend=sqlite 双写生效。');
}

main().catch((err) => {
  console.error('[admin-import-pat] 未处理异常:', err);
  process.exit(1);
});
