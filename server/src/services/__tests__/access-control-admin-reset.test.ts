/**
 * 管理员重置密码触发强制设密单测（全员密码闭环 · 阶段二，2026-07-11）
 *
 * 锁定语义（阶段二口径，取代阶段一「管理面改密视为自设」）：
 *   1. updateUser 带 passwordHash → SQL 置空 password_changed_at（NULL），
 *      新哈希只是一次性临时凭据，账号回到 pns 态 → 下次登录被强制自设专属密码
 *   2. 不带 passwordHash → 不触碰 password_hash / password_changed_at
 *   3. 与 authService.isPasswordNotSet 口径闭环：password_changed_at 为空 → pns
 *
 * 测试层级：mock duckdbService 捕获 SQL（不需要真实 DuckDB / 文件系统落盘目录指向 tmp）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-control-admin-reset-'));

vi.mock('../../config/paths.js', () => ({
  getUserStorePath: () => path.join(tmpDir, 'user_store.json'),
}));

const executedSql: string[] = [];
const mockQuery = vi.fn(async (sql: string): Promise<Record<string, unknown>[]> => {
  executedSql.push(sql);
  const normalized = sql.trim();
  // updateUser 尾部回读：SELECT * FROM UserAccount WHERE id = '...'
  if (normalized.startsWith('SELECT * FROM UserAccount') && normalized.includes('WHERE id =')) {
    return [{
      id: 'uid-1',
      username: 'leshan',
      display_name: '乐山机构',
      password_hash: '$2b$04$adminTempHash00000000000000000000000000000000000000000',
      role: 'org_user',
      active: true,
      password_changed_at: null,
    }];
  }
  return [];
});

vi.mock('../duckdb.js', () => ({
  duckdbService: { query: (sql: string) => mockQuery(sql) },
}));

import { updateUser } from '../access-control.js';

beforeEach(() => {
  executedSql.length = 0;
  mockQuery.mockClear();
});

function findUpdateSql(): string {
  const sql = executedSql.find((s) => s.trim().startsWith('UPDATE UserAccount'));
  expect(sql, 'updateUser 应发出 UPDATE UserAccount').toBeDefined();
  return sql!;
}

describe('updateUser · 管理员重置密码 → 强制设密（pns）', () => {
  it('带 passwordHash：置空 password_changed_at（NULL），不再写入时间戳', async () => {
    const updated = await updateUser('uid-1', {
      displayName: '乐山机构',
      passwordHash: '$2b$04$adminTempHash00000000000000000000000000000000000000000',
      role: 'org_user',
    });

    const sql = findUpdateSql();
    expect(sql).toContain("password_hash = '$2b$04$adminTempHash");
    expect(sql).toContain('password_changed_at = NULL');
    // 阶段一旧行为（写入当前时间戳）必须消失，否则临时密码变长期密码
    expect(sql).not.toMatch(/password_changed_at = '20/);

    // 回读结果映射：password_changed_at 为空 → passwordChangedAt undefined（pns 判定输入）
    expect(updated.passwordChangedAt).toBeUndefined();
  });

  it('不带 passwordHash：不触碰 password_hash / password_changed_at', async () => {
    await updateUser('uid-1', {
      displayName: '乐山机构',
      role: 'org_user',
    });
    const sql = findUpdateSql();
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('password_changed_at');
  });
});
