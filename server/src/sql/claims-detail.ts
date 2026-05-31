/**
 * 赔案明细 SQL 生成器
 *
 * 数据源：ClaimsDetail VIEW（赔案级明细）+ PolicyFact（保单维度 JOIN）
 * 端点：/api/query/claims-detail/*
 */

import { escapeSqlValue } from '../utils/security.js';
import { pushVehicleQuickFilterConditions } from '../utils/filter-params.js';

/**
 * B252 反向 JOIN 去重模板
 *
 * 背景：`FROM ClaimsDetail c JOIN PolicyFact p` 模式会因 PolicyFact 同 policy_no
 * 存在原单+批改多行，使 `COUNT(*)` / `SUM(c.reserve_amount)` 被乘倍（全库虚增 4-5%）。
 *
 * 修复：替换为按 policy_no 去重后的子查询。外层 WHERE 继续用 `p.org_level_3 = ...`
 * 等字段，子查询带出 `buildPolicyWhere` 引用的所有结构字段 + 展示字段。
 *
 * 口径：`GROUP BY policy_no HAVING SUM(premium) > 0`——与 claims-heatmap / Phase 1
 * 统一（排除全退保 / 负向批改净额≤0）。此处仅按 policy_no 聚合（保单号年度唯一），
 * 不引入 insurance_start_date 分组，避免同一保单跨年批改被拆。
 *
 * `insurance_grade` / `commercial_pricing_factor` 批改可能变值，优先取原单值（决策 3）。
 */
const DEDUPED_POLICY_SUBQUERY = `(
  SELECT
    policy_no,
    SUM(premium) AS premium,
    SUM(COALESCE(fee_amount, 0)) AS fee_amount,
    ANY_VALUE(org_level_3) AS org_level_3,
    ANY_VALUE(customer_category) AS customer_category,
    ANY_VALUE(coverage_combination) AS coverage_combination,
    ANY_VALUE(is_nev) AS is_nev,
    ANY_VALUE(is_transfer) AS is_transfer,
    ANY_VALUE(is_new_car) AS is_new_car,
    ANY_VALUE(is_renewal) AS is_renewal,
    ANY_VALUE(tonnage_segment) AS tonnage_segment,
    ANY_VALUE(vehicle_model) AS vehicle_model,
    ANY_VALUE(plate_no) AS plate_no,
    ANY_VALUE(salesman_name) AS salesman_name,
    ANY_VALUE(insurance_start_date) AS insurance_start_date,
    COALESCE(
      ANY_VALUE(CASE WHEN premium > 0 THEN insurance_grade END),
      ANY_VALUE(insurance_grade)
    ) AS insurance_grade
  FROM PolicyFact
  GROUP BY policy_no
  HAVING SUM(premium) > 0
)`;

// ── 类型 ──

export interface ClaimsDetailFilters {
  dateStart?: string;    // 出险时间开始
  dateEnd?: string;      // 出险时间结束
  orgName?: string;      // 三级机构
  claimStatus?: string;  // 赔案类型：已业务结案/未业务结案
  isBodilyInjury?: string; // 是否人伤：true/false
  accidentCause?: string;  // 出险原因
  accidentCity?: string;   // 出险城市
  customerCategory?: string; // 客户类别
  isNev?: string;              // 新能源标识：1=新能源, 0=传统燃油
  coverageCombination?: string; // 险别组合：主全/交三/单交
  isTransfer?: string;         // 是否过户车：true/false
  vehicleQuickFilter?: string; // 车型快捷筛选
  businessNature?: string;     // 营业/非营业性质
  isNewCar?: string;           // 是否新车：true/false
  isRenewal?: string;          // 是否续保：true/false
  // B303: 满期截止日（用于 earned_days 计算），缺省 '9999-12-31' 视为全部到期
  cutoffDate?: string;
}

