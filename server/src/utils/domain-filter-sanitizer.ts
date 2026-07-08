/**
 * 域筛选净化中央化模块（BACKLOG 2026-07-07-claude-dce69c，8f71c0 architect 闸 P1-1）
 *
 * 背景：cross-sell（CrossSellDailyAgg 路径）/ quote-conversion / customer-flow 三个路由域
 * 各自在路由文件里手写一份"从 commonFilterSchema 剥离掉哪些不适用字段"的清单（净化剥离
 * 清单：sanitizeAggQuery / QUOTE_UNSUPPORTED_COMMON_PARAMS / FLOW_UNSUPPORTED_COMMON_PARAMS）。
 * 这份清单与这些域实际的 DuckDB 视图定义（duckdb-domain-loaders.ts /
 * duckdb-materialization.ts）之间没有编译期关联——视图列变了、路由层剥离清单没跟着改，
 * 会重演 Binder Error 人肉排查故障（2026-06-27 山西 13 账号验证撞出，BACKLOG 8f71c0/96e597）。
 *
 * 本模块把「域 → 真实支持的底层 SQL 列」收敛成唯一数据源 DOMAIN_SUPPORTED_COLUMNS，
 * 并提供共享的 filterByDomainColumns() 净化函数。三个路由文件的 sanitizeAggQuery /
 * sanitizeFlowQuery / buildQuoteEffectiveQuery 内部改为调用本函数（导出名保持不变，
 * 不破坏既有测试 / bundles 调用方）。
 *
 * server/src/config/route-param-contracts.ts 复用本模块的 alwaysExcludedCommonFields()
 * 生成 useCommonExcept 静态声明，使「运行时净化行为」与「route-catalog 参数契约」共享
 * 同一份列清单，不再各自维护、不再漂移。
 *
 * 列清单来源（人工摘录自视图真实定义，非运行时自省；视图定义变更时必须同步本文件）：
 *   - crossSellAgg：server/src/services/duckdb-materialization.ts
 *     createCrossSellRealtimeView() 的 groupByColumns（8域模式，最终物化表/回退 VIEW 的
 *     唯一权威 GROUP BY 列表；insurance_type 虽在 CTE 中间结果 normalized 里出现，但只被
 *     聚合函数 SUM(CASE WHEN insurance_type ...) 消费、未进最终 SELECT 输出列，不可筛选）
 *   - customerFlow：server/src/services/duckdb-domain-loaders.ts
 *     loadCustomerFlow() 的显式 10 列 SELECT（派生自 PolicyFact 的精简视图）
 *   - quoteConversion：QuoteConversion 视图是 `SELECT * REPLACE(...)` 直通报价 Parquet
 *     原始列（无静态 SELECT 列表可摘，SELECT * 意味着列集随源 parquet 变化）。本表以
 *     「确认支持」的列表示，来源于 quote-conversion.ts 历史 Binder Error 排查结论
 *     （2026-06-27 山西 13 账号验证）：报价 Parquet 确认不含 policy_date /
 *     insurance_start_date / renewal_mode / is_renewal / is_new_car / is_renewable /
 *     is_cross_sell / is_commercial_insure / is_nev(布尔) / is_transfer(布尔) /
 *     fuel_type / vehicle_model。
 *
 * 维护协议：改 groupByColumns / loadCustomerFlow SELECT 列表、或报价 Parquet 新增/删除
 * 上述任一列后，必须同步改本文件对应的 DOMAIN_SUPPORTED_COLUMNS 条目——本模块尚未接线
 * 自动化对账（DESCRIBE 运行时自省），依赖人工同步 + code review 把关，与
 * filter-dimension-capability.ts 能力矩阵镜像协议同款约束强度。
 */

export type FilterDomain = 'crossSellAgg' | 'quoteConversion' | 'customerFlow';

