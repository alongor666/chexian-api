export const DECISION_DOMAINS = [
  '经营总览',
  '增长达成',
  '成本质量',
  '客户经营',
  '专项资源',
  '平台管理',
] as const;

export type NavigationDomain = (typeof DECISION_DOMAINS)[number];
export type SpecialFeature = 'moto_cost' | 'expense_development';

export interface RouteDefinition {
  readonly id: string;
  readonly path: `/${string}`;
  readonly label: string;
  readonly shortLabel: string;
  readonly navigationDomain: NavigationDomain;
  readonly navigationOrder: number;
  readonly permissionConfigurable: boolean;
  readonly aliases?: readonly `/${string}`[];
  readonly specialFeature?: SpecialFeature;
}

export const ROUTES: readonly RouteDefinition[] = [
  { id: 'home', path: '/home', label: '首页', shortLabel: '首页', navigationDomain: '经营总览', navigationOrder: 10, permissionConfigurable: true },
  { id: 'dashboard', path: '/dashboard', label: '经营看板', shortLabel: '看板', navigationDomain: '经营总览', navigationOrder: 20, permissionConfigurable: true, aliases: ['/old-dashboard'] },
  { id: 'chart-ledger', path: '/chart-ledger', label: '图表账本', shortLabel: '账本', navigationDomain: '经营总览', navigationOrder: 30, permissionConfigurable: true },

  { id: 'performance-analysis', path: '/performance-analysis', label: '业绩分析', shortLabel: '业绩', navigationDomain: '增长达成', navigationOrder: 10, permissionConfigurable: true },
  { id: 'reports', path: '/reports', label: '保费计划达成', shortLabel: '保费', navigationDomain: '增长达成', navigationOrder: 20, permissionConfigurable: true, aliases: ['/premium-report', '/marketing-report'] },
  { id: 'growth', path: '/growth', label: '增长对比', shortLabel: '增长', navigationDomain: '增长达成', navigationOrder: 30, permissionConfigurable: true, aliases: ['/comparison'] },

  { id: 'cost', path: '/cost', label: '成本分析', shortLabel: '成本', navigationDomain: '成本质量', navigationOrder: 10, permissionConfigurable: true, aliases: ['/comprehensive-analysis'] },
  { id: 'claims-detail', path: '/claims-detail', label: '赔案分析', shortLabel: '赔案', navigationDomain: '成本质量', navigationOrder: 20, permissionConfigurable: true },
  { id: 'expense-development', path: '/expense-development', label: '费用率发展', shortLabel: '费发', navigationDomain: '成本质量', navigationOrder: 30, permissionConfigurable: true, specialFeature: 'expense_development' },
  { id: 'moto-cost', path: '/moto-cost', label: '摩意成本', shortLabel: '摩意', navigationDomain: '成本质量', navigationOrder: 40, permissionConfigurable: false, specialFeature: 'moto_cost' },

  { id: 'renewal-tracker', path: '/renewal-tracker', label: '续保追踪', shortLabel: '续保', navigationDomain: '客户经营', navigationOrder: 10, permissionConfigurable: true },
  { id: 'quote-conversion', path: '/quote-conversion', label: '报价转化', shortLabel: '报价', navigationDomain: '客户经营', navigationOrder: 20, permissionConfigurable: true },
  { id: 'customer-flow', path: '/customer-flow', label: '客户流向', shortLabel: '流向', navigationDomain: '客户经营', navigationOrder: 30, permissionConfigurable: true },

  { id: 'specialty', path: '/specialty', label: '驾意险与货车', shortLabel: '专项', navigationDomain: '专项资源', navigationOrder: 10, permissionConfigurable: true, aliases: ['/truck', '/cross-sell'] },
  { id: 'repair', path: '/repair', label: '维修资源', shortLabel: '维修', navigationDomain: '专项资源', navigationOrder: 20, permissionConfigurable: true },

  { id: 'data-import', path: '/data-import', label: '数据管理', shortLabel: '数据', navigationDomain: '平台管理', navigationOrder: 10, permissionConfigurable: false },
  { id: 'access-control', path: '/admin/access-control', label: '权限管理', shortLabel: '权限', navigationDomain: '平台管理', navigationOrder: 20, permissionConfigurable: false },
] as const;

export function getPermissionRoutes(): readonly RouteDefinition[] {
  return ROUTES.filter((route) => route.permissionConfigurable);
}

export interface NavigationGroup {
  readonly domain: NavigationDomain;
  readonly routes: readonly RouteDefinition[];
}

export function getNavigationGroups(): readonly NavigationGroup[] {
  return DECISION_DOMAINS.map((domain) => ({
    domain,
    routes: ROUTES
      .filter((route) => route.navigationDomain === domain)
      .sort((left, right) => left.navigationOrder - right.navigationOrder),
  }));
}
