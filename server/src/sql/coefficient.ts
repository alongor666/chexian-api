/**
 * 商车自主定价系数监控 - SQL 生成器
 *
 * 核心计算逻辑：
 * NCD保费 = 保费 / 商车自主定价系数（仅限商业险）
 * 聚合商车自主定价系数均值 = 聚合保费 / 聚合NCD保费
 */

import { formatDate, getLastDayOfMonth, type DateRange } from '../utils/coefficient-period.js';
import { ORG_GROUPS } from '../config/coefficient-thresholds.js';

// 非营业个人客车的SQL条件
const NON_COMMERCIAL_PERSONAL_CONDITION = `customer_category LIKE '%非营业个人客车%'`;

// 商业险基础条件
const COMMERCIAL_BASE_CONDITION = `
  insurance_type = '商业保险'
  AND commercial_pricing_factor IS NOT NULL
  AND commercial_pricing_factor > 0
`;

/**
 * 缓存的机构分组CASE表达式
 * 使用惰性初始化，只在首次调用时计算一次
 */
let _cachedOrgGroupCase: string | null = null;

/**
 * 获取机构分组的CASE表达式（带缓存）
 *
 * 后端版本：使用运行时LIKE匹配计算region_group
 * （前端版本在视图创建时预计算，后端需要运行时计算）
 *
 * 性能优化：CASE表达式在模块加载后只计算一次并缓存
 */
function generateOrgGroupCase(): string {
  if (_cachedOrgGroupCase !== null) {
    return _cachedOrgGroupCase;
  }

  const sameCityConditions = ORG_GROUPS.SAME_CITY
    .map(city => `org_level_3 LIKE '%${city}%'`)
    .join(' OR ');
  const remoteConditions = ORG_GROUPS.REMOTE
    .map(city => `org_level_3 LIKE '%${city}%'`)
    .join(' OR ');

  _cachedOrgGroupCase = `CASE
    WHEN ${sameCityConditions} THEN 'chengdu'
    WHEN ${remoteConditions} THEN 'remote'
    ELSE 'other'
  END`;

  return _cachedOrgGroupCase;
}

/**
 * 生成客户类别分组的CASE表达式
 * 分为：非营业个人客车、全部
 * @internal 预留函数，未来扩展使用
 */
function _generateCustomerCategoryGroupCase(): string {
  return `
    CASE
      WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal'
      ELSE 'all'
    END
  `;
}

// 导出以避免 TS6133 未使用警告，但标记为内部使用
export { _generateCustomerCategoryGroupCase };

/**
 * 生成系数聚合查询 - 按三级机构明细
 *
 * @param dateField 日期字段名
 * @param dateRange 日期范围
 * @param additionalWhere 额外的WHERE条件
 */
export function generateCoefficientByOrgQuery(
  dateField: string,
  dateRange: DateRange,
  additionalWhere: string = '1=1'
): string {
  const startDate = formatDate(dateRange.start);
  const endDate = formatDate(dateRange.end);

  return `
    SELECT
      org_level_3,
      ${generateOrgGroupCase()} AS region_group,
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END AS customer_category_group,
      is_new_car,
      SUM(premium) AS total_premium,
      SUM(premium / commercial_pricing_factor) AS total_ncd_premium,
      SUM(premium) / NULLIF(SUM(premium / commercial_pricing_factor), 0) AS avg_factor,
      COUNT(DISTINCT policy_no) AS policy_count
    FROM PolicyFact
    WHERE ${COMMERCIAL_BASE_CONDITION}
      AND ${dateField} >= '${startDate}'
      AND ${dateField} <= '${endDate}'
      AND ${additionalWhere}
    GROUP BY
      org_level_3,
      ${generateOrgGroupCase()},
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END,
      is_new_car
  `;
}

/**
 * 生成成都聚合查询
 *
 * 【性能优化】使用预计算的region_group字段代替LIKE匹配
 *
 * @param dateField 日期字段名
 * @param dateRange 日期范围
 * @param additionalWhere 额外的WHERE条件
 */
