/**
 * 续保宇宙 SQL 生成器（V2）
 *
 * 数据源：RenewalUniverse VIEW（ETL 预计算扁平表）
 * 列：vehicle_frame_no, policy_no, insurance_start_date, expiry_date, expiry_month,
 *     commercial_premium, compulsory_premium, total_premium,
 *     org_level_3, salesman_name, customer_category, coverage_combination,
 *     insurance_type, insurance_grade, is_new_car, is_transfer, is_nev, is_telemarketing,
 *     tonnage_segment,
 *     is_renewed, renewed_policy_no, renewed_premium, renewed_date,
 *     is_quoted, first_quote_time, last_quote_time, quote_count, quote_premium,
 *     lost_to_insurer, funnel_stage, days_since_expiry, action_priority
 */

// ── 筛选器 ──

/** 支持的分组维度 */
export type RenewalGroupDimension =
  | 'org'
  | 'salesman'
  | 'category'
  | 'grade'
  | 'coverage'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing';

/** 下钻路径节点 — 依次应用为 WHERE 过滤条件 */
export interface DrillStep {
  dimension: RenewalGroupDimension;
  value: string;
}

export interface RenewalUniverseFilters {
  orgName?: string;
  salesmanName?: string;
  customerCategory?: string;
  expiryMonth?: number;
  expiryDateStart?: string;
  expiryDateEnd?: string;
  funnelStage?: 'renewed' | 'quoted_not_renewed' | 'not_quoted';
  actionPriority?: string;
  isNewCar?: boolean;
  isNev?: boolean;
  insuranceGrade?: string;
  page?: number;
  pageSize?: number;
  groupBy?: RenewalGroupDimension;
  /** 下钻路径：每步 {dimension, value} 作为 WHERE 过滤 */
  drillPath?: DrillStep[];
}

function esc(val: string): string {
  return val.replace(/'/g, "''");
}

/** 维度 → SQL 列映射 */
const DIMENSION_COL: Record<RenewalGroupDimension, string> = {
  org: 'org_level_3',
  salesman: 'salesman_name',
  category: 'customer_category',
  grade: 'insurance_grade',
  coverage: 'coverage_combination',
  is_new_car: 'is_new_car',
  is_transfer: 'is_transfer',
  is_nev: 'is_nev',
  is_telemarketing: 'is_telemarketing',
};

const VALID_FUNNEL_STAGES = new Set(['renewed', 'quoted_not_renewed', 'not_quoted']);
const VALID_PRIORITIES = new Set(['P1', 'P2', 'P3', 'P4']);

/**
 * @param permissionFilter 服务端权限 WHERE 片段（由 access-control.ts 构造），禁止接受用户输入
 */
function buildWhere(filters: RenewalUniverseFilters, permissionFilter = '1=1'): string {
  const conditions: string[] = ['1=1'];

  if (filters.orgName) {
    conditions.push(`org_level_3 = '${esc(filters.orgName)}'`);
  }
  if (filters.salesmanName) {
    conditions.push(`salesman_name = '${esc(filters.salesmanName)}'`);
  }
  if (filters.customerCategory) {
    conditions.push(`customer_category = '${esc(filters.customerCategory)}'`);
  }
  if (filters.expiryMonth != null) {
    const month = Number(filters.expiryMonth);
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      conditions.push(`expiry_month = ${month}`);
    }
  }
  if (filters.expiryDateStart) {
    conditions.push(`expiry_date >= '${esc(filters.expiryDateStart)}'`);
  }
  if (filters.expiryDateEnd) {
    conditions.push(`expiry_date <= '${esc(filters.expiryDateEnd)}'`);
  }
  if (filters.funnelStage && VALID_FUNNEL_STAGES.has(filters.funnelStage)) {
    conditions.push(`funnel_stage = '${filters.funnelStage}'`);
  }
  if (filters.actionPriority && VALID_PRIORITIES.has(filters.actionPriority)) {
    conditions.push(`action_priority = '${filters.actionPriority}'`);
  }
  if (filters.isNewCar != null) {
    conditions.push(`is_new_car = ${filters.isNewCar}`);
  }
  if (filters.isNev != null) {
    conditions.push(`is_nev = ${filters.isNev}`);
  }
  if (filters.insuranceGrade) {
    conditions.push(`insurance_grade = '${esc(filters.insuranceGrade)}'`);
  }

  // drillPath：链式过滤
  if (filters.drillPath && Array.isArray(filters.drillPath)) {
    for (const step of filters.drillPath) {
      const col = DIMENSION_COL[step.dimension];
      if (col) {
        conditions.push(`${col} = '${esc(step.value)}'`);
      }
    }
  }

  if (permissionFilter && permissionFilter !== '1=1') {
    conditions.push(`(${permissionFilter})`);
  }

  return conditions.join(' AND ');
}

