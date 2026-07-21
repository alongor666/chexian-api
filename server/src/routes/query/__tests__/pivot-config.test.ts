import { describe, expect, it } from 'vitest';
import { PIVOT_DIM_WHITELIST, resolvePivotLimit } from '../pivot.js';

describe('PIVOT agent_name 维度配置', () => {
  it('仅剥前导机构码、保留全称并显式归类 NULL', () => {
    const expression = PIVOT_DIM_WHITELIST.agent_name;
    expect(expression).toContain("REGEXP_REPLACE(agent_name, '^[0-9]+', '')");
    expect(expression).toContain("'无经代'");
    expect(expression).not.toMatch(/LIKE|邮政|储蓄/);
  });

  it('agent_name 未传 limit 时默认取 500，确保高基数主要经代可见', () => {
    expect(resolvePivotLimit(['agent_name'], undefined)).toBe(500);
  });

  it('显式 limit 与其他维度默认值保持既有行为，并统一封顶 500', () => {
    expect(resolvePivotLimit(['agent_name'], '80')).toBe(80);
    expect(resolvePivotLimit(['org_level_3'], undefined)).toBe(100);
    expect(resolvePivotLimit(['agent_name'], '999')).toBe(500);
  });
});
