/**
 * HEATMAP_DIM_GROUPS 完整性单测
 *
 * 守护：所有 groups 的 keys 联合 === HEATMAP_DIMENSION_LABELS 的全部 keys，
 * 不漏、不重。
 *
 * 业务原因：分段控件视觉上把维度按"组织/业务"分组，但 ARIA 上必须是单一 radiogroup —
 * 任何一个维度从 DIM_GROUPS 漏掉（或重复），都会破坏"恰好 1 个 aria-checked"的单选语义，
 * 屏幕阅读器会听到坏的单选状态（codex PR #480 第 1 轮 P2）。
 */

import { describe, expect, it } from 'vitest';
import { HEATMAP_DIM_GROUPS } from '../heatmapDimGroups';
import { HEATMAP_DIMENSION_LABELS } from '../../hooks/usePerformanceOrgHeatmap';

describe('HEATMAP_DIM_GROUPS', () => {
  const allKeys = HEATMAP_DIM_GROUPS.flatMap((g) => g.keys);

  it('keys 联合恰好等于 HEATMAP_DIMENSION_LABELS 的全部 keys（不漏）', () => {
    const expected = new Set(Object.keys(HEATMAP_DIMENSION_LABELS));
    const actual = new Set(allKeys);
    expect(actual).toEqual(expected);
  });

  it('keys 无重复（任一维度只能属于一组）', () => {
    const seen = new Set<string>();
    for (const k of allKeys) {
      expect(seen.has(k), `维度 ${k} 在 HEATMAP_DIM_GROUPS 中出现多次`).toBe(false);
      seen.add(k);
    }
  });

  it('groupLabel 非空且无重复', () => {
    const labels = HEATMAP_DIM_GROUPS.map((g) => g.groupLabel);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('每组至少包含 1 个 key', () => {
    for (const g of HEATMAP_DIM_GROUPS) {
      expect(g.keys.length).toBeGreaterThan(0);
    }
  });
});
