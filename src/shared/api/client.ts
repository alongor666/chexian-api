/**
 * 后端 API 客户端
 * Backend API Client
 *
 * 封装所有后端 API 调用，处理认证和错误
 */

/** API 基础地址（从环境变量获取，默认本地开发地址） */
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';
export const ENABLE_BUNDLE_ROUTES = import.meta.env.VITE_ENABLE_BUNDLE_ROUTES !== 'false';
const AUTH_SESSION_HINT_KEY = 'chexian_auth_session_hint';

/**
 * API 响应格式
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  meta?: {
    requestId?: string;
    cacheHit?: boolean;
    serverTiming?: string;
    dataVersion?: string;
  };
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
 * 认证信息
 */
interface AuthData {
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
  active: boolean;
}

export interface AccessRole extends Record<string, unknown> {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes?: string[];
  defaultRoute?: string;
}

/**
 * KPI 数据
 */
export interface KpiData {
  latest_policy_date: string | null;
  vehicle_premium: number;
  vehicle_achievement_rate: number | null;
  vehicle_growth_rate: number | null;
  variable_cost_rate: number | null;
  bundle_renewal_rate: number | null;
  driver_premium: number;
  driver_achievement_rate: number | null;
  driver_growth_rate: number | null;
  total_premium: number;
  policy_count: number;
  salesman_count: number;
  org_count: number;
  per_capita_premium: number;
  renewal_rate: number;
  new_car_rate: number;
  nev_rate: number;
  quality_business_rate: number;
  commercial_insurance_rate: number;
  commercial_rate: number;
  telesales_rate: number;
  transfer_rate: number;
}

/**
 * KPI 详细数据（用于环形图展示）
 */
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

/**
 * 趋势数据（与后端 generatePremiumTrendQuery 返回字段对齐）
 */
export interface TrendData {
  time_period: string;
  premium: number;
  org_level_3?: string;
  next_month_ratio?: number;
  count?: number;
}

/**
 * 优质业务占比趋势数据
 */
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

/**
 * 文件信息
 */
export interface FileInfo {
  filename: string;
  sizeMB: number;
  modifiedTime: string;
  isCurrent: boolean;
}

/**
 * 加载结果
 */
export interface LoadResult {
  filename: string;
  rowCount: number;
  fileSizeMB: number;
}

/**
 * 轻量 GET 响应缓存（LRU 淘汰，TTL 过期）
 * 用于页面内导航时避免重复请求相同数据
 */
interface ResponseCacheEntry {
  data: unknown;
  etag: string | null;
  expiry: number;
}
const responseCache = new Map<string, ResponseCacheEntry>();
const RESPONSE_CACHE_TTL = 60_000; // 1 分钟
const RESPONSE_CACHE_MAX = 200;

function getResponseCache(key: string): ResponseCacheEntry | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    responseCache.delete(key);
    return null;
  }
  return entry;
}

function setResponseCache(key: string, data: unknown, etag: string | null): void {
  if (responseCache.size >= RESPONSE_CACHE_MAX) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { data, etag, expiry: Date.now() + RESPONSE_CACHE_TTL });
}

