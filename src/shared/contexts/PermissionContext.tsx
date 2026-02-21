import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import type { UserPermission } from '../../shared/config/organizations';
import {
  UserRole,
  setCurrentUserPermission as setPermission,
  getPermissionByUsername,
  getVisibleOrganizations,
  canViewOrganization,
} from '../../shared/config/organizations';
import { apiClient } from '../api/client';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('PermissionContext');

interface PermissionContextValue {
  /** 当前用户权限 */
  userPermission: UserPermission | null;
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** 是否正在加载认证状态 */
  isLoading: boolean;
  /** 是否为分公司管理员 */
  isBranchAdmin: boolean;
  /** 是否为三级机构用户 */
  isOrgUser: boolean;
  /** 用户可见的机构列表 */
  visibleOrganizations: string[];
  /** 设置用户权限 */
  setUserPermission: (permission: UserPermission | null) => void;
  /** 快速登录（无密码，开发模式） */
  login: (username: string) => void;
  /** 密码登录（内网认证） */
  loginWithPassword: (username: string, password: string, remember?: boolean) => Promise<boolean>;
  /** 企微 token 快捷登录 */
  loginWithWecomToken: (token: string) => Promise<boolean>;
  /** 登出 */
  logout: () => void;
  /** 检查是否可查看指定机构 */
  canView: (organization: string) => boolean;
}

const PermissionContext = createContext<PermissionContextValue>({
  userPermission: null,
  isAuthenticated: false,
  isLoading: true,
  isBranchAdmin: false,
  isOrgUser: false,
  visibleOrganizations: ['全部'],
  setUserPermission: () => { },
  login: () => { },
  loginWithPassword: async () => false,
  loginWithWecomToken: async () => false,
  logout: () => { },
  canView: () => true,
});

interface PermissionProviderProps {
  children: ReactNode;
}

/** localStorage 键名常量 */
const STORAGE_KEY_USER = 'chexian_user';
const STORAGE_KEY_AUTH = 'chexian_auth';

/**
 * 权限上下文 Provider
 *
 * 管理用户登录状态和数据访问权限
 */
