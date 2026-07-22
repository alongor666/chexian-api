/**
 * API 类型定义
 * 从 client.ts 提取，集中管理所有 API 接口/响应类型
 */

/** API 响应格式 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  meta?: ApiResponseMeta;
  error?: {
    message: string;
    statusCode: number;
  };
  message?: string;
}

export interface ApiResponseMeta {
  requestId?: string;
  cacheHit?: boolean;
  serverTiming?: string;
  dataVersion?: string;
}

/** 认证信息 */
export interface AuthData {
  token?: string;
  user: {
    username: string;
    displayName: string;
    role: string;
    organization?: string;
    /** 分公司编码（'SC' / 'SX'）；全国超管为默认省 */
    branchCode?: string;
    /** 全国超管可切换/合并的省集合（如 ['SC','SX']）。普通用户 undefined → 不显示切省下拉 */
    visibleBranches?: string[];
    /** 机器调用使用的规范化分公司范围；避免根据 visibleBranches 缺失/脏值猜权限。 */
    branchScope?: {
      defaultBranch?: string;
      visibleBranches: string[];
      canSwitch: boolean;
      canAggregateAll: boolean;
    };
    allowedRoutes?: string[];
    defaultRoute?: string;
    /** pns：该账号尚未自设专属密码，须先设密才能访问业务页（密码登录与飞书登录都可能出现） */
    mustChangePassword?: boolean;
    /** 账号当前是否存在可验证的旧密码凭据（false → 设密页走「首次设密」模式，免填当前密码） */
    hasPassword?: boolean;
    authMethods?: Array<'password' | 'feishu'>;
    canChangePassword?: boolean;
    specialFeatures?: string[];
    /** 模块负面清单：该用户不可访问的前端页面路径（服务端按 RESTRICTED_MODULES 派生回传） */
    deniedModules?: string[];
  };
}

export interface AccessUser extends Record<string, unknown> {
  id: string;
  username: string;
  displayName: string;
  role: string;
  organization?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active: boolean;
}

export interface AccessRole extends Record<string, unknown> {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes?: string[];
  defaultRoute?: string;
}

/** API Token 信息（不含明文/哈希） */
export interface ApiTokenInfo {
  tokenId: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
}

/** 创建 PAT 的返回：包含明文 token（仅此次可见） */
export interface CreatedToken {
  token: string;
  tokenId: string;
  name: string;
  createdAt: string;
  expiresAt: string;
}

/** AI 能力信息 */
export interface CapabilityInfo {
  id: string;
  route: string;
  name: string;
  icon: string;
  description: string;
  keywords: string[];
  exampleQueries: string[];
  requiresPermission?: string;
}

/** AI 需求识别响应 */
export interface DetectRequirementResponse {
  success: boolean;
  type: 'match' | 'clarify' | 'no_match';
  capabilities?: CapabilityInfo[];
  followUp?: string;
  options?: string[];
  suggestion?: string;
  source?: string;
  elapsed_ms?: number;
}

/** KPI 数据 */
export interface KpiData {
  latest_policy_date: string | null;
  vehicle_plan_wan: number | null;
  vehicle_premium: number;
  /** 满期保费（元，闰年感知） */
  earned_premium: number | null;
  /** 满期率（满期保费 / 同口径签单保费，百分数） */
  maturity_rate: number | null;
  vehicle_achievement_rate: number | null;
  vehicle_growth_rate: number | null;
  variable_cost_ratio: number | null;
  /** 满期赔付率（变动成本率分项；已报告赔款 / 满期保费） */
  earned_claim_ratio: number | null;
  /** 费用率（变动成本率分项；费用金额 / 签单保费） */
  expense_ratio: number | null;
  bundle_renewal_rate: number | null;
  driver_premium: number;
  driver_achievement_rate: number | null;
  driver_growth_rate: number | null;
  total_premium: number;
  policy_count: number;
  salesman_count: number;
  org_count: number;
  per_capita_premium: number;
  per_vehicle_premium: number;
  renewal_rate: number;
  new_car_rate: number;
  nev_rate: number;
  quality_business_rate: number;
  commercial_insurance_rate: number;
  commercial_rate: number;
  telesales_rate: number;
  transfer_rate: number;
}

