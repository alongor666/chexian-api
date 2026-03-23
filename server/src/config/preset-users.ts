export interface PresetUser {
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  organization?: string;
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
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
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$p/GSVbpB/9gsDwS1piCrPeee1oI8DaNc1tZQGUwk259NCAPrPZYxu',
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: '$2b$10$TKH31uTuhfV3qLrBRmSAPeqzTVW0sGLwB8UMr2IyalHWVIblS1N0K',
    displayName: '天府机构',
    role: 'org_user',
    organization: '天府',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
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
    allowedIps: ['10.204.48.6'],
  },
  yibin: {
    username: 'yibin',
    passwordHash: '$2b$10$2tbYhm0rBqaSQQsHOuWdAeQg6c4mCO/4fwLbjBDkn8Rfc3XVv4rBm',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  deyang: {
    username: 'deyang',
    passwordHash: '$2b$10$zDni4lZoEkDMYMkP6uMhgO1jdQKSpfkSt4GtpY8UOxTLAEWnv3nHu',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  xindu: {
    username: 'xindu',
    passwordHash: '$2b$10$0U8wIDAXrW3YlOc3/XPdHuJo4urye9qPYmIU9c6FOxRxr1TjBApR6',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: '$2b$10$uNyKQR32nlcca.oaywfZwOoceTEeMJXQX5IzXSutwdnVdm/ejwx9m',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: '$2b$10$gKzgBHHfHcBq99SFpx7NZO2ndskDz.xe9MUAPzFGc2sx8hCMAXQTS',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  zigong: {
    username: 'zigong',
    passwordHash: '$2b$10$JFOozBJNV8lHU55DhIekfuNo1ddIBFafC.1Uz26BYBf4lwVmPvSc.',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: '$2b$10$KPGSRPfpFU46thFf06DHNeA0XFdnkGupmSKpyBU9YkGyEv.1ZMrS2',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: '$2b$10$Aw0DqjuPUkffTwy51z/PNuDixo4eHmatDIuENLYsShAQG45E2mmmq',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: '$2b$10$tEooGxkbqThh6LGY5fSbLOe9gvvTEF.3lQ7VXOihyAJPz6loGJ54y',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: '$2b$10$0gZkoX6BUQXY/z42K1XKiOqVfY26xQl/a8ipNwNaN6kGBzp7aPUQi',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  jiachengxian: {
    username: 'jiachengxian',
    passwordHash: '$2b$10$gy9XfxPHgbFrdSJfFrTtW.tu3kRzGYsPxGRrtvMyleCGNTpdTDhL6',
    displayName: 'jiachengxian',
    role: 'branch_admin',
  },
  xuechenglong: {
    username: 'xuechenglong',
    passwordHash: '$2b$10$NHIOCyjuqXWLXyq5UaP8Y.5p/NNsDMXBrsnk/eHsmq.tVSd0swcwu',
    displayName: '薛成龙',
    role: 'branch_admin',
  },
  linxia: {
    username: 'linxia',
    passwordHash: '$2b$10$IPuFIhlNl6NFLXSC8A4o4.tuqMsK9J7B6D5DbeKzpOnJtE9uLA/BO',
    displayName: '林霞',
    role: 'branch_admin',
  },
  chexianbu: {
    username: 'chexianbu',
    passwordHash: '$2b$10$MNXiN2ASW4I1h.uqWRKySuQH80CmVCn1wjnXbXWzV5ersVLcoE4wu',
    displayName: '车险部',
    role: 'branch_admin',
  },
  scdianxiao: {
    username: 'scdianxiao',
    passwordHash: '$2b$10$LGsDuG1.fieDoR/mbsII1u2ecFY0iteEyFMKkgzO98OKfdbUAj4cK',
    displayName: '四川电销',
    role: 'telemarketing_user',
  },
  test_org_user: {
    username: 'test_org_user',
    passwordHash: '$2b$10$JyCWJdWGvcPKjSBJ5/KcAeFQOryg6d6GbMcq5jdX99L2PCEsCMDOi',
    displayName: '测试机构用户',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
};