function buildWhere(filters: ClaimsDetailFilters, tableAlias = 'c'): string {
  const conditions: string[] = [];
  if (filters.dateStart) conditions.push(`${tableAlias}.accident_time >= '${escapeSqlValue(filters.dateStart)}'`);
  if (filters.dateEnd) conditions.push(`${tableAlias}.accident_time <= '${escapeSqlValue(filters.dateEnd)} 23:59:59'`);
  if (filters.claimStatus) conditions.push(`${tableAlias}.claim_status = '${escapeSqlValue(filters.claimStatus)}'`);
  if (filters.isBodilyInjury !== undefined) {
    conditions.push(`${tableAlias}.is_bodily_injury = ${filters.isBodilyInjury === 'true'}`);
  }
  if (filters.accidentCause) conditions.push(`${tableAlias}.accident_cause = '${escapeSqlValue(filters.accidentCause)}'`);
  if (filters.accidentCity) conditions.push(`${tableAlias}.accident_city = '${escapeSqlValue(filters.accidentCity)}'`);
  return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
}

function buildPolicyWhere(filters: ClaimsDetailFilters): string {
  const conditions: string[] = [];
  if (filters.orgName) conditions.push(`p.org_level_3 = '${escapeSqlValue(filters.orgName)}'`);
  if (filters.customerCategory) conditions.push(`p.customer_category = '${escapeSqlValue(filters.customerCategory)}'`);
  if (filters.isNev === '1' || filters.isNev === 'true') conditions.push(`p.is_nev = true`);
  if (filters.isNev === '0' || filters.isNev === 'false') conditions.push(`p.is_nev = false`);
  if (filters.coverageCombination) conditions.push(`p.coverage_combination = '${escapeSqlValue(filters.coverageCombination)}'`);
  if (filters.isTransfer === 'true') conditions.push(`p.is_transfer = true`);
  if (filters.isTransfer === 'false') conditions.push(`p.is_transfer = false`);

  // 车型快捷筛选（共享 helper，9 case 单一来源）
  if (filters.vehicleQuickFilter) {
    pushVehicleQuickFilterConditions(conditions, filters.vehicleQuickFilter, 'p.');
  }

  // 营业/非营业性质
  if (filters.businessNature === 'commercial') {
    conditions.push("p.customer_category LIKE '营业%'");
  } else if (filters.businessNature === 'non_commercial') {
    conditions.push("p.customer_category LIKE '非营业%'");
  }

  // 新车/旧车
  if (filters.isNewCar === 'true') conditions.push(`p.is_new_car = true`);
  if (filters.isNewCar === 'false') conditions.push(`p.is_new_car = false`);

  // 续保/非续保
  if (filters.isRenewal === 'true') conditions.push(`p.is_renewal = true`);
  if (filters.isRenewal === 'false') conditions.push(`p.is_renewal = false`);

  return conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
}

// ── 1. 未决赔案概览 ──

export function generatePendingOverviewQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      c.claim_status,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN c.is_bodily_injury THEN c.reserve_amount ELSE 0 END) / 1e4, 0) AS injury_reserve_wan,
      ROUND(SUM(c.reserve_bodily_amount) / 1e4, 0) AS bodily_wan,
      ROUND(SUM(c.reserve_vehicle_amount) / 1e4, 0) AS vehicle_wan,
      ROUND(SUM(c.reserve_property_amount) / 1e4, 0) AS property_wan
    FROM ClaimsDetail c
    JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY c.claim_status
  `;
}

// ── 2. 未决赔案机构分布 ──

export function generatePendingByOrgQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere({ ...filters, claimStatus: '未业务结案' });
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      p.org_level_3 AS org,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(AVG(DATEDIFF('day', c.accident_time, CURRENT_DATE)), 0) AS avg_pending_days,
      MAX(DATEDIFF('day', c.accident_time, CURRENT_DATE)) AS max_pending_days
    FROM ClaimsDetail c
    JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY p.org_level_3
    ORDER BY reserve_wan DESC
  `;
}

