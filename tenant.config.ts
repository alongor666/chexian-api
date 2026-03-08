/**
 * 租户配置文件 - 四川分公司
 *
 * 此文件包含真实业务配置，已在 .gitignore 中，不会提交到版本库。
 * 开源模板请参考 tenant.config.ts.example
 */

export const TENANT_CONFIG = {
  // ============================================================
  // 基本信息
  // ============================================================
  name: '四川分公司车险分析平台',
  shortName: '川分',

  // ============================================================
  // 三级机构列表（12个）
  // 与 Parquet 数据中 org_level_3 字段值完全一致
  // ============================================================
  organizations: [
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
  ] as const,

  // ============================================================
  // 机构分组（用于系数分析的同城/异地分类）
  // sameCity: 成都同城机构
  // remote: 地市中支/异地机构
  // ============================================================
  orgGroups: {
    sameCity: ['天府', '高新', '新都', '青羊', '武侯'],
    remote: ['乐山', '宜宾', '德阳', '泸州', '自贡', '资阳', '达州'],
  },

  // ============================================================
  // 费用分析适用机构（成都同城机构，用于费率规则匹配）
  // 规则生效起始日期：2026-02-25（按签单日期）
  // ============================================================
  feeAnalysisOrgs: ['武侯', '天府', '新都', '青羊', '高新'],

  // ============================================================
  // 预设用户列表
  // ============================================================
  users: [
    {
      username: 'admin',
      displayName: '系统管理员',
      role: 'branch_admin' as const,
      passwordHash: '$2b$10$04CoRcf7Hk9iSiPD6QWRmelsAGNWoqJ3DGB5Mvfjcc/CH6GEJRUC6',
    },
    {
      username: 'leshan',
      displayName: '乐山机构',
      role: 'org_user' as const,
      organization: '乐山',
      passwordHash: '$2b$10$p/GSVbpB/9gsDwS1piCrPeee1oI8DaNc1tZQGUwk259NCAPrPZYxu',
    },
    {
      username: 'tianfu',
      displayName: '天府机构',
      role: 'org_user' as const,
      organization: '天府',
      passwordHash: '$2b$10$TKH31uTuhfV3qLrBRmSAPeqzTVW0sGLwB8UMr2IyalHWVIblS1N0K',
    },
    {
      username: 'yibin',
      displayName: '宜宾机构',
      role: 'org_user' as const,
      organization: '宜宾',
      passwordHash: '$2b$10$2tbYhm0rBqaSQQsHOuWdAeQg6c4mCO/4fwLbjBDkn8Rfc3XVv4rBm',
    },
    {
      username: 'deyang',
      displayName: '德阳机构',
      role: 'org_user' as const,
      organization: '德阳',
      passwordHash: '$2b$10$zDni4lZoEkDMYMkP6uMhgO1jdQKSpfkSt4GtpY8UOxTLAEWnv3nHu',
    },
    {
      username: 'xindu',
      displayName: '新都机构',
      role: 'org_user' as const,
      organization: '新都',
      passwordHash: '$2b$10$0U8wIDAXrW3YlOc3/XPdHuJo4urye9qPYmIU9c6FOxRxr1TjBApR6',
    },
    {
      username: 'wuhou',
      displayName: '武侯机构',
      role: 'org_user' as const,
      organization: '武侯',
      passwordHash: '$2b$10$uNyKQR32nlcca.oaywfZwOoceTEeMJXQX5IzXSutwdnVdm/ejwx9m',
    },
    {
      username: 'luzhou',
      displayName: '泸州机构',
      role: 'org_user' as const,
      organization: '泸州',
      passwordHash: '$2b$10$gKzgBHHfHcBq99SFpx7NZO2ndskDz.xe9MUAPzFGc2sx8hCMAXQTS',
    },
    {
      username: 'zigong',
      displayName: '自贡机构',
      role: 'org_user' as const,
      organization: '自贡',
      passwordHash: '$2b$10$JFOozBJNV8lHU55DhIekfuNo1ddIBFafC.1Uz26BYBf4lwVmPvSc.',
    },
    {
      username: 'ziyang',
      displayName: '资阳机构',
      role: 'org_user' as const,
      organization: '资阳',
      passwordHash: '$2b$10$KPGSRPfpFU46thFf06DHNeA0XFdnkGupmSKpyBU9YkGyEv.1ZMrS2',
    },
    {
      username: 'dazhou',
      displayName: '达州机构',
      role: 'org_user' as const,
      organization: '达州',
      passwordHash: '$2b$10$Aw0DqjuPUkffTwy51z/PNuDixo4eHmatDIuENLYsShAQG45E2mmmq',
    },
    {
      username: 'qingyang',
      displayName: '青羊机构',
      role: 'org_user' as const,
      organization: '青羊',
      passwordHash: '$2b$10$tEooGxkbqThh6LGY5fSbLOe9gvvTEF.3lQ7VXOihiAJPz6loGJ54y',
    },
    {
      username: 'gaoxin',
      displayName: '高新机构',
      role: 'org_user' as const,
      organization: '高新',
      passwordHash: '$2b$10$0gZkoX6BUQXY/z42K1XKiOqVfY26xQl/a8ipNwNaN6kGBzp7aPUQi',
    },
    {
      username: 'scdianxiao',
      displayName: '四川电销',
      role: 'telemarketing_user' as const,
      passwordHash: '$2b$10$LGsDuG1.fieDoR/mbsII1u2ecFY0iteEyFMKkgzO98OKfdbUAj4cK',
    },
  ],

  // ============================================================
  // 功能权限白名单
  // ============================================================
  featureAccess: {
    /** 超级用户（可访问所有功能） */
    superUsers: ['admin', 'xuechenglong'],
    /** 成本分析功能白名单 */
    costAnalysis: ['chexianbu', 'linxia', 'xuechenglong', 'admin'],
    /** 费用分析功能白名单 */
    feeAnalysis: ['admin', 'xuechenglong'],
    /** 摩意模型功能白名单 */
    motoCost: ['admin', 'xuechenglong'],
  },

  // ============================================================
  // 应用信息
  // ============================================================
  app: {
    title: '车险业务分析系统',
    dataFile: 'data.parquet',
  },
} as const;

// ============================================================
// 类型导出（供其他模块引用，无需修改）
// ============================================================

/** 机构名称联合类型 */
export type TenantOrganization = (typeof TENANT_CONFIG.organizations)[number];

/** 用户角色联合类型 */
export type TenantUserRole = (typeof TENANT_CONFIG.users)[number]['role'];
