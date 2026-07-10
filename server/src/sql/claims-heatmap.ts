/**
 * 理赔热力图 SQL 生成器（累计发展口径，2026-04-19 重构）
 *
 * 口径演进：
 * - v1: 按 report_time/accident_time 归赔案到期间（与保费分母错配）
 * - v2 (2026-04-19 am): cohort 切片口径，分子分母同按 insurance_start_date 归到起保期间
 * - v3 (2026-04-19 pm, 当前): **累计发展口径** — 用户选定保单年度 Y，
 *   矩阵每列代表一个"累计截止日 cutoff"，每格展示「Y 年起保的保单截至该 cutoff 的累计数据」。
 *
 * - 行口径：dimension（机构/团队/业务员/客户类别/…）
 * - 列口径：policyYear 内的一组累计截止日 (cutoffs)
 *   - 年度早段：逐月末 (1/31、2/28…)，直到 effective_end 前 2 个月
 *   - 近 2 个月：按周六截止（+ effective_end 本身若非周六）
 *   - effective_end = min(Y-12-31, max_date)
 * - 分母：insurance_start_date 年份 = Y 且 ≤ cutoff 的保单，earned_premium/exposure 用 cutoff 结算
 * - 分子：同 cohort 保单产生的赔案，且 claimsDateField ≤ cutoff
 * - YoY：Y-1 年度相同 cohort 在 cutoff - 1 年的累计快照
 *
 * 每一列是"累计"快照（单调递增），相邻列差 = 新增。
 *
 * 端点：/api/query/claims-detail/heatmap
 * 参数：dimension / policyYear / dateField（保留但固定为 insurance_start_date）/ claimsDateField
 */

import { logger } from '../utils/logger.js';
import { escapeSqlValue } from '../utils/security.js';
import { buildTeamMappingCte } from './stripped-dim-cte.js';
import { pushVehicleQuickFilterConditions } from '../utils/filter-params.js';
import {
  truthyExpr,
} from './performance-analysis-shared.js';
import type { HeatmapGroupDimension } from './performance-heatmap.js';

export { type HeatmapGroupDimension } from './performance-heatmap.js';

/** 赔案时间字段：报案时间（默认）或出险时间 */
export type ClaimsDateField = 'report_time' | 'accident_time';

// ============================================================================
// 类型定义
// ============================================================================

export interface ClaimsHeatmapFilters {
  orgName?: string;
  customerCategory?: string;
  isNev?: string;
  coverageCombination?: string;
  isTransfer?: string;
  vehicleQuickFilter?: string;
  businessNature?: string;
  isNewCar?: string;
  isRenewal?: string;
  // Phase 2（BACKLOG d0cd4b）补齐：与 claims-detail.ts 同步，防同文件两处解析漂移
  insuranceType?: string;      // 险类：true=交强险 / false=商业保险
  enterpriseCar?: string;      // 企客（非营业企业客车）：'true'
  fuelCategory?: string;       // 燃料分类：oil / gas / electric
}

// ============================================================================
// 白名单常量
// ============================================================================

const VALID_DATE_FIELDS = new Set(['policy_date', 'insurance_start_date']);
const VALID_CLAIMS_DATE_FIELDS = new Set<ClaimsDateField>(['report_time', 'accident_time']);
const MIN_POLICY_YEAR = 2020;
const MAX_POLICY_YEAR = 2030;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_CUTOFFS = 24;

/** 校验 customCutoffs：保留 ISO 日期、去重、按升序排序、上限 24 个 */
function sanitizeCustomCutoffs(input?: string[]): string[] | null {
  if (!input || input.length === 0) return null;
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!ISO_DATE_RE.test(trimmed)) continue;
    const d = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    // 严格日历校验：JS Date 会把 2026-02-31 归一化为 2026-03-03，
    // 必须回写比对原串，否则 SQL 端 DATE '2026-02-31' 会运行时报错
    if (d.toISOString().slice(0, 10) !== trimmed) continue;
    seen.add(trimmed);
  }
  if (seen.size === 0) return null;
  const sorted = Array.from(seen).sort();
  return sorted.slice(0, MAX_CUSTOM_CUTOFFS);
}

// ============================================================================
// 筛选器构建
// ============================================================================