/** 域 → 该域视图真实支持的底层 SQL 列（原始列名，非 commonFilterSchema 参数名）。 */
export const DOMAIN_SUPPORTED_COLUMNS: Record<FilterDomain, readonly string[]> = {
  // duckdb-materialization.ts createCrossSellRealtimeView() groupByColumns（8域模式）
  crossSellAgg: [
    'policy_date', 'insurance_start_date', 'branch_code', 'org_level_3', 'salesman_name',
    'customer_category', 'coverage_combination', 'renewal_mode', 'tonnage_segment',
    'insurance_grade', 'is_commercial_insure', 'is_transfer', 'is_telemarketing',
    'is_renewal', 'is_nev', 'is_new_car', 'is_renewable', 'is_cross_sell',
    'driver_coverage', 'passenger_coverage',
  ],
  // duckdb-domain-loaders.ts loadCustomerFlow() 显式 SELECT 列表
  customerFlow: [
    'policy_no', 'insurance_start_date', 'previous_insurer', 'next_insurer',
    'org_level_3', 'branch_code', 'is_telemarketing', 'customer_category',
    'insurance_type', 'coverage_combination',
  ],
  // QuoteConversion 是 SELECT * 直通报价 Parquet，无静态列表；见上方模块注释
  quoteConversion: [
    'org_level_3', 'salesman_name', 'customer_category', 'coverage_combination',
    'tonnage_segment', 'insurance_grade', 'is_telemarketing', 'insurance_type',
  ],
};

/** 两个可能的日期锚定列（DateFieldType 的 SQL 侧镜像，见 route-helpers.ts） */
const DATE_COLUMNS = ['policy_date', 'insurance_start_date'] as const;

/** commonFilterSchema 字段 → 其依赖的底层 SQL 列（不含 vehicleQuickFilter/fuelCategory/日期字段，单独处理） */
const FIELD_COLUMNS: Record<string, readonly string[]> = {
  orgNames: ['org_level_3'],
  orgLevel3: ['org_level_3'],
  orgName: ['org_level_3'],
  salesmanNames: ['salesman_name'],
  salesmanName: ['salesman_name'],
  customerCategories: ['customer_category'],
  coverageCombinations: ['coverage_combination'],
  renewalModes: ['renewal_mode'],
  tonnageSegments: ['tonnage_segment'],
  insuranceGrades: ['insurance_grade'],
  isRenewal: ['is_renewal'],
  isNewCar: ['is_new_car'],
  isTransfer: ['is_transfer'],
  isNev: ['is_nev'],
  isTelemarketing: ['is_telemarketing'],
  isCommercialInsure: ['is_commercial_insure'],
  isRenewable: ['is_renewable'],
  isCrossSell: ['is_cross_sell'],
  insuranceType: ['insurance_type'],
  enterpriseCar: ['customer_category'],
  businessNature: ['customer_category'],
  // targetBranch 不是 WHERE 维度（buildWhereFromFilterParams 不消费，纯权限选择器），
  // 空依赖列表 = 任何域都不剥离
  targetBranch: [],
};

/** vehicleQuickFilter 各取值依赖的列（镜像 filter-params.ts pushVehicleQuickFilterConditions 9 个 case） */
const VEHICLE_QUICK_FILTER_COLUMNS: Record<string, readonly string[]> = {
  home_car: ['customer_category'],
  truck_1t: ['customer_category', 'tonnage_segment'],
  truck_2_9t: ['customer_category', 'tonnage_segment'],
  motorcycle: ['customer_category'],
  truck_1_2t: ['customer_category', 'tonnage_segment'],
  rental: ['customer_category'],
  dump: ['customer_category', 'tonnage_segment', 'vehicle_model'],
  tractor: ['customer_category', 'tonnage_segment', 'vehicle_model'],
  general: ['customer_category', 'tonnage_segment', 'vehicle_model'],
};

/** fuelCategory 各取值依赖的列（镜像 filter-params.ts buildConditionsFromFilterParams 的 switch） */
const FUEL_CATEGORY_COLUMNS: Record<string, readonly string[]> = {
  electric: ['is_nev'],
  gas: ['is_nev', 'fuel_type'],
  oil: ['is_nev', 'fuel_type'],
};

function supportsAll(supported: ReadonlySet<string>, columns: readonly string[]): boolean {
  return columns.every((c) => supported.has(c));
}

/**
 * 净化日期相关参数（startDate/endDate/dateField）：
 *   - 未指定日期参数：不处理
 *   - 目标锚定列（显式 dateField 或默认口径 policy_date）受支持：原样保留
 *   - 目标锚定列不受支持，但域内存在另一个受支持的日期列：改写 dateField 为该列
 *     （保留调用方"时间窗"意图，不静默丢弃；镜像 customer-flow 强制 insurance_start_date）
 *   - 两个日期列都不受支持：整组剥离（镜像 quote-conversion 完全不支持日期锚定）
 */
