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
  /**
   * 全国超管可切换/可合并的省集合（如 `['SC','SX']`）。
   * undefined / [] → 普通用户（仅 branchCode 单省，行为不变）。
   * 非空 → 该 branch_admin 可在前端切 SC/SX 单省、或看「全国」= 该集合合并视图。
   * **加省时只改这里**：第 3 省上线后把 'GD' 等加进，permission 逻辑数据驱动无需改。
   * 不变量（preset-users.test.ts + services/permission.test.ts 锁）：任一非空 visibleBranches
   * 必 == getAllBranchCodes() == BRANCH_ORGANIZATIONS keys（省份注册表三者耦合，全国超管恒见系统所有省）。
   * ALL 视图用 `branch_code IN (visibleBranches)` 白名单实现；该不变量保证 IN 集合覆盖所有已注册省
   * （加省必须同步改三处，否则测试红），杜绝「半注册」省被 ALL 漏掉或泄漏。
   */
  visibleBranches?: string[];
  allowedRoutes?: string[];
  defaultRoute?: string;
  allowedIps?: string[];
  specialFeatures?: string[];
  active?: boolean;
}

/**
 * 「仅限自助设密」账号名单（全员密码体系改造 · 阶段一）。
 *
 * 名单内账号的密码只能由本人经激活令牌（/api/auth/activate）或飞书首登强制设密链路自设，
 * **永不进 USER_PASSWORDS 环境变量**：
 *   - 运行时兜底：auth.ts resolveEffectiveHash 对名单账号忽略 USER_PASSWORDS 覆盖
 *     （即便运维误注入也不生效，杜绝共享初始密码回潮）；
 *   - 静态闸：governance「自助设密账号禁入USER_PASSWORDS」扫描 env/部署文件拦截误注入。
 * passwordHash 保持构造式 tombstone（含 "Tombstone" 字样，bcrypt.compare 恒 false），
 * 自设前无任何可登录凭据。
 */
export const SELF_SERVICE_PASSWORD_ONLY_USERS: readonly string[] = [
  'liangchunfan',
  'changlixia',
  'yaoqian',
  'lvzhenran',
  'gonghuixin',
  'houyabing',
];

/** 权限管理模块的前端页面路径（routeRegistry 'access-control' 的 path 镜像常量） */
export const ACCESS_CONTROL_PAGE = '/admin/access-control';

/**
 * 模块负面清单（RED LINE · 2026-07-15 用户指令：总经理室/车险部全员开放全部板块，
 * 唯「权限管理」模块收紧到指名白名单）。
 *
 * 语义：
 *   - 键 = 前端页面路径（与 routeRegistry path 对齐）；值 = 允许访问该模块的用户名白名单。
 *   - 未列入本表的模块对所有用户开放（org_user 仍受角色 allowedRoutes 白名单约束，两层独立）。
 *   - 列入本表的模块**只有**白名单内用户可用 —— fail-closed：新增账号默认进不了受限模块，
 *     防止「新发 branch_admin 账号天然拿到权限管理」的越权回潮。
 *   - 派生方式与 visibleBranches 同款：按 username 每请求从本表派生（不进 JWT、不进 store），
 *     改名单即生效、免重登、免 re-seed。
 *
 * 当前唯一条目：权限管理模块仅 薛成龙 / 杨杰 / 林霞 三位业务管理员 + admin（系统运维兜底账号，
 * 非"员工"，供发布链脚本 / E2E / 应急重置使用；如需一并收掉，删除数组中的 'admin' 即可）。
 */
export const RESTRICTED_MODULES: Readonly<Record<string, readonly string[]>> = {
  [ACCESS_CONTROL_PAGE]: ['admin', 'xuechenglong', 'yangjie0621', 'linxia'],
};

/**
 * 该用户是否可访问某受限模块。未登记在 RESTRICTED_MODULES 的页面恒 true（负面清单语义）。
 */
