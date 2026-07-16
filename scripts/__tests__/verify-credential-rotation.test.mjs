/**
 * 凭据轮换 preflight 分类核单测（安全审查 H1）。
 * 覆盖 self-set / env(已轮换) / stale-not-rotated / missing 四态 + 自助账号跳过 + active:false 跳过。
 */
import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { classifyCredentials } from '../lib/verify-credential-rotation-core.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const roster = [
  { username: 'admin', active: true },
  { username: 'leshan', active: true },
  { username: 'tianfu', active: true },
  { username: 'yibin', active: true },
  { username: 'liangchunfan', active: true }, // 自助设密
  { username: 'test_org_user', active: false }, // 停用
];
const selfService = ['liangchunfan'];

function classify(userPasswords, selfSetUsernames, oldFingerprints) {
  return Object.fromEntries(
    classifyCredentials({ roster, selfService, userPasswords, selfSetUsernames, oldFingerprints }).map(
      (r) => [r.username, r.source],
    ),
  );
}

describe('classifyCredentials', () => {
  it('self-set 优先（即便有 env key）', () => {
    const out = classify({ admin: 'x' }, new Set(['admin']));
    expect(out.admin).toBe('self-set');
  });

  it('env 已轮换（新哈希，不在旧指纹集）', () => {
    const out = classify({ leshan: 'brand-new-hash' }, new Set(), new Set(['nonmatching']));
    expect(out.leshan).toBe('env');
  });

  it('stale-not-rotated（env 值命中旧指纹）', () => {
    const OLD = '$2b$10$SomeOldWeakHashValue';
    const out = classify({ tianfu: OLD }, new Set(), new Set([sha256(OLD)]));
    expect(out.tianfu).toBe('stale-not-rotated');
  });

  it('missing（既非自设也无 env key）', () => {
    const out = classify({}, new Set());
    expect(out.yibin).toBe('missing');
  });

  it('自助设密账号被跳过（不评级）', () => {
    const out = classify({}, new Set());
    expect(out.liangchunfan).toBeUndefined();
  });

  it('active:false 账号被跳过', () => {
    const out = classify({}, new Set());
    expect(out.test_org_user).toBeUndefined();
  });

  it('大小写不敏感匹配 USER_PASSWORDS key 与 self-set', () => {
    const out = classify({ ADMIN: 'x' }, new Set(['LESHAN']), new Set());
    expect(out.admin).toBe('env');
    expect(out.leshan).toBe('self-set');
  });
});