/** KPI 详细数据（用于环形图展示） */
export interface KpiDetailData {
  total_premium: number;
  policy_count: number;
  per_capita_premium: number;
  transfer_count: number;
  non_transfer_count: number;
  telesales_count: number;
  non_telesales_count: number;
  renewal_count: number;
  non_renewal_count: number;
  commercial_premium: number;
  non_commercial_premium: number;
  nev_count: number;
  non_nev_count: number;
  new_car_count: number;
  non_new_car_count: number;
  quality_business_count?: number;
  non_quality_business_count?: number;
  grade_ab_count?: number;
  grade_cd_count?: number;
  grade_efg_count?: number;
  coverage_danjiao_count?: number;
  coverage_jiaosan_count?: number;
  coverage_zhuquan_count?: number;
  coverage_other_count?: number;
  vehicle_truck_count?: number;
  vehicle_bus_count?: number;
  vehicle_motorcycle_count?: number;
  vehicle_other_count?: number;
  same_city_premium?: number;
  remote_premium?: number;
}

/** 趋势数据 */
export interface TrendData {
  time_period: string;
  premium: number;
  org_level_3?: string;
  next_month_ratio?: number;
  count?: number;
}

/** 优质业务占比趋势数据 */
export interface QualityBusinessTrendData {
  time_period: string;
  quality_premium: number;
  total_premium: number;
  quality_ratio: number;
}

export interface CrossSellBundleResponse {
  summary: {
    maxDate: string | null;
    rows: Array<Record<string, unknown>>;
  };
  trend: {
    rows: Array<{
      time_period: string;
      coverage_combination: string;
      rate: number;
      avg_premium: number;
      auto_count: number;
    }>;
  };
  drilldown: {
    summary: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
    drillPath: Array<{ dimension: string; value: string }>;
    groupBy: string | null;
  };
  topSalesman: {
    zhuquanRows: Array<{
      salesman_name: string;
      org_level_3: string;
      driver_premium: number;
      auto_count: number;
      rate: number;
      avg_premium: number;
    }>;
    jiaosanRows: Array<{
      salesman_name: string;
      org_level_3: string;
      driver_premium: number;
      auto_count: number;
      rate: number;
      avg_premium: number;
    }>;
  };
}

export interface PerformanceBundleResponse {
  summary: {
    rows: Array<Record<string, unknown>>;
  };
  trend: {
    rows: Array<Record<string, unknown>>;
  };
  drilldown: {
    summary: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
    drillPath: Array<{ dimension: string; value: string }>;
    groupBy: string | null;
  };
  topSalesman: {
    rows: Array<Record<string, unknown>>;
  };
}

export interface DashboardBundleResponse {
  kpi: KpiData;
  kpiDetail: KpiDetailData;
  trend: TrendData[];
  qualityTrend: QualityBusinessTrendData[];
  ranking: {
    allBusinessTop: Array<Record<string, unknown>>;
    qualityBusinessTop: Array<Record<string, unknown>>;
  };
  rose: {
    customerCategory: Array<{ dim_key: string; value: number }>;
    coverageCombination: Array<{ dim_key: string; value: number }>;
    terminalSource: Array<{ dim_key: string; value: number }>;
  };
}

export type ComprehensiveTabKey = 'overview' | 'premium' | 'cost' | 'loss' | 'expense' | 'roi';

export interface ComprehensiveFilterParams extends Record<string, string | number | boolean | undefined> {
  cutoffDate?: string;
  planYear?: number;
  granularity?: 'daily' | 'weekly' | 'monthly';
}

export interface ComprehensiveBundleResponse {
  meta: {
    cutoffDate: string;
    maxDataDate: string | null;
    planYear: number;
    orgScope: string[];
    permissionFilter: string;
    thresholds: {
      premiumProgressWarn: number;
      costRateWarn: number;
      lossRateWarn: number;
      expenseRateWarn: number;
      expenseBudget: number;
    };
    timeProgress?: number | null;
  };
  overview: {
    summary: Record<string, number | null>;
    rows: Array<Record<string, unknown>>;
    alerts: string[];
  };
  premium: {
    rows: Array<Record<string, unknown>>;
  };
  cost: {
    rows: Array<Record<string, unknown>>;
  };
  loss: {
    quadrantRows: Array<Record<string, unknown>>;
    trendRows: Array<Record<string, unknown>>;
  };
  expense: {
    rows: Array<Record<string, unknown>>;
    surplusRows: Array<Record<string, unknown>>;
  };
  roi: {
    rows: Array<Record<string, unknown>>;
  };
}

