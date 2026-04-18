import React, { useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSidebar } from './SidebarLayout';
import type { LucideIcon } from 'lucide-react';
import {
  Gauge,
  DollarSign,
  TrendingUp,
  BarChart3,
  Calculator,
  Gift,
  ChevronLeft,
  ChevronRight,
  X,
  Bike,
  Shield,
  Database,
  Target,
  FileWarning,
  Wrench,
  ArrowLeftRight,
  TrendingDown,
  RefreshCcw,
} from 'lucide-react';
import { SidebarUserPanel } from './SidebarUserPanel';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { canAccessRoute, canAccessMotoCost, canAccessCost, canAccessExpenseDevelopment, UserRole } from '../../shared/config/organizations';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { useRBAC } from '../../shared/hooks/useRBAC';
import { buildFilterParams } from '../../shared/utils/filterParams';
import { apiClient } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';
import { useSidebarResize } from '../../shared/hooks/useSidebarResize';


interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  shortLabel?: string;
  tooltipLabel?: string;
}

const dataNavItems: NavItem[] = [
  { path: '/dashboard', icon: Gauge, label: '仪表盘', shortLabel: '仪表' },
  { path: '/performance-analysis', icon: TrendingUp, label: '业绩分析', shortLabel: '业绩' },
  { path: '/reports', icon: DollarSign, label: '保费达成', shortLabel: '保费' },
  { path: '/specialty', icon: Gift, label: '专项分析', shortLabel: '专项' },
  { path: '/growth', icon: BarChart3, label: '增长与对比', shortLabel: '增长' },
  { path: '/cost', icon: Calculator, label: '成本综合', shortLabel: '成本' },
];

const toolNavItems: NavItem[] = [
  { path: '/renewal-analysis', icon: RefreshCcw, label: '续保分析', shortLabel: '续保' },
  { path: '/quote-conversion', icon: Target, label: '报价转化', shortLabel: '报价' },
  { path: '/expense-development', icon: TrendingDown, label: '费用率发展', shortLabel: '费发' },
  { path: '/claims-detail', icon: FileWarning, label: '赔案明细', shortLabel: '赔案' },
  { path: '/repair', icon: Wrench, label: '维修资源', shortLabel: '维修' },
  { path: '/customer-flow', icon: ArrowLeftRight, label: '客户来源', shortLabel: '来源' },
  { path: '/data-import', icon: Database, label: '数据导入', shortLabel: '导入' },
  { path: '/moto-cost', icon: Bike, label: '摩意模型', shortLabel: '摩意' },
];

