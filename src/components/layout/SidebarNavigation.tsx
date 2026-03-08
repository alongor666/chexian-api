import React, { useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSidebar } from './SidebarLayout';
import type { LucideIcon } from 'lucide-react';
import {
  Home,
  LayoutDashboard,
  DollarSign,
  Target,
  Truck,
  RefreshCw,
  TrendingUp,
  Calculator,
  Scale,
  Search,
  Gift,
  Percent,
  ChevronLeft,
  ChevronRight,
  X,
  Bike,
  Shield,
} from 'lucide-react';
import { SidebarUserPanel } from './SidebarUserPanel';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { canAccessRoute, canAccessMotoCost, canAccessFeeAnalysis, canAccessCost, UserRole } from '../../shared/config/organizations';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { useRBAC } from '../../shared/hooks/useRBAC';
import { buildFilterParams } from '../../shared/utils/filterParams';
import { apiClient } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';


interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  shortLabel?: string;
}

const navItems: NavItem[] = [
  { path: '/', icon: Home, label: '首页', shortLabel: '首页' },
];

const dataNavItems: NavItem[] = [
  { path: '/dashboard', icon: LayoutDashboard, label: '仪表盘', shortLabel: '仪表' },
  { path: '/performance-analysis', icon: TrendingUp, label: '业绩分析', shortLabel: '业绩' },
  { path: '/premium-report', icon: DollarSign, label: '保费报表', shortLabel: '报表' },
  { path: '/marketing-report', icon: Target, label: '营销战报', shortLabel: '战报' },
  { path: '/truck', icon: Truck, label: '营业货车', shortLabel: '货车' },
  { path: '/renewal', icon: RefreshCw, label: '续保分析', shortLabel: '续保' },
  { path: '/cross-sell', icon: Gift, label: '驾意险推介率', shortLabel: '推介' },
  { path: '/growth', icon: TrendingUp, label: '增长分析', shortLabel: '增长' },
  { path: '/cost', icon: Calculator, label: '成本分析', shortLabel: '成本' },
  { path: '/fee-analysis', icon: Percent, label: '费用分析', shortLabel: '费用' },
  { path: '/comparison', icon: Scale, label: '数据对比', shortLabel: '对比' },
  { path: '/coefficient', icon: Search, label: '系数监控', shortLabel: '系数' },
];

