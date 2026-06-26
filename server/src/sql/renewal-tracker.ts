/**
 * 续保追踪 SQL 生成器
 *
 * 数据源：RenewalTrackerFact VIEW（派生域，由 ETL 预计算的 warehouse/fact/renewal_tracker/latest.parquet）
 *
 * 字段：
 *   source_policy_no, vehicle_frame_no, expiry_date, expiry_month, expected_expiry_date,
 *   org_level_3, team_name, salesman_name, customer_category,
 *   coverage_combination, fuel_category, is_nev, is_new_car, is_transfer, is_renewal,
 *   used_transfer_type, renewal_type,
 *   is_renewed, renewed_policy_no, renewed_date,
 *   is_quoted, first_quote_time, quote_count
 *
 * 输出指标 A-E（口径单一事实源 = metric-registry 续保域 categories/renewal.ts，
 *   本文件不重复口径文本；「输出列 ↔ 指标 id」绑定见下方 RENEWAL_OUTPUT_COLUMNS）：
 *   A 应续件数    renewal_due_count
 *   B 报价件数    renewal_quoted_count
 *   C 已续件数    renewal_renewed_count
 *   D 未报价件数  renewal_unquoted_count（= A − B）
 *   E 流失件数    renewal_lost_count（= A − C）
 *
 * SQL 实现要点（属本生成器实现细节，非口径）：
 *   - B：first_quote_time 为真实时点事件，按 cutoff 切片（first_quote_time ≤ cutoff）
 *   - C：renewed_date 是续保单保险起期（=原保单到期次日）非签单时点，不可用于「截至 cutoff 是否已续」
 *       切片 —— 未到期保单已签单但起保日在未来仍属已续，故 is_renewed 不按 cutoff 过滤
 *   - E：⚠️ 仅「已到期窗口」为真实流失；未到期窗口为「待续件数」（尚未到续保动作时点，非流失）
 *
 * 续保影响度（L4，metric-registry: renewal_impact_rate）= E ÷ 合计应续件数（窗口聚合分母，
 *   遵循「什么分类按什么合计」），由诊断脚本 diagnose_renewal_branch.py 按合计行计算，
 *   本主查询不内联（GROUPING SETS 多粒度下各切片合计不同，窗口函数易错）。
 *
 * 输出 24 种层级（一次 GROUPING SETS 查询）：
 *   基础层（4）：overall / org / team / salesman
 *   维度层（4 层 × 5 维度 = 20）：
 *     {level}_{dim} 其中 level ∈ {overall, org, team, salesman}，
 *     dim ∈ {category, coverage, fuel, used_transfer, renewal_type}
 */

import { isValidDateFormat } from '../utils/sql-sanitizer.js';

/**
 * 续保追踪主查询输出列 → metric-registry 指标 id 绑定。
 *
 * 口径文本（中文名 / 释义 / 单位）的**唯一事实源**是 metric-registry 续保域
 * （server/src/config/metric-registry/categories/renewal.ts）。本表只声明
 * 「SQL 输出列别名 ↔ 注册表指标 id」的机器可读绑定，绝不重复口径文本——
 * 这正是「renewal-tracker.ts 引用 metric-registry 成单一事实源」的落地形态。
 *
 * 消费方：config/route-field-legend.ts 据此绑定 + 注册表解析出 `cx query --describe`
 * 的中文字段图例。SSOT 守卫：每个 metricId 必须在注册表可解析
 * （route-field-legend.test.ts 回归断言，漂移即红）。
 */
export interface RenewalOutputColumn {
  /** SQL SELECT 输出列别名（与生成的查询一致） */
  readonly column: 'A' | 'B' | 'C' | 'D' | 'E';
  /** metric-registry 指标 id（口径事实源） */
  readonly metricId: string;
}

export const RENEWAL_OUTPUT_COLUMNS: readonly RenewalOutputColumn[] = [
  { column: 'A', metricId: 'renewal_due_count' },
  { column: 'B', metricId: 'renewal_quoted_count' },
  { column: 'C', metricId: 'renewal_renewed_count' },
  { column: 'D', metricId: 'renewal_unquoted_count' },
  { column: 'E', metricId: 'renewal_lost_count' },
] as const;

