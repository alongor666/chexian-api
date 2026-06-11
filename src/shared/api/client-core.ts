/**
 * API 客户端传输核心
 * API Client Transport Core
 *
 * 从 ApiClient 神类抽出的传输层基类（Phase 1）：仅负责认证 Token 生命周期、
 * 请求发送、超时、GET 同 key 合并（in-flight coalescing）、401 静默刷新与
 * 查询字符串构造。**不包含任何业务域方法**——域方法仍在 client.ts 的
 * ApiClient（extends ApiClientCore）中，后续 Phase 按域逐个搬出。
 *
 * 设计约束：
 * - 单实例共享可变状态（token / inflight maps），故域方法通过继承复用同一份状态。
 * - 子类可见性：request / buildQueryString / queryGet / drilldownGet /
 *   setSessionCookieHint 为 protected，供域方法调用；token 读写为 public。
 */

import type { ApiResponse } from './types';
import { AUTH_ROUTES } from './routes';

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
 * 传输句柄：暴露给命名空间子客户端（Phase 2）的最小传输面。
 *
 * 子客户端通过组合（持有同一份句柄）而非继承复用单实例传输状态，
 * 故 core 的 protected request/queryGet/drilldownGet/buildQueryString
 * 经此 this-bound 接口透出，**不破坏对外公开面、不新建第二个实例**。
 */
export interface ApiTransport {
  request<T>(endpoint: string, options?: RequestInit): Promise<T>;
  queryGet<T = any>(path: string, filters?: Record<string, any>, initial?: Record<string, string>): Promise<T>;
  drilldownGet<T = any>(path: string, params: { drillPath?: Array<{ dimension: string; value: string }>; groupBy?: string; [key: string]: any }): Promise<T>;
  buildQueryString(filters?: Record<string, any>, initial?: Record<string, string>): string;
  /** 暴露给 multipart upload 等无法走 JSON request() 的子客户端方法（data 域 upload） */
  getToken(): string | null;
}

/**
 * API 客户端传输核心基类
 *
 * 增强功能：
 * - 请求取消（AbortController）：同一端点的新请求自动取消前序请求
 * - 请求超时：默认 30 秒
 * - GET 同 key 请求合并（in-flight coalescing）
 * - 缓存由 React Query 管理（staleTime 5min, gcTime 30min）
 */
export class ApiClientCore {
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private hasSessionCookieHint = this.loadSessionCookieHint();
  /** 进行中的请求控制器（按端点去重） */
  private inflightControllers = new Map<string, AbortController>();
  /** 进行中的同 key 请求 Promise（用于请求合并） */
  private inflightRequests = new Map<string, Promise<unknown>>();
  /** 进行中的会话刷新 Promise（并发 401 共享，避免重复刷新被轮换的 refresh cookie 打架） */
  private refreshPromise: Promise<boolean> | null = null;
  /** 默认请求超时（毫秒） */
  private requestTimeoutMs = 30_000;

  /**
   * 透传给命名空间子客户端的 this-bound 传输句柄（Phase 2）。
   * 用箭头闭包绑定 this 并保留泛型；每实例一份，子类构造时注入子客户端。
   *
   * ⚠️ 不变量：本字段必须留在基类。子客户端在子类字段中 `new XxxApi(this.transport)`，
   *    依赖「基类字段先于子类字段初始化」才能读到已就绪句柄；挪到子类会读到 undefined。
   */
  protected readonly transport: ApiTransport = {
    request: <T>(endpoint: string, options?: RequestInit) => this.request<T>(endpoint, options),
    queryGet: <T = any>(path: string, filters?: Record<string, any>, initial?: Record<string, string>) =>
      this.queryGet<T>(path, filters, initial),
    drilldownGet: <T = any>(path: string, params: { drillPath?: Array<{ dimension: string; value: string }>; groupBy?: string; [key: string]: any }) =>
      this.drilldownGet<T>(path, params),
    buildQueryString: (filters?: Record<string, any>, initial?: Record<string, string>) =>
      this.buildQueryString(filters, initial),
    getToken: () => this.getToken(),
  };

  private loadSessionCookieHint(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1';
    } catch {
      return false;
    }
  }

  protected setSessionCookieHint(value: boolean): void {
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
  protected buildQueryString(
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
      // access token 本地过期：只清内存 token，保留 session cookie hint，
      // 让 401 时仍能用 refresh cookie 静默刷新。clearToken() 会连带清掉 hint →
      // canTryRefresh 变 false → 最常见的「token 自然过期」场景下静默刷新反而失效。
      this.token = null;
      this.tokenExpiry = 0;
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
  protected async request<T>(
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

    // ⚠️ 刷新后的重试（hasRetriedAfterRefresh）必须跳过 in-flight 合并查找：
    //    GET 的原请求 promise 此刻仍挂在 inflightRequests[dedupeKey]（原 execute 的 finally
    //    尚未执行），重试若命中 existing 会返回原 promise 自身 → execute() resolve 成自己 →
    //    TypeError: Chaining cycle detected，GET 在 401→刷新成功 后反而失败（POST 无 dedupeKey 不受影响）。
    if (dedupeKey && !hasRetriedAfterRefresh) {
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

  private tryRefreshSession(): Promise<boolean> {
    // 并发 401 共享同一次刷新：多个请求同时收到 401 时只发一次 refresh，
    // 避免后续刷新带着已被轮换作废的 refresh cookie 失败 → clearToken → 误登出。
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefreshSession().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefreshSession(): Promise<boolean> {
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

  /** 通用查询 GET 请求（统一 buildQueryString + request 模式） */
  protected queryGet<T = any>(path: string, filters?: Record<string, any>, initial?: Record<string, string>): Promise<T> {
    const query = this.buildQueryString(filters, initial);
    return this.request<T>(`/query/${path}${query ? `?${query}` : ''}`);
  }

  /** 带 drillPath 序列化的查询请求（用于下钻场景） */
  protected drilldownGet<T = any>(path: string, params: { drillPath?: Array<{ dimension: string; value: string }>; groupBy?: string; [key: string]: any }): Promise<T> {
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
}
