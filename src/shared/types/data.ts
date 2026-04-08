/**
 * 核心数据类型定义
 *
 * 替代 any 类型，提供类型安全
 */

/**
 * KPI 指标数据
 */
export interface KpiData {
  /** 总保费 */
  total_premium?: number | bigint;
  /** 保单数量 */
  policy_count?: number | bigint;
  /** 件均保费 */
  avg_premium?: number | bigint;
  /** 机构数量 */
  org_count?: number | bigint;
  /** 业务员数量 */
  salesman_count?: number | bigint;
  /** 客户数量 */
  customer_count?: number | bigint;
  [key: string]: number | bigint | undefined;
}

/**
 * 趋势数据点
 */
export interface TrendDataPoint {
  /** 时间周期（日期、周、月） */
  time_period: string;
  /** 保费金额 */
  total_premium?: number | bigint;
  /** 保单数量 */
  policy_count?: number | bigint;
  /** 次月起保占比 */
  next_month_ratio?: number;
  /** 次月起保保费 */
  next_month_start_premium?: number | bigint;
  /** 同比增长率 */
  yoy_growth?: number;
  /** 环比增长率 */
  mom_growth?: number;
  [key: string]: string | number | bigint | undefined;
}

/**
 * 表格数据行
 */
export interface TableDataRow {
  /** 机构名称 */
  org_level_3?: string;
  /** 业务员名称 */
  salesman_name?: string;
  /** 客户类别 */
  customer_category?: string;
  /** 保单号 */
  policy_no?: string;
  /** 保费 */
  premium?: number | bigint;
  /** 保单日期 */
  policy_date?: string;
  /** 起保日期 */
  start_date?: string;
  /** 止保日期 */
  end_date?: string;
  /** 险种组合 */
  coverage_combination?: string;
  /** 终端来源 */
  terminal_source?: string;
  /** 车牌号 */
  plate_no?: string;
  /** 车辆类型 */
  vehicle_type?: string;
  [key: string]: string | number | bigint | undefined;
}

/**
 * 维度分享数据
 */
export interface DimensionShareData {
  /** 维度名称（机构、业务员、客户类别等） */
  name: string;
  /** 保费金额 */
  premium: number | bigint;
  /** 保单数量 */
  count: number | bigint;
  /** 占比 */
  ratio?: number;
  [key: string]: string | number | bigint | undefined;
}

/**
 * 筛选器选项
 */
export interface FilterOption {
  /** 选项展示名称（可选，若有则优先展示） */
  label?: string;
  /** 选项值 */
  value: string;
  /** 选项计数 */
  count: number;
}

/**
 * 筛选器选项集合
 */
export interface FilterOptions {
  org_level_3?: FilterOption[];
  salesman_name?: FilterOption[];
  customer_category?: FilterOption[];
  coverage_combination?: FilterOption[];
  renewal_mode?: FilterOption[];
  terminal_source?: FilterOption[];
  vehicle_type?: FilterOption[];
  insurance_grade?: FilterOption[];
  [key: string]: FilterOption[] | undefined;
}

/**
 * 查询结果行（通用）
 *
 * 用于 DuckDB 查询结果的行数据
 */
export interface QueryResultRow {
  [key: string]: string | number | bigint | boolean | null | undefined;
}

/**
 * 查询结果（带元数据）
 *
 * 用于封装查询结果及其执行信息
 */
