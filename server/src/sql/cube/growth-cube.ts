/**
 * 增长分析立方体 SQL 模块（通用可加性立方体 · 第二批次）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md §3A.2 ①族
 * BACKLOG：uid=2026-06-11-claude-90a92c
 *
 * /api/query/growth 的同比（双扫 PolicyFact，即 B306 F-02 形态）/ 环比 / 年累计 /
 * 自定义对比，聚合只有白名单指标 SUM(premium) 与 COUNT(*) —— 均为可加度量，
 * 时间表达式均为 policy_date 的函数，复用趋势立方体 CubeTrendDay 即可精确回答。
 *
 * 不可服务而回退的情形（与趋势同一套三道安全网）：
 *   - dual-metric 子类型：件数为 COUNT(DISTINCT policy_no)（2026-06-12 口径修复，
 *     去重计数非可加）
 *   - groupBy 含 salesman_name（业务员不在立方体粒度，防粒度爆炸）
 *   - WHERE 引用立方体外列（token 白名单，见 servability.ts）
 */

import { isWhereServableByCube, type CubeServability } from './servability.js';
import { TREND_CUBE_TABLE } from './trend-cube.js';

/** growth 路由可由立方体服务的指标白名单（路由 zod enum 的全集，均可加） */
const SERVABLE_METRICS = new Set(['SUM(premium)', 'COUNT(*)']);

export interface GrowthCubeArgs {
  whereClause: string;
  /** 路由 metric 参数（undefined = 生成器默认 SUM(premium)） */
  metric?: string;
  groupBy?: string[];
}

/** 判定一次增长分析请求能否由立方体精确回答 */
export function isGrowthCubeServable(args: GrowthCubeArgs): CubeServability {
  const metric = args.metric ?? 'SUM(premium)';
  if (!SERVABLE_METRICS.has(metric)) {
    return { servable: false, reason: `metric=${metric}（不在可加白名单）` };
  }
  for (const dim of args.groupBy ?? []) {
    if (dim !== 'org_level_3') {
      return { servable: false, reason: `groupBy=${dim}（不在立方体粒度）` };
    }
  }
  return isWhereServableByCube(args.whereClause);
}

/**
 * 把增长分析 SQL（FROM PolicyFact，行级度量）改写为立方体版本。
 *
 * 与趋势改写器同一原则：机械替换 + fail-fast 断言。growth 各子模板
 * （yoy 双扫 / mom 单扫+LAG / ytd / custom 双扫 / daily-context）的扫描次数
 * 不同，故 FROM 替换允许 1-2 处；终态断言保证零残留。
 *
 * 等价性依据：
 *   SUM(premium) → SUM(premium_sum)   可加
 *   COUNT(*)     → SUM(row_cnt)       行数可加
 * 时间表达式 / LAG / FULL OUTER JOIN 全部作用于已聚合层，原样保留。
 */
export function rewriteGrowthSqlForCube(sql: string): string {
  // 去重计数 = 非可加，任何出现直接 fail-fast（dual-metric 等口径演进的兜底）
  if (/\bCOUNT\(DISTINCT\b/i.test(sql)) {
    throw new Error('[GrowthCube] SQL 含 COUNT(DISTINCT ...)（非可加计数），不可改写为立方体查询');
  }

  const fromCount = (sql.match(/\bFROM PolicyFact\b/g) ?? []).length;
  if (fromCount < 1 || fromCount > 2) {
    throw new Error(
      `[GrowthCube] SQL 改写断言失败：FROM PolicyFact 出现 ${fromCount} 次（期望 1-2）。` +
      `growth 生成器模板可能已演进，请同步更新 rewriteGrowthSqlForCube 并补充等值测试。`
    );
  }

  let out = sql;
  out = out.replace(/\bFROM PolicyFact\b/g, `FROM ${TREND_CUBE_TABLE}`);
  out = out.replace(/\bSUM\(premium\)/g, 'SUM(premium_sum)');
  out = out.replace(/\bCOUNT\(\*\)/g, 'SUM(row_cnt)');

  // 终态断言：不得残留行级度量 / 原表引用 / 任何 COUNT
  if (/\bPolicyFact\b/.test(out) || /\bSUM\(premium\)/.test(out) || /\bCOUNT\(/.test(out)) {
    throw new Error('[GrowthCube] SQL 改写终态断言失败：仍残留行级度量或 PolicyFact 引用');
  }
  return out;
}
