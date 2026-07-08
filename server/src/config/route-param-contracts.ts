/**
 * Query 路由参数契约表
 *
 * path → 运行时真实参数定义的映射，是 route-catalog 参数元数据的对账基准。
 * 由 scripts/route-catalog/validate-params.ts（governance 接线）消费：
 * 校验 query-routes-metadata.ts 登记的每个参数名 ⊆ 本契约的合法参数集合，
 * 杜绝"catalog 提示了路由根本不接受的参数"（zod strip 静默忽略 → 调用方拿到全量数据）。
 *
 * 两类字段来源，可信度不同：
 *   - schemas / useCommon：引用运行时真实 zod schema 对象（机器保证，schema 改动自动反映）
 *   - extraKeys：zod 之外的散读 req.query.xxx 或手写解析字段（人工声明，注明源码位置）
 *
 * 维护规则：新增路由（governance QueryCatalog 对账会强制登记 catalog）时，
 * 必须同步在此登记契约条目，validate-params 的覆盖率检查会拦截遗漏。
 * 本文件仅被校验脚本/测试 import，生产运行时不加载。
 */
import { z } from 'zod';
import { commonFilterSchema } from '../utils/filter-params.js';
import { alwaysExcludedCommonFields } from '../utils/domain-filter-sanitizer.js';
import { trendExtraSchema } from '../routes/query/trend.js';
import { growthExtraSchema } from '../routes/query/growth.js';
import { costExtraSchema } from '../routes/query/cost.js';
import { comprehensiveExtraSchema } from '../routes/query/comprehensive.js';
import { quoteFilterSchema } from '../routes/query/quote-conversion.js';
import { filterSchema as customerFlowFilterSchema } from '../routes/query/customer-flow.js';
import {
  crossSellExtraSchema, crossSellTrendSchema, crossSellSummarySchema,
  crossSellOrgTrendSchema, crossSellHeatmapSchema, crossSellTopSalesmanSchema,
} from '../routes/query/cross-sell.js';
import { salesmanRankingExtraSchema } from '../routes/query/salesman.js';
import { filterSchema as repairFilterSchema } from '../routes/query/repair.js';
import {
  marketingReportSchema, holidayDrilldownSchema, premiumReportExtraSchema,
} from '../routes/query/report.js';
import { premiumPlanSchema, planAchievementSchema } from '../routes/query/premium-plan.js';
import { truckExtraSchema } from '../routes/query/truck.js';
import {
  performanceSummarySchema, performanceTrendSchema, performanceDrilldownSchema,
  performanceOrgHeatmapSchema, performanceTopSalesmanSchema,
} from '../routes/query/performance.js';
import { crossSellBundleSchema } from '../routes/query/bundles/cross-sell.js';
import { dashboardBundleSchema } from '../routes/query/bundles/dashboard.js';
import { performanceBundleSchema } from '../routes/query/bundles/performance.js';

export interface RouteParamContract {
  /** 路由专属 zod schema（运行时真实对象） */
  schemas?: Array<z.ZodObject<z.ZodRawShape>>;
  /** 是否叠加 commonFilterSchema（parseFiltersAndBuild* / commonFilterSchema.safeParse 路由） */
  useCommon?: boolean;
  /**
   * 叠加 commonFilterSchema 但排除这些顶层字段名（仅在 useCommon=true 时生效）。
   *
   * 覆盖"域视图不支持某些维度列，路由层用净化副本剥离"的场景（BACKLOG 2026-06-27-claude-6d1dfe，
   * 8f71c0 architect 闸 P1-2）：cross-sell（agg 路径）/ quote-conversion / customer-flow 三域
   * 的 handler 实际消费的是 commonFilterSchema 的一个"净化子集"，不是全量。排除清单来源于
   * server/src/utils/domain-filter-sanitizer.ts 的 alwaysExcludedCommonFields()（与运行时
   * filterByDomainColumns() 净化逻辑共享同一份 DOMAIN_SUPPORTED_COLUMNS 数据源，不再手写重复列表）。
   *
   * 注意：这是"字段名"级静态声明，不区分取值——vehicleQuickFilter / fuelCategory 这类值相关
   * 字段只有在其全部取值都不受支持时才会出现在此列表（本项目现有 3 个域均不属此情况）。
   */
  useCommonExcept?: string[];
  /** zod 之外的散读 req.query 字段或手写解析字段（人工声明，注明来源） */
  extraKeys?: string[];
  /** path 模板参数（如 :domain） */
  pathParams?: string[];
}

