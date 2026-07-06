/**
 * IP 白名单工具单元测试
 *
 * utils/ip.ts 是登录（services/auth.ts）与 PAT 校验（services/personal-access-token.ts）
 * 共用的唯一事实源，语义变更会同时影响两条链路，用例覆盖全部分支。
 */
import { describe, it, expect } from 'vitest';
import { normalizeIpValue, isIpAllowed } from '../ip.js';

describe('normalizeIpValue', () => {
  it('去首尾空白', () => {
    expect(normalizeIpValue('  1.2.3.4  ')).toBe('1.2.3.4');
  });

  it('X-Forwarded-For 逗号链取首个', () => {
    expect(normalizeIpValue('1.2.3.4, 5.6.7.8')).toBe('1.2.3.4');
  });

  it('剥 IPv6 映射前缀 ::ffff:', () => {
    expect(normalizeIpValue('::ffff:192.168.1.5')).toBe('192.168.1.5');
  });

  it('::1 视同 127.0.0.1', () => {
    expect(normalizeIpValue('::1')).toBe('127.0.0.1');
  });

  it('普通 IPv4 原样返回', () => {
    expect(normalizeIpValue('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('isIpAllowed', () => {
  it('白名单未配置 → 放行', () => {
    expect(isIpAllowed('1.2.3.4', undefined)).toBe(true);
  });

  it('白名单为空数组 → 放行', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('配置了白名单但 clientIp 缺失 → 拒绝（fail-closed）', () => {
    expect(isIpAllowed(undefined, ['1.2.3.4'])).toBe(false);
  });

  it('命中白名单 → 放行', () => {
    expect(isIpAllowed('1.2.3.4', ['1.2.3.4', '5.6.7.8'])).toBe(true);
  });

  it('未命中白名单 → 拒绝', () => {
    expect(isIpAllowed('9.9.9.9', ['1.2.3.4'])).toBe(false);
  });

  it('双侧归一化后比对：::ffff: 前缀客户端命中 IPv4 白名单', () => {
    expect(isIpAllowed('::ffff:1.2.3.4', ['1.2.3.4'])).toBe(true);
  });

  it('::1 客户端命中 127.0.0.1 白名单', () => {
    expect(isIpAllowed('::1', ['127.0.0.1'])).toBe(true);
  });

  it('白名单侧也归一化：客户端 127.0.0.1 命中 ::1 白名单项', () => {
    expect(isIpAllowed('127.0.0.1', ['::1'])).toBe(true);
  });
});