export function canAccessRestrictedModule(username: string, pagePath: string): boolean {
  const allowlist = RESTRICTED_MODULES[pagePath];
  return !allowlist || allowlist.includes(username);
}

/**
 * 按用户名列出其被负面清单拒绝的模块页面路径（随 /login、/me 回前端驱动导航隐藏与页面守卫）。
 */
export function getDeniedModules(username: string): string[] {
  return Object.entries(RESTRICTED_MODULES)
    .filter(([, allowlist]) => !allowlist.includes(username))
    .map(([pagePath]) => pagePath);
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

/**
 * 按角色回填 allowedRoutes：用户记录自带值优先，为空/未定义时用 PRESET_ROLES 的角色默认值兜底。
 * 唯一事实源是 PRESET_ROLES；找不到对应角色默认值则返回 undefined（不注入任何魔法路由列表）。
 */
export function resolveAllowedRoutes(
  role: string,
  allowedRoutes?: string[] | null
): string[] | undefined {
  if (allowedRoutes && allowedRoutes.length > 0) return allowedRoutes;
  return PRESET_ROLES.find((r) => r.role === role)?.allowedRoutes;
}

/**
 * 全局不变量（RED LINE · 安全审查 H1，preset-users.test.ts「全局 tombstone 不变量」锁死）：
 * **所有** 账号的 passwordHash 必须是构造式 tombstone（含 "Tombstone" 标记、60 字符、bcrypt.compare
 * 对任意明文恒 false）——源码永不保留真实可登录哈希。真实凭据只有两条来源：
 *   1. 生产 USER_PASSWORDS 环境变量注入（临时密码，首登经 pns 强制改密）；
 *   2. 用户经激活令牌 / 飞书首登自设（写库置 password_changed_at）。
 * 后果：漏注入 USER_PASSWORDS key = 该账号回落 tombstone = 恒拒登录（fail-safe），绝不成后门。
 * 新增账号一律照此写 tombstone；勿把 bcrypt(明文) 直接写进源码。
 */
export const PRESET_USERS: Record<string, PresetUser> = {
  admin: {
    username: 'admin',
    // 构造式 tombstone 占位（不可登录）：admin 凭据仅由 USER_PASSWORDS 环境变量提供，
    // 漏注入则回落此 tombstone 恒拒登录（旧泄漏密码 2026-06-09 已轮换，源码不留真实哈希）。
    passwordHash: '$2b$10$AdminTombstone00000000000000000000000000000000000000u',
    displayName: '系统管理员',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost', 'moto_cost'],
  },
  leshan: {
    username: 'leshan',
    passwordHash: '$2b$10$LeshanTombstone0000000000000000000000000000000000000u',
    displayName: '乐山机构',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  tianfu: {
    username: 'tianfu',
    passwordHash: '$2b$10$TianfuTombstone0000000000000000000000000000000000000u',
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
    passwordHash: '$2b$10$LiangqinTombstone00000000000000000000000000000000000u',
    displayName: '天府机构-梁琴',
    role: 'org_user',
    organization: '天府',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  yibin: {
    username: 'yibin',
    passwordHash: '$2b$10$YibinTombstone00000000000000000000000000000000000000u',
    displayName: '宜宾机构',
    role: 'org_user',
    organization: '宜宾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  deyang: {
    username: 'deyang',
    passwordHash: '$2b$10$DeyangTombstone0000000000000000000000000000000000000u',
    displayName: '德阳机构',
    role: 'org_user',
    organization: '德阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  xindu: {
    username: 'xindu',
    passwordHash: '$2b$10$XinduTombstone00000000000000000000000000000000000000u',
    displayName: '新都机构',
    role: 'org_user',
    organization: '新都',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  wuhou: {
    username: 'wuhou',
    passwordHash: '$2b$10$WuhouTombstone00000000000000000000000000000000000000u',
    displayName: '武侯机构',
    role: 'org_user',
    organization: '武侯',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  luzhou: {
    username: 'luzhou',
    passwordHash: '$2b$10$LuzhouTombstone0000000000000000000000000000000000000u',
    displayName: '泸州机构',
    role: 'org_user',
    organization: '泸州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  zigong: {
    username: 'zigong',
    passwordHash: '$2b$10$ZigongTombstone0000000000000000000000000000000000000u',
    displayName: '自贡机构',
    role: 'org_user',
    organization: '自贡',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  ziyang: {
    username: 'ziyang',
    passwordHash: '$2b$10$ZiyangTombstone0000000000000000000000000000000000000u',
    displayName: '资阳机构',
    role: 'org_user',
    organization: '资阳',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  dazhou: {
    username: 'dazhou',
    passwordHash: '$2b$10$DazhouTombstone0000000000000000000000000000000000000u',
    displayName: '达州机构',
    role: 'org_user',
    organization: '达州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  qingyang: {
    username: 'qingyang',
    passwordHash: '$2b$10$QingyangTombstone00000000000000000000000000000000000u',
    displayName: '青羊机构',
    role: 'org_user',
    organization: '青羊',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  gaoxin: {
    username: 'gaoxin',
    passwordHash: '$2b$10$GaoxinTombstone0000000000000000000000000000000000000u',
    displayName: '高新机构',
    role: 'org_user',
    organization: '高新',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
  },
  jiachengxian: {
    username: 'jiachengxian',
    passwordHash: '$2b$10$JiachengxianTombstone0000000000000000000000000000000u',
    displayName: 'jiachengxian',
    role: 'branch_admin',
    branchCode: 'SC',
  },
  xuechenglong: {
    username: 'xuechenglong',
    passwordHash: '$2b$10$XuechenglongTombstone0000000000000000000000000000000u',
    displayName: '薛成龙',
    role: 'branch_admin',
    // 全国超管：默认省四川（保留 branchCode='SC' 满足 fail-closed 不变量 permission.test.ts:181），
    // visibleBranches 表达「可切 SC/SX 单省、可看全国合并」。加省时把新省加进此数组即可。
    branchCode: 'SC',
    visibleBranches: ['SC', 'SX'],
    specialFeatures: ['cost', 'moto_cost'],
  },
  linxia: {
    username: 'linxia',
    passwordHash: '$2b$10$LinxiaTombstone0000000000000000000000000000000000000u',
    displayName: '林霞',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost'],
  },
  chexianbu: {
    username: 'chexianbu',
    passwordHash: '$2b$10$ChexianbuTombstone0000000000000000000000000000000000u',
    displayName: '车险部',
    role: 'branch_admin',
    branchCode: 'SC',
    specialFeatures: ['cost'],
  },
  scdianxiao: {
    username: 'scdianxiao',
    passwordHash: '$2b$10$ScdianxiaoTombstone000000000000000000000000000000000u',
    displayName: '四川电销',
    role: 'telemarketing_user',
    branchCode: 'SC',
  },
  // ===== 总部超管 + 市州一把手（2026-07-12 发放）=====
  // 1 全国超管 zongbu + 4 市州机构负责人（宜宾/乐山/达州/泸州，只读看本机构）。
  // passwordHash 均为「构造式 tombstone」占位（标准 bcrypt 60 字符格式、含 "Tombstone" 可辨标记，
  //   bcrypt.compare 对任意明文恒 false → fail-safe，源码永不含真实凭据/明文）。真实临时密码仅由
  //   生产 USER_PASSWORDS 环境变量注入（auth.ts login: passwordOverride ?? user.passwordHash，
  //   漏注入则回落到此处占位 → 恒拒绝，绝不成后门），首登经 pns 强制改密后自设。
  // 这 5 账号走「USER_PASSWORDS 临时密码 + 首登强制改密」路径，不进 SELF_SERVICE_PASSWORD_ONLY_USERS。
  zongbu: {
    // 全国超管：默认省四川（保留 branchCode='SC' 满足 fail-closed 不变量 permission.test.ts:181），
    // visibleBranches 表达「可切 SC/SX 单省、可看全国合并」。加省时把新省加进此数组即可
    //   （不变量：任一非空 visibleBranches 必 == getAllBranchCodes() == ['SC','SX']，加省须同步三处）。
    // 参照现有全国超管 xuechenglong。
    username: 'zongbu',
    passwordHash: '$2b$10$ZongbuTombstone0000000000000000000000000000000000000u',
    displayName: '总部超管',
    role: 'branch_admin',
    branchCode: 'SC',
    visibleBranches: ['SC', 'SX'],
    specialFeatures: ['cost', 'moto_cost'],
    active: true,
  },
  yibinzong: {
    // 宜宾机构负责人（只读看本机构）：org_user 天然只读本 organization，无需额外只读开关。
    // organization 复用现有 yibin 账号的 '宜宾'（已验证能精确匹配 org_level_3 取到数据）。
    username: 'yibinzong',
    passwordHash: '$2b$10$YibinzongTombstone0000000000000000000000000000000000u',
    displayName: '宜宾负责人',
    role: 'org_user',
    organization: '宜宾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
    active: true,
  },
  leshanzong: {
    // 乐山机构负责人（只读看本机构）。organization 复用现有 leshan 账号的 '乐山'。
    username: 'leshanzong',
    passwordHash: '$2b$10$LeshanzongTombstone000000000000000000000000000000000u',
    displayName: '乐山负责人',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
    active: true,
  },
  dazhouzong: {
    // 达州机构负责人（只读看本机构）。organization 复用现有 dazhou 账号的 '达州'。
    username: 'dazhouzong',
    passwordHash: '$2b$10$DazhouzongTombstone000000000000000000000000000000000u',
    displayName: '达州负责人',
    role: 'org_user',
    organization: '达州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
    active: true,
  },
  luzhouzong: {
    // 泸州机构负责人（只读看本机构）。organization 复用现有 luzhou 账号的 '泸州'。
    username: 'luzhouzong',
    passwordHash: '$2b$10$LuzhouzongTombstone000000000000000000000000000000000u',
    displayName: '泸州负责人',
    role: 'org_user',
    organization: '泸州',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
    active: true,
  },
  // ===== 山西分公司（SX）— G7 多省接入账号定义 =====
  // BRANCH_RLS_ENABLED 默认关，加账号不改默认行为；RLS-on 时 permission.ts 按 branch_code='SX' 过滤。
  // 全部 passwordHash 仍为「构造式 tombstone」占位（含 "Tombstone" 可辨标记，bcrypt.compare 对任意明文恒 false，
  //   fail-safe：源码永不含真实凭据/明文）。真实凭据仅由生产 USER_PASSWORDS 环境变量注入
  //   （auth.ts login: `passwordOverride ?? user.passwordHash`，漏注入则回落到此处占位 → 恒拒绝，绝不成后门）。
  // active:true —— 山西已于 2026-06-26 完成 cutover 步⑥发账号（RLS-on + SX 进 current/ + 生产 store/USER_PASSWORDS
  //   已激活并逐账号隔离验证）。passwordHash 保持 tombstone 不变：即便 store 被 re-seed，无 env 真凭据仍无法登录。
  //   auth.ts: if (!user.active) throw new AppError(403, 'Account disabled')
  // organization 取自 数据管理/config/branch-org-mapping/SX.json 的 11 经营单元（= ETL 规范化后 org_level_3），禁臆造。
  sxAdmin: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sxAdmin',
    // tombstone 占位（不可登录）：山西超管凭据仅由 USER_PASSWORDS 环境变量提供。
    // 以下为标准 bcrypt 格式 tombstone（60 字符，无对应明文，bcrypt.compare 必然返回 false）
    passwordHash: '$2b$10$SxAdminTombstone000000000000000000000000000000000000u',
    displayName: '山西分公司管理员',
    role: 'branch_admin',
    branchCode: 'SX',
    specialFeatures: ['cost', 'moto_cost'],
    active: true,
  },
  yangjie0621: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'yangjie0621',
    passwordHash: '$2b$10$YangjieTombstone000000000000000000000000000000000000u',
    displayName: '山西管理员（杨杰）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  // ── 山分车险部个人账号（2026-07-11 发放）：仅限自助设密（SELF_SERVICE_PASSWORD_ONLY_USERS），
  //    密码由本人经激活令牌或飞书首登强制设密自设，永不进 USER_PASSWORDS；
  //    passwordHash 保持构造式 tombstone 占位，自设前不可密码登录 ──
  liangchunfan: {
    username: 'liangchunfan',
    passwordHash: '$2b$10$LiangchunfanTombstone0000000000000000000000000000000u',
    displayName: '山西管理员（梁春帆）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  changlixia: {
    username: 'changlixia',
    passwordHash: '$2b$10$ChanglixiaTombstone000000000000000000000000000000000u',
    displayName: '山西管理员（常丽霞）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  yaoqian: {
    username: 'yaoqian',
    passwordHash: '$2b$10$YaoqianTombstone000000000000000000000000000000000000u',
    displayName: '山西管理员（姚茜）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  lvzhenran: {
    username: 'lvzhenran',
    passwordHash: '$2b$10$LvzhenranTombstone0000000000000000000000000000000000u',
    displayName: '山西管理员（吕镇冉）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  gonghuixin: {
    username: 'gonghuixin',
    passwordHash: '$2b$10$GonghuixinTombstone000000000000000000000000000000000u',
    displayName: '山西管理员（弓慧鑫）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  houyabing: {
    username: 'houyabing',
    passwordHash: '$2b$10$HouyabingTombstone0000000000000000000000000000000000u',
    displayName: '山西管理员（侯亚兵）',
    role: 'branch_admin',
    branchCode: 'SX',
    active: true,
  },
  sx_taiyuan1: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_taiyuan1',
    passwordHash: '$2b$10$SxTaiyuan1Tombstone000000000000000000000000000000000u',
    displayName: '太原一部机构',
    role: 'org_user',
    organization: '太原一部',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_taiyuan2: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_taiyuan2',
    passwordHash: '$2b$10$SxTaiyuan2Tombstone000000000000000000000000000000000u',
    displayName: '太原二部机构',
    role: 'org_user',
    organization: '太原二部',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_jdcszk: {
    // 2026-07-15 退役（BACKLOG 2026-07-15-user-e04971）：经代/车商/重客 拆分为三个独立单元，
    // 本合并账号显式 active:false 墓碑保留（防 preset 兜底写回复活，参 multi-branch-day1-sop §4.0）。
    // ⚠️ 生产 store 存量行不会随 preset 自动停用（loadFromStore 不读 preset），须部署后经
    // 权限管理 API 显式停用并验证登录被拒。organization 保留旧值仅作历史标识——重建后
    // parquet 已无该 org_level_3 值，即使误活跃 RLS 等值匹配也恒 0 行（无数据泄露面）。
    username: 'sx_jdcszk',
    passwordHash: '$2b$10$SxJdcszkTombstone00000000000000000000000000000000000u',
    displayName: '经代、车商、重客机构（已拆分停用）',
    role: 'org_user',
    organization: '经代、车商、重客',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: false,
  },
  sx_jingdai: {
    // 2026-07-15 新增（拆分自 sx_jdcszk，各看各的）；真实凭据仅在生产 USER_PASSWORDS / 飞书个人映射
    username: 'sx_jingdai',
    passwordHash: '$2b$10$SxJingdaiTombstone0000000000000000000000000000000000u',
    displayName: '经代机构',
    role: 'org_user',
    organization: '经代',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_cheshang: {
    // 2026-07-15 新增（拆分自 sx_jdcszk，各看各的）；真实凭据仅在生产 USER_PASSWORDS / 飞书个人映射
    username: 'sx_cheshang',
    passwordHash: '$2b$10$SxCheshangTombstone000000000000000000000000000000000u',
    displayName: '车商机构',
    role: 'org_user',
    organization: '车商',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_zhongke: {
    // 2026-07-15 新增（拆分自 sx_jdcszk，各看各的）；真实凭据仅在生产 USER_PASSWORDS / 飞书个人映射
    username: 'sx_zhongke',
    passwordHash: '$2b$10$SxZhongkeTombstone0000000000000000000000000000000000u',
    displayName: '重客机构',
    role: 'org_user',
    organization: '重客',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_datong: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_datong',
    passwordHash: '$2b$10$SxDatongTombstone00000000000000000000000000000000000u',
    displayName: '大同机构',
    role: 'org_user',
    organization: '大同',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_yangquan: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_yangquan',
    passwordHash: '$2b$10$SxYangquanTombstone000000000000000000000000000000000u',
    displayName: '阳泉机构',
    role: 'org_user',
    organization: '阳泉',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_changzhi: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_changzhi',
    passwordHash: '$2b$10$SxChangzhiTombstone000000000000000000000000000000000u',
    displayName: '长治机构',
    role: 'org_user',
    organization: '长治',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_jincheng: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_jincheng',
    passwordHash: '$2b$10$SxJinchengTombstone000000000000000000000000000000000u',
    displayName: '晋城机构',
    role: 'org_user',
    organization: '晋城',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_jinzhong: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_jinzhong',
    passwordHash: '$2b$10$SxJinzhongTombstone000000000000000000000000000000000u',
    displayName: '晋中机构',
    role: 'org_user',
    organization: '晋中',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_yuncheng: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_yuncheng',
    passwordHash: '$2b$10$SxYunchengTombstone000000000000000000000000000000000u',
    displayName: '运城机构',
    role: 'org_user',
    organization: '运城',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_linfen: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_linfen',
    passwordHash: '$2b$10$SxLinfenTombstone00000000000000000000000000000000000u',
    displayName: '临汾机构',
    role: 'org_user',
    organization: '临汾',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  sx_lvliang: {
    // 已激活（cutover 步⑥，2026-06-26）；真实凭据仅在生产 USER_PASSWORDS，passwordHash 保持 tombstone 占位
    username: 'sx_lvliang',
    passwordHash: '$2b$10$SxLvliangTombstone0000000000000000000000000000000000u',
    displayName: '吕梁机构',
    role: 'org_user',
    organization: '吕梁',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SX',
    active: true,
  },
  test_org_user: {
    username: 'test_org_user',
    // 全员密码体系改造（2026-07-11）：测试账号停用（active:false），不参与密码迁移；
    // 需要时由管理员在管理面重新启用。
    passwordHash: '$2b$10$TestorguserTombstone00000000000000000000000000000000u',
    displayName: '测试机构用户',
    role: 'org_user',
    organization: '乐山',
    allowedRoutes: ORG_ROLE_ALLOWED_ROUTES,
    defaultRoute: ORG_ROLE_DEFAULT_ROUTE,
    branchCode: 'SC',
    active: false,
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

/**
 * 按 username 取该用户的「全国超管可见省集合」（visibleBranches）。
 *
 * 单一事实源：PRESET_USERS（visibleBranches 是静态超管能力配置，非运行时可编辑数据）。
 * 由 auth 中间件按已验证 token 的 username 调用，注入 req.user.visibleBranches（codex 闸-1 P1-3）——
 * 故覆盖 JWT / PAT / cookie 全部身份出口，且**免重登**对存量会话立即生效，
 * 不依赖 access-control store 是否持久化该字段（store 已存在且 re-seed 破坏性，见多分公司 Day-1 SOP Step 4.0）。
 *
 * @returns 该用户的可见省数组；普通用户返回 undefined。
 */
export function getPresetVisibleBranches(username: string): string[] | undefined {
  const vb = PRESET_USERS[username]?.visibleBranches;
  return vb && vb.length > 0 ? [...vb] : undefined;
}
