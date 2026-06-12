/**
 * 趋势立方体 SQL 模块（通用可加性立方体 · 第一阶段试点）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md
 * BACKLOG：uid=2026-06-11-claude-90a92c（P1）
 *
 * 核心思想：/api/query/trend 的全部度量（SUM(premium) / COUNT(*) 及其 CASE 变体）
 * 都是可加度量，且时间表达式只是 policy_date 的函数、"次月起保"条件只用到
 * insurance_start_date 的年月 —— 因此可由一张"签单日 × 起保月 × 筛选维度"的
 * 预聚合小表（CubeTrendDay）精确回答任意筛选组合，结果与直查 PolicyFact 逐行相等。
 *
 * 三道安全网：
 *   1. isTrendCubeServable —— WHERE 子句 token 级白名单，出现任何立方体外列即回退原路径
 *   2. rewriteTrendSqlForCube —— 改写器对替换次数做断言，模板漂移时抛错而非生成错误 SQL
 *   3. 路由层影子对账（CUBE_SHADOW_COMPARE）—— 双跑逐行比对，见 services/cube-shadow.ts
 */

import { generatePremiumTrendQuery } from '../trend/premium-trend.js';
import type { TimeView, ViewPerspective, DateCriteria } from '../trend/shared.js';
import { CUBE_DIMENSIONS, CUBE_OPTIONAL_DIMENSIONS, isWhereServableByCube } from './servability.js';

/** 立方体表名（物化逻辑见 services/duckdb-cube.ts） */
export const TREND_CUBE_TABLE = 'CubeTrendDay';

/**
 * 立方体维度列（同时是 WHERE 子句 token 白名单的列部分）。
 *
 * ⚠️ insurance_start_date 在立方体中是【月初日期】（DATE_TRUNC('month', ...)），
 * 列名保持与事实表一致是为了让趋势 SQL 的"次月起保"条件
 * （只取 YEAR/MONTH，月初日期的年月 == 原日期的年月）无需改写即语义等价。
 * 禁止在立方体上做 insurance_start_date 的"日"粒度筛选/分组。
 */
export const TREND_CUBE_DIMENSIONS = CUBE_DIMENSIONS;

/** 多分公司行级安全列（PolicyFact 存在该列时纳入立方体粒度，permissionFilter 注入的 branch_code 条件可直接下推） */
export const TREND_CUBE_OPTIONAL_DIMENSIONS = CUBE_OPTIONAL_DIMENSIONS;

/**
 * 生成立方体构建 SQL。
 * @param hasBranchCode - PolicyFact schema 是否含 branch_code（由物化器探测后传入）
 * @param policyDateIsTimestamp - PolicyFact.policy_date 是否 TIMESTAMP 类型（由物化器探测）。
 *   生产 ETL（pandas datetime64）落盘为 TIMESTAMP（时分秒恒 00:00:00）；本地合成数据
 *   常为 DATE。**立方体列类型必须跟随源列**——否则 `CAST(policy_date AS VARCHAR)` 等
 *   类型敏感表达式在两边输出不同字符串（'2026-01-01 00:00:00' vs '2026-01-01'），
 *   生产影子对账 trend 12/12 全 mismatch 即此根因（2026-06-12，追踪 issue #608）。
 */
export function buildTrendCubeSql(hasBranchCode: boolean, policyDateIsTimestamp: boolean = false): string {
  // 日截断 + 类型保真：TIMESTAMP 源截断后 CAST 回 TIMESTAMP（00:00:00），DATE 源保持 DATE
  const policyDateExpr = policyDateIsTimestamp
    ? `CAST(CAST(policy_date AS DATE) AS TIMESTAMP) AS policy_date`
    : `CAST(policy_date AS DATE) AS policy_date`;
  const dims = [
    policyDateExpr,
    // 月初日期：年月与原起保日一致（见 TREND_CUBE_DIMENSIONS 注释）。
    // 该列不出现在任何输出（仅供 EXTRACT 年月比较），无类型保真需求
    `DATE_TRUNC('month', CAST(insurance_start_date AS DATE)) AS insurance_start_date`,
    `org_level_3`,
    `customer_category`,
    `insurance_type`,
    `is_renewal`,
    `is_new_car`,
    `is_transfer`,
    `is_nev`,
    `is_telemarketing`,
    ...(hasBranchCode ? ['branch_code'] : []),
  ];
  return `
    CREATE OR REPLACE TABLE ${TREND_CUBE_TABLE} AS
    SELECT
      ${dims.join(',\n      ')},
      SUM(premium) AS premium_sum,
      COUNT(*) AS row_cnt
    FROM PolicyFact
    GROUP BY ALL
  `;
}

// ── 可服务性判定 ──────────────────────────────────────────────────────────────

// WHERE token 白名单判定逻辑已上提到 servability.ts（growth 等路由族共用），
// 本模块只保留趋势特有的视角/时间口径判定。
export interface TrendCubeServability {
  servable: boolean;
  reason?: string;
}