export const PermissionProvider: React.FC<PermissionProviderProps> = ({ children }) => {
  const [userPermission, setUserPermissionState] = useState<UserPermission | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化时从 localStorage 恢复登录状态
  useEffect(() => {
    const restoreAuth = async () => {
      try {
        const savedAuth = localStorage.getItem(STORAGE_KEY_AUTH);
        if (savedAuth) {
          // token 不可用时不恢复，避免“已登录UI + 未认证API”的状态抖动
          if (!apiClient.isAuthenticated()) {
            localStorage.removeItem(STORAGE_KEY_AUTH);
            localStorage.removeItem(STORAGE_KEY_USER);
            return;
          }
          const authData = JSON.parse(savedAuth);
          // 验证存储的认证信息
          if (authData.username && authData.permission) {
            setUserPermissionState(authData.permission);
            setPermission(authData.permission);
          }
        } else if (import.meta.env.DEV) {
          // 开发模式：从旧的存储格式恢复
          const savedUser = localStorage.getItem(STORAGE_KEY_USER);
          if (savedUser) {
            const permission = getPermissionByUsername(savedUser);
            setUserPermissionState(permission);
            setPermission(permission);
          }
        }
      } catch (e) {
        logger.error('恢复登录状态失败:', e);
        localStorage.removeItem(STORAGE_KEY_AUTH);
        localStorage.removeItem(STORAGE_KEY_USER);
      } finally {
        setIsLoading(false);
      }
    };

    restoreAuth();
  }, []);

  // 与 apiClient.logout 事件对齐，防止权限状态残留导致重复跳转
  useEffect(() => {
    const handleLogout = () => {
      setUserPermissionState(null);
      setPermission(null);
      localStorage.removeItem(STORAGE_KEY_AUTH);
      localStorage.removeItem(STORAGE_KEY_USER);
    };
    window.addEventListener('auth-logout', handleLogout);
    return () => window.removeEventListener('auth-logout', handleLogout);
  }, []);

  const setUserPermission = useCallback((permission: UserPermission | null) => {
    setUserPermissionState(permission);
    setPermission(permission);
  }, []);

  /** 快速登录（无密码验证，开发模式使用） */
  const login = useCallback((username: string) => {
    const permission = getPermissionByUsername(username);
    setUserPermission(permission);

    // 开发模式：保存到 localStorage
    if (import.meta.env.DEV && permission) {
      localStorage.setItem(STORAGE_KEY_USER, permission.username);
    }

    // 触发登录事件（通知 DataContext 刷新数据），与 loginWithPassword 保持一致
    window.dispatchEvent(new Event('auth-login'));
  }, [setUserPermission]);

  /** 密码登录（调用后端 API 认证） */
  const loginWithPassword = useCallback(async (
    username: string,
    password: string,
    remember: boolean = true
  ): Promise<boolean> => {
    try {
      // 1. 调用后端 API 登录
      const authResult = await apiClient.login(username, password);

      // 2. 根据后端返回的角色获取前端权限配置
      // 优先使用本地配置（包含详细的机构权限），否则从后端角色推断
      const localPermission = getPermissionByUsername(username);
      const permission: UserPermission = localPermission || {
        username: authResult.user.username,
        displayName: authResult.user.displayName,
        role: authResult.user.role === 'branch_admin' ? UserRole.BRANCH_ADMIN : UserRole.ORG_USER,
        // organization 字段对于管理员可以不设置
      };

      setUserPermission(permission);

      // 3. 记住登录状态
      if (remember) {
        localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
          username: permission.username,
          permission,
          timestamp: Date.now(),
        }));
      } else {
        localStorage.removeItem(STORAGE_KEY_AUTH);
        localStorage.removeItem(STORAGE_KEY_USER);
      }

      // 4. 触发登录事件（通知 DataContext 刷新数据）
      window.dispatchEvent(new Event('auth-login'));

      return true;
    } catch (e) {
      logger.error('登录失败:', e);
      // ⚠️ SECURITY FIX: 前端密码验证回退已移除
      // 所有认证必须通过后端 API，确保安全性
      return false;
    }
  }, [setUserPermission]);

  /** 企微 token 解析登录 */
  const loginWithWecomToken = useCallback(async (token: string): Promise<boolean> => {
    try {
      // 1. 设置 token
      apiClient.setToken(token);

      // 2. 解析 JWT Payload
      const payload = JSON.parse(atob(token.split('.')[1]));
      const permission: UserPermission = {
        username: payload.username,
        displayName: payload.username,
        role: payload.role as UserRole,
        organization: payload.organization,
      };

      setUserPermission(permission);

      // 3. 记住登录状态
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
        username: permission.username,
        permission,
        timestamp: Date.now(),
      }));

      // 4. 触发登录事件
      window.dispatchEvent(new Event('auth-login'));
      return true;
    } catch (e) {
      logger.error('WeCom token 校验或解析失败:', e);
      return false;
    }
  }, [setUserPermission]);

  /** 登出 */
  const logout = useCallback(() => {
    setUserPermission(null);
    apiClient.logout(); // 清除 API 客户端 token
    localStorage.removeItem(STORAGE_KEY_AUTH);
    localStorage.removeItem(STORAGE_KEY_USER);
  }, [setUserPermission]);

  const canView = useCallback((organization: string): boolean => {
    if (!userPermission) return false; // 未登录不允许访问
    return canViewOrganization(userPermission, organization);
  }, [userPermission]);

  // 计算派生状态
  const isAuthenticated = userPermission !== null;
  const isBranchAdmin = userPermission?.role === UserRole.BRANCH_ADMIN;
  const isOrgUser = userPermission?.role === UserRole.ORG_USER;
  const visibleOrganizations = userPermission
    ? getVisibleOrganizations(userPermission)
    : ['全部'];

  // ========== 性能优化：useMemo 包裹 value（Phase 4）==========
  // 避免每次渲染都创建新对象，防止所有消费组件不必要的重渲染
  const contextValue = useMemo(
    () => ({
      userPermission,
      isAuthenticated,
      isLoading,
      isBranchAdmin,
      isOrgUser,
      visibleOrganizations,
      setUserPermission,
      login,
      loginWithPassword,
      loginWithWecomToken,
      logout,
      canView,
    }),
    [
      userPermission,
      isAuthenticated,
      isLoading,
      isBranchAdmin,
      isOrgUser,
      visibleOrganizations,
      setUserPermission,
      login,
      loginWithPassword,
      loginWithWecomToken,
      logout,
      canView,
    ]
  );

  return (
    <PermissionContext.Provider value={contextValue}>
      {children}
    </PermissionContext.Provider>
  );
};

/**
 * 使用权限上下文的 Hook
 */
export const usePermission = (): PermissionContextValue => {
  return useContext(PermissionContext);
};

/**
 * 使用可见机构列表的 Hook
 * 便捷方法，用于筛选器组件
 */
export const useVisibleOrganizations = (): string[] => {
  const { visibleOrganizations } = usePermission();
  return visibleOrganizations;
};