export function generateChengduAggregateQuery(
  dateField: string,
  dateRange: DateRange,
  additionalWhere: string = '1=1'
): string {
  const startDate = formatDate(dateRange.start);
  const endDate = formatDate(dateRange.end);

  return `
    SELECT
      '成都' AS org_level_3,
      'chengdu' AS region_group,
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END AS customer_category_group,
      is_new_car,
      SUM(premium) AS total_premium,
      SUM(premium / commercial_pricing_factor) AS total_ncd_premium,
      SUM(premium) / NULLIF(SUM(premium / commercial_pricing_factor), 0) AS avg_factor,
      COUNT(DISTINCT policy_no) AS policy_count
    FROM PolicyFact
    WHERE ${COMMERCIAL_BASE_CONDITION}
      AND ${dateField} >= '${startDate}'
      AND ${dateField} <= '${endDate}'
      AND region_group = 'chengdu'
      AND ${additionalWhere}
    GROUP BY
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END,
      is_new_car
  `;
}

/**
 * 生成全省聚合查询
 *
 * @param dateField 日期字段名
 * @param dateRange 日期范围
 * @param additionalWhere 额外的WHERE条件
 */
export function generateProvinceAggregateQuery(
  dateField: string,
  dateRange: DateRange,
  additionalWhere: string = '1=1'
): string {
  const startDate = formatDate(dateRange.start);
  const endDate = formatDate(dateRange.end);

  return `
    SELECT
      '全省' AS org_level_3,
      'province' AS region_group,
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END AS customer_category_group,
      is_new_car,
      SUM(premium) AS total_premium,
      SUM(premium / commercial_pricing_factor) AS total_ncd_premium,
      SUM(premium) / NULLIF(SUM(premium / commercial_pricing_factor), 0) AS avg_factor,
      COUNT(DISTINCT policy_no) AS policy_count
    FROM PolicyFact
    WHERE ${COMMERCIAL_BASE_CONDITION}
      AND ${dateField} >= '${startDate}'
      AND ${dateField} <= '${endDate}'
      AND ${additionalWhere}
    GROUP BY
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END,
      is_new_car
  `;
}

/**
 * 生成完整的系数监控查询（合并成都、全省、各机构）
 *
 * 注意：由于不同维度组合可能有不同的周期计算方式，
 * 实际使用时需要分别查询各时间周期，然后在应用层合并。
 *
 * @param dateField 日期字段名
 * @param dateRange 日期范围
 * @param additionalWhere 额外的WHERE条件
 */
export function generateFullCoefficientQuery(
  dateField: string,
  dateRange: DateRange,
  additionalWhere: string = '1=1'
): string {
  return `
    WITH chengdu_data AS (
      ${generateChengduAggregateQuery(dateField, dateRange, additionalWhere)}
    ),
    province_data AS (
      ${generateProvinceAggregateQuery(dateField, dateRange, additionalWhere)}
    ),
    org_data AS (
      ${generateCoefficientByOrgQuery(dateField, dateRange, additionalWhere)}
    ),
    combined AS (
      SELECT * FROM chengdu_data
      UNION ALL
      SELECT * FROM province_data
      UNION ALL
      SELECT * FROM org_data
    )
    SELECT * FROM combined
    ORDER BY
      CASE
        WHEN org_level_3 = '成都' THEN 1
        WHEN org_level_3 = '全省' THEN 2
        ELSE 3
      END,
      org_level_3,
      is_nev DESC,
      customer_category_group,
      is_new_car
  `;
}

/**
 * 生成单一时间周期的系数查询
 *
 * @param dateField 日期字段名
 * @param dateRange 日期范围
 * @param periodName 周期名称（用于字段命名）
 * @param additionalWhere 额外的WHERE条件
 */