// ── 3. 未决赔案账龄分布 ──

export function generatePendingAgingQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere({ ...filters, claimStatus: '未业务结案' });
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      CASE
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 30 THEN '0-30天'
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 90 THEN '31-90天'
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 180 THEN '91-180天'
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 365 THEN '181-365天'
        ELSE '365天+'
      END AS aging_bucket,
      CASE
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 30 THEN 1
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 90 THEN 2
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 180 THEN 3
        WHEN DATEDIFF('day', c.accident_time, CURRENT_DATE) <= 365 THEN 4
        ELSE 5
      END AS sort_order,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases
    FROM ClaimsDetail c
    JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY aging_bucket, sort_order
    ORDER BY sort_order
  `;
}

// ── 4. 出险原因 + 人伤分析 ──

export function generateCauseAnalysisQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      c.accident_cause,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS injury_pct
    FROM ClaimsDetail c
    JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
    GROUP BY c.accident_cause
    ORDER BY cases DESC
  `;
}

// ── 5. 地理风险分析（出险地点）──

export function generateGeoRiskByAccidentQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      c.accident_province AS province,
      c.accident_city AS city,
      COUNT(*) AS cases,
      ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS injury_pct,
      ROUND(AVG(DATEDIFF('day', c.accident_time, c.payment_time))
        FILTER (WHERE c.payment_time IS NOT NULL), 0) AS avg_cycle_days
    FROM ClaimsDetail c
    JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
      AND c.accident_city IS NOT NULL
      AND p.plate_no IS NOT NULL  -- 与 generateGeoComparisonQuery 共享 cohort，避免案均最高省份卡片 ratio 失真（codex review PR #411 第三轮 P1）
    GROUP BY c.accident_province, c.accident_city
    ORDER BY cases DESC
    LIMIT 100
  `;
}

// ── 6. 地理风险分析（车牌归属地）──

export function generateGeoRiskByPlateQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    WITH claim_with_plate AS (
      SELECT
        c.*,
        p.plate_no,
        p.org_level_3,
        p.customer_category,
        CASE
          WHEN p.plate_no LIKE '川A%' THEN '成都'
          WHEN p.plate_no LIKE '川B%' THEN '绵阳'
          WHEN p.plate_no LIKE '川C%' THEN '自贡'
          WHEN p.plate_no LIKE '川D%' THEN '攀枝花'
          WHEN p.plate_no LIKE '川E%' THEN '泸州'
          WHEN p.plate_no LIKE '川F%' THEN '德阳'
          WHEN p.plate_no LIKE '川H%' THEN '遂宁'
          WHEN p.plate_no LIKE '川J%' THEN '内江'
          WHEN p.plate_no LIKE '川K%' THEN '乐山'
          WHEN p.plate_no LIKE '川L%' THEN '南充'
          WHEN p.plate_no LIKE '川M%' THEN '眉山'
          WHEN p.plate_no LIKE '川Q%' THEN '宜宾'
          WHEN p.plate_no LIKE '川R%' THEN '达州'
          WHEN p.plate_no LIKE '川S%' THEN '雅安'
          WHEN p.plate_no LIKE '川T%' THEN '资阳'
          WHEN p.plate_no LIKE '川U%' THEN '阿坝'
          WHEN p.plate_no LIKE '川V%' THEN '甘孜'
          WHEN p.plate_no LIKE '川W%' THEN '凉山'
          WHEN p.plate_no LIKE '川X%' THEN '广安'
          WHEN p.plate_no LIKE '川Y%' THEN '巴中'
          WHEN p.plate_no LIKE '川Z%' THEN '广元'
          WHEN p.plate_no LIKE '渝%' THEN '重庆'
          ELSE '其他'
        END AS plate_city
      FROM ClaimsDetail c
      JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
      WHERE ${where}${policyWhere}
    )
    SELECT
      plate_city,
      COUNT(*) AS cases,
      ROUND(SUM(reserve_amount) / 1e4, 0) AS reserve_wan,
      ROUND(AVG(reserve_amount), 0) AS avg_reserve,
      SUM(CASE WHEN is_bodily_injury THEN 1 ELSE 0 END) AS injury_cases,
      ROUND(SUM(CASE WHEN is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS injury_pct
    FROM claim_with_plate
    WHERE plate_city != '其他'
    GROUP BY plate_city
    ORDER BY cases DESC
  `;
}

