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
    // tombstone 占位（不可登录）：admin 凭据仅由 USER_PASSWORDS 环境变量提供。
    // 旧泄漏密码已于 2026-06-09 轮换，此处不再保留任何可用哈希。
    passwordHash: '$2b$10$PNyAVhUD9EEoLZZWzFtIjOm15LNJWezVd9nmLeWESo3ENroom0U7a',
    displayName: '系统管理员',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost', 'moto_cost'],
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$CeX2KL/WI2MWZ63xF7enqO2yQSLP.xvGk0QfnuS23UT4lrn8F6gmS',
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
    // tombstone 占位（不可登录）：凭据仅由 USER_PASSWORDS 环境变量提供。
    // 旧明文初始密码已于 2026-06-09 轮换，此处不再保留任何可用哈希。
    passwordHash: '$2b$10$Z01ljSK8Is7iUKzuUxVXcekwmS3tuJ48.4dQbY0CZ3fQB88ypcy4u',
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
  // ===== 山西分公司（SX）— G7 多省接入账号定义 =====
  // BRANCH_RLS_ENABLED 默认关，加账号不改默认行为；RLS-on 时 permission.ts 按 branch_code='SX' 过滤。
  // 全部 passwordHash 为「构造式 tombstone」占位（含 "Tombstone" 可辨标记，bcrypt.compare 对任意明文恒 false，
  //   fail-safe：即便误激活也无法登录、无明文硬编码）。真实凭据仅由 USER_PASSWORDS 注入
  //   （auth.ts login: `passwordOverride ?? user.passwordHash`，漏注入则回落到此处占位 → 恒拒绝）。
  // 全部显式 active:false —— seedFromPreset 默认 active ?? true；必须明确设 false 才能阻断登录。
  //   auth.ts: if (!user.active) throw new AppError(403, 'Account disabled')
  //   真实凭据于 🔴 GATED cutover 时由 USER_PASSWORDS 环境变量注入 + active 改为 true。
  // organization 取自 数据管理/config/branch-org-mapping/SX.json 的 11 经营单元（= ETL 规范化后 org_level_3），禁臆造。
  sxAdmin: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sxAdmin',
    // tombstone 占位（不可登录）：山西超管凭据仅由 USER_PASSWORDS 环境变量提供。
    // 以下为标准 bcrypt 格式 tombstone（60 字符，无对应明文，bcrypt.compare 必然返回 false）
    passwordHash: '$2b$10$SxAdminTombstone000000000000000000000000000000000000u',
    displayName: '山西分公司管理员',
    role: 'branch_admin',
    branchCode: 'SX',
    specialFeatures: ['cost', 'moto_cost'],
    active: false,
  },
  yangjie0621: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'yangjie0621',
    passwordHash: '$2b$10$YangjieTombstone000000000000000000000000000000000000u',
    displayName: '山西管理员（杨杰）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: false,
  },
  sx_taiyuan1: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_taiyuan1',
    passwordHash: '$2b$10$SxTaiyuan1Tombstone000000000000000000000000000000000u',
    displayName: '太原一部机构',
    role: 'org_user',
    organization: '太原一部',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_taiyuan2: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_taiyuan2',
    passwordHash: '$2b$10$SxTaiyuan2Tombstone000000000000000000000000000000000u',
    displayName: '太原二部机构',
    role: 'org_user',
    organization: '太原二部',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_jdcszk: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_jdcszk',
    passwordHash: '$2b$10$SxJdcszkTombstone00000000000000000000000000000000000u',
    displayName: '经代、车商、重客机构',
    role: 'org_user',
    organization: '经代、车商、重客',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_datong: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_datong',
    passwordHash: '$2b$10$SxDatongTombstone00000000000000000000000000000000000u',
    displayName: '大同机构',
    role: 'org_user',
    organization: '大同',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_yangquan: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_yangquan',
    passwordHash: '$2b$10$SxYangquanTombstone000000000000000000000000000000000u',
    displayName: '阳泉机构',
    role: 'org_user',
    organization: '阳泉',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_changzhi: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_changzhi',
    passwordHash: '$2b$10$SxChangzhiTombstone000000000000000000000000000000000u',
    displayName: '长治机构',
    role: 'org_user',
    organization: '长治',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_jincheng: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_jincheng',
    passwordHash: '$2b$10$SxJinchengTombstone000000000000000000000000000000000u',
    displayName: '晋城机构',
    role: 'org_user',
    organization: '晋城',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_jinzhong: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_jinzhong',
    passwordHash: '$2b$10$SxJinzhongTombstone000000000000000000000000000000000u',
    displayName: '晋中机构',
    role: 'org_user',
    organization: '晋中',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_yuncheng: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_yuncheng',
    passwordHash: '$2b$10$SxYunchengTombstone000000000000000000000000000000000u',
    displayName: '运城机构',
    role: 'org_user',
    organization: '运城',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_linfen: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_linfen',
    passwordHash: '$2b$10$SxLinfenTombstone00000000000000000000000000000000000u',
    displayName: '临汾机构',
    role: 'org_user',
    organization: '临汾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_lvliang: {
    // GATED：山西上线(RLS-on + SX 进 current/)前不可登录，cutover 时经 USER_PASSWORDS 注入密码 + 激活
    username: 'sx_lvliang',
    passwordHash: '$2b$10$SxLvliangTombstone0000000000000000000000000000000000u',
    displayName: '吕梁机构',
    role: 'org_user',
    organization: '吕梁',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
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
 * 返回 ['SC', 'SX']（G7 多省接入加入山西 1 超管 + 11 经营单元 org_user，全部 branchCode='SX'）。
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