export function generatePeriodCoefficientQuery(
  dateField: string,
  dateRange: DateRange,
  periodName: 'day' | 'week' | 'month' | 'year',
  additionalWhere: string = '1=1'
): string {
  const startDate = formatDate(dateRange.start);
  const endDate = formatDate(dateRange.end);
  const factorAlias = `${periodName}_factor`;
  const premiumAlias = `${periodName}_premium`;
  const countAlias = `${periodName}_count`;

  return `
    SELECT
      org_level_3,
      ${generateOrgGroupCase()} AS region_group,
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END AS customer_category_group,
      is_new_car,
      SUM(premium) / NULLIF(SUM(premium / commercial_pricing_factor), 0) AS ${factorAlias},
      SUM(premium) AS ${premiumAlias},
      COUNT(DISTINCT policy_no) AS ${countAlias}
    FROM PolicyFact
    WHERE ${COMMERCIAL_BASE_CONDITION}
      AND ${dateField} >= '${startDate}'
      AND ${dateField} <= '${endDate}'
      AND ${additionalWhere}
    GROUP BY
      org_level_3,
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END,
      is_new_car
  `;
}

/**
 * 生成聚合（成都/全省）的单一时间周期系数查询
 *
 * 【性能优化】使用预计算的region_group字段代替LIKE匹配
 *
 * @param groupByNewCar 是否按新旧车维度分组（false=整体不分新旧）
 */
export function generateAggregatePeriodCoefficientQuery(
  dateField: string,
  dateRange: DateRange,
  aggregateType: 'chengdu' | 'province',
  periodName: 'day' | 'week' | 'month' | 'year',
  additionalWhere: string = '1=1',
  groupByNewCar: boolean = true
): string {
  const startDate = formatDate(dateRange.start);
  const endDate = formatDate(dateRange.end);
  const factorAlias = `${periodName}_factor`;
  const premiumAlias = `${periodName}_premium`;
  const countAlias = `${periodName}_count`;

  let orgFilter = '';
  let orgLabel = '';
  let regionGroupValue = '';

  if (aggregateType === 'chengdu') {
    orgFilter = `AND region_group = 'chengdu'`;
    orgLabel = '成都';
    regionGroupValue = 'chengdu';
  } else {
    orgFilter = '';
    orgLabel = '全省';
    regionGroupValue = 'province';
  }

  const isNewCarSelect = groupByNewCar ? 'is_new_car' : 'NULL AS is_new_car';
  const groupByNewCarSql = groupByNewCar ? ',\n      is_new_car' : '';

  return `
    SELECT
      '${orgLabel}' AS org_level_3,
      '${regionGroupValue}' AS region_group,
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END AS customer_category_group,
      ${isNewCarSelect},
      SUM(premium) / NULLIF(SUM(premium / commercial_pricing_factor), 0) AS ${factorAlias},
      SUM(premium) AS ${premiumAlias},
      COUNT(DISTINCT policy_no) AS ${countAlias}
    FROM PolicyFact
    WHERE ${COMMERCIAL_BASE_CONDITION}
      AND ${dateField} >= '${startDate}'
      AND ${dateField} <= '${endDate}'
      ${orgFilter}
      AND ${additionalWhere}
    GROUP BY
      is_nev,
      CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END${groupByNewCarSql}
  `;
}

/**
 * 4个周期定义（用于批量查询）
 */
export interface PeriodDefinition {
  name: string;
  start: number;
  end: number;
}

/**
 * 获取当月的4个周期定义
 *
 * @param year 年份
 * @param month 月份（0-11）
 * @returns 4个周期的定义数组
 */
export function getMonthPeriods(year: number, month: number): PeriodDefinition[] {
  const lastDay = getLastDayOfMonth(year, month);
  return [
    { name: '1-7日', start: 1, end: 7 },
    { name: '8-14日', start: 8, end: 14 },
    { name: '15-21日', start: 15, end: 21 },
    { name: `22-${lastDay}日`, start: 22, end: lastDay },
  ];
}

