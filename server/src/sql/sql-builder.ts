/**
 * SQL 查询构建器 — 封装重复的 WHERE/GROUP BY/ORDER BY 模式
 *
 * 适用于 cost.ts / kpi.ts / trend.ts / growth.ts 等 SQL 生成器中
 * 反复出现的 SELECT ... FROM ... WHERE ... GROUP BY ... ORDER BY 样板代码。
 *
 * 设计原则：
 * - 不替代现有 SQL 生成器，而是作为底层工具被它们调用
 * - 不做值转义（调用方自行负责安全）
 * - 保持轻量，无外部依赖
 */

/**
 * 流式 SQL 查询构建器
 *
 * @example
 * ```ts
 * const sql = SqlBuilder.from('PolicyFact')
 *   .select('org_level_3', 'SUM(premium) AS total')
 *   .where("insurance_type = '商业保险'")
 *   .groupBy('org_level_3')
 *   .orderBy('total', 'DESC')
 *   .limit(20)
 *   .build();
 * ```
 */
export class SqlBuilder {
  private selectCols: string[] = [];
  private fromTable = 'PolicyFact';
  private wheres: string[] = [];
  private groups: string[] = [];
  private orders: string[] = [];
  private havings: string[] = [];
  private limitVal?: number;

  /** 创建一个以指定表为起点的构建器 */
  static from(table: string): SqlBuilder {
    return new SqlBuilder().setFrom(table);
  }

  /** 添加 SELECT 列 */
  select(...cols: string[]): this {
    this.selectCols.push(...cols);
    return this;
  }

  /** 设置 FROM 表名 */
  setFrom(table: string): this {
    this.fromTable = table;
    return this;
  }

  /** 添加 WHERE 条件（自动跳过空字符串和 '1=1'） */
  where(condition: string): this {
    if (condition && condition !== '1=1') this.wheres.push(condition);
    return this;
  }

  /** 添加 GROUP BY 列 */
  groupBy(...cols: string[]): this {
    this.groups.push(...cols);
    return this;
  }

  /** 添加 ORDER BY 列 */
  orderBy(col: string, dir: 'ASC' | 'DESC' = 'ASC'): this {
    this.orders.push(`${col} ${dir}`);
    return this;
  }

  /** 添加 HAVING 条件 */
  having(condition: string): this {
    this.havings.push(condition);
    return this;
  }

  /** 设置 LIMIT */
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  /** 仅构建 WHERE 子句（含 WHERE 关键字），无条件时返回空字符串 */
  buildWhere(): string {
    return this.wheres.length > 0 ? `WHERE ${this.wheres.join(' AND ')}` : '';
  }

  /** 仅构建 GROUP BY 子句 */
  buildGroupBy(): string {
    return this.groups.length > 0 ? `GROUP BY ${this.groups.join(', ')}` : '';
  }

  /** 仅构建 ORDER BY 子句 */
  buildOrderBy(): string {
    return this.orders.length > 0 ? `ORDER BY ${this.orders.join(', ')}` : '';
  }

  /** 构建完整 SQL 语句 */
  build(): string {
    const parts = [
      `SELECT ${this.selectCols.join(',\n  ')}`,
      `FROM ${this.fromTable}`,
      this.buildWhere(),
      this.buildGroupBy(),
      this.havings.length > 0 ? `HAVING ${this.havings.join(' AND ')}` : '',
      this.buildOrderBy(),
      this.limitVal ? `LIMIT ${this.limitVal}` : '',
    ];
    return parts.filter(Boolean).join('\n');
  }
}

// ==================== 常用 WHERE 条件构建器 ====================

/**
 * 生成日期范围条件（含 CAST）
 *
 * @example dateRangeCondition('insurance_start_date', '2025-01-01', '2025-12-31')
 * // → "CAST(insurance_start_date AS DATE) >= '2025-01-01' AND CAST(insurance_start_date AS DATE) <= '2025-12-31'"
 */
export function dateRangeCondition(field: string, start: string, end: string): string {
  return `CAST(${field} AS DATE) >= '${start}' AND CAST(${field} AS DATE) <= '${end}'`;
}

/**
 * 生成月份匹配条件
 *
 * @example monthCondition('insurance_start_date', '2025-03')
 * // → "STRFTIME(CAST(insurance_start_date AS DATE), '%Y-%m') = '2025-03'"
 */
export function monthCondition(field: string, yearMonth: string): string {
  return `STRFTIME(CAST(${field} AS DATE), '%Y-%m') = '${yearMonth}'`;
}

// ==================== 成本分析专用辅助 ====================

/**
 * 维度字段 → dim_key SQL 表达式
 * 单维度直接 COALESCE，多维度用 ' - ' 连接
 */
export function buildDimKeyExpression(groupByFields: string[]): string {
  return groupByFields.length === 1
    ? `COALESCE(${groupByFields[0]}, '未知')`
    : groupByFields.map((f) => `COALESCE(${f}, '未知')`).join(" || ' - ' || ");
}

