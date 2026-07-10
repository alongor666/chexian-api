/**
 * cx sql 派生域联邦策略注册表（单一事实源）
 *
 * 设计：.claude/plans/cx-cli-swift-pudding.md P0「派生域联邦」。
 *
 * 历史上 `cx sql`（SQL 直通）只允许访问 PolicyFact 单一视图（sql-validator.ts
 * 的 validateRelationBoundary）。本注册表在 `SQL_FEDERATION_ENABLED='true'` 时把准入
 * 白名单扩展为「已实证权限列的派生视图」+「无机构作用域的参照维度表」，使续保/报价/
 * 交叉销售等派生域可被 cx sql 直接查询、独立验算。
 *
 * 安全模型（fail-closed，绝不静默放行）：
 *   - 每个 `direct` 关系声明其**实测存在**的权限列（permissionColumns）。
 *   - 注入期（sql-permission-injector.ts）对每个被引用的 direct 关系，要求行级过滤条件
 *     引用的列 **全部** ∈ 该关系的 permissionColumns；任一缺失 → 抛错拒绝执行
 *     （绝不静默丢弃过滤条件——丢弃 = 跨机构越权泄漏）。
 *   - `exempt` 关系是无机构作用域、无行级敏感的全局参照表（品牌/车牌地区/修理厂），
 *     白名单放行但不注入 RLS。
 *   - 未登记的关系一律维持拒绝（访问边界限制）。
 *
 * permissionColumns 为 ground-truth：由 `duckdb DESCRIBE` 直查各域 latest.parquet 实测
 * （2026-06-18），不靠推断。新增关系前必须实测其权限列，宁缺毋滥。
 *
 * branch_code 例外（P0.5，2026-06-19；2026-06-23 P3-B/P3-D 注脚更新）：早期派生视图 parquet
 * **均不含 branch_code**（DESCRIBE 实测），由 loader（duckdb-domain-loaders.ts
 * selectUnionWithBranchCode）在视图层补 `'<BRANCH_CODE>' AS branch_code` 常量列实现对齐。
 *   - P3-A（2026-06-23 #763）起 claims_detail parquet ETL 派生 branch_code（policy_no 前缀）
 *   - P3-B（2026-06-23 #764）起 cross_sell / customer_flow parquet 同样派生 branch_code
 *   - P3-D（2026-06-23 此 PR）起 quotes_conversion parquet ETL 派生 branch_code（quotes 报价表
 *     policy_no NULL 92.5% / B255 数据质量问题，故走内联 warn 模式 + declared_branch 兜底，
 *     而非通用 derived_fields.py guarded helper）
 *   - selectUnionWithBranchCode 用 DESCRIBE 实测 hasBranchCode 自适应（有则裸 SELECT *、
 *     无则补常量），故 ETL 改造对 loader 透明、无需同步升级。
 * branch_code 的 ground-truth 由「loader 保证视图必含该列」构造性成立——参 federation 表头
 * 注释的 ETL 落列 + loader 补列双路径。
 */

/** 关系联邦策略 */
export type FederationStrategy =
  /** 含机构作用域、必须注入行级权限的事实视图 */
  | 'direct'
  /** 无机构作用域、无行级敏感的全局参照表，放行但不注入 RLS */
  | 'exempt';

export interface RelationPolicy {
  /** 规范关系名（大小写敏感，用于 SQL 注入时拼接） */
  canonical: string;
  /** 该关系上实测存在、可用于行级权限过滤的列（小写）。exempt 关系为空集 */
  permissionColumns: ReadonlySet<string>;
  strategy: FederationStrategy;
  /**
   * 惰性域 key（data-bootstrapper.ts lazyRegistry.register 的注册名）。
   *
   * 仅当该关系是「按需物化」的惰性域时设置。typed 路由经 createDomainMiddleware →
   * ensureDomainLoaded 预热；而 cx sql（sql-passthrough）不走该中间件，故直查纯惰性域
   * （如 NewEnergyClaims）冷态会「table does not exist」。sql-passthrough 据此字段在直查前
   * 主动触发 ensureDomainLoaded，弥补缺口。
   *
   * PolicyFact / exempt 参照表等「启动即建」的关系不设此字段（无需预热）。
   */
  lazyDomain?: string;
}

/** PolicyFact / PolicyFactRealtime 的完整权限列（与 sql-permission-injector ALLOWED_PERMISSION_FIELDS 对齐） */
const POLICY_FACT_COLUMNS: ReadonlySet<string> = new Set([
  'org_level_3',
  'org_level_2',
  'org_level_1',
  'salesman_name',
  'organization',
  'is_telemarketing',
  'branch_code',
]);

