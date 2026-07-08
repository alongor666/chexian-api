/**
 * 机构和权限配置模块
 *
 * 定义机构层级结构和用户权限规则
 */

/**
 * 三级机构列表（12个，四川 SC）
 * 对应 salesman_organization_mapping.json 中的 organizations
 */
export const ORGANIZATIONS = [
  '乐山',
  '天府',
  '宜宾',
  '德阳',
  '新都',
  '武侯',
  '泸州',
  '自贡',
  '资阳',
  '达州',
  '青羊',
  '高新',
] as const;

/**
 * 山西（SX）经营单元列表（11个）。
 * SSOT：数据管理/config/branch-org-mapping/SX.json 的 "units"；与
 * server/src/services/permission.ts 的 SX_ORGANIZATIONS 镜像一致
 * （前后端独立编译域，禁止 import，逐条对齐）。governance「省份映射前后端镜像」锚点对账。
 */
// ── SX-ORG-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
export const SX_ORGANIZATIONS = [
  '太原一部',
  '太原二部',
  '经代、车商、重客',
  '大同',
  '阳泉',
  '长治',
  '晋城',
  '晋中',
  '运城',
  '临汾',
  '吕梁',
] as const;
// ── SX-ORG-MIRROR-END ──

/**
 * branchCode → 该分公司机构列表。新增省份上线时须在此登记，否则该省
 * branch_admin 的前端机构下拉会回落到默认（SC）。镜像
 * server/src/services/permission.ts 的 BRANCH_ORGANIZATIONS。governance「省份映射前后端镜像」锚点对账。
 */
// ── BRANCH-ORG-MIRROR-BEGIN（governance 对账锚点：前后端两份镜像逐字一致）──
export const BRANCH_ORGANIZATIONS: Record<string, readonly string[]> = {
  SC: ORGANIZATIONS,
  SX: SX_ORGANIZATIONS,
};
// ── BRANCH-ORG-MIRROR-END ──

/**
 * 机构类型
 */
export type Organization = typeof ORGANIZATIONS[number];

/**
 * 用户角色类型
 */
export enum UserRole {
  /** 分公司管理员 - 可查看所有数据 */
  BRANCH_ADMIN = 'branch_admin',
  /** 三级机构用户 - 只能查看本机构 + 分公司整体 */
  ORG_USER = 'org_user',
  /** 电销用户 - 只能查看电销数据，但可以跨机构查看 */
  TELEMARKETING_USER = 'telemarketing_user',
}

/**
 * 用户权限配置
 */
export interface UserPermission {
  /** 用户名 */
  username: string;
  /** 显示名称 */
  displayName: string;
  /** 角色 */
  role: UserRole;
  /** 所属机构（三级机构用户必填） */
  organization?: Organization;
  /** 分公司编码（'SC' / 'SX'）；全国超管为默认省 */
  branchCode?: string;
  /** 全国超管可切换/合并的省集合（如 ['SC','SX']）。长度 > 1 时前端显示切省下拉 */
  visibleBranches?: string[];
  /** 可访问路由（未设置表示不限制） */
  allowedRoutes?: string[];
  /** 默认落地路由 */
  defaultRoute?: string;
  /** 特殊功能权限（如 cost, moto_cost） */
  specialFeatures?: string[];
}

/**
 * 快速切换用户条目（开发/演示用，无密码登录）
 */
export interface QuickLoginUser {
  username: string;
  displayName: string;
  role: UserRole;
}

/**
 * branchCode → 快速切换用户清单（侧边栏底部面板 / 登录页快捷入口）。
 * SC 清单为改动前逐字节保留（字节安全）；SX 清单账号取自
 * server/src/config/preset-users.ts 的 SX 段（sxAdmin + 11 经营单元账号）。
 * 未知/缺省 branchCode 回落 SC。
 *
 * 每省只保留一个超管快捷入口（对称于 SC 只有 admin），SX 段另有的
 * yangjie0621（第二个 branch_admin）有意不纳入本清单。
 */