/**
 * 生成 policy_exposure CTE 的 SQL 片段（成本分析共用）
 *
 * 四个成本维度查询（claim / expense / comprehensive / variable）中的三个
 * 共享相同的 CTE 结构；此函数提取该公共部分。
 *
 * @param groupByFields - 分组字段数组
 * @param cutoffDate - 统计截止日期
 * @param whereClause - WHERE 条件
 * @param extraFields - 额外需要 SELECT 的字段（如 fee_amount）
 */
export function buildPolicyExposureCTE(
  groupByFields: string[],
  cutoffDate: string,
  whereClause: string,
  extraFields: string[] = []
): string {
  const extraFieldsClause = extraFields.length > 0
    ? ',\n    ' + extraFields.join(',\n    ')
    : '';

  return `
WITH policy_exposure AS (
  SELECT
    p.policy_no,
    ${groupByFields.map((f) => `p.${f}`).join(', ')},
    p.premium,
    p.insurance_start_date AS start_date,
    DATEDIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR) AS policy_term,
    -- earned_days +1：含起保当天（与 cost-ratios.ts / 行 235/294 已有 +1 口径统一）
    LEAST(
      GREATEST(
        DATEDIFF('day', CAST(p.insurance_start_date AS DATE), DATE '${cutoffDate}') + 1,
        0
      ),
      DATEDIFF('day', CAST(p.insurance_start_date AS DATE), CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR)
    ) AS earned_days,
    COALESCE(c.claim_cases, 0) AS claim_cases,
    COALESCE(c.reported_claims, 0) AS reported_claims${extraFieldsClause}
  FROM PolicyFact p
  LEFT JOIN ClaimsAgg c ON p.policy_no = c.policy_no
  WHERE ${whereClause}
    AND p.insurance_start_date IS NOT NULL
)`;
}

/**
 * 已赚保费期间查询配置
 *
 * 用于将 generatePolicy2025In2025Query / generatePolicy2025In2026Query /
 * generatePolicy2026In2026Query / generatePolicy2026In2027Query
 * 四个近乎相同的函数合并为一个参数化函数。
 */
export interface EarnedPremiumPeriodConfig {
  /** 保单年份（保单起保年份筛选条件） */
  policyYear: number;
  /** 已赚计算的目标年份 */
  earnedYear: number;
  /** 是否是同年（保单年 == 已赚年），决定是否包含首日费用和保费列 */
  isSameYear: boolean;
  /** WHERE 条件 */
  whereClause: string;
}

// ==================== 已赚保费期间查询 辅助函数 ====================

/**
 * 获取月末日期
 * @param year 年份
 * @param month 月份（1-12）
 */
export function getMonthEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * 计算某保单在指定统计月末的时间分摊部分
 * 时间分摊 = P × (1-F) × min(有效天数, policy_term) / policy_term
 * 分母改为 policy_term = DATEDIFF(起期, 起期+1年)，闰年感知（365/366）。
 *
 * @param statMonthEnd - 统计月末日期，格式 YYYY-MM-DD
 */
export function buildTimePartCase(statMonthEnd: string): string {
  return `
    CASE
      WHEN CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
      THEN premium * (1 - fee_rate) * LEAST(
        GREATEST(
          DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1,
          0
        ),
        DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
      ) * 1.0 / DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
      ELSE 0
    END
  `;
}

/**
 * 计算保单在指定统计月的已赚保费（月度增量）
 * - 起保月：首日费用 + 时间分摊增量
 * - 非起保月：仅时间分摊增量
 *
 * @param statMonth - 统计月份（1-12）
 * @param statYear - 统计年份
 * @param prevMonthEnd - 上月末日期（1月时为 null）
 * @param currentMonthEnd - 当月末日期
 */
export function buildEarnedMonthlyCase(
  statMonth: number,
  statYear: number,
  prevMonthEnd: string | null,
  currentMonthEnd: string
): string {
  const timePartCurrent = buildTimePartCase(currentMonthEnd);
  const timePartPrev = prevMonthEnd ? buildTimePartCase(prevMonthEnd) : '0';
  const timePartIncrement = `(${timePartCurrent}) - (${timePartPrev})`;

  return `
    CASE
      WHEN EXTRACT(MONTH FROM start_date) = ${statMonth}
       AND EXTRACT(YEAR FROM start_date) = ${statYear}
      THEN premium * fee_rate * line_factor + ${timePartIncrement}
      ELSE ${timePartIncrement}
    END
  `;
}

/**
 * 计算某保单在指定统计月末的已赚保费（首日费用 + 时间分摊）
 * 已赚保费 = P × F × α + P × (1-F) × min(有效天数, policy_term) / policy_term
 * 分母改为 policy_term = DATEDIFF(起期, 起期+1年)，闰年感知（365/366）。
 *
 * 与 buildTimePartCase 的区别：本函数包含首日费用部分。
 *
 * @param statMonthEnd - 统计月末日期，格式 YYYY-MM-DD
 */
