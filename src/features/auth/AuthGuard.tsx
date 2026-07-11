import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { buildRedirectState, sanitizePathForLog } from '../../shared/utils/redirect-state';
import { Logger } from '../../shared/utils/logger';
import { ChangePasswordPage } from './ChangePasswordPage';

interface AuthGuardProps {
  children: ReactNode;
}

const logger = new Logger('AuthGuard');

/**
 * 认证守卫组件
 *
 * 功能：
 * - 检查用户是否已登录
 * - 未登录重定向到登录页面
 * - 保存原目标路径用于登录后跳转
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading, mustChangePassword } = usePermission();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;

  // 正在加载认证状态时显示加载
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">验证登录状态...</p>
        </div>
      </div>
    );
  }

  // 未登录重定向到登录页
  if (!isAuthenticated) {
    logger.debug('Redirect unauthenticated request to login', { fromPath: sanitizePathForLog(fromPath) });
    return <Navigate to="/login" state={buildRedirectState(fromPath)} replace />;
  }

  // 统一初始密码未改密：强制渲染改密页，改密成功前不放行任何业务页
  // （后端 authMiddleware 同步按 pwc 声明拦截业务 API，此处仅是体验层）
  if (mustChangePassword) {
    return <ChangePasswordPage />;
  }

  return <>{children}</>;
};
