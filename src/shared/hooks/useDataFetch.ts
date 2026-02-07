/**
 * 通用数据获取 Hook
 *
 * 自动管理 loading、error 状态，提供统一的数据获取模式
 *
 * 使用示例：
 * const { data, loading, error, fetch, reset } = useDataFetch(async () => {
 *   return await apiClient.getKpi(filters);
 * });
 */

import { useState, useCallback } from 'react';
import { createLogger } from '../utils/logger';

const logger = createLogger('useDataFetch');

export interface UseDataFetchOptions<T> {
  /** 初始数据 */
  initialData?: T;
  /** 错误处理回调 */
  onError?: (error: Error) => void;
  /** 成功回调 */
  onSuccess?: (data: T) => void;
  /** 是否在组件挂载时自动执行 */
  autoFetch?: boolean;
}

export interface UseDataFetchReturn<T, P = void> {
  /** 数据 */
  data: T | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 执行数据获取 */
  fetch: (params?: P) => Promise<T | null>;
  /** 重置状态 */
  reset: () => void;
  /** 设置数据（不触发请求） */
  setData: (data: T | null) => void;
}

/**
 * 通用数据获取 Hook
 */
export function useDataFetch<T = unknown, P = void>(
  fetchFn: (params?: P) => Promise<T>,
  options: UseDataFetchOptions<T> = {}
): UseDataFetchReturn<T, P> {
  const { initialData = null, onError, onSuccess } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(
    async (params?: P): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        logger.debug('开始数据获取', params);
        const result = await fetchFn(params);
        setData(result);
        logger.debug('数据获取成功', result);

        if (onSuccess) {
          onSuccess(result);
        }

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '数据获取失败';
        setError(errorMessage);
        logger.error('数据获取失败', err);

        if (onError && err instanceof Error) {
          onError(err);
        }

        return null;
      } finally {
        setLoading(false);
      }
    },
    [fetchFn, onError, onSuccess]
  );

  const reset = useCallback(() => {
    setData(initialData);
    setLoading(false);
    setError(null);
  }, [initialData]);

  return {
    data,
    loading,
    error,
    fetch,
    reset,
    setData,
  };
}

/**
 * 批量数据获取 Hook
 *
 * 同时获取多个数据源，自动管理各自的 loading 状态
 */
export function useMultipleDataFetch<T extends Record<string, unknown>>(
  fetchFns: { [K in keyof T]: () => Promise<T[K]> }
): {
  data: Partial<T>;
  loading: Record<keyof T, boolean>;
  errors: Record<keyof T, string | null>;
  fetchAll: () => Promise<void>;
  fetchOne: (key: keyof T) => Promise<void>;
  reset: () => void;
} {
  const keys = Object.keys(fetchFns) as Array<keyof T>;

  const [data, setData] = useState<Partial<T>>({});
  const [loading, setLoading] = useState<Record<keyof T, boolean>>(
    Object.fromEntries(keys.map((key) => [key, false])) as Record<keyof T, boolean>
  );
  const [errors, setErrors] = useState<Record<keyof T, string | null>>(
    Object.fromEntries(keys.map((key) => [key, null])) as Record<keyof T, string | null>
  );

  const fetchOne = useCallback(
    async (key: keyof T) => {
      setLoading((prev) => ({ ...prev, [key]: true }));
      setErrors((prev) => ({ ...prev, [key]: null }));

      try {
        const result = await fetchFns[key]();
        setData((prev) => ({ ...prev, [key]: result }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '数据获取失败';
        setErrors((prev) => ({ ...prev, [key]: errorMessage }));
        logger.error(`数据获取失败 [${String(key)}]`, err);
      } finally {
        setLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [fetchFns]
  );

  const fetchAll = useCallback(async () => {
    await Promise.all(keys.map((key) => fetchOne(key)));
  }, [keys, fetchOne]);

  const reset = useCallback(() => {
    setData({});
    setLoading(Object.fromEntries(keys.map((key) => [key, false])) as Record<keyof T, boolean>);
    setErrors(Object.fromEntries(keys.map((key) => [key, null])) as Record<keyof T, string | null>);
  }, [keys]);

  return {
    data,
    loading,
    errors,
    fetchAll,
    fetchOne,
    reset,
  };
}
