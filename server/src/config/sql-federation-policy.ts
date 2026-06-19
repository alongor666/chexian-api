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
    permissionColumns: new Set(['org_level_3', 'salesman_name']),
    strategy: 'direct',
  },
  QUOTECONVERSION: {
    canonical: 'QuoteConversion',
    // 注：parquet 中 is_telemarketing 为 varchar（非 boolean），与权限过滤的布尔字面量
    // `is_telemarketing = true` 类型不匹配，故**不**纳入 RLS 列——电销用户查该视图 fail-closed
    // 拒绝（安全无泄漏），待 P0.5 列类型归一后再启用。
    permissionColumns: new Set(['org_level_3', 'salesman_name']),
    strategy: 'direct',
  },
  CROSSSELLFACT: {
    canonical: 'CrossSellFact',
    permissionColumns: new Set(['org_level_3', 'salesman_name']),
    strategy: 'direct',
  },
  NEWENERGYCLAIMS: {
    canonical: 'NewEnergyClaims',
    permissionColumns: new Set(['org_level_3']),
    strategy: 'direct',
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
