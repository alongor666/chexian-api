/**
 * Renewal Drilldown SQL Generator
 *
 * 续保下钻分析 SQL 生成器
 *
 * ============================================================================
 * 【重要业务知识】续保分析的核心规则
 * ============================================================================
 *
 * ### 【核心公式】到期日计算
 *
 * ```
 * 到期日 = 起保日 + 1年 - 1天
 * ```
 *
 * ⚠️ 这个 "-1天" 非常关键！它导致每个月1日起保的保单实际在**上个月最后一天**到期：
 *
 * | 起保日       | 到期日       | 实际到期月份 |
 * |-------------|-------------|-------------|
 * | 2025-02-01  | 2026-01-31  | **1月**     |
 * | 2025-02-02  | 2026-02-01  | **2月**     |
 * | 2025-03-01  | 2026-02-28  | **2月**     |
 *
 * **闰年影响**：2024-02-29起保 → 2025-02-28到期（闰年到非闰年）
 *
 * **正确的SQL**：按到期日月份筛选，而非按起保月份！
 * ```sql
 * MONTH(DATE_ADD(insurance_start_date, INTERVAL '1 year') - INTERVAL '1 day') = 2
 * ```
 *
 * ============================================================================
 * 【重要业务知识】续保分析的两种统计模式
 * ============================================================================
 *
 * 实际业务中，续保分析存在两种不同的统计需求：
 *
 * ### 模式一：按到期月份统计（dueMonth 参数）
 * - **场景**：追踪"2月到期的保单续保率"，包括提前续保
 * - **应续件数**：上一年该月起保的【所有】保单（不管当前是否已到期）
 * - **已续件数**：这些保单中已经续保的数量（含提前续保）
 * - **cutoffDate**：❌ 不应用，因为要看完整月份的数据
 * - **使用场景**：
 *   - 当月到期保单追踪：现在是1月，看1月到期的续保率
 *   - 次月到期保单预警：现在是1月，提前看2月到期的续保率（提前续保情况）
 *   - 历史月份回顾：看去年某月的最终续保率
 *
 * ### 模式二：按到期日范围统计（cutoffDate 参数，无 dueMonth）
 * - **场景**：追踪"截止今日已到期保单的续保率"
 * - **应续件数**：到期日在 [年初, cutoffDate] 范围内的保单
 * - **已续件数**：这些保单中已经续保的数量
 * - **cutoffDate**：✅ 应用，限制到期日范围
 * - **使用场景**：
 *   - 年度累计续保率：从年初到今天的整体续保情况
 *   - 特定时间段统计：某个日期范围内的续保率
 *
 * ### 技术实现
 * - 当 dueMonth 有值时：只按月份筛选，不应用 cutoffDate 的日期范围过滤
 * - 当 dueMonth 无值时：应用 cutoffDate 的日期范围过滤
 * - 这两种模式互斥，不会同时生效
 *
 * ============================================================================
 *
 * 功能：
 * - 五层下钻：公司整体 → 三级机构 → 销售团队 → 业务员 → 险别组合
 * - 续保率：已续保单数 / 应续保单数
 * - 报价率：有报价记录的保单数 / 应续保单数
 * - Top10/Last10 展示（公司/机构/团队层级）
 * - 全量展示（业务员/险别层级）
 *
 * 数据来源：
 * - PolicyFactRenewal（续保视图）
 * - 筛选条件：是否交商统保 = '套单'、续保模式、客户类别等
 */

import { buildWhereClauseFromFilters } from '../utils/queryBuilder.js';
import { createLogger } from '../utils/logger.js';
import type { AdvancedFilterState } from '../types/data.js';
import type { DateCriteria } from '../types/data.js';

const logger = createLogger('RenewalDrilldownSQL');

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 验证年份参数，防止非法值导致 SQL 异常
 * @param year - 年份
 * @returns 验证后的年份
 * @throws 如果年份非法
 */
function validateYear(year: number): number {
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || Number.isNaN(year) || year < 2000 || year > currentYear + 5) {
    logger.error('Invalid year parameter', { year, currentYear });
    throw new Error(`Invalid year: ${year}. Expected integer between 2000 and ${currentYear + 5}`);
  }
  return year;
}

/**
 * 转义 SQL 字符串中的特殊字符，防止 SQL 注入
 * @param str - 原始字符串
 * @returns 转义后的字符串
 */
