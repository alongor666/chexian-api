/**
 * 后端 API 客户端
 * Backend API Client
 *
 * 封装所有后端 API 调用，处理认证和错误
 */

// 类型定义集中管理在 types.ts
export type {
  ApiResponseMeta, AuthData, AccessUser, AccessRole,
  CapabilityInfo, DetectRequirementResponse,
  KpiData, KpiDetailData, TrendData, QualityBusinessTrendData,
  CrossSellBundleResponse, PerformanceBundleResponse, DashboardBundleResponse,
  ComprehensiveTabKey, ComprehensiveFilterParams, ComprehensiveBundleResponse,
  FileInfo, LoadResult,
} from './types';

import type {
  ApiResponse, AuthData, AccessUser, AccessRole,
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
} from './routes';

/** API 基础地址（从环境变量获取，默认本地开发地址） */
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';
export const ENABLE_BUNDLE_ROUTES = import.meta.env.VITE_ENABLE_BUNDLE_ROUTES !== 'false';
const AUTH_SESSION_HINT_KEY = 'chexian_auth_session_hint';

export class RequestAbortError extends Error {
  constructor(message = '请求已取消或超时') {
    super(message);
    this.name = 'RequestAbortError';
  }
}

export function isRequestAbortError(error: unknown): error is RequestAbortError {
  return error instanceof RequestAbortError;
}

/**
 * API 客户端类
 *
 * 增强功能：
 * - 请求取消（AbortController）：同一端点的新请求自动取消前序请求
 * - 请求超时：默认 30 秒
 * - GET 同 key 请求合并（in-flight coalescing）
 * - 缓存由 React Query 管理（staleTime 5min, gcTime 30min）
 */
class ApiClient {
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private hasSessionCookieHint = this.loadSessionCookieHint();
  /** 进行中的请求控制器（按端点去重） */
  private inflightControllers = new Map<string, AbortController>();
  /** 进行中的同 key 请求 Promise（用于请求合并） */
  private inflightRequests = new Map<string, Promise<unknown>>();
  /** 默认请求超时（毫秒） */
  private requestTimeoutMs = 30_000;

  private loadSessionCookieHint(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setSessionCookieHint(value: boolean): void {
    this.hasSessionCookieHint = value;
    if (typeof window === 'undefined') return;
    try {
      if (value) {
        window.localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
      } else {
        window.localStorage.removeItem(AUTH_SESSION_HINT_KEY);
      }
    } catch {
      // 忽略 localStorage 失败
    }
  }

  private normalizeGetEndpoint(endpoint: string): string {
    const [path, query = ''] = endpoint.split('?');
    if (!query) return path;

    const search = new URLSearchParams(query);
    const entries = Array.from(search.entries())
      .sort(([aKey, aValue], [bKey, bValue]) => {
        if (aKey === bKey) return aValue.localeCompare(bValue);
        return aKey.localeCompare(bKey);
      })
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);

    return `${path}?${entries.join('&')}`;
  }

  /**
   * 将 filters 对象转为 URL 查询字符串
   * 跳过 undefined 和 null 值
   */
  private buildQueryString(
    filters?: Record<string, any>,
    initialParams?: Record<string, string>
  ): string {
    const params = new URLSearchParams(initialParams);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    return params.toString();
  }

