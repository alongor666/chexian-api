/**
 * 自助设密账号名单读取 + 过滤 单测（BACKLOG 2026-07-12-claude-3901cd · 生产事故 c0f97a 根治）
 *
 * 锁死不变式：密码生成器 rotate/reset-passwords 生成 USER_PASSWORDS 前，必用
 * SELF_SERVICE_PASSWORD_ONLY_USERS 过滤，杜绝自助设密账号被回注 .env（governance
 * 「自助设密账号禁入USER_PASSWORDS」闸的源头对称防线）。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { filterOutSelfService, readSelfServiceUsers } from '../scripts/lib/self-service-users.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 造一个只含 preset-users.ts 的临时项目根，内容由入参决定。 */
function makeFixtureRoot(presetSrc: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'selfsvc-'));
  mkdirSync(path.join(root, 'server/src/config'), { recursive: true });
  writeFileSync(path.join(root, 'server/src/config/preset-users.ts'), presetSrc, 'utf-8');
  return root;
}

const cleanups: string[] = [];
afterAll(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('readSelfServiceUsers', () => {
  it('读真实 preset-users.ts：返回与 SSOT 完全一致的自助设密名单（非空）', () => {
    const names = readSelfServiceUsers(REPO_ROOT);
    // 不硬编码 6 人具体名单（避免与 SSOT 双写漂移），只锁「非空 + 无重复 + 全为合法用户名」
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]+$/);
  });

  it('解析多行单引号数组', () => {
    const root = makeFixtureRoot(
      `export const SELF_SERVICE_PASSWORD_ONLY_USERS: readonly string[] = [\n  'alice',\n  'bob',\n  'carol',\n];\n`,
    );
    cleanups.push(root);
    expect(readSelfServiceUsers(root)).toEqual(['alice', 'bob', 'carol']);
  });

  it('空名单合法返回 []', () => {
    const root = makeFixtureRoot(`export const SELF_SERVICE_PASSWORD_ONLY_USERS: readonly string[] = [];\n`);
    cleanups.push(root);
    expect(readSelfServiceUsers(root)).toEqual([]);
  });

  it('名单定义缺失 → 抛错 fail-fast（绝不静默返回空致过滤失效）', () => {
    const root = makeFixtureRoot(`export const SOMETHING_ELSE = ['x'];\n`);
    cleanups.push(root);
    expect(() => readSelfServiceUsers(root)).toThrow(/缺少 SELF_SERVICE_PASSWORD_ONLY_USERS/);
  });
});

describe('filterOutSelfService', () => {
  const selfService = ['liangchunfan', 'changlixia', 'yaoqian'];

  it('rotate 场景：从 {username,branchCode,role} 数组剔除自助设密账号', () => {
    const users = [
      { username: 'admin', branchCode: 'SC', role: 'admin' },
      { username: 'liangchunfan', branchCode: 'SX', role: 'org' },
      { username: 'leshan', branchCode: 'SC', role: 'org' },
      { username: 'yaoqian', branchCode: 'SX', role: 'org' },
    ];
    expect(filterOutSelfService(users, selfService).map((u) => u.username)).toEqual(['admin', 'leshan']);
  });

  it('reset 场景：从 {username,org} 硬编码机构列表剔除（当前无命中 = 恒等）', () => {
    const orgUsers = [
      { username: 'leshan', org: '乐山' },
      { username: 'tianfu', org: '天府' },
    ];
    expect(filterOutSelfService(orgUsers, selfService)).toEqual(orgUsers);
  });

  it('保序且不改原数组', () => {
    const users = [{ username: 'a' }, { username: 'changlixia' }, { username: 'b' }];
    const copy = JSON.parse(JSON.stringify(users));
    const out = filterOutSelfService(users, selfService);
    expect(out.map((u) => u.username)).toEqual(['a', 'b']);
    expect(users).toEqual(copy); // 原数组未被 mutate
  });

  it('空名单 = 恒等（不误删任何账号）', () => {
    const users = [{ username: 'a' }, { username: 'b' }];
    expect(filterOutSelfService(users, [])).toEqual(users);
  });
});
