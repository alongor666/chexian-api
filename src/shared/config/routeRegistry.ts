export type DecisionDomainId = 'overview' | 'growth' | 'cost' | 'customer' | 'specialty' | 'platform';
export type RouteId =
  | 'home' | 'dashboard' | 'chart-ledger'
  | 'performance-analysis' | 'reports' | 'growth'
  | 'cost' | 'claims-detail' | 'expense-development' | 'moto-cost'
  | 'renewal-tracker' | 'quote-conversion' | 'customer-flow'
  | 'specialty' | 'repair' | 'data-import' | 'access-control';
export type IconKey =
  | 'home' | 'gauge' | 'layout-grid' | 'trending-up' | 'dollar-sign' | 'bar-chart'
  | 'calculator' | 'file-warning' | 'trending-down' | 'bike' | 'refresh' | 'target'
  | 'arrow-left-right' | 'gift' | 'wrench' | 'database' | 'shield';

function freezeObjects<T extends object>(values: T[]): readonly Readonly<T>[] {
  values.forEach((value) => Object.freeze(value));
  return Object.freeze(values);
}

export const DECISION_DOMAINS: readonly { readonly id: DecisionDomainId; readonly label: string }[] = freezeObjects([
  { id: 'overview', label: '经营总览' },
  { id: 'growth', label: '增长达成' },
  { id: 'cost', label: '成本质量' },
  { id: 'customer', label: '客户经营' },
  { id: 'specialty', label: '专项资源' },
  { id: 'platform', label: '平台管理' },
]);
export type SpecialFeature = 'moto_cost' | 'expense_development';

export interface RouteDefinition {
  readonly kind: 'canonical';
  readonly id: RouteId;
  readonly path: `/${string}`;
  readonly label: string;
  readonly shortLabel: string;
  readonly iconKey: IconKey;
  readonly navigationDomain: DecisionDomainId;
  readonly navigationOrder: number;
  readonly showInNavigation: boolean;
  readonly permissionConfigurable: boolean;
  readonly aliases?: readonly `/${string}`[];
  readonly specialFeature?: SpecialFeature;
}

function freezeRoutes(routes: RouteDefinition[]): readonly RouteDefinition[] {
  routes.forEach((route) => {
    if (route.aliases) Object.freeze(route.aliases);
    Object.freeze(route);
  });
  return Object.freeze(routes);
}