export function buildEarnedPremiumCase(statMonthEnd: string): string {
  return `
    CASE
      WHEN CAST(insurance_start_date AS DATE) <= DATE '${statMonthEnd}'
      THEN
        -- 首日费用部分 = P × F × α
        premium * fee_rate * line_factor +
        -- 时间分摊部分 = P × (1-F) × min(有效天数, policy_term) / policy_term
        premium * (1 - fee_rate) * LEAST(
          GREATEST(
            DATEDIFF('day', CAST(insurance_start_date AS DATE), DATE '${statMonthEnd}') + 1,
            0
          ),
          DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
        ) * 1.0 / DATEDIFF('day', CAST(insurance_start_date AS DATE), CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR)
      ELSE 0
    END
  `;
}

/**
 * 生成已赚保费期间查询SQL（参数化版本）
 *
 * 将 generatePolicy2025In2025Query / generatePolicy2025In2026Query /
 * generatePolicy2026In2026Query / generatePolicy2026In2027Query
 * 四个近乎相同的函数统一为一个参数化函数。
 *
 * - isSameYear=true（保单年==已赚年）：包含 premium、first_day_fee 列，
 *   月度字段使用 buildEarnedMonthlyCase（含首日费用）
 * - isSameYear=false（已赚年=保单年+1）：不含 premium/first_day_fee，
 *   月度字段仅计算时间分摊增量
 *
 * @param config - 已赚保费期间查询配置
 * @returns SQL 查询字符串
 */
export function generateEarnedPremiumPeriodQuery(config: EarnedPremiumPeriodConfig): string {
  const { policyYear, earnedYear, isSameYear, whereClause } = config;

  const earnedMonthlyFields: string[] = [];

  if (isSameYear) {
    // 同年：月度字段含首日费用（buildEarnedMonthlyCase）
    for (let m = 1; m <= 12; m++) {
      const currentMonthEnd = getMonthEndDate(earnedYear, m);
      const prevMonthEnd = m === 1 ? null : getMonthEndDate(earnedYear, m - 1);
      earnedMonthlyFields.push(
        `ROUND(SUM(${buildEarnedMonthlyCase(m, earnedYear, prevMonthEnd, currentMonthEnd).trim()}), 2) AS earned_${earnedYear}_${String(m).padStart(2, '0')}`
      );
    }
  } else {
    // 跨年：月度字段仅时间分摊增量
    const prevYear = earnedYear - 1;
    for (let m = 1; m <= 12; m++) {
      const currentMonthEnd = getMonthEndDate(earnedYear, m);
      const prevMonthEnd = m === 1 ? getMonthEndDate(prevYear, 12) : getMonthEndDate(earnedYear, m - 1);
      earnedMonthlyFields.push(
        `ROUND(SUM(${buildTimePartCase(currentMonthEnd).trim()}) - SUM(${buildTimePartCase(prevMonthEnd).trim()}), 2) AS earned_${earnedYear}_${String(m).padStart(2, '0')}`
      );
    }
  }

  // 年度合计列
  let totalField: string;
  if (isSameYear) {
    totalField = `ROUND(
    SUM(premium * fee_rate * line_factor) +
    SUM(${buildTimePartCase(getMonthEndDate(earnedYear, 12)).trim()}),
    2
  ) AS earned_${earnedYear}_total`;
  } else {
    const prevYear = earnedYear - 1;
    totalField = `ROUND(
    SUM(${buildTimePartCase(getMonthEndDate(earnedYear, 12)).trim()}) -
    SUM(${buildTimePartCase(getMonthEndDate(prevYear, 12)).trim()}),
    2
  ) AS earned_${earnedYear}_total`;
  }

  // 额外同年列（premium, first_day_fee）
  const sameYearExtraCols = isSameYear
    ? `ROUND(SUM(premium), 2) AS premium,
  -- 首日费用（在起保年度计入）
  ROUND(SUM(premium * fee_rate * line_factor), 2) AS first_day_fee,
  `
    : '';

  return `
WITH policy_base AS (
  SELECT
    policy_no,
    premium,
    COALESCE(fee_amount, 0) AS fee_amount,
    CAST(insurance_start_date AS DATE) AS start_date,
    EXTRACT(MONTH FROM CAST(insurance_start_date AS DATE)) AS policy_month,
    -- 费用率 F
    CASE WHEN premium > 0 THEN COALESCE(fee_amount, 0) / premium ELSE 0 END AS fee_rate,
    -- 险类系数 α
    CASE insurance_type
      WHEN '交强险' THEN 0.82
      WHEN '商业保险' THEN 0.94
      ELSE 0.90
    END AS line_factor,
    insurance_start_date
  FROM PolicyFact
  WHERE ${whereClause}
    AND insurance_start_date IS NOT NULL
    AND EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = ${policyYear}
    AND insurance_type IN ('交强险', '商业保险')
)
SELECT
  CAST(policy_month AS INTEGER) AS policy_month,
  ${sameYearExtraCols}-- ${earnedYear}年各月当月已赚
  ${earnedMonthlyFields.join(',\n  ')},
  -- ${earnedYear}年已赚合计
  ${totalField}
FROM policy_base
GROUP BY policy_month
ORDER BY policy_month
  `.trim();
}