function escapeSQL(str: string): string {
  if (str == null) return '';
  return String(str).replace(/'/g, "''");
}

/**
 * is_quote 字段的布尔值检查 SQL 条件
 * 统一处理各种布尔值格式：'true', '1', 'TRUE', true
 */
const IS_QUOTE_TRUE_CONDITION = `(is_quote = 'true' OR is_quote = '1' OR is_quote = 'TRUE' OR CAST(is_quote AS VARCHAR) = 'true')`;

/**
 * 到期日计算表达式（起保日 + 1年 - 1天）
 * 重要：2025-02-01起保 → 2026-01-31到期（1月！）
 */
const EXPIRY_DATE_EXPR = `(DATE_ADD(CAST(insurance_start_date AS DATE), INTERVAL '1 year') - INTERVAL '1 day')`;

/**
 * 下钻层级类型
 * 五层结构：公司 → 三级机构 → 销售团队 → 业务员 → 险别组合
 */
export type DrilldownLevel = 'company' | 'org' | 'team' | 'salesman' | 'coverage';

/**
 * 下钻维度配置
 */
export interface DrilldownDimension {
  /** 当前层级 */
  level: DrilldownLevel;
  /** 上级筛选值（如机构名、团队名） */
  parentValue?: string;
  /** 是否只看自留续保 */
  selfRenewalOnly?: boolean;
  /** 是否只看套单（是否交商统保='套单'） */
  bundleOnly?: boolean;
  /** 客户类别筛选 */
  customerCategory?: string;
  /** 到期月份筛选（1-12），筛选去年该月起保的保单 */
  dueMonth?: number;
  /** 完整的过滤路径（用于多层下钻） */
  filters?: {
    org?: string;
    team?: string;
    salesman?: string;
  };
}

/**
 * 分布类型
 */
export type DistributionType = 'coverage' | 'new_car' | 'nev' | 'transfer';

/**
 * 排序方式
 */
export type SortField = 'renewal_rate' | 'quote_rate' | 'due_count' | 'renewed_count';
export type SortOrder = 'asc' | 'desc';

/**
 * 排名筛选配置
 */
export interface RankingConfig {
  /** 是否启用Top/Last筛选 */
  enabled: boolean;
  /** Top N */
  topN?: number;
  /** Last N */
  lastN?: number;
  /** 最小应续件数 */
  minDueCount?: number;
}

/**
 * 构建续保下钻的WHERE子句
 * 固定使用起保日期口径
 *
 * @param cutoffDate - 统计截止日期（YYYY-MM-DD格式），用于过滤到期日范围
 *                     起始日固定为 targetYear-01-01
 */
function buildDrilldownWhereClause(
  filters: AdvancedFilterState,
  dimension: DrilldownDimension,
  targetYear: number,
  cutoffDate?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const conditions: string[] = [];

  // 1. 按到期月份筛选（精确计算到期日所在月份）
  if (dimension.dueMonth && dimension.dueMonth >= 1 && dimension.dueMonth <= 12) {
    // 到期年份 = targetYear，到期月份 = dueMonth
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dimension.dueMonth}`);
  } else {
    // 2. 无特定月份时，按起保年份筛选（上一年起保的保单）
    const baseYear = validYear - 1;
    conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);
  }

  // 3. 到期日范围过滤（如果提供了cutoffDate）
  // 注意：当用户选择了特定到期月份时，不应用cutoffDate过滤，否则会导致数据为空
  if (cutoffDate && !dimension.dueMonth) {
    const startDate = `${validYear}-01-01`;
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${startDate}' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  // 4. 套单筛选
  if (dimension.bundleOnly) {
    conditions.push(`is_commercial_insure = '套单'`);
  }

  // 5. 自留续保筛选
  if (dimension.selfRenewalOnly) {
    conditions.push(`renewal_mode = '自留'`);
  }

  // 6. 客户类别筛选（使用 escapeSQL 防止注入）
  if (dimension.customerCategory) {
    conditions.push(`customer_category = '${escapeSQL(dimension.customerCategory)}'`);
  }

  // 7. 上级筛选（支持五层下钻路径，使用 escapeSQL 防止注入）
  if (dimension.filters?.org) {
    conditions.push(`org_level_3 = '${escapeSQL(dimension.filters.org)}'`);
  }
  if (dimension.filters?.salesman) {
    conditions.push(`salesman_name LIKE '%${escapeSQL(dimension.filters.salesman)}%'`);
  }
  // 兼容旧版 parentValue 逻辑
  if (!dimension.filters && dimension.parentValue) {
    const escapedValue = escapeSQL(dimension.parentValue);
    if (dimension.level === 'salesman') {
      conditions.push(`org_level_3 = '${escapedValue}'`);
    } else if (dimension.level === 'team') {
      conditions.push(`org_level_3 = '${escapedValue}'`);
    } else if (dimension.level === 'coverage') {
      conditions.push(`salesman_name LIKE '%${escapedValue}%'`);
    }
  }

  // 8. 其他筛选条件（机构、业务员等）
  const additionalFilters: AdvancedFilterState = {
    ...filters,
    policy_date_start: undefined,
    policy_date_end: undefined,
  };
  const additionalWhere = buildWhereClauseFromFilters(
    additionalFilters,
    'insurance_start_date' as DateCriteria
  );
  if (additionalWhere && additionalWhere !== '1=1') {
    conditions.push(additionalWhere);
  }

  return conditions.join(' AND ');
}

/**
 * 获取分组字段
 */
function getGroupByField(level: DrilldownLevel): string {
  switch (level) {
    case 'company':
      return "'公司整体' AS group_name";
    case 'org':
      return 'org_level_3 AS group_name';
    case 'team':
      return 'team_name AS group_name';
    case 'salesman':
      // 清理业务员名称：移除开头的数字ID（如"200052588李珊" → "李珊"）
      return `REGEXP_REPLACE(salesman_name, '^[0-9]+', '') AS group_name`;
    case 'coverage':
      return 'coverage_combination AS group_name';
    default:
      throw new Error(`Unknown drilldown level: ${level}`);
  }
}

/**
 * 获取附加字段
 */
function getAdditionalFields(level: DrilldownLevel, dimension: DrilldownDimension): string {
  switch (level) {
    case 'company':
      return "NULL AS parent_name, 'company' AS level_type";
    case 'org':
      return "'公司整体' AS parent_name, 'org' AS level_type";
    case 'team':
      return `'${dimension.filters?.org || ''}' AS parent_name, 'team' AS level_type`;
    case 'salesman':
      return `'${dimension.filters?.team || dimension.parentValue || ''}' AS parent_name, 'salesman' AS level_type`;
    case 'coverage':
      return `'${dimension.filters?.salesman || dimension.parentValue || ''}' AS parent_name, 'coverage' AS level_type`;
    default:
      throw new Error(`Unknown drilldown level: ${level}`);
  }
}

/**
 * 生成续保下钻汇总查询
 *
 * @param filters - 筛选条件
 * @param targetYear - 目标年份
 * @param dimension - 下钻维度配置
 * @param ranking - 排名筛选配置
 * @param sortField - 排序字段
 * @param sortOrder - 排序方向
 * @param cutoffDate - 统计截止日期（YYYY-MM-DD格式），起始日固定为 targetYear-01-01
 * @returns SQL 查询字符串
 */
export function generateRenewalDrilldownQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  ranking: RankingConfig = { enabled: false },
  sortField: SortField = 'renewal_rate',
  sortOrder: SortOrder = 'desc',
  cutoffDate?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const whereClause = buildDrilldownWhereClause(filters, dimension, validYear, cutoffDate);
  const groupByField = getGroupByField(dimension.level);
  const additionalFields = getAdditionalFields(dimension.level, dimension);
  const minDueCount = ranking.minDueCount ?? 1;

  logger.debug('生成续保下钻查询', {
    targetYear: validYear,
    dimension,
    ranking,
    sortField,
    sortOrder,
  });

  // 团队层级需要通过 SalesmanPlanFact 获取团队信息
  const needsTeamJoin = dimension.level === 'team' || dimension.level === 'salesman' || dimension.level === 'coverage';

  // 构建 GROUP BY 子句
  let groupByClause: string;
  switch (dimension.level) {
    case 'company':
      groupByClause = '1, 2, 3';
      break;
    case 'org':
      groupByClause = 'org_level_3';
      break;
    case 'team':
      groupByClause = 'team_name';
      break;
    case 'salesman':
      groupByClause = "REGEXP_REPLACE(r.salesman_name, '^[0-9]+', ''), team_name";
      break;
    case 'coverage':
      groupByClause = 'coverage_combination';
      break;
    default:
      groupByClause = '1';
  }

  // 基础聚合查询
  let baseQuery: string;

  // 团队筛选条件（只在有 team JOIN 时添加）
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  if (needsTeamJoin) {
    // 团队/业务员/险别组合层级需要 JOIN SalesmanPlanFact 获取团队信息
    baseQuery = `
    WITH team_mapping AS (
      SELECT DISTINCT salesman_name, team_name, org_name
      FROM SalesmanPlanFact
      WHERE plan_year = ${validYear}
    ),
    renewal_with_team AS (
      SELECT
        r.*,
        COALESCE(t.team_name, r.org_level_3 || '未归属团队') AS team_name
      FROM PolicyFactRenewal r
      LEFT JOIN team_mapping t ON r.salesman_name = t.salesman_name
    ),
    drilldown_base AS (
      SELECT
        ${groupByField.replace('salesman_name', 'r.salesman_name')},
        ${additionalFields},
        -- 应续件数
        COUNT(DISTINCT policy_no) AS due_count,
        -- 已续件数
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        -- 有报价件数
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        -- 应续保费
        COALESCE(SUM(premium), 0) AS due_premium,
        -- 已续保费
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        -- 有报价保费
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN premium ELSE 0
        END), 0) AS quoted_premium
      FROM renewal_with_team r
      WHERE ${whereClause}${teamFilterClause}
      GROUP BY ${groupByClause}
      HAVING COUNT(DISTINCT policy_no) >= ${minDueCount}
    ),
    drilldown_calc AS (
      SELECT
        group_name,
        parent_name,
        level_type,
        due_count,
        renewed_count,
        quoted_count,
        due_premium,
        renewed_premium,
        quoted_premium,
        -- 续保率（件数）
        CASE WHEN due_count = 0 THEN 0
          ELSE renewed_count * 1.0 / due_count
        END AS renewal_rate,
        -- 报价率（件数）
        CASE WHEN due_count = 0 THEN 0
          ELSE quoted_count * 1.0 / due_count
        END AS quote_rate,
        -- 续保率（保费）
        CASE WHEN due_premium = 0 THEN 0
          ELSE renewed_premium * 1.0 / due_premium
        END AS renewal_premium_rate,
        -- 报价率（保费）
        CASE WHEN due_premium = 0 THEN 0
          ELSE quoted_premium * 1.0 / due_premium
        END AS quote_premium_rate,
        -- 排名
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder}) AS rank_asc,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder === 'asc' ? 'desc' : 'asc'}) AS rank_desc
      FROM drilldown_base
    )
  `;
  } else {
    baseQuery = `
    WITH drilldown_base AS (
      SELECT
        ${groupByField},
        ${additionalFields},
        -- 应续件数
        COUNT(DISTINCT policy_no) AS due_count,
        -- 已续件数
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        -- 有报价件数
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        -- 应续保费
        COALESCE(SUM(premium), 0) AS due_premium,
        -- 已续保费
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        -- 有报价保费
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN premium ELSE 0
        END), 0) AS quoted_premium
      FROM PolicyFactRenewal
      WHERE ${whereClause}
      GROUP BY ${groupByClause}
      HAVING COUNT(DISTINCT policy_no) >= ${minDueCount}
    ),
    drilldown_calc AS (
      SELECT
        group_name,
        parent_name,
        level_type,
        due_count,
        renewed_count,
        quoted_count,
        due_premium,
        renewed_premium,
        quoted_premium,
        -- 续保率（件数）
        CASE WHEN due_count = 0 THEN 0
          ELSE renewed_count * 1.0 / due_count
        END AS renewal_rate,
        -- 报价率（件数）
        CASE WHEN due_count = 0 THEN 0
          ELSE quoted_count * 1.0 / due_count
        END AS quote_rate,
        -- 续保率（保费）
        CASE WHEN due_premium = 0 THEN 0
          ELSE renewed_premium * 1.0 / due_premium
        END AS renewal_premium_rate,
        -- 报价率（保费）
        CASE WHEN due_premium = 0 THEN 0
          ELSE quoted_premium * 1.0 / due_premium
        END AS quote_premium_rate,
        -- 排名
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder}) AS rank_asc,
        ROW_NUMBER() OVER (ORDER BY ${sortField} ${sortOrder === 'asc' ? 'desc' : 'asc'}) AS rank_desc
      FROM drilldown_base
    )
  `;
  }

  // 根据ranking配置生成最终查询
  if (ranking.enabled && (ranking.topN || ranking.lastN)) {
    const topN = ranking.topN || 0;
    const lastN = ranking.lastN || 0;

    return `
      ${baseQuery}
      SELECT * FROM drilldown_calc
      WHERE rank_asc <= ${topN} OR rank_desc <= ${lastN}
      ORDER BY ${sortField} ${sortOrder}
    `;
  }

  return `
    ${baseQuery}
    SELECT * FROM drilldown_calc
    ORDER BY ${sortField} ${sortOrder}
  `;
}

/**
 * 生成客户类别分布查询
 * 按客户类别统计续保率和报价率
 *
 * @param cutoffDate - 统计截止日期（YYYY-MM-DD格式），起始日固定为 targetYear-01-01
 */
export function generateCustomerCategoryQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const conditions: string[] = [];

  // 按到期月份筛选（精确计算到期日所在月份）
  if (dimension.dueMonth && dimension.dueMonth >= 1 && dimension.dueMonth <= 12) {
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dimension.dueMonth}`);
  } else {
    const baseYear = validYear - 1;
    conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);
  }

  // 到期日范围过滤（如果提供了cutoffDate）
  // 注意：当用户选择了特定到期月份时，不应用cutoffDate过滤
  if (cutoffDate && !dimension.dueMonth) {
    const startDate = `${validYear}-01-01`;
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${escapeSQL(startDate)}' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  if (dimension.selfRenewalOnly) {
    conditions.push(`renewal_mode = '自留'`);
  }

  // 添加路径筛选（org 和 salesman）
  if (dimension.filters?.org) {
    conditions.push(`org_level_3 = '${escapeSQL(dimension.filters.org)}'`);
  }
  if (dimension.filters?.salesman) {
    conditions.push(`salesman_name LIKE '%${escapeSQL(dimension.filters.salesman)}%'`);
  }

  // 兼容旧版层级筛选
  if (!dimension.filters) {
    if (dimension.level === 'org' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    } else if (dimension.level === 'salesman' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    }
  }

  const whereClause = conditions.join(' AND ');

  // 如果有团队筛选，需要 JOIN SalesmanPlanFact 获取团队信息
  const needsTeamJoin = !!dimension.filters?.team;
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  if (needsTeamJoin) {
    return `
      WITH team_mapping AS (
        SELECT DISTINCT salesman_name, team_name, org_name
        FROM SalesmanPlanFact
        WHERE plan_year = ${validYear}
      ),
      renewal_with_team AS (
        SELECT
          r.*,
          COALESCE(t.team_name, r.org_level_3 || '未归属团队') AS team_name
        FROM PolicyFactRenewal r
        LEFT JOIN team_mapping t ON r.salesman_name = t.salesman_name
      )
      SELECT
        customer_category,
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS renewal_rate,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS quote_rate
      FROM renewal_with_team
      WHERE ${whereClause}${teamFilterClause}
      GROUP BY customer_category
      HAVING COUNT(DISTINCT policy_no) >= 1
      ORDER BY due_count DESC
    `;
  }

  return `
    SELECT
      customer_category,
      COUNT(DISTINCT policy_no) AS due_count,
      COUNT(DISTINCT CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN policy_no
      END) AS renewed_count,
      COUNT(DISTINCT CASE
        WHEN ${IS_QUOTE_TRUE_CONDITION}
        THEN policy_no
      END) AS quoted_count,
      COALESCE(SUM(premium), 0) AS due_premium,
      COALESCE(SUM(CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN premium ELSE 0
      END), 0) AS renewed_premium,
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS renewal_rate,
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS quote_rate
    FROM PolicyFactRenewal
    WHERE ${whereClause}
    GROUP BY customer_category
    HAVING COUNT(DISTINCT policy_no) >= 1
    ORDER BY due_count DESC
  `;
}

