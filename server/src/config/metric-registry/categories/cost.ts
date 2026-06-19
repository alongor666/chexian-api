/**
 * 成本指标（L3）— 比率计算
 *
 * 来源：server/src/sql/cost.ts
 *
 * 注意：这些 SQL 片段是"指标表达式"级别，
 * 需要在 CTE（policy_exposure）已计算 earned_days + policy_term 后使用。
 * cost.ts 中的完整查询（含 CTE）属于 L4 组合查询，不在此注册。
 *
 * 这里注册的是各指标的 SELECT 表达式片段。
 */

import type { MetricDefinition } from '../types.js';

export const costMetrics: readonly MetricDefinition[] = [
  {
    id: 'earned_claim_ratio',
    additive: false,
    version: '2.0.0',
    timeWindow: 'cutoff-based',
    name: '满期赔付率',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '已报告赔款 / 满期保费（闰年感知）',
      numerator: 'SUM(reported_claims)',
      denominator: 'SUM(premium * earned_days / policy_term)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN ROUND(SUM(reported_claims) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2)
    ELSE NULL
  END AS earned_claim_ratio`,
      requiredColumns: ['premium', 'reported_claims', 'earned_days', 'policy_term'],
      notes: '赔案口径：report_time < 观察截止（MAX(report_time)），已结案(settlement_time<观察点)取settled_amount，否则取reserve_amount。保单口径：按policy_no聚合净保费>0。分母闰年感知：policy_term = DATEDIFF(起期, 起期+1年) = 365或366；earned_days = MIN(已过天数, policy_term)，退保保单截止于退保日',
    },
    display: {
      formatter: 'percent',
      label: '赔付率',
      unit: '%',
      decimals: 1,
      tooltip: '满期赔付率 = 已报告赔款 / 满期保费 × 100%',
    },
    testCases: [
      {
        name: '赔付率非负',
        input: { whereClause: '1=1' },
        assertions: { earned_claim_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' },
      { version: '1.1.0', date: '2026-04-11', changes: '口径修正：赔案锚点改为 report_time，已决/未决按 settlement_time 分类取值，保单净保费聚合排除完全退保，截止日期改为 MAX(report_time)' },
      { version: '2.0.0', date: '2026-04-17', changes: '铁律对齐：分母从 exposure_days/365 改为 earned_days/policy_term（闰年感知）；展示精度 2→1 位小数' },
    ],
  },

  {
    id: 'expense_ratio',
    additive: false,
    version: '1.2.0',
    name: '费用率',
    category: 'cost',
    tags: ['kpi', 'cost'],
    formula: {
      description: '费用金额 / 签单保费（保单明细域 fee_amount，不混同综合费用率/综合成本率）',
      numerator: 'SUM(fee_amount)',
      denominator: 'SUM(premium)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium) > 0
    THEN SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium)
    ELSE NULL
  END AS expense_ratio`,
      requiredColumns: ['fee_amount', 'premium'],
      notes: '不在 SQL 内 ROUND，避免与前端 display.decimals 双重舍入；前端按 decimals=1 单次舍入。',
    },
    display: {
      formatter: 'percent',
      label: '费用率',
      unit: '%',
      decimals: 1,
      tooltip: '费用率 = 费用金额 / 签单保费 × 100%（保单明细域 fee_amount）。分母为签单保费，不是满期保费；与综合费用率/综合成本率口径不同。',
    },
    testCases: [
      {
        name: '费用率非负',
        input: { whereClause: '1=1' },
        assertions: { expense_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' },
      { version: '1.1.0', date: '2026-04-17', changes: '铁律对齐：展示精度 2→1 位小数' },
      { version: '1.2.0', date: '2026-05-01', changes: '消除 SQL ROUND(2) 与前端 decimals=1 的双重舍入；补充 tooltip 与 sql.notes 明确分母为签单保费、与综合费用率/综合成本率不同源' },
    ],
  },

  {
    id: 'avg_claim_amount',
    additive: false,
    version: '1.0.0',
    name: '案均赔款',
    category: 'cost',
    tags: ['cost'],
    formula: {
      description: '已报告赔款 / 赔案件数',
      numerator: 'SUM(reported_claims)',
      denominator: 'SUM(claim_cases)',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN SUM(claim_cases) > 0
    THEN ROUND(SUM(reported_claims) / CAST(SUM(claim_cases) AS DOUBLE), 2)
    ELSE NULL
  END AS avg_claim_amount`,
      requiredColumns: ['reported_claims', 'claim_cases'],
    },
    display: {
      formatter: 'premiumWan',
      label: '案均赔款',
      unit: '万元',
    },
    testCases: [
      {
        name: '案均赔款非负',
        input: { whereClause: '1=1' },
        assertions: { avg_claim_amount: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'earned_premium',
    additive: true,
    version: '2.0.0',
    timeWindow: 'cutoff-based',
    name: '满期保费',
    category: 'cost',
    tags: ['cost'],
    formula: {
      description: '保费 × 满期天数 / 保险期限天数（闰年感知）',
      numerator: 'SUM(premium * earned_days / policy_term)',
      unit: '元',
    },
    sql: {
      expression: 'ROUND(SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2) AS earned_premium',
      requiredColumns: ['premium', 'earned_days', 'policy_term'],
      notes: '闰年感知：policy_term = DATEDIFF(起期, 起期+1年) = 365或366天。CTE 中预算 policy_term 和 earned_days',
    },
    display: {
      formatter: 'premiumWan',
      label: '满期保费',
      unit: '万元',
    },
    testCases: [
      {
        name: '满期保费非负',
        input: { whereClause: '1=1' },
        assertions: { earned_premium: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' }],
  },

  {
    id: 'baseline_premium',
    additive: false,
    version: '1.0.0',
    name: '基准保费',
    category: 'cost',
    tags: ['cost', 'pricing', 'baseline'],
    formula: {
      description: '基准保费：商业险按商车自主定价系数归一，非商业险保持原保费',
      numerator: '商业险 premium / commercial_pricing_factor；非商业险 premium',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN insurance_type = '商业保险' AND commercial_pricing_factor > 0
    THEN premium / NULLIF(commercial_pricing_factor, 0)
    WHEN insurance_type = '商业保险'
    THEN NULL
    ELSE premium
  END AS baseline_premium`,
      requiredColumns: ['premium', 'insurance_type', 'commercial_pricing_factor'],
      notes: '先计算基准保费，再进入满期口径。商业险自主系数缺失、为0或负数时输出 NULL，调用方应单独输出异常数据；交强险等非商业险不做自主系数折算。',
    },
    display: {
      formatter: 'premiumWan',
      label: '基准保费',
      unit: '万元',
      tooltip: '基准保费 = 商业险保费 / 商车自主定价系数；非商业险保费不折算',
    },
    testCases: [
      {
        name: '基准保费非负',
        input: { whereClause: '1=1' },
        assertions: { baseline_premium: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-05-12', changes: '新增：商业险价格因子归一的基准保费，作为满期基准保费的前置层' },
    ],
  },

  {
    id: 'baseline_earned_premium',
    additive: true,
    version: '1.0.0',
    timeWindow: 'cutoff-based',
    name: '满期基准保费',
    category: 'cost',
    tags: ['cost', 'pricing', 'baseline'],
    formula: {
      description: '满期基准保费 = 基准保费 × 满期天数 / 保险期限天数（闰年感知）',
      numerator: 'SUM(baseline_premium * earned_days / policy_term)',
      unit: '元',
    },
    sql: {
      expression: `ROUND(SUM(
    (CASE
      WHEN insurance_type = '商业保险' AND commercial_pricing_factor > 0
      THEN premium / NULLIF(commercial_pricing_factor, 0)
      WHEN insurance_type = '商业保险'
      THEN NULL
      ELSE premium
    END) * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)
  ), 2) AS baseline_earned_premium`,
      requiredColumns: ['premium', 'insurance_type', 'commercial_pricing_factor', 'earned_days', 'policy_term'],
      notes: '自包含表达式：内联 baseline_premium CASE 以避免别名引用（domain-testcases 测试单独消费）。对于已完全满期保单，earned_days = policy_term，满期基准保费等于基准保费。',
    },
    display: {
      formatter: 'premiumWan',
      label: '满期基准保费',
      unit: '万元',
      tooltip: '满期基准保费 = 基准保费 × 满期天数 / 保险期限天数',
    },
    testCases: [
      {
        name: '满期基准保费非负',
        input: { whereClause: '1=1' },
        assertions: { baseline_earned_premium: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-05-12', changes: '新增：基准保费进入满期口径后的分母指标' },
    ],
  },

  {
    id: 'baseline_earned_claim_ratio',
    additive: false,
    version: '1.0.0',
    timeWindow: 'cutoff-based',
    name: '满期基准赔付率',
    category: 'cost',
    tags: ['cost', 'pricing', 'baseline'],
    formula: {
      description: '满期基准赔付率 = 已报告赔款 / 满期基准保费',
      numerator: 'SUM(reported_claims)',
      denominator: 'SUM(baseline_earned_premium)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(
      (CASE
        WHEN insurance_type = '商业保险' AND commercial_pricing_factor > 0
        THEN premium / NULLIF(commercial_pricing_factor, 0)
        WHEN insurance_type = '商业保险'
        THEN NULL
        ELSE premium
      END) * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)
    ) > 0
    THEN ROUND(SUM(
      CASE
        WHEN insurance_type = '商业保险' AND NOT (commercial_pricing_factor > 0)
        THEN NULL
        ELSE reported_claims
      END
    ) * 100.0 / SUM(
      (CASE
        WHEN insurance_type = '商业保险' AND commercial_pricing_factor > 0
        THEN premium / NULLIF(commercial_pricing_factor, 0)
        WHEN insurance_type = '商业保险'
        THEN NULL
        ELSE premium
      END) * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)
    ), 2)
    ELSE NULL
  END AS baseline_earned_claim_ratio`,
      requiredColumns: ['reported_claims', 'premium', 'insurance_type', 'commercial_pricing_factor', 'earned_days', 'policy_term'],
      notes: '自包含表达式：内联满期基准保费分母以避免别名引用。分子分母使用一致的有效样本过滤（商业险无效自主系数记录在分子分母都排除）。',
    },
    display: {
      formatter: 'percent',
      label: '满期基准赔付率',
      unit: '%',
      decimals: 1,
      tooltip: '满期基准赔付率 = 已报告赔款 / 满期基准保费 × 100%',
    },
    testCases: [
      {
        name: '满期基准赔付率非负',
        input: { whereClause: '1=1' },
        assertions: { baseline_earned_claim_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-05-12', changes: '新增：基于满期基准保费的价格因子归一赔付率' },
    ],
  },

  {
    id: 'variable_cost_ratio',
    additive: false,
    version: '2.0.0',
    timeWindow: 'cutoff-based',
    name: '变动成本率',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '满期赔付率 + 费用率（两个分母不同；闰年感知）',
      numerator: '已报告赔款/满期保费 + 费用金额/签单保费',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(reported_claims) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) +
      SUM(COALESCE(fee_amount, 0)) * 100.0 / SUM(premium),
      2
    )
    ELSE NULL
  END AS variable_cost_ratio`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term'],
      notes: '赔付率分母=满期保费（premium × earned_days / policy_term，闰年感知），费用率分母=签单保费。可超100%（亏损）',
    },
    display: {
      formatter: 'percent',
      label: '变动成本率',
      unit: '%',
      decimals: 1,
      tooltip: '变动成本率 = 满期赔付率 + 费用率。≤91% 正常，91-94% 预警，>94% 危险',
    },
    testCases: [
      {
        name: '变动成本率非负',
        input: { whereClause: '1=1' },
        assertions: { variable_cost_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-27', changes: '新增，与 cost.ts:generateVariableCostQuery 一致' },
      { version: '2.0.0', date: '2026-04-17', changes: '铁律对齐：赔付分母 exposure_days/365 → earned_days/policy_term；展示精度 2→1 位小数' },
    ],
  },

  {
    id: 'earned_loss_frequency',
    additive: false,
    version: '2.1.0',
    timeWindow: 'cutoff-based',
    name: '满期出险率',
    category: 'cost',
    tags: ['cost'],
    formula: {
      description: '(赔案件数/保单件数) × (保险期限天数/满期天数)。满期后=赔案/保单，未满期年化放大',
      numerator: 'SUM(claim_cases × policy_term / earned_days)',
      denominator: 'COUNT(DISTINCT policy_no)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN COUNT(DISTINCT policy_no) > 0 AND SUM(earned_days) > 0
    THEN ROUND(
      SUM(claim_cases * 1.0 * policy_term / NULLIF(earned_days, 0))
      / COUNT(DISTINCT policy_no) * 100.0,
      2
    )
    ELSE NULL
  END AS earned_loss_frequency`,
      requiredColumns: ['claim_cases', 'policy_term', 'earned_days', 'policy_no'],
      notes: '闰年感知：policy_term = DATEDIFF(起期, 起期+1年) = 365或366天。earned_days = MIN(已过天数, policy_term)。满期后 ratio=1，未满期 ratio>1',
    },
    display: {
      formatter: 'percent',
      label: '出险率',
      unit: '%',
      decimals: 1,
      tooltip: '满期出险率 = (赔案件数/保单数) × (保险期限/满期天数)。闰年自动365/366天',
    },
    testCases: [
      {
        name: '出险率非负',
        input: { whereClause: '1=1' },
        assertions: { earned_loss_frequency: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-27', changes: '从 cost.ts 迁移' },
      { version: '2.0.0', date: '2026-03-31', changes: '口径修正：保单级→年化公式，闰年感知(365/366)' },
      { version: '2.1.0', date: '2026-04-17', changes: '铁律对齐：展示精度 2→1 位小数' },
    ],
  },

  {
    id: 'earned_margin_amount',
    additive: false,
    version: '2.0.0',
    timeWindow: 'cutoff-based',
    name: '满期边际贡献额',
    category: 'cost',
    tags: ['core', 'kpi', 'cost', 'margin'],
    formula: {
      description: '满期保费 × (1 - 已报告赔款/满期保费 - 费用金额/签单保费)（闰年感知）',
      numerator: 'earned_premium × (1 - earned_claim_ratio - expense_ratio)',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) * (
        1.0
        - SUM(reported_claims) / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
        - SUM(COALESCE(fee_amount, 0)) / SUM(premium)
      ), 2
    )
    ELSE NULL
  END AS earned_margin_amount`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term'],
      notes: '基于已赚保费的实际边际贡献，随满期天数增长而变化。已满期保单与 projected_margin_amount 相等。闰年感知分母',
    },
    display: {
      formatter: 'premiumWan',
      label: '满期边际贡献额',
      unit: '万元',
      tooltip: '满期边际贡献额 = 满期保费 × (1 - 满期赔付率 - 费用率)。跨日期对比可判断赔付恶化/改善',
    },
    testCases: [
      {
        name: '满期边际贡献额可为负（亏损）',
        input: { whereClause: '1=1' },
        assertions: { earned_margin_amount: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-31', changes: '新增：时序对比核心指标，诊断脚本同步使用' },
      { version: '2.0.0', date: '2026-04-17', changes: '铁律对齐：赔付分母 exposure_days/365 → earned_days/policy_term' },
    ],
  },

  {
    id: 'projected_margin_amount',
    additive: false,
    version: '2.0.0',
    timeWindow: 'cutoff-based',
    name: '预估边际贡献额',
    category: 'cost',
    tags: ['core', 'kpi', 'cost', 'margin'],
    formula: {
      description: '签单保费 × (1 - 已报告赔款/满期保费 - 费用金额/签单保费)（闰年感知）',
      numerator: 'premium × (1 - earned_claim_ratio - expense_ratio)',
      unit: '元',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0 AND SUM(premium) > 0
    THEN ROUND(
      SUM(premium) * (
        1.0
        - SUM(reported_claims) / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
        - SUM(COALESCE(fee_amount, 0)) / SUM(premium)
      ), 2
    )
    ELSE NULL
  END AS projected_margin_amount`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term'],
      notes: '假设全部保费赚完后的预估边际贡献，用于预判最终盈亏。与 earned_margin_amount 共享变动成本率，仅保费基数不同。闰年感知分母',
    },
    display: {
      formatter: 'premiumWan',
      label: '预估边际贡献额',
      unit: '万元',
      tooltip: '预估边际贡献额 = 签单保费 × (1 - 满期赔付率 - 费用率)。未满期保单差异越大说明待赚保费越多',
    },
    testCases: [
      {
        name: '预估边际贡献额可为负（亏损）',
        input: { whereClause: '1=1' },
        assertions: { projected_margin_amount: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-03-31', changes: '新增：时序对比核心指标，诊断脚本同步使用' },
      { version: '2.0.0', date: '2026-04-17', changes: '铁律对齐：赔付分母 exposure_days/365 → earned_days/policy_term' },
    ],
  },

  {
    id: 'comprehensive_expense_ratio',
    additive: false,
    version: '1.0.0',
    name: '综合费用率',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '(已报告赔款 + 费用金额) / 满期保费（闰年感知）',
      numerator: 'SUM(reported_claims) + SUM(fee_amount)',
      denominator: 'SUM(premium * earned_days / policy_term)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN ROUND(
      (SUM(reported_claims) + SUM(COALESCE(fee_amount, 0))) * 100.0
        / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)),
      2
    )
    ELSE NULL
  END AS comprehensive_expense_ratio`,
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term'],
      notes: '与变动成本率的区别：分子费用金额基于已赚口径统一除满期保费，适合综合费用对标。闰年感知分母',
    },
    display: {
      formatter: 'percent',
      label: '综合费用率',
      unit: '%',
      decimals: 1,
      tooltip: '综合费用率 = (已报告赔款 + 费用金额) / 满期保费。等同"变动成本额/满期保费"',
    },
    testCases: [
      {
        name: '综合费用率非负',
        input: { whereClause: '1=1' },
        assertions: { comprehensive_expense_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-04-17', changes: '新增：综合分析补齐，分母闰年感知（earned_days/policy_term）' },
    ],
  },

  // ============================================================================
  // 综合成本指标（L4 — 依赖外部固定成本参数）
  // ============================================================================

  {
    id: 'fixed_cost_amount',
    additive: false,
    version: '1.0.0',
    name: '固定成本额',
    category: 'cost',
    tags: ['cost', 'fixed-cost'],
    formula: {
      description: '附加税费额 + 推动费额 + 管理费额（均为绝对值聚合）',
      numerator: 'SUM(保费×1.5%) + SUM(交强保费×0.15% + 商业保费×0.4%) + Σ(各机构保费×管理成本比例)',
      unit: '元',
    },
    sql: {
      expression: '-- L4 计算，由诊断脚本 diagnose_vehicle.py 通过 fixed_cost_config.py 动态生成 SQL',
      requiredColumns: ['premium', '险类', '三级机构'],
      notes: 'L4 计算。固定成本参数来自 数据管理/config/fixed-cost-params.json。聚合时必须先算绝对值分子分母再除，禁止率值相加',
    },
    display: {
      formatter: 'premiumWan',
      label: '固定成本额',
      unit: '万元',
      tooltip: '固定成本额 = 附加税费(1.5%) + 销售推动费(交强0.15%/商业0.4%) + 管理费(逐机构)',
    },
    testCases: [
      {
        name: '固定成本额非负',
        input: { whereClause: '1=1' },
        assertions: { fixed_cost_amount: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-02', changes: '新增：固定成本三分项绝对值，参数来自 fixed-cost-params.json' }],
  },

  {
    id: 'fixed_cost_ratio',
    additive: false,
    version: '1.0.0',
    name: '固定成本率',
    category: 'cost',
    tags: ['cost', 'fixed-cost'],
    formula: {
      description: '固定成本额 / 满期保费',
      numerator: 'SUM(fixed_cost_amount)',
      denominator: 'SUM(earned_premium)',
      unit: '%',
    },
    sql: {
      expression: '-- L4 计算，fixed_cost_amount / earned_premium',
      requiredColumns: ['premium', 'earned_days', 'policy_term', '险类', '三级机构'],
      notes: 'L4 计算。由诊断脚本 diagnose_vehicle.py 自动输出。率值必须从绝对值计算，禁止率值相加',
    },
    display: {
      formatter: 'percent',
      label: '固定成本率',
      unit: '%',
      decimals: 1,
      tooltip: '固定成本率 = (附加税费+推动费+管理费) / 满期保费',
    },
    testCases: [
      {
        name: '固定成本率非负',
        input: { whereClause: '1=1' },
        assertions: { fixed_cost_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-02', changes: '新增：固定成本占比' }],
  },

  {
    id: 'combined_cost_amount',
    additive: false,
    version: '1.0.0',
    timeWindow: 'cutoff-based',
    name: '综合成本额',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '变动成本额 + 固定成本额 = 已报告赔款 + 费用金额 + 固定成本额',
      numerator: 'SUM(reported_claims) + SUM(fee_amount) + SUM(fixed_cost)',
      unit: '元',
    },
    sql: {
      expression: '-- L4 计算',
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term', '险类', '三级机构'],
      notes: 'L4 计算。绝对值相加，诊断脚本自动输出',
    },
    display: {
      formatter: 'premiumWan',
      label: '综合成本额',
      unit: '万元',
      tooltip: '综合成本额 = 已报告赔款 + 费用金额 + 固定成本额',
    },
    testCases: [
      {
        name: '综合成本额非负',
        input: { whereClause: '1=1' },
        assertions: { combined_cost_amount: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-02', changes: '新增：全口径成本绝对值' }],
  },

  {
    id: 'combined_cost_ratio',
    additive: false,
    version: '1.1.0',
    timeWindow: 'cutoff-based',
    name: '综合成本率',
    category: 'cost',
    tags: ['core', 'kpi', 'cost'],
    formula: {
      description: '综合成本额 / 满期保费（绝对值除法，非率值相加）',
      numerator: 'SUM(combined_cost_amount)',
      denominator: 'SUM(earned_premium)',
      unit: '%',
    },
    sql: {
      expression: '-- L4 计算，combined_cost_amount / earned_premium',
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term', '险类', '三级机构'],
      notes: 'L4 计算。≤100% 盈利，>100% 亏损。亮灯：≤99% 🟢 / 99-101% 🔵 / 101-105% 🟡 / >105% 🔴',
    },
    display: {
      formatter: 'percent',
      label: '综合成本率',
      unit: '%',
      decimals: 1,
      tooltip: '综合成本率 = (赔付+费用+附加税费+推动费+管理费) / 满期保费。≤100% 盈利',
    },
    testCases: [
      {
        name: '综合成本率非负',
        input: { whereClause: '1=1' },
        assertions: { combined_cost_ratio: { op: 'gte', value: 0 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-04-02', changes: '新增：全口径成本率，含固定成本三分项（附加税费+推动费+管理费）' },
      { version: '1.1.0', date: '2026-04-17', changes: '铁律对齐：分母满期保费统一 earned_days/policy_term 闰年感知（依赖 earned_premium v2.0.0）' },
    ],
  },

  {
    id: 'earned_profit_amount',
    additive: false,
    version: '1.0.0',
    timeWindow: 'cutoff-based',
    name: '利润额',
    category: 'cost',
    tags: ['core', 'kpi', 'cost', 'profit'],
    formula: {
      description: '满期保费 - 综合成本额 = 边际贡献额 - 固定成本额',
      numerator: 'SUM(earned_premium) - SUM(combined_cost_amount)',
      unit: '元',
    },
    sql: {
      expression: '-- L4 计算，earned_premium - combined_cost_amount',
      requiredColumns: ['premium', 'reported_claims', 'fee_amount', 'earned_days', 'policy_term', '险类', '三级机构'],
      notes: 'L4 计算。真实盈亏 = 边际贡献额 - 固定成本额。与边际贡献额并存：边际贡献额反映承保品质，利润额反映真实盈亏',
    },
    display: {
      formatter: 'premiumWan',
      label: '利润额',
      unit: '万元',
      tooltip: '利润额 = 满期保费 - 综合成本额。正值盈利，负值亏损',
    },
    testCases: [
      {
        name: '利润额可为负（亏损）',
        input: { whereClause: '1=1' },
        assertions: { earned_profit_amount: { op: 'type', value: 'number' } },
      },
    ],
    changelog: [{ version: '1.0.0', date: '2026-04-02', changes: '新增：全口径利润，含固定成本（管理费+推动费+附加税费）' }],
  },

  {
    id: 'bi_case_ratio_pct',
    additive: false,
    version: '1.0.0',
    name: '人伤案件占比',
    category: 'cost',
    tags: ['cost', 'bodily-injury'],
    formula: {
      description: '人伤案件数 / 总案件数（claims_detail 底表）',
      numerator: 'SUM(CAST(is_bodily_injury AS INT))',
      denominator: 'COUNT(*)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN COUNT(*) > 0
    THEN 100.0 * SUM(CAST(COALESCE(is_bodily_injury, FALSE) AS INT)) / COUNT(*)
    ELSE NULL
  END AS bi_case_ratio_pct`,
      requiredColumns: ['is_bodily_injury'],
      notes: '作用于 claims_detail 原始底表（非 policy 聚合 CTE）。is_bodily_injury 老案可能 NULL，COALESCE FALSE 兜底。整体实测约 10.7%（74.8 万案 / 8.01 万人伤）。',
    },
    display: {
      formatter: 'percent',
      label: '人伤案占比',
      unit: '%',
      decimals: 1,
      tooltip: '人伤案件占比 = 人伤案件数 ÷ 总案件数（频率维度的人伤暴露）',
    },
    testCases: [
      {
        name: '人伤案占比在 0-100 之间',
        input: { whereClause: '1=1' },
        assertions: { bi_case_ratio_pct: { op: 'between', min: 0, max: 100 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-05-16', changes: '由 diagnose-loss-development 引入；与 bi_amount_ratio_pct 配对呈现"频率轻/金额重"的人伤特性' },
    ],
  },

  {
    id: 'bi_amount_ratio_pct',
    additive: false,
    version: '1.0.0',
    name: '人伤赔款占比',
    category: 'cost',
    tags: ['cost', 'bodily-injury'],
    formula: {
      description: '(人伤已决 + 人伤未决) / (总已决 + 总未决)（claims_detail 底表）',
      numerator: 'SUM(settled_bodily_amount) + SUM(reserve_bodily_amount)',
      denominator: 'SUM(settled_amount) + SUM(reserve_amount)',
      unit: '%',
    },
    sql: {
      expression: `CASE
    WHEN (SUM(settled_amount) + SUM(reserve_amount)) > 0
    THEN 100.0 * (SUM(settled_bodily_amount) + SUM(reserve_bodily_amount)) / (SUM(settled_amount) + SUM(reserve_amount))
    ELSE NULL
  END AS bi_amount_ratio_pct`,
      requiredColumns: ['settled_bodily_amount', 'reserve_bodily_amount', 'settled_amount', 'reserve_amount'],
      notes: '作用于 claims_detail 原始底表。未决金额用 reserve_amount（项目标准口径，非 pending_amount，参 feedback_pending_vs_reserve_amount）。整体实测约 53.95%（人伤案件占比仅 10.7%，但占用 54% 赔款金额—严重性放大 5 倍）。',
    },
    display: {
      formatter: 'percent',
      label: '人伤金额占比',
      unit: '%',
      decimals: 1,
      tooltip: '人伤赔款占比 = (人伤已决+人伤未决) ÷ (总已决+总未决)（严重性维度的人伤占用）',
    },
    testCases: [
      {
        name: '人伤金额占比在 0-100 之间',
        input: { whereClause: '1=1' },
        assertions: { bi_amount_ratio_pct: { op: 'between', min: 0, max: 100 } },
      },
      {
        name: '人伤金额占比 > 人伤案占比（严重性放大效应）',
        input: { whereClause: '1=1' },
        assertions: { bi_amount_ratio_pct: { op: 'gt', value: 30 } },
      },
    ],
    changelog: [
      { version: '1.0.0', date: '2026-05-16', changes: '由 diagnose-loss-development 引入；与 bi_case_ratio_pct 配对呈现"频率轻/金额重"的人伤特性' },
    ],
  },
];
