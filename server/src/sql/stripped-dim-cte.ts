/**
 * 团队/业务员维度剥列 CTE 构造器（分省 RLS 免二义 + 免扇出）。
 *
 * ## 两个不变量（缺一不可）
 *
 * 1. **剥列**（PR #1017 结构层根治二义）：JOIN 维表时只投影实际消费列
 *    （team_name / organization），**不投影 branch_code** → 与事实表裸 branch_code
 *    RLS 过滤天然无二义，替代已删的 qualifyBranchCodeColumn。
 * 2. **按省过滤**（本文件补齐扇出根治）：多省下 SalesmanTeamMapping / SalesmanDim
 *    按 (branch_code, full_name) 去重 → **同名业务员跨 SC/SX 各留一行**。团队维度
 *    JOIN 时若不按省过滤，单省事实保费会被两省的团队各记一次（扇出）。
 *    真实 parquet 实证（2026-07-09）：SC 域凭空 +123,582 元、SX 域 +153,326 元，
 *    错配集中在 SC「未分配」桶。按省过滤后逐分守恒。详见 memory
 *    rls-branch-code-ambiguous-team-join「生产已证伪+量化」段。
 *
 * ## 字节安全（RED LINE）
 *
 * rlsBranchCode undefined（BRANCH_RLS_ENABLED=false / 单省无 branch_code 列 →
 * 路由层 resolveBranchRlsCode 双门控返回 undefined）时，产出**逐字节等价** PR #1017
 * 基线（`... FROM SalesmanTeamMapping`，无 DISTINCT / 无 WHERE）→ 四川单省零变更。
 *
 * DISTINCT 仅在多省分支加，作为兜底：域加载器已按 (branch_code, full_name) 去重，
 * 单省过滤后 full_name 本已唯一，DISTINCT 是防御性冗余（对齐 PR #1017 目标契约测试）。
 */
import { escapeSqlValue } from '../utils/security.js';

/**
 * 分省过滤片段：多省注入 `SELECT DISTINCT ... WHERE branch_code = 'XX'`；
 * 单省（rlsBranchCode undefined）返回 `{ distinct: '', where: '' }` → 字节安全。
 */
function branchScope(rlsBranchCode?: string): { distinct: string; where: string } {
  if (!rlsBranchCode) return { distinct: '', where: '' };
  return {
    distinct: 'DISTINCT ',
    where: ` WHERE branch_code = '${escapeSqlValue(rlsBranchCode)}'`,
  };
}

/**
 * team_mapping 剥列 CTE：`team_mapping AS (SELECT [DISTINCT] full_name, team_name FROM SalesmanTeamMapping[ WHERE branch_code = 'XX'])`
 * @param rlsBranchCode 分省 RLS 省份码（路由层 resolveBranchRlsCode(req, 'SalesmanTeamMapping') 解析）；undefined → 单省字节安全。
 */
export function buildTeamMappingCte(rlsBranchCode?: string): string {
  const { distinct, where } = branchScope(rlsBranchCode);
  return `team_mapping AS (SELECT ${distinct}full_name, team_name FROM SalesmanTeamMapping${where})`;
}

/**
 * salesman_dim 剥列 CTE：`salesman_dim AS (SELECT [DISTINCT] full_name, organization FROM SalesmanDim[ WHERE branch_code = 'XX'])`
 *
 * SalesmanDim 与 SalesmanTeamMapping 由域加载器同一 multiProvince gate 同步携带 branch_code
 * （duckdb-domain-loaders.ts），故共用同一 rlsBranchCode；两表同名跨省行同理需按省过滤免扇出。
 */
export function buildSalesmanDimCte(rlsBranchCode?: string): string {
  const { distinct, where } = branchScope(rlsBranchCode);
  return `salesman_dim AS (SELECT ${distinct}full_name, organization FROM SalesmanDim${where})`;
}