export const ROUTES: readonly RouteDefinition[] = freezeRoutes([
  { kind: 'canonical', id: 'home', path: '/home', label: '首页', shortLabel: '首页', iconKey: 'home', navigationDomain: 'overview', navigationOrder: 10, showInNavigation: true, permissionConfigurable: true },
  { kind: 'canonical', id: 'dashboard', path: '/dashboard', label: '经营看板', shortLabel: '看板', iconKey: 'gauge', navigationDomain: 'overview', navigationOrder: 20, showInNavigation: true, permissionConfigurable: true, aliases: ['/old-dashboard'] },
  { kind: 'canonical', id: 'chart-ledger', path: '/chart-ledger', label: '图表账本', shortLabel: '账本', iconKey: 'layout-grid', navigationDomain: 'overview', navigationOrder: 30, showInNavigation: true, permissionConfigurable: false },

  { kind: 'canonical', id: 'performance-analysis', path: '/performance-analysis', label: '业绩分析', shortLabel: '业绩', iconKey: 'trending-up', navigationDomain: 'growth', navigationOrder: 10, showInNavigation: true, permissionConfigurable: true },
  { kind: 'canonical', id: 'reports', path: '/reports', label: '保费计划达成', shortLabel: '保费', iconKey: 'dollar-sign', navigationDomain: 'growth', navigationOrder: 20, showInNavigation: true, permissionConfigurable: true, aliases: ['/premium-report', '/marketing-report'] },
  { kind: 'canonical', id: 'growth', path: '/growth', label: '增长对比', shortLabel: '增长', iconKey: 'bar-chart', navigationDomain: 'growth', navigationOrder: 30, showInNavigation: true, permissionConfigurable: true, aliases: ['/comparison'] },

  { kind: 'canonical', id: 'cost', path: '/cost', label: '成本分析', shortLabel: '成本', iconKey: 'calculator', navigationDomain: 'cost', navigationOrder: 10, showInNavigation: true, permissionConfigurable: false, aliases: ['/comprehensive-analysis'] },
  { kind: 'canonical', id: 'claims-detail', path: '/claims-detail', label: '赔案分析', shortLabel: '赔案', iconKey: 'file-warning', navigationDomain: 'cost', navigationOrder: 20, showInNavigation: true, permissionConfigurable: false },
  { kind: 'canonical', id: 'expense-development', path: '/expense-development', label: '费用率发展', shortLabel: '费发', iconKey: 'trending-down', navigationDomain: 'cost', navigationOrder: 30, showInNavigation: true, permissionConfigurable: false, specialFeature: 'expense_development' },
  { kind: 'canonical', id: 'moto-cost', path: '/moto-cost', label: '摩意成本', shortLabel: '摩意', iconKey: 'bike', navigationDomain: 'cost', navigationOrder: 40, showInNavigation: true, permissionConfigurable: false, specialFeature: 'moto_cost' },

  { kind: 'canonical', id: 'renewal-tracker', path: '/renewal-tracker', label: '续保追踪', shortLabel: '续保', iconKey: 'refresh', navigationDomain: 'customer', navigationOrder: 10, showInNavigation: true, permissionConfigurable: true },
  { kind: 'canonical', id: 'quote-conversion', path: '/quote-conversion', label: '报价转化', shortLabel: '报价', iconKey: 'target', navigationDomain: 'customer', navigationOrder: 20, showInNavigation: true, permissionConfigurable: false },
  { kind: 'canonical', id: 'customer-flow', path: '/customer-flow', label: '客户流向', shortLabel: '流向', iconKey: 'arrow-left-right', navigationDomain: 'customer', navigationOrder: 30, showInNavigation: true, permissionConfigurable: false },

  { kind: 'canonical', id: 'specialty', path: '/specialty', label: '驾意险与货车', shortLabel: '专项', iconKey: 'gift', navigationDomain: 'specialty', navigationOrder: 10, showInNavigation: true, permissionConfigurable: true, aliases: ['/truck', '/cross-sell'] },
  { kind: 'canonical', id: 'repair', path: '/repair', label: '维修资源', shortLabel: '维修', iconKey: 'wrench', navigationDomain: 'specialty', navigationOrder: 20, showInNavigation: true, permissionConfigurable: false },

  { kind: 'canonical', id: 'data-import', path: '/data-import', label: '数据管理', shortLabel: '数据', iconKey: 'database', navigationDomain: 'platform', navigationOrder: 10, showInNavigation: true, permissionConfigurable: false },
  { kind: 'canonical', id: 'access-control', path: '/admin/access-control', label: '权限管理', shortLabel: '权限', iconKey: 'shield', navigationDomain: 'platform', navigationOrder: 20, showInNavigation: true, permissionConfigurable: false },
]);

export function getPermissionRoutes(): readonly RouteDefinition[] {
  return ROUTES.filter((route) => route.permissionConfigurable);
}

export interface NavigationGroup {
  readonly domain: DecisionDomainId;
  readonly label: string;
  readonly routes: readonly RouteDefinition[];
}

export function buildNavigationGroups(routes: readonly RouteDefinition[]): readonly NavigationGroup[] {
  return DECISION_DOMAINS.map((domain) => ({
    domain: domain.id,
    label: domain.label,
    routes: routes
      .filter((route) => route.showInNavigation && route.navigationDomain === domain.id)
      .sort((left, right) => left.navigationOrder - right.navigationOrder),
  })).filter((group) => group.routes.length > 0);
}

export function getNavigationGroups(): readonly NavigationGroup[] {
  return buildNavigationGroups(ROUTES);
}