/** 文件信息 */
export interface FileInfo {
  filename: string;
  sizeMB: number;
  modifiedTime: string;
  isCurrent: boolean;
}

/** 加载结果 */
export interface LoadResult {
  filename: string;
  rowCount: number;
  fileSizeMB: number;
}

// ─── 货车分析 ───────────────────────────────────────────────

/** 货车分析 — 玫瑰图数据行（按吨位/车型聚合） */
export interface TruckRoseRow {
  name: string;
  value: number;
  [key: string]: unknown;
}

/** 货车分析 — 机构按吨位分组数据行 */
export interface TruckTonnageByOrgRow {
  org_level_3: string;
  tonnage_segment: string;
  premium: number;
  premium_ratio: number;
  [key: string]: unknown;
}

/** 货车分析 — `queryType=all` 时的聚合响应 */
export interface TruckAnalysisResponse {
  rosePremium: TruckRoseRow[];
  roseCount: TruckRoseRow[];
  tonnageByOrg: TruckTonnageByOrgRow[];
  orgPremium: Array<{ org_level_3: string; premium: number; [key: string]: unknown }>;
}

// ─── 增长分析 ───────────────────────────────────────────────

/** 增长分析数据行（同比/环比/YTD） */
export interface GrowthAnalysisRow {
  time_period?: string;
  period?: string;
  current_value?: number;
  current_premium?: number;
  previous_value?: number;
  previous_premium?: number;
  growth_rate?: number | null;
  org_level_3?: string;
  salesman_name?: string;
  period_total_current?: number;
  period_total_previous?: number;
  period_growth_rate?: number;
  ytd_total_current?: number;
  ytd_total_previous?: number;
  ytd_growth_rate?: number;
  [key: string]: unknown;
}

// ─── 成本分析 ───────────────────────────────────────────────

/** 成本分析通用数据行（赔付率/费用率/综合成本/变动成本均通过此类型） */
export type CostAnalysisRow = Record<string, unknown>;

// ─── 车驾意推介率下钻 ───────────────────────────────────────

/** 车驾意推介率下钻响应 */
export interface CrossSellDrilldownResponse {
  summary: Record<string, unknown> | null;
  rows: Array<Record<string, unknown>>;
  drillPath: Array<{ dimension: string; value: string }>;
  groupBy: string | null;
}

// ─── 业务员排名 ─────────────────────────────────────────────

/** 业务员排名数据行 */
export interface SalesmanRankingRow {
  salesman_name: string;
  org_level_3: string;
  total_premium: number;
  policy_count: number;
  [key: string]: unknown;
}

// ─── 营销战报 ───────────────────────────────────────────────

/** 营销战报数据行（机构维度） */
export interface MarketingReportRow {
  [key: string]: unknown;
}

// ─── 假日营销下钻 ───────────────────────────────────────────

/** 假日营销自由维度下钻数据行 */
export interface HolidayDrilldownRow {
  group_name: string;
  premium_wan: number;
  commercial_premium_wan: number;
  [key: string]: unknown;
}

// ─── 保费报表 ───────────────────────────────────────────────

/** 保费报表数据行（机构/业务员维度，列名含中文） */
export type PremiumReportRow = Record<string, unknown>;

// ─── 保费达成下钻 ───────────────────────────────────────────

/** 保费达成下钻数据行 */
export type PremiumPlanRow = Record<string, unknown>;

// ─── PIVOT 交叉聚合（维度 × 指标） ───────────────────────────

/** PIVOT 聚合单行：维度列 + 指标列（值均由指标别名回填） */
export type PivotRow = Record<string, string | number | null>;

/** PIVOT /api/query/pivot 响应内层数据 */
export interface PivotResult {
  dimensions: string[];
  metrics: string[];
  rowCount: number;
  rows: PivotRow[];
}