/**
 * PolicyFact 始终可达（历史行为，与 federation 开关无关）。
 * 即使开关关闭，cx sql 仍只能查 PolicyFact。
 */
const POLICY_FACT_POLICY: RelationPolicy = {
  canonical: 'PolicyFact',
  permissionColumns: POLICY_FACT_COLUMNS,
  strategy: 'direct',
};

/**
 * 联邦白名单（仅 SQL_FEDERATION_ENABLED='true' 时生效）。
 * key = 关系名大写；permissionColumns = duckdb DESCRIBE 实测列。
 */
const FEDERATED_REGISTRY: Readonly<Record<string, RelationPolicy>> = {
  RENEWALTRACKERFACT: {
    canonical: 'RenewalTrackerFact',
    // branch_code（P3-C, 2026-06-23）：renewal_tracker ETL 已派生 branch_code 列
    // （convert_renewal_tracker.py derive_renewal_tracker_branch_code · hard-fail 模式：
    // SC 链路 source/renewed 100% 非空+610 前缀已 duckdb 实证 128,016 行零 NULL）。
    // loader selectUnionWithBranchCode 用 DESCRIBE 自适应：parquet 含列直接用、不含时
    // （旧产物 / 重新 ETL 前）仍兜部署省常量，故 ETL 改造对 loader 透明、双路径并存
    // （无 R28 不一致）。
    // is_telemarketing（P2 c21667）：parquet 无该列，loader 在视图层补 `FALSE AS is_telemarketing` 常量；
    // 电销用户查本域得空结果（安全·业务暂不可用·用户接受先上线）。
    permissionColumns: new Set(['org_level_3', 'salesman_name', 'branch_code', 'is_telemarketing']),
    strategy: 'direct',
    lazyDomain: 'RenewalTracker',
  },
  QUOTECONVERSION: {
    canonical: 'QuoteConversion',
    // branch_code（P3-D, 2026-06-23）：quotes_conversion ETL 已派生 branch_code 列（quote_etl.py
    // derive_branch_code · warn 模式）。loader selectUnionWithBranchCode 用 DESCRIBE 自适应：
    // parquet 含列直接用、不含时仍兜部署省常量，故 ETL 改造对 loader 透明、双路径并存。
    // is_telemarketing（P2 c21667）：parquet 原为 varchar（'电销'/'非电销'），loader 在视图层用
    // `CASE WHEN is_telemarketing = '电销' THEN TRUE ELSE FALSE END` 归一为 boolean。
    // typed 报价路由（sql/quote-conversion.ts）中 buildWhere 同步映射枚举→boolean SQL 条件
    // （'电销'→TRUE, '非电销'→FALSE），前端 query param 契约（isTelemarketing:'电销'|'非电销'）零感知。
    permissionColumns: new Set(['org_level_3', 'salesman_name', 'branch_code', 'is_telemarketing']),
    strategy: 'direct',
    lazyDomain: 'QuoteConversion',
  },
  CROSSSELLFACT: {
    canonical: 'CrossSellFact',
    // branch_code 由 loader 在视图层补常量列。
    // is_telemarketing（P2 c21667）：parquet 无该列，loader 在视图层补 `FALSE AS is_telemarketing` 常量。
    permissionColumns: new Set(['org_level_3', 'salesman_name', 'branch_code', 'is_telemarketing']),
    strategy: 'direct',
    lazyDomain: 'CrossSell',
  },
  NEWENERGYCLAIMS: {
    canonical: 'NewEnergyClaims',
    // branch_code 由 loader 在视图层补常量列（salesman_name 该域 parquet 本就缺，维持不纳入）。
    // is_telemarketing（P2 c21667）：parquet 无该列，loader 在视图层补 `FALSE AS is_telemarketing` 常量。
    permissionColumns: new Set(['org_level_3', 'branch_code', 'is_telemarketing']),
    strategy: 'direct',
    lazyDomain: 'NewEnergyClaims',
  },
  // 参照维度表（exempt）：必须经 duckdb DESCRIBE 实证**无任何机构作用域列**（org_level_*/
  // salesman/branch_code）方可豁免 RLS。BrandDim=厂牌→品牌、PlateRegionMap=车牌→地区，均为全局查找。
  BRANDDIM: { canonical: 'BrandDim', permissionColumns: new Set(), strategy: 'exempt' },
  PLATEREGIONMAP: { canonical: 'PlateRegionMap', permissionColumns: new Set(), strategy: 'exempt' },
  // ⚠️ RepairDim 本增量**不纳入**：其 parquet 含 org_level_3（机构级损失评估/净保费敏感数据），
  //    但 org_level_3 用编码格式（如 '011019乐山中心支公司'）与标准 RLS 过滤 `org_level_3='乐山'`
  //    不匹配 → direct 会让 org_user 得空结果（UX 破碎）。留待后续专门设计其编码格式 RLS 后再纳入。
  //    （对抗式验证发现：误标 exempt 会导致越权读全机构修理数据——已移除该错误归类。）
};