/**
 * A-E 计数列 SELECT 片段（口径 SSOT，固定 GROUPING SETS 主查询与 P2 可组合 cube
 * 生成器共用，杜绝两处口径漂移）。
 *
 * 口径定义见本文件头注与 metric-registry 续保域（renewal_due_count… renewal_lost_count）。
 * 返回片段第一行无前导缩进（由调用方模板的 `      ${...}` 提供），后续行内置 6 空格缩进。
 */
function renewalCountSelectSql(cutoff: string): string {
  return `COUNT(DISTINCT vehicle_frame_no) AS A,
      COUNT(DISTINCT CASE
        WHEN is_quoted AND CAST(first_quote_time AS DATE) <= DATE '${cutoff}' THEN vehicle_frame_no
      END) AS B,
      COUNT(DISTINCT CASE
        WHEN is_renewed THEN vehicle_frame_no
      END) AS C,
      COUNT(DISTINCT vehicle_frame_no) - COUNT(DISTINCT CASE
        WHEN is_quoted AND CAST(first_quote_time AS DATE) <= DATE '${cutoff}' THEN vehicle_frame_no
      END) AS D,
      COUNT(DISTINCT vehicle_frame_no) - COUNT(DISTINCT CASE
        WHEN is_renewed THEN vehicle_frame_no
      END) AS E`;
}

export interface RenewalTrackerQueryParams {
  /** expiry_date 范围起（YYYY-MM-DD） */
  start: string;
  /** expiry_date 范围止（YYYY-MM-DD） */
  end: string;
  /** 报价/续保截至日（YYYY-MM-DD），用于 YTD 视图下的件数切片 */
  cutoff: string;
  /** 非时间 WHERE 片段（org/salesman/category/coverage/fuel/... + 权限过滤），每段独立，由路由层预处理完毕 */
  extraConditions?: string[];
}

/**
 * 生成续保追踪主查询 SQL。
 *
 * 安全性：
 *   - 日期参数强制 YYYY-MM-DD 正则校验，否则抛错
 *   - extraConditions 由路由层用 buildInCondition 等安全工具构建，直接拼接
 */
export function generateRenewalTrackerQuery(params: RenewalTrackerQueryParams): string {
  const { start, end, cutoff, extraConditions = [] } = params;

  if (!isValidDateFormat(start)) throw new Error(`Invalid start date: ${start}`);
  if (!isValidDateFormat(end)) throw new Error(`Invalid end date: ${end}`);
  if (!isValidDateFormat(cutoff)) throw new Error(`Invalid cutoff date: ${cutoff}`);

  const whereClauses = [
    `expiry_date >= DATE '${start}'`,
    `expiry_date <= DATE '${end}'`,
    ...extraConditions,
  ];
  const whereSql = whereClauses.join('\n    AND ');

  // row_level 判定：基础层 (org/team/salesman grouping) + 维度层 (dim grouping)
  // GROUPING(col)=1 表示该列被聚合（即当前分组未使用此列）
  //
  // 维度判断顺序：先判定基础层（org/team/salesman 粒度），再按 5 个 dim 是否展开决定后缀
  const rowLevelCase = `
    CASE
      WHEN GROUPING(customer_category)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_category'
          WHEN GROUPING(team_name)=1 THEN 'org_category'
          WHEN GROUPING(salesman_name)=1 THEN 'team_category'
          ELSE 'salesman_category'
        END
      WHEN GROUPING(coverage_combination)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_coverage'
          WHEN GROUPING(team_name)=1 THEN 'org_coverage'
          WHEN GROUPING(salesman_name)=1 THEN 'team_coverage'
          ELSE 'salesman_coverage'
        END
      WHEN GROUPING(fuel_category)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_fuel'
          WHEN GROUPING(team_name)=1 THEN 'org_fuel'
          WHEN GROUPING(salesman_name)=1 THEN 'team_fuel'
          ELSE 'salesman_fuel'
        END
      WHEN GROUPING(used_transfer_type)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_used_transfer'
          WHEN GROUPING(team_name)=1 THEN 'org_used_transfer'
          WHEN GROUPING(salesman_name)=1 THEN 'team_used_transfer'
          ELSE 'salesman_used_transfer'
        END
      WHEN GROUPING(renewal_type)=0 THEN
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall_renewal_type'
          WHEN GROUPING(team_name)=1 THEN 'org_renewal_type'
          WHEN GROUPING(salesman_name)=1 THEN 'team_renewal_type'
          ELSE 'salesman_renewal_type'
        END
      ELSE
        CASE
          WHEN GROUPING(org_level_3)=1 THEN 'overall'
          WHEN GROUPING(team_name)=1 THEN 'org'
          WHEN GROUPING(salesman_name)=1 THEN 'team'
          ELSE 'salesman'
        END
    END AS row_level`;

  return `
    SELECT
      ${rowLevelCase.trim()},
      org_level_3,
      team_name,
      salesman_name,
      customer_category,
      coverage_combination,
      fuel_category,
      used_transfer_type,
      renewal_type,
      ${renewalCountSelectSql(cutoff)}
    FROM RenewalTrackerFact
    WHERE ${whereSql}
    GROUP BY GROUPING SETS (
      (),
      (org_level_3),
      (org_level_3, team_name),
      (org_level_3, team_name, salesman_name),
      (customer_category),
      (org_level_3, customer_category),
      (org_level_3, team_name, customer_category),
      (org_level_3, team_name, salesman_name, customer_category),
      (coverage_combination),
      (org_level_3, coverage_combination),
      (org_level_3, team_name, coverage_combination),
      (org_level_3, team_name, salesman_name, coverage_combination),
      (fuel_category),
      (org_level_3, fuel_category),
      (org_level_3, team_name, fuel_category),
      (org_level_3, team_name, salesman_name, fuel_category),
      (used_transfer_type),
      (org_level_3, used_transfer_type),
      (org_level_3, team_name, used_transfer_type),
      (org_level_3, team_name, salesman_name, used_transfer_type),
      (renewal_type),
      (org_level_3, renewal_type),
      (org_level_3, team_name, renewal_type),
      (org_level_3, team_name, salesman_name, renewal_type)
    )
  `.trim();
}

