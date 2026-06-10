import { describe, expect, it } from 'vitest';

import { containsCredentialValue } from '../../scripts/check-governance.mjs';

// 凭据扫描器规则2：应匹配「key=value 真实泄漏」，不再对「裸 key 名」散文提及误报。
const KEY_ACCESS = ['cx', 'access', 'token'].join('_');
const KEY_REFRESH = ['cx', 'refresh', 'token'].join('_');
// 刻意用「明显假占位」而非真实 JWT 结构：满足值匹配正则的「≥20 字符值域 [A-Za-z0-9.-]」，
// 但无 JWT 的 base64-JSON 段结构，避免 GitGuardian 把测试夹具误判为真泄漏。
const SAMPLE_TOKEN = 'EXAMPLE-FAKE-TOKEN-not-a-real-secret-0000';

describe('containsCredentialValue', () => {
  it('不对散文/evidence 中的裸 key 名误报（负向）', () => {
    expect(
      containsCredentialValue(`安全审计：提到 ${KEY_ACCESS} 这个 localStorage key 名`),
    ).toBe(false);
    expect(
      containsCredentialValue(`修复了 ${KEY_REFRESH} 字段的清理逻辑，详见 PR`),
    ).toBe(false);
  });

  it('命中赋值形真实泄漏 key=value（正向）', () => {
    expect(containsCredentialValue(`${KEY_ACCESS}=${SAMPLE_TOKEN}`)).toBe(true);
    expect(containsCredentialValue(`${KEY_REFRESH}: ${SAMPLE_TOKEN}`)).toBe(true);
    expect(containsCredentialValue(`"${KEY_ACCESS}":"${SAMPLE_TOKEN}"`)).toBe(true);
  });

  it('命中 Playwright storageState 形真实泄漏（正向）', () => {
    const storageState = `{"name":"${KEY_ACCESS}","value":"${SAMPLE_TOKEN}"}`;
    expect(containsCredentialValue(storageState)).toBe(true);
  });

  it('短值不命中（避免把占位/截断误判为泄漏）', () => {
    expect(containsCredentialValue(`${KEY_ACCESS}=short`)).toBe(false);
  });
});