function buildPolicyWhere(filters: ClaimsHeatmapFilters, prefix = 'p.'): string {
  const conditions: string[] = [];
  if (filters.orgName) conditions.push(`${prefix}org_level_3 = '${escapeSqlValue(filters.orgName)}'`);
  if (filters.customerCategory) conditions.push(`${prefix}customer_category = '${escapeSqlValue(filters.customerCategory)}'`);
  if (filters.isNev === '1' || filters.isNev === 'true') conditions.push(`${prefix}is_nev = true`);
  if (filters.isNev === '0' || filters.isNev === 'false') conditions.push(`${prefix}is_nev = false`);
  if (filters.coverageCombination) conditions.push(`${prefix}coverage_combination = '${escapeSqlValue(filters.coverageCombination)}'`);
  if (filters.isTransfer === 'true') conditions.push(`${prefix}is_transfer = true`);
  if (filters.isTransfer === 'false') conditions.push(`${prefix}is_transfer = false`);
  if (filters.isNewCar === 'true') conditions.push(`${prefix}is_new_car = true`);
  if (filters.isNewCar === 'false') conditions.push(`${prefix}is_new_car = false`);
  if (filters.isRenewal === 'true') conditions.push(`${prefix}is_renewal = true`);
  if (filters.isRenewal === 'false') conditions.push(`${prefix}is_renewal = false`);

  // 险类（交强/商业）— 语义照抄 SSOT filter-params.ts:206-210
  if (filters.insuranceType === 'true') {
    conditions.push(`${prefix}insurance_type = '交强险'`);
  } else if (filters.insuranceType === 'false') {
    conditions.push(`${prefix}insurance_type = '商业保险'`);
  }

  // 燃料分类（油/气/电）— 语义照抄 SSOT filter-params.ts:212-225
  if (filters.fuelCategory === 'electric') {
    conditions.push(`${prefix}is_nev = true`);
  } else if (filters.fuelCategory === 'gas') {
    conditions.push(`${prefix}is_nev = false AND ${prefix}fuel_type LIKE '天然气%'`);
  } else if (filters.fuelCategory === 'oil') {
    conditions.push(`${prefix}is_nev = false AND (${prefix}fuel_type IS NULL OR ${prefix}fuel_type NOT LIKE '天然气%')`);
  }

  // home_car + 企客联动特例与企客单独选中均照抄 SSOT filter-params.ts:227-238
  if (filters.vehicleQuickFilter === 'home_car' && filters.enterpriseCar === 'true') {
    conditions.push(`${prefix}customer_category IN ('非营业个人客车', '非营业企业客车')`);
  } else if (filters.vehicleQuickFilter) {
    pushVehicleQuickFilterConditions(conditions, filters.vehicleQuickFilter, prefix);
  }
  if (filters.enterpriseCar === 'true' && !filters.vehicleQuickFilter) {
    conditions.push(`${prefix}customer_category = '非营业企业客车'`);
  }

  if (filters.businessNature === 'commercial') {
    conditions.push(`${prefix}customer_category LIKE '营业%'`);
  } else if (filters.businessNature === 'non_commercial') {
    conditions.push(`${prefix}customer_category LIKE '非营业%'`);
  }

  return conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
}

// ============================================================================
// 维度表达式
// ============================================================================

function getDimensionExpr(
  dimension: HeatmapGroupDimension,
  prefix = 'p.'
): { selectExpr: string; alias: string } {
  switch (dimension) {
    case 'team':
      return {
        selectExpr: `COALESCE(tm.team_name, '未归属团队')`,
        alias: 'dimension_value',
      };
    case 'salesman':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}salesman_name AS VARCHAR)), ''), '未知业务员')`,
        alias: 'dimension_value',
      };
    case 'customer_category':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}customer_category AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
      };
    case 'coverage_combination':
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}coverage_combination AS VARCHAR)), ''), '未知')`,
        alias: 'dimension_value',
      };
    case 'energy_type':
      return {
        selectExpr: `CASE WHEN ${truthyExpr(`${prefix}is_nev`)} THEN '新能源' ELSE '燃油' END`,
        alias: 'dimension_value',
      };
    case 'business_nature':
      // 优先级：新车 → 过户 → 续保 → 转保（见 project_vehicle_type_classification.md）
      return {
        selectExpr: `CASE
          WHEN ${truthyExpr(`${prefix}is_new_car`)} THEN '新保'
          WHEN ${truthyExpr(`${prefix}is_transfer`)} THEN '过户转保'
          WHEN ${truthyExpr(`${prefix}is_renewal`)} THEN '续保'
          ELSE '转保'
        END`,
        alias: 'dimension_value',
      };
    case 'insurance_grade':
      return {
        selectExpr: `COALESCE(${prefix}insurance_grade, 'X')`,
        alias: 'dimension_value',
      };
    default: // org_level_3
      return {
        selectExpr: `COALESCE(NULLIF(TRIM(CAST(${prefix}org_level_3 AS VARCHAR)), ''), '未知机构')`,
        alias: 'dimension_value',
      };
  }
}

