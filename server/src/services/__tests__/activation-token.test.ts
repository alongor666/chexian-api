/**
 * 激活令牌机制单测（全员密码闭环 · 2026-07-11）
 *
 * 锁定语义：
 *   1. 令牌格式 cx_act_<id8>.<secret43>；持久层只存 bcrypt(secret)，明文不落盘
 *   2. 一次性：消费成功后重放 → 统一错误；secret 错误 / 过期 / 账号停用 → 统一错误（防枚举）
 *   3. 弱密码被拒时令牌不烧（策略校验在占用之前），换合规密码可直接重试
 *   4. 重发即取代：同一账号旧的未使用令牌被作废
 *
 * 测试层级：backend=json 单层存储（store 文件指向临时目录），mock access-control。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcrypt';
import type { AccessUser } from '../access-control.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-token-test-'));
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
  id: 'uid-liangchunfan',
  username: 'liangchunfan',
  displayName: '山西管理员（梁春帆）',
  passwordHash: '$2b$10$LiangchunfanTombstone0000000000000000000000000000000u',
  role: 'branch_admin',
  branchCode: 'SX',
  active: true,
};

const mockGetUserById = vi.fn(async (_id: string): Promise<AccessUser | null> => activeUser);
const mockSetUserPasswordByUsername = vi.fn(
  async (_username: string, _hash: string): Promise<AccessUser> => ({
    ...activeUser,
    passwordChangedAt: new Date().toISOString(),
  })
);
let passwordAllowed = true;

vi.mock('../access-control.js', () => ({
  getUserById: (id: string) => mockGetUserById(id),
  setUserPasswordByUsername: (u: string, h: string) => mockSetUserPasswordByUsername(u, h),
}));

vi.mock('../credential-policy.js', () => ({
  assertPasswordAllowed: async () => {
    if (!passwordAllowed) throw Object.assign(new Error('AUTH_METHOD_NOT_ALLOWED'), { statusCode: 403 });
    return { userId: activeUser.id, passwordHash: 'hash', state: 'active' };
  },
}));

import { createActivationToken, activateWithToken } from '../activation-token.js';
import { AppError } from '../../middleware/error.js';

const UNIFIED = '激活令牌无效或已过期';

function readStoreFile(): { tokens: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
}

beforeEach(() => {
  mockGetUserById.mockClear();
  mockSetUserPasswordByUsername.mockClear();
  mockGetUserById.mockResolvedValue(activeUser);
  passwordAllowed = true;
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createActivationToken', () => {
  it('飞书-only 账号不能签发激活令牌', async () => {
    passwordAllowed = false;
    await expect(createActivationToken({
      userId: activeUser.id,
      username: activeUser.username,
      createdBy: 'admin',
    })).rejects.toMatchObject({ statusCode: 403, message: 'AUTH_METHOD_NOT_ALLOWED' });
  });
  it('返回 cx_act_<id8>.<secret> 明文；持久层只存 bcrypt(secret)，明文不落盘', async () => {
    const created = await createActivationToken({
      userId: activeUser.id,
      username: activeUser.username,
      createdBy: 'admin',
    });
    expect(created.plaintext).toMatch(/^cx_act_[0-9A-Z]{8}\.[A-Za-z0-9_-]{40,}$/);
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);

    const secret = created.plaintext.split('.')[1];
    const file = readStoreFile();
    expect(file.tokens).toHaveLength(1);
    const rec = file.tokens[0];
    expect(rec.token_id).toBe(created.tokenId);
    expect(rec.created_by).toBe('admin');
    expect(rec.used_at).toBeNull();
    // 明文 secret 不出现在存储中；存的是可验证的 bcrypt 哈希
    expect(JSON.stringify(file)).not.toContain(secret);
    expect(bcrypt.compareSync(secret, String(rec.token_hash))).toBe(true);
  });

  it('重发即取代：同一账号旧的未使用令牌被作废', async () => {
    const t1 = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    const t2 = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });

    const err = await activateWithToken(t1.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe(UNIFIED);

    await expect(activateWithToken(t2.plaintext, 'BrandNew#2026')).resolves.toBe('liangchunfan');
  });
});

describe('activateWithToken', () => {
  it('成功：写密码（置 password_changed_at 的 setUserPasswordByUsername 被调用）+ 令牌作废', async () => {
    const created = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    const username = await activateWithToken(created.plaintext, 'BrandNew#2026');
    expect(username).toBe('liangchunfan');

    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1);
    const [u, hash] = mockSetUserPasswordByUsername.mock.calls[0];
    expect(u).toBe('liangchunfan');
    expect(bcrypt.compareSync('BrandNew#2026', hash)).toBe(true);

    const rec = readStoreFile().tokens[0];
    expect(rec.used_at).not.toBeNull();
  });

  it('一次性：同一令牌第二次消费 → 统一错误', async () => {
    const created = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    await activateWithToken(created.plaintext, 'BrandNew#2026');

    const err = await activateWithToken(created.plaintext, 'Another#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
    expect((err as AppError).message).toBe(UNIFIED);
    expect(mockSetUserPasswordByUsername).toHaveBeenCalledTimes(1); // 第二次没写库
  });

  it('secret 错误 / 格式非法 / 不存在的 tokenId → 一律统一错误（防枚举）', async () => {
    const created = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    const cases = [
      `cx_act_${created.tokenId}.${'x'.repeat(43)}`, // secret 错误
      'not-a-token',
      'cx_pat_ABCDEFGH.' + 'x'.repeat(43), // PAT 前缀不是激活令牌
      'cx_act_ZZZZZZZZ.' + 'x'.repeat(43), // 不存在的 tokenId
    ];
    for (const raw of cases) {
      const err = await activateWithToken(raw, 'BrandNew#2026').catch((e) => e);
      expect(err, raw).toBeInstanceOf(AppError);
      expect((err as AppError).message, raw).toBe(UNIFIED);
    }
  });

  it('过期（>24h）→ 统一错误', async () => {
    const created = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 25 * 3600 * 1000));
    const err = await activateWithToken(created.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe(UNIFIED);
  });

  it('账号已停用 → 统一错误（不泄漏账号状态）', async () => {
    const created = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });
    mockGetUserById.mockResolvedValueOnce({ ...activeUser, active: false });
    const err = await activateWithToken(created.plaintext, 'BrandNew#2026').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe(UNIFIED);
  });

  it('弱密码被拒（含 Chexian@2026 / 用户名变体）：返回具体策略原因，令牌不烧，可换合规密码重试', async () => {
    const created = await createActivationToken({ userId: activeUser.id, username: activeUser.username, createdBy: 'admin' });

    for (const weak of ['Chexian@2026', 'liangchunfan1', '12345678', 'short1A']) {
      const err = await activateWithToken(created.plaintext, weak).catch((e) => e);
      expect(err, weak).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode, weak).toBe(400);
      expect((err as AppError).message, weak).not.toBe(UNIFIED); // 具体原因，帮助用户改对
    }
    expect(readStoreFile().tokens[0].used_at).toBeNull(); // 令牌未烧

    await expect(activateWithToken(created.plaintext, 'BrandNew#2026')).resolves.toBe('liangchunfan');
  });
});
