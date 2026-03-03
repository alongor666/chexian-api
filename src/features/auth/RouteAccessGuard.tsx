import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { canAccessRoute, getDefaultRoute } from '../../shared/config/organizations';
import { buildRedirectState, sanitizePathForLog } from '../../shared/utils/redirect-state';
import { Logger } from '../../shared/utils/logger';

interface RouteAccessGuardProps {
  children: ReactNode;
  routePath: string;
}

const logger = new Logger('RouteAccessGuard');

/**
 * 页面级权限守卫
 * 对受限账号做路由白名单控制，未授权页面跳转到默认页。
 */
export const RouteAccessGuard: React.FC<RouteAccessGuardProps> = ({ children, routePath }) => {
  const { userPermission } = usePermission();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;

  if (!userPermission) {
    return <>{children}</>;
  }

  if (!canAccessRoute(userPermission, routePath)) {
    const fallbackPath = getDefaultRoute(userPermission);
    logger.debug('Route access denied, redirect to fallback', {
      routePath,
      fallbackPath,
      fromPath: sanitizePathForLog(fromPath),
    });
    return <Navigate to={fallbackPath} replace state={buildRedirectState(fromPath)} />;
  }

  return <>{children}</>;
};
