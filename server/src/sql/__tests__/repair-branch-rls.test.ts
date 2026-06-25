/**
 * repair.ts 影子网点 CTE 分省 RLS 注入纯函数单测（PR-6 · RLS-on 硬前置）。CI 运行（无 DuckDB）。
 *
 * 背景：repair 4 端点（coop-tier / scatter / diversion-list / orphan-shops）的影子网点 CTE
 * `FROM ClaimsDetail c` 不经 PolicyFact JOIN、原本无 branch_code 过滤。PR-1 让 ClaimsDetail
 * 多源后，RLS-on + SX 账号激活会让影子网点跨省串读（SX 看 SC 赔案 / 反之）。orphan-shops
 * 更 `void whereClause` 丢弃全部过滤。
 *
 * 不变式：
 *   - 传 branchCode（'SX'）→ 每个 ClaimsDetail 影子 CTE 含 `c.branch_code = 'SX'` 等值过滤
 *     （路由 resolveBranchRlsCode(req,'ClaimsDetail') 双门控解析所得，本省隔离）
 *   - 不传（undefined）→ SQL **不含** `branch_code = '`（flag off / 单省 → 不注入 →
 *     与历史 SQL 逐字节一致 = 字节安全，RLS-off 生产零行为变更）
 *
 * 注：路由层 resolveBranchRlsCode 的「列存在性 gate b」需 DuckDB，覆盖在 duckdb-repair-branch-rls
 * 集成测试；本文件只证生成器拿到 branchCode 后的注入正确性（纯函数）。
 */
import { describe, it, expect } from 'vitest';
import {
  generateRepairCoopTierQuery,
  generateRepairScatterQuery,
  generateRepairLocalResourceQuery,
  generateRepairDiversionListQuery,
  generateRepairOrphanShopsQuery,
  type RepairFiltersV2,
} from '../repair.js';

const BRANCH = "c.branch_code = 'SX'";
// 字节安全：不传 branchCode 时生成器应零 branch_code 提及（含 MAX 子查询基准），
// 与历史 SQL 逐字节一致。比「无 branch_code = '」更严。
const NO_BRANCH = 'branch_code';
const filters: RepairFiltersV2 = {};

/** 计 substr 出现次数（验证多扫描端点的每处 ClaimsDetail 扫描都注入）。 */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('repair 影子网点 CTE 分省 RLS 注入（PR-6）', () => {
  it('传 branchCode → coop-tier shadow_shops 含 c.branch_code 过滤', () => {
    expect(generateRepairCoopTierQuery(filters, '1=1', 'SX')).toContain(BRANCH);
  });

  it('传 branchCode → scatter（shadow_geo + shadow_premium 两处 ClaimsDetail 扫描）均注入', () => {
    const sql = generateRepairScatterQuery(filters, '1=1', 'SX');
    expect(count(sql, BRANCH)).toBe(2);
  });

  it('传 branchCode → local-resource ClaimsDetail JOIN 含 c.branch_code 过滤（同类·防跨省赔案灌入本省网点）', () => {
    expect(generateRepairLocalResourceQuery(filters, '1=1', 'SX')).toContain(BRANCH);
  });

  it('传 branchCode → diversion-list diversion_claims 含 c.branch_code 过滤', () => {
    expect(generateRepairDiversionListQuery(filters, 500, 0, '1=1', 'SX')).toContain(BRANCH);
  });

  it('传 policyBranchCode → diversion-list policy_dedup（PolicyFact）显式分省过滤（review HIGH-1 纵深防御）', () => {
    // PolicyFact 无别名，故 branch_code 不带前缀；不再仅靠 policy_no 610/618 前缀约定隔离
    expect(generateRepairDiversionListQuery(filters, 500, 0, '1=1', 'SX', 'SX')).toContain("WHERE 1=1 AND branch_code = 'SX'");
  });

  it('不传 policyBranchCode → policy_dedup 不含 PolicyFact branch 过滤（字节安全）', () => {
    expect(generateRepairDiversionListQuery(filters, 500, 0, '1=1', 'SX')).not.toContain("WHERE 1=1 AND branch_code = 'SX'");
  });

  it('传 branchCode → orphan-shops orphan_claims 含 c.branch_code 过滤（修复 void whereClause 泄漏）', () => {
    expect(generateRepairOrphanShopsQuery(filters, 100, '1=1', 'SX')).toContain(BRANCH);
  });

  it('传 branchCode + timeWindow → MAX(accident_time) 基准子查询亦按本省过滤（防窗口锚点被对方省带偏）', () => {
    const sql = generateRepairCoopTierQuery({ timeWindow: 'rolling12' }, '1=1', 'SX');
    // 基准 MAX 子查询用不带别名的 branch_code 过滤（与影子扫描的 c.branch_code 区分）
    expect(sql).toContain("FROM ClaimsDetail WHERE branch_code = 'SX'");
  });

  it('传 branchCode + timeWindow → scatter 两处 MAX 基准子查询均按本省过滤（review MEDIUM-1）', () => {
    const sql = generateRepairScatterQuery({ timeWindow: 'rolling12' }, '1=1', 'SX');
    // shadow_geo + shadow_premium 各含一个 MAX(accident_time) 基准子查询
    expect(count(sql, "FROM ClaimsDetail WHERE branch_code = 'SX'")).toBe(2);
  });

  it('不传 branchCode → 5 端点均不含 branch_code 过滤（字节安全 · RLS-off 生产零变更）', () => {
    expect(generateRepairCoopTierQuery(filters)).not.toContain(NO_BRANCH);
    expect(generateRepairScatterQuery(filters)).not.toContain(NO_BRANCH);
    expect(generateRepairLocalResourceQuery(filters)).not.toContain(NO_BRANCH);
    expect(generateRepairDiversionListQuery(filters)).not.toContain(NO_BRANCH);
    expect(generateRepairOrphanShopsQuery(filters)).not.toContain(NO_BRANCH);
  });

  it('不传 branchCode + timeWindow=rolling12 → 仍零 branch_code（字节安全·时间窗场景，review MEDIUM-2）', () => {
    expect(generateRepairCoopTierQuery({ timeWindow: 'rolling12' })).not.toContain(NO_BRANCH);
    expect(generateRepairScatterQuery({ timeWindow: 'rolling12' })).not.toContain(NO_BRANCH);
    expect(generateRepairOrphanShopsQuery({ timeWindow: 'rolling12' })).not.toContain(NO_BRANCH);
  });
});