/**
 * quote-conversion / customer-flow 域 useCommonExcept 静态声明——从
 * domain-filter-sanitizer.ts 的 DOMAIN_SUPPORTED_COLUMNS 单一数据源计算，
 * 与运行时 filterByDomainColumns() 净化行为保持同源，不再手写重复列表。
 */
const QUOTE_UNSUPPORTED_COMMON_EXCEPT = alwaysExcludedCommonFields('quoteConversion');
const FLOW_UNSUPPORTED_COMMON_EXCEPT = alwaysExcludedCommonFields('customerFlow');

/** claims-detail.ts parseFilters() 手写解析的全部字段（含 coverageCombinations 别名） */
const CLAIMS_DETAIL_FILTER_KEYS = [
  'dateStart', 'dateEnd', 'orgName', 'claimStatus', 'isBodilyInjury',
  'accidentCause', 'accidentCity', 'customerCategory', 'isNev',
  'coverageCombination', 'coverageCombinations', 'isTransfer', 'vehicleQuickFilter',
  'businessNature', 'isNewCar', 'isRenewal', 'cutoffDate',
];

export const ROUTE_PARAM_CONTRACTS: Record<string, RouteParamContract> = {
  // ── KPI（route-helpers parseFiltersAndBuild*） ─────────────
  '/kpi': { useCommon: true },
  '/kpi-detail': { useCommon: true },

  // ── 趋势 ───────────────────────────────────────
  '/trend': { useCommon: true, schemas: [trendExtraSchema] },
  '/quality-business-trend': { useCommon: true, schemas: [trendExtraSchema] },

  // ── 货车 / 增长 / 成本 ─────────────────────────
  '/truck': { useCommon: true, schemas: [truckExtraSchema] },
  '/growth': { useCommon: true, schemas: [growthExtraSchema], extraKeys: ['perspective'] }, // growth.ts 散读 req.query.perspective
  '/cost': { useCommon: true, schemas: [costExtraSchema] },

  // ── 综合 ───────────────────────────────────────
  '/comprehensive-bundle': { useCommon: true, schemas: [comprehensiveExtraSchema] },
  '/comprehensive-analysis-bundle': { useCommon: true, schemas: [comprehensiveExtraSchema] },

  // ── 交叉销售（各路由散读 req.query.insuranceType） ──────────
  '/cross-sell': { useCommon: true, schemas: [crossSellExtraSchema], extraKeys: ['insuranceType'] },
  '/cross-sell-trend': { useCommon: true, schemas: [crossSellTrendSchema], extraKeys: ['insuranceType'] },
  '/cross-sell-summary': { useCommon: true, schemas: [crossSellSummarySchema], extraKeys: ['insuranceType'] },
  '/cross-sell-org-trend': { useCommon: true, schemas: [crossSellOrgTrendSchema], extraKeys: ['insuranceType'] },
  '/cross-sell-heatmap': { useCommon: true, schemas: [crossSellHeatmapSchema], extraKeys: ['insuranceType'] },
  '/cross-sell-top-salesman': { useCommon: true, schemas: [crossSellTopSalesmanSchema], extraKeys: ['insuranceType'] },
  '/cross-sell-bundle': { useCommon: true, schemas: [crossSellBundleSchema], extraKeys: ['insuranceType'] },

  // ── 业务员 / 业绩 ───────────────────────────────
  '/salesman-ranking': { useCommon: true, schemas: [salesmanRankingExtraSchema] },
  '/performance-summary': { useCommon: true, schemas: [performanceSummarySchema] },
  '/performance-trend': { useCommon: true, schemas: [performanceTrendSchema] },
  '/performance-drilldown': { useCommon: true, schemas: [performanceDrilldownSchema] },
  '/performance-org-heatmap': { useCommon: true, schemas: [performanceOrgHeatmapSchema] },
  '/performance-top-salesman': { useCommon: true, schemas: [performanceTopSalesmanSchema] },
  '/performance-bundle': { useCommon: true, schemas: [performanceBundleSchema] },

  // ── 报表 / 计划 ─────────────────────────────────
  '/marketing-report': { useCommon: true, schemas: [marketingReportSchema] },
  '/holiday-drilldown': { useCommon: true, schemas: [holidayDrilldownSchema] },
  '/premium-report': { useCommon: true, schemas: [premiumReportExtraSchema] },
  '/premium-plan': { schemas: [premiumPlanSchema] },
  '/plan-achievement': { schemas: [planAchievementSchema] },

  // ── 仪表盘聚合 ──────────────────────────────────
  '/dashboard-bundle': { useCommon: true, schemas: [dashboardBundleSchema] },

  // ── 报价转化（quoteFilterSchema + 各自散读 + commonFilterSchema 净化子集） ─────────────
  // handler 均经 buildQuoteEffectiveQuery() 把 commonFilterSchema 净化子集叠加进 whereClause
  // （quote-conversion.ts），QUOTE_UNSUPPORTED_COMMON_EXCEPT 是该净化的字段名级镜像。
  '/quote-conversion/kpi': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema] },
  '/quote-conversion/funnel': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema] },
  '/quote-conversion/drilldown': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema], extraKeys: ['level'] },
  '/quote-conversion/heatmap': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema], extraKeys: ['colDimension'] },
  '/quote-conversion/price': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema] },
  '/quote-conversion/ranking': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema], extraKeys: ['dimension'] },
  '/quote-conversion/trend': { useCommon: true, useCommonExcept: QUOTE_UNSUPPORTED_COMMON_EXCEPT, schemas: [quoteFilterSchema], extraKeys: ['granularity'] },

  // ── 客户来源去向（customerFlowFilterSchema + commonFilterSchema 净化子集） ────────────
  // handler 均经 sanitizeFlowQuery() 把 commonFilterSchema 净化子集叠加进 whereClause
  // （customer-flow.ts，含 /metadata），FLOW_UNSUPPORTED_COMMON_EXCEPT 是该净化的字段名级镜像。
  '/customer-flow/summary': { useCommon: true, useCommonExcept: FLOW_UNSUPPORTED_COMMON_EXCEPT, schemas: [customerFlowFilterSchema] },
  '/customer-flow/inflow': { useCommon: true, useCommonExcept: FLOW_UNSUPPORTED_COMMON_EXCEPT, schemas: [customerFlowFilterSchema] },
  '/customer-flow/outflow': { useCommon: true, useCommonExcept: FLOW_UNSUPPORTED_COMMON_EXCEPT, schemas: [customerFlowFilterSchema] },
  '/customer-flow/trend': { useCommon: true, useCommonExcept: FLOW_UNSUPPORTED_COMMON_EXCEPT, schemas: [customerFlowFilterSchema] },
  '/customer-flow/metadata': { useCommon: true, useCommonExcept: FLOW_UNSUPPORTED_COMMON_EXCEPT },

  // ── 维修资源 v1 ─────────────────────────────────
  '/repair/overview': { schemas: [repairFilterSchema] },
  '/repair/detail': { schemas: [repairFilterSchema], extraKeys: ['page', 'pageSize'] },
  '/repair/status': { schemas: [repairFilterSchema] },
  '/repair/metadata': {},

  // ── 赔案明细（claims-detail.ts parseFilters 手写解析） ────
  '/claims-detail/pending-overview': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/pending-by-org': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/pending-aging': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/cause-analysis': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/geo-accident': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/geo-plate': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/geo-comparison': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/claim-cycle': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/frequency-yoy': { extraKeys: CLAIMS_DETAIL_FILTER_KEYS },
  '/claims-detail/loss-ratio-development': { extraKeys: [...CLAIMS_DETAIL_FILTER_KEYS, 'cohortYears'] },
  // heatmap 不走 parseFilters，散读独立字段集（claims-detail.ts /heatmap handler）
  '/claims-detail/heatmap': {
    extraKeys: [
      'orgName', 'customerCategory', 'isNev', 'coverageCombination', 'coverageCombinations',
      'isTransfer', 'vehicleQuickFilter', 'businessNature', 'isNewCar', 'isRenewal',
      'dimension', 'dateField', 'claimsDateField', 'policyYear', 'customCutoffs',
    ],
  },

  // ── 续保跟踪（renewal-tracker.ts 散读） ─────────────────
  '/renewal-tracker': {
    extraKeys: [
      'start', 'end', 'cutoff', 'orgNames', 'salesmanNames', 'customerCategories',
      'coverageCombinations', 'fuelCategories', 'usedTransferTypes', 'renewalTypes',
      'isNev', 'isNewCar', 'isTransfer', 'isRenewal',
    ],
  },

  // ── 保单地理 ────────────────────────────────────
  '/policy-geo/province': { useCommon: true },
  '/policy-geo/city': { useCommon: true, extraKeys: ['province'] },

  // ── 费用发展（commonFilterSchema 直接调用，日期字段被忽略） ──
  '/expense-development': { useCommon: true, extraKeys: ['cohortYears'] },

  // ── 透视 / SQL 直通 ─────────────────────────────
  '/pivot': { useCommon: true, extraKeys: ['dimensions', 'metrics', 'limit'] },
  // ── 语义层 cube（PolicyFact 路径 parseFiltersAndBuildWhere=useCommon；续保路径散读受限字段）──
  '/cube': {
    useCommon: true,
    extraKeys: [
      'metric', 'dimensions', 'dims', 'limit',
      'start', 'end', 'cutoff',
      'salesmanNames', 'coverageCombinations', 'fuelCategories',
      'usedTransferTypes', 'renewalTypes',
      'isNev', 'isNewCar', 'isTransfer', 'isRenewal',
    ],
  },
  '/sql': { extraKeys: ['sql'] },
};

