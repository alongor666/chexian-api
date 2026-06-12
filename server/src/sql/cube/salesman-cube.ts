/**
 * 业务员立方体 SQL 模块（通用可加性立方体 · 第五批次：CubeSalesmanDay）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md §3A.2 ②族（salesman-ranking 行）
 * BACKLOG：uid=2026-06-11-claude-90a92c
 *
 * /api/query/salesman-ranking 的两类排名（全部业务 / 优质业务）度量只有
 * SUM(premium) 与 COUNT(*) —— 均为行级可加；优质业务条件
 * （QUALITY_BUSINESS_CONDITION）只引用 is_nev / customer_category / tonnage_segment，
 * 全部在立方体粒度内，条件对格子行与原始行同义。
 *
 * 与成本立方体的关键差异：本立方体**无保单去重语义**（COUNT(*) 是行数不是去重
 * 保单数），度量纯行级可加 → 行携带自身维度值，过滤与预聚合天然可交换，
 * **无需跨格保单探针**，与趋势立方体同一新鲜度模型。
 *
 * 不可服务而回退的情形：
 *   - WHERE 含 insurance_start_date（起保日口径窗）：未纳入粒度（避免格子数
 *     翻倍；业务员排名默认签单日口径），token 白名单自动回退
 *   - WHERE 含立方体外列（险别组合/车型/燃料/评分/续保方式等）：同上
 */

import {
  generateSalesmanAllBusinessRankingQuery,
  generateSalesmanQualityBusinessRankingQuery,
} from '../salesman-ranking.js';
import {
  buildWhereTokenAllowlist,
  isWhereServableForColumns,
  type CubeServability,
} from './servability.js';

/** 立方体表名（物化逻辑见 services/duckdb-cube.ts） */
export const SALESMAN_CUBE_TABLE = 'CubeSalesmanDay';

/**
 * 业务员立方体维度列。policy_date 为【日】粒度（任意签单日窗可下推）；
 * customer_category / is_nev / tonnage_segment 必须保留 —— 优质业务条件引用。
 */
export const SALESMAN_CUBE_DIMENSIONS = [
  'policy_date',
  'salesman_name',
  'org_level_3',
  'customer_category',
  'insurance_type',
  'tonnage_segment',
  'is_renewal',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
] as const;

/** 多分公司行级安全列（PolicyFact 存在时纳入粒度，permissionFilter 条件可下推） */
export const SALESMAN_CUBE_OPTIONAL_DIMENSIONS = ['branch_code'] as const;

const SALESMAN_WHERE_ALLOWLIST = buildWhereTokenAllowlist([
  ...SALESMAN_CUBE_DIMENSIONS,
  ...SALESMAN_CUBE_OPTIONAL_DIMENSIONS,
]);

/**
 * 生成立方体构建 SQL。
 * @param hasBranchCode - PolicyFact schema 是否含 branch_code（由物化器探测后传入）
 */
export function buildSalesmanCubeSql(hasBranchCode: boolean): string {
  const dims = [
    `CAST(policy_date AS DATE) AS policy_date`,
    `salesman_name`,
    `org_level_3`,
    `customer_category`,
    `insurance_type`,
    `tonnage_segment`,
    `is_renewal`,
    `is_new_car`,
    `is_transfer`,
    `is_nev`,
    `is_telemarketing`,
    ...(hasBranchCode ? ['branch_code'] : []),
  ];
  return `
    CREATE OR REPLACE TABLE ${SALESMAN_CUBE_TABLE} AS
    SELECT
      ${dims.join(',\n      ')},
      SUM(premium) AS premium_sum,
      COUNT(*) AS row_cnt
    FROM PolicyFact
    GROUP BY ALL
  `;
}

/** 判定一次业务员排名请求能否由立方体精确回答 */
export function isSalesmanCubeServable(whereClause: string): CubeServability {
  return isWhereServableForColumns(whereClause, SALESMAN_WHERE_ALLOWLIST);
}

/**
 * 把业务员排名 SQL（FROM PolicyFact，行级度量）改写为立方体版本。
 * 与趋势/增长改写器同一原则：机械替换 + 替换次数断言 fail-fast ——
 * salesman-ranking.ts 模板演进对不上模式时抛错而非生成口径错误的 SQL。
 *
 * 等价性依据：
 *   SUM(premium) → SUM(premium_sum)   可加
 *   COUNT(*)     → SUM(row_cnt)       行数可加
 * WHERE / QUALITY_BUSINESS_CONDITION / GROUP BY / ORDER BY / LIMIT 只引用
 * 立方体粒度列，对预聚合行与原始行同义，原样保留。
 */
export function rewriteSalesmanSqlForCube(sql: string): string {
  if (/\bCOUNT\(DISTINCT\b/i.test(sql)) {
    throw new Error('[SalesmanCube] SQL 含 COUNT(DISTINCT ...)（非可加计数），不可改写为立方体查询');
  }

  const counted = (pattern: RegExp, label: string): void => {
    const count = (sql.match(pattern) ?? []).length;
    if (count !== 1) {
      throw new Error(
        `[SalesmanCube] SQL 改写断言失败：${label} 出现 ${count} 次（期望 1）。` +
        `salesman-ranking.ts 模板可能已演进，请同步更新 rewriteSalesmanSqlForCube 并补充等值测试。`
      );
    }
  };
  counted(/\bFROM PolicyFact\b/g, 'FROM PolicyFact');
  counted(/\bSUM\(premium\)/g, 'SUM(premium)');
  counted(/\bCOUNT\(\*\)/g, 'COUNT(*)');

  let out = sql;
  out = out.replace(/\bFROM PolicyFact\b/g, `FROM ${SALESMAN_CUBE_TABLE}`);
  out = out.replace(/\bSUM\(premium\)/g, 'SUM(premium_sum)');
  out = out.replace(/\bCOUNT\(\*\)/g, 'SUM(row_cnt)');

  if (/\bPolicyFact\b/.test(out) || /\bSUM\(premium\)/.test(out) || /\bCOUNT\(/.test(out)) {
    throw new Error('[SalesmanCube] SQL 改写终态断言失败：仍残留行级度量或 PolicyFact 引用');
  }
  return out;
}

/** 生成立方体版排名查询（与原生成器同参同义）。调用方必须先通过可服务性 + 新鲜度判定 */
export function generateSalesmanRankingCubeQuery(
  rankingType: 'all' | 'quality',
  whereClause: string,
  limit: number
): string {
  const legacySql = rankingType === 'all'
    ? generateSalesmanAllBusinessRankingQuery(whereClause, limit)
    : generateSalesmanQualityBusinessRankingQuery(whereClause, limit);
  return rewriteSalesmanSqlForCube(legacySql);
}
