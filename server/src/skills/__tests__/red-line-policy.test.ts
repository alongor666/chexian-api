/**
 * red-line-policy 单元测试 — 阶段 2
 *
 * 验证 applyRedLinePolicy 的合并 / 去重 / 不变更（immutability）/ 未登记 Skill 不污染
 */

import { describe, it, expect } from 'vitest';
import { applyRedLinePolicy, listRedLineSkillIds, RED_LINE_WARNINGS } from '../red-line-policy.js';
import type { SkillResult } from '../types.js';

const baseResult = (overrides: Partial<SkillResult<unknown>> = {}): SkillResult<unknown> => ({
  result: { sample: 1 },
  evidence: [],
  confidence: 1,
  warnings: [],
  assumptions: [],
  dataLineage: [],
  nextSuggestedSkills: [],
  ...overrides,
});

describe('applyRedLinePolicy', () => {
  it('未登记的 Skill 不注入任何 warning', () => {
    const before = baseResult({ warnings: ['existing'] });
    const after = applyRedLinePolicy('data-health', before);
    expect(after.warnings).toEqual(['existing']);
  });

  it('为 segment-risk-scan 注入实验性 credibility warning', () => {
    const before = baseResult();
    const after = applyRedLinePolicy('segment-risk-scan', before);
    expect(after.warnings.length).toBeGreaterThan(0);
    expect(after.warnings.join('|')).toContain('credibility');
  });

  it('保留 Skill 原有 warnings，不覆盖', () => {
    const before = baseResult({ warnings: ['skill-said-this'] });
    const after = applyRedLinePolicy('segment-risk-scan', before);
    expect(after.warnings[0]).toBe('skill-said-this');
    expect(after.warnings.length).toBeGreaterThan(1);
  });

  it('去重：Skill 已声明同款 warning 不重复追加', () => {
    const dup = RED_LINE_WARNINGS['segment-risk-scan'][0];
    const before = baseResult({ warnings: [dup] });
    const after = applyRedLinePolicy('segment-risk-scan', before);
    const occurrences = after.warnings.filter((w) => w === dup).length;
    expect(occurrences).toBe(1);
  });

  it('immutable：返回新对象，不修改原 result', () => {
    const before = baseResult({ warnings: ['x'] });
    const originalRef = before.warnings;
    const after = applyRedLinePolicy('segment-risk-scan', before);
    expect(after).not.toBe(before);
    expect(before.warnings).toBe(originalRef); // 原数组未被替换
    expect(before.warnings).toEqual(['x']); // 原数组未被 push
  });

  it('listRedLineSkillIds 至少包含已知红线 Skill', () => {
    const ids = listRedLineSkillIds();
    expect(ids).toContain('segment-risk-scan');
    expect(ids).toContain('risk-scoring');
    expect(ids).toContain('pricing-simulation');
    expect(ids).toContain('underwriting-recommendation');
  });

  it('每个红线 Skill 至少注入 1 条 warning', () => {
    for (const id of listRedLineSkillIds()) {
      expect(RED_LINE_WARNINGS[id].length).toBeGreaterThan(0);
    }
  });
});