/** 合成某路由的合法参数名集合（zod keys ∪ common keys ∪ extraKeys ∪ pathParams） */
export function contractAllowedKeys(contract: RouteParamContract): Set<string> {
  const keys = new Set<string>();
  if (contract.useCommon) {
    const excluded = new Set(contract.useCommonExcept ?? []);
    for (const k of Object.keys(commonFilterSchema.shape)) {
      if (!excluded.has(k)) keys.add(k);
    }
  }
  for (const schema of contract.schemas ?? []) {
    for (const k of Object.keys(schema.shape)) keys.add(k);
  }
  for (const k of contract.extraKeys ?? []) keys.add(k);
  for (const k of contract.pathParams ?? []) keys.add(k);
  return keys;
}

function extractEnumValues(field: z.ZodTypeAny): string[] | null {
  // 用 zod 4 公开 API .unwrap() 解包 Optional/Nullable；ZodDefault 没有公开 unwrap，
  // 本项目未发现 enum 包在 default 里的用例，故不支持（出现时返回 null，warning 路径兜底）。
  // zod 4 内部 $ZodType vs 用户面 ZodType 类型割裂，unwrap() 返回值需 cast 回 ZodTypeAny。
  let inner: z.ZodTypeAny = field;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
    inner = inner.unwrap() as z.ZodTypeAny;
  }
  if (inner instanceof z.ZodEnum) {
    // zod 4 enum 支持 string|number，本项目 catalog enum 均为字符串；统一 toString 后比对。
    return inner.options.map((v) => String(v));
  }
  return null;
}