// ── 7. 地理风险对比（出险地 vs 车牌归属地）──

export function generateGeoComparisonQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  return `
    WITH base AS (
      SELECT
        c.accident_city,
        CASE
          WHEN p.plate_no LIKE '川A%' THEN '成都'
          WHEN p.plate_no LIKE '川B%' THEN '绵阳'
          WHEN p.plate_no LIKE '川C%' THEN '自贡'
          WHEN p.plate_no LIKE '川D%' THEN '攀枝花'
          WHEN p.plate_no LIKE '川E%' THEN '泸州'
          WHEN p.plate_no LIKE '川F%' THEN '德阳'
          WHEN p.plate_no LIKE '川H%' THEN '遂宁'
          WHEN p.plate_no LIKE '川J%' THEN '内江'
          WHEN p.plate_no LIKE '川K%' THEN '乐山'
          WHEN p.plate_no LIKE '川L%' THEN '南充'
          WHEN p.plate_no LIKE '川M%' THEN '眉山'
          WHEN p.plate_no LIKE '川Q%' THEN '宜宾'
          WHEN p.plate_no LIKE '川R%' THEN '达州'
          WHEN p.plate_no LIKE '川S%' THEN '雅安'
          WHEN p.plate_no LIKE '川T%' THEN '资阳'
          WHEN p.plate_no LIKE '川X%' THEN '广安'
          WHEN p.plate_no LIKE '川Y%' THEN '巴中'
          WHEN p.plate_no LIKE '川Z%' THEN '广元'
          WHEN p.plate_no LIKE '渝%' THEN '重庆'
          ELSE '其他'
        END AS plate_city,
        c.reserve_amount,
        c.is_bodily_injury,
        CASE WHEN c.accident_city != (
          CASE
            WHEN p.plate_no LIKE '川A%' THEN '510100成都市'
            WHEN p.plate_no LIKE '川B%' THEN '510700绵阳市'
            WHEN p.plate_no LIKE '川C%' THEN '510300自贡市'
            WHEN p.plate_no LIKE '川E%' THEN '510500泸州市'
            WHEN p.plate_no LIKE '川F%' THEN '510600德阳市'
            WHEN p.plate_no LIKE '川Q%' THEN '511500宜宾市'
            ELSE 'MATCH'
          END
        ) THEN TRUE ELSE FALSE END AS is_cross_region
      FROM ClaimsDetail c
      JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
      WHERE ${where}${policyWhere}
        AND p.plate_no IS NOT NULL
        AND c.accident_city IS NOT NULL  -- 与 generateGeoRiskByAccidentQuery 共享 cohort（codex review PR #411 第三轮 P1）
    )
    SELECT
      COUNT(*) AS total_cases,
      SUM(CASE WHEN is_cross_region THEN 1 ELSE 0 END) AS cross_region_cases,
      ROUND(SUM(CASE WHEN is_cross_region THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS cross_region_pct,
      ROUND(AVG(CASE WHEN is_cross_region THEN reserve_amount END), 0) AS cross_region_avg_reserve,
      ROUND(AVG(CASE WHEN NOT is_cross_region THEN reserve_amount END), 0) AS local_avg_reserve
    FROM base
  `;
}

// ── 8. 理赔时效分析 ──

