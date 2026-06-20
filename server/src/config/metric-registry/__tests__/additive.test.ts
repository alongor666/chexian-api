/**
 * 单元测试：additive 可加性标记（P2 cube 语义层）
 *
 * 不变量：
 *   1. 注册表每个指标都显式声明 additive: boolean（validation.ts 闸的镜像断言）
 *   2. 已知可加（顶层 SUM 逐行求和）指标 = true，比率/DISTINCT/L4 = false
 *   3. 车险铁律：所有比率类（formula.unit='%'）一律 false（禁止对率值求和）
 */
import { describe, expect, it } from 'vitest';
import { getAllMetrics, getMetric } from '../index.js';

describe('metric additive 标记', () => {
  it('每个指标都显式声明 additive: boolean', () => {
    const missing = getAllMetrics().filter((m) => typeof m.additive !== 'boolean');
    expect(missing.map((m) => m.id)).toEqual([]);
  });

  it('已知可加指标（顶层 SUM 逐行求和）= true', () => {
    const additiveTrue = [
      'total_premium',
      'earned_premium',
      'baseline_earned_premium',
      'repair_damage_amount_total',
      'repair_net_premium_total',
    ];
    for (const id of additiveTrue) {
      expect(getMetric(id)?.additive, `${id} 应为可加`).toBe(true);
    }
  });

  it('比率/COUNT DISTINCT/L4 指标 = false（保守，永不误判 true）', () => {
    const nonAdditive = [
      'policy_count', // COUNT DISTINCT
      'earned_claim_ratio', // 满期赔付率（比率）
      'expense_ratio', // 费用率（比率）
      'renewal_rate', // 续保占比（比率）
      'growth_rate_yoy', // 增长率
      'plan_completion_pct', // L4
      'renewal_due_count', // COUNT DISTINCT vehicle_frame_no
      'renewal_renewed_count',
      'combined_cost_ratio', // L4 复合
    ];
    for (const id of nonAdditive) {
      expect(getMetric(id)?.additive, `${id} 应为不可加`).toBe(false);
    }
  });

  it('车险铁律：所有 % 单位的比率指标 additive=false（禁止率值求和）', () => {
    const ratioMetricsAdditiveTrue = getAllMetrics().filter(
      (m) => m.formula.unit === '%' && m.additive === true
    );
    expect(ratioMetricsAdditiveTrue.map((m) => m.id)).toEqual([]);
  });
});
