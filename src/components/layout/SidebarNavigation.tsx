import React, { useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DESKTOP_SIDEBAR_WIDTH, useSidebar } from './SidebarLayout';
import type { LucideIcon } from 'lucide-react';
import {
  Gauge,
  DollarSign,
  TrendingUp,
  BarChart3,
  Calculator,
  Gift,
  X,
  Bike,
  Shield,
  Database,
  Target,
  FileWarning,
  Wrench,
  ArrowLeftRight,
  TrendingDown,
  RefreshCw,
  Home,
  LayoutGrid,
} from 'lucide-react';
import { SidebarUserPanel } from './SidebarUserPanel';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { canAccessRoute, canAccessMotoCost, canAccessExpenseDevelopment, UserRole } from '../../shared/config/organizations';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { useRBAC } from '../../shared/hooks/useRBAC';
import { buildFilterParams } from '../../shared/utils/filterParams';
import { apiClient } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';
import { getNavigationGroups, type IconKey, type RouteDefinition } from '../../shared/config/routeRegistry';


interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  shortLabel?: string;
  tooltipLabel?: string;
}

const ICONS: Record<IconKey, LucideIcon> = {
  home: Home, gauge: Gauge, 'layout-grid': LayoutGrid, 'trending-up': TrendingUp,
  'dollar-sign': DollarSign, 'bar-chart': BarChart3, calculator: Calculator,
  'file-warning': FileWarning, 'trending-down': TrendingDown, bike: Bike,
  refresh: RefreshCw, target: Target, 'arrow-left-right': ArrowLeftRight,
  gift: Gift, wrench: Wrench, database: Database, shield: Shield,
};

const toNavItem = (route: RouteDefinition): NavItem => ({
  path: route.path,
  icon: ICONS[route.iconKey],
  label: route.label,
  shortLabel: route.shortLabel,
});

/**
 * 侧边栏导航组件
 *
 * 功能：
 * - 首页入口（数据导入）
 * - 数据模块菜单列表
 * - 当前激活状态高亮
 * - 收起/展开切换
 * - Lucide图标 + 文字标签
 */