  /**
   * 设置认证 Token
   */
  setToken(token: string): void {
    this.token = token;
    // 解析 JWT 获取过期时间
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      this.tokenExpiry = payload.exp * 1000; // 转换为毫秒
    } catch {
      this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 默认 24 小时
    }
    this.setSessionCookieHint(true);
  }

  /**
   * 获取 Token
   */
  getToken(): string | null {
    // 检查是否过期
    if (this.token && this.tokenExpiry && Date.now() > this.tokenExpiry) {
      this.clearToken();
      return null;
    }
    return this.token;
  }

  /**
   * 清除 Token
   */
  clearToken(): void {
    this.token = null;
    this.tokenExpiry = 0;
    this.setSessionCookieHint(false);
  }

  /**
   * 是否已认证
   */
  isAuthenticated(): boolean {
    return !!this.getToken() || this.hasSessionCookieHint;
  }

  /**
   * 取消指定端点的进行中请求
   */
  cancelRequest(endpoint: string): void {
    const controller = this.inflightControllers.get(endpoint);
    if (controller) {
      controller.abort();
      this.inflightControllers.delete(endpoint);
    }
  }

  /**
   * 取消所有进行中的请求
   */
  cancelAllRequests(): void {
    for (const controller of this.inflightControllers.values()) {
      controller.abort();
    }
    this.inflightControllers.clear();
    this.inflightRequests.clear();
  }

  /**
   * 通用请求方法
   *
   * 增强：
   * - GET 同 key 请求合并（in-flight coalescing）
   * - 30 秒超时
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    hasRetriedAfterRefresh = false
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const method = (options.method || 'GET').toUpperCase();
    const dedupeKey = method === 'GET'
      ? `${method}:${this.normalizeGetEndpoint(endpoint)}`
      : '';

    if (dedupeKey) {
      const existing = this.inflightRequests.get(dedupeKey) as Promise<T> | undefined;
      if (existing) {
        return existing;
      }
    }

    const execute = async (): Promise<T> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      if (dedupeKey) {
        this.inflightControllers.set(dedupeKey, controller);
      }

      try {
        const response = await fetch(url, {
          ...options,
          headers,
          credentials: 'include',
          signal: controller.signal,
        });

        const canTryRefresh = !endpoint.startsWith('/auth/')
          && (Boolean(token) || this.hasSessionCookieHint);
        if (response.status === 401 && !hasRetriedAfterRefresh && canTryRefresh) {
          const refreshed = await this.tryRefreshSession();
          if (refreshed) {
            return this.request<T>(endpoint, options, true);
          }
        }

        const data: ApiResponse<T> = await response.json();

        if (!data.success) {
          const error = new Error(data.error?.message || '请求失败');
          (error as any).statusCode = data.error?.statusCode || response.status;
          throw error;
        }

        return data.data as T;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new RequestAbortError();
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
        if (dedupeKey) {
          this.inflightControllers.delete(dedupeKey);
          this.inflightRequests.delete(dedupeKey);
        }
      }
    };

    const requestPromise = execute();
    if (dedupeKey) {
      this.inflightRequests.set(dedupeKey, requestPromise);
    }
    return requestPromise;
  }

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

  private async tryRefreshSession(): Promise<boolean> {
    try {
      const refreshed = await fetch(`${API_BASE}/${AUTH_ROUTES.REFRESH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!refreshed.ok) {
        this.clearToken();
        return false;
      }
      const data: ApiResponse<{ token?: string }> = await refreshed.json();
      if (!data.success) {
        this.clearToken();
        return false;
      }
      if (data.data?.token) {
        this.setToken(data.data.token);
      } else {
        this.setSessionCookieHint(true);
      }
      return true;
    } catch {
      this.clearToken();
      return false;
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

  /** 通用查询 GET 请求（统一 buildQueryString + request 模式） */
  private queryGet<T = any>(path: string, filters?: Record<string, any>, initial?: Record<string, string>): Promise<T> {
    const query = this.buildQueryString(filters, initial);
    return this.request<T>(`/query/${path}${query ? `?${query}` : ''}`);
  }

  /** 带 drillPath 序列化的查询请求（用于下钻场景） */
  private drilldownGet<T = any>(path: string, params: { drillPath?: Array<{ dimension: string; value: string }>; groupBy?: string; [key: string]: any }): Promise<T> {
    const searchParams = new URLSearchParams();
    if (params.drillPath) searchParams.append('drillPath', JSON.stringify(params.drillPath));
    if (params.groupBy) searchParams.append('groupBy', params.groupBy);
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'drillPath' && key !== 'groupBy' && value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const query = searchParams.toString();
    return this.request<T>(`/query/${path}${query ? `?${query}` : ''}`);
  }

  async getKpi(filters?: Record<string, any>): Promise<KpiData> { return this.queryGet<KpiData>(QUERY_ROUTES.KPI, filters); }
  async getKpiDetail(filters?: Record<string, any>): Promise<KpiDetailData> { return this.queryGet<KpiDetailData>(QUERY_ROUTES.KPI_DETAIL, filters); }
  async getTrend(granularity: 'day' | 'week' | 'month' = 'day', filters?: Record<string, any>): Promise<TrendData[]> { return this.queryGet<TrendData[]>(QUERY_ROUTES.TREND, filters, { granularity }); }
  async getQualityBusinessTrend(granularity: 'day' | 'week' | 'month' = 'day', filters?: Record<string, any>): Promise<QualityBusinessTrendData[]> { return this.queryGet<QualityBusinessTrendData[]>(QUERY_ROUTES.QUALITY_BUSINESS_TREND, filters, { granularity }); }
  async getTruckAnalysis(filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.TRUCK, filters); }
  async getGrowthAnalysis(startDate: string, endDate: string, baselineStart: string, baselineEnd: string, filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.GROWTH, filters, { startDate, endDate, baselineStart, baselineEnd }); }
  async getCoefficientData(filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.COEFFICIENT, filters); }
  async getCostAnalysis(filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.COST, filters); }
  async getComprehensiveBundle(params?: ComprehensiveFilterParams): Promise<ComprehensiveBundleResponse> { return this.queryGet<ComprehensiveBundleResponse>(QUERY_ROUTES.COMPREHENSIVE_BUNDLE, params as Record<string, unknown>); }
  async getRenewalAnalysis(filters?: Record<string, any>): Promise<any> { return this.queryGet(QUERY_ROUTES.RENEWAL, filters); }
  async getRenewalDrilldown(params?: Record<string, any>): Promise<any[]> { return this.queryGet(QUERY_ROUTES.RENEWAL_DRILLDOWN, params); }

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

  /**
   * 获取费用分析数据（成都同城机构规则分档）
   */
  async getFeeAnalysis(filters?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(filters);
    return this.request(`/query/${QUERY_ROUTES.FEE_ANALYSIS}${query ? `?${query}` : ''}`);
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

  // ── 续保宇宙 V2 ──

  async getRenewalV2Overview(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<{ total: Record<string, any>; grouped: Record<string, any>[] }>(`/query/${QUERY_ROUTES.RENEWAL_V2.OVERVIEW}${query ? `?${query}` : ''}`);
  }

  async getRenewalV2Trend(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.RENEWAL_V2.TREND}${query ? `?${query}` : ''}`);
  }

  async getRenewalV2Funnel(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<{ funnel: Record<string, any>[]; lossReason: Record<string, any>[] }>(`/query/${QUERY_ROUTES.RENEWAL_V2.FUNNEL}${query ? `?${query}` : ''}`);
  }

  async getRenewalV2Competition(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<{ loss: Record<string, any>[]; gain: Record<string, any>[] }>(`/query/${QUERY_ROUTES.RENEWAL_V2.COMPETITION}${query ? `?${query}` : ''}`);
  }

  async getRenewalV2Action(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.RENEWAL_V2.ACTION}${query ? `?${query}` : ''}`);
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

  // ============================================
  // 报价转化分析 API
  // ============================================

  async getQuoteConversionKpi(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.KPI}${query ? `?${query}` : ''}`);
  }

  async getQuoteConversionFunnel(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.FUNNEL}${query ? `?${query}` : ''}`);
  }

  async getQuoteConversionDrilldown(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.DRILLDOWN}${query ? `?${query}` : ''}`);
  }

  async getQuoteConversionHeatmap(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.HEATMAP}${query ? `?${query}` : ''}`);
  }

  async getQuoteConversionPrice(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.PRICE}${query ? `?${query}` : ''}`);
  }

  async getQuoteConversionTrend(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.TREND}${query ? `?${query}` : ''}`);
  }

  async getQuoteConversionRanking(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.QUOTE_CONVERSION.RANKING}${query ? `?${query}` : ''}`);
  }

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

  async getExpenseRatioDev(params?: Record<string, string>) {
    const query = this.buildQueryString(params);
    return this.request<any[]>(`/query/${QUERY_ROUTES.EXPENSE_DEVELOPMENT}${query ? `?${query}` : ''}`);
  }
}

// 导出单例
export const apiClient = new ApiClient();