/**
 * API 客户端类
 *
 * 增强功能：
 * - 请求取消（AbortController）：同一端点的新请求自动取消前序请求
 * - 请求超时：默认 30 秒
 * - GET 响应缓存：TTL 内直接返回缓存数据，ETag 304 支持
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

      // 检查 GET 响应缓存（TTL 内直接返回）
      const cached = getResponseCache(dedupeKey);
      if (cached) {
        return cached.data as T;
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

        // 304 Not Modified → 使用缓存数据
        if (response.status === 304 && dedupeKey) {
          const cached = getResponseCache(dedupeKey);
          if (cached) {
            return cached.data as T;
          }
        }

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

        const result = data.data as T;

        // 缓存 GET 响应（存储 ETag 以支持 304）
        if (dedupeKey) {
          const etag = response.headers?.get?.('etag') ?? null;
          setResponseCache(dedupeKey, result, etag);
        }

        return result;
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
    const result = await this.request<AuthData>('/auth/login', {
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
    const user = await this.request<AuthData['user']>('/auth/me');
    this.setSessionCookieHint(true);
    return user;
  }

  async listUsers(): Promise<AccessUser[]> {
    return this.request<AccessUser[]>('/auth/users');
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
    active?: boolean;
  }): Promise<AccessUser> {
    return this.request<AccessUser>('/auth/users', {
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
      active?: boolean;
    }
  ): Promise<AccessUser> {
    return this.request<AccessUser>(`/auth/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(`/auth/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listRoles(): Promise<AccessRole[]> {
    return this.request<AccessRole[]>('/auth/roles');
  }

  async createRole(payload: {
    role: string;
    name: string;
    dataScope: 'all' | 'org' | 'telemarketing';
    allowedRoutes?: string[];
    defaultRoute?: string;
  }): Promise<AccessRole> {
    return this.request<AccessRole>('/auth/roles', {
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
    return this.request<AccessRole>(`/auth/roles/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteRole(role: string): Promise<void> {
    await this.request(`/auth/roles/${encodeURIComponent(role)}`, {
      method: 'DELETE',
    });
  }

  /**
   * 获取企微登录配置
   */
  async getWeComConfig(): Promise<{ corpId: string; agentId: string; callbackUrl: string }> {
    return this.request('/auth/wecom/config');
  }

  /**
   * 登出
   */
  logout(): void {
    void Promise.resolve(fetch(`${API_BASE}/auth/logout`, {
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
      const refreshed = await fetch(`${API_BASE}/auth/refresh`, {
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
    return this.request<FileInfo[]>('/data/files');
  }

  /**
   * 加载数据文件
   */
  async loadFile(filename: string): Promise<LoadResult> {
    return this.request<LoadResult>(`/data/load/${encodeURIComponent(filename)}`, {
      method: 'POST',
    });
  }

  /**
   * 上传文件
   */
  async uploadFile(file: File): Promise<LoadResult> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE}/data/upload`;
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

  /**
   * 获取 KPI 数据
   */
  async getKpi(filters?: Record<string, any>): Promise<KpiData> {
    const query = this.buildQueryString(filters);
    return this.request<KpiData>(`/query/kpi${query ? `?${query}` : ''}`);
  }

  /**
   * 获取 KPI 详细数据（用于环形图展示）
   */
  async getKpiDetail(filters?: Record<string, any>): Promise<KpiDetailData> {
    const query = this.buildQueryString(filters);
    return this.request<KpiDetailData>(`/query/kpi-detail${query ? `?${query}` : ''}`);
  }

  /**
   * 获取趋势数据
   */
  async getTrend(
    granularity: 'day' | 'week' | 'month' = 'day',
    filters?: Record<string, any>
  ): Promise<TrendData[]> {
    const query = this.buildQueryString(filters, { granularity });
    return this.request<TrendData[]>(`/query/trend?${query}`);
  }

  /**
   * 获取优质业务占比趋势数据
   */
  async getQualityBusinessTrend(
    granularity: 'day' | 'week' | 'month' = 'day',
    filters?: Record<string, any>
  ): Promise<QualityBusinessTrendData[]> {
    const query = this.buildQueryString(filters, { granularity });
    return this.request<QualityBusinessTrendData[]>(`/query/quality-business-trend?${query}`);
  }

  /**
   * 获取货车分析数据
   */
  async getTruckAnalysis(filters?: Record<string, any>): Promise<any> {
    const query = this.buildQueryString(filters);
    return this.request(`/query/truck${query ? `?${query}` : ''}`);
  }

  /**
   * 获取增长分析数据
   */
  async getGrowthAnalysis(
    startDate: string,
    endDate: string,
    baselineStart: string,
    baselineEnd: string,
    filters?: Record<string, any>
  ): Promise<any> {
    const query = this.buildQueryString(filters, { startDate, endDate, baselineStart, baselineEnd });
    return this.request(`/query/growth?${query}`);
  }

  /**
   * 获取系数监控数据
   */
  async getCoefficientData(filters?: Record<string, any>): Promise<any> {
    const query = this.buildQueryString(filters);
    return this.request(`/query/coefficient${query ? `?${query}` : ''}`);
  }

  /**
   * 获取成本分析数据
   */
  async getCostAnalysis(filters?: Record<string, any>): Promise<any> {
    const query = this.buildQueryString(filters);
    return this.request(`/query/cost${query ? `?${query}` : ''}`);
  }

  /**
   * 获取综合分析聚合数据（6模块）
   */
  async getComprehensiveBundle(
    params?: ComprehensiveFilterParams
  ): Promise<ComprehensiveBundleResponse> {
    const query = this.buildQueryString(params as Record<string, unknown>);
    return this.request<ComprehensiveBundleResponse>(
      `/query/comprehensive-bundle${query ? `?${query}` : ''}`
    );
  }

  /**
   * 获取续保分析数据
   */
  async getRenewalAnalysis(filters?: Record<string, any>): Promise<any> {
    const query = this.buildQueryString(filters);
    return this.request(`/query/renewal${query ? `?${query}` : ''}`);
  }

  /**
   * 获取续保下钻分析数据
   */
  async getRenewalDrilldown(params?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(params);
    return this.request(`/query/renewal-drilldown${query ? `?${query}` : ''}`);
  }

  /**
   * 获取车驾意推介率数据
   */
  async getCrossSellAnalysis(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<any> {
    const searchParams = new URLSearchParams();
    if (params.drillPath) {
      searchParams.append('drillPath', JSON.stringify(params.drillPath));
    }
    if (params.groupBy) {
      searchParams.append('groupBy', params.groupBy);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'drillPath' && key !== 'groupBy' && value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const query = searchParams.toString();
    return this.request(`/query/cross-sell${query ? `?${query}` : ''}`);
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
    return this.request(`/query/cross-sell-summary${query ? `?${query}` : ''}`);
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
    return this.request(`/query/cross-sell-trend${query ? `?${query}` : ''}`);
  }

  /**
   * 获取业务员排名
   */
  async getSalesmanRanking(
    limit: number = 20,
    filters?: Record<string, any>
  ): Promise<any[]> {
    const query = this.buildQueryString(filters, { limit: String(limit) });
    return this.request(`/query/salesman-ranking?${query}`);
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
    return this.request(`/query/cross-sell-top-salesman${query ? `?${query}` : ''}`);
  }

  /**
   * 获取交叉销售聚合数据（summary + trend + drilldown + topSalesman）
   */
  async getCrossSellBundle(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<CrossSellBundleResponse> {
    const searchParams = new URLSearchParams();
    if (params.drillPath) {
      searchParams.append('drillPath', JSON.stringify(params.drillPath));
    }
    if (params.groupBy) {
      searchParams.append('groupBy', params.groupBy);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'drillPath' && key !== 'groupBy' && value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const query = searchParams.toString();
    return this.request(`/query/cross-sell-bundle${query ? `?${query}` : ''}`);
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
    return this.request(`/query/performance-summary${query ? `?${query}` : ''}`);
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
    return this.request(`/query/performance-trend${query ? `?${query}` : ''}`);
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
    const searchParams = new URLSearchParams();
    if (params.drillPath) {
      searchParams.append('drillPath', JSON.stringify(params.drillPath));
    }
    if (params.groupBy) {
      searchParams.append('groupBy', params.groupBy);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'drillPath' && key !== 'groupBy' && value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const query = searchParams.toString();
    return this.request(`/query/performance-drilldown${query ? `?${query}` : ''}`);
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
    return this.request(`/query/performance-top-salesman${query ? `?${query}` : ''}`);
  }

  /**
   * 获取业绩分析聚合数据（summary + trend + drilldown + topSalesman）
   */
  async getPerformanceBundle(params: {
    drillPath?: Array<{ dimension: string; value: string }>;
    groupBy?: string;
    [key: string]: any;
  }): Promise<PerformanceBundleResponse> {
    const searchParams = new URLSearchParams();
    if (params.drillPath) {
      searchParams.append('drillPath', JSON.stringify(params.drillPath));
    }
    if (params.groupBy) {
      searchParams.append('groupBy', params.groupBy);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'drillPath' && key !== 'groupBy' && value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const query = searchParams.toString();
    return this.request(`/query/performance-bundle${query ? `?${query}` : ''}`);
  }

  /**
   * 获取仪表盘聚合数据（kpi + trend + ranking + rose）
   */
  async getDashboardBundle(params?: Record<string, any>): Promise<DashboardBundleResponse> {
    const query = this.buildQueryString(params);
    return this.request(`/query/dashboard-bundle${query ? `?${query}` : ''}`);
  }

  /**
   * 获取营销战报数据
   */
  async getMarketingReport(params?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(params);
    return this.request(`/query/marketing-report${query ? `?${query}` : ''}`);
  }

  /**
   * 获取保费报表数据（机构汇总 / 业务员明细）
   */
  async getPremiumReport(params?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(params);
    return this.request(`/query/premium-report${query ? `?${query}` : ''}`);
  }

  /**
   * 获取保费达成下钻数据（六级下钻 + KPI + 达成率分布）
   */
  async getPremiumPlan(params?: Record<string, any>): Promise<any> {
    const query = this.buildQueryString(params);
    return this.request(`/query/premium-plan${query ? `?${query}` : ''}`);
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
    }>(`/query/plan-achievement${query ? `?${query}` : ''}`);
    return resp.data ?? resp;
  }

  /**
   * 获取费用分析数据（成都同城机构规则分档）
   */
  async getFeeAnalysis(filters?: Record<string, any>): Promise<any[]> {
    const query = this.buildQueryString(filters);
    return this.request(`/query/fee-analysis${query ? `?${query}` : ''}`);
  }

  /**
   * 执行自定义 SQL（受限）
   */
  async executeCustomQuery(sql: string): Promise<any[]> {
    return this.request('/query/custom', {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
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
    customerCategories: string[];
    coverageCombinations: string[];
    dateRange?: { min_date: string | null; max_date: string | null };
    insuranceGrades: Array<{ value: string; count: number }>;
    smallTruckScores: Array<{ value: string; count: number }>;
    largeTruckScores: Array<{ value: string; count: number }>;
  }> {
    return this.request('/filters/options');
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
    return this.request(`/query/cross-sell-org-trend${query ? `?${query}` : ''}`);
  }

  // ============================================
  // AI API
  // ============================================

  /**
   * AI 生成 SQL
   */
  async generateSql(query: string): Promise<{
    sql: string;
    explanation?: string;
  }> {
    return this.request('/ai/generate-sql', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  /**
   * AI 分析机构推介率趋势（后端读取 API Key，无需前端传）
   */
  async analyzeTrend(params: {
    rows: Array<{ date: string; auto_count: number; driver_count: number; rate: number; avg_premium: number }>;
    org: string;
    coverage: string;
  }): Promise<{ success: boolean; analysis: string; error?: string }> {
    return this.request('/ai/trend-analysis', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}

// 导出单例
export const apiClient = new ApiClient();
