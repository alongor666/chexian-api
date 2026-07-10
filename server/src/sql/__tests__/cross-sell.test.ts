/**
 * 交叉销售（驾意险推介率）SQL 生成器 — 综合单元测试
 * Cross-Sell SQL Generator — Comprehensive Unit Tests
 *
 * 覆盖 6 个模块：
 *   1. cross-sell.ts              — 主推介率下钻查询
 *   2. cross-sell-summary.ts      — 时间段汇总查询 + 车辆类别过滤
 *   3. cross-sell-heatmap.ts      — 热力图查询
 *   4. cross-sell-trend.ts        — 推介率走势查询
 *   5. cross-sell-org-trend.ts    — 机构日走势查询
 *   6. cross-sell-top-salesman.ts — TOP20 业务员排行
 *
 * 注意：合同测试（drilldown-contract.cross-sell.test.ts）已覆盖
 * generateCrossSellQuery 的下钻语义不变式（C-01 ～ C-11），
 * 本文件专注于补充覆盖其余维度、边界条件与所有其他 5 个模块。
 */

import { describe, expect, it } from 'vitest';

// ── Module 1: cross-sell.ts ──────────────────────────────────────────────────
import {
  generateCrossSellQuery,
  DIMENSION_LABELS,
  type CrossSellDimension,
  type DrilldownStep,
} from '../cross-sell.js';

// ── Module 2: cross-sell-summary.ts ─────────────────────────────────────────
import {
  generateCrossSellTimePeriodQuery,
  getVehicleCategoryFilter,
  type VehicleCategory,
} from '../cross-sell-summary.js';

// ── Module 3: cross-sell-heatmap.ts ──────────────────────────────────────────
import {
  generateCrossSellHeatmapQuery,
  type CrossSellHeatmapGroupDimension,
} from '../cross-sell-heatmap.js';

// ── Module 4: cross-sell-trend.ts ────────────────────────────────────────────
import {
  generateCrossSellTrendQuery,
  type TrendGranularity,
} from '../cross-sell-trend.js';

// ── Module 5: cross-sell-org-trend.ts ────────────────────────────────────────
import {
  generateCrossSellOrgTrendQuery,
  type CoverageCombinationFilter,
} from '../cross-sell-org-trend.js';

// ── Module 6: cross-sell-top-salesman.ts ─────────────────────────────────────
import {
  generateCrossSellTopSalesmanQuery,
  type TopSalesmanCoverage,
} from '../cross-sell-top-salesman.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 共享常量
// ═══════════════════════════════════════════════════════════════════════════════

const BASE_WHERE = '1=1';
const ORG_WHERE = "org_level_3 = '天府'";

const ALL_DIMS: CrossSellDimension[] = [
  'org_level_3', 'team', 'salesman',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
  'insurance_grade',
];

const ALL_VEHICLE_CATEGORIES: VehicleCategory[] = ['all', 'passenger', 'truck', 'motorcycle'];