const toolNavItems: NavItem[] = [
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
  const location = useLocation();
  const { userPermission } = usePermission();
  const queryClient = useQueryClient();
  const { filters } = useGlobalFilters();
  const { isOrgUser, userOrg } = useRBAC();

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  /** hover 时预取对应页面的 bundle 数据（利用 150-300ms hover 时间差） */
  /** hover 时预取对应页面的 bundle 数据（利用 150-300ms hover 时间差） */
  const handlePrefetch = useCallback((path: string) => {
    const params = buildFilterParams(filters, { isOrgUser, userOrg });

    // staleTime 继承全局 QueryClient 配置（5min），无需重复指定
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
      case '/cross-sell':
        queryClient.prefetchQuery({
          queryKey: queryKeys.crossSellBundle(params),
          queryFn: () => apiClient.getCrossSellBundle(params),
        });
        break;
      case '/renewal':
        queryClient.prefetchQuery({
          queryKey: queryKeys.renewalAnalysis(params),
          queryFn: () => apiClient.getRenewalAnalysis(params),
        });
        break;
      case '/truck':
        queryClient.prefetchQuery({
          queryKey: queryKeys.truckAnalysis(params),
          queryFn: () => apiClient.getTruckAnalysis(params),
        });
        break;
      case '/coefficient':
        queryClient.prefetchQuery({
          queryKey: queryKeys.coefficient(params),
          queryFn: () => apiClient.getCoefficientData(params),
        });
        break;
      // growth/cost/fee-analysis/marketing-report/premium-report/comprehensive-analysis
      // 采用命令式加载模式或需要额外参数，不适合简单 prefetch
    }
  }, [filters, isOrgUser, userOrg, queryClient]);

  // 移动端：总是展开显示；桌面端：根据 collapsed 状态
  const showExpanded = isMobile || !collapsed;

  const renderNavItem = (item: NavItem) => {
    const IconComponent = item.icon;
    const canAccess = userPermission ? canAccessRoute(userPermission, item.path) : true;

    if (!canAccess) {
      return (
        <div
          key={item.path}
          className="flex items-center px-3 py-2.5 md:py-2.5 rounded-lg transition-all duration-200 min-h-[44px] md:min-h-0 text-neutral-400 bg-neutral-50 cursor-not-allowed opacity-70"
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
        </div>
      );
    }

    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={`flex items-center px-3 py-2.5 md:py-2.5 rounded-lg transition-all duration-200 group min-h-[44px] md:min-h-0 ${isActive(item.path)
          ? 'bg-primary text-white shadow-md'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
          }`}
        title={!showExpanded ? item.label : undefined}
        onMouseEnter={() => handlePrefetch(item.path)}
      >
        <IconComponent
          size={20}
          className="flex-shrink-0"
          aria-hidden="true"
        />
        {showExpanded && (
          <span className="ml-3 text-sm font-medium truncate">{item.label}</span>
        )}
      </NavLink>
    );
  };

  // 计算侧边栏的显示状态和样式
  const getSidebarClasses = () => {
    const baseClasses = `fixed left-0 top-14 bottom-0 bg-white border-r border-neutral-200 z-40 flex flex-col ${!isDragging ? 'transition-all duration-300' : ''}`;

    if (isMobile) {
      // 移动端：抽屉模式，总是宽展开
      return `${baseClasses} w-72 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`;
    }

    // 桌面端：根据 collapsed 状态
    return baseClasses;
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
          className="absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-blue-400 z-50 transition-colors"
          style={{ transform: 'translateX(50%)' }}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const handleMouseMove = (moveEvent: MouseEvent) => {
              let newWidth = startWidth + (moveEvent.clientX - startX); // 向右拉增加宽度
              if (newWidth < 200) newWidth = 200;
              if (newWidth > 400) newWidth = 400;
              setSidebarWidth(newWidth);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              document.body.style.cursor = '';
              document.body.style.userSelect = '';
              setIsDragging(false);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}
      {/* 移动端：关闭按钮 */}
      {isMobile && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 md:hidden">
          <span className="text-sm font-semibold text-neutral-700">导航菜单</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="关闭导航菜单"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 导航菜单 */}
      <div className="flex-1 overflow-y-auto">
        <nav className="px-3 py-4 space-y-1">
          {/* 首页入口 */}
          {navItems.map(renderNavItem)}

          {/* 分隔线 */}
          <div className="my-3 border-t border-neutral-200" role="separator" />

          {/* 数据模块 */}
          {showExpanded && (
            <div className="px-3 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              数据分析
            </div>
          )}
          {dataNavItems
            .filter(item => {
              // 超级用户专属功能
              if (item.path === '/fee-analysis') return canAccessFeeAnalysis(userPermission?.username);
              // 成本分析白名单控制
              if (item.path === '/cost') return canAccessCost(userPermission?.username);
              return true;
            })
            .map(renderNavItem)}

          {/* 工具模块 */}
          <div className="my-3 border-t border-neutral-200" role="separator" />
          {showExpanded && (
            <div className="px-3 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              工具
            </div>
          )}
          {toolNavItems
            .filter(item => {
              // 摩意模型功能仅对白名单用户开放
              if (item.path === '/moto-cost') {
                return canAccessMotoCost(userPermission?.username);
              }
              return true;
            })
            .map(renderNavItem)}

          {userPermission?.role === UserRole.BRANCH_ADMIN && (
            <>
              <div className="my-3 border-t border-neutral-200" role="separator" />
              {showExpanded && (
                <div className="px-3 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  管理
                </div>
              )}
              {adminNavItems.map(renderNavItem)}
            </>
          )}
        </nav>

      </div>

      {/* 底部区域：用户面板 + 收起/展开按钮 */}
      <div className="border-t border-neutral-200 p-3 space-y-2">
        <SidebarUserPanel />

        {/* 收起/展开按钮 - 仅桌面端显示 */}
        {!isMobile && (
          <button
            onClick={toggle}
            className="w-full flex items-center justify-center px-3 py-2 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
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
