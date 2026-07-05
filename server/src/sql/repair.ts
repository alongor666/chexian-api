/**
 * 维修资源分析 SQL 生成器
 *
 * 数据源：RepairDim TABLE（12列：修理厂合作状态/核损金额/换件折扣率/签单净保费）
 */

import { escapeSqlValue } from '../utils/security.js';

export interface RepairFilters {
  orgName?: string;
  is4sShop?: string;
  cooperationStatus?: string;
  city?: string;
}

function buildWhere(filters: RepairFilters): string {
  const clauses: string[] = ['1=1'];
  if (filters.orgName) clauses.push(`org_level_3 = '${escapeSqlValue(filters.orgName)}'`);
  if (filters.is4sShop === 'true') clauses.push(`is_4s_shop = true`);
  if (filters.is4sShop === 'false') clauses.push(`is_4s_shop = false`);
  if (filters.cooperationStatus) clauses.push(`cooperation_status = '${escapeSqlValue(filters.cooperationStatus)}'`);
  if (filters.city) clauses.push(`city = '${escapeSqlValue(filters.city)}'`);
  return clauses.join(' AND ');
}

/** 机构级维修资源汇总 */
export function generateRepairOverviewQuery(filters: RepairFilters, whereClause: string = '1=1'): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      org_level_3,
      COUNT(DISTINCT repair_shop_name) AS shop_count,
      COUNT(DISTINCT CASE WHEN is_4s_shop THEN repair_shop_name END) AS shop_4s_count,
      COUNT(DISTINCT CASE WHEN cooperation_status = '1生效中' THEN repair_shop_name END) AS active_count,
      ROUND(SUM(COALESCE(damage_assessment_amount, 0)), 2) AS total_damage_amount,
      ROUND(AVG(COALESCE(parts_discount_rate, 0)), 4) AS avg_discount_rate,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS total_net_premium
    FROM RepairDim
    WHERE ${finalWhere}
    GROUP BY org_level_3
    ORDER BY total_net_premium DESC
  `.trim();
}

/** 修理厂明细列表 */
export function generateRepairDetailQuery(filters: RepairFilters, limit = 200, offset = 0, whereClause: string = '1=1'): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      repair_shop_name,
      org_level_3,
      cooperation_status,
      channel_type,
      is_4s_shop,
      province, city, district,
      ROUND(COALESCE(damage_assessment_amount, 0), 2) AS damage_assessment_amount,
      COALESCE(parts_discount_rate, 0) AS parts_discount_rate,
      ROUND(COALESCE(net_premium, 0), 2) AS net_premium,
      report_date
    FROM RepairDim
    WHERE ${finalWhere}
    ORDER BY net_premium DESC
    LIMIT ${limit} OFFSET ${offset}
  `.trim();
}

