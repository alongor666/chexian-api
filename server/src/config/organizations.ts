/**
 * 机构和权限配置模块
 *
 * 定义机构层级结构和用户权限规则
 */

import { createHash } from 'crypto';

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
 * 用户凭证配置（内网认证）
 *
 * 密码规则：
 * - 管理员：CxAdmin@2026!（可修改）
 * - 机构用户：机构拼音+123（如leshan123）
 *
 * 密码哈希使用SHA-256生成
 * 生成方式: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
 */
export const USER_CREDENTIALS: UserCredential[] = [
  // 分公司管理员 - 密码: CxAdmin@2026!
  {
    username: 'admin',
    displayName: '系统管理员',
    role: UserRole.BRANCH_ADMIN,
    passwordHash: '786f0a34c2150bd34d23e081cbafc0b08cf9aedbeffb02b7c96d11140c1aff1a', // CxAdmin@2026!
  },
  // 乐山机构 - 密码: leshan123
  {
    username: 'leshan',
    displayName: '乐山机构',
    role: UserRole.ORG_USER,
    organization: '乐山',
    passwordHash: 'cfaff8d03423f697a0e54f29de0d8a34f0734f4a6a6e22dc78eeb033f426149f', // leshan123
  },
  // 天府机构 - 密码: tianfu123
  {
    username: 'tianfu',
    displayName: '天府机构',
    role: UserRole.ORG_USER,
    organization: '天府',
    passwordHash: '06c66e0bd53b7cf2479ab4225e7cfd6c37654041bcb062238912e8e915fedadb', // tianfu123
  },
  // 宜宾机构 - 密码: yibin123
  {
    username: 'yibin',
    displayName: '宜宾机构',
    role: UserRole.ORG_USER,
    organization: '宜宾',
    passwordHash: 'f0d45f1ba60afd9976b1639a05ad23add61dd61df4466d029fac93a02769c473', // yibin123
  },
  // 德阳机构 - 密码: deyang123
  {
    username: 'deyang',
    displayName: '德阳机构',
    role: UserRole.ORG_USER,
    organization: '德阳',
    passwordHash: '38a676cafc4a379b9c586ef7f9537420ac33d82809566279fef31c4614bb3804', // deyang123
  },
  // 新都机构 - 密码: xindu123
  {
    username: 'xindu',
    displayName: '新都机构',
    role: UserRole.ORG_USER,
    organization: '新都',
    passwordHash: '5a0eccfda4674bfbff2e10ec4066204d71e03dbeefaed7348d01bbf07c3f5b31', // xindu123
  },
  // 武侯机构 - 密码: wuhou123
  {
    username: 'wuhou',
    displayName: '武侯机构',
    role: UserRole.ORG_USER,
    organization: '武侯',
    passwordHash: 'e2eda8d3ba3e5ed147655134071613c9cc6579124d9265cb69207c9a796065df', // wuhou123
  },
  // 泸州机构 - 密码: luzhou123
  {
    username: 'luzhou',
    displayName: '泸州机构',
    role: UserRole.ORG_USER,
    organization: '泸州',
    passwordHash: '6910c0978c9834134d72a38cb254b371c54542caf7bbfc7f98444c5682281ae5', // luzhou123
  },
  // 自贡机构 - 密码: zigong123
  {
    username: 'zigong',
    displayName: '自贡机构',
    role: UserRole.ORG_USER,
    organization: '自贡',
    passwordHash: 'f6aee3b724e5b70a5c4263dbde3e47adca898afad294cd477cc122e2bf5cf795', // zigong123
  },
  // 资阳机构 - 密码: ziyang123
  {
    username: 'ziyang',
    displayName: '资阳机构',
    role: UserRole.ORG_USER,
    organization: '资阳',
    passwordHash: 'ff8e83542960348711512342782b33cbf121885fd22025be2e90761572f427aa', // ziyang123
  },
  // 达州机构 - 密码: dazhou123
  {
    username: 'dazhou',
    displayName: '达州机构',
    role: UserRole.ORG_USER,
    organization: '达州',
    passwordHash: '1bfc019a69aed8d80b32378f0f09b9139edd8d3676f645a957ef33dd66448c6a', // dazhou123
  },
  // 青羊机构 - 密码: qingyang123
  {
    username: 'qingyang',
    displayName: '青羊机构',
    role: UserRole.ORG_USER,
    organization: '青羊',
    passwordHash: 'c127d886194d1b9974666adfb05fdf52325bbba3eebda7e8eaef6eab6320c69d', // qingyang123
  },
  // 高新机构 - 密码: gaoxin123
  {
    username: 'gaoxin',
    displayName: '高新机构',
    role: UserRole.ORG_USER,
    organization: '高新',
    passwordHash: '5b81c9d2efbbba4ed246dce4ae8fcd08d76ea7f80c6c02197722e3c0d3710a83', // gaoxin123
  },
];