const adminNavItems: NavItem[] = [
  { path: '/admin/access-control', icon: Shield, label: '权限管理', shortLabel: '权限' },
];

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
  const { collapsed, toggle, mobileOpen, setMobileOpen, isMobile, sidebarWidth, setSidebarWidth, isDragging, setIsDragging } = useSidebar();
  const { handleMouseDown: handleResizeMouseDown } = useSidebarResize({ sidebarWidth, setSidebarWidth, setIsDragging });
  const location = useLocation();
  const { userPermission } = usePermission();
  const queryClient = useQueryClient();
  const { filters } = useGlobalFilters();
  const { isOrgUser, userOrg } = useRBAC();

  const isActive = (path: string) => location.pathname.startsWith(path);

  /** hover 时预取对应页面的 bundle 数据（利用 150-300ms hover 时间差） */
  const handlePrefetch = useCallback((path: string) => {
    const params = buildFilterParams(filters, { isOrgUser, userOrg });

    switch (path) {
      case '/dashboard':
        queryClient.prefetchQuery({
          queryKey: queryKeys.dashboardBundle(params),
          queryFn: () => apiClient.getDashboardBundle(params),
        });
        break;
      case '/performance-analysis':
        queryClient.prefetchQuery({
          queryKey: queryKeys.performanceBundle(params),
          queryFn: () => apiClient.getPerformanceBundle(params),
        });
        break;
      case '/specialty':
        queryClient.prefetchQuery({
          queryKey: queryKeys.crossSellBundle(params),
          queryFn: () => apiClient.getCrossSellBundle(params),
        });
        break;
      case '/growth':
        queryClient.prefetchQuery({
          queryKey: queryKeys.comprehensiveBundle(params),
          queryFn: () => apiClient.getComprehensiveBundle(params),
        });
        break;
      // cost/reports/renewal/claims/repair/customer-flow 需要页面内部参数（analysisType/planYear/groupBy 等），不适合简单 prefetch
    }
  }, [filters, isOrgUser, userOrg, queryClient]);

  // 移动端：总是展开显示；桌面端：根据 collapsed 状态
  const showExpanded = isMobile || !collapsed;

  const renderCollapsedTooltip = (label: string, description?: string) => (
    <div className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 z-50 -translate-y-1/2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 shadow-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      <div className="whitespace-nowrap text-sm font-medium text-neutral-800 dark:text-neutral-200">{label}</div>
      {description ? <div className="mt-0.5 whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400">{description}</div> : null}
    </div>
  );

  const renderNavItem = (item: NavItem) => {
    const IconComponent = item.icon;
    const canAccess = userPermission ? canAccessRoute(userPermission, item.path) : true;

    if (!canAccess) {
      return (
        <div
          key={item.path}
          className="group relative flex items-center px-3 py-2.5 md:py-2.5 rounded-lg transition-all duration-200 min-h-[44px] md:min-h-0 text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800 cursor-not-allowed opacity-70"
          title={!showExpanded ? `${item.label}（无权限）` : undefined}
          aria-disabled="true"
        >
          <IconComponent
            size={20}
            className="flex-shrink-0"
            aria-hidden="true"
          />
          {showExpanded && (
            <span className="ml-3 text-sm font-medium truncate">{item.label}</span>
          )}
          {!showExpanded && renderCollapsedTooltip(item.tooltipLabel ?? item.label, '当前账号无权限')}
        </div>
      );
    }

    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={`group relative flex items-center px-3 py-2.5 md:py-2.5 rounded-lg transition-all duration-200 min-h-[44px] md:min-h-0 ${isActive(item.path)
          ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-semibold'
          : 'text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 hover:text-neutral-900'
          }`}
        title={!showExpanded ? item.label : undefined}
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
        {showExpanded && (
          <span className="ml-3 text-sm font-medium truncate">{item.label}</span>
        )}
        {!showExpanded && renderCollapsedTooltip(item.tooltipLabel ?? item.label)}
      </NavLink>
    );
  };

  const renderSection = (title: string, items: NavItem[]) => (
    <>
      <div className="my-3 border-t border-neutral-200 dark:border-neutral-700" role="separator" />
      {showExpanded ? (
        <div className="px-3 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-[0.16em]">
          {title}
        </div>
      ) : (
        <div className="flex justify-center py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" aria-hidden="true" />
        </div>
      )}
      {items.map(renderNavItem)}
    </>
  );

  // 计算侧边栏的显示状态和样式
  const getSidebarClasses = () => {
    const baseClasses = `fixed left-0 top-14 bottom-0 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 z-40 flex flex-col ${!isDragging ? 'transition-all duration-300' : ''}`;

    if (isMobile) {
      // 移动端：抽屉模式，不淡化
      return `${baseClasses} w-72 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`;
    }

    // 桌面端：默认淡化，hover 显现
    return `${baseClasses} opacity-30 hover:opacity-100 transition-opacity duration-300`;
  };

  return (
    <aside
      className={getSidebarClasses()}
      style={!isMobile ? { width: collapsed ? '64px' : `${sidebarWidth}px` } : undefined}
      role="navigation"
      aria-label="主导航"
    >
      {/* 拖拽把手 - 放侧边栏右侧 */}
      {!isMobile && !collapsed && (
        <div
          className="absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-primary-400 z-50 transition-colors"
          style={{ transform: 'translateX(50%)' }}
          onMouseDown={handleResizeMouseDown}
        />
      )}
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
        <nav className="px-3 py-4 space-y-1">
          {renderSection(
            '数据分析',
            dataNavItems.filter(item => {
              if (item.path === '/cost') return canAccessCost(userPermission?.username, userPermission?.specialFeatures);
              return true;
            })
          )}

          {renderSection(
            '工具',
            toolNavItems.filter(item => {
              if (item.path === '/moto-cost') {
                return canAccessMotoCost(userPermission?.username, userPermission?.specialFeatures);
              }
              if (item.path === '/expense-development') {
                return canAccessExpenseDevelopment(userPermission?.username, userPermission?.specialFeatures);
              }
              return true;
            })
          )}

          {userPermission?.role === UserRole.BRANCH_ADMIN && (
            renderSection('管理', adminNavItems)
          )}
        </nav>

      </div>

      {/* 底部区域：用户面板 + 收起/展开按钮 */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 p-3 space-y-2">
        <SidebarUserPanel />

        {/* 收起/展开按钮 - 仅桌面端显示 */}
        {!isMobile && (
          <button
            onClick={toggle}
            className="w-full flex items-center justify-center px-3 py-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!collapsed}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? (
              <ChevronRight size={20} aria-hidden="true" />
            ) : (
              <>
                <ChevronLeft size={20} aria-hidden="true" />
                <span className="ml-2 text-sm">收起侧边栏</span>
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
};
