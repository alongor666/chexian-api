/**
 * 商车自主定价系数监控 - SQL 生成器
 *
 * 核心计算逻辑：
 * NCD保费 = 保费 / 商车自主定价系数（仅限商业险）
 * 聚合商车自主定价系数均值 = 聚合保费 / 聚合NCD保费
 */

import { formatDate, getLastDayOfMonth, type DateRange } from '../utils/coefficient-period';
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
 * 生成完整的系数监控批量查询（性能优化 - 一次性获取所有周期数据）
 *
 * 优化点：
 * 1. 将 18+ 次独立查询合并为单次 UNION ALL 查询
 * 2. 包含所有时间周期：day/week(4个)/month/year
 * 3. 包含所有聚合类型：org/chengdu/province
 * 4. 返回 period_type 和 aggregate_type 字段供应用层分组
 *
 * @param dateField 日期字段名（policy_date 或 insurance_start_date）
 * @param cutoffDate 截止日期
 * @param analysisYear 分析年度
 * @param additionalWhere 额外的 WHERE 条件
 * @returns 完整的 UNION ALL SQL 查询
 */
/**
 * 【性能优化核心】生成批量系数查询SQL
 *
 * 优化策略：使用预聚合表 + CTE上卷
 * - 原方案：扫描几十万行原始数据
 * - 新方案：扫描~3万行预聚合数据（CoefficientDailyAgg）
 *
 * 预期性能提升：50-100倍
 */
