/**
 * Query Adapter — 桥接 Skill 与现有 SQL 生成器 / DuckDB 服务
 *
 * 职责：
 * - 从 SkillContext 与 input.period 构建 WHERE 子句（自动注入行级过滤）
 * - 直接调用 duckdbService.query，复用 QueryCache
 * - 不绕过权限：permissionFilter 强制串入每条 WHERE
 *
 * 注：保留 SQL 字符串拼接而非直查 PolicyFact 的最小封装，
 * 让阶段 2+ 的 cost-diagnosis 等 Skill 可以继续复用。
 */

import { duckdbService } from '../../services/duckdb.js';
import { QUERY_CACHE } from '../../routes/query/shared.js';
import type { Period, SkillContext } from '../types.js';

const escapeSqlString = (value: string): string => value.replace(/'/g, "''");

export interface BuildPeriodWhereOptions {
  /** 主日期字段，默认 policy_date（与 KPI 一致） */
  dateField?: 'policy_date' | 'insurance_start_date';
}

/**
 * 构造同时包含日期 + 行级过滤的 WHERE 子句（不含 WHERE 关键字）
 */
export function buildPeriodWhere(
  period: Period,
  ctx: SkillContext,
  options: BuildPeriodWhereOptions = {}
): { whereWithDate: string; whereWithoutDate: string; dateField: 'policy_date' | 'insurance_start_date' } {
  const dateField = options.dateField ?? 'policy_date';
  const startEsc = escapeSqlString(period.startDate);
  const endEsc = escapeSqlString(period.endDate);
  // fail-closed：调用方未传 permissionFilter 时禁止放行任何行（'1=0' 而非 '1=1'）。
  // 上游 routes/{skills,workflows,copilot}.ts 已显式校验 req.permissionFilter 非空才进入，
  // 这里是 defense-in-depth：未来若新增 skill 直调入口忘了挂权限，至少 fail-closed 而不是悄悄放开数据。
  const permission = ctx.permissionFilter || '1=0';

  const dateClause = `CAST(${dateField} AS DATE) >= DATE '${startEsc}' AND CAST(${dateField} AS DATE) <= DATE '${endEsc}'`;
  return {
    whereWithDate: `(${dateClause}) AND (${permission})`,
    whereWithoutDate: `(${permission})`,
    dateField,
  };
}

/**
 * 执行 SQL 并缓存。默认走 hotspotShort（1 小时），与 KPI 路由一致。
 */
export async function runSql<T = Record<string, unknown>>(
  sql: string,
  cacheTtlMs: number = QUERY_CACHE.hotspotShort
): Promise<T[]> {
  return duckdbService.query<T>(sql, cacheTtlMs);
}

/**
 * 获取所有可用的 Parquet 域名（粗略）—— 通过查询 information_schema 列出已加载的表
 */
export async function listLoadedRelations(): Promise<string[]> {
  const rows = await duckdbService.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`,
    0
  );
  return rows.map((r) => r.name).filter((n) => !!n);
}

/**
 * 检查表是否存在
 */
export async function relationExists(name: string): Promise<boolean> {
  const all = await listLoadedRelations();
  return all.includes(name);
}