// ── Tab 1: 续保总览 ──

/**
 * 总览 KPI + 按维度分组统计
 * 用途：Tab 1 上半部分 KPI 卡片 + 下半部分排名表
 */
export function generateOverviewQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  const groupBy = filters.groupBy ?? 'org';
  const groupCol = DIMENSION_COL[groupBy] ?? 'org_level_3';

  return `
    SELECT
      ${groupCol} AS group_name,
      COUNT(*) AS due_count,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS renewed_count,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS quoted_count,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      ROUND(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS quote_coverage_rate,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0
            / NULLIF(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END), 0), 1) AS quote_to_renewal_rate,
      ROUND(SUM(total_premium) / 10000.0, 0) AS due_premium_wan,
      ROUND(SUM(CASE WHEN is_renewed THEN renewed_premium ELSE 0 END) / 10000.0, 0) AS renewed_premium_wan,
      SUM(CASE WHEN funnel_stage = 'not_quoted' THEN 1 ELSE 0 END) AS not_quoted_count,
      SUM(CASE WHEN action_priority = 'P1' THEN 1 ELSE 0 END) AS p1_count,
      SUM(CASE WHEN action_priority = 'P2' THEN 1 ELSE 0 END) AS p2_count
    FROM RenewalUniverse
    WHERE ${where}
    GROUP BY ${groupCol}
    ORDER BY due_count DESC
  `;
}

/**
 * 总览 KPI 汇总行（不分组，返回单行）
 */
export function generateOverviewTotalQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  return `
    SELECT
      COUNT(*) AS due_count,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS renewed_count,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS quoted_count,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      ROUND(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS quote_coverage_rate,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0
            / NULLIF(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END), 0), 1) AS quote_to_renewal_rate,
      ROUND(SUM(total_premium) / 10000.0, 0) AS due_premium_wan,
      ROUND(SUM(CASE WHEN is_renewed THEN renewed_premium ELSE 0 END) / 10000.0, 0) AS renewed_premium_wan,
      SUM(CASE WHEN funnel_stage = 'not_quoted' THEN 1 ELSE 0 END) AS not_quoted_count,
      SUM(CASE WHEN funnel_stage = 'quoted_not_renewed' THEN 1 ELSE 0 END) AS quoted_not_renewed_count,
      SUM(CASE WHEN action_priority = 'P1' THEN 1 ELSE 0 END) AS p1_count,
      SUM(CASE WHEN action_priority = 'P2' THEN 1 ELSE 0 END) AS p2_count,
      SUM(CASE WHEN action_priority = 'P3' THEN 1 ELSE 0 END) AS p3_count,
      SUM(CASE WHEN action_priority = 'P4' THEN 1 ELSE 0 END) AS p4_count
    FROM RenewalUniverse
    WHERE ${where}
  `;
}

/**
 * 月度到期走势（按 expiry_month 分组）
 */
export function generateTrendQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  return `
    SELECT
      expiry_month,
      COUNT(*) AS due_count,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS renewed_count,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS quoted_count,
      ROUND(SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS renewal_rate,
      ROUND(SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS quote_coverage_rate,
      ROUND(SUM(total_premium) / 10000.0, 0) AS due_premium_wan
    FROM RenewalUniverse
    WHERE ${where}
    GROUP BY expiry_month
    ORDER BY expiry_month
  `;
}

// ── Tab 2: 转化漏斗 ──

/**
 * 漏斗汇总（三级：应续→已报价→已续保）
 * 返回每个漏斗阶段的件数和转化率
 */
export function generateFunnelQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  return `
    SELECT
      funnel_stage,
      COUNT(*) AS count,
      ROUND(SUM(total_premium) / 10000.0, 0) AS premium_wan
    FROM RenewalUniverse
    WHERE ${where}
    GROUP BY funnel_stage
    ORDER BY
      CASE funnel_stage
        WHEN 'renewed' THEN 1
        WHEN 'quoted_not_renewed' THEN 2
        WHEN 'not_quoted' THEN 3
      END
  `;
}

/**
 * 流失归因分析（未续保原因拆解）
 * 按维度分组，显示各阶段流失情况
 */