// ============================================================================
// 主查询生成器
// ============================================================================

/**
 * 生成理赔热力图查询（累计发展口径）
 *
 * @param filters 筛选条件
 * @param dimension 行维度
 * @param dateField 保费时间轴字段（保留参数以兼容，实际固定为 insurance_start_date）
 * @param claimsDateField 赔案纳入截止字段（决定"已报案" or "已出险"）
 * @param policyYear 保单年度（insurance_start_date 年份）；undefined 时取 max_date 所在年
 * @param customCutoffs 自定义 cutoff 列表（YYYY-MM-DD）；提供时跳过自动 cutoff 生成（月末+周六）
 *                      用于精确双时点对比、月末同比等诊断场景，最多 24 个
 * @param cutoffBranchCode 分省截止日范围（CHAR(2)，来自路由层 resolveBranchRlsCode）；
 *                         多省时数据截止日按本省 MAX(policy_date) 取值，防止两省数据进度
 *                         不一致时截止日被对方省"带跑"。未传 → SQL 与历史逐字节一致。
 */
export function generateClaimsHeatmapQuery(
  filters: ClaimsHeatmapFilters,
  dimension: HeatmapGroupDimension = 'org_level_3',
  dateField: string = 'insurance_start_date',
  claimsDateField: ClaimsDateField = 'report_time',
  policyYear?: number,
  customCutoffs?: string[],
  whereClause: string = '1=1',
  cutoffBranchCode?: string,
): string {
  // 白名单校验，防止 SQL 注入
  // dateField 参数保留兼容，但累计口径下 cohort 必须锚定 insurance_start_date
  const _safeDateField = VALID_DATE_FIELDS.has(dateField) ? dateField : 'insurance_start_date';
  void _safeDateField; // 仅白名单校验，cohort 锚点恒为 insurance_start_date
  const safeClaimsDateField = VALID_CLAIMS_DATE_FIELDS.has(claimsDateField) ? claimsDateField : 'report_time';

  // policyYear 白名单：整数 2020-2030；非法则用 SQL 端 max_date 所在年兜底
  const safePolicyYear =
    typeof policyYear === 'number' &&
    Number.isInteger(policyYear) &&
    policyYear >= MIN_POLICY_YEAR &&
    policyYear <= MAX_POLICY_YEAR
      ? policyYear
      : null;

  const dimConfig = getDimensionExpr(dimension, 'p.');
  const needsTeamJoin = dimension === 'team';
  const policyWhere = buildPolicyWhere(filters, 'p.');

  // 团队维度走 team_mapping 剥列 CTE（只投影 full_name+team_name，不含 branch_code）——
  // eligible_policies 已消除 branch_code 二义，但对**扇出**不免疫：裸 JOIN SalesmanTeamMapping
  // 时同名业务员跨 SC/SX 各一行 → 单省赔案被两省团队各记一次。剥列 CTE 按 cutoffBranchCode
  // 省过滤根治扇出（实证：rls=SX 团队维度原产出 teamA+teamB 并存）。见 memory
  // rls-branch-code-ambiguous-team-join。
  const teamJoin = needsTeamJoin
    ? `LEFT JOIN team_mapping tm ON TRIM(CAST(p.salesman_name AS VARCHAR)) = TRIM(CAST(tm.full_name AS VARCHAR))`
    : '';
  const teamMappingCte = needsTeamJoin ? `${buildTeamMappingCte(cutoffBranchCode)},\n    ` : '';

  // policyYearExpr：子查询或字面量 — 供 CTE 反复引用
  const policyYearExpr = safePolicyYear !== null
    ? String(safePolicyYear)
    : `(EXTRACT(YEAR FROM (SELECT max_date FROM ref_date))::INT)`;

  // customCutoffs：白名单+去重+排序，提供时整段替换 cutoff 来源 CTE
  const safeCustomCutoffs = sanitizeCustomCutoffs(customCutoffs);
  const cutoffsCte = safeCustomCutoffs
    ? `
    -- 3-5. 自定义 cutoffs（用户精确指定，跳过自动月末+周六生成）
    all_cutoffs AS (
      SELECT
        t.cutoff::DATE AS cutoff,
        'custom' AS cutoff_type,
        ROW_NUMBER() OVER (ORDER BY t.cutoff::DATE) AS cutoff_idx
      FROM (VALUES ${safeCustomCutoffs.map(d => `(DATE '${d}')`).join(', ')}) AS t(cutoff)
    ),`
    : `
    -- 3. 近 2 月的起点（再早折叠为月末）
    weekly_start AS (
      SELECT
        GREATEST(year_start, (effective_end - INTERVAL 2 MONTH + INTERVAL 1 DAY)::DATE) AS wstart,
        effective_end,
        year_start
      FROM year_bounds
    ),

    -- 4a. 月末 cutoffs（年初 → weekly_start 前一天）
    monthly_cutoffs AS (
      SELECT
        (DATE_TRUNC('month', d::DATE) + INTERVAL 1 MONTH - INTERVAL 1 DAY)::DATE AS cutoff,
        'month' AS cutoff_type
      FROM weekly_start w,
      generate_series(
        w.year_start::TIMESTAMP,
        (w.wstart - INTERVAL 1 DAY)::TIMESTAMP,
        INTERVAL 1 MONTH
      ) AS t(d)
      WHERE (DATE_TRUNC('month', d::DATE) + INTERVAL 1 MONTH - INTERVAL 1 DAY)::DATE < w.wstart
    ),

    -- 4b. 近 2 月按周六 + effective_end
    weekly_cutoffs_raw AS (
      SELECT d::DATE AS cutoff
      FROM weekly_start w,
      generate_series(w.wstart::TIMESTAMP, w.effective_end::TIMESTAMP, INTERVAL 1 DAY) AS t(d)
      WHERE EXTRACT(DOW FROM d) = 6 AND d::DATE <= w.effective_end

      UNION

      SELECT w.effective_end
      FROM weekly_start w
      WHERE EXTRACT(DOW FROM w.effective_end) != 6
    ),

    weekly_cutoffs AS (
      SELECT cutoff, 'week' AS cutoff_type
      FROM weekly_cutoffs_raw
    ),

    -- 5. 合并 cutoffs（去重，稳定排序）
    all_cutoffs AS (
      SELECT
        cutoff,
        MIN(cutoff_type) AS cutoff_type, -- 若月末恰为周六，'month' 优先（字母序在前）
        ROW_NUMBER() OVER (ORDER BY cutoff) AS cutoff_idx
      FROM (
        SELECT cutoff, cutoff_type FROM monthly_cutoffs
        UNION ALL
        SELECT cutoff, cutoff_type FROM weekly_cutoffs
      ) combined
      GROUP BY cutoff
    ),`;

  // 多省截止日隔离（2026-07-07）：见 cutoffBranchCode 参数注释
  const cutoffScope = cutoffBranchCode ? ` WHERE branch_code = '${escapeSqlValue(cutoffBranchCode)}'` : '';

  const sql = `
    WITH
    ${teamMappingCte}-- 1. 数据截止日（多省时限定本省范围）
    ref_date AS (
      SELECT MAX(CAST(policy_date AS DATE)) AS max_date FROM PolicyFact${cutoffScope}
    ),

    -- 2. 所选保单年度的累计区间
    year_bounds AS (
      SELECT
        ${policyYearExpr} AS policy_year,
        MAKE_DATE(${policyYearExpr}, 1, 1) AS year_start,
        MAKE_DATE(${policyYearExpr}, 12, 31) AS year_end,
        LEAST(MAKE_DATE(${policyYearExpr}, 12, 31), (SELECT max_date FROM ref_date)) AS effective_end
    ),

    -- 2.5. 净额口径池：按 (policy_no, insurance_start_date) 聚合，
    --      HAVING SUM(premium) > 0 → 排除退保/负向批改净额≤0 的保单
    --      与「赔付率发展」统一口径，2026-04-20 用户决策
    eligible_policies AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS insurance_start_date,
        SUM(premium) AS premium,
        ANY_VALUE(org_level_3) AS org_level_3,
        ANY_VALUE(customer_category) AS customer_category,
        ANY_VALUE(salesman_name) AS salesman_name,
        ANY_VALUE(coverage_combination) AS coverage_combination,
        ANY_VALUE(is_nev) AS is_nev,
        ANY_VALUE(is_transfer) AS is_transfer,
        ANY_VALUE(is_new_car) AS is_new_car,
        ANY_VALUE(is_renewal) AS is_renewal,
        ANY_VALUE(insurance_grade) AS insurance_grade,
        ANY_VALUE(tonnage_segment) AS tonnage_segment,
        ANY_VALUE(vehicle_model) AS vehicle_model,
        ANY_VALUE(insurance_type) AS insurance_type,
        ANY_VALUE(fuel_type) AS fuel_type
      FROM PolicyFact
      WHERE (${whereClause})
        AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) >= (SELECT policy_year FROM year_bounds) - 1
        AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) <= (SELECT policy_year FROM year_bounds)
      GROUP BY policy_no, CAST(insurance_start_date AS DATE)
      HAVING SUM(premium) > 0
    ),

    ${cutoffsCte}

    -- ═══════════════════════════════════════════════════════════
    -- 保费侧：所选年度起保保单 × 累计 cutoff
    -- 每 (dim, cutoff) 的 earned 用该 cutoff 作为结算点
    -- ═══════════════════════════════════════════════════════════

    cur_premium_cumulative AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ac.cutoff_idx,
        COUNT(DISTINCT p.policy_no) AS policy_count,
        ROUND(SUM(p.premium) / 1e4, 4) AS premium_wan,
        ROUND(SUM(p.premium * LEAST(
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), ac.cutoff + INTERVAL 1 DAY), 0),
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)
        )::DOUBLE / GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)) / 1e4, 4) AS earned_premium_wan,
        ROUND(SUM(LEAST(
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), ac.cutoff + INTERVAL 1 DAY), 0),
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)
        )::DOUBLE / GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)), 6) AS earned_exposure
      FROM eligible_policies p
      ${teamJoin}
      CROSS JOIN all_cutoffs ac
      WHERE EXTRACT(YEAR FROM CAST(p.insurance_start_date AS DATE)) = (SELECT policy_year FROM year_bounds)
        AND CAST(p.insurance_start_date AS DATE) <= ac.cutoff
        ${policyWhere}
      GROUP BY ${dimConfig.selectExpr}, ac.cutoff_idx
    ),

    -- ═══════════════════════════════════════════════════════════
    -- 赔案侧：同 cohort × 赔案 claimsDateField ≤ cutoff 的累计
    -- ═══════════════════════════════════════════════════════════

    cur_claims_cumulative AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ac.cutoff_idx,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        ROUND(SUM(CASE
          -- B302: 与 ClaimsAgg.reported_claims 同口径，排除无责(liability_ratio=0)与无效案件(零结/注销/拒赔)
          WHEN COALESCE(c.liability_ratio, 100) > 0
           AND (c.case_type IS NULL OR c.case_type NOT IN ('零结','注销','拒赔'))
          THEN CASE
            WHEN c.settlement_time IS NOT NULL
             AND CAST(c.settlement_time AS DATE) <= ac.cutoff
            THEN COALESCE(c.settled_amount, 0)
            ELSE COALESCE(c.reserve_amount, 0)
          END
          ELSE 0
        END) / 1e4, 4) AS total_claims_wan
      FROM ClaimsDetail c
      JOIN eligible_policies p ON c.policy_no = p.policy_no
      ${teamJoin}
      CROSS JOIN all_cutoffs ac
      WHERE EXTRACT(YEAR FROM CAST(p.insurance_start_date AS DATE)) = (SELECT policy_year FROM year_bounds)
        AND CAST(p.insurance_start_date AS DATE) <= ac.cutoff
        AND CAST(c.${safeClaimsDateField} AS DATE) <= ac.cutoff
        ${policyWhere}
      GROUP BY ${dimConfig.selectExpr}, ac.cutoff_idx
    ),

    -- ═══════════════════════════════════════════════════════════
    -- YoY：policy_year - 1 年度 cohort；cutoff 偏移 -1 年
    -- ═══════════════════════════════════════════════════════════

    prev_premium_cumulative AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ac.cutoff_idx,
        COUNT(DISTINCT p.policy_no) AS policy_count,
        ROUND(SUM(p.premium) / 1e4, 4) AS premium_wan,
        ROUND(SUM(p.premium * LEAST(
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), (ac.cutoff - INTERVAL 1 YEAR)::DATE + INTERVAL 1 DAY), 0),
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)
        )::DOUBLE / GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)) / 1e4, 4) AS earned_premium_wan,
        ROUND(SUM(LEAST(
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), (ac.cutoff - INTERVAL 1 YEAR)::DATE + INTERVAL 1 DAY), 0),
          GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)
        )::DOUBLE / GREATEST(DATE_DIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)), 6) AS earned_exposure
      FROM eligible_policies p
      ${teamJoin}
      CROSS JOIN all_cutoffs ac
      WHERE EXTRACT(YEAR FROM CAST(p.insurance_start_date AS DATE)) = (SELECT policy_year FROM year_bounds) - 1
        AND CAST(p.insurance_start_date AS DATE) <= (ac.cutoff - INTERVAL 1 YEAR)::DATE
        ${policyWhere}
      GROUP BY ${dimConfig.selectExpr}, ac.cutoff_idx
    ),

    prev_claims_cumulative AS (
      SELECT
        ${dimConfig.selectExpr} AS ${dimConfig.alias},
        ac.cutoff_idx,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        ROUND(SUM(CASE
          -- B302: 与 ClaimsAgg.reported_claims 同口径，排除无责(liability_ratio=0)与无效案件(零结/注销/拒赔)
          WHEN COALESCE(c.liability_ratio, 100) > 0
           AND (c.case_type IS NULL OR c.case_type NOT IN ('零结','注销','拒赔'))
          THEN CASE
            WHEN c.settlement_time IS NOT NULL
             AND CAST(c.settlement_time AS DATE) <= (ac.cutoff - INTERVAL 1 YEAR)::DATE
            THEN COALESCE(c.settled_amount, 0)
            ELSE COALESCE(c.reserve_amount, 0)
          END
          ELSE 0
        END) / 1e4, 4) AS total_claims_wan
      FROM ClaimsDetail c
      JOIN eligible_policies p ON c.policy_no = p.policy_no
      ${teamJoin}
      CROSS JOIN all_cutoffs ac
      WHERE EXTRACT(YEAR FROM CAST(p.insurance_start_date AS DATE)) = (SELECT policy_year FROM year_bounds) - 1
        AND CAST(p.insurance_start_date AS DATE) <= (ac.cutoff - INTERVAL 1 YEAR)::DATE
        AND CAST(c.${safeClaimsDateField} AS DATE) <= (ac.cutoff - INTERVAL 1 YEAR)::DATE
        ${policyWhere}
      GROUP BY ${dimConfig.selectExpr}, ac.cutoff_idx
    ),

    -- 6. 维度池：保费与赔案的并集
    dim_pool AS (
      SELECT DISTINCT dimension_value FROM cur_premium_cumulative
      UNION
      SELECT DISTINCT dimension_value FROM cur_claims_cumulative
    ),

    base_grid AS (
      SELECT dp.dimension_value, ac.cutoff_idx
      FROM dim_pool dp CROSS JOIN all_cutoffs ac
    )

    -- 7. 最终输出：累计快照（列命名保持与 cohort 版兼容）
    SELECT
      bg.dimension_value,
      ac.cutoff_idx AS period_idx,
      CASE
        WHEN ac.cutoff_type = 'month'
          THEN CAST(EXTRACT(MONTH FROM ac.cutoff) AS INT) || '月末'
        WHEN ac.cutoff_type = 'custom'
          THEN CAST(ac.cutoff AS VARCHAR)
        ELSE CAST(EXTRACT(MONTH FROM ac.cutoff) AS INT)
             || '.' || CAST(EXTRACT(DAY FROM ac.cutoff) AS INT)
      END AS period_label,
      ac.cutoff_type AS period_type,
      CAST((SELECT year_start FROM year_bounds) AS VARCHAR) AS period_start,
      CAST(ac.cutoff AS VARCHAR) AS period_end,

      -- 当年保费侧（累计）
      COALESCE(cp.policy_count, 0) AS policy_count,
      COALESCE(cp.premium_wan, 0) AS premium_wan,
      COALESCE(cp.earned_premium_wan, 0) AS earned_premium_wan,
      COALESCE(cp.earned_exposure, 0) AS earned_exposure,

      -- 当年赔案侧（累计，按 ${safeClaimsDateField} 截止）
      COALESCE(cc.claim_count, 0) AS claim_count,
      COALESCE(cc.total_claims_wan, 0) AS total_claims_wan,

      -- 计算指标（累计口径）
      CASE WHEN COALESCE(cp.earned_premium_wan, 0) > 0
        THEN ROUND(COALESCE(cc.total_claims_wan, 0) * 100.0 / cp.earned_premium_wan, 2)
        ELSE NULL END AS loss_ratio_pct,
      CASE WHEN COALESCE(cc.claim_count, 0) > 0
        THEN ROUND(COALESCE(cc.total_claims_wan, 0) * 10000.0 / cc.claim_count, 0)
        ELSE NULL END AS avg_claim,
      CASE WHEN COALESCE(cp.earned_exposure, 0) > 0
        THEN ROUND(COALESCE(cc.claim_count, 0) * 100.0 / cp.earned_exposure, 4)
        ELSE NULL END AS incident_rate_pct,

      -- YoY 保费侧
      COALESCE(pp.policy_count, 0) AS yoy_policy_count,
      COALESCE(pp.earned_premium_wan, 0) AS yoy_earned_premium_wan,
      COALESCE(pp.earned_exposure, 0) AS yoy_earned_exposure,

      -- YoY 赔案侧
      COALESCE(pc.claim_count, 0) AS yoy_claim_count,
      COALESCE(pc.total_claims_wan, 0) AS yoy_total_claims_wan,

      -- YoY 计算指标
      CASE WHEN COALESCE(pp.earned_premium_wan, 0) > 0
        THEN ROUND(COALESCE(pc.total_claims_wan, 0) * 100.0 / pp.earned_premium_wan, 2)
        ELSE NULL END AS yoy_loss_ratio_pct,
      CASE WHEN COALESCE(pc.claim_count, 0) > 0
        THEN ROUND(COALESCE(pc.total_claims_wan, 0) * 10000.0 / pc.claim_count, 0)
        ELSE NULL END AS yoy_avg_claim,
      CASE WHEN COALESCE(pp.earned_exposure, 0) > 0
        THEN ROUND(COALESCE(pc.claim_count, 0) * 100.0 / pp.earned_exposure, 4)
        ELSE NULL END AS yoy_incident_rate_pct,

      (SELECT policy_year FROM year_bounds) AS policy_year,
      (SELECT CAST(max_date AS VARCHAR) FROM ref_date) AS ref_max_date

    FROM base_grid bg
    JOIN all_cutoffs ac ON ac.cutoff_idx = bg.cutoff_idx
    LEFT JOIN cur_premium_cumulative cp ON cp.dimension_value = bg.dimension_value AND cp.cutoff_idx = bg.cutoff_idx
    LEFT JOIN cur_claims_cumulative cc ON cc.dimension_value = bg.dimension_value AND cc.cutoff_idx = bg.cutoff_idx
    LEFT JOIN prev_premium_cumulative pp ON pp.dimension_value = bg.dimension_value AND pp.cutoff_idx = bg.cutoff_idx
    LEFT JOIN prev_claims_cumulative pc ON pc.dimension_value = bg.dimension_value AND pc.cutoff_idx = bg.cutoff_idx
    ORDER BY bg.dimension_value, ac.cutoff_idx
  `;

  logger.debug('Generated claims heatmap SQL (cumulative)', {
    dimension,
    policyYear: safePolicyYear ?? 'auto(max_date.year)',
    claimsInclusion: safeClaimsDateField,
    customCutoffs: safeCustomCutoffs ? safeCustomCutoffs.join(',') : 'auto',
    sqlLength: sql.length,
  });

  return sql;
}
