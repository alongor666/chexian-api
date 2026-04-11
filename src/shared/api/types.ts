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
    allowedRoutes?: string[];
    defaultRoute?: string;
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
  vehicle_achievement_rate: number | null;
  vehicle_growth_rate: number | null;
  variable_cost_ratio: number | null;
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