export const QUICK_LOGIN_USERS_BY_BRANCH: Record<string, readonly QuickLoginUser[]> = {
  SC: [
    { username: 'admin', displayName: '系统管理员', role: UserRole.BRANCH_ADMIN },
    { username: 'leshan', displayName: '乐山机构', role: UserRole.ORG_USER },
    { username: 'tianfu', displayName: '天府机构', role: UserRole.ORG_USER },
    { username: 'yibin', displayName: '宜宾机构', role: UserRole.ORG_USER },
    { username: 'deyang', displayName: '德阳机构', role: UserRole.ORG_USER },
    { username: 'xindu', displayName: '新都机构', role: UserRole.ORG_USER },
    { username: 'wuhou', displayName: '武侯机构', role: UserRole.ORG_USER },
    { username: 'luzhou', displayName: '泸州机构', role: UserRole.ORG_USER },
    { username: 'zigong', displayName: '自贡机构', role: UserRole.ORG_USER },
    { username: 'ziyang', displayName: '资阳机构', role: UserRole.ORG_USER },
    { username: 'dazhou', displayName: '达州机构', role: UserRole.ORG_USER },
    { username: 'qingyang', displayName: '青羊机构', role: UserRole.ORG_USER },
    { username: 'gaoxin', displayName: '高新机构', role: UserRole.ORG_USER },
  ],
  SX: [
    { username: 'sxAdmin', displayName: '山西分公司管理员', role: UserRole.BRANCH_ADMIN },
    { username: 'sx_taiyuan1', displayName: '太原一部机构', role: UserRole.ORG_USER },
    { username: 'sx_taiyuan2', displayName: '太原二部机构', role: UserRole.ORG_USER },
    { username: 'sx_jdcszk', displayName: '经代、车商、重客机构', role: UserRole.ORG_USER },
    { username: 'sx_datong', displayName: '大同机构', role: UserRole.ORG_USER },
    { username: 'sx_yangquan', displayName: '阳泉机构', role: UserRole.ORG_USER },
    { username: 'sx_changzhi', displayName: '长治机构', role: UserRole.ORG_USER },
    { username: 'sx_jincheng', displayName: '晋城机构', role: UserRole.ORG_USER },
    { username: 'sx_jinzhong', displayName: '晋中机构', role: UserRole.ORG_USER },
    { username: 'sx_yuncheng', displayName: '运城机构', role: UserRole.ORG_USER },
    { username: 'sx_linfen', displayName: '临汾机构', role: UserRole.ORG_USER },
    { username: 'sx_lvliang', displayName: '吕梁机构', role: UserRole.ORG_USER },
  ],
};

/**
 * 机构角色默认可访问路由（未单独配置 allowedRoutes 时生效）
 */
export const ORG_USER_DEFAULT_ALLOWED_ROUTES: readonly string[] = [
  '/home',
  '/performance-analysis',
  '/growth',
  '/specialty',
  '/chart-ledger',
];

/**
 * 机构角色默认落地页
 */
export const ORG_USER_DEFAULT_ROUTE = '/performance-analysis';

const ROUTE_ALIAS_MAP: Record<string, string> = {
  '/premium-report': '/reports',
  '/truck': '/specialty',
  '/renewal': '/specialty',
  '/cross-sell': '/specialty',
  '/comparison': '/growth',
  '/comprehensive-analysis': '/cost',
};

/**
 * 用户认证配置（含密码）
 * 内网部署使用，密码通过SHA-256哈希存储
 */
export interface UserCredential extends UserPermission {
  /** 密码哈希 (SHA-256) */
  passwordHash: string;
}

/**
 * 机构层级配置
 * 用于权限判断和筛选器显示
 */
export const ORGANIZATION_HIERARCHY = {
  /** 分公司（整体）- 汇总所有三级机构 */
  branch: '全部',
  /** 三级机构列表 */
  organizations: ORGANIZATIONS,
} as const;

/**
 * 获取用户可见的机构列表。
 *
 * @param permission 用户权限配置
 * @param effectiveBranch 全国超管解析后的有效省（'SC'/'SX'/'ALL'）。
 *   - 缺省 → 按 permission.branchCode 取（普通用户/未切省，行为不变，字节安全）。
 *   - 单省码 → 取该省机构（超管切省）。
 *   - 'ALL' → 合并该超管 visibleBranches 各省机构（去重、按省顺序）。
 *   镜像 server/src/services/permission.ts 同名函数，防全国超管切省后
 *   机构下拉仍显示默认省（前端阶段2审查发现的对称缺口）。
 * @returns 可见的机构列表（包含"全部"和用户所属机构）
 */
export function getVisibleOrganizations(
  permission: UserPermission,
  effectiveBranch?: string | null,
): string[] {
  if (permission.role === UserRole.BRANCH_ADMIN || permission.role === UserRole.TELEMARKETING_USER) {
    // 全国超管「全国」合并视图：合并 visibleBranches 各省机构（数据驱动，禁硬编码省份）。
    if (effectiveBranch === 'ALL') {
      const branches =
        permission.visibleBranches && permission.visibleBranches.length > 0
          ? permission.visibleBranches
          : Object.keys(BRANCH_ORGANIZATIONS);
      const merged: string[] = [];
      const seen = new Set<string>();
      for (const b of branches) {
        for (const org of BRANCH_ORGANIZATIONS[b] ?? []) {
          if (!seen.has(org)) {
            seen.add(org);
            merged.push(org);
          }
        }
      }
      return ['全部', ...merged];
    }
    // 单省：优先用有效省（超管切省后的 effectiveBranch），否则用本人 branchCode。
    // 分公司管理员/电销用户：可见本省所有机构（未知/缺省回落 SC，字节安全）。
    const branchKey = effectiveBranch ?? permission.branchCode;
    const branchOrgs = (branchKey && BRANCH_ORGANIZATIONS[branchKey]) || ORGANIZATIONS;
    return ['全部', ...branchOrgs];
  }

  if (permission.role === UserRole.ORG_USER && permission.organization) {
    // 三级机构用户：只可见"全部"和自己的机构
    return ['全部', permission.organization];
  }

  // 默认：只可见全部
  return ['全部'];
}