export function generateClaimCycleQuery(filters: ClaimsDetailFilters): string {
  const where = buildWhere({ ...filters, claimStatus: '已业务结案' });
  const policyWhere = buildPolicyWhere(filters);
  return `
    SELECT
      CASE WHEN c.is_bodily_injury THEN '人伤' ELSE '非人伤' END AS type,
      COUNT(*) AS cases,
      ROUND(AVG(DATEDIFF('day', c.accident_time, c.report_time)), 1) AS avg_report_days,
      ROUND(AVG(DATEDIFF('day', c.report_time, c.case_open_time)), 1) AS avg_open_days,
      ROUND(AVG(DATEDIFF('day', c.case_open_time, c.settlement_time)), 1) AS avg_settle_days,
      ROUND(AVG(DATEDIFF('day', c.settlement_time, c.payment_time)), 1) AS avg_pay_days,
      ROUND(AVG(DATEDIFF('day', c.accident_time, c.payment_time)), 1) AS avg_total_days,
      ROUND(MEDIAN(DATEDIFF('day', c.accident_time, c.payment_time)), 1) AS median_total_days
    FROM ClaimsDetail c
    JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
    WHERE ${where}${policyWhere}
      AND c.payment_time IS NOT NULL
    GROUP BY c.is_bodily_injury
  `;
}

// ── 9. 出险频度同比 ──

// ── 10. 赔付率发展三角形（日历发展口径：M_N=[年初, 年初+N月-1日] 闭区间）──
//
// 本质：M_N 列展示「该 cohort 年起保的保单，截至 effective_cutoff 的累计快照」。
// effective_cutoff = LEAST(年初+N月-1日, max_policy_date)
//   - 当 N 月窗口已完全过去（如往年 M12）→ effective_cutoff = 该月末
//   - 当 N 月窗口未到（cutoff 落在窗口内，如 2026 M5 而 cutoff=4-20）→ effective_cutoff = max_policy_date
// 与「理赔热力图」对账锚点：本年 M_(currentMonth) ≡ 热力图 max_policy_date 列
//
// 截止日定义：max(policy_date) FROM PolicyFact（与理赔热力图统一）
// 边界规则：保单/赔案 <= effective_cutoff（闭区间）
// 赔案时间字段：report_time（与理赔热力图默认一致）

