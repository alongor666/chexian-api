import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { canAccessRoute, getDefaultRoute } from '../../shared/config/organizations';

interface RouteAccessGuardProps {
  children: ReactNode;
  routePath: string;
}

/**
 * 页面级权限守卫
 * 对受限账号做路由白名单控制，未授权页面跳转到默认页。
 */
export const RouteAccessGuard: React.FC<RouteAccessGuardProps> = ({ children, routePath }) => {
  const { userPermission } = usePermission();
  const location = useLocation();

  if (!userPermission) {
    return <>{children}</>;
  }

  if (!canAccessRoute(userPermission, routePath)) {
    const fallbackPath = getDefaultRoute(userPermission);
    return <Navigate to={fallbackPath} replace state={{ from: location }} />;
  }

  return <>{children}</>;
};