/** 合作状态分布 */
export function generateRepairStatusQuery(filters: RepairFilters, whereClause: string = '1=1'): string {
  const where = buildWhere(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      cooperation_status,
      COUNT(DISTINCT repair_shop_name) AS shop_count,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS total_net_premium
    FROM RepairDim
    WHERE ${finalWhere}
    GROUP BY cooperation_status
    ORDER BY shop_count DESC
  `.trim();
}

/** 元数据：筛选选项（按权限过滤可见机构/城市范围） */
export function generateRepairMetadataQuery(whereClause: string = '1=1'): string {
  const wc = whereClause !== '1=1' ? ` AND ${whereClause}` : '';
  return `
    SELECT
      (SELECT array_agg(DISTINCT org_level_3 ORDER BY org_level_3) FROM RepairDim WHERE org_level_3 IS NOT NULL${wc}) AS orgs,
      (SELECT array_agg(DISTINCT cooperation_status ORDER BY cooperation_status) FROM RepairDim WHERE cooperation_status IS NOT NULL${wc}) AS statuses,
      (SELECT array_agg(DISTINCT city ORDER BY city) FROM RepairDim WHERE city IS NOT NULL${wc}) AS cities,
      (SELECT COUNT(DISTINCT repair_shop_name) FROM RepairDim${wc !== '' ? ` WHERE 1=1${wc}` : ''}) AS total_shops
  `.trim();
}

// ============================================================================
// 2026-04-18 重设计：单页下钻 + 三态分布 + 本地资源占比 + 导流清单
// 业务规则字典 §§ 维修资源分析口径
// 源字段映射：.claude/shared-memory/repair_source_field_mapping.md
// ============================================================================

/** 时间窗口枚举（与业务规则字典 §4 一致） */
export type RepairTimeWindow = 'ytd' | 'rolling12' | 'all';

/** 扩展筛选器（三态 + 区县 + 时间窗） */
export interface RepairFiltersV2 extends RepairFilters {
  district?: string;
  shopCode?: string;
  coopTier?: 'active' | 'past' | 'none';
  timeWindow?: RepairTimeWindow;
}

/** 合作状态三态 CASE 片段（业务规则字典 §1） */
const COOP_TIER_CASE = `CASE
  WHEN cooperation_status = '1生效中' THEN 'active'
  WHEN cooperation_status IN ('0暂停合作', '7已撤销', '8失效') THEN 'past'
  ELSE 'none'
END`;

/** 非维修单位排除条件（§2） */
const NON_REPAIR_FILTER = `(
    repair_shop_name NOT LIKE '%定损%'
    AND repair_shop_name NOT LIKE '%自选%'
    AND repair_shop_name <> '无'
    AND repair_shop_name IS NOT NULL
  )`;

/**
 * 时间窗 WHERE 子句（用于 ClaimsDetail，基准 MAX(accident_time) 而非 today()）。
 *
 * PR-6（RLS-on 硬前置）：基准 MAX 子查询亦读 ClaimsDetail，多省共存时须按 branchCode 收束到本省，
 * 否则 SX 用户的窗口锚点会被 SC 最新出险日带偏（读到对方省的聚合时点）。branchCode undefined
 * （RLS-off / 单省）→ 不追加 WHERE → 与历史 SQL 逐字节一致（字节安全）。
 */
function claimsTimeWindow(window: RepairTimeWindow | undefined, alias = 'c', branchCode?: string): string {
  if (!window || window === 'all') return '1=1';
  const baseWhere = branchCode ? ` WHERE branch_code = '${branchCode}'` : '';
  if (window === 'ytd') {
    return `YEAR(${alias}.accident_time) = YEAR((SELECT MAX(accident_time) FROM ClaimsDetail${baseWhere}))`;
  }
  // rolling12
  return `${alias}.accident_time >= (SELECT MAX(accident_time) FROM ClaimsDetail${baseWhere}) - INTERVAL 12 MONTH`;
}

/**
 * ClaimsDetail 影子网点扫描的分省 RLS 过滤片段（PR-6 · RLS-on 硬前置）。
 *
 * 影子 / 导流 / 本地资源等 CTE 直接扫 ClaimsDetail、**不经 PolicyFact JOIN**，故无法靠 JOIN
 * 传导 RLS——必须在 ClaimsDetail 扫描处就地下推 `branch_code` 隔离本省。branchCode 来自路由
 * resolveBranchRlsCode(req,'ClaimsDetail') 双门控（gate a：RLS-on 且用户有省份码；gate b：
 * ClaimsDetail 实测含 branch_code 列），经 ^[A-Z]{2}$ 校验后内插，无 SQL 注入面。
 * undefined（RLS-off / 单省）→ 返回空串 → 不追加任何字符 → 字节安全、RLS-off 生产零行为变更。
 */
function claimsBranchAnd(branchCode: string | undefined, alias = 'c'): string {
  return branchCode ? ` AND ${alias}.branch_code = '${branchCode}'` : '';
}

/**
 * RepairDim 登记表 bare 子查询的分省 RLS 过滤片段（PR-7 · RLS-on 硬前置第二半）。
 *
 * 影子分类用的 `NOT IN / IN (SELECT … FROM RepairDim …)` 子查询**不经 finalWhere**（buildRepairWhere
 * 只注入主 CTE），故跨省登记表会误判本省赔案网点的登记状态。本片段在这些 bare 子查询就地下推
 * `branch_code`。repairBranchCode 来自 `resolveBranchRlsCode(req,'RepairDim')` 双门控——**gate b
 * 在 RepairDim 实测含 branch_code 列**（仅 PR-7 数据物化后为真），故与 ClaimsDetail 的 branchCode
 * **独立 gate**：RepairDim 未物化时返回 undefined → 不注入 → 不 Binder Error（字节安全）。RepairDim
 * 子查询无别名 → branch_code 不带前缀。branchCode 经 ^[A-Z]{2}$ 校验，无注入面。
 */
function repairDimBranchAnd(repairBranchCode: string | undefined): string {
  return repairBranchCode ? ` AND branch_code = '${repairBranchCode}'` : '';
}

/** v2 WHERE 构造（兼容 v1） */
function buildWhereV2(filters: RepairFiltersV2): string {
  const clauses: string[] = [NON_REPAIR_FILTER];
  if (filters.orgName) clauses.push(`org_level_3 = '${escapeSqlValue(filters.orgName)}'`);
  if (filters.is4sShop === 'true') clauses.push(`is_4s_shop = true`);
  if (filters.is4sShop === 'false') clauses.push(`is_4s_shop = false`);
  if (filters.cooperationStatus) clauses.push(`cooperation_status = '${escapeSqlValue(filters.cooperationStatus)}'`);
  if (filters.city) clauses.push(`city = '${escapeSqlValue(filters.city)}'`);
  if (filters.district) clauses.push(`district = '${escapeSqlValue(filters.district)}'`);
  if (filters.shopCode) clauses.push(`SUBSTR(repair_shop_name, 1, 8) = '${escapeSqlValue(filters.shopCode)}'`);
  if (filters.coopTier) {
    if (filters.coopTier === 'active') clauses.push(`cooperation_status = '1生效中'`);
    else if (filters.coopTier === 'past') clauses.push(`cooperation_status IN ('0暂停合作', '7已撤销', '8失效')`);
    else if (filters.coopTier === 'none') clauses.push(`(cooperation_status IS NULL OR cooperation_status IN ('3退回修改', '5待复核', '无合作'))`);
  }
  return clauses.join(' AND ');
}

/** 【1】城市汇总：按修理厂所在市聚合 */
export function generateRepairCityQuery(filters: RepairFiltersV2, whereClause: string = '1=1'): string {
  const where = buildWhereV2(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      city,
      COUNT(DISTINCT SUBSTR(repair_shop_name, 1, 8)) AS shop_count,
      COUNT(DISTINCT CASE WHEN is_4s_shop THEN SUBSTR(repair_shop_name, 1, 8) END) AS shop_4s_count,
      COUNT(DISTINCT CASE WHEN cooperation_status = '1生效中' THEN SUBSTR(repair_shop_name, 1, 8) END) AS active_count,
      ROUND(SUM(COALESCE(damage_assessment_amount, 0)), 2) AS total_damage_amount,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS total_net_premium
    FROM RepairDim
    WHERE ${finalWhere}
    GROUP BY city
    ORDER BY total_net_premium DESC
  `.trim();
}

/** 【2】渠道类型 × 4S 交叉分布 */
export function generateRepairChannelQuery(filters: RepairFiltersV2, whereClause: string = '1=1'): string {
  const where = buildWhereV2(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      COALESCE(channel_type, '未分类') AS channel_type,
      is_4s_shop,
      COUNT(DISTINCT SUBSTR(repair_shop_name, 1, 8)) AS shop_count,
      ROUND(SUM(COALESCE(damage_assessment_amount, 0)), 2) AS total_damage_amount,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS total_net_premium
    FROM RepairDim
    WHERE ${finalWhere}
    GROUP BY channel_type, is_4s_shop
    ORDER BY shop_count DESC
  `.trim();
}

/** 【3】三态合作分布（含影子网点从 claims 反推） */
export function generateRepairCoopTierQuery(filters: RepairFiltersV2, whereClause: string = '1=1', branchCode?: string, repairBranchCode?: string): string {
  const where = buildWhereV2(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  const timeWhere = claimsTimeWindow(filters.timeWindow, 'c', branchCode);
  const claimsBranch = claimsBranchAnd(branchCode);
  const repairBranch = repairDimBranchAnd(repairBranchCode);
  return `
    WITH repair_tiers AS (
      SELECT
        ${COOP_TIER_CASE} AS coop_tier,
        SUBSTR(repair_shop_name, 1, 8) AS shop_code,
        COALESCE(damage_assessment_amount, 0) AS damage_amt,
        COALESCE(net_premium, 0) AS premium
      FROM RepairDim
      WHERE ${finalWhere}
    ),
    shadow_shops AS (
      SELECT DISTINCT c.subject_shop_code AS shop_code
      FROM ClaimsDetail c
      WHERE c.subject_shop_code IS NOT NULL
        AND ${timeWhere}${claimsBranch}
        AND c.subject_shop_code NOT IN (SELECT DISTINCT SUBSTR(repair_shop_name, 1, 8) FROM RepairDim WHERE repair_shop_name IS NOT NULL${repairBranch})
    ),
    tier_agg AS (
      SELECT coop_tier, COUNT(DISTINCT shop_code) AS shop_count,
             ROUND(SUM(damage_amt), 2) AS damage_amount,
             ROUND(SUM(premium), 2) AS net_premium
      FROM repair_tiers
      GROUP BY coop_tier
      UNION ALL
      SELECT 'none_shadow' AS coop_tier, COUNT(*) AS shop_count, 0 AS damage_amount, 0 AS net_premium FROM shadow_shops
    )
    SELECT coop_tier, shop_count, damage_amount, net_premium FROM tier_agg ORDER BY
      CASE coop_tier WHEN 'active' THEN 1 WHEN 'past' THEN 2 WHEN 'none' THEN 3 ELSE 4 END
  `.trim();
}

/** 【4】散点图数据：区县 × 机构 网格三态（业务规则字典 §6） */
export function generateRepairScatterQuery(filters: RepairFiltersV2, whereClause: string = '1=1', branchCode?: string): string {
  const where = buildWhereV2(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  const timeWhere = claimsTimeWindow(filters.timeWindow, 'c', branchCode);
  const claimsBranch = claimsBranchAnd(branchCode);
  return `
    WITH repair_shops AS (
      SELECT
        SUBSTR(repair_shop_name, 1, 8) AS shop_code,
        repair_shop_name,
        org_level_3,
        district,
        city,
        ${COOP_TIER_CASE} AS coop_tier,
        is_4s_shop,
        COALESCE(damage_assessment_amount, 0) AS damage_amount,
        COALESCE(net_premium, 0) AS net_premium
      FROM RepairDim
      WHERE ${finalWhere}
    ),
    shadow_geo AS (
      SELECT
        subject_shop_code AS shop_code,
        accident_district AS district,
        COUNT(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY subject_shop_code ORDER BY COUNT(*) DESC) AS rn
      FROM ClaimsDetail c
      WHERE c.subject_shop_code IS NOT NULL
        AND c.accident_district IS NOT NULL
        AND ${timeWhere}${claimsBranch}
        AND c.subject_shop_code NOT IN (SELECT DISTINCT shop_code FROM repair_shops)
      GROUP BY subject_shop_code, accident_district
    ),
    shadow_premium AS (
      SELECT
        c.subject_shop_code AS shop_code,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        SUM(COALESCE(c.settled_vehicle_amount, 0)) AS settled_amount
      FROM ClaimsDetail c
      WHERE c.subject_shop_code IS NOT NULL AND ${timeWhere}${claimsBranch}
        AND c.subject_shop_code NOT IN (SELECT DISTINCT shop_code FROM repair_shops)
      GROUP BY c.subject_shop_code
    )
    SELECT shop_code, repair_shop_name AS shop_name, org_level_3, district, city,
           coop_tier, is_4s_shop,
           ROUND(damage_amount, 2) AS damage_amount,
           ROUND(net_premium, 2) AS net_premium
    FROM repair_shops
    UNION ALL
    SELECT
      sg.shop_code,
      sg.shop_code AS shop_name,
      NULL AS org_level_3,
      sg.district,
      NULL AS city,
      'none_shadow' AS coop_tier,
      false AS is_4s_shop,
      0 AS damage_amount,
      ROUND(COALESCE(sp.settled_amount, 0), 2) AS net_premium
    FROM shadow_geo sg
    LEFT JOIN shadow_premium sp ON sg.shop_code = sp.shop_code
    WHERE sg.rn = 1
  `.trim();
}

/** 【5】本地资源占比（L4，RepairDim LEFT JOIN ClaimsDetail） */
export function generateRepairLocalResourceQuery(filters: RepairFiltersV2, whereClause: string = '1=1', branchCode?: string): string {
  const where = buildWhereV2(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  const timeWhere = claimsTimeWindow(filters.timeWindow, 'c', branchCode);
  const claimsBranch = claimsBranchAnd(branchCode);
  return `
    WITH base AS (
      SELECT
        SUBSTR(repair_shop_name, 1, 8) AS shop_code,
        repair_shop_name AS shop_name,
        org_level_3,
        district AS shop_district
      FROM RepairDim
      WHERE ${finalWhere}
    ),
    joined AS (
      SELECT
        b.shop_code,
        b.shop_name,
        b.org_level_3,
        b.shop_district,
        COUNT(DISTINCT c.claim_no) AS total_claims,
        COUNT(DISTINCT CASE WHEN c.accident_district = b.shop_district THEN c.claim_no END) AS local_claims
      FROM base b
      LEFT JOIN ClaimsDetail c ON c.subject_shop_code = b.shop_code AND ${timeWhere}${claimsBranch}
      GROUP BY b.shop_code, b.shop_name, b.org_level_3, b.shop_district
    )
    SELECT shop_code, shop_name, org_level_3, shop_district, total_claims, local_claims,
           CASE WHEN total_claims > 0 THEN ROUND(local_claims * 1.0 / total_claims, 4) ELSE NULL END AS local_resource_ratio
    FROM joined
    WHERE total_claims > 0
    ORDER BY total_claims DESC
  `.trim();
}

/** 6. 修保比（维修产值 / 签单净保费） */
export function generateRepairToPremiumQuery(filters: RepairFiltersV2, whereClause: string = '1=1'): string {
  const where = buildWhereV2(filters);
  const finalWhere = whereClause !== '1=1' ? `${where} AND ${whereClause}` : where;
  return `
    SELECT
      org_level_3,
      SUBSTR(repair_shop_name, 1, 8) AS shop_code,
      repair_shop_name AS shop_name,
      ${COOP_TIER_CASE} AS coop_tier,
      ROUND(SUM(COALESCE(damage_assessment_amount, 0)), 2) AS damage_amount,
      ROUND(SUM(COALESCE(net_premium, 0)), 2) AS net_premium,
      CASE WHEN SUM(COALESCE(net_premium, 0)) > 0
           THEN ROUND(SUM(COALESCE(damage_assessment_amount, 0)) * 1.0 / SUM(COALESCE(net_premium, 0)), 3)
           ELSE NULL END AS repair_to_premium_ratio
    FROM RepairDim
    WHERE ${finalWhere}
    GROUP BY org_level_3, shop_code, shop_name, coop_tier
    HAVING SUM(COALESCE(net_premium, 0)) > 0
    ORDER BY net_premium DESC
  `.trim();
}

/** 【7】导流目标清单：送修在"曾合作/未合作/影子"的保单 */
export function generateRepairDiversionListQuery(filters: RepairFiltersV2, limit = 500, offset = 0, whereClause: string = '1=1', branchCode?: string, policyBranchCode?: string, repairBranchCode?: string): string {
  const timeWhere = claimsTimeWindow(filters.timeWindow, 'c', branchCode);
  const claimsBranch = claimsBranchAnd(branchCode);
  const repairBranch = repairDimBranchAnd(repairBranchCode);
  const orgClause = filters.orgName ? `AND p.org_level_3 = '${escapeSqlValue(filters.orgName)}'` : '';
  // whereClause 注入到 PolicyFact（有 org_level_3/is_telemarketing），实现保单维度权限收束
  const policyWhereExtra = whereClause !== '1=1' ? ` AND ${whereClause}` : '';
  // PR-6 review HIGH-1：PolicyFact 显式分省 RLS——不再仅依赖 policy_no 610/618 前缀不碰撞的数据
  // 约定（虽 ETL 强制、零碰撞，但应代码强制隔离边界）。policyBranchCode 经 resolveBranchRlsCode
  // (req,'PolicyFact') 双门控；undefined → 空串 → 字节安全。PolicyFact 无别名故 branch_code 不带前缀。
  const policyBranch = policyBranchCode ? ` AND branch_code = '${policyBranchCode}'` : '';
  // BACKLOG 2026-06-25-claude-6b021a（codex 闸-2 PR-7 复审 MEDIUM）：diversion_claims 读 ClaimsDetail 仅按
  // 分省（claimsBranch）收束，无 org 粒度过滤；final LEFT JOIN policy_dedup 时，凡 dc.policy_no 不在 org
  // 收束后的 policy_dedup 里的行，p.* 为 null 但 dc.*（claim_no/subject_shop_code/accident_district/
  // shop_tier）仍输出 → org_user 经 LEFT JOIN 可见同分公司内他机构的赔案行（duckdb 实证：高新 org_user
  // 从 242,598 行里泄漏 210,450 行天府/青羊/宜宾等他 org 赔案）。owner 2026-07-04 拍板：diversion-list
  // 对 org_user 收窄到 org_level_3 粒度。ClaimsDetail 无 org_level_3，故把 org 约束经 permitted_policies
  //（PolicyFact 按同一 org 权限子句 + 分省收束后的保单号集合）传导到 diversion_claims，使 org_user 只见本
  // org 保单的赔案行。用 permitted_policies 而非直接半连接 policy_dedup：后者带 HAVING SUM(premium)>0，会
  // 连带过滤掉本 org 自身退保（0 元）保单的展示行（LEFT JOIN 下 premium 显示 null，属既有展示行为）。
  // 字节安全：whereClause='1=1'（branch_admin / 全国全 org 可见）→ orgScoped=false → 不产 CTE、不加过滤 →
  // 与历史逐字节一致，故既有单测（均以 '1=1' 调用）不受影响。branch/telemarketing 权限维度不在此收窄。
  const orgScoped = whereClause !== '1=1';
  const permittedPoliciesCte = orgScoped
    ? `permitted_policies AS (
      SELECT DISTINCT policy_no FROM PolicyFact WHERE 1=1${policyWhereExtra}${policyBranch}
    ),
    `
    : '';
  const orgScopeAnd = orgScoped
    ? ' AND c.policy_no IN (SELECT policy_no FROM permitted_policies)'
    : '';
  return `
    WITH ${permittedPoliciesCte}active_shops AS (
      SELECT DISTINCT SUBSTR(repair_shop_name, 1, 8) AS shop_code
      FROM RepairDim
      WHERE cooperation_status = '1生效中' AND ${NON_REPAIR_FILTER}${repairBranch}
    ),
    diversion_claims AS (
      SELECT DISTINCT
        c.policy_no,
        c.claim_no,
        c.subject_shop_code,
        c.subject_repair_shop,
        c.accident_district,
        c.accident_time,
        CASE
          WHEN c.subject_shop_code IN (SELECT shop_code FROM active_shops) THEN 'active'
          WHEN c.subject_shop_code IN (SELECT DISTINCT SUBSTR(repair_shop_name, 1, 8) FROM RepairDim WHERE cooperation_status IN ('0暂停合作', '7已撤销', '8失效')${repairBranch}) THEN 'past'
          WHEN c.subject_shop_code IN (SELECT DISTINCT SUBSTR(repair_shop_name, 1, 8) FROM RepairDim WHERE repair_shop_name IS NOT NULL${repairBranch}) THEN 'none'
          ELSE 'none_shadow'
        END AS shop_tier
      FROM ClaimsDetail c
      WHERE c.subject_shop_code IS NOT NULL AND ${timeWhere}${claimsBranch}${orgScopeAnd}
    ),
    -- B252：PolicyFact 按 policy_no 去重，防止原单+批改多行让列表行数翻倍且 premium 显示错乱
    policy_dedup AS (
      SELECT
        policy_no,
        SUM(premium) AS premium,
        ANY_VALUE(org_level_3) AS org_level_3,
        ANY_VALUE(salesman_name) AS salesman_name,
        ANY_VALUE(customer_category) AS customer_category
      FROM PolicyFact
      WHERE 1=1${policyWhereExtra}${policyBranch}
      GROUP BY policy_no
      HAVING SUM(premium) > 0
    )
    SELECT
      dc.policy_no,
      dc.claim_no,
      dc.subject_shop_code,
      dc.subject_repair_shop,
      dc.accident_district,
      dc.accident_time,
      dc.shop_tier,
      p.org_level_3,
      p.salesman_name,
      p.customer_category,
      ROUND(p.premium, 2) AS premium
    FROM diversion_claims dc
    LEFT JOIN policy_dedup p ON dc.policy_no = p.policy_no
    WHERE dc.shop_tier IN ('past', 'none', 'none_shadow') ${orgClause}
    ORDER BY p.premium DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `.trim();
}

/** 【8】影子网点（claims 中出现但 RepairDim 未登记）地理归属 */
export function generateRepairOrphanShopsQuery(filters: RepairFiltersV2, limit = 100, whereClause: string = '1=1', branchCode?: string, repairBranchCode?: string): string {
  // whereClause 为签名扩展，ClaimsDetail 无 org_level_3/is_telemarketing，机构维度不在此过滤
  // （void 保留入参兼容路由层统一传参）。PR-6：分省 RLS 经 branchCode 在 ClaimsDetail 扫描处
  // 下推（claimsBranch），将「全省维度」收束为「本省维度」——多省下不再跨省串读影子网点。
  void whereClause;
  const timeWhere = claimsTimeWindow(filters.timeWindow, 'c', branchCode);
  const claimsBranch = claimsBranchAnd(branchCode);
  const repairBranch = repairDimBranchAnd(repairBranchCode);
  return `
    WITH orphan_claims AS (
      SELECT
        c.subject_shop_code AS shop_code,
        c.subject_repair_shop AS shop_name,
        c.accident_district AS district,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        SUM(COALESCE(c.settled_vehicle_amount, 0)) AS settled_amount
      FROM ClaimsDetail c
      WHERE c.subject_shop_code IS NOT NULL
        AND c.accident_district IS NOT NULL
        AND ${timeWhere}${claimsBranch}
        AND c.subject_shop_code NOT IN (SELECT DISTINCT SUBSTR(repair_shop_name, 1, 8) FROM RepairDim WHERE repair_shop_name IS NOT NULL${repairBranch})
      GROUP BY c.subject_shop_code, c.subject_repair_shop, c.accident_district
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_code ORDER BY claim_count DESC) AS rn,
             SUM(claim_count) OVER (PARTITION BY shop_code) AS total_claims_all_district,
             SUM(settled_amount) OVER (PARTITION BY shop_code) AS total_settled_all_district
      FROM orphan_claims
    )
    SELECT shop_code, ANY_VALUE(shop_name) AS shop_name,
           district AS primary_district,
           total_claims_all_district AS claim_count,
           ROUND(total_settled_all_district, 2) AS settled_amount
    FROM ranked
    WHERE rn = 1
    GROUP BY shop_code, district, total_claims_all_district, total_settled_all_district
    ORDER BY claim_count DESC
    LIMIT ${limit}
  `.trim();
}