export function generateLossRatioDevelopmentQuery(
  filters: ClaimsDetailFilters,
  cohortYears: number[] = [2023, 2024, 2025, 2026],
  maxDevMonth: number = 24
): string {
  const policyWhere = buildPolicyWhere(filters);
  const yearsIn = cohortYears.join(',');

  return `
    WITH claims_cutoff_cte AS (
      -- 与理赔热力图统一：以保单录入截止日为全局 cutoff
      SELECT COALESCE(MAX(CAST(policy_date AS DATE)), CURRENT_DATE) AS claims_cutoff FROM PolicyFact
    ),
    raw_policies AS (
      SELECT
        YEAR(p.insurance_start_date) AS cohort_year,
        p.policy_no, p.insurance_start_date, p.premium,
        DATE_DIFF('day', p.insurance_start_date,
                  p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term_days
      FROM PolicyFact p
      WHERE YEAR(p.insurance_start_date) IN (${yearsIn})
        ${policyWhere}
    ),
    policies AS (
      SELECT cohort_year, policy_no, insurance_start_date,
             SUM(premium) AS premium,
             MAX(policy_term_days) AS policy_term_days
      FROM raw_policies
      GROUP BY cohort_year, policy_no, insurance_start_date
      HAVING SUM(premium) > 0
    ),
    policy_totals AS (
      SELECT cohort_year,
        COUNT(DISTINCT policy_no) AS total_policies,
        ROUND(SUM(premium) / 1e4, 1) AS total_premium_wan
      FROM policies GROUP BY cohort_year
    ),
    dev_months AS (SELECT UNNEST(RANGE(1, ${maxDevMonth + 1})) AS dev_month),
    calendar_window AS (
      SELECT
        pt.cohort_year,
        m.dev_month,
        MAKE_DATE(pt.cohort_year, 1, 1) AS year_start,
        -- effective_cutoff = LEAST(年初+N月-1日, max_policy_date)
        -- 闭区间端点；当本年窗口未完全过去时被 cutoff 截断，与理赔热力图对齐
        LEAST(
          (MAKE_DATE(pt.cohort_year, 1, 1) + to_months(m.dev_month) - INTERVAL 1 DAY)::DATE,
          (SELECT claims_cutoff FROM claims_cutoff_cte)
        ) AS effective_cutoff
      FROM policy_totals pt
      CROSS JOIN dev_months m
      WHERE MAKE_DATE(pt.cohort_year, 1, 1) + to_months(m.dev_month - 1)
            <= (SELECT claims_cutoff FROM claims_cutoff_cte)
    ),
    earned AS (
      SELECT
        cw.cohort_year, cw.dev_month,
        COUNT(DISTINCT p.policy_no) AS dev_policies,
        SUM(p.premium
            * LEAST(
                DATE_DIFF('day', p.insurance_start_date, cw.effective_cutoff + INTERVAL 1 DAY),
                p.policy_term_days
              )::DOUBLE
            / p.policy_term_days
        ) AS earned_premium,
        SUM(
            LEAST(
                DATE_DIFF('day', p.insurance_start_date, cw.effective_cutoff + INTERVAL 1 DAY),
                p.policy_term_days
            )::DOUBLE
            / p.policy_term_days
        ) AS earned_exposure
      FROM calendar_window cw
      JOIN policies p
        ON p.cohort_year = cw.cohort_year
       AND p.insurance_start_date >= cw.year_start
       AND p.insurance_start_date <= cw.effective_cutoff
      GROUP BY cw.cohort_year, cw.dev_month
    ),
    claimed AS (
      SELECT
        cw.cohort_year, cw.dev_month,
        -- 件数不过滤（与 SSOT 件数口径一致：ClaimsAgg.claim_cases COUNT 不加条件）
        COUNT(DISTINCT c.claim_no) AS claim_count,
        -- B302: 与 duckdb-domain-loaders.ts:395-403 ClaimsAgg.reported_claims 同口径过滤
        -- 外层 CASE 排除无责(liability_ratio=0)及无效案件(零结/注销/拒赔)
        -- 内层 CASE 保留发展三角特有时间约束(settlement_time <= effective_cutoff)
        SUM(
          CASE
            WHEN COALESCE(c.liability_ratio, 100) > 0
             AND (c.case_type IS NULL OR c.case_type NOT IN ('零结','注销','拒赔'))
            THEN
              CASE
                WHEN c.settlement_time IS NOT NULL
                 AND CAST(c.settlement_time AS DATE) <= cw.effective_cutoff
                THEN COALESCE(c.settled_amount, 0)
                ELSE COALESCE(c.reserve_amount, 0)
              END
            ELSE 0
          END
        ) AS total_reserve
      FROM calendar_window cw
      JOIN policies p
        ON p.cohort_year = cw.cohort_year
       AND p.insurance_start_date >= cw.year_start
       AND p.insurance_start_date <= cw.effective_cutoff
      LEFT JOIN ClaimsDetail c
        ON c.policy_no = p.policy_no
       AND CAST(c.report_time AS DATE) <= cw.effective_cutoff
      GROUP BY cw.cohort_year, cw.dev_month
    )
    SELECT
      e.cohort_year,
      e.dev_month,
      pt.total_policies,
      pt.total_premium_wan,
      e.dev_policies,
      ROUND(e.earned_premium, 2) AS earned_premium,
      cl.claim_count,
      ROUND(cl.total_reserve, 2) AS total_reserve,
      ROUND(cl.total_reserve / NULLIF(e.earned_premium, 0) * 100, 2) AS loss_ratio_pct,
      ROUND(cl.claim_count * 100.0 / NULLIF(e.earned_exposure, 0), 4) AS incident_rate_pct,
      CASE WHEN cl.claim_count > 0
           THEN ROUND(cl.total_reserve / cl.claim_count, 0)
           ELSE NULL END AS avg_claim,
      ROUND(e.dev_policies * 100.0 / pt.total_policies, 1) AS coverage_pct,
      (SELECT claims_cutoff FROM claims_cutoff_cte) AS claims_cutoff
    FROM earned e
    JOIN claimed cl ON e.cohort_year = cl.cohort_year AND e.dev_month = cl.dev_month
    JOIN policy_totals pt ON e.cohort_year = pt.cohort_year
    ORDER BY e.cohort_year, e.dev_month
  `;
}