/**
 * 生成续保模式分布查询
 * 按续保模式（自留/流转等）统计
 *
 * @param cutoffDate - 统计截止日期（YYYY-MM-DD格式），起始日固定为 targetYear-01-01
 */
export function generateRenewalModeQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const conditions: string[] = [];

  // 按到期月份筛选（精确计算到期日所在月份）
  if (dimension.dueMonth && dimension.dueMonth >= 1 && dimension.dueMonth <= 12) {
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dimension.dueMonth}`);
  } else {
    const baseYear = validYear - 1;
    conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);
  }

  // 到期日范围过滤（如果提供了cutoffDate）
  // 注意：当用户选择了特定到期月份时，不应用cutoffDate过滤
  if (cutoffDate && !dimension.dueMonth) {
    const startDate = `${validYear}-01-01`;
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${escapeSQL(startDate)}' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  // 添加路径筛选（org 和 salesman）
  if (dimension.filters?.org) {
    conditions.push(`org_level_3 = '${escapeSQL(dimension.filters.org)}'`);
  }
  if (dimension.filters?.salesman) {
    conditions.push(`salesman_name LIKE '%${escapeSQL(dimension.filters.salesman)}%'`);
  }

  // 兼容旧版层级筛选
  if (!dimension.filters) {
    if (dimension.level === 'org' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    } else if (dimension.level === 'salesman' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    }
  }

  const whereClause = conditions.join(' AND ');

  // 如果有团队筛选，需要 JOIN SalesmanPlanFact 获取团队信息
  const needsTeamJoin = !!dimension.filters?.team;
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  if (needsTeamJoin) {
    return `
      WITH team_mapping AS (
        SELECT DISTINCT salesman_name, team_name, org_name
        FROM SalesmanPlanFact
        WHERE plan_year = ${validYear}
      ),
      renewal_with_team AS (
        SELECT
          r.*,
          COALESCE(t.team_name, r.org_level_3 || '未归属团队') AS team_name
        FROM PolicyFactRenewal r
        LEFT JOIN team_mapping t ON r.salesman_name = t.salesman_name
      )
      SELECT
        COALESCE(renewal_mode, '未知') AS renewal_mode,
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS renewal_rate,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS quote_rate
      FROM renewal_with_team
      WHERE ${whereClause}${teamFilterClause}
      GROUP BY COALESCE(renewal_mode, '未知')
      HAVING COUNT(DISTINCT policy_no) >= 1
      ORDER BY due_count DESC
    `;
  }

  return `
    SELECT
      COALESCE(renewal_mode, '未知') AS renewal_mode,
      COUNT(DISTINCT policy_no) AS due_count,
      COUNT(DISTINCT CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN policy_no
      END) AS renewed_count,
      COUNT(DISTINCT CASE
        WHEN ${IS_QUOTE_TRUE_CONDITION}
        THEN policy_no
      END) AS quoted_count,
      COALESCE(SUM(premium), 0) AS due_premium,
      COALESCE(SUM(CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN premium ELSE 0
      END), 0) AS renewed_premium,
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS renewal_rate,
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS quote_rate
    FROM PolicyFactRenewal
    WHERE ${whereClause}
    GROUP BY COALESCE(renewal_mode, '未知')
    HAVING COUNT(DISTINCT policy_no) >= 1
    ORDER BY due_count DESC
  `;
}

/**
 * 生成 KPI 卡片查询
 * 汇总当前层级的关键指标
 *
 * @param cutoffDate - 统计截止日期（YYYY-MM-DD格式），起始日固定为 targetYear-01-01
 */
export function generateKPICardQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const whereClause = buildDrilldownWhereClause(filters, dimension, validYear, cutoffDate);

  // 如果有团队筛选，需要 JOIN SalesmanPlanFact 获取团队信息
  const needsTeamJoin = !!dimension.filters?.team;
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  if (needsTeamJoin) {
    return `
      WITH team_mapping AS (
        SELECT DISTINCT salesman_name, team_name, org_name
        FROM SalesmanPlanFact
        WHERE plan_year = ${validYear}
      ),
      renewal_with_team AS (
        SELECT
          r.*,
          COALESCE(t.team_name, r.org_level_3 || '未归属团队') AS team_name
        FROM PolicyFactRenewal r
        LEFT JOIN team_mapping t ON r.salesman_name = t.salesman_name
      )
      SELECT
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        COALESCE(SUM(CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN premium ELSE 0
        END), 0) AS quoted_premium,
        -- 续保率
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS renewal_rate,
        -- 报价率
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS quote_rate,
        -- 报价转化率 = 已续保 / 有报价
        CASE WHEN COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END)
        END AS conversion_rate
      FROM renewal_with_team
      WHERE ${whereClause}${teamFilterClause}
    `;
  }

  return `
    SELECT
      COUNT(DISTINCT policy_no) AS due_count,
      COUNT(DISTINCT CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN policy_no
      END) AS renewed_count,
      COUNT(DISTINCT CASE
        WHEN ${IS_QUOTE_TRUE_CONDITION}
        THEN policy_no
      END) AS quoted_count,
      COALESCE(SUM(premium), 0) AS due_premium,
      COALESCE(SUM(CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN premium ELSE 0
      END), 0) AS renewed_premium,
      COALESCE(SUM(CASE
        WHEN ${IS_QUOTE_TRUE_CONDITION}
        THEN premium ELSE 0
      END), 0) AS quoted_premium,
      -- 续保率
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS renewal_rate,
      -- 报价率
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS quote_rate,
      -- 报价转化率 = 已续保 / 有报价
      CASE WHEN COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END)
      END AS conversion_rate
    FROM PolicyFactRenewal
    WHERE ${whereClause}
  `;
}

/**
 * 生成下钻导航查询
 * 获取下一层级的可选值列表
 */
export function generateDrilldownNavigationQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  currentLevel: DrilldownLevel,
  parentValue?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const baseYear = validYear - 1;
  const conditions: string[] = [];

  conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);

  // 根据当前层级确定要查询的下一层级字段
  let nextLevelField: string;
  switch (currentLevel) {
    case 'company':
      nextLevelField = 'org_level_3';
      break;
    case 'org':
      nextLevelField = 'salesman_name';
      if (parentValue) {
        conditions.push(`org_level_3 = '${escapeSQL(parentValue)}'`);
      }
      break;
    case 'team':
      nextLevelField = 'salesman_name';
      if (parentValue) {
        // 团队层级需要通过 SalesmanPlanFact 筛选
        return `
          SELECT DISTINCT s.salesman_name AS next_level_value
          FROM PolicyFactRenewal r
          LEFT JOIN SalesmanPlanFact s ON r.salesman_name = s.salesman_name
          WHERE YEAR(CAST(r.insurance_start_date AS DATE)) = ${baseYear}
            AND COALESCE(s.team_name, r.org_level_3 || '未归属团队') = '${escapeSQL(parentValue)}'
            AND r.salesman_name IS NOT NULL
            AND TRIM(r.salesman_name) <> ''
          ORDER BY s.salesman_name
        `;
      }
      break;
    case 'salesman':
      nextLevelField = 'coverage_combination';
      if (parentValue) {
        conditions.push(`salesman_name LIKE '%${escapeSQL(parentValue)}%'`);
      }
      break;
    default:
      // coverage 是最后一层，没有下一层
      return 'SELECT NULL AS next_level_value WHERE 1=0';
  }

  const whereClause = conditions.join(' AND ');

  return `
    SELECT DISTINCT ${nextLevelField} AS next_level_value
    FROM PolicyFactRenewal
    WHERE ${whereClause}
      AND ${nextLevelField} IS NOT NULL
      AND TRIM(${nextLevelField}) <> ''
    ORDER BY ${nextLevelField}
  `;
}

/**
 * 生成统一分布查询
 * 支持四种分布类型：险别组合、新旧车、能源类型、过户状态
 *
 * @param filters - 筛选条件
 * @param targetYear - 目标年份
 * @param dimension - 下钻维度配置
 * @param distributionType - 分布类型
 * @param cutoffDate - 统计截止日期
 */
export function generateDistributionQuery(
  _filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  distributionType: DistributionType,
  cutoffDate?: string
): string {
  // 验证年份参数
  const validYear = validateYear(targetYear);
  const conditions: string[] = [];

  // 按到期月份筛选（精确计算到期日所在月份）
  if (dimension.dueMonth && dimension.dueMonth >= 1 && dimension.dueMonth <= 12) {
    conditions.push(`YEAR(${EXPIRY_DATE_EXPR}) = ${validYear}`);
    conditions.push(`MONTH(${EXPIRY_DATE_EXPR}) = ${dimension.dueMonth}`);
  } else {
    const baseYear = validYear - 1;
    conditions.push(`YEAR(CAST(insurance_start_date AS DATE)) = ${baseYear}`);
  }

  // 到期日范围过滤
  // 注意：当用户选择了特定到期月份时，不应用cutoffDate过滤
  if (cutoffDate && !dimension.dueMonth) {
    const startDate = `${validYear}-01-01`;
    conditions.push(
      `${EXPIRY_DATE_EXPR} BETWEEN CAST('${escapeSQL(startDate)}' AS DATE) AND CAST('${escapeSQL(cutoffDate)}' AS DATE)`
    );
  }

  if (dimension.selfRenewalOnly) {
    conditions.push(`renewal_mode = '自留'`);
  }

  // 添加路径筛选
  if (dimension.filters?.org) {
    conditions.push(`org_level_3 = '${escapeSQL(dimension.filters.org)}'`);
  }
  if (dimension.filters?.salesman) {
    conditions.push(`salesman_name LIKE '%${escapeSQL(dimension.filters.salesman)}%'`);
  }

  // 兼容旧版层级筛选
  if (!dimension.filters) {
    if (dimension.level === 'org' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    } else if (dimension.level === 'salesman' && dimension.parentValue) {
      conditions.push(`org_level_3 = '${escapeSQL(dimension.parentValue)}'`);
    }
  }

  const whereClause = conditions.join(' AND ');

  // 根据分布类型确定分组字段和显示名称
  // 注意：布尔字段可能是 true/false/'true'/'false'/'是'/'否' 等多种格式
  // 统一转换为 VARCHAR 后比较，避免类型转换错误
  let groupField: string;
  let displayField: string;
  switch (distributionType) {
    case 'coverage':
      groupField = 'coverage_combination';
      displayField = 'coverage_combination';
      break;
    case 'new_car':
      groupField = 'is_new_car';
      displayField = `CASE WHEN CAST(is_new_car AS VARCHAR) IN ('true', 'TRUE', '1', '是') THEN '新车' ELSE '旧车' END`;
      break;
    case 'nev':
      groupField = 'is_nev';
      displayField = `CASE WHEN CAST(is_nev AS VARCHAR) IN ('true', 'TRUE', '1', '是') THEN '新能源' ELSE '燃油' END`;
      break;
    case 'transfer':
      groupField = 'is_transfer';
      displayField = `CASE WHEN CAST(is_transfer AS VARCHAR) IN ('true', 'TRUE', '1', '是') THEN '过户' ELSE '非过户' END`;
      break;
    default:
      groupField = 'coverage_combination';
      displayField = 'coverage_combination';
  }

  // 如果有团队筛选，需要 JOIN SalesmanPlanFact 获取团队信息
  const needsTeamJoin = !!dimension.filters?.team;
  const teamFilterClause = dimension.filters?.team
    ? ` AND team_name = '${escapeSQL(dimension.filters.team)}'`
    : '';

  if (needsTeamJoin) {
    return `
      WITH team_mapping AS (
        SELECT DISTINCT salesman_name, team_name, org_name
        FROM SalesmanPlanFact
        WHERE plan_year = ${validYear}
      ),
      renewal_with_team AS (
        SELECT
          r.*,
          COALESCE(t.team_name, r.org_level_3 || '未归属团队') AS team_name
        FROM PolicyFactRenewal r
        LEFT JOIN team_mapping t ON r.salesman_name = t.salesman_name
      )
      SELECT
        ${displayField} AS category,
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS renewal_rate,
        CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
          ELSE COUNT(DISTINCT CASE
            WHEN ${IS_QUOTE_TRUE_CONDITION}
            THEN policy_no
          END) * 1.0 / COUNT(DISTINCT policy_no)
        END AS quote_rate
      FROM renewal_with_team
      WHERE ${whereClause}${teamFilterClause}
      GROUP BY ${groupField}
      HAVING COUNT(DISTINCT policy_no) >= 1
      ORDER BY due_count DESC
    `;
  }

  return `
    SELECT
      ${displayField} AS category,
      COUNT(DISTINCT policy_no) AS due_count,
      COUNT(DISTINCT CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN policy_no
      END) AS renewed_count,
      COUNT(DISTINCT CASE
        WHEN ${IS_QUOTE_TRUE_CONDITION}
        THEN policy_no
      END) AS quoted_count,
      COALESCE(SUM(premium), 0) AS due_premium,
      COALESCE(SUM(CASE
        WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
        THEN premium ELSE 0
      END), 0) AS renewed_premium,
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS renewal_rate,
      CASE WHEN COUNT(DISTINCT policy_no) = 0 THEN 0
        ELSE COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) * 1.0 / COUNT(DISTINCT policy_no)
      END AS quote_rate
    FROM PolicyFactRenewal
    WHERE ${whereClause}
    GROUP BY ${groupField}
    HAVING COUNT(DISTINCT policy_no) >= 1
    ORDER BY due_count DESC
  `;
}

/**
 * 生成应续件数Top20业务员查询
 * 固定按应续件数降序排列，取Top 20
 *
 * @param filters - 筛选条件
 * @param targetYear - 目标年份
 * @param dimension - 下钻维度配置
 * @param cutoffDate - 统计截止日期（YYYY-MM-DD格式），起始日固定为 targetYear-01-01
 * @returns SQL 查询字符串
 */
export function generateTop20SalesmanQuery(
  filters: AdvancedFilterState,
  targetYear: number,
  dimension: DrilldownDimension,
  cutoffDate?: string
): string {
  const whereClause = buildDrilldownWhereClause(filters, dimension, targetYear, cutoffDate);

  return `
    WITH salesman_stats AS (
      SELECT
        REGEXP_REPLACE(salesman_name, '^[0-9]+', '') AS salesman_name,
        org_level_3,
        COUNT(DISTINCT policy_no) AS due_count,
        COUNT(DISTINCT CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN policy_no
        END) AS renewed_count,
        COUNT(DISTINCT CASE
          WHEN ${IS_QUOTE_TRUE_CONDITION}
          THEN policy_no
        END) AS quoted_count,
        COALESCE(SUM(premium), 0) AS due_premium,
        COALESCE(SUM(CASE
          WHEN renewal_policy_no IS NOT NULL AND renewal_policy_no <> ''
          THEN premium ELSE 0
        END), 0) AS renewed_premium
      FROM PolicyFactRenewal
      WHERE ${whereClause}
      GROUP BY REGEXP_REPLACE(salesman_name, '^[0-9]+', ''), org_level_3
      HAVING COUNT(DISTINCT policy_no) >= 1
    )
    SELECT
      ROW_NUMBER() OVER (ORDER BY due_count DESC) AS rank_asc,
      salesman_name AS group_name,
      org_level_3 AS parent_name,
      'salesman' AS level_type,
      due_count,
      renewed_count,
      quoted_count,
      due_premium,
      renewed_premium,
      due_premium AS quoted_premium,
      CASE WHEN due_count = 0 THEN 0 ELSE renewed_count * 1.0 / due_count END AS renewal_rate,
      CASE WHEN due_count = 0 THEN 0 ELSE quoted_count * 1.0 / due_count END AS quote_rate,
      CASE WHEN due_premium = 0 THEN 0 ELSE renewed_premium * 1.0 / due_premium END AS renewal_premium_rate,
      0 AS quote_premium_rate,
      0 AS rank_desc
    FROM salesman_stats
    ORDER BY due_count DESC
    LIMIT 20
  `;
}