/**
 * 生成所有周数据的 UNION ALL 批量查询
 *
 * 优化点：
 * 1. 将N+1查询合并为单次 UNION ALL 查询
 * 2. 在SQL层直接按4个周期分组（1-7日、8-14日、15-21日、22-月末）
 * 3. 同时查询成都聚合、全省聚合、各机构明细
 * 4. 返回 period_name 字段供应用层分组
 *
 * @param dateField 日期字段名（policy_date 或 insurance_start_date）
 * @param cutoffDate 截止日期（用于确定月份）
 * @param additionalWhere 额外的 WHERE 条件
 * @returns 完整的 UNION ALL SQL 查询
 */
export function generateWeekBatchQuery(
  dateField: string,
  cutoffDate: Date,
  additionalWhere: string = '1=1'
): string {
  const year = cutoffDate.getFullYear();
  const month = cutoffDate.getMonth();
  const periods = getMonthPeriods(year, month);

  // 【性能优化】使用预计算的region_group字段，无需LIKE匹配
  // 生成单个周期的查询（参数化）
  const generatePeriodSubquery = (
    periodName: string,
    startDate: string,
    endDate: string,
    aggregateType: 'chengdu' | 'province' | 'org'
  ): string => {
    let orgFilter = '';
    let orgLabel = '';
    let regionGroupValue = '';
    let groupByOrg = false;

    if (aggregateType === 'chengdu') {
      orgFilter = `AND region_group = 'chengdu'`;
      orgLabel = '成都';
      regionGroupValue = 'chengdu';
    } else if (aggregateType === 'province') {
      orgFilter = '';
      orgLabel = '全省';
      regionGroupValue = 'province';
    } else {
      // org: 各机构明细
      orgFilter = '';
      groupByOrg = true;
    }

    // SELECT 子句
    const selectClause = aggregateType === 'org'
      ? `
        org_level_3,
        region_group`
      : `
        '${orgLabel}' AS org_level_3,
        '${regionGroupValue}' AS region_group`;

    // GROUP BY 子句
    const groupByClause = groupByOrg
      ? `GROUP BY
          org_level_3,
          region_group,
          is_nev,
          CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END,
          is_new_car`
      : `GROUP BY
          is_nev,
          CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END,
          is_new_car`;

    return `
      SELECT
        '${periodName}' AS period_name,
        ${selectClause},
        is_nev,
        CASE WHEN ${NON_COMMERCIAL_PERSONAL_CONDITION} THEN 'non_commercial_personal' ELSE 'all' END AS customer_category_group,
        is_new_car,
        SUM(premium) AS week_premium,
        SUM(premium) / NULLIF(SUM(premium / commercial_pricing_factor), 0) AS week_factor,
        COUNT(DISTINCT policy_no) AS week_count
      FROM PolicyFact
      WHERE ${COMMERCIAL_BASE_CONDITION}
        AND ${dateField} >= '${startDate}'
        AND ${dateField} <= '${endDate}'
        ${orgFilter}
        AND ${additionalWhere}
      ${groupByClause}
    `;
  };

  // 生成所有 UNION 子查询
  const unionParts: string[] = [];

  for (const period of periods) {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(period.start).padStart(2, '0')}`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(period.end).padStart(2, '0')}`;

    // 成都聚合
    unionParts.push(generatePeriodSubquery(period.name, startDate, endDate, 'chengdu'));

    // 全省聚合
    unionParts.push(generatePeriodSubquery(period.name, startDate, endDate, 'province'));

    // 各机构明细
    unionParts.push(generatePeriodSubquery(period.name, startDate, endDate, 'org'));
  }

  return `
    WITH week_batch_data AS (
      ${unionParts.join('\n      UNION ALL\n      ')}
    )
    SELECT * FROM week_batch_data
    ORDER BY
      period_name,
      CASE org_level_3
        WHEN '成都' THEN 1
        WHEN '全省' THEN 2
        ELSE 3
      END,
      org_level_3,
      is_nev DESC,
      customer_category_group,
      is_new_car
  `;
}