/**
 * 判定一次趋势请求能否由立方体精确回答。
 * @param whereClause - 最终 WHERE 子句（已含权限过滤）
 * @param dateField   - 请求的时间口径字段
 * @param perspective - 视角：仅保费视角可加。件数视角自 2026-06-12 口径修复
 *   （COUNT(*) → COUNT(DISTINCT policy_no)，去批改多行虚增）后为**去重计数 =
 *   非可加指标**——批改行可能落在不同日期/维度单元，预聚合后再求和会重复计数，
 *   按设计文档 §2.3 指标可加性路由规则回退原路径。
 */
export function isTrendCubeServable(
  whereClause: string,
  dateField: string,
  perspective: string = 'premium'
): TrendCubeServability {
  if (perspective !== 'premium') {
    return { servable: false, reason: `perspective=${perspective}（去重件数为非可加指标，走原路径）` };
  }
  // 立方体时间粒度 = 签单日；insurance_start_date 口径只有月粒度 → 回退
  if (dateField !== 'policy_date') {
    return { servable: false, reason: `dateField=${dateField}（立方体仅支持 policy_date 日粒度）` };
  }
  return isWhereServableByCube(whereClause);
}

// ── SQL 改写器 ───────────────────────────────────────────────────────────────

/**
 * 把原趋势 SQL（FROM PolicyFact，行级度量）改写为立方体版本（FROM CubeTrendDay，
 * 预聚合度量）。只做三类机械替换，且对每类替换的出现次数做断言 ——
 * premium-trend.ts 模板演进导致模式对不上时立刻抛错（fail-fast），
 * 绝不静默产出口径错误的 SQL。
 *
 * 仅支持保费视角（件数视角为去重计数 = 非可加，由 isTrendCubeServable 拦截；
 * 本函数对任何 COUNT 出现都直接抛错兜底）。
 *
 * 等价性依据（与原模板逐段对照）：
 *   SUM(premium)                  → SUM(premium_sum)      可加，分组重聚合
 *   SUM(CASE..THEN premium..)     → SUM(CASE..THEN premium_sum..)
 * 时间/分组表达式（policy_date 函数、org_level_3、月锚窗口函数）原样保留 ——
 * 它们只引用立方体粒度列，对预聚合行与原始行同义。
 */
export function rewriteTrendSqlForCube(sql: string): string {
  const replaceCounted = (
    input: string,
    pattern: RegExp,
    replacement: string,
    expect: { min: number; max: number },
    label: string
  ): string => {
    const count = (input.match(pattern) ?? []).length;
    if (count < expect.min || count > expect.max) {
      throw new Error(
        `[TrendCube] SQL 改写断言失败：${label} 出现 ${count} 次（期望 ${expect.min}-${expect.max}）。` +
        `premium-trend.ts 模板可能已演进，请同步更新 rewriteTrendSqlForCube 并补充等值测试。`
      );
    }
    return input.replace(pattern, replacement);
  };

  let out = sql;
  // 数据源（恰好 1 处）
  out = replaceCounted(out, /\bFROM PolicyFact\b/g, `FROM ${TREND_CUBE_TABLE}`, { min: 1, max: 1 }, 'FROM PolicyFact');
  // 任何 COUNT（含 2026-06-12 口径修复后的 COUNT(DISTINCT policy_no)）= 非可加 → fail-fast
  replaceCounted(out, /\bCOUNT\(/g, '', { min: 0, max: 0 }, 'COUNT(（非可加计数，立方体不支持）');
  // 行级保费 → 预聚合保费（保费视角：总量 1 处 + 锚定月分子分母 2 处）
  out = replaceCounted(out, /\bSUM\(premium\)/g, 'SUM(premium_sum)', { min: 1, max: 1 }, 'SUM(premium)');
  out = replaceCounted(out, /\bTHEN premium\b/g, 'THEN premium_sum', { min: 2, max: 2 }, 'THEN premium');

  // 终态断言：改写后不得再出现行级度量/原表引用
  if (/\bPolicyFact\b/.test(out) || /\bTHEN premium\b/.test(out) || /\bSUM\(premium\)/.test(out) || /\bCOUNT\(/.test(out)) {
    throw new Error('[TrendCube] SQL 改写终态断言失败：仍残留行级度量或 PolicyFact 引用');
  }
  return out;
}

/**
 * 生成立方体版趋势查询（与 generatePremiumTrendQuery 同参同义）。
 * 调用方必须先通过 isTrendCubeServable 判定。
 */
export function generatePremiumTrendCubeQuery(
  timeView: TimeView,
  whereClause: string = '1=1',
  dateField: DateCriteria = 'policy_date',
  perspective: ViewPerspective = 'premium',
  groupDim: string = 'org_level_3'
): string {
  const legacySql = generatePremiumTrendQuery(timeView, whereClause, dateField, perspective, groupDim);
  return rewriteTrendSqlForCube(legacySql);
}