/**
 * 密码从环境变量加载（安全实践）
 *
 * 环境变量格式：USER_PASSWORD_<USERNAME>=<password>
 * 例如：USER_PASSWORD_ADMIN=your-secure-password
 *
 * 如果未设置，使用默认开发密码（仅开发环境）
 */
function getPasswordFromEnv(username: string): string | null {
  const envKey = `USER_PASSWORD_${username.toUpperCase()}`;
  const envPassword = process.env[envKey];

  if (envPassword) {
    return envPassword;
  }

  // 开发环境默认密码（生产环境必须设置环境变量）
  if (process.env.NODE_ENV !== 'production') {
    const devPasswords: Record<string, string> = {
      'admin': 'CxAdmin@2026!',
      'leshan': 'leshan123',
      'tianfu': 'tianfu123',
      'yibin': 'yibin123',
      'meishan': 'meishan123',
      'neijiang': 'neijiang123',
      'zigong': 'zigong123',
      'luzhou': 'luzhou123',
      'dazhou': 'dazhou123',
      'nanchong': 'nanchong123',
      'suining': 'suining123',
      'guangan': 'guangan123',
      'bazhong': 'bazhong123',
      'guangyuan': 'guangyuan123',
      'mianyang': 'mianyang123',
      'deyang': 'deyang123',
      'chengdu': 'chengdu123',
      'panzhihua': 'panzhihua123',
      'liangshan': 'liangshan123',
      'ganzi': 'ganzi123',
      'aba': 'aba123',
      'yaan': 'yaan123',
      'ziyang': 'ziyang123',
    };
    return devPasswords[username] || null;
  }

  return null;
}

/**
 * 计算密码的SHA-256哈希（使用 Node.js crypto 模块）
 * @param password 明文密码
 * @returns 哈希值（十六进制字符串）
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * 验证用户凭证
 * @param username 用户名
 * @param password 密码
 * @returns 验证成功返回用户权限，失败返回null
 */
export function validateCredentials(
  username: string,
  password: string
): UserPermission | null {
  const user = USER_CREDENTIALS.find(u => u.username === username);
  if (!user) {
    return null;
  }

  // 优先使用环境变量中的密码（生产环境推荐）
  const expectedPassword = getPasswordFromEnv(username);
  if (expectedPassword) {
    if (password === expectedPassword) {
      const { passwordHash: _, ...permission } = user;
      return permission;
    }
    // 如果环境变量设置了但密码不匹配，直接返回失败
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
  }

  // 回退到哈希验证（兼容预设的 passwordHash）
  const inputHash = hashPassword(password);
  if (inputHash === user.passwordHash) {
    const { passwordHash: _, ...permission } = user;
    return permission;
  }

  return null;
}

/**
 * 根据用户名获取凭证（不含密码验证）
 * 用于已认证后的权限查询
 */
export function getCredentialByUsername(username: string): UserCredential | null {
  return USER_CREDENTIALS.find(u => u.username === username) || null;
}

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
 * 根据用户名自动设置权限
 * 用于登录后自动设置权限
 */
export function loginAs(username: string): void {
  const permission = getPermissionByUsername(username);
  setCurrentUserPermission(permission);
}