function sanitizeDateParams(out: Record<string, unknown>, supported: ReadonlySet<string>): void {
  const hasDateParams = out.startDate !== undefined || out.endDate !== undefined || out.dateField !== undefined;
  if (!hasDateParams) return;

  const requestedRaw = out.dateField;
  const requested: (typeof DATE_COLUMNS)[number] =
    typeof requestedRaw === 'string' && (DATE_COLUMNS as readonly string[]).includes(requestedRaw)
      ? (requestedRaw as (typeof DATE_COLUMNS)[number])
      : 'policy_date'; // 未显式指定或值非法：commonFilterSchema 默认口径

  if (supported.has(requested)) return;

  const fallback = DATE_COLUMNS.find((c) => c !== requested && supported.has(c));
  if (fallback) {
    out.dateField = fallback;
    return;
  }
  delete out.startDate;
  delete out.endDate;
  delete out.dateField;
}

/**
 * 域筛选净化（净化副本模式，不修改传入 query）：把 commonFilterSchema 参数集合
 * 收窄到目标域视图真实支持的子集，防御性剥离不支持的参数，避免 DuckDB Binder Error。
 *
 * 依赖 DOMAIN_SUPPORTED_COLUMNS 单一事实源；cross-sell（agg 路径）/ quote-conversion /
 * customer-flow 三个路由域统一调用本函数，不再各自维护剥离清单。
 */
export function filterByDomainColumns<T extends Record<string, unknown>>(query: T, domain: FilterDomain): T {
  const out = { ...query } as Record<string, unknown>;
  const supported = new Set(DOMAIN_SUPPORTED_COLUMNS[domain]);

  sanitizeDateParams(out, supported);

  for (const [field, columns] of Object.entries(FIELD_COLUMNS)) {
    if (out[field] === undefined) continue;
    if (columns.length > 0 && !supportsAll(supported, columns)) delete out[field];
  }

  if (out.vehicleQuickFilter !== undefined) {
    const value = String(out.vehicleQuickFilter);
    const columns = VEHICLE_QUICK_FILTER_COLUMNS[value];
    if (!columns || !supportsAll(supported, columns)) delete out.vehicleQuickFilter;
  }

  if (out.fuelCategory !== undefined) {
    const value = String(out.fuelCategory);
    const columns = FUEL_CATEGORY_COLUMNS[value];
    if (!columns || !supportsAll(supported, columns)) delete out.fuelCategory;
  }

  return out as T;
}

/**
 * 计算某域「无论取值如何都会被剥离」的 commonFilterSchema 顶层字段名（静态子集）。
 *
 * 供 route-param-contracts.ts 生成 useCommonExcept 静态声明——route-catalog 参数契约
 * 只能声明"字段名"级别的排除（不区分取值），vehicleQuickFilter / fuelCategory 这类
 * 值相关字段只有在其"全部取值"都不受支持时才会出现在结果里（本项目 3 个域均不属此情况，
 * 故这两个字段不会出现在任何域的排除列表中——与 filterByDomainColumns 的取值级剥离行为
 * 不冲突：契约声明的是"可能仍被剥离的字段"上限，运行时净化仍按取值精确剥离）。
 */
export function alwaysExcludedCommonFields(domain: FilterDomain): string[] {
  const supported = new Set(DOMAIN_SUPPORTED_COLUMNS[domain]);
  const excluded: string[] = [];

  if (!supported.has('policy_date') && !supported.has('insurance_start_date')) {
    excluded.push('startDate', 'endDate', 'dateField');
  }

  for (const [field, columns] of Object.entries(FIELD_COLUMNS)) {
    if (columns.length > 0 && !supportsAll(supported, columns)) excluded.push(field);
  }

  if (Object.values(FUEL_CATEGORY_COLUMNS).every((cols) => !supportsAll(supported, cols))) {
    excluded.push('fuelCategory');
  }
  if (Object.values(VEHICLE_QUICK_FILTER_COLUMNS).every((cols) => !supportsAll(supported, cols))) {
    excluded.push('vehicleQuickFilter');
  }

  return excluded;
}
