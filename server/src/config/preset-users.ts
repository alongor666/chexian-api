export interface PresetUser {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  organization?: string;
  /**
   * 分公司编码（CHAR(2)：'SC'=四川 / 'SX'=山西）。
   * undefined → 系统级超管，可见全国（仅 admin 应缺省）。
   * BRANCH_RLS_ENABLED=true 时，permission.ts 据此 AND `branch_code='${branchCode}'`。
   */
  branchCode?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active?: boolean;
}

export interface PresetRole {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes?: string[];
  defaultRoute?: string;
}

export const ORG_ROLE_ALLOWED_ROUTES: string[] = [
  '/home',
  '/performance-analysis',
  '/growth',
  '/specialty',
];

export const ORG_ROLE_DEFAULT_ROUTE = '/performance-analysis';

export const PRESET_ROLES: PresetRole[] = [
  { role: 'branch_admin', name: '分公司管理员', dataScope: 'all' },
  {
    role: 'org_user',
    name: '三级机构用户',
    dataScope: 'org',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  { role: 'telemarketing_user', name: '电销用户', dataScope: 'telemarketing' },
];

export const PRESET_USERS: Record<string, PresetUser> = {
  admin: {
    username: 'admin',
    passwordHash: '$2b$10$04CoRcf7Hk9iSiPD6QWRmelsAGNWoqJ3DGB5Mvfjcc/CH6GEJRUC6',
    displayName: '系统管理员',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost', 'moto_cost'],
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$CeX2KL/WI2MWZ63xF7enqO2yQSLP.xvGk0QfnuS23UT4lrn8F6gmS', // leshan123
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: '$2b$10$TKH31uTuhfV3qLrBRmSAPeqzTVW0sGLwB8UMr2IyalHWVIblS1N0K',
    displayName: '天府机构',
    role: 'org_user',
    organization: '天府',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  liangqin: {
    username: 'liangqin',
    // 初始密码: Tf7C8KQ7142（管理员可见，请分发后提醒用户修改）
    passwordHash: '$2b$10$PCmiRIqjJrZyapvmUcISs.Q63n9kJWVG017tYxoHlQWe/Gyql.VIi',
    displayName: '天府机构-梁琴',
    role: 'org_user',
    organization: '天府',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  yibin: {
    username: 'yibin',
    passwordHash: '$2b$10$2tbYhm0rBqaSQQsHOuWdAeQg6c4mCO/4fwLbjBDkn8Rfc3XVv4rBm',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  deyang: {
    username: 'deyang',
    passwordHash: '$2b$10$zDni4lZoEkDMYMkP6uMhgO1jdQKSpfkSt4GtpY8UOxTLAEWnv3nHu',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  xindu: {
    username: 'xindu',
    passwordHash: '$2b$10$0U8wIDAXrW3YlOc3/XPdHuJo4urye9qPYmIU9c6FOxRxr1TjBApR6',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: '$2b$10$uNyKQR32nlcca.oaywfZwOoceTEeMJXQX5IzXSutwdnVdm/ejwx9m',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: '$2b$10$gKzgBHHfHcBq99SFpx7NZO2ndskDz.xe9MUAPzFGc2sx8hCMAXQTS',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  zigong: {
    username: 'zigong',
    passwordHash: '$2b$10$JFOozBJNV8lHU55DhIekfuNo1ddIBFafC.1Uz26BYBf4lwVmPvSc.',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: '$2b$10$KPGSRPfpFU46thFf06DHNeA0XFdnkGupmSKpyBU9YkGyEv.1ZMrS2',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: '$2b$10$Aw0DqjuPUkffTwy51z/PNuDixo4eHmatDIuENLYsShAQG45E2mmmq',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: '$2b$10$tEooGxkbqThh6LGY5fSbLOe9gvvTEF.3lQ7VXOihyAJPz6loGJ54y',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: '$2b$10$0gZkoX6BUQXY/z42K1XKiOqVfY26xQl/a8ipNwNaN6kGBzp7aPUQi',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  jiachengxian: {
    username: 'jiachengxian',
    passwordHash: '$2b$10$gy9XfxPHgbFrdSJfFrTtW.tu3kRzGYsPxGRrtvMyleCGNTpdTDhL6',
    displayName: 'jiachengxian',
    role: 'branch_admin',
    branchCode: 'SC',
  },
  xuechenglong: {
    username: 'xuechenglong',
    passwordHash: '$2b$10$NHIOCyjuqXWLXyq5UaP8Y.5p/NNsDMXBrsnk/eHsmq.tVSd0swcwu',
    displayName: '薛成龙',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost', 'moto_cost'],
  },
  linxia: {
    username: 'linxia',
    passwordHash: '$2b$10$IPuFIhlNl6NFLXSC8A4o4.tuqMsK9J7B6D5DbeKzpOnJtE9uLA/BO',
    displayName: '林霞',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost'],
  },
  chexianbu: {
    username: 'chexianbu',
    passwordHash: '$2b$10$MNXiN2ASW4I1h.uqWRKySuQH80CmVCn1wjnXbXWzV5ersVLcoE4wu',
    displayName: '车险部',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost'],
  },
  scdianxiao: {
    username: 'scdianxiao',
    passwordHash: '$2b$10$LGsDuG1.fieDoR/mbsII1u2ecFY0iteEyFMKkgzO98OKfdbUAj4cK',
    displayName: '四川电销',
    role: 'telemarketing_user',
    branchCode: 'SC',
  },
  test_org_user: {
    username: 'test_org_user',
    passwordHash: '$2b$10$JyCWJdWGvcPKjSBJ5/KcAeFQOryg6d6GbMcq5jdX99L2PCEsCMDOi',
    displayName: '测试机构用户',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
};

/**
 * 获取所有唯一的权限域列表（快照构建 + org-parquet 切分共用）。
 * 返回值示例: ['all', '乐山', '天府', '宜宾', ..., 'telemarketing']
 */
export function getAllPermissionScopes(): string[] {
  const scopes = new Set<string>();
  for (const user of Object.values(PRESET_USERS)) {
    if (user.role === 'branch_admin') {
      scopes.add('all');
    } else if (user.role === 'org_user' && user.organization) {
      scopes.add(user.organization);
    } else if (user.role === 'telemarketing_user') {
      scopes.add('telemarketing');
    }
  }
  return Array.from(scopes);
}

/**
 * 获取所有唯一的 branchCode 列表（cache-warmer 按 branch 预热共用）。
 *
 * 用途：cache-warmer 0B 改造 — 0F BRANCH_RLS_ENABLED=true 时，
 * 按本函数返回值循环预热（每个 branch 独立 cache entry），
 * 避免单 branch admin token 预热的内容被另一 branch 用户误命中。
 *
 * 排序后返回（确定性），便于测试断言。
 * 当前返回 ['SC']（PR #492 把全部 20 个 preset 用户标 'SC'）；
 * 未来加 SX 用户后自动变 ['SC', 'SX']。
 */
export function getAllBranchCodes(): string[] {
  const codes = new Set<string>();
  for (const user of Object.values(PRESET_USERS)) {
    if (user.branchCode) {
      codes.add(user.branchCode);
    }
  }
  return Array.from(codes).sort();
}