/**
 * 续保可组合立方体维度白名单（P2 语义层）。
 *
 * 维度 id → SQL 列 / 表达式（RenewalTrackerFact schema 上真实存在的可分组列）。
 * 布尔列用 CASE 包成可读中文（与 /pivot 的 DIM_WHITELIST 同款），避免 GROUP BY true/false
 * 输出难读。把固定 24 层 GROUPING SETS 泛化为「选指标 × 任意维度子集」即复用本表。
 *
 * ⚠️ 本派生域**无** insurance_grade（风险等级）等 PolicyFact 专属列，故
 * 「续保率 × 风险等级」不能在续保域服务（需走 PolicyFact 域 /pivot）。维度集严格限于
 * RenewalTrackerFact 列，新增维度前须确认该列在续保宽表中存在（warehouse/fact/renewal_tracker）。
 */
export const RENEWAL_CUBE_DIMENSIONS: Readonly<Record<string, string>> = {
  org_level_3: 'org_level_3',
  team_name: 'team_name',
  salesman_name: 'salesman_name',
  customer_category: 'customer_category',
  coverage_combination: 'coverage_combination',
  fuel_category: 'fuel_category',
  used_transfer_type: 'used_transfer_type',
  renewal_type: 'renewal_type',
  expiry_month: 'expiry_month',
  is_nev: "CASE WHEN is_nev THEN '新能源' ELSE '非新能源' END",
  is_new_car: "CASE WHEN is_new_car THEN '新车' ELSE '旧车' END",
  is_transfer: "CASE WHEN is_transfer THEN '过户' ELSE '非过户' END",
  is_renewal: "CASE WHEN is_renewal THEN '续保' ELSE '新保' END",
};

export interface RenewalCubeQueryParams {
  /** expiry_date 范围起（YYYY-MM-DD） */
  start: string;
  /** expiry_date 范围止（YYYY-MM-DD） */
  end: string;
  /** 报价/续保截至日（YYYY-MM-DD），B 报价件数按此 cutoff 切片 */
  cutoff: string;
  /** 维度子集（0..N 个，均须 ∈ RENEWAL_CUBE_DIMENSIONS）。空 = 仅整体一行 */
  dims: readonly string[];
  /** 非时间 WHERE 片段（org/salesman/category/... + 权限过滤），路由层用安全工具预构建 */
  extraConditions?: readonly string[];
  /** 返回行数上限（正整数） */
  limit: number;
}

