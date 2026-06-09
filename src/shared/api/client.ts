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
  ApiResponse, AuthData, AccessUser, AccessRole, ApiTokenInfo, CreatedToken,
  CapabilityInfo, DetectRequirementResponse,
  KpiData, KpiDetailData, TrendData, QualityBusinessTrendData,
  CrossSellBundleResponse, PerformanceBundleResponse, DashboardBundleResponse,
  ComprehensiveFilterParams, ComprehensiveBundleResponse,
  FileInfo, LoadResult,
} from './types';

import {
  QUERY_ROUTES,
  DATA_ROUTES,
  AUTH_ROUTES,
  AI_ROUTES,
  FILTER_ROUTES,
  WORKFLOWS_ROUTES,
} from './routes';

import { ApiClientCore, API_BASE } from './client-core';
import { QuoteConversionApi } from './quote-conversion-api';

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

  // ============================================
  // 数据管理 API
  // ============================================

  /**
   * 获取文件列表
   */
  async getFiles(): Promise<FileInfo[]> {
    return this.request<FileInfo[]>(`/data/${DATA_ROUTES.FILES}`);
  }

  /**
   * 加载数据文件
   */
  async loadFile(filename: string): Promise<LoadResult> {
    return this.request<LoadResult>(`/data/${DATA_ROUTES.LOAD}/${encodeURIComponent(filename)}`, {
      method: 'POST',
    });
  }

  /**
   * 上传文件
   */
  async uploadFile(file: File): Promise<LoadResult> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE}/data/${DATA_ROUTES.UPLOAD}`;
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: formData,
    });

    const data: ApiResponse<LoadResult> = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || '上传失败');
    }
    return data.data as LoadResult;
  }

  /**
   * 删除文件
   */
  async deleteFile(filename: string): Promise<void> {
    await this.request(`/data/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

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

  /** 获取 ETL 数据版本（数据截止日 + 构建时间）。HomePage / SW 共用。 */
  async getDataVersion(): Promise<{ etlDate: string; buildTime: string; serverStartTime: string }> {
    return this.request<{ etlDate: string; buildTime: string; serverStartTime: string }>('/data/version');
  }

  /**
   * 获取车驾意推介率数据
   */
  async getCrossSellAnalysis(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.drilldownGet(QUERY_ROUTES.CROSS_SELL, params);
  }

  /**
   * 获取车驾意推介率 - 时间维度汇总数据
   */
  async getCrossSellTimePeriod(params?: Record<string, string>): Promise<{
    maxDate: string;
    rows: Array<{
      coverage_combination: string;
      day_auto_count: number;
      day_driver_count: number;
      day_premium: number;
      day_rate: number;
      day_avg_premium: number;
      week_auto_count: number;
      week_driver_count: number;
      week_premium: number;
      week_rate: number;
      week_avg_premium: number;
      month_auto_count: number;
      month_driver_count: number;
      month_premium: number;
      month_rate: number;
      month_avg_premium: number;
      quarter_auto_count: number;
      quarter_driver_count: number;
      quarter_premium: number;
      quarter_rate: number;
      quarter_avg_premium: number;
      year_auto_count: number;
      year_driver_count: number;
      year_premium: number;
      year_rate: number;
      year_avg_premium: number;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.CROSS_SELL_SUMMARY}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取车驾意推介率走势数据（按日/周/月/季粒度）
   */
  async getCrossSellTrend(params?: Record<string, string>): Promise<{
    rows: Array<{
      time_period: string;
      coverage_combination: string;
      rate: number;
      avg_premium: number;
      auto_count: number;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.CROSS_SELL_TREND}${query ? `?${query}` : ''}`);
  }

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

  /**
   * 获取车驾意推介率 TOP20 业务员分析
   */
  async getCrossSellTopSalesman(params?: Record<string, string>): Promise<{
    rows: Array<{
      salesman_name: string;
      org_level_3: string;
      driver_premium: number;
      auto_count: number;
      rate: number;
      avg_premium: number;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.CROSS_SELL_TOP_SALESMAN}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取交叉销售聚合数据（summary + trend + drilldown + topSalesman）
   */
  async getCrossSellBundle(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<CrossSellBundleResponse> {
    return this.drilldownGet<CrossSellBundleResponse>(QUERY_ROUTES.CROSS_SELL_BUNDLE, params);
  }

  /**
   * 获取业绩分析 - 险别组合业绩环比
   */
  async getPerformanceSummary(params?: Record<string, string>): Promise<{
    rows: Array<{
      coverage_combination: string;
      row_label: string;
      row_level: number;
      expand_key: string | null;
      premium: number;
      auto_count: number;
      avg_premium: number;
      plan_premium: number | null;
      achievement_rate: number | null;
      growth_rate: number | null;
      nev_rate: number;
      renewal_rate: number;
      transfer_business_rate: number;
      new_car_rate: number;
      transfer_rate: number;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.PERFORMANCE_SUMMARY}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取业绩分析 - 车险保费/件数走势
   */
  async getPerformanceTrend(params?: Record<string, string>): Promise<{
    rows: Array<{
      time_period: string;
      line_key: string;
      line_label: string;
      line_order: number;
      premium: number;
      auto_count: number;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.PERFORMANCE_TREND}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取业绩分析 - 下钻数据
   */
  async getPerformanceDrilldown(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<{
    summary: Record<string, unknown> | null;
    rows: Array<Record<string, unknown>>;
    drillPath: Array<{ dimension: string; value: string }>;
    groupBy: string | null;
  }> {
    return this.drilldownGet(QUERY_ROUTES.PERFORMANCE_DRILLDOWN, params);
  }

  /**
   * 获取业绩分析 - 三级机构15周期热力图
   */
  async getPerformanceOrgHeatmap(params?: Record<string, string>): Promise<{
    rows: Array<{
      org_level_3: string;
      policy_date: string;
      premium: number;
      plan_premium: number | null;
      prev_mom_premium: number;
      prev_yoy_premium: number;
      achievement_rate: number | null;
      mom_growth_rate: number | null;
      yoy_growth_rate: number | null;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.PERFORMANCE_ORG_HEATMAP}${query ? `?${query}` : ''}`);
  }


  /**
   * 获取业绩分析 - TOP20 业务员
   */
  async getPerformanceTopSalesman(params?: Record<string, string>): Promise<{
    rows: Array<{
      dimension_name: string;
      premium: number;
      auto_count: number;
      plan_premium: number | null;
      achievement_rate: number | null;
      growth_rate: number | null;
      nev_rate: number;
      renewal_rate: number;
      transfer_business_rate: number;
      new_car_rate: number;
      transfer_rate: number;
      quadrant?: string;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.PERFORMANCE_TOP_SALESMAN}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取业绩分析聚合数据（summary + trend + drilldown + topSalesman）
   */
  async getPerformanceBundle(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<PerformanceBundleResponse> {
    return this.drilldownGet<PerformanceBundleResponse>(QUERY_ROUTES.PERFORMANCE_BUNDLE, params);
  }

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

  /**
   * 获取机构推介率走势（最近14天，叠加柱+折线）
   */
  async getCrossSellOrgTrend(params?: Record<string, string>): Promise<{
    rows: Array<{
      date: string;
      auto_count: number;
      driver_count: number;
      rate: number;
      avg_premium: number;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.CROSS_SELL_ORG_TREND}${query ? `?${query}` : ''}`);
  }

  /**
   * 获取交叉销售热力图数据（最近14个时段 × 所有三级机构）
   */
  async getCrossSellHeatmap(params?: Record<string, string>): Promise<{
    rows: Array<{
      date: string;
      org_level_3: string;
      auto_count: number;
      driver_count: number;
      driver_policy_count: number;
      driver_premium: number;
      penetration_base_premium: number;
      rate: number;
      penetration_rate: number | null;
      avg_premium: number;
      achievement_rate: number | null;
    }>;
  }> {
    const query = this.buildQueryString(params);
    return this.request(`/query/${QUERY_ROUTES.CROSS_SELL_HEATMAP}${query ? `?${query}` : ''}`);
  }

  // ============================================
  // AI API
  // ============================================

  /**
   * AI 分析机构推介率趋势（后端读取 API Key，无需前端传）
   */
  async analyzeTrend(params: {
    rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number; avg_premium: number }>;
    org: string;
    coverage: string;
  }): Promise<{ success: boolean; analysis: string; error?: string }> {
    return this.request(`/${AI_ROUTES.TREND_ANALYSIS}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * AI 智能需求识别
   */
  async detectRequirement(params: {
    message: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<DetectRequirementResponse> {
    return this.request(`/${AI_ROUTES.DETECT_REQUIREMENT}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // ── 巡检报告 ──

  async getPatrolReport(domain: string) {
    return this.request<{ report: any; domain: string; source: string }>(`/query/${QUERY_ROUTES.PATROL}/${domain}`);
  }

  async getPatrolNarrative(domain: string) {
    return this.request<{ content: string; generatedAt: string | null; domain: string }>(`/query/${QUERY_ROUTES.PATROL}/${domain}/narrative`);
  }

  // ── 维修资源 ──

  async getRepairOverview(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.OVERVIEW}${query ? `?${query}` : ''}`);
  }
  async getRepairDetail(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.DETAIL}${query ? `?${query}` : ''}`);
  }
  async getRepairStatus(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.STATUS}${query ? `?${query}` : ''}`);
  }
  async getRepairMetadata() {
    return this.request<any>(`/query/${QUERY_ROUTES.REPAIR.METADATA}`);
  }

  // ── 维修资源 v2（2026-04-18 重设计）──

  async getRepairCity(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.CITY}${query ? `?${query}` : ''}`);
  }
  async getRepairChannel(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.CHANNEL}${query ? `?${query}` : ''}`);
  }
  async getRepairCoopTier(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.COOP_TIER}${query ? `?${query}` : ''}`);
  }
  async getRepairScatter(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.SCATTER}${query ? `?${query}` : ''}`);
  }
  async getRepairLocalResource(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.LOCAL_RESOURCE}${query ? `?${query}` : ''}`);
  }
  async getRepairToPremium(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.TO_PREMIUM}${query ? `?${query}` : ''}`);
  }
  async getRepairDiversionList(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.DIVERSION_LIST}${query ? `?${query}` : ''}`);
  }
  async getRepairOrphanShops(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.REPAIR.ORPHAN_SHOPS}${query ? `?${query}` : ''}`);
  }

  // ── 客户来源去向 ──

  async getCustomerFlowSummary(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any>(`/query/${QUERY_ROUTES.CUSTOMER_FLOW.SUMMARY}${query ? `?${query}` : ''}`);
  }
  async getCustomerFlowInflow(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CUSTOMER_FLOW.INFLOW}${query ? `?${query}` : ''}`);
  }
  async getCustomerFlowOutflow(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CUSTOMER_FLOW.OUTFLOW}${query ? `?${query}` : ''}`);
  }
  async getCustomerFlowTrend(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CUSTOMER_FLOW.TREND}${query ? `?${query}` : ''}`);
  }
  async getCustomerFlowMetadata() {
    return this.request<any>(`/query/${QUERY_ROUTES.CUSTOMER_FLOW.METADATA}`);
  }

  /**
   * 获取能力注册表
   */
  async getCapabilities(): Promise<{ success: boolean; data: CapabilityInfo[] }> {
    return this.request(`/${AI_ROUTES.CAPABILITIES}`);
  }

  /**
   * 获取首页快捷建议
   */
  async getQuickSuggestions(): Promise<{ success: boolean; data: Array<{ text: string; capabilityId: string }> }> {
    return this.request(`/${AI_ROUTES.QUICK_SUGGESTIONS}`);
  }

  // 报价转化分析 API 已迁出至 quoteConversion 子客户端（见类首字段 + quote-conversion-api.ts）

  // ── 赔案明细 ──

  async getClaimsDetailPendingOverview(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.PENDING_OVERVIEW}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailPendingByOrg(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.PENDING_BY_ORG}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailPendingAging(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.PENDING_AGING}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailCauseAnalysis(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.CAUSE_ANALYSIS}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailGeoAccident(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.GEO_ACCIDENT}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailGeoPlate(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.GEO_PLATE}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailGeoComparison(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.GEO_COMPARISON}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailClaimCycle(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.CLAIM_CYCLE}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailFrequencyYoy(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.FREQUENCY_YOY}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailLossRatioDev(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.LOSS_RATIO_DEV}${query ? `?${query}` : ''}`);
  }

  async getClaimsDetailHeatmap(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.CLAIMS_DETAIL.HEATMAP}${query ? `?${query}` : ''}`);
  }

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

  // ============================================
  // Workflows API（阶段 4 PR-B/C/D）
  // ============================================

  /** 获取 workflow run 完整记录（含 approval 状态） */
  async getWorkflowRun(runId: string): Promise<{
    runId: string;
    workflowId: string;
    workflowVersion: string;
    status: 'success' | 'partial' | 'failed' | 'pending_approval';
    userId: string;
    username: string;
    requestId: string;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    input: unknown;
    steps: Array<Record<string, unknown>>;
    report?: { narrative: string | null };
    approval?: {
      pendingNodeId: string;
      pendingNodeIndex: number;
      approverRoles: ReadonlyArray<string>;
      approvedBy?: string;
      approvedAt?: string;
      rejectedBy?: string;
      rejectedAt?: string;
      rejectReason?: string;
    } | null;
  }> {
    const path = WORKFLOWS_ROUTES.RUN_BY_ID.replace(':runId', encodeURIComponent(runId));
    return this.request(`/${path}`);
  }

  /** 列出指定 runId 的审计事件序列（按时间升序） */
  async getWorkflowAudit(runId: string): Promise<Array<{
    timestamp: string;
    runId: string;
    workflowId: string;
    eventType: 'workflow-started' | 'step-completed' | 'approval-requested' | 'approval-granted' | 'approval-denied' | 'workflow-completed';
    userId: string;
    role: string;
    requestId: string;
    payload: Record<string, unknown>;
  }>> {
    const path = WORKFLOWS_ROUTES.RUN_AUDIT.replace(':runId', encodeURIComponent(runId));
    return this.request(`/${path}`);
  }

  /** 审批通过 pending_approval 的 workflow run，触发 resume */
  async approveWorkflowRun(runId: string): Promise<Record<string, unknown>> {
    const path = WORKFLOWS_ROUTES.RUN_APPROVE.replace(':runId', encodeURIComponent(runId));
    return this.request(`/${path}`, { method: 'POST', body: JSON.stringify({}) });
  }

  /** 拒绝 pending_approval 的 workflow run；reason 透传到 audit + record.approval.rejectReason */
  async rejectWorkflowRun(runId: string, reason?: string): Promise<Record<string, unknown>> {
    const path = WORKFLOWS_ROUTES.RUN_REJECT.replace(':runId', encodeURIComponent(runId));
    return this.request(`/${path}`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  /** Workflow run 运维健康汇总（branch_admin only） */
  async getWorkflowRunsHealth(): Promise<{
    windowHours: number;
    generatedAt: string;
    workflows: Array<{
      workflowId: string;
      total: number;
      counts: Record<'success' | 'partial' | 'failed' | 'pending_approval', number>;
      elapsedMs: { p50: number | null; p95: number | null };
    }>;
    auditLog: {
      totalFileCount: number;
      totalBytes: number;
      earliestEventTime: string | null;
    };
  }> {
    return this.request(`/${WORKFLOWS_ROUTES.HEALTH_RUNS_SUMMARY}`);
  }

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
