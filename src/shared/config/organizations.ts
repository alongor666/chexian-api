/**
 * 机构和权限配置模块
 *
 * 定义机构层级结构和用户权限规则
 */

/**
 * 三级机构列表（12个）
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
  /** 可访问路由（未设置表示不限制） */
  allowedRoutes?: string[];
  /** 默认落地路由 */
  defaultRoute?: string;
}

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
 * 获取用户可见的机构列表
 * @param permission 用户权限配置
 * @returns 可见的机构列表（包含"全部"和用户所属机构）
 */
export function getVisibleOrganizations(permission: UserPermission): string[] {
  if (permission.role === UserRole.BRANCH_ADMIN) {
    // 分公司管理员：可见所有机构
    return ['全部', ...ORGANIZATIONS];
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
  if (permission.role === UserRole.BRANCH_ADMIN) {
    return true; // 管理员可查看所有
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
 */
export function canAccessRoute(permission: UserPermission, pathname: string): boolean {
  if (!permission.allowedRoutes || permission.allowedRoutes.length === 0) {
    return true;
  }

  return permission.allowedRoutes.some((allowedRoute) => {
    if (allowedRoute === '/') {
      return pathname === '/';
    }
    return pathname === allowedRoute || pathname.startsWith(`${allowedRoute}/`);
  });
}

/**
 * 获取用户默认落地路由
 */
export function getDefaultRoute(permission: UserPermission): string {
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
 * 摩意模型功能白名单用户
 * 仅这些用户可访问 /moto-cost
 */
export const MOTO_COST_ALLOWED_USERS = ['admin', 'xuechenglong'];

/**
 * 检查用户是否有权访问摩意模型
 * @param username 用户名
 */
export function canAccessMotoCost(username: string | undefined): boolean {
  if (!username) return false;
  return MOTO_COST_ALLOWED_USERS.includes(username);
}
