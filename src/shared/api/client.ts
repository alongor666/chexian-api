/**
 * 后端 API 客户端
 * Backend API Client
 *
 * 封装所有后端 API 调用，处理认证和错误
 *
 * 传输层（token 生命周期 / request / GET 合并 / 超时 / 401 刷新 /
 * queryGet / drilldownGet）已抽到 ./client-core 的 ApiClientCore 基类；
 * 本文件的 ApiClient 仅保留各业务域方法（Phase 1 拆分）。
 */

// 类型定义集中管理在 types.ts
export type {
  ApiResponseMeta, AuthData, AccessUser, AccessRole, ApiTokenInfo, CreatedToken,
  CapabilityInfo, DetectRequirementResponse,
  KpiData, KpiDetailData, TrendData, QualityBusinessTrendData,
  CrossSellBundleResponse, PerformanceBundleResponse, DashboardBundleResponse,
  ComprehensiveTabKey, ComprehensiveFilterParams, ComprehensiveBundleResponse,
  FileInfo, LoadResult,
} from './types';

import type {
  AuthData, AccessUser, AccessRole, ApiTokenInfo, CreatedToken,
  KpiData, KpiDetailData, TrendData, QualityBusinessTrendData,
  DashboardBundleResponse,
  ComprehensiveFilterParams, ComprehensiveBundleResponse,
} from './types';

import {
  QUERY_ROUTES,
  AUTH_ROUTES,
  FILTER_ROUTES,
} from './routes';

import { ApiClientCore, API_BASE } from './client-core';
import { QuoteConversionApi } from './quote-conversion-api';
import { ClaimsDetailApi } from './claims-detail-api';
import { RepairApi } from './repair-api';
import { CrossSellApi } from './cross-sell-api';
import { PerformanceApi } from './performance-api';
import { CustomerFlowApi } from './customer-flow-api';
import { AiApi } from './ai-api';
import { DataApi } from './data-api';
import { WorkflowsApi } from './workflows-api';

// 传输层常量与错误类型从 client-core 统一导出，保持对外导入面不变
export { API_BASE, ENABLE_BUNDLE_ROUTES, RequestAbortError, isRequestAbortError } from './client-core';

/**
 * API 客户端类（业务域方法层）
 *
 * 继承 ApiClientCore 复用同一份传输状态（单实例 token / inflight maps），
 * 故所有域方法通过 this.request / this.queryGet / this.drilldownGet 等
 * protected 成员发起请求。
 */
class ApiClient extends ApiClientCore {
  // ── 命名空间子客户端（Phase 2，按域逐步迁入；复用 this.transport 单实例传输）──
  // ⚠️ 不变量：传输句柄 transport 必须留在基类 ApiClientCore 的字段；子客户端字段
  //    在此子类初始化，依赖「基类字段先于子类字段初始化」语义才能读到已就绪的
  //    this.transport。后续各域 `readonly xxx = new XxxApi(this.transport)` 同此约束，
  //    切勿把 transport 挪到子类（会读到 undefined）。
  /** 报价转化分析：apiClient.quoteConversion.{kpi,funnel,drilldown,heatmap,price,trend,ranking} */
  readonly quoteConversion = new QuoteConversionApi(this.transport);
  /** 赔案明细：apiClient.claimsDetail.{pendingOverview,pendingByOrg,pendingAging,causeAnalysis,geoAccident,geoPlate,geoComparison,claimCycle,frequencyYoy,lossRatioDev,heatmap} */
  readonly claimsDetail = new ClaimsDetailApi(this.transport);
  /** 维修资源：apiClient.repair.{overview,detail,status,metadata,city,channel,coopTier,scatter,localResource,toPremium,diversionList,orphanShops} */
  readonly repair = new RepairApi(this.transport);
  /** 车驾意交叉销售：apiClient.crossSell.{analysis,timePeriod,trend,topSalesman,bundle,orgTrend,heatmap} */
  readonly crossSell = new CrossSellApi(this.transport);
  /** 业绩分析：apiClient.performance.{summary,trend,drilldown,orgHeatmap,topSalesman,bundle} */
  readonly performance = new PerformanceApi(this.transport);
  /** 客户来源去向：apiClient.customerFlow.{summary,inflow,outflow,trend,metadata} */
  readonly customerFlow = new CustomerFlowApi(this.transport);
  /** AI：apiClient.ai.{analyzeTrend,detectRequirement,capabilities,quickSuggestions} */
  readonly ai = new AiApi(this.transport);
  /** 数据管理：apiClient.data.{files,load,upload,remove,version} */
  readonly data = new DataApi(this.transport);
  /** 工作流：apiClient.workflows.{run,audit,approve,reject,runsHealth} */
  readonly workflows = new WorkflowsApi(this.transport);

