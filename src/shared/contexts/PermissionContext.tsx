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
  /** 是否为电销用户 */
  isTelemarketingUser: boolean;
  /** 用户可见的机构列表 */
  visibleOrganizations: string[];
  /** 设置用户权限 */
  setUserPermission: (permission: UserPermission | null) => void;
  /** 快速登录（无密码，开发模式） */
  login: (username: string) => void;
  /** 密码登录（内网认证） */
  loginWithPassword: (username: string, password: string, remember?: boolean) => Promise<boolean>;
  /** 基于 cookie 会话恢复当前用户 */
  restoreSession: () => Promise<boolean>;
  /** 本会话使用统一初始密码登录，须改密后才能进业务页（AuthGuard 据此强制渲染改密页） */
  mustChangePassword: boolean;
  /** 用户本人改密；成功后 mustChangePassword 复位，会话自动换发 */
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
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
  isTelemarketingUser: false,
  visibleOrganizations: ['全部'],
  setUserPermission: () => { },
  login: () => { },
  loginWithPassword: async () => false,
  restoreSession: async () => false,
  mustChangePassword: false,
  changePassword: async () => { },
  logout: () => { },
  canView: () => true,
});

interface PermissionProviderProps {
  children: ReactNode;
}

/**
 * 权限上下文 Provider
 *
 * 管理用户登录状态和数据访问权限
 */
export const PermissionProvider: React.FC<PermissionProviderProps> = ({ children }) => {
  const [userPermission, setUserPermissionState] = useState<UserPermission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // 统一初始密码强制改密标记（后端 /login、/me 按会话 pwc 声明回传；飞书扫码会话恒 false）
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const buildPermission = useCallback((user: {
    username: string;
    displayName: string;
    role: string;
    organization?: string;
    branchCode?: string;
    visibleBranches?: string[];
    allowedRoutes?: string[];
    defaultRoute?: string;
    specialFeatures?: string[];
  }): UserPermission => {
    const localPermission = getPermissionByUsername(user.username);
    return {
      username: user.username,
      displayName: user.displayName || localPermission?.displayName || user.username,
      role: user.role === 'branch_admin'
        ? UserRole.BRANCH_ADMIN
        : user.role === 'telemarketing_user'
          ? UserRole.TELEMARKETING_USER
          : UserRole.ORG_USER,
      organization: (user.organization as UserPermission['organization']) || localPermission?.organization,
      // 全国超管切省：branchCode=默认省、visibleBranches=可见省集合（后端 /login + /me 派生回传）。
      branchCode: user.branchCode,
      visibleBranches: user.visibleBranches,
      allowedRoutes: user.allowedRoutes || localPermission?.allowedRoutes,
      defaultRoute: user.defaultRoute || localPermission?.defaultRoute,
      specialFeatures: user.specialFeatures,
    };
  }, []);

  const setUserPermission = useCallback((permission: UserPermission | null) => {
    setUserPermissionState(permission);
    setPermission(permission);
  }, []);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    try {
      const me = await apiClient.getCurrentUser();
      const permission = buildPermission(me);
      setUserPermission(permission);
      setMustChangePassword(me.mustChangePassword === true);
      return true;
    } catch {
      setUserPermission(null);
      setMustChangePassword(false);
      apiClient.clearToken();
      return false;
    }
  }, [buildPermission, setUserPermission]);

  // 初始化时基于 cookie 会话恢复登录状态
  useEffect(() => {
    const restoreAuth = async () => {
      try {
        if (!apiClient.isAuthenticated()) {
          return;
        }
        await restoreSession();
      } catch (e) {
        logger.error('恢复登录状态失败:', e);
      } finally {
        setIsLoading(false);
      }
    };

    restoreAuth();
  }, [restoreSession]);

  // 与 apiClient.logout 事件对齐，防止权限状态残留导致重复跳转。
  // auth-session-expired（access token 过期且 refresh 失败，client-core 派发）
  // 同样清空权限状态：否则该事件全局仅 LoginPage 监听，停留在业务页的用户
  // isAuthenticated 恒为 true、不会被 AuthGuard 送回登录页，只能面对各面板
  // 静默 401 空白（BACKLOG 2026-07-03-claude-c5fe8f）。
  useEffect(() => {
    const handleLogout = () => {
      setUserPermissionState(null);
      setPermission(null);
    };
    window.addEventListener('auth-logout', handleLogout);
    window.addEventListener('auth-session-expired', handleLogout);
    return () => {
      window.removeEventListener('auth-logout', handleLogout);
      window.removeEventListener('auth-session-expired', handleLogout);
    };
  }, []);

  /** 快速登录（无密码验证，开发模式使用） */
  const login = useCallback((username: string) => {
    const permission = getPermissionByUsername(username);
    setUserPermission(permission);

    // 触发登录事件（通知 DataContext 刷新数据），与 loginWithPassword 保持一致
    window.dispatchEvent(new Event('auth-login'));
  }, [setUserPermission]);

  /** 密码登录（调用后端 API 认证） */
  const loginWithPassword = useCallback(async (
    username: string,
    password: string,
    _remember: boolean = true
  ): Promise<boolean> => {
    try {
      // 1. 调用后端 API 登录
      const authResult = await apiClient.login(username, password);

      const permission = buildPermission(authResult.user);

      setUserPermission(permission);
      setMustChangePassword(authResult.user.mustChangePassword === true);

      // 3. 触发登录事件（通知 DataContext 刷新数据）
      window.dispatchEvent(new Event('auth-login'));

      return true;
    } catch (e) {
      logger.error('登录失败:', e);
      // ⚠️ SECURITY FIX: 前端密码验证回退已移除
      // 所有认证必须通过后端 API，确保安全性
      return false;
    }
  }, [buildPermission, setUserPermission]);

  /** 用户本人改密：成功后复位强制改密标记（后端同步换发不含 pwc 的会话）。失败原样抛错供页面展示 */
  const changePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<void> => {
    await apiClient.changePassword(oldPassword, newPassword);
    setMustChangePassword(false);
  }, []);

  /** 登出 */
  const logout = useCallback(() => {
    setUserPermission(null);
    setMustChangePassword(false);
    apiClient.logout(); // 清除 API 客户端 token
  }, [setUserPermission]);

  const canView = useCallback((organization: string): boolean => {
    if (!userPermission) return false; // 未登录不允许访问
    return canViewOrganization(userPermission, organization);
  }, [userPermission]);

  // 计算派生状态
  const isAuthenticated = userPermission !== null;
  const isBranchAdmin = userPermission?.role === UserRole.BRANCH_ADMIN;
  const isOrgUser = userPermission?.role === UserRole.ORG_USER;
  const isTelemarketingUser = userPermission?.role === UserRole.TELEMARKETING_USER;
  // 注：按用户默认 branchCode 取，不感知超管切省（PermissionContext 无法依赖
  // BranchContext，避免循环引用）。切省感知版见 BranchContext.useEffectiveVisibleOrganizations，
  // 需要机构下拉随切省联动的消费方（如 FilterLayoutV2）应改用该 hook。
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
      isTelemarketingUser,
      visibleOrganizations,
      setUserPermission,
      login,
      loginWithPassword,
      restoreSession,
      mustChangePassword,
      changePassword,
      logout,
      canView,
    }),
    [
      userPermission,
      isAuthenticated,
      isLoading,
      isBranchAdmin,
      isOrgUser,
      isTelemarketingUser,
      visibleOrganizations,
      setUserPermission,
      login,
      loginWithPassword,
      restoreSession,
      mustChangePassword,
      changePassword,
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
