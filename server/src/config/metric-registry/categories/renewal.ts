/**
 * 续保分析域指标（category: 'renewal'）
 *
 * 数据源：RenewalTrackerFact 派生域（warehouse/fact/renewal_tracker/latest.parquet）。
 * 真实 SQL 在生成器 server/src/sql/renewal-tracker.ts（GROUPING SETS 24 层）+ 诊断脚本
 * diagnose_renewal_branch.py。本注册表条目为 L4 占位符（expression 以 -- 开头），承载口径定义、
 * 单位、展示与 changelog，使 `cx metrics --category renewal` 可枚举续保口径族。
 *
 * 口径 SSOT（与 renewal-tracker.ts 头注一致，非臆测）：
 *   A 应续件数 = VIN 去重 COUNT(DISTINCT vehicle_frame_no)
 *   B 报价件数 = first_quote_time ≤ cutoff 的应续 VIN（报价为真实时点事件，按 cutoff 切片）
 *   C 已续件数 = is_renewed（匹配到续保单号即已签单成交；renewed_date 是起保日非签单时点，不按 cutoff 过滤）
 *   D 未报价件数 = A − B
 *   E 流失件数 = A − C（⚠️ 仅已到期窗口为真实流失；未到期窗口为「待续件数」）
 *   续保影响度 = E ÷ 合计应续件数（窗口聚合分母，什么分类按什么合计）
 *
 * 注：本族「续保率」= C ÷ A（续保分析板块精确口径，基于到期判断）由路由/诊断脚本下游用 A、C 计算，
 *     与 ratio 域的 `renewal_rate`（PolicyFact is_renewal 占比，KPI 面板快速口径）是**两个不同口径**，
 *     勿混用。是否将 C/A 注册为独立指标待用户口径裁决（避免与 renewal_rate 同名歧义）。
 */

import type { MetricDefinition } from '../types.js';

