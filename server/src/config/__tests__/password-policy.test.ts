/**
 * 密码策略单测（全员密码闭环 · 2026-07-11）
 * 锁定口径：≥8 位 + ≥2 类字符 + 黑名单（chexian 字样 / 用户名变体 / 常见弱密 top 表）。
 * change-password 与 activate 共用本策略（config/password-policy.ts 是唯一事实源）。
 */

import { describe, it, expect } from 'vitest';
import { validatePasswordPolicy, COMMON_WEAK_PASSWORDS } from '../password-policy.js';

describe('validatePasswordPolicy', () => {
  it('长度不足 8 位 → 拒绝', () => {
    expect(validatePasswordPolicy('Ab1#')).toMatch(/8 位/);
    expect(validatePasswordPolicy('Abc123!')).toMatch(/8 位/); // 7 位
  });

  it('字符类别不足 2 类 → 拒绝（纯小写 / 纯数字 / 纯大写 / 纯符号）', () => {
    for (const single of ['abcdefgh', '13579246', 'ZXCVBNMK', '!@#$%^&*']) {
      expect(validatePasswordPolicy(single), single).toMatch(/两类/);
    }
  });

  it('≥2 类即可通过类别检查（小写+数字 / 大写+符号 等组合）', () => {
    expect(validatePasswordPolicy('mypro2026')).toBeNull();
    expect(validatePasswordPolicy('SAFEPASS#')).toBeNull();
    expect(validatePasswordPolicy('Aa1#Bb2$')).toBeNull();
  });

  it('chexian 字样黑名单：历史统一初始密码 Chexian@2026 及其大小写/变体一律拒绝', () => {
    for (const banned of ['Chexian@2026', 'chexian123', 'CHEXIAN2026', 'MyChexian99', 'cheXian#1']) {
      expect(validatePasswordPolicy(banned), banned).toMatch(/chexian/);
    }
  });

  it('用户名黑名单：包含用户名（大小写不敏感）→ 拒绝', () => {
    for (const pwd of ['liangchunfan1', 'LiangChunFan#9', 'xx_LIANGCHUNFAN_1']) {
      expect(validatePasswordPolicy(pwd, { username: 'liangchunfan' }), pwd).toMatch(/用户名/);
    }
    // 不含用户名 → 通过
    expect(validatePasswordPolicy('BrandNew#2026', { username: 'liangchunfan' })).toBeNull();
  });

  it('常见弱密 top 表精确命中（大小写不敏感）→ 拒绝', () => {
    expect(COMMON_WEAK_PASSWORDS.length).toBeGreaterThan(20);
    for (const weak of ['password1', 'PASSWORD1', 'woaini520', 'qwerty123', 'aa123456']) {
      expect(validatePasswordPolicy(weak), weak).toMatch(/常见/);
    }
  });

  it('合规密码 → null（通过）', () => {
    for (const ok of ['BrandNew#2026', 'Zx9$kQ2m', 'shanxi-2026-Aq', '天府Pass2026']) {
      expect(validatePasswordPolicy(ok, { username: 'leshan' }), ok).toBeNull();
    }
  });
});
