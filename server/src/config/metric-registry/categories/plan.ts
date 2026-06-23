/**
 * 计划达成指标（L4）— 年度计划/时间进度达成率
 *
 * 来源：dim/plan/latest.parquet（业务员年计划）+ PolicyFact（实际签单保费）
 *
 * 标准口径（用户 2026-06-11 拍板，B-146cce 三路由统一）：
 *   计划达成率 = 年初累计签单保费 × 100 ÷（业务员年计划合计 × 时间进度）
 *   - 时间进度 = 数据内最新签单日是当年第几天 ÷ 全年天数（闰年感知 365/366）
 *   - 进度锚点是「数据内最新签单日」而非自然日今天：数据滞后时不冤枉业务员
 *   - 带时间筛选时语义为「年初至筛选末日的累计达成率」（非单期达成率）
 *
 * 对齐的三条接口（实现处引用本定义，禁止另起公式）：
 *   1. /api/query/kpi                  — server/src/sql/kpi.ts（latest_context CTE）
 *   2. /api/query/performance-bundle   — server/src/sql/performance-analysis/
 *      drilldown.ts、top-salesman.ts（ytd_bounds CTE）
 *   3. /api/query/plan-achievement     — server/src/services/duckdb-domain-loaders.ts
 *      buildAchievementView()（time_prog CTE）→ achievement_cache.time_progress
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
    timeWindow: 'cutoff-based',
    additive: false,
    version: '2.1.0',
    name: '计划达成率',
    category: 'plan',
    tags: ['kpi', 'plan', 'alert', 'branch-ops'],
    formula: {
      description:
        '年初累计签单保费 × 100 ÷ (业务员年计划合计 × 时间进度)；时间进度 = 数据内最新签单日是当年第几天 ÷ 全年天数（闰年感知）',
      numerator: 'ytd_premium',
      denominator: 'plan_premium * time_progress',
      unit: '%',
    },
    sql: {
      expression:
        '-- L4 计算，由 SQL 生成器动态拼接：ytd_premium * 100.0 / (plan_premium * time_progress)',
      requiredColumns: ['premium', 'policy_date'],
      notes:
        'L4 计算。ytd_premium = 年初（当年 1 月 1 日）至时间窗口末的累计 SUM(premium)；' +
        'plan_premium 来自 dim/plan/latest.parquet 业务员年计划合计；' +
        'time_progress = EXTRACT(doy FROM 数据内最新签单日) ÷ 全年天数（闰年感知，禁止硬编码 365）。' +
        '进度锚点必须用数据内最新签单日（非服务器当前日期）；带时间筛选时返回' +
        '「年初至筛选末日的累计达成率」。100% 即按时间进度均匀达成。' +
        '月度/任意子周期计划取官方派生口径 = 年计划 × 子周期占比（月度即年计划 ÷ 12，' +
        'B290 用户 2026-06-22 拍板；非真实逐月计划，详见业务规则字典 §「计划与时间进度口径」）；' +
        '本指标标准口径用连续时间进度，离散月度仅为口头解释时的派生近似。' +
        '注册到 L4_METRIC_IDS，集成测试跳过。',
    },
    display: {
      formatter: 'percent',
      label: '计划达成率',
      unit: '%',
      decimals: 2,
      tooltip:
        '年初累计签单保费 ÷（年计划 × 时间进度），时间进度按数据内最新签单日/全年天数（闰年感知）。≥110% 优秀 / 100-110% 健康 / 95-100% 异常 / <95% 危险',
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
      source: 'skills/chexian-report-shell/lib/alerts.py v1.7 (2026-05-13)',
    },
    changelog: [
      {
        version: '2.1.0',
        date: '2026-06-22',
        changes:
          'B290 时间口径语义层 v0.1：标注 timeWindow=cutoff-based（达成率锚定数据内最新签单日的时间进度，' +
          '数值随观察截止日变化，跨窗口比较须对齐 cutoff，不可与自由窗口口径混用）；' +
          '确立月度计划官方派生口径 = 年计划 ÷ 12（用户 2026-06-22 拍板，非真实逐月计划）。' +
          '仅补元数据与口径文档，L4 公式语义不变。',
      },
      {
        version: '2.0.0',
        date: '2026-06-11',
        changes:
          '占位符升级为正式标准口径（用户 2026-06-11 拍板，B-146cce）：分子明确为年初累计签单保费；' +
          '时间进度锚点统一为数据内最新签单日（废除报告中心的服务器当前日期锚）；全年天数闰年感知' +
          '（废除保费看板硬编码 365）；经营分析废除「年计划÷周期数」均分语义，下钻表/业务员表达成率' +
          '列改为本口径（分摊漏失缺陷随之消灭）。三条接口同参数同值。',
      },
      {
        version: '1.0.0',
        date: '2026-05-13',
        changes: '新增：与诊断技能 alerts.py v1.7 阈值对齐（110/100/95，lower_worse）',
      },
    ],
  },
];