export const renewalMetrics: readonly MetricDefinition[] = [
  // ===== A 应续件数 =====
  {
    id: 'renewal_due_count',
    version: '1.0.0',
    name: '应续件数',
    category: 'renewal',
    tags: ['renewal', 'count'],
    formula: {
      description: '续保窗口内应续保的车辆件数（按车架号去重）',
      numerator: 'COUNT(DISTINCT vehicle_frame_no)',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，应续件数 A = COUNT(DISTINCT vehicle_frame_no)，由续保 SQL 生成器 renewal-tracker.ts（GROUPING SETS）实现',
      requiredColumns: ['vehicle_frame_no', 'expiry_date'],
      notes: 'L4 计算。数据源为 renewal_tracker 派生域（非 policy 主表）。续保窗口内按车架号去重',
    },
    display: { formatter: 'count', label: '应续件数', unit: '件' },
    testCases: [
      { name: '应续件数非负', input: { whereClause: '1=1' }, assertions: { renewal_due_count: { op: 'gte', value: 0 } } },
    ],
    changelog: [{ version: '1.0.0', date: '2026-06-19', changes: '新增：续保应续件数 A（VIN 去重），L4 占位符；口径取 renewal-tracker.ts SSOT' }],
  },

  // ===== B 报价件数 =====
  {
    id: 'renewal_quoted_count',
    version: '1.0.0',
    name: '报价件数',
    category: 'renewal',
    tags: ['renewal', 'count'],
    formula: {
      description: '应续车中截至观察时点已有有效报价的件数（报价为真实时点事件，按 cutoff 切片）',
      numerator: 'COUNT(DISTINCT vehicle_frame_no WHERE is_quoted AND first_quote_time ≤ cutoff)',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，报价件数 B = 应续中 first_quote_time ≤ cutoff 的 VIN 去重计数，由续保 SQL 生成器 renewal-tracker.ts 实现',
      requiredColumns: ['vehicle_frame_no', 'is_quoted', 'first_quote_time', 'expiry_date'],
      notes: 'L4 计算。报价为真实时点事件，按观察截止日 cutoff 切片。数据源为 renewal_tracker 派生域',
    },
    display: { formatter: 'count', label: '报价件数', unit: '件' },
    testCases: [
      { name: '报价件数非负', input: { whereClause: '1=1' }, assertions: { renewal_quoted_count: { op: 'gte', value: 0 } } },
    ],
    changelog: [{ version: '1.0.0', date: '2026-06-19', changes: '新增：续保报价件数 B（first_quote_time ≤ cutoff），L4 占位符；口径取 renewal-tracker.ts SSOT' }],
  },

  // ===== C 已续件数 =====
  {
    id: 'renewal_renewed_count',
    version: '1.0.0',
    name: '已续件数',
    category: 'renewal',
    tags: ['renewal', 'count'],
    formula: {
      description: '应续车中已签单成交续保的件数（匹配到续保单号）',
      numerator: 'COUNT(DISTINCT vehicle_frame_no WHERE is_renewed)',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，已续件数 C = 应续中 is_renewed 的 VIN 去重计数，由续保 SQL 生成器 renewal-tracker.ts 实现',
      requiredColumns: ['vehicle_frame_no', 'is_renewed', 'expiry_date'],
      notes: 'L4 计算。is_renewed 匹配到续保单号即已签单成交；renewed_date 是续保起保日（=原保单到期次日）非签单时点，不按 cutoff 过滤（未到期已签单仍属已续）',
    },
    display: { formatter: 'count', label: '已续件数', unit: '件' },
    testCases: [
      { name: '已续件数非负', input: { whereClause: '1=1' }, assertions: { renewal_renewed_count: { op: 'gte', value: 0 } } },
    ],
    changelog: [{ version: '1.0.0', date: '2026-06-19', changes: '新增：续保已续件数 C（is_renewed），L4 占位符；口径取 renewal-tracker.ts SSOT' }],
  },

  // ===== D 未报价件数（自 foundation 归类至 renewal 域）=====
  {
    id: 'renewal_unquoted_count',
    version: '1.1.0',
    name: '未报价件数',
    category: 'renewal',
    tags: ['renewal', 'count'],
    formula: {
      description: '应续车中至今无任何有效报价的件数 = 应续件数 − 已报价件数',
      numerator: 'COUNT(DISTINCT vehicle_frame_no)（应续） − 已报价件数',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，应续件数 − 已报价件数（A − B），由续保 SQL 生成器 renewal-tracker.ts 与诊断脚本 diagnose_renewal_branch.py 实现',
      requiredColumns: ['vehicle_frame_no', 'is_quoted', 'first_quote_time', 'expiry_date'],
      notes: 'L4 计算。数据源为 renewal_tracker 派生域（非 policy 主表）。续保窗口内按车架号去重',
    },
    display: { formatter: 'count', label: '未报价件数', unit: '件' },
    testCases: [
      { name: '未报价件数非负', input: { whereClause: '1=1' }, assertions: { renewal_unquoted_count: { op: 'gte', value: 0 } } },
    ],
    changelog: [
      { version: '1.1.0', date: '2026-06-19', changes: '归类调整：foundation → renewal 续保分析域（口径不变；与 A/B/C/E/影响度 同域可一并 cx metrics --category renewal 枚举）' },
      { version: '1.0.0', date: '2026-06-07', changes: '新增：续保未报价件数（应续 − 已报价），L4 占位符' },
    ],
  },

  // ===== E 流失件数（自 foundation 归类至 renewal 域）=====
  {
    id: 'renewal_lost_count',
    version: '1.1.0',
    name: '流失件数',
    category: 'renewal',
    tags: ['renewal', 'count'],
    formula: {
      description: '应续车中尚未续保的件数（含未报价 + 已报价未成交）= 应续件数 − 已续保件数',
      numerator: 'COUNT(DISTINCT vehicle_frame_no)（应续） − 已续保件数',
      unit: '件',
    },
    sql: {
      expression:
        '-- L4 计算，应续件数 − 已续保件数（A − C），由续保 SQL 生成器 renewal-tracker.ts 与诊断脚本 diagnose_renewal_branch.py 实现',
      requiredColumns: ['vehicle_frame_no', 'is_renewed', 'expiry_date'],
      notes:
        'L4 计算。数据源为 renewal_tracker 派生域。⚠️ 仅在已到期窗口表示真实流失；未到期窗口为「待续件数」（尚未到续保动作时点）',
    },
    display: { formatter: 'count', label: '流失件数', unit: '件' },
    testCases: [
      { name: '流失件数非负', input: { whereClause: '1=1' }, assertions: { renewal_lost_count: { op: 'gte', value: 0 } } },
    ],
    changelog: [
      { version: '1.1.0', date: '2026-06-19', changes: '归类调整：foundation → renewal 续保分析域（口径不变）' },
      { version: '1.0.0', date: '2026-06-07', changes: '新增：续保流失件数（应续 − 已续保），L4 占位符' },
    ],
  },

  // ===== 续保影响度（自 ratio 归类至 renewal 域）=====
  {
    id: 'renewal_impact_rate',
    version: '1.1.0',
    name: '续保影响度',
    category: 'renewal',
    tags: ['renewal', 'ratio'],
    formula: {
      description:
        '该分类流失导致整体续保缺口扩大的占比；可加和，各分类之和 = 整体续保缺口（1 − 续保率）',
      numerator: 'SUM(流失件数)（按分类聚合）',
      denominator: '合计应续件数（窗口内全部分类的应续件数合计）',
      unit: '%',
    },
    sql: {
      expression:
        '-- L4 计算，流失件数 ÷ 合计应续件数（分母为窗口合计应续，需窗口聚合 SUM(...) OVER()），由诊断脚本 diagnose_renewal_branch.py 实现',
      requiredColumns: ['vehicle_frame_no', 'is_renewed', 'expiry_date', 'org_level_3'],
      notes:
        'L4 计算。遵循「先聚合后计算」：先按分类（机构/团队/业务员）聚合各件数，再以该次分类的合计应续件数为分母，什么分类就按什么合计。⚠️ 仅在已到期窗口表示真实流失影响度（越高越坏）',
    },
    display: {
      formatter: 'percent',
      label: '续保影响度',
      unit: '%',
      decimals: 1,
      tooltip: '续保影响度 = 流失件数 ÷ 合计应续件数；各分类可加和 = 整体续保缺口（越高越坏）',
    },
    testCases: [
      { name: '续保影响度非负', input: { whereClause: '1=1' }, assertions: { renewal_impact_rate: { op: 'gte', value: 0 } } },
    ],
    changelog: [
      { version: '1.1.0', date: '2026-06-19', changes: '归类调整：ratio → renewal 续保分析域（口径不变）' },
      { version: '1.0.0', date: '2026-06-07', changes: '新增：续保影响度（流失 ÷ 合计应续，可加和缺口分解），L4 占位符' },
    ],
  },
];