/**
 * 提取契约中所有 zod 字段的 enum 合法值集合。
 * 同一字段在多个 schema 里同时声明 enum 时取并集（罕见；正常一个字段只在一处声明）。
 * 返回 Map<fieldName, sortedEnumValues>；非 enum 字段不出现在结果里。
 */
export function contractZodEnums(contract: RouteParamContract): Map<string, string[]> {
  const result = new Map<string, Set<string>>();
  const collect = (shape: z.ZodRawShape) => {
    for (const [name, field] of Object.entries(shape)) {
      // zod 4 ZodRawShape 的 value 推断为 $ZodType（内部基础类型），
      // 与 extractEnumValues 期望的用户面 ZodTypeAny 类型不互通，需 cast。
      const values = extractEnumValues(field as unknown as z.ZodTypeAny);
      if (!values) continue;
      if (!result.has(name)) result.set(name, new Set());
      for (const v of values) result.get(name)!.add(v);
    }
  };
  if (contract.useCommon) {
    const excluded = new Set(contract.useCommonExcept ?? []);
    const filteredShape = Object.fromEntries(
      Object.entries(commonFilterSchema.shape).filter(([k]) => !excluded.has(k))
    ) as z.ZodRawShape;
    collect(filteredShape);
  }
  for (const schema of contract.schemas ?? []) collect(schema.shape);
  return new Map([...result.entries()].map(([k, set]) => [k, [...set].sort()]));
}
