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
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '系统管理员',
    role: 'branch_admin',
  },
  leshan: {
    username: 'leshan',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '天府机构',
    role: 'org_user',
    organization: '天府',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  yibin: {
    username: 'yibin',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  deyang: {
    username: 'deyang',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  xindu: {
    username: 'xindu',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  zigong: {
    username: 'zigong',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
  jiachengxian: {
    username: 'jiachengxian',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: 'jiachengxian',
    role: 'branch_admin',
  },
  xuechenglong: {
    username: 'xuechenglong',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '薛成龙',
    role: 'branch_admin',
  },
  linxia: {
    username: 'linxia',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '林霞',
    role: 'branch_admin',
  },
  chexianbu: {
    username: 'chexianbu',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '车险部',
    role: 'branch_admin',
  },
  scdianxiao: {
    username: 'scdianxiao',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '四川电销',
    role: 'telemarketing_user',
  },
  test_org_user: {
    username: 'test_org_user',
    passwordHash: 'PASSWORD_OVERRIDE_REQUIRED',
    displayName: '测试机构用户',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
  },
};
