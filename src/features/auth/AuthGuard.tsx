import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * 认证守卫组件
 *
 * 功能：
 * - 检查用户是否已登录
 * - 未登录重定向到登录页面
 * - 保存原目标路径用于登录后跳转
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = usePermission();
  const location = useLocation();

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
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};
