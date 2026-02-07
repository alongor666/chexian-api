/**
 * 统一管理多个 loading 状态的自定义 Hook
 *
 * 用于替代多个独立的 loading 状态：
 * const [loadingKpi, setLoadingKpi] = useState(false);
 * const [loadingTrend, setLoadingTrend] = useState(false);
 * ...
 *
 * 使用示例：
 * const { loading, setLoading, isAnyLoading } = useLoadingStates(['kpi', 'trend', 'table']);
 * setLoading('kpi', true);
 * if (loading.kpi) { ... }
 */

import { useState, useCallback, useMemo } from 'react';

export type LoadingStates<T extends string> = Record<T, boolean>;

export interface UseLoadingStatesReturn<T extends string> {
  /** 所有 loading 状态的对象 */
  loading: LoadingStates<T>;
  /** 设置单个 loading 状态 */
  setLoading: (key: T, value: boolean) => void;
  /** 批量设置多个 loading 状态 */
  setMultipleLoading: (updates: Partial<LoadingStates<T>>) => void;
  /** 重置所有 loading 状态为 false */
  resetAllLoading: () => void;
  /** 是否有任何一个 loading 状态为 true */
  isAnyLoading: boolean;
  /** 是否所有 loading 状态都为 false */
  isAllLoaded: boolean;
}

/**
 * 统一管理多个 loading 状态
 */
export function useLoadingStates<T extends string>(
  keys: readonly T[]
): UseLoadingStatesReturn<T> {
  // 初始化所有 loading 状态为 false
  const initialState = useMemo(
    () => Object.fromEntries(keys.map((key) => [key, false])) as LoadingStates<T>,
    [keys]
  );

  const [loading, setLoadingState] = useState<LoadingStates<T>>(initialState);

  // 设置单个 loading 状态
  const setLoading = useCallback((key: T, value: boolean) => {
    setLoadingState((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  // 批量设置多个 loading 状态
  const setMultipleLoading = useCallback((updates: Partial<LoadingStates<T>>) => {
    setLoadingState((prev) => ({
      ...prev,
      ...updates,
    }));
  }, []);

  // 重置所有 loading 状态
  const resetAllLoading = useCallback(() => {
    setLoadingState(initialState);
  }, [initialState]);

  // 是否有任何一个 loading
  const isAnyLoading = useMemo(
    () => Object.values(loading).some((value) => value === true),
    [loading]
  );

  // 是否所有都加载完成
  const isAllLoaded = useMemo(
    () => Object.values(loading).every((value) => value === false),
    [loading]
  );

  return {
    loading,
    setLoading,
    setMultipleLoading,
    resetAllLoading,
    isAnyLoading,
    isAllLoaded,
  };
}