/**
 * 联邦开关是否开启。
 * 调用时直读 `process.env`（而非 env.ts 的加载期快照），使 PM2 env reload 与单元测试
 * 都能即时生效；env.ts 保留 SQL_FEDERATION_ENABLED 条目作为部署契约文档（ecosystem 设值）。
 */
export function isFederationEnabled(): boolean {
  return process.env.SQL_FEDERATION_ENABLED === 'true';
}

/**
 * 多省 Phase B gated 写侧开关：是否启用 `current/<省>/` 子目录布局（服务端侧）。
 *
 * 与 ETL 侧 `数据管理/lib/branch-naming.mjs isPolicyCurrentSubdirLayout` 同名同语义
 * （同一 env `POLICY_CURRENT_SUBDIR_LAYOUT`，默认 off = 扁平 current/ 字节安全）；
 * mjs 无法被服务端 TS import，故两侧各持一份实现、以注释互指为对齐契约。
 * B4（web 上传链路）用它决定 multer 落盘目录与数据管理路由候选目录，
 * 不复用 BRANCH_RLS_ENABLED（RLS 是安全开关，绑定写布局会让开 RLS 意外触发物理迁移）。
 */
export function isPolicyCurrentSubdirLayout(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.POLICY_CURRENT_SUBDIR_LAYOUT === 'true';
}

/**
 * 省份编码白名单正则（CHAR(2) 大写字母，如 SC/SX）。
 * 作为「单一事实源」被 resolveBranchCode / getDeploymentBranchCode / permission.ts 共享。
 */
const BRANCH_CODE_RE = /^[A-Z]{2}$/;

/**
 * 校验省份编码格式（CHAR(2) 大写字母）。
 * 供外部输入（如飞书角色映射文件的条目级 branchCode）做 fail-closed 校验，
 * 避免走 resolveBranchCode 的「非法回退 SC」语义把错误配置静默导向四川数据。
 */
export function isValidBranchCodeFormat(raw: string): boolean {
  return BRANCH_CODE_RE.test(raw);
}

/**
 * fail-closed 省份编码解析器（数据路径专用）。
 *
 * 行为语义：
 *   - 合法 CHAR(2) 大写值（SC/SX/…）→ 原样返回
 *   - null / undefined / 空字符串 → 告警 + 返回 'SC'（四川为合法生产默认）
 *   - 非法格式（非 CHAR(2) 大写）→ console.warn 打印异常值 + 返回 'SC'（告警，可观测）
 *
 * 设计约束：
 *   - 不抛错——调用方（服务加载 / ETL 主流程）不允许因省份未配置而崩溃；
 *     但必须在日志里留下 WARN 痕迹，让 PM2/监控能感知到非预期的 SC 默认。
 *   - 调用方在「env 已显式设置」的场景（如非 SC 省联邦视图补列）
 *     应在上层做 `process.env.BRANCH_CODE` 存在性断言，或使用 `assertBranchCodeSet()`。
 *
 * @param raw - 来自 process.env.BRANCH_CODE 的原始字符串（或 undefined）
 * @param context - 调用位置描述（用于 WARN 消息定位），如 'getDeploymentBranchCode'
 */
export function resolveBranchCode(raw: string | undefined, context = 'resolveBranchCode'): string {
  if (raw && BRANCH_CODE_RE.test(raw)) return raw;
  if (!raw) {
    console.warn(
      `[WARN][${context}] BRANCH_CODE 未设置，默认回退 'SC'（四川）。` +
      `若当前部署非四川，请在 PM2 ecosystem.config.cjs 或 .env.local 中显式设置 BRANCH_CODE=<省份码>。`
    );
  } else {
    console.warn(
      `[WARN][${context}] BRANCH_CODE='${raw}' 格式非法（须 CHAR(2) 大写字母），回退 'SC'。` +
      `请检查环境变量配置。`
    );
  }
  return 'SC';
}

/**
 * 断言 BRANCH_CODE 已显式设置（数据路径保护用）。
 *
 * 在确信「当前部署必须有明确省份身份」的场景调用（如多省 ETL 分支校验）。
 * 未设置时抛 Error，阻断错误路径静默使用 SC 默认。
 *
 * @throws Error - 当 BRANCH_CODE 未设置或格式非法时
 */
