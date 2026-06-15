import { useState, useCallback } from 'react';
import type { ViewPerspective, PerspectiveConfig } from '../types';
import { DEFAULT_PERSPECTIVE, getPerspectiveConfig } from '../types';
import { safeStorage } from '../utils/storage';

/**
 * 视角状态管理 Hook
 *
 * 提供全局视角状态管理，支持以下功能：
 * - 视角切换（保费/保单件数）
 * - localStorage 持久化（记住用户选择）
 * - 获取当前视角配置
 *
 * @returns 视角状态和操作方法
 *
 * @example
 * const { perspective, setPerspective, config } = usePerspective();
 *
 * // 切换到保单件数视角
 * setPerspective('policy_count');
 *
 * // 获取当前视角配置
 * logger.debug(config.label); // "保单件数"
 * logger.debug(config.yAxisLabel); // "件数"
 */
export function usePerspective() {
  const STORAGE_KEY = 'dashboard_perspective';

  // 从 localStorage 读取初始值（使用安全存储）
  const getInitialPerspective = (): ViewPerspective => {
    const stored = safeStorage.getItem(STORAGE_KEY);
    if (stored && (stored === 'premium' || stored === 'policy_count')) {
      return stored as ViewPerspective;
    }
    return DEFAULT_PERSPECTIVE;
  };

  const [perspective, setPerspectiveState] = useState<ViewPerspective>(getInitialPerspective);

  // 切换视角并持久化（使用安全存储）
  const setPerspective = useCallback((newPerspective: ViewPerspective) => {
    setPerspectiveState(newPerspective);
    safeStorage.setItem(STORAGE_KEY, newPerspective);
  }, []);

  // 获取当前视角配置
  const config: PerspectiveConfig = getPerspectiveConfig(perspective);

  // 重置到默认视角
  const resetPerspective = useCallback(() => {
    setPerspective(DEFAULT_PERSPECTIVE);
  }, [setPerspective]);

  return {
    /** 当前视角类型 */
    perspective,
    /** 设置视角 */
    setPerspective,
    /** 当前视角配置 */
    config,
    /** 重置到默认视角 */
    resetPerspective,
  };
}

/**
 * 视角状态接口（用于类型导出）
 */
export interface PerspectiveState {
  perspective: ViewPerspective;
  setPerspective: (perspective: ViewPerspective) => void;
  config: PerspectiveConfig;
  resetPerspective: () => void;
}