export function generateFrequencyYoyQuery(filters: ClaimsDetailFilters): string {
  const claimWhere = buildWhere(filters);
  const policyWhere = buildPolicyWhere(filters);
  // B303: cutoffDate 用于 earned_days 计算（与 cost-ratios.ts earned_loss_frequency 同口径）
  // 缺省 '9999-12-31' → 所有保单视为已满期（等同旧逻辑的上界）
  const cutoffDate = escapeSqlValue(filters.cutoffDate ?? '9999-12-31');
  // 取最近3个完整年份的Q1-Q4数据
  return `
    WITH quarterly_claims AS (
      SELECT
        YEAR(c.accident_time) AS year,
        QUARTER(c.accident_time) AS quarter,
        COUNT(*) AS claim_count,
        SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS injury_count,
        ROUND(SUM(c.reserve_amount) / 1e4, 0) AS reserve_wan
      FROM ClaimsDetail c
      JOIN ${DEDUPED_POLICY_SUBQUERY} p ON c.policy_no = p.policy_no
      WHERE c.accident_time >= '2022-01-01' AND ${claimWhere}${policyWhere}
      GROUP BY YEAR(c.accident_time), QUARTER(c.accident_time)
    ),
    quarterly_policies AS (
      SELECT
        YEAR(p.insurance_start_date) AS year,
        QUARTER(p.insurance_start_date) AS quarter,
        COUNT(DISTINCT p.policy_no) AS policy_count,
        -- B303: 满期天数（与 cost-ratios.ts earned_days 同口径）
        -- LEAST(max earned, full policy term) → cutoff 前已赚天数
        -- B303-followup (codex P2 #457): 必须用 DEDUPED_POLICY_SUBQUERY 去重，否则
        -- PolicyFact 同一保单的原单+批改多行会让 SUM(earned_days) 被重复累计，
        -- 已满期保单算成多个 earned exposure → 系统性压低 freq_per_1000。
        -- quarterly_claims 已用同一去重子查询，分子分母 cohort 同源。
        SUM(LEAST(
          GREATEST(DATEDIFF('day', p.insurance_start_date, DATE '${cutoffDate}') + 1, 0),
          DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
        )) AS total_earned_days
      FROM ${DEDUPED_POLICY_SUBQUERY} p
      WHERE p.insurance_start_date >= '2022-01-01'${policyWhere}
      GROUP BY YEAR(p.insurance_start_date), QUARTER(p.insurance_start_date)
    )
    SELECT
      c.year, c.quarter,
      c.claim_count, c.injury_count, c.reserve_wan,
      e.policy_count,
      e.total_earned_days,
      -- B303: 出险率分母改为 earned_exposure（已赚暴露=满期天数/365），年化出险件数/已赚年份
      -- 旧逻辑用 policy_count，2026 Q2 等未满期季度分母恒为全量，导致出险率低估 1205%
      ROUND(c.claim_count * 1000.0 / NULLIF(e.total_earned_days / 365.0, 0), 2) AS freq_per_1000,
      ROUND(c.injury_count * 100.0 / NULLIF(c.claim_count, 0), 1) AS injury_pct
    FROM quarterly_claims c
    LEFT JOIN quarterly_policies e ON c.year = e.year AND c.quarter = e.quarter
    ORDER BY c.year, c.quarter
  `;
}