export interface QueryResult {
  /** 查询状态 */
  status: 'success' | 'error';
  /** 行数 */
  rowCount?: number;
  /** 列数 */
  columnCount?: number;
  /** 执行时间（毫秒） */
  executionTime?: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 图表系列数据
 */
export interface ChartSeries {
  /** 系列名称 */
  name: string;
  /** 系列类型 */
  type: 'line' | 'bar' | 'pie' | 'scatter' | 'candlestick';
  /** 数据数组 */
  data: (number | string | [number, number])[];
  /** 其他配置 */
  [key: string]: unknown;
}

/**
 * 月度键值（YYYY-MM格式）
 */
export type MonthKey = string;

/**
 * 日期范围
 */
export interface DateRange {
  /** 开始日期 */
  start: string;
  /** 结束日期 */
  end: string;
}

/**
 * 统计数据
 */
export interface StatData {
  /** 总计 */
  total?: number | bigint;
  /** 平均值 */
  average?: number | bigint;
  /** 最大值 */
  max?: number | bigint;
  /** 最小值 */
  min?: number | bigint;
  /** 中位数 */
  median?: number | bigint;
  /** 标准差 */
  stddev?: number | bigint;
  [key: string]: number | bigint | undefined;
}

/**
 * 加载状态键
 *
 * 定义所有可能的加载状态类型
 */
export type LoadingStateKey =
  | 'kpi'
  | 'trend'
  | 'table'
  | 'chart'
  | 'customerCategory'
  | 'coverageCombination'
  | 'terminalSource'
  | 'qualityBusiness'
  | 'truck'
  | 'renewal'
  | 'ranking'
  | 'notRenewed';

/**
 * 导出数据行
 *
 * 用于 CSV/Excel 导出
 */
export type ExportDataRow = Record<string, string | number | boolean | bigint | null | undefined>;

/**
 * DC-001: 日期口径类型
 *
 * 定义数据分析三要素中的数据口径选项
 */
export type DateCriteria = 'policy_date' | 'insurance_start_date';

/**
 * DC-001: 单一口径的元数据
 *
 * 包含指定日期字段（签单日期或起保日期）的元数据信息
 */
export interface DateMetadata {
  /** 该口径的最大日期（YYYY-MM-DD格式） */
  maxDate: string;
  /** 该口径的可用年份列表（降序排列） */
  availableYears: number[];
}

/**
 * DC-001: 双口径元数据缓存
 *
 * 同时缓存签单日期和起保日期两个口径的元数据
 * 避免在日期口径切换时重复查询
 */
export interface DualDateMetadata {
  /** 签单日期口径的元数据 */
  policy: DateMetadata;
  /** 起保日期口径的元数据 */
  insurance: DateMetadata;
}

/**
 * DC-001: 根据日期口径获取对应的元数据
 *
 * @param metadata - 双口径元数据缓存
 * @param criteria - 日期口径类型
 * @returns 对应口径的元数据
 *
 * @example
 * ```typescript
 * const metadata: DualDateMetadata = {
 *   policy: { maxDate: '2026-12-15', availableYears: [2026, 2025, 2024] },
 *   insurance: { maxDate: '2027-03-20', availableYears: [2027, 2026, 2025] }
 * };
 *
 * const policyMeta = getMetadataByCriteria(metadata, 'policy_date');
 * // returns: { maxDate: '2026-12-15', availableYears: [2026, 2025, 2024] }
 *
 * const insuranceMeta = getMetadataByCriteria(metadata, 'insurance_start_date');
 * // returns: { maxDate: '2027-03-20', availableYears: [2027, 2026, 2025] }
 * ```
 */
export function getMetadataByCriteria(
  metadata: DualDateMetadata,
  criteria: DateCriteria
): DateMetadata {
  return criteria === 'policy_date' ? metadata.policy : metadata.insurance;
}

/**
 * 高级筛选器状态
 *
 * 包含所有筛选条件和数据分析三要素
 */
export interface AdvancedFilterState {
  // DC-001: 数据分析三要素（强制）
  date_criteria?: DateCriteria;  // 数据口径：签单日期 | 起保日期
  analysis_year?: number;        // 分析年度（2025, 2026, etc.）（B052规范）

  // Date range (向后兼容，但推荐使用analysis_year + date_criteria)
  policy_date_start?: string;  // 签单日期开始
  policy_date_end?: string;    // 签单日期结束

  // Categorical filters (Multi-select)
  org_level_3?: string[]; // 三级机构（多选）
  salesman_name?: string[]; // 业务员（多选）
  customer_category?: string[]; // 客户类别（多选）
  coverage_combination?: string[]; // 险别组合（多选）
  renewal_mode?: string[]; // 续保模式（多选：自留/外呼/空值等）
  renewal_policy_no?: string[]; // 续保单号（多选，可选）
  tonnage_segment?: string[]; // 吨位分段（多选，可选）

  // Boolean filters (Three-state toggles)
  is_renewal?: boolean | null; // 是否续保
  is_new_car?: boolean | null; // 是否新车
  is_transfer?: boolean | null; // 是否过户
  is_nev?: boolean | null; // 是否新能源
  is_telemarketing?: boolean | null; // 是否电销
  insurance_type?: boolean | null; // 险类（true=交强险，false=商业保险，null=全部）
  is_commercial_insure?: boolean | null; // 是否交商统保
  is_renewable?: boolean | null; // 是否可续

  // 新增字段筛选
  insurance_grade?: string[];            // 车险风险等级（多选：A/B/C/D/E/F/G/X）
  is_cross_sell?: boolean | null;        // 交叉销售标识（三态开关）

  // 车型快捷筛选（互斥单选）
  vehicle_quick_filter?: 'home_car' | 'truck_1t' | 'truck_2_9t' | 'motorcycle' | 'truck_1_2t' | 'rental' | 'dump' | 'tractor' | 'general';
  // 营业/非营业性质
  business_nature?: 'commercial' | 'non_commercial';
}