/**
 * 生成续保「选指标 × 任意维度子集」可组合查询 SQL（P2 语义层）。
 *
 * 与 generateRenewalTrackerQuery（固定 24 层 GROUPING SETS）的区别：本生成器按调用方
 * 指定的**任意维度子集**做单层 GROUP BY，输出 A-E 计数列（口径与主查询共用
 * renewalCountSelectSql，零漂移）。续保率/未报价率/流失率（C/A、D/A、E/A）为派生值，
 * 由路由层用 A-E 计算（与既有续保消费方一致），SQL 只产 universe 计数。
 *
 * 安全：日期 YYYY-MM-DD 正则校验；dims 严格白名单校验（拒绝表外标识符）；
 * extraConditions 由路由层 buildInCondition 等安全工具构建。
 *
 * @example dims=['org_level_3','is_new_car'] → 各机构 × 新旧车 的续保 universe，
 *          这是固定 24 层切片**未预置**的新组合（24 层维度层仅 category/coverage/fuel/
 *          used_transfer/renewal_type 单维 × 4 基础层）。
 */
export function generateRenewalCubeQuery(params: RenewalCubeQueryParams): string {
  const { start, end, cutoff, dims, extraConditions = [], limit } = params;

  if (!isValidDateFormat(start)) throw new Error(`Invalid start date: ${start}`);
  if (!isValidDateFormat(end)) throw new Error(`Invalid end date: ${end}`);
  if (!isValidDateFormat(cutoff)) throw new Error(`Invalid cutoff date: ${cutoff}`);
  for (const d of dims) {
    if (!Object.prototype.hasOwnProperty.call(RENEWAL_CUBE_DIMENSIONS, d)) {
      throw new Error(`RENEWAL_CUBE: 未知维度 "${d}"（可用：${Object.keys(RENEWAL_CUBE_DIMENSIONS).join(', ')}）`);
    }
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`RENEWAL_CUBE: limit 必须为正整数，实际 ${limit}`);
  }

  const whereClauses = [
    `expiry_date >= DATE '${start}'`,
    `expiry_date <= DATE '${end}'`,
    ...extraConditions,
  ];
  const whereSql = whereClauses.join('\n    AND ');

  const dimSelects = dims.map((d) => `${RENEWAL_CUBE_DIMENSIONS[d]} AS ${d}`);
  const selectLines = [...dimSelects, renewalCountSelectSql(cutoff)].join(',\n      ');
  // 维度子集非空 → 按序号 GROUP BY（序号引用前 dims.length 个 SELECT 表达式）；
  // 空维度 → 无 GROUP BY，整体聚合一行。
  const groupBySql = dims.length > 0
    ? `\n    GROUP BY ${dims.map((_, i) => String(i + 1)).join(', ')}`
    : '';

  return `
    SELECT
      ${selectLines}
    FROM RenewalTrackerFact
    WHERE ${whereSql}${groupBySql}
    ORDER BY A DESC
    LIMIT ${limit}
  `.trim();
}

/**
 * 生成查询元数据的 SQL — universe 统计（暴露数 / 去重 VIN / 日期范围）
 *
 * 供前端在页面顶部展示"数据截至 / Universe 统计"信息。
 *
 * 分省 RLS（branchCode）：本 universe 查询不接受其他筛选条件，若不按用户省份下推
 * branch_code，多省部署下 branch_admin 看到的 universe 统计会跨省（含他省计数）→ 元数据
 * 串读。branchCode 由路由层 resolveBranchRlsCode 双门控解析（已 ^[A-Z]{2}$ 校验），
 * 此处防御性再校验后内插（无注入面）；undefined → 不加 WHERE → 单租户/RLS-off 字节安全。
 */
export function generateRenewalTrackerMetaQuery(branchCode?: string): string {
  if (branchCode !== undefined && !/^[A-Z]{2}$/.test(branchCode)) {
    throw new Error(`Invalid branchCode for renewal meta query: ${branchCode}`);
  }
  const whereSql = branchCode ? `\n    WHERE branch_code = '${branchCode}'` : '';
  return `
    SELECT
      COUNT(*) AS exposure_row_count,
      COUNT(DISTINCT vehicle_frame_no) AS distinct_vehicle_count,
      COUNT(DISTINCT source_policy_no) AS distinct_source_policy_count,
      CAST(MAX(GREATEST(
        COALESCE(first_quote_time, DATE '1970-01-01'),
        COALESCE(renewed_date, DATE '1970-01-01')
      )) AS DATE) AS latest_data_date
    FROM RenewalTrackerFact${whereSql}
  `.trim();
}
