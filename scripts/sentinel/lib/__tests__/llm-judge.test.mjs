/**
 * sentinel/lib/llm-judge.mjs 单元测试
 *
 * 覆盖：
 *   - judgeAnomalies：空输入 / 单触发项 / 多触发项 / Z>3.5 → high 严重度
 *   - ruleJudge（通过 judgeAnomalies 间接测试，因为未导出）
 *
 * 本文件已于 2026-06-14 去除 LLM API 调用（改为纯规则归因），测试无需 mock HTTP。
 */

import { describe, it, expect } from 'vitest';
import { judgeAnomalies } from '../llm-judge.mjs';

// 构造 evaluateMetricSeries 返回的 triggered 项结构
function makeTriggered({ metric = 'earned_claim_ratio', z = 2.5, reasons = ['Z=2.50 超阈值 2'] } = {}) {
  return { metric, z, reasons };
}

describe('judgeAnomalies — 规则归因器', () => {
  it('空数组 → 返回空数组', async () => {
    const result = await judgeAnomalies([]);
    expect(result).toEqual([]);
  });

  it('null/undefined 输入 → 返回空数组', async () => {
    expect(await judgeAnomalies(null)).toEqual([]);
    expect(await judgeAnomalies(undefined)).toEqual([]);
  });

  it('单触发项（Z=2.5）→ severity=medium', async () => {
    const triggered = [makeTriggered({ z: 2.5 })];
    const result = await judgeAnomalies(triggered);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('medium');
    expect(result[0].metric).toBe('earned_claim_ratio');
  });

  it('Z > 3.5 → severity=high', async () => {
    const triggered = [makeTriggered({ z: 4.1 })];
    const result = await judgeAnomalies(triggered);
    expect(result[0].severity).toBe('high');
  });

  it('Z = 3.5（边界）→ severity=medium（>3.5 才是 high）', async () => {
    const triggered = [makeTriggered({ z: 3.5 })];
    const result = await judgeAnomalies(triggered);
    expect(result[0].severity).toBe('medium');
  });

  it('Z = 3.51（刚超边界）→ severity=high', async () => {
    const triggered = [makeTriggered({ z: 3.51 })];
    const result = await judgeAnomalies(triggered);
    expect(result[0].severity).toBe('high');
  });

  it('多个触发项 → 每个都有独立的 metric / severity / one_line_cause', async () => {
    const triggered = [
      makeTriggered({ metric: 'premium', z: 2.2, reasons: ['环比 35.0% 超阈值 30%'] }),
      makeTriggered({ metric: 'policy_count', z: 4.0, reasons: ['Z=4.00 超阈值 2'] }),
    ];
    const result = await judgeAnomalies(triggered);
    expect(result).toHaveLength(2);
    expect(result[0].metric).toBe('premium');
    expect(result[1].metric).toBe('policy_count');
    expect(result[1].severity).toBe('high'); // Z=4.0 > 3.5
  });

  it('one_line_cause 包含 reasons 字符串（归因透明）', async () => {
    const triggered = [makeTriggered({ reasons: ['Z=2.50 超阈值 2', '环比 35.0% 超阈值 30%'] })];
    const result = await judgeAnomalies(triggered);
    expect(result[0].one_line_cause).toContain('Z=2.50 超阈值 2');
    expect(result[0].one_line_cause).toContain('环比 35.0%');
  });

  it('reasons 为空 → one_line_cause 含默认文案"偏离基线"', async () => {
    const triggered = [makeTriggered({ reasons: [] })];
    const result = await judgeAnomalies(triggered);
    expect(result[0].one_line_cause).toContain('偏离基线');
  });

  it('one_line_cause 包含本地 skill 归因提示', async () => {
    const triggered = [makeTriggered()];
    const result = await judgeAnomalies(triggered);
    expect(result[0].one_line_cause).toContain('chexian-sentinel-attribution');
  });
});