// ═══════════════════════════════════════════════════════════════════════════════
// 1. cross-sell.ts — generateCrossSellQuery 补充测试
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateCrossSellQuery — 补充覆盖', () => {
  // ── 1-A: 所有维度均可生成合法 SQL ───────────────────────────────────────────
  it('1-A: 9 个维度逐一调用均返回非空字符串', () => {
    for (const dim of ALL_DIMS) {
      const sql = generateCrossSellQuery(BASE_WHERE, [], dim);
      expect(typeof sql).toBe('string');
      expect(sql.trim().length).toBeGreaterThan(50);
    }
  });

  // ── 1-B: baseWhereClause 正确注入 ───────────────────────────────────────────
  it('1-B: baseWhereClause 字符串注入到 WHERE 子句中', () => {
    const sql = generateCrossSellQuery(ORG_WHERE, [], 'org_level_3');
    expect(sql).toContain("org_level_3 = '天府'");
  });

  // ── 1-C: 布尔维度—is_transfer 标签翻译 ──────────────────────────────────────
  it("1-C: groupBy=is_transfer 输出 '过户车'/'非过户车' 标签", () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'is_transfer');
    expect(sql).toContain("'过户车'");
    expect(sql).toContain("'非过户车'");
  });

  // ── 1-D: 布尔维度—is_nev 标签翻译 ──────────────────────────────────────────
  it("1-D: groupBy=is_nev 输出 '新能源'/'非新能源' 标签", () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'is_nev');
    expect(sql).toContain("'新能源'");
    expect(sql).toContain("'非新能源'");
  });

  // ── 1-E: 布尔维度—is_telemarketing 标签翻译 ─────────────────────────────────
  it("1-E: groupBy=is_telemarketing 输出 '电销'/'非电销' 标签", () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'is_telemarketing');
    expect(sql).toContain("'电销'");
    expect(sql).toContain("'非电销'");
  });

  // ── 1-F: 布尔维度—is_renewal 标签翻译 ──────────────────────────────────────
  it("1-F: groupBy=is_renewal 输出 '续保'/'非续保' 标签", () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'is_renewal');
    expect(sql).toContain("'续保'");
    expect(sql).toContain("'非续保'");
  });

  // ── 1-G: salesman 聚合键带工号（人唯一键）+ display_name 短名两级判重 ──────────
  // 2026-06-27 口径修复（跟进 performance-analysis 样板 PR #830）：聚合/分组键改回带工号
  // salesman_name 防同名不同工号真人合并（张丽×3 等）；短名仅用于展示层 display_name。
  // 口径见业务规则字典 §业务员（聚合键 vs 展示口径 RED LINE）。
  it('1-G: groupBy=salesman 聚合键带工号 + display_name 短名两级判重', () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'salesman');
    // 聚合键用带工号全名（COALESCE 防空），非去工号短名
    expect(sql).toContain("COALESCE(c.salesman_name, '未知') AS group_name");
    expect(sql).toContain("GROUP BY COALESCE(c.salesman_name, '未知')");
    expect(sql).not.toContain("REGEXP_REPLACE(c.salesman_name, '^[0-9]+', '') AS group_name");
    // display_name：短名 + 冲突两级判重（同机构同名加工号兜底 REGEXP_EXTRACT）
    expect(sql).toContain('AS display_name');
    expect(sql).toContain("REGEXP_EXTRACT(group_name, '^[0-9]+')");
  });

  // ── 1-G2: groupBy=salesman 时注入 SalesmanDim JOIN 用归属机构 ──────────────
  it('1-G2: groupBy=salesman 时注入 SalesmanDim JOIN 取归属机构', () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'salesman');
    expect(sql).toContain('LEFT JOIN salesman_dim sd ON c.salesman_name = sd.full_name'); // 剥列 CTE（2026-07-09 Binder Error 根治）
    expect(sql).toContain('salesman_dim AS (SELECT full_name, organization FROM SalesmanDim)');
    expect(sql).toContain('COALESCE(sd.organization');
  });

  it('1-G3: groupBy≠salesman 时不注入 SalesmanDim JOIN', () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'org_level_3');
    expect(sql).not.toContain('SalesmanDim');
  });

  // ── 1-H: drillPath team 步骤触发 JOIN（即便 groupBy 不是 team）──────────────
  it('1-H: drillPath 含 team 步骤时即使 groupBy≠team 也触发 SalesmanTeamMapping JOIN', () => {
    const steps: DrilldownStep[] = [{ dimension: 'team', value: '天府一队' }];
    const sql = generateCrossSellQuery(BASE_WHERE, steps, 'salesman');
    expect(sql).toContain('LEFT JOIN team_mapping'); // 剥列 CTE（2026-07-09 Binder Error 根治，替代裸 SalesmanTeamMapping JOIN）
    expect(sql).toContain('team_mapping AS (SELECT full_name, team_name FROM SalesmanTeamMapping)');
  });

  // ── 1-I: 多步下钻路径 WHERE 子句叠加 ────────────────────────────────────────
  it('1-I: 两步下钻路径正确叠加两个 AND 条件', () => {
    const steps: DrilldownStep[] = [
      { dimension: 'org_level_3', value: '天府' },
      { dimension: 'is_new_car', value: '新车' },
    ];
    const sql = generateCrossSellQuery(BASE_WHERE, steps, 'salesman');
    expect(sql).toContain("org_level_3 = '天府'");
    expect(sql).toContain('is_new_car = true');
  });

  // ── 1-J: drillPath is_transfer 布尔值正确翻译 ───────────────────────────────
  it('1-J: drillPath is_transfer=过户车 翻译为 boolean true', () => {
    const steps: DrilldownStep[] = [{ dimension: 'is_transfer', value: '过户车' }];
    const sql = generateCrossSellQuery(BASE_WHERE, steps, 'org_level_3');
    expect(sql).toContain('is_transfer = true');
  });

  // ── 1-K: drillPath is_renewal=非续保 翻译为 false ───────────────────────────
  it('1-K: drillPath is_renewal=非续保 翻译为 boolean false', () => {
    const steps: DrilldownStep[] = [{ dimension: 'is_renewal', value: '非续保' }];
    const sql = generateCrossSellQuery(BASE_WHERE, steps, 'org_level_3');
    expect(sql).toContain('is_renewal = false');
  });

  // ── 1-L: 汇总模式没有 GROUP BY ──────────────────────────────────────────────
  it('1-L: groupBy=null 的汇总模式不含 GROUP BY 关键字', () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], null);
    // 汇总查询使用 summary CTE 但无 GROUP BY
    expect(sql).not.toContain('GROUP BY');
  });

  // ── 1-M: 分组模式含 ORDER BY ────────────────────────────────────────────────
  it('1-M: 分组模式输出按 total_auto_count DESC 排序', () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], 'org_level_3');
    expect(sql).toContain('ORDER BY total_auto_count DESC');
  });

  // ── 1-N: insurance_grade 下钻路径使用 COALESCE 默认 X ───────────────────────
  it('1-N: drillPath insurance_grade=X 使用 COALESCE 防空值', () => {
    const steps: DrilldownStep[] = [{ dimension: 'insurance_grade', value: 'X' }];
    const sql = generateCrossSellQuery(BASE_WHERE, steps, 'org_level_3');
    expect(sql).toContain("COALESCE");
    expect(sql).toContain("'X'");
  });

  // ── 1-O: DIMENSION_LABELS 导出完整 ──────────────────────────────────────────
  it('1-O: DIMENSION_LABELS 包含 9 个维度标签且非空', () => {
    expect(Object.keys(DIMENSION_LABELS)).toHaveLength(9);
    for (const dim of ALL_DIMS) {
      expect(typeof DIMENSION_LABELS[dim]).toBe('string');
      expect(DIMENSION_LABELS[dim].length).toBeGreaterThan(0);
    }
  });

  // ── 1-P: 业务员下钻用带工号精确匹配（防同名多人合并）— 2026-06-27 口径修复 ───────
  it('1-P: drillPath salesman 步骤用带工号精确匹配，非去工号短名', () => {
    const steps: DrilldownStep[] = [{ dimension: 'salesman', value: '118069129张丽' }];
    const sql = generateCrossSellQuery(BASE_WHERE, steps, 'org_level_3');
    // 带工号精确匹配单个真人（无 team JOIN 时 colPrefix 为空）
    expect(sql).toContain("COALESCE(salesman_name, '未知') = '118069129张丽'");
    expect(sql).not.toContain("REGEXP_REPLACE(salesman_name, '^[0-9]+', '') = '118069129张丽'");
  });

  // ── 1-Q: 汇总模式也输出 display_name 列（前端统一消费）───────────────────────
  it('1-Q: groupBy=null 汇总模式输出 display_name 列', () => {
    const sql = generateCrossSellQuery(BASE_WHERE, [], null);
    expect(sql).toContain('group_name AS display_name');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. cross-sell-summary.ts — getVehicleCategoryFilter + generateCrossSellTimePeriodQuery
// ═══════════════════════════════════════════════════════════════════════════════

describe('getVehicleCategoryFilter — 车辆类别过滤表达式', () => {
  it('2-A: all 返回 1=1 不过滤', () => {
    expect(getVehicleCategoryFilter('all')).toBe('1=1');
  });

  it('2-B: passenger 包含三类非营业客车', () => {
    const filter = getVehicleCategoryFilter('passenger');
    expect(filter).toContain('非营业个人客车');
    expect(filter).toContain('非营业企业客车');
    expect(filter).toContain('非营业机关客车');
    expect(filter).toContain('customer_category IN');
  });

  it('2-C: truck 使用 LIKE %货车%', () => {
    const filter = getVehicleCategoryFilter('truck');
    expect(filter).toContain("customer_category LIKE '%货车%'");
  });

  it('2-D: motorcycle 精确匹配摩托车', () => {
    const filter = getVehicleCategoryFilter('motorcycle');
    expect(filter).toBe("customer_category = '摩托车'");
  });

  it('2-E: colPrefix 参数将前缀附加到字段名', () => {
    const filter = getVehicleCategoryFilter('passenger', 'p.');
    expect(filter).toContain('p.customer_category');
  });

  it('2-F: all 类别加 colPrefix 仍返回 1=1', () => {
    expect(getVehicleCategoryFilter('all', 'c.')).toBe('1=1');
  });
});

describe('generateCrossSellTimePeriodQuery — 时间段汇总查询', () => {
  it('2-G: 返回字符串且长度可观（>500 字符）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(500);
  });

  it('2-H: 数据源为 CrossSellDailyAgg（不是 PolicyFact）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain('CrossSellDailyAgg');
    expect(sql).not.toContain('FROM PolicyFact');
  });

  it('2-I: 包含 5 个时间段 CTE 列（day/week/month/quarter/year）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain('day_auto_count');
    expect(sql).toContain('week_auto_count');
    expect(sql).toContain('month_auto_count');
    expect(sql).toContain('quarter_auto_count');
    expect(sql).toContain('year_auto_count');
  });

  it('2-J: 包含上期环比列（prev_day/week/month/quarter）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain('prev_day_auto_count');
    expect(sql).toContain('prev_week_auto_count');
    expect(sql).toContain('prev_month_auto_count');
    expect(sql).toContain('prev_quarter_auto_count');
  });

  it('2-K: 包含推介率计算列（*_rate）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain('day_rate');
    expect(sql).toContain('month_rate');
    expect(sql).toContain('year_rate');
  });

  it('2-L: 整体行排在结果最前（ORDER BY CASE）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain("WHEN '整体' THEN 1");
    expect(sql).toContain("WHEN '主全' THEN 2");
    expect(sql).toContain("WHEN '单交' THEN 4");
  });

  it('2-M: total_row 仅限主全+交三保单（推介率口径正确）', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain("WHERE coverage_combination IN ('主全', '交三')");
  });

  it('2-N: passenger 类别过滤注入 SQL', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'passenger');
    expect(sql).toContain('非营业个人客车');
  });

  it('2-O: 所有车辆类别均可正常生成 SQL（无抛出）', () => {
    for (const cat of ALL_VEHICLE_CATEGORIES) {
      expect(() => generateCrossSellTimePeriodQuery(BASE_WHERE, cat)).not.toThrow();
    }
  });

  it('2-P: DuckDB FILTER (WHERE ...) 语法存在于聚合列', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain('FILTER (WHERE');
  });

  it('2-Q: 件均保费列使用 driver_policy_count 作为分母', () => {
    const sql = generateCrossSellTimePeriodQuery(BASE_WHERE, 'all');
    expect(sql).toContain('driver_policy_count');
    expect(sql).toContain('avg_premium');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. cross-sell-heatmap.ts — generateCrossSellHeatmapQuery
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateCrossSellHeatmapQuery — 热力图查询', () => {
  it('3-A: 默认参数（day + org_level_3）可生成 SQL', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all');
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(500);
  });

  it('3-B: 输出包含所有必要字段（rate, penetration_rate, avg_premium, achievement_rate）', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all');
    expect(sql).toContain('AS rate');
    expect(sql).toContain('AS penetration_rate');
    expect(sql).toContain('AS avg_premium');
    expect(sql).toContain('AS achievement_rate');
  });

  it('3-C: org_level_3 分组维度使用 CrossSellDailyAgg（不用 PolicyFact）', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'org_level_3');
    expect(sql).toContain('CrossSellDailyAgg');
    expect(sql).not.toContain('FROM PolicyFact');
  });

  it('3-D: team 分组维度切换到 PolicyFact + SalesmanTeamMapping JOIN', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'team');
    expect(sql).toContain('FROM PolicyFact p');
    expect(sql).toContain('LEFT JOIN team_mapping tm'); // 剥列 CTE（2026-07-09 Binder Error 根治）
    expect(sql).toContain('team_mapping AS (SELECT full_name, team_name FROM SalesmanTeamMapping)');
  });

  it('3-E: salesman 分组维度切换到 PolicyFact', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'salesman');
    expect(sql).toContain('PolicyFact');
    expect(sql).toContain('salesman_name');
  });

  it('3-F: week 时间粒度使用 DATE_TRUNC week 截断', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'week');
    expect(sql).toContain("DATE_TRUNC('week'");
    expect(sql).toContain('INTERVAL 1 WEEK');
  });

  it('3-G: month 时间粒度使用 DATE_TRUNC month 截断', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'month');
    expect(sql).toContain("DATE_TRUNC('month'");
    expect(sql).toContain('INTERVAL 1 MONTH');
  });

  it('3-H: quarter 时间粒度使用季度步长（INTERVAL 3 MONTH）', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'quarter');
    expect(sql).toContain("DATE_TRUNC('quarter'");
    expect(sql).toContain('INTERVAL 3 MONTH');
  });

  it('3-I: seatCoverageClause 可选参数注入到 SQL', () => {
    const seatClause = 'seat_count > 5';
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', seatClause);
    expect(sql).toContain(seatClause);
  });

  it('3-J: 无 seatCoverageClause 时不注入多余 AND', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all');
    // 不应包含 "AND undefined"
    expect(sql).not.toContain('AND undefined');
    expect(sql).not.toContain('AND null');
  });

  it('3-K: 计划达成率（achievement_rate）— org_level_3 分组有计算公式，其他维度输出字面 NULL', () => {
    const sqlOrg = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'org_level_3');
    expect(sqlOrg).toContain('KpiPlanConfig');
    expect(sqlOrg).toContain('business_line');
    // org_level_3 分组时 SELECT 中包含 plan_premium_wan 参与计算
    expect(sqlOrg).toContain('dp.plan_premium_wan');

    // 非 org_level_3 时 SELECT 中 achievement_rate 直接是字面 NULL（无 dp. 前缀引用）
    const sqlTeam = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'team');
    expect(sqlTeam).toContain('NULL AS achievement_rate');
    expect(sqlTeam).not.toContain('dp.plan_premium_wan');
  });

  it('3-L: coverage_combination 维度分组使用 NULLIF+TRIM 防空值', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'coverage_combination');
    expect(sql).toContain('NULLIF');
    expect(sql).toContain('TRIM');
  });

  it('3-M: energy_type 维度分组产生新能源/燃油标签', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'energy_type');
    expect(sql).toContain("'新能源'");
    expect(sql).toContain("'燃油'");
  });

  it('3-N: business_nature 维度包含续保/新保/过户转保分支', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'business_nature');
    expect(sql).toContain("'续保'");
    expect(sql).toContain("'新保'");
    expect(sql).toContain("'过户转保'");
  });

  it('3-O: drillFilter org_level_3 步骤注入 WHERE 条件', () => {
    const sql = generateCrossSellHeatmapQuery(
      BASE_WHERE, 'all', undefined, 'day', 'org_level_3',
      [{ dimension: 'org_level_3', value: '成都' }]
    );
    expect(sql).toContain("'成都'");
  });

  it('3-P: drillFilter 含 team 步骤强制切换到 PolicyFact', () => {
    const sql = generateCrossSellHeatmapQuery(
      BASE_WHERE, 'all', undefined, 'day', 'coverage_combination',
      [{ dimension: 'team', value: '天府一队' }]
    );
    expect(sql).toContain('PolicyFact');
  });

  it('3-Q: 空 drillFilter 数组不产生多余 AND 子句', () => {
    const sql = generateCrossSellHeatmapQuery(BASE_WHERE, 'all', undefined, 'day', 'org_level_3', []);
    // 不应有 "AND " 后立即换行 — 确认 drillAnd 为空时无多余 AND
    expect(sql).not.toContain('AND  AND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. cross-sell-trend.ts — generateCrossSellTrendQuery
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateCrossSellTrendQuery — 推介率走势查询', () => {
  const granularities: TrendGranularity[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

  it('4-A: 5 种粒度均可生成非空 SQL', () => {
    for (const g of granularities) {
      const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', g);
      expect(typeof sql).toBe('string');
      expect(sql.length).toBeGreaterThan(200);
    }
  });

  it('4-B: 数据源为 CrossSellDailyAgg', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'monthly');
    expect(sql).toContain('CrossSellDailyAgg');
  });

  it('4-C: daily 粒度使用 STRFTIME 完整日期格式', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'daily');
    expect(sql).toContain("STRFTIME(pd, '%Y-%m-%d')");
  });

  it('4-D: weekly 粒度使用 DATE_TRUNC week', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'weekly');
    expect(sql).toContain("DATE_TRUNC('week'");
  });

  it('4-E: monthly 粒度使用 DATE_TRUNC month，格式 %Y-%m', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'monthly');
    expect(sql).toContain("DATE_TRUNC('month'");
    expect(sql).toContain("'%Y-%m'");
  });

  it('4-F: quarterly 粒度使用 EXTRACT QUARTER 生成 Q 后缀', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'quarterly');
    expect(sql).toContain('EXTRACT(QUARTER FROM pd)');
    expect(sql).toContain("'-Q'");
  });

  it('4-G: yearly 粒度使用 DATE_TRUNC year', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'yearly');
    expect(sql).toContain("DATE_TRUNC('year'");
  });

  it('4-H: total_trend 仅聚合主全+交三（整体口径正确）', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'monthly');
    expect(sql).toContain("WHERE coverage_combination IN ('主全', '交三')");
    expect(sql).toContain("'整体' AS coverage_combination");
  });

  it('4-I: 输出包含 rate/avg_premium/auto_count/time_period 字段', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'monthly');
    expect(sql).toContain('AS rate');
    expect(sql).toContain('AS avg_premium');
    expect(sql).toContain('auto_count');
    expect(sql).toContain('time_period');
  });

  it('4-J: 推介率分母为 auto_count（不为保费）', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'monthly');
    expect(sql).toContain('driver_count * 100.0 / auto_count');
  });

  it('4-K: WHERE time_period IS NOT NULL 过滤空值', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'all', 'daily');
    expect(sql).toContain('WHERE time_period IS NOT NULL');
  });

  it('4-L: passenger 车辆类别注入过滤条件', () => {
    const sql = generateCrossSellTrendQuery(BASE_WHERE, 'passenger', 'monthly');
    expect(sql).toContain('非营业个人客车');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. cross-sell-org-trend.ts — generateCrossSellOrgTrendQuery
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateCrossSellOrgTrendQuery — 机构日走势查询', () => {
  it('5-A: 默认参数可生成 SQL', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all');
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(300);
  });

  it('5-B: 数据源为 PolicyFact（而非 CrossSellDailyAgg）', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('5-C: 整体险种组合过滤主全+交三', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '整体');
    expect(sql).toContain("coverage_combination IN ('主全', '交三')");
  });

  it('5-D: 交三险种组合精确过滤', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '交三');
    expect(sql).toContain("coverage_combination = '交三'");
  });

  it('5-E: 主全险种组合精确过滤', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '主全');
    expect(sql).toContain("coverage_combination = '主全'");
  });

  it('5-F: 单交险种组合精确过滤', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '单交');
    expect(sql).toContain("coverage_combination = '单交'");
  });

  it('5-G: days 参数控制日期序列长度（使用 generate_series）', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '整体', 30);
    expect(sql).toContain('generate_series');
    expect(sql).toContain('29');  // 0 ~ (days-1) = 29
  });

  it('5-H: days 下界截断——days=0 被 clamp 到 1（不崩溃）', () => {
    expect(() => generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '整体', 0)).not.toThrow();
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '整体', 0);
    // safedays = max(1, min(90,0)) = 1
    expect(sql).toContain('generate_series');
  });

  it('5-I: days 上界截断——days=200 被 clamp 到 90', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all', '整体', 200);
    // safedays = max(1, min(90, 200)) = 90
    expect(sql).toContain('89');  // 0 ~ (90-1) = 89
    expect(sql).not.toContain('199');
  });

  it('5-J: 输出按日期连续（date_series LEFT JOIN daily）', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all');
    expect(sql).toContain('date_series ds');
    expect(sql).toContain('LEFT JOIN daily d');
    expect(sql).toContain('ORDER BY ds.date_val');
  });

  it('5-K: 交叉销售判定使用 TRY_CAST + OR 多值兜底', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all');
    expect(sql).toContain('TRY_CAST');
    expect(sql).toContain("'是'");
  });

  it('5-L: 以数据中 MAX 日期为基准（latest_date 来自 MAX 聚合）', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all');
    // latest CTE 以数据实际最新日期为基准
    expect(sql).toContain('MAX(CAST(policy_date AS DATE)) AS latest_date');
    // 真正的日期锚点来自 latest CTE，而非直接用 CURRENT_DATE 作为过滤值
    expect(sql).toContain('SELECT latest_date FROM latest');
  });

  it('5-M: 推介率 rate 字段零分母防护', () => {
    const sql = generateCrossSellOrgTrendQuery(BASE_WHERE, 'all');
    expect(sql).toContain('WHEN COALESCE(d.auto_count, 0) = 0 THEN 0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. cross-sell-top-salesman.ts — generateCrossSellTopSalesmanQuery
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateCrossSellTopSalesmanQuery — TOP20 业务员查询', () => {
  it('6-A: 主全险种可生成 SQL', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(200);
  });

  it('6-B: 交三险种可生成 SQL', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '交三');
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(200);
  });

  it('6-C: 数据源为 CrossSellDailyAgg', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(sql).toContain('CrossSellDailyAgg');
  });

  it('6-D: coverage_combination 过滤注入正确险种', () => {
    const sqlZQ = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(sqlZQ).toContain("coverage_combination = '主全'");

    const sqlJS = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '交三');
    expect(sqlJS).toContain("coverage_combination = '交三'");
  });

  it('6-E: 限制输出 TOP 20', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(sql).toContain('LIMIT 20');
  });

  it('6-F: 按 auto_count DESC 排序（件数优先，推介率次之）', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(sql).toContain('ORDER BY auto_count DESC, rate DESC');
  });

  it('6-G: 推介率分母防零（CASE WHEN auto_count = 0）', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(sql).toContain('CASE WHEN auto_count = 0 THEN 0');
  });

  it('6-H: daily 时段过滤使用 tp_day 作为日期边界', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全', 'daily');
    expect(sql).toContain("'daily'");
    expect(sql).toContain('tp_day');
  });

  it('6-I: monthly 时段使用 tp_month 和 tp_max', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全', 'monthly');
    expect(sql).toContain("'monthly'");
    expect(sql).toContain('tp_month');
    expect(sql).toContain('tp_max');
  });

  it('6-J: yearly 时段使用 tp_year', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全', 'yearly');
    expect(sql).toContain("'yearly'");
    expect(sql).toContain('tp_year');
  });

  it('6-K: 过滤空业务员名（IS NOT NULL + TRIM != 空串）', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全');
    expect(sql).toContain('salesman_name IS NOT NULL');
    expect(sql).toContain("TRIM(salesman_name) != ''");
  });

  it('6-L: passenger 车辆类别注入客车过滤', () => {
    const sql = generateCrossSellTopSalesmanQuery(BASE_WHERE, 'passenger', '主全');
    expect(sql).toContain('非营业个人客车');
  });

  it('6-M: 5 种时段均不抛出异常', () => {
    const timePeriods = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
    for (const tp of timePeriods) {
      expect(() => generateCrossSellTopSalesmanQuery(BASE_WHERE, 'all', '主全', tp)).not.toThrow();
    }
  });
});