export const SidebarNavigation: React.FC = () => {
  const { mobileOpen, setMobileOpen, isMobile } = useSidebar();
  const location = useLocation();
  const { userPermission } = usePermission();
  const queryClient = useQueryClient();
  const { filters } = useGlobalFilters();
  const { isOrgUser, userOrg } = useRBAC();

  const isActive = (path: string) => location.pathname.startsWith(path);

  /** hover 时预取对应页面的 bundle 数据（利用 150-300ms hover 时间差） */
  const handlePrefetch = useCallback((path: string) => {
    const params = buildFilterParams(filters, { isOrgUser, userOrg });
    if (!params.startDate || !params.endDate) {
      return;
    }

    switch (path) {
      case '/dashboard':
        {
          const dashboardParams = {
            ...params,
            granularity: 'week',
            perspective: 'premium',
            rankingLimit: '10',
          };
          queryClient.prefetchQuery({
            queryKey: queryKeys.dashboardBundle(dashboardParams),
            queryFn: () => apiClient.getDashboardBundle(dashboardParams),
          });
        }
        break;
      case '/performance-analysis':
        {
          const performanceParams = {
            ...params,
            drillPath: [],
            groupBy: 'org_level_3',
            segmentTag: 'all',
            timePeriod: 'day',
            growthMode: 'mom',
            expandDims: 'none',
          };
          queryClient.prefetchQuery({
            queryKey: queryKeys.performanceBundle(performanceParams),
            queryFn: () => apiClient.performance.bundle(performanceParams),
          });
        }
        break;
      case '/specialty':
        {
          const crossSellParams = {
            ...params,
            drillPath: [],
            groupBy: 'org_level_3',
            vehicleCategory: 'passenger',
            granularity: 'daily',
            timePeriod: 'daily',
          };
          queryClient.prefetchQuery({
            queryKey: queryKeys.crossSellBundle(crossSellParams),
            queryFn: () => apiClient.crossSell.bundle(crossSellParams),
          });
        }
        break;
      // growth/cost/reports/renewal/claims/repair/customer-flow 需要页面内部参数（analysisType/planYear/groupBy 等），不适合简单 prefetch
    }
  }, [filters, isOrgUser, userOrg, queryClient]);

  // 移动端保持抽屉展开；桌面端固定为图标 + 两字短标签的窄栏。
  const isCompactRail = !isMobile;

  const isRouteVisible = (route: RouteDefinition) => {
    if (route.specialFeature === 'moto_cost') {
      return canAccessMotoCost(userPermission?.username, userPermission?.specialFeatures);
    }
    if (route.specialFeature === 'expense_development') {
      return canAccessExpenseDevelopment(userPermission?.username, userPermission?.specialFeatures);
    }
    if (route.id === 'access-control') {
      return userPermission?.role === UserRole.BRANCH_ADMIN;
    }
    return true;
  };

  const renderNavItem = (item: NavItem) => {
    const IconComponent = item.icon;
    const canAccess = userPermission ? canAccessRoute(userPermission, item.path) : true;
    const visibleLabel = isCompactRail ? item.shortLabel ?? item.label.slice(0, 2) : item.label;
    const itemClasses = isCompactRail
      ? 'group relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 transition-colors duration-200'
      : 'group relative flex items-center px-3 py-2.5 md:py-2.5 rounded-lg transition-all duration-200 min-h-[44px] md:min-h-0';
    const labelClasses = isCompactRail
      ? 'text-[13px] font-semibold leading-none tracking-normal'
      : 'ml-3 text-sm font-medium truncate';

    if (!canAccess) {
      return (
        <div
          key={item.path}
          className={`${itemClasses} text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800 cursor-not-allowed opacity-70`}
          title={`${item.label}（无权限）`}
          aria-disabled="true"
          aria-label={`${item.label}（无权限）`}
        >
          <IconComponent
            size={20}
            className="flex-shrink-0"
            aria-hidden="true"
          />
          <span className={labelClasses}>{visibleLabel}</span>
        </div>
      );
    }

    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={`${itemClasses} ${isActive(item.path)
          ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold'
          : 'text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 hover:text-neutral-900'
          }`}
        title={item.label}
        aria-label={item.tooltipLabel ?? item.label}
        onMouseEnter={() => handlePrefetch(item.path)}
      >
        {isActive(item.path) && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" aria-hidden="true" />
        )}
        <IconComponent
          size={20}
          className="flex-shrink-0"
          aria-hidden="true"
        />
        <span className={labelClasses}>{visibleLabel}</span>
      </NavLink>
    );
  };

  const renderSection = (title: string, items: NavItem[], shortTitle = title.slice(0, 2)) => (
    <>
      <div className="my-3 border-t border-neutral-200 dark:border-neutral-700" role="separator" />
      {isMobile ? (
        <div className="px-3 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-[0.16em]">
          {title}
        </div>
      ) : (
        <div className="px-1 py-2 text-center text-[11px] font-semibold leading-none tracking-normal text-neutral-400">
          {shortTitle}
        </div>
      )}
      {items.map(renderNavItem)}
    </>
  );

  // 计算侧边栏的显示状态和样式
  const getSidebarClasses = () => {
    const baseClasses = 'fixed left-0 top-14 bottom-0 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 z-40 flex flex-col transition-all duration-300';

    if (isMobile) {
      // 移动端：抽屉模式，不淡化
      return `${baseClasses} w-72 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`;
    }

    return baseClasses;
  };

  return (
    <aside
      className={getSidebarClasses()}
      style={!isMobile ? { width: `${DESKTOP_SIDEBAR_WIDTH}px` } : undefined}
      role="navigation"
      aria-label="主导航"
    >
      {/* 移动端：关闭按钮 */}
      {isMobile && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 md:hidden">
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">导航菜单</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="关闭导航菜单"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 导航菜单 */}
      <div className="flex-1 overflow-y-auto overflow-x-visible">
        <nav className={`${isMobile ? 'px-3 py-4' : 'px-2 py-3'} space-y-1`}>
          {getNavigationGroups().map((group) => (
            <React.Fragment key={group.domain}>
              {renderSection(group.label, group.routes.filter(isRouteVisible).map(toNavItem))}
            </React.Fragment>
          ))}
        </nav>

      </div>

      {/* 底部区域：用户面板 */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 p-2">
        <SidebarUserPanel />
      </div>
    </aside>
  );
};
