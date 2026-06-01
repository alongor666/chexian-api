/**
 * 单测：PAT 限流桶嗅探与分桶（isPatShapedAuth / keyByPatOrUser）
 *
 * 回归保护：
 *  1) 限流器挂在路由级 authMiddleware 之前，req.pat 尚未注入，必须能从
 *     Authorization 头识别 PAT，否则 60/min 加严分支失效。
 *  2) 【Codex PR #455 P1】PAT 桶必须按 IP 分，不得用 token 里攻击者可控的
 *     tokenId 做 key——否则轮换 8 位 ID 即可绕过 IP 基线洪泛。
 *
 * 注意：本文件中的 token 全部由片段在运行时拼接（非连续字面量），
 * 既是显然的测试夹具、又避免 secret 扫描器把假 token 误报为真实凭据。
 */
import { describe, it, expect } from 'vitest';
import { isPatShapedAuth, keyByPatOrUser } from '../rateLimiter.js';

// 假 PAT 构造器：cx_pat_<id8>.<secret>。secret 用重复字符，显然非真实凭据。
const PFX = 'cx_' + 'pat_';
const fakePat = (id: string, secret = 'z'.repeat(16)) => `${PFX}${id}.${secret}`;

describe('isPatShapedAuth', () => {
  it('识别 Bearer cx_pat_ 头（8 位合法 id）', () => {
    expect(isPatShapedAuth({ headers: { authorization: `Bearer ${fakePat('AB12CD34')}` } })).toBe(true);
  });

  it('无 Bearer 前缀的裸 token 也能识别', () => {
    expect(isPatShapedAuth({ headers: { authorization: fakePat('ZZ99YY88') } })).toBe(true);
  });

  it('快路径：req.pat 已注入时判定为 PAT', () => {
    expect(isPatShapedAuth({ headers: {}, pat: { tokenId: 'PRE00000' } })).toBe(true);
  });

  it('JWT / 普通 Bearer 不被误判为 PAT', () => {
    const req = { headers: { authorization: 'Bearer ' + ['header', 'payload', 'sig'].join('.') } };
    expect(isPatShapedAuth(req)).toBe(false);
  });

  it('无 Authorization 头返回 false', () => {
    expect(isPatShapedAuth({ headers: {} })).toBe(false);
    expect(isPatShapedAuth({})).toBe(false);
  });

  it('id 含非法字符（非 [0-9A-Z]{8}）不判定为 PAT', () => {
    expect(isPatShapedAuth({ headers: { authorization: `Bearer ${fakePat('ab12cd34')}` } })).toBe(false); // 小写
  });
});

describe('keyByPatOrUser — PAT 按 IP 分桶（Codex P1 DoS 防护）', () => {
  it('同一 IP 轮换不同伪造 tokenId → 同一个 pat:<ip> 桶（无法靠轮换 ID 扩配额）', () => {
    const ip = '203.0.113.7';
    const k1 = keyByPatOrUser({ ip, headers: { authorization: `Bearer ${fakePat('AAAAAAAA')}` } });
    const k2 = keyByPatOrUser({ ip, headers: { authorization: `Bearer ${fakePat('BBBBBBBB')}` } });
    const k3 = keyByPatOrUser({ ip, headers: { authorization: `Bearer ${fakePat('CCCCCCCC')}` } });
    expect(k1).toBe('pat:203.0.113.7');
    expect(k2).toBe(k1);
    expect(k3).toBe(k1);
  });

  it('PAT 桶与浏览器 IP 桶不混淆（同 IP 不同 key）', () => {
    const ip = '203.0.113.7';
    const patKey = keyByPatOrUser({ ip, headers: { authorization: `Bearer ${fakePat('AB12CD34')}` } });
    const browserKey = keyByPatOrUser({ ip, headers: {} });
    expect(patKey).toBe('pat:203.0.113.7');
    expect(browserKey).toBe('203.0.113.7');
    expect(patKey).not.toBe(browserKey);
  });

  it('不同 IP 的 PAT 请求落到不同桶', () => {
    const a = keyByPatOrUser({ ip: '198.51.100.1', headers: { authorization: `Bearer ${fakePat('AB12CD34')}` } });
    const b = keyByPatOrUser({ ip: '198.51.100.2', headers: { authorization: `Bearer ${fakePat('AB12CD34')}` } });
    expect(a).toBe('pat:198.51.100.1');
    expect(b).toBe('pat:198.51.100.2');
    expect(a).not.toBe(b);
  });

  it('非 PAT 请求保留 IP+userId 行为', () => {
    expect(keyByPatOrUser({ ip: '10.0.0.1', headers: {}, user: { userId: 'u9' } })).toBe('10.0.0.1:u9');
    expect(keyByPatOrUser({ ip: '10.0.0.1', headers: {} })).toBe('10.0.0.1');
  });
});
