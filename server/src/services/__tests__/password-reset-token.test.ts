/**
 * 找回/重置令牌机制单测（全员密码闭环 · 阶段二找回双通道，2026-07-11）
 *
 * 锁定语义：
 *   1. 令牌格式 cx_rst_<id8>.<secret43>；持久层只存 bcrypt(secret) + kind='reset'，明文不落盘
 *   2. kind 隔离：activation 令牌打不了 reset 消费口、reset 令牌打不了 activate 消费口（统一错误）
 *   3. 一次性：消费成功后重放 → 统一错误；过期（含短 TTL 飞书链路）→ 统一错误（防枚举）
 *   4. 重发即取代按 kind 隔离：重发 reset 令牌不影响在途 activation 令牌，反之亦然
 *   5. 消费成功返回 createdBy（'feishu-reset' vs 管理员名），供通知区分「飞书找回/管理员重置」
 *
 * 测试层级：backend=json 单层存储（store 文件指向临时目录），mock access-control。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcrypt';
import type { AccessUser } from '../access-control.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-token-test-'));
const storePath = path.join(tmpDir, 'activation_tokens.json');

vi.mock('../../config/paths.js', () => ({
  getActivationTokenStorePath: () => storePath,
  getDataDir: () => tmpDir,
}));

vi.mock('../../config/env.js', () => ({
  dbEnv: { STATE_STORE_BACKEND: 'json' },
}));

vi.mock('../../config/auth.js', () => ({
  authConfig: { bcryptSaltRounds: 4 },
}));

const activeUser: AccessUser = {
  id: 'uid-leshan',
  username: 'leshan',
  displayName: '乐山机构',
  passwordHash: '$2b$10$LeshanPlaceholderHash000000000000000000000000000000000u',
  role: 'org_user',
  branchCode: 'SC',
  active: true,
};

const mockGetUserById = vi.fn(async (_id: string): Promise<AccessUser | null> => activeUser);
const mockSetUserPasswordByUsername = vi.fn(
  async (_username: string, _hash: string): Promise<AccessUser> => ({
    ...activeUser,
    passwordChangedAt: new Date().toISOString(),
  })
);

vi.mock('../access-control.js', () => ({
  getUserById: (id: string) => mockGetUserById(id),
  setUserPasswordByUsername: (u: string, h: string) => mockSetUserPasswordByUsername(u, h),
}));

import {
  createActivationToken,
  createPasswordResetToken,
  activateWithToken,
  resetPasswordWithToken,
} from '../activation-token.js';
import { AppError } from '../../middleware/error.js';

const RESET_UNIFIED = '重置令牌无效或已过期';
const ACTIVATION_UNIFIED = '激活令牌无效或已过期';

function readStoreFile(): { tokens: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
}

beforeEach(() => {
  mockGetUserById.mockClear();
  mockSetUserPasswordByUsername.mockClear();
  mockGetUserById.mockResolvedValue(activeUser);
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createPasswordResetToken', () => {
  it('返回 cx_rst_<id8>.<secret> 明文；持久层只存 bcrypt(secret) + kind=reset，明文不落盘', async () => {
    const created = await createPasswordResetToken({
      userId: activeUser.id,
      username: activeUser.username,
      createdBy: 'admin',
    });
    expect(created.plaintext).toMatch(/^cx_rst_[0-9A-Z]{8}\.[A-Za-z0-9_-]{40,}$/);
    // 管理员链路默认 24h
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);

    const secret = created.plaintext.split('.')[1];
    const file = readStoreFile();
    expect(file.tokens).toHaveLength(1);
    const rec = file.tokens[0];
    expect(rec.kind).toBe('reset');
    expect(rec.created_by).toBe('admin');
    expect(rec.used_at).toBeNull();
    expect(JSON.stringify(file)).not.toContain(secret);
    expect(bcrypt.compareSync(secret, String(rec.token_hash))).toBe(true);
  });

  it('ttlMs 可覆盖（飞书找回链路 10 分钟）', async () => {
    const created = await createPasswordResetToken({
      userId: activeUser.id,
      username: activeUser.username,
      createdBy: 'feishu-reset',
      ttlMs: 10 * 60 * 1000,
    });
    const remainingMs = created.expiresAt.getTime() - Date.now();
    expect(remainingMs).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(remainingMs).toBeGreaterThan(9 * 60 * 1000);
  });

  it('重发即取代按 kind 隔离：重发 reset 不影响在途 activation，activation 仍可消费', async () => {
    const act = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    const rst1 = await createPasswordResetToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    const rst2 = await createPasswordResetToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });

    // 旧 reset 令牌已被取代
    const errOldReset = await resetPasswordWithToken(rst1.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(errOldReset).toBeInstanceOf(AppError);
    expect((errOldReset as AppError).message).toBe(RESET_UNIFIED);

    // activation 令牌不受 reset 重发影响
    await expect(activateWithToken(act.plaintext, 'BrandNew#2026')).resolves.toBe('leshan');
    // 新 reset 令牌可用
    const consumed = await resetPasswordWithToken(rst2.plaintext, 'Another#2026');
    expect(consumed.username).toBe('leshan');
  });
});

describe('resetPasswordWithToken', () => {
  it('成功：写密码 + 令牌作废，返回 username/createdBy/tokenId（createdBy 供通知区分来源）', async () => {
    const created = await createPasswordResetToken({
      userId: activeUser.id,
      username: activeUser.username,
      createdBy: 'feishu-reset',
    });
    const consumed = await resetPasswordWithToken(created.plaintext, 'BrandNew#2026');
    expect(consumed).toEqual({ username: 'leshan', createdBy: 'feishu-reset', tokenId: created.tokenId });

    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1);
    const [u, hash] = mockSetUserPasswordByUsername.mock.calls[0];
    expect(u).toBe('leshan');
    expect(bcrypt.compareSync('BrandNew#2026', hash)).toBe(true);
    expect(readStoreFile().tokens[0].used_at).not.toBeNull();
  });

  it('一次性：同一令牌第二次消费 → 统一错误', async () => {
    const created = await createPasswordResetToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    await resetPasswordWithToken(created.plaintext, 'BrandNew#2026');

    const err = await resetPasswordWithToken(created.plaintext, 'Another#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
    expect((err as AppError).message).toBe(RESET_UNIFIED);
    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1);
  });

  it('过期（飞书短 TTL 10 分钟走过 11 分钟）→ 统一错误', async () => {
    const created = await createPasswordResetToken({
      userId: activeUser.id,
      username: activeUser.username,
      createdBy: 'feishu-reset',
      ttlMs: 10 * 60 * 1000,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
    const err = await resetPasswordWithToken(created.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe(RESET_UNIFIED);
  });

  it('secret 错误 / 格式非法 / 不存在的 tokenId / 账号停用 → 一律统一错误（防枚举）', async () => {
    const created = await createPasswordResetToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    const cases = [
      `cx_rst_${created.tokenId}.${'x'.repeat(43)}`, // secret 错误
      'not-a-token',
      'cx_pat_ABCDEFGH.' + 'x'.repeat(43), // PAT 前缀不是重置令牌
      'cx_rst_ZZZZZZZZ.' + 'x'.repeat(43), // 不存在的 tokenId
    ];
    for (const raw of cases) {
      const err = await resetPasswordWithToken(raw, 'BrandNew#2026').catch((e) => e);
      expect(err, raw).toBeInstanceOf(AppError);
      expect((err as AppError).message, raw).toBe(RESET_UNIFIED);
    }

    mockGetUserById.mockResolvedValueOnce({ ...activeUser, active: false });
    const errInactive = await resetPasswordWithToken(created.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(errInactive).toBeInstanceOf(AppError);
    expect((errInactive as AppError).message).toBe(RESET_UNIFIED);
  });

  it('弱密码被拒：返回具体策略原因，令牌不烧，可换合规密码重试', async () => {
    const created = await createPasswordResetToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    for (const weak of ['Chexian@2026', 'leshan2026A', '12345678', 'short1A']) {
      const err = await resetPasswordWithToken(created.plaintext, weak).catch((e) => e);
      expect(err, weak).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode, weak).toBe(400);
      expect((err as AppError).message, weak).not.toBe(RESET_UNIFIED);
    }
    expect(readStoreFile().tokens[0].used_at).toBeNull();
    await expect(resetPasswordWithToken(created.plaintext, 'BrandNew#2026')).resolves.toMatchObject({ username: 'leshan' });
  });
});

describe('kind 隔离（activation ↔ reset 互不通用）', () => {
  it('activation 令牌打 reset 消费口 → 统一 reset 错误，令牌不烧、仍可正常激活', async () => {
    const act = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });

    const err = await resetPasswordWithToken(act.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe(RESET_UNIFIED);
    expect(mockSetUserPasswordByUsername).not.toHaveBeenCalled();

    await expect(activateWithToken(act.plaintext, 'BrandNew#2026')).resolves.toBe('leshan');
  });

  it('reset 令牌打 activate 消费口 → 统一 activation 错误，令牌不烧、仍可正常重设', async () => {
    const rst = await createPasswordResetToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });

    const err = await activateWithToken(rst.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe(ACTIVATION_UNIFIED);
    expect(mockSetUserPasswordByUsername).not.toHaveBeenCalled();

    await expect(resetPasswordWithToken(rst.plaintext, 'BrandNew#2026')).resolves.toMatchObject({ username: 'leshan' });
  });
});
