/**
 * 单元测试：timeWindow 固有时间窗口语义标记（B290 口径消歧 v0.1）
 *
 * 不变量：
 *   1. 注册表每个指标都显式声明 timeWindow（'any' | 'cutoff-based'）——validation.ts 闸的镜像断言
 *   2. 满期/年化族（内嵌观察时点逻辑）= 'cutoff-based'
 *   3. 计划达成率（时间进度锚定数据内最新签单日）= 'cutoff-based'
 *   4. 窗口决定型指标（保费/件数/结构比率）= 'any'
 */
import { describe, expect, it } from 'vitest';
import { getAllMetrics, getMetric } from '../index.js';

const VALID_TIME_WINDOWS = new Set(['any', 'cutoff-based']);

describe('metric timeWindow 固有时间语义标记', () => {
  it('每个指标都显式声明 timeWindow（合法枚举）', () => {
    const missing = getAllMetrics().filter(
      (m) => m.timeWindow === undefined || !VALID_TIME_WINDOWS.has(m.timeWindow)
    );
    expect(missing.map((m) => m.id)).toEqual([]);
  });

  it('满期/年化族（内嵌观察时点逻辑）= cutoff-based', () => {
    const cutoffBased = [
      'earned_claim_ratio',
      'earned_premium',
      'baseline_earned_premium',
      'baseline_earned_claim_ratio',
      'variable_cost_ratio',
      'earned_loss_frequency',
      'earned_margin_amount',
      'projected_margin_amount',
      'combined_cost_amount',
      'combined_cost_ratio',
      'earned_profit_amount',
    ];
    for (const id of cutoffBased) {
      expect(getMetric(id)?.timeWindow, `${id} 应为 cutoff-based`).toBe('cutoff-based');
    }
  });

  it('计划达成率锚定观察截止日（时间进度）= cutoff-based', () => {
    expect(getMetric('plan_completion_pct')?.timeWindow).toBe('cutoff-based');
  });

  it('窗口决定型指标（保费/件数/结构比率）= any', () => {
    const anyWindow = [
      'total_premium',
      'policy_count',
      'renewal_rate',
      'growth_rate_yoy',
      'transfer_rate',
      'expense_ratio',
    ];
    for (const id of anyWindow) {
      expect(getMetric(id)?.timeWindow, `${id} 应为 any`).toBe('any');
    }
  });
});