export function assertBranchCodeSet(context = 'assertBranchCodeSet'): string {
  const raw = process.env.BRANCH_CODE;
  if (raw && BRANCH_CODE_RE.test(raw)) return raw;
  throw new Error(
    `[${context}] BRANCH_CODE 未设置或格式非法（当前值: ${JSON.stringify(raw)}）。` +
    `此调用路径要求明确省份身份，禁止静默默认 SC。请在部署环境设置 BRANCH_CODE=<省份码>。`
  );
}

/**
 * 部署级分公司编码（CHAR(2)：'SC'=四川 / 'SX'=山西），派生视图视图层补 branch_code 常量列时使用。
 *
 * 注：此为「部署级运行时」分公司编码（联邦视图补 branch_code 常量列用），与 fields.json 的 ETL 派生
 * 是两个口径——P1 起 fields.json branch_code 改为 policy_no 前 3 位 prefix_map 派生（非 envVar 常量）。
 * 直读 `process.env`（仿 isFederationEnabled，避开 env.ts 加载期快照，PM2 reload 即时生效）。
 * 严格白名单校验 `^[A-Z]{2}$`：非法 / 缺省告警并回退 'SC'（fail-soft，服务启动不崩溃）。
 * 返回值仅用于受控视图 DDL 内插，已被该正则约束为两位大写字母，无 SQL 注入面。
 *
 * ⚠️  fail-closed 改造（治理工程一）：env 缺失时打 WARN，不再静默返回 'SC'。
 * 若需断言省份必须显式设置，使用 assertBranchCodeSet()。
 */
export function getDeploymentBranchCode(): string {
  return resolveBranchCode(process.env.BRANCH_CODE, 'getDeploymentBranchCode');
}

/**
 * 取关系的联邦策略。
 * - PolicyFact：始终返回（历史行为）。
 * - 其余：仅 federation 开启时返回；关闭或未登记 → null（拒绝）。
 */
export function getRelationPolicy(relation: string): RelationPolicy | null {
  const key = relation.toUpperCase();
  if (key === 'POLICYFACT') return POLICY_FACT_POLICY;
  if (!isFederationEnabled()) return null;
  return FEDERATED_REGISTRY[key] ?? null;
}

/** 关系是否在当前开关状态下被允许访问 */
export function isRelationAllowed(relation: string): boolean {
  return getRelationPolicy(relation) !== null;
}

/**
 * 当前开关状态下「需要注入行级权限」的全部关系（strategy='direct'）。
 * - 关闭：仅 PolicyFact。
 * - 开启：PolicyFact + 联邦白名单中所有 direct 关系（exempt 不在内）。
 * 注入器据此对 SQL 中出现的每个 direct 关系逐一包裹过滤子视图。
 */
export function getInjectableRelations(): RelationPolicy[] {
  const result: RelationPolicy[] = [POLICY_FACT_POLICY];
  if (isFederationEnabled()) {
    for (const policy of Object.values(FEDERATED_REGISTRY)) {
      if (policy.strategy === 'direct') result.push(policy);
    }
  }
  return result;
}

/**
 * 判断某关系是否支持给定的权限过滤列集合（fail-closed 核心）。
 * 过滤条件引用的列必须**全部**存在于该关系，否则不支持（调用方须拒绝执行，不可丢弃过滤）。
 */
export function relationSupportsFilterColumns(
  policy: RelationPolicy,
  filterColumns: readonly string[],
): boolean {
  return filterColumns.every((col) => policy.permissionColumns.has(col.toLowerCase()));
}

/**
 * 返回 SQL 中引用到的、当前开关下可注入的 federated 关系所对应的**惰性域 key**（去重）。
 *
 * 背景：cx sql（sql-passthrough）不走 typed 路由的 createDomainMiddleware，不会自动
 * ensureDomainLoaded。纯惰性域（如 NewEnergyClaims，启动不急切建视图、不在启动预热清单）
 * 在直查时会「table does not exist」。sql-passthrough 调用本函数取得需预热的域，逐一
 * ensureDomainLoaded 后再执行，弥补该缺口。
 *
 * - 开关关闭：仅 PolicyFact 可注入，且其无 lazyDomain → 返回空（行为不变，零额外开销）。
 * - 开关开启：扫描 SQL 中出现的 direct 关系，返回其 lazyDomain（PolicyFact 无 → 跳过）。
 *
 * 关系名按单词边界、大小写不敏感匹配（DuckDB 标识符大小写不敏感，准入校验亦不分大小写）。
 */
export function getReferencedLazyDomains(sql: string): string[] {
  const domains = new Set<string>();
  for (const policy of getInjectableRelations()) {
    if (!policy.lazyDomain) continue;
    const re = new RegExp(`\\b${policy.canonical}\\b`, 'i');
    if (re.test(sql)) domains.add(policy.lazyDomain);
  }
  return [...domains];
}