/**
 * 检查用户是否有权限查看指定机构
 * @param permission 用户权限配置
 * @param organization 要查看的机构
 */
export function canViewOrganization(
  permission: UserPermission,
  organization: string
): boolean {
  if (permission.role === UserRole.BRANCH_ADMIN || permission.role === UserRole.TELEMARKETING_USER) {
    return true; // 管理员/电销用户可查看所有
  }

  if (organization === '全部') {
    return true; // 所有用户都可查看分公司汇总
  }

  if (permission.role === UserRole.ORG_USER) {
    return organization === permission.organization;
  }

  return false;
}

/**
 * 从业务员归属映射文件加载的默认用户配置
 * 基于 salesman_organization_mapping.json 生成
 */
export const DEFAULT_USER_PERMISSIONS: UserPermission[] = [
  // 分公司管理员
  {
    username: 'admin',
    displayName: '系统管理员',
    role: UserRole.BRANCH_ADMIN,
  },
  {
    username: 'jiachengxian',
    displayName: 'jiachengxian',
    role: UserRole.BRANCH_ADMIN,
    allowedRoutes: ['/dashboard', '/cross-sell', '/performance-analysis'],
    defaultRoute: '/cross-sell',
  },
  // 各三级机构用户（可按需添加）
  {
    username: 'leshan',
    displayName: '乐山机构',
    role: UserRole.ORG_USER,
    organization: '乐山',
  },
  {
    username: 'tianfu',
    displayName: '天府机构',
    role: UserRole.ORG_USER,
    organization: '天府',
  },
  {
    username: 'yibin',
    displayName: '宜宾机构',
    role: UserRole.ORG_USER,
    organization: '宜宾',
  },
  {
    username: 'deyang',
    displayName: '德阳机构',
    role: UserRole.ORG_USER,
    organization: '德阳',
  },
  {
    username: 'xindu',
    displayName: '新都机构',
    role: UserRole.ORG_USER,
    organization: '新都',
  },
  {
    username: 'wuhou',
    displayName: '武侯机构',
    role: UserRole.ORG_USER,
    organization: '武侯',
  },
  {
    username: 'luzhou',
    displayName: '泸州机构',
    role: UserRole.ORG_USER,
    organization: '泸州',
  },
  {
    username: 'zigong',
    displayName: '自贡机构',
    role: UserRole.ORG_USER,
    organization: '自贡',
  },
  {
    username: 'ziyang',
    displayName: '资阳机构',
    role: UserRole.ORG_USER,
    organization: '资阳',
  },
  {
    username: 'dazhou',
    displayName: '达州机构',
    role: UserRole.ORG_USER,
    organization: '达州',
  },
  {
    username: 'qingyang',
    displayName: '青羊机构',
    role: UserRole.ORG_USER,
    organization: '青羊',
  },
  {
    username: 'gaoxin',
    displayName: '高新机构',
    role: UserRole.ORG_USER,
    organization: '高新',
  },
  // 电销用户
  {
    username: 'scdianxiao',
    displayName: '四川电销',
    role: UserRole.TELEMARKETING_USER,
  },
];

/**
 * ⚠️ SECURITY: 用户凭证已移至后端
 *
 * 所有认证必须通过后端 API: POST /api/auth/login
 * 前端不再存储密码哈希，防止敏感信息泄露
 *
 * 如需添加用户，请在后端 server/src/services/auth.ts 的 PRESET_USERS 中配置
 */

// ⚠️ REMOVED: getDevPassword() - 开发密码回退机制已删除
// 所有环境统一使用后端API认证，确保安全性

// ⚠️ REMOVED: 所有前端密码验证函数已删除
// - isCryptoSubtleAvailable()
// - hashPassword()
// - validateCredentials()
// - getCredentialByUsername()
//
// 理由：前端不应处理密码验证，避免安全风险
// 替代方案：使用后端 API - POST /api/auth/login

/**
 * 模拟登录用户配置
 * 实际部署时，从服务器获取或根据Basic Auth用户名映射
 */