export function generateFullBatchQuery(
  _dateField: string, // 保留参数以兼容API，预聚合表统一使用agg_date(=policy_date)
  cutoffDate: Date,
  analysisYear: number,
  additionalWhere: string = '1=1'
): string {
  const year = cutoffDate.getFullYear();
  const month = cutoffDate.getMonth();
  const lastDay = getLastDayOfMonth(year, month);

  // 日期格式化
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(month + 1);

  // 各周期日期范围
  const dayDate = `${year}-${monthStr}-${pad(cutoffDate.getDate())}`;
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd = `${year}-${monthStr}-${pad(lastDay)}`;
  const yearStart = `${analysisYear}-01-01`;

  // 4个周内周期的日期边界
  const week1End = `${year}-${monthStr}-07`;
  const week2Start = `${year}-${monthStr}-08`;
  const week2End = `${year}-${monthStr}-14`;
  const week3Start = `${year}-${monthStr}-15`;
  const week3End = `${year}-${monthStr}-21`;
  const week4Start = `${year}-${monthStr}-22`;
  const week4End = monthEnd;

  // 周期名称
  const week1Name = '1-7日';
  const week2Name = '8-14日';
  const week3Name = '15-21日';
  const week4Name = `22-${lastDay}日`;

  // 处理additionalWhere - 将PolicyFact字段名映射到预聚合表字段名
  // 预聚合表已经完成了customer_category的分组，所以需要转换条件
  const processedWhere = additionalWhere === '1=1' ? '1=1' :
    additionalWhere
      .replace(/customer_category\s+LIKE\s+'%非营业个人客车%'/gi, "customer_category_group = 'non_commercial_personal'")
      .replace(/customer_category/gi, 'customer_category_group');

  return `
    WITH
    -- ========== 第1层：从预聚合表读取并计算所有周期指标 ==========
    -- 【性能优化】使用 CoefficientDailyAgg 预聚合表，数据量从几十万行降至~3万行
    base_aggregations AS (
      SELECT
        org_level_3,
        region_group,
        is_nev,
        customer_category_group,
        is_new_car,

        -- 当天指标
        SUM(CASE WHEN agg_date = '${dayDate}' THEN total_premium ELSE 0 END) AS day_premium,
        SUM(CASE WHEN agg_date = '${dayDate}' THEN total_ncd_premium ELSE 0 END) AS day_ncd_premium,
        SUM(CASE WHEN agg_date = '${dayDate}' THEN policy_count ELSE 0 END) AS day_count,

        -- 当月指标
        SUM(CASE WHEN agg_date >= '${monthStart}' AND agg_date <= '${monthEnd}' THEN total_premium ELSE 0 END) AS month_premium,
        SUM(CASE WHEN agg_date >= '${monthStart}' AND agg_date <= '${monthEnd}' THEN total_ncd_premium ELSE 0 END) AS month_ncd_premium,
        SUM(CASE WHEN agg_date >= '${monthStart}' AND agg_date <= '${monthEnd}' THEN policy_count ELSE 0 END) AS month_count,

        -- 当年指标
        SUM(total_premium) AS year_premium,
        SUM(total_ncd_premium) AS year_ncd_premium,
        SUM(policy_count) AS year_count,

        -- 周1-7日
        SUM(CASE WHEN agg_date >= '${monthStart}' AND agg_date <= '${week1End}' THEN total_premium ELSE 0 END) AS week1_premium,
        SUM(CASE WHEN agg_date >= '${monthStart}' AND agg_date <= '${week1End}' THEN total_ncd_premium ELSE 0 END) AS week1_ncd_premium,
        SUM(CASE WHEN agg_date >= '${monthStart}' AND agg_date <= '${week1End}' THEN policy_count ELSE 0 END) AS week1_count,

        -- 周8-14日
        SUM(CASE WHEN agg_date >= '${week2Start}' AND agg_date <= '${week2End}' THEN total_premium ELSE 0 END) AS week2_premium,
        SUM(CASE WHEN agg_date >= '${week2Start}' AND agg_date <= '${week2End}' THEN total_ncd_premium ELSE 0 END) AS week2_ncd_premium,
        SUM(CASE WHEN agg_date >= '${week2Start}' AND agg_date <= '${week2End}' THEN policy_count ELSE 0 END) AS week2_count,

        -- 周15-21日
        SUM(CASE WHEN agg_date >= '${week3Start}' AND agg_date <= '${week3End}' THEN total_premium ELSE 0 END) AS week3_premium,
        SUM(CASE WHEN agg_date >= '${week3Start}' AND agg_date <= '${week3End}' THEN total_ncd_premium ELSE 0 END) AS week3_ncd_premium,
        SUM(CASE WHEN agg_date >= '${week3Start}' AND agg_date <= '${week3End}' THEN policy_count ELSE 0 END) AS week3_count,

        -- 周22-月末
        SUM(CASE WHEN agg_date >= '${week4Start}' AND agg_date <= '${week4End}' THEN total_premium ELSE 0 END) AS week4_premium,
        SUM(CASE WHEN agg_date >= '${week4Start}' AND agg_date <= '${week4End}' THEN total_ncd_premium ELSE 0 END) AS week4_ncd_premium,
        SUM(CASE WHEN agg_date >= '${week4Start}' AND agg_date <= '${week4End}' THEN policy_count ELSE 0 END) AS week4_count

      FROM CoefficientDailyAgg
      WHERE agg_date >= '${yearStart}'
        AND agg_date <= '${dayDate}'
        AND ${processedWhere}
      GROUP BY
        org_level_3,
        region_group,
        is_nev,
        customer_category_group,
        is_new_car
    ),

    -- ========== 第2层：成都聚合（region_group = 'chengdu'） ==========
    chengdu_agg AS (
      SELECT
        '成都' AS org_level_3,
        'chengdu' AS region_group,
        is_nev,
        customer_category_group,
        is_new_car,
        SUM(day_premium) AS day_premium, SUM(day_ncd_premium) AS day_ncd_premium, SUM(day_count) AS day_count,
        SUM(month_premium) AS month_premium, SUM(month_ncd_premium) AS month_ncd_premium, SUM(month_count) AS month_count,
        SUM(year_premium) AS year_premium, SUM(year_ncd_premium) AS year_ncd_premium, SUM(year_count) AS year_count,
        SUM(week1_premium) AS week1_premium, SUM(week1_ncd_premium) AS week1_ncd_premium, SUM(week1_count) AS week1_count,
        SUM(week2_premium) AS week2_premium, SUM(week2_ncd_premium) AS week2_ncd_premium, SUM(week2_count) AS week2_count,
        SUM(week3_premium) AS week3_premium, SUM(week3_ncd_premium) AS week3_ncd_premium, SUM(week3_count) AS week3_count,
        SUM(week4_premium) AS week4_premium, SUM(week4_ncd_premium) AS week4_ncd_premium, SUM(week4_count) AS week4_count
      FROM base_aggregations
      WHERE region_group = 'chengdu'
      GROUP BY is_nev, customer_category_group, is_new_car
    ),

    -- ========== 第3层：异地聚合（region_group = 'remote'） ==========
    remote_agg AS (
      SELECT
        '异地' AS org_level_3,
        'remote' AS region_group,
        is_nev,
        customer_category_group,
        is_new_car,
        SUM(day_premium) AS day_premium, SUM(day_ncd_premium) AS day_ncd_premium, SUM(day_count) AS day_count,
        SUM(month_premium) AS month_premium, SUM(month_ncd_premium) AS month_ncd_premium, SUM(month_count) AS month_count,
        SUM(year_premium) AS year_premium, SUM(year_ncd_premium) AS year_ncd_premium, SUM(year_count) AS year_count,
        SUM(week1_premium) AS week1_premium, SUM(week1_ncd_premium) AS week1_ncd_premium, SUM(week1_count) AS week1_count,
        SUM(week2_premium) AS week2_premium, SUM(week2_ncd_premium) AS week2_ncd_premium, SUM(week2_count) AS week2_count,
        SUM(week3_premium) AS week3_premium, SUM(week3_ncd_premium) AS week3_ncd_premium, SUM(week3_count) AS week3_count,
        SUM(week4_premium) AS week4_premium, SUM(week4_ncd_premium) AS week4_ncd_premium, SUM(week4_count) AS week4_count
      FROM base_aggregations
      WHERE region_group = 'remote'
      GROUP BY is_nev, customer_category_group, is_new_car
    ),

    -- ========== 第4层：全省聚合（分新旧车） ==========
    province_agg AS (
      SELECT
        '全省' AS org_level_3,
        'province' AS region_group,
        is_nev,
        customer_category_group,
        is_new_car,
        SUM(day_premium) AS day_premium, SUM(day_ncd_premium) AS day_ncd_premium, SUM(day_count) AS day_count,
        SUM(month_premium) AS month_premium, SUM(month_ncd_premium) AS month_ncd_premium, SUM(month_count) AS month_count,
        SUM(year_premium) AS year_premium, SUM(year_ncd_premium) AS year_ncd_premium, SUM(year_count) AS year_count,
        SUM(week1_premium) AS week1_premium, SUM(week1_ncd_premium) AS week1_ncd_premium, SUM(week1_count) AS week1_count,
        SUM(week2_premium) AS week2_premium, SUM(week2_ncd_premium) AS week2_ncd_premium, SUM(week2_count) AS week2_count,
        SUM(week3_premium) AS week3_premium, SUM(week3_ncd_premium) AS week3_ncd_premium, SUM(week3_count) AS week3_count,
        SUM(week4_premium) AS week4_premium, SUM(week4_ncd_premium) AS week4_ncd_premium, SUM(week4_count) AS week4_count
      FROM base_aggregations
      GROUP BY is_nev, customer_category_group, is_new_car
    ),

    -- ========== 第5层：全省整体（不分新旧车） ==========
    province_overall AS (
      SELECT
        '全省' AS org_level_3,
        'province' AS region_group,
        is_nev,
        customer_category_group,
        NULL AS is_new_car,
        SUM(day_premium) AS day_premium, SUM(day_ncd_premium) AS day_ncd_premium, SUM(day_count) AS day_count,
        SUM(month_premium) AS month_premium, SUM(month_ncd_premium) AS month_ncd_premium, SUM(month_count) AS month_count,
        SUM(year_premium) AS year_premium, SUM(year_ncd_premium) AS year_ncd_premium, SUM(year_count) AS year_count,
        SUM(week1_premium) AS week1_premium, SUM(week1_ncd_premium) AS week1_ncd_premium, SUM(week1_count) AS week1_count,
        SUM(week2_premium) AS week2_premium, SUM(week2_ncd_premium) AS week2_ncd_premium, SUM(week2_count) AS week2_count,
        SUM(week3_premium) AS week3_premium, SUM(week3_ncd_premium) AS week3_ncd_premium, SUM(week3_count) AS week3_count,
        SUM(week4_premium) AS week4_premium, SUM(week4_ncd_premium) AS week4_ncd_premium, SUM(week4_count) AS week4_count
      FROM base_aggregations
      GROUP BY is_nev, customer_category_group
    ),

    -- ========== 合并所有聚合结果 ==========
    all_aggregations AS (
      SELECT 'org' AS aggregate_type, * FROM base_aggregations
      UNION ALL
      SELECT 'chengdu' AS aggregate_type, * FROM chengdu_agg
      UNION ALL
      SELECT 'remote' AS aggregate_type, * FROM remote_agg
      UNION ALL
      SELECT 'province' AS aggregate_type, * FROM province_agg
      UNION ALL
      SELECT 'province' AS aggregate_type, * FROM province_overall
    ),

    -- ========== 展开为period_type行格式（兼容原有数据结构） ==========
    expanded_data AS (
      -- Day
      SELECT 'day' AS period_type, 'day' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             day_premium AS total_premium, day_ncd_premium AS total_ncd_premium,
             day_premium / NULLIF(day_ncd_premium, 0) AS avg_factor, day_count AS policy_count
      FROM all_aggregations WHERE day_count > 0

      UNION ALL
      -- Month
      SELECT 'month' AS period_type, 'month' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             month_premium AS total_premium, month_ncd_premium AS total_ncd_premium,
             month_premium / NULLIF(month_ncd_premium, 0) AS avg_factor, month_count AS policy_count
      FROM all_aggregations WHERE month_count > 0

      UNION ALL
      -- Year
      SELECT 'year' AS period_type, 'year' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             year_premium AS total_premium, year_ncd_premium AS total_ncd_premium,
             year_premium / NULLIF(year_ncd_premium, 0) AS avg_factor, year_count AS policy_count
      FROM all_aggregations WHERE year_count > 0

      UNION ALL
      -- Week 1-7日
      SELECT 'week' AS period_type, '${week1Name}' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             week1_premium AS total_premium, week1_ncd_premium AS total_ncd_premium,
             week1_premium / NULLIF(week1_ncd_premium, 0) AS avg_factor, week1_count AS policy_count
      FROM all_aggregations WHERE week1_count > 0

      UNION ALL
      -- Week 8-14日
      SELECT 'week' AS period_type, '${week2Name}' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             week2_premium AS total_premium, week2_ncd_premium AS total_ncd_premium,
             week2_premium / NULLIF(week2_ncd_premium, 0) AS avg_factor, week2_count AS policy_count
      FROM all_aggregations WHERE week2_count > 0

      UNION ALL
      -- Week 15-21日
      SELECT 'week' AS period_type, '${week3Name}' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             week3_premium AS total_premium, week3_ncd_premium AS total_ncd_premium,
             week3_premium / NULLIF(week3_ncd_premium, 0) AS avg_factor, week3_count AS policy_count
      FROM all_aggregations WHERE week3_count > 0

      UNION ALL
      -- Week 22-月末
      SELECT 'week' AS period_type, '${week4Name}' AS period_name, aggregate_type, org_level_3, region_group,
             is_nev, customer_category_group, is_new_car,
             week4_premium AS total_premium, week4_ncd_premium AS total_ncd_premium,
             week4_premium / NULLIF(week4_ncd_premium, 0) AS avg_factor, week4_count AS policy_count
      FROM all_aggregations WHERE week4_count > 0
    )

    SELECT * FROM expanded_data
    ORDER BY
      CASE period_type WHEN 'day' THEN 1 WHEN 'week' THEN 2 WHEN 'month' THEN 3 WHEN 'year' THEN 4 END,
      period_name,
      CASE aggregate_type WHEN 'chengdu' THEN 1 WHEN 'remote' THEN 2 WHEN 'province' THEN 3 ELSE 4 END,
      org_level_3,
      is_nev DESC,
      customer_category_group,
      is_new_car
  `;
}

/**
 * 生成所有周数据的 UNION ALL 批量查询（性能优化核心）
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