  // ============================================
  // 认证 API
  // ============================================

  /**
   * 登录
   */
  async login(username: string, password: string): Promise<AuthData> {
    const result = await this.request<AuthData>(`/${AUTH_ROUTES.LOGIN}`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (result.token) {
      this.setToken(result.token);
    } else {
      this.setSessionCookieHint(true);
    }
    return result;
  }

  async getCurrentUser(): Promise<AuthData['user']> {
    const user = await this.request<AuthData['user']>(`/${AUTH_ROUTES.ME}`);
    this.setSessionCookieHint(true);
    return user;
  }

  async listUsers(): Promise<AccessUser[]> {
    return this.request<AccessUser[]>(`/${AUTH_ROUTES.USERS}`);
  }

  async createUser(payload: {
    username: string;
    displayName: string;
    password: string;
    role: string;
    organization?: string;
    allowedRoutes?: string[];
    defaultRoute?: string;
    allowedIps?: string[];
    specialFeatures?: string[];
    active?: boolean;
  }): Promise<AccessUser> {
    return this.request<AccessUser>(`/${AUTH_ROUTES.USERS}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateUser(
    id: string,
    payload: {
      displayName: string;
      password?: string;
      role: string;
      organization?: string;
      allowedRoutes?: string[];
      defaultRoute?: string;
      allowedIps?: string[];
      specialFeatures?: string[];
      active?: boolean;
    }
  ): Promise<AccessUser> {
    return this.request<AccessUser>(`/${AUTH_ROUTES.USER_BY_ID}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(`/${AUTH_ROUTES.USER_BY_ID}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ─── PAT (Personal Access Token) ─────────────────────────
  async listMyTokens(): Promise<ApiTokenInfo[]> {
    return this.request<ApiTokenInfo[]>('/auth/tokens');
  }

  async createMyToken(payload: { name: string; ttlDays: 30 | 90 | 180 | 365 }): Promise<CreatedToken> {
    return this.request<CreatedToken>('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async revokeMyToken(tokenId: string): Promise<void> {
    await this.request(`/auth/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
  }

  async listRoles(): Promise<AccessRole[]> {
    return this.request<AccessRole[]>(`/${AUTH_ROUTES.ROLES}`);
  }

  async createRole(payload: {
    role: string;
    name: string;
    dataScope: 'all' | 'org' | 'telemarketing';
    allowedRoutes?: string[];
    defaultRoute?: string;
  }): Promise<AccessRole> {
    return this.request<AccessRole>(`/${AUTH_ROUTES.ROLES}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateRole(
    role: string,
    payload: {
      name: string;
      dataScope: 'all' | 'org' | 'telemarketing';
      allowedRoutes?: string[];
      defaultRoute?: string;
    }
  ): Promise<AccessRole> {
    return this.request<AccessRole>(`/${AUTH_ROUTES.ROLE_BY_ID}/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteRole(role: string): Promise<void> {
    await this.request(`/${AUTH_ROUTES.ROLE_BY_ID}/${encodeURIComponent(role)}`, {
      method: 'DELETE',
    });
  }

  /**
   * 获取企微登录配置
   */
  async getWeComConfig(): Promise<{ corpId: string; agentId: string; callbackUrl: string }> {
    return this.request(`/${AUTH_ROUTES.WECOM_CONFIG}`);
  }

  /**
   * 登出
   */
  logout(): void {
    void Promise.resolve(fetch(`${API_BASE}/${AUTH_ROUTES.LOGOUT}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })).catch(() => undefined);
    this.clearToken();
    // 触发登出事件，通知 DataContext 切换数据源
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth-logout'));
    }
  }

  // 数据管理 API（getFiles/loadFile/uploadFile/deleteFile）已迁出至 data 子客户端（见类首字段 + data-api.ts）

  // ============================================
  // 查询 API
  // ============================================

  async getKpi(filters?: Record<string, any>): Promise<KpiData> { return this.queryGet<KpiData>(QUERY_ROUTES.KPI, filters); }
  async getKpiDetail(filters?: Record<string, any>): Promise<KpiDetailData> { return this.queryGet<KpiDetailData>(QUERY_ROUTES.KPI_DETAIL, filters); }
  async getTrend(granularity: 'day' | 'week' | 'month' = 'day', filters?: Record<string, any>): Promise<TrendData[]> { return this.queryGet<TrendData[]>(QUERY_ROUTES.TREND, filters, { granularity }); }
  async getQualityBusinessTrend(granularity: 'day' | 'week' | 'month' = 'day', filters?: Record<string, any>): Promise<QualityBusinessTrendData[]> { return this.queryGet<QualityBusinessTrendData[]>(QUERY_ROUTES.QUALITY_BUSINESS_TREND, filters, { granularity }); }
  async getTruckAnalysis(filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.TRUCK, filters); }
  async getGrowthAnalysis(startDate: string, endDate: string, baselineStart: string, baselineEnd: string, filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.GROWTH, filters, { startDate, endDate, baselineStart, baselineEnd }); }
  async getCostAnalysis(filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.COST, filters); }
  async getComprehensiveBundle(params?: ComprehensiveFilterParams): Promise<ComprehensiveBundleResponse> { return this.queryGet<ComprehensiveBundleResponse>(QUERY_ROUTES.COMPREHENSIVE_BUNDLE, params as Record<string, unknown>); }

  // getDataVersion 已迁出至 data 子客户端（见类首字段 + data-api.ts；调用方改用 apiClient.data.version()）

  // 车驾意交叉销售 API（analysis/timePeriod/trend）已迁出至 crossSell 子客户端（见类首字段 + cross-sell-api.ts）

  /**
   * 获取业务员排名
   */
  async getSalesmanRanking(
    limit: number = 20,
    filters?: Record<string, any>
  ): Promise<any[]> {
    const query = this.buildQueryString(filters, { limit: String(limit) });
    return this.request(`/query/${QUERY_ROUTES.SALESMAN_RANKING}?${query}`);
  }

  // 车驾意交叉销售 API（topSalesman/bundle）已迁出至 crossSell 子客户端（见类首字段 + cross-sell-api.ts）

  // 业绩分析 API（summary/trend/drilldown/orgHeatmap/topSalesman/bundle）已迁出至 performance 子客户端（见类首字段 + performance-api.ts）

  /**
   * 获取仪表盘聚合数据（kpi + trend + ranking + rose）
   */
  async getDashboardBundle(params?: Record<string, any>): Promise<DashboardBundleResponse> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.DASHBOARD_BUNDLE}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取营销战报数据
   */
  async getMarketingReport(params?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.MARKETING_REPORT}${query ? `?${query}` : ''}`);
  }

  async getHolidayDrilldown(params?: Record<string, any>): Promise<any[]> {
    return this.queryGet(QUERY_ROUTES.HOLIDAY_DRILLDOWN, params);
  }

  /**
   * 获取保费报表数据（机构汇总 / 业务员明细）
   */
  async getPremiumReport(params?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.PREMIUM_REPORT}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取保费达成下钻数据（六级下钻 + KPI + 达成率分布）
   */
  async getPremiumPlan(params?: Record<string, any>): Promise<any> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.PREMIUM_PLAN}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取保费达成面板数据（合并端点：1 次请求返回 children + summary + distribution）
   *
   * 替代原来的 3 次 getPremiumPlan() 调用，性能提升 3x。
   * 返回结构：{ children: [...], summary: {...}, distribution: [...], meta: {...} }
   */
  async getPlanAchievement(params?: {
    planYear?: number;
    level?: string;
    orgFilter?: string;
    teamFilter?: string;
    salesmanFilter?: string;
    customerCategoryFilter?: string;
    sortField?: string;
    sortOrder?: string;
  }): Promise<{
    children: any[];
    summary: any | null;
    distribution: any[];
    meta: { plan_year: number; level: string };
  }> {
    const query = this.buildQueryString(params);
    const resp = await this.request<{
      children: any[];
      summary: any | null;
      distribution: any[];
      meta: { plan_year: number; level: string };
      data?: {
        children: any[];
        summary: any | null;
        distribution: any[];
        meta: { plan_year: number; level: string };
      };
    }>(`/query/${QUERY_ROUTES.PLAN_ACHIEVEMENT}${query ? `?${query}` : ''}`);
    return resp.data ?? resp;
  }

  // ============================================
  // 筛选器 API
  // ============================================

  /**
   * 获取筛选器选项
   */
  async getFilterOptions(): Promise<{
    orgs: string[];
    visibleOrganizations?: string[];
    salesmen: string[];
    salesmenWithOrg?: { salesman_name: string; org_level_3: string }[];
    salesmenWithTeam?: { salesman_name: string; team_name: string; org_name: string }[];
    customerCategories: string[];
    coverageCombinations: string[];
    dateRange?: { min_date: string | null; max_date: string | null };
    availableYears?: number[];
    insuranceGrades: Array<{ value: string; count: number }>;
  }> {
    return this.request(`/${FILTER_ROUTES.OPTIONS}`);
  }

  // 车驾意交叉销售 API（orgTrend/heatmap）已迁出至 crossSell 子客户端（见类首字段 + cross-sell-api.ts）

  // AI API（analyzeTrend/detectRequirement/capabilities/quickSuggestions）已迁出至 ai 子客户端（见类首字段 + ai-api.ts）

  // ── 巡检报告 ──

  async getPatrolReport(domain: string) {
    return this.request<{ report: any; domain: string; source: string }>(`/query/${QUERY_ROUTES.PATROL}/${domain}`);
  }

  async getPatrolNarrative(domain: string) {
    return this.request<{ content: string; generatedAt: string | null; domain: string }>(`/query/${QUERY_ROUTES.PATROL}/${domain}/narrative`);
  }

  // 维修资源 API（v1 + v2）已迁出至 repair 子客户端（见类首字段 + repair-api.ts）

  // 客户来源去向 API（summary/inflow/outflow/trend/metadata）已迁出至 customerFlow 子客户端（见类首字段 + customer-flow-api.ts）

  // 报价转化分析 API 已迁出至 quoteConversion 子客户端（见类首字段 + quote-conversion-api.ts）

  // 赔案明细 API 已迁出至 claimsDetail 子客户端（见类首字段 + claims-detail-api.ts）

  async getExpenseRatioDev(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.EXPENSE_DEVELOPMENT}${query ? `?${query}` : ''}`);
  }
  // ── 承保地理分布 ──

  async getPolicyGeoProvince(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.POLICY_GEO.PROVINCE}${query ? `?${query}` : ''}`);
  }

  async getPolicyGeoCity(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.POLICY_GEO.CITY}${query ? `?${query}` : ''}`);
  }

  // ── 续保追踪 ──

  // Workflows API（run/audit/approve/reject/runsHealth）已迁出至 workflows 子客户端（见类首字段 + workflows-api.ts）

  async getRenewalTracker(params: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<{
      orgRows: Array<{ row_level: string; org_level_3: string | null; team_name: string | null; salesman_name: string | null; customer_category: string | null; A: number; B: number; C: number }>;
      categoryRows: Array<{ row_level: string; org_level_3: string | null; team_name: string | null; salesman_name: string | null; customer_category: string | null; A: number; B: number; C: number }>;
      overall: { row_level: string; A: number; B: number; C: number } | null;
      meta?: { exposure_row_count: number; distinct_vehicle_count: number; distinct_source_policy_count: number; latest_data_date: string | null } | null;
    }>(`/query/${QUERY_ROUTES.RENEWAL_TRACKER}${query ? `?${query}` : ''}`);
  }
}

// 导出单例
export const apiClient = new ApiClient();