let currentUserPermission: UserPermission | null = null;

/**
 * 设置当前登录用户权限
 */
export function setCurrentUserPermission(permission: UserPermission | null): void {
  currentUserPermission = permission;
}

/**
 * 获取当前登录用户权限
 */
export function getCurrentUserPermission(): UserPermission | null {
  return currentUserPermission;
}

/**
 * 根据用户名获取权限配置
 * @param username 用户名
 */
export function getPermissionByUsername(username: string): UserPermission | null {
  // 查找默认配置
  const defaultUser = DEFAULT_USER_PERMISSIONS.find(u => u.username === username);
  if (defaultUser) {
    return { ...defaultUser };
  }

  // 默认返回分公司管理员权限（开发模式）
  return {
    username,
    displayName: username,
    role: UserRole.BRANCH_ADMIN,
  };
}

/**
 * 检查用户是否可访问某个路由
 * 注：BRANCH_ADMIN 始终拥有完整路由访问权，allowedRoutes 仅对 ORG_USER/TELEMARKETING_USER 生效。
 */
export function canAccessRoute(permission: UserPermission, pathname: string): boolean {
  // 分公司管理员不受路由白名单限制
  if (permission.role === UserRole.BRANCH_ADMIN) return true;

  const normalizedPathname = ROUTE_ALIAS_MAP[pathname] || pathname;

  const effectiveAllowedRoutes =
    permission.allowedRoutes && permission.allowedRoutes.length > 0
      ? permission.allowedRoutes
      : permission.role === UserRole.ORG_USER
        ? ORG_USER_DEFAULT_ALLOWED_ROUTES
        : undefined;

  if (!effectiveAllowedRoutes || effectiveAllowedRoutes.length === 0) {
    return true;
  }

  return effectiveAllowedRoutes.some((allowedRoute) => {
    if (allowedRoute === '/') {
      return normalizedPathname === '/';
    }
    return (
      normalizedPathname === allowedRoute ||
      normalizedPathname.startsWith(`${allowedRoute}/`)
    );
  });
}

/**
 * 获取用户默认落地路由
 */
export function getDefaultRoute(permission: UserPermission): string {
  if (!permission.defaultRoute && permission.role === UserRole.ORG_USER) {
    return ORG_USER_DEFAULT_ROUTE;
  }
  return permission.defaultRoute || '/';
}

/**
 * 根据用户名自动设置权限
 * 用于登录后自动设置权限
 */
export function loginAs(username: string): void {
  const permission = getPermissionByUsername(username);
  setCurrentUserPermission(permission);
}

/**
 * 超级用户列表（系统管理员 + 开发者）
 * admin 和 xuechenglong 具有所有功能的完整访问权限。
 * 如需调整，同时影响所有依赖此列表的特殊功能白名单。
 */
export const SUPER_USERS = ['admin', 'xuechenglong'] as const;

/**
 * 检查用户是否为超级用户
 * @param username 用户名
 */
export function isSuperUser(username: string | undefined): boolean {
  if (!username) return false;
  return (SUPER_USERS as readonly string[]).includes(username);
}

/**
 * 费用率发展功能白名单用户（开发状态）
 * 仅超级用户可访问 /expense-development
 */
export function canAccessExpenseDevelopment(username: string | undefined, specialFeatures?: string[]): boolean {
  if (isSuperUser(username)) return true;
  if (specialFeatures !== undefined) {
    return specialFeatures.includes('expense_development');
  }
  return false;
}

/**
 * 摩意模型功能白名单用户
 * 仅这些用户可访问 /moto-cost
 */
export const MOTO_COST_ALLOWED_USERS: readonly string[] = SUPER_USERS;

/**
 * 检查用户是否有权访问摩意模型
 * @param username 用户名
 */
export function canAccessMotoCost(username: string | undefined, specialFeatures?: string[]): boolean {
  // 超管不变量：admin / xuechenglong 始终拥有完整访问权（与 canAccessExpenseDevelopment 对齐），
  // 即使其 specialFeatures 被显式改成不含 moto_cost 也不应被锁在门外。
  if (isSuperUser(username)) return true;
  if (specialFeatures !== undefined) {
    return specialFeatures.includes('moto_cost');
  }
  return false;
}

/**
 * 成本分析（含综合分析视图）对全员开放（产品决策 2026-07-06-claude-286f55）：
 * 生产环境 env 三态开关恒为 'true'，per-user specialFeatures 'cost' 判定已无实际效力，
 * 前端不再维护该判定，用户面权限开关已下掉（AccessControlPage 不再提供该勾选项）。
 * 后端 requireSpecialFeature('cost') 网关予以保留，作为非生产环境的防御性兜底，见
 * server/src/middleware/special-feature.ts 顶部说明。
 */
