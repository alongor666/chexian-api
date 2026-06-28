/**
 * 业务员聚合键「同短名不同工号不合并」语义集成测试
 *
 * 背景：PR #832（commit cac04a74）把 cross-sell 业务员聚合键改为带工号全名
 * （salesman_name = "工号+姓名"，如 "11111张丽"），防止同名真人被合并为一行。
 *
 * 本测试用 in-memory DuckDB 执行 generateCrossSellQuery 生成的真实 SQL，
 * 验证以下三条核心语义：
 *   1. 两名同短名（"张丽"）但不同工号（"11111"/"22222"）业务员 → 结果行数 = 2，不合并
 *   2. 两行 group_name 不同（各含自己的带工号原值）
 *   3. 同机构同名时 display_name 包含 "#工号" 消歧后缀
 *
 * 归入 test:integration 分层（需 DuckDB 原生二进制，CI 环境无法解析 .node addon）。
 * 参考已有集成测试：duckdb-cube-salesman.test.ts（createDuckDBService 初始化模式）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import { generateCrossSellQuery } from '../../sql/cross-sell.js';

// ============================================================
// Fixture 常量
// ============================================================

/** 两名同短名业务员的带工号全名（= salesman_name 字段值） */
const SALESMAN_A = '11111张丽'; // 工号 11111
const SALESMAN_B = '22222张丽'; // 工号 22222

/** 同一三级机构（同机构同名 → display_name 需 #工号 后缀） */
const ORG = '天府支公司';

// ============================================================
// 辅助：建 fixture 表
// ============================================================

/**
 * 创建最小 CrossSellDailyAgg fixture（直接建 TABLE，不走 Parquet）。
 *
 * 列对齐 duckdb-materialization.ts groupByColumns（业务员下钻必需列）：
 *   policy_date / insurance_start_date / branch_code / org_level_3 / salesman_name /
 *   customer_category / coverage_combination / auto_count / driver_count
 *
 * 数据设计：
 *   - SALESMAN_A："主全" 2 件，其中 1 件推介驾意
 *   - SALESMAN_B："主全" 3 件，其中 2 件推介驾意
 *   两人 org_level_3 相同（= ORG），短名相同（= "张丽"）
 */
async function createFixtures(db: DuckDBService): Promise<void> {
  // CrossSellDailyAgg — 业务员推介率数据
  await db.query(`
    CREATE TABLE CrossSellDailyAgg AS
    SELECT
      DATE '2026-01-15' AS policy_date,
      DATE '2026-01-15' AS insurance_start_date,
      'SC'              AS branch_code,
      '${ORG}'          AS org_level_3,
      '${SALESMAN_A}'   AS salesman_name,
      '非营业个人客车'  AS customer_category,
      '主全'            AS coverage_combination,
      2                 AS auto_count,
      1                 AS driver_count
    UNION ALL
    SELECT
      DATE '2026-01-15', DATE '2026-01-15', 'SC',
      '${ORG}', '${SALESMAN_B}', '非营业个人客车', '主全', 3, 2
  `);

  // SalesmanTeamMapping — LEFT JOIN 用（salesman 下钻时 generateCrossSellQuery 必 JOIN）
  await db.query(`
    CREATE TABLE SalesmanTeamMapping AS
    SELECT '${SALESMAN_A}' AS full_name, '精英团队' AS team_name
    UNION ALL
    SELECT '${SALESMAN_B}' AS full_name, '精英团队' AS team_name
  `);
}

// ============================================================
// 测试套件
// ============================================================

describe('业务员聚合键 — 同短名不同工号不合并（PR #832 核心语义）', () => {
  let db: DuckDBService;
  let rows: Array<{ group_name: string; display_name: string; org_level_3: string; total_auto_count: number }>;

  beforeAll(async () => {
    db = createDuckDBService({ path: ':memory:' });
    await db.init();
    await createFixtures(db);

    // 生成 SQL：groupBy=salesman，无 drillPath，baseWhereClause 放行所有行
    const sql = generateCrossSellQuery(
      "branch_code = 'SC'",   // baseWhereClause
      [],                      // drillPath（无下钻过滤）
      'salesman',              // groupBy
      '四川分公司'             // summaryGroupName（汇总行，不影响分组行）
    );

    rows = await db.query(sql);
  });

  afterAll(async () => {
    try {
      await db.close();
    } catch {
      // ignore
    }
  });

  it('两名同短名业务员不被合并（行数 = 2）', () => {
    // 核心语义：带工号聚合键（11111张丽 ≠ 22222张丽）→ 两行，不是一行
    expect(rows).toHaveLength(2);
  });

  it('两行 group_name 不同且各含自己工号', () => {
    const groupNames = rows.map((r) => r.group_name).sort();
    // group_name 是带工号原值，供下钻精确传参
    expect(groupNames).toContain(SALESMAN_A);
    expect(groupNames).toContain(SALESMAN_B);
    // 两人 group_name 不同（不会被去工号合并）
    expect(groupNames[0]).not.toBe(groupNames[1]);
  });

  it('同机构同名时 display_name 含 #工号 后缀（消歧）', () => {
    const displayNames = rows.map((r) => r.display_name);
    // 同机构同名 → display_name 走最长兜底分支：短名·机构#工号
    // 预期格式：张丽·天府支公司#11111 / 张丽·天府支公司#22222
    const hasDisambig = displayNames.every((dn) => dn.includes('#'));
    expect(hasDisambig).toBe(true);

    const displayA = displayNames.find((dn) => dn.includes('#11111'));
    const displayB = displayNames.find((dn) => dn.includes('#22222'));
    expect(displayA).toBeDefined();
    expect(displayB).toBeDefined();
    // 两人 display_name 不同（消歧成功）
    expect(displayA).not.toBe(displayB);
  });

  it('各自推介件数保留原值（数据完整性）', () => {
    const rowA = rows.find((r) => r.group_name === SALESMAN_A);
    const rowB = rows.find((r) => r.group_name === SALESMAN_B);

    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    // SALESMAN_A auto_count=2，SALESMAN_B auto_count=3
    expect(Number(rowA!.total_auto_count)).toBe(2);
    expect(Number(rowB!.total_auto_count)).toBe(3);
  });
});