export function generateLossReasonQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  const groupBy = filters.groupBy ?? 'org';
  const groupCol = DIMENSION_COL[groupBy] ?? 'org_level_3';

  return `
    SELECT
      ${groupCol} AS group_name,
      COUNT(*) AS due_count,
      SUM(CASE WHEN funnel_stage = 'not_quoted' THEN 1 ELSE 0 END) AS not_quoted_count,
      SUM(CASE WHEN funnel_stage = 'quoted_not_renewed' THEN 1 ELSE 0 END) AS quoted_not_renewed_count,
      SUM(CASE WHEN funnel_stage = 'renewed' THEN 1 ELSE 0 END) AS renewed_count,
      ROUND(SUM(CASE WHEN funnel_stage = 'not_quoted' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS not_quoted_rate,
      ROUND(SUM(CASE WHEN funnel_stage = 'quoted_not_renewed' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS quoted_not_renewed_rate,
      ROUND(SUM(CASE WHEN funnel_stage = 'renewed' THEN 1 ELSE 0 END) * 100.0
            / NULLIF(COUNT(*), 0), 1) AS renewal_rate
    FROM RenewalUniverse
    WHERE ${where}
    GROUP BY ${groupCol}
    ORDER BY not_quoted_count DESC
  `;
}

// ── Tab 3: 竞争格局 ──

/**
 * 竞争流失去向（流失到哪家保险公司）
 * 仅统计有 lost_to_insurer 非空且未续保的 VIN
 */
export function generateCompetitionLossQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  return `
    SELECT
      lost_to_insurer,
      COUNT(*) AS loss_count,
      ROUND(SUM(total_premium) / 10000.0, 0) AS loss_premium_wan
    FROM RenewalUniverse
    WHERE ${where}
      AND NOT is_renewed
      AND lost_to_insurer IS NOT NULL
      AND TRIM(lost_to_insurer) != ''
    GROUP BY lost_to_insurer
    ORDER BY loss_count DESC
    LIMIT 20
  `;
}

/**
 * 竞争转入来源（从哪家保险公司转入）
 * 基于 PolicyFact 2026 的 renewal_mode = '转保' 数据
 * 注意：此查询暂时用 RenewalUniverse 中已续保的记录
 */
export function generateCompetitionGainQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  return `
    SELECT
      lost_to_insurer AS source_insurer,
      COUNT(*) AS gain_count,
      ROUND(SUM(renewed_premium) / 10000.0, 0) AS gain_premium_wan
    FROM RenewalUniverse
    WHERE ${where}
      AND is_renewed
      AND lost_to_insurer IS NOT NULL
      AND TRIM(lost_to_insurer) != ''
    GROUP BY lost_to_insurer
    ORDER BY gain_count DESC
    LIMIT 20
  `;
}

// ── Tab 4: 行动看板 ──

/**
 * 待办清单（保单级明细，分页）
 * 按 action_priority ASC + days_since_expiry DESC 排序（紧急的在前）
 */
export function generateActionListQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  return `
    SELECT
      vehicle_frame_no,
      policy_no,
      org_level_3,
      salesman_name,
      customer_category,
      insurance_grade,
      CAST(expiry_date AS VARCHAR) AS expiry_date,
      days_since_expiry,
      funnel_stage,
      action_priority,
      is_quoted,
      is_renewed,
      ROUND(total_premium, 0) AS total_premium,
      ROUND(quote_premium, 0) AS quote_premium,
      lost_to_insurer
    FROM RenewalUniverse
    WHERE ${where}
    ORDER BY
      CASE action_priority
        WHEN 'P1' THEN 1 WHEN 'P2' THEN 2
        WHEN 'P3' THEN 3 ELSE 4
      END,
      days_since_expiry DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
}

/**
 * 待办清单总数（独立查询，路由层与 actionList 并行执行）
 */
export function generateActionListCountQuery(filters: RenewalUniverseFilters = {}, permissionFilter?: string): string {
  const where = buildWhere(filters, permissionFilter);
  return `SELECT COUNT(*) AS total_count FROM RenewalUniverse WHERE ${where}`;
}

// ── 元数据 ──

/**
 * 续保宇宙元数据：数据截止日 + 应续年份 + 统计摘要
 * latest_data_date 取 PolicyFact 当年最新 policy_date（代表数据完整性边界）
 */
export function generateMetadataQuery(permissionFilter = '1=1'): string {
  return `
    WITH data_bounds AS (
      SELECT CAST(MAX(CAST(policy_date AS DATE)) AS VARCHAR) AS latest_policy_date
      FROM PolicyFact
      WHERE YEAR(policy_date) = YEAR(CURRENT_DATE)
    )
    SELECT
      (SELECT latest_policy_date FROM data_bounds) AS latest_data_date,
      CAST(MIN(expiry_date) AS VARCHAR) AS earliest_expiry_date,
      CAST(MAX(expiry_date) AS VARCHAR) AS latest_expiry_date,
      COUNT(*) AS total_records,
      SUM(CASE WHEN is_renewed THEN 1 ELSE 0 END) AS renewed_count,
      SUM(CASE WHEN is_quoted THEN 1 ELSE 0 END) AS quoted_count,
      YEAR(MIN(insurance_start_date)) AS due_year
    FROM RenewalUniverse
    WHERE ${permissionFilter}
  `;
}
