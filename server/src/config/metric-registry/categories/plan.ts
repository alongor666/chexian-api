/**
 * 计划达成指标（L4 占位符）— 年度计划/时间进度达成率
 *
 * 来源：dim/plan/plan.parquet（年计划保费）+ PolicyFact（实际签单保费）
 *
 * 此指标属 L4（依赖 dim/plan JOIN + 时间进度计算），无法用单行 SQL 在
 * 集成测试合成 fixture 中直接验证。SQL.expression 是 "-- L4" 占位注释，
 * 真实公式见 formula.description / numerator / denominator 字段。
 * 注册到 L4_METRIC_IDS 集合（server/src/config/metric-registry/__tests__/
 * test-helpers.ts），集成测试会跳过它。
 */

import type { MetricDefinition } from '../types.js';

export const planMetrics: readonly MetricDefinition[] = [
  {
    id: 'plan_completion_pct',
    version: '1.0.0',
    name: '计划达成率',
    category: 'plan',
    tags: ['kpi', 'plan', 'alert', 'branch-ops'],
    formula: {
      description: '实际签单保费 × 100 ÷ (年计划保费 × 时间进度)',
      numerator: 'actual_premium',
      denominator: 'plan_premium * time_progress',
      unit: '%',
    },
    sql: {
      expression:
        '-- L4 计算，由诊断脚本 / 报表生成器动态拼接：actual_premium * 100.0 / (plan_premium * time_progress)',
      requiredColumns: ['premium', 'policy_start_date'],
      notes:
        'L4 计算。actual_premium = 当前 YTD SUM(premium)；plan_premium 来自 dim/plan/plan.parquet；time_progress = day_of_year(end) ÷ 全年天数（闰年感知）。100% 即按时间进度均匀达成。注册到 L4_METRIC_IDS，集成测试跳过。',
    },
    display: {
      formatter: 'percent',
      label: '计划达成率',
      unit: '%',
      decimals: 2,
      tooltip:
        '含时间进度。≥110% 优秀 / 100-110% 健康 / 95-100% 异常 / <95% 危险',
    },
    testCases: [
      {
        name: '达成率类型为数字',
        input: { whereClause: '1=1' },
        assertions: { plan_completion_pct: { op: 'type', value: 'number' } },
      },
    ],
    thresholds: {
      direction: 'lower_worse',
      notice: 110,
      warn: 100,
      danger: 95,
      unit: '%',
      source: 'skills/diagnose-html-render/lib/alerts.py v1.7 (2026-05-13)',
    },
    changelog: [
      {
        version: '1.0.0',
        date: '2026-05-13',
        changes: '新增：与诊断技能 alerts.py v1.7 阈值对齐（110/100/95，lower_worse）',
      },
    ],
  },
];
