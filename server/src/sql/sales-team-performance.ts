/**
 * 销售队伍业绩（标保）SQL 生成器 — SalesTeamPerformanceFact
 *
 * 数据源：sales_team_etl.py 产出的规则层明细（标保口径 SSOT =
 * 数据管理/pipelines/sales_team_rules.sql，见 sales_portrait ADR-006）。
 * 视图为中文列名；本生成器负责聚合与列名到英文 API 字段的映射。
 *
 * 安全：维度走白名单映射（hasOwnProperty 校验），日期走 isValidDateFormat，
 * limit 走 Number.isInteger——无任何用户字符串直接内插。
 */

import { isValidDateFormat } from '../utils/sql-sanitizer.js';

/** 维度白名单：API 维度 id → 视图中文列名 */
export const SALES_TEAM_DIMENSION_IDS = ['salesman', 'team', 'org', 'insurance_class'] as const;
export type SalesTeamDimension = typeof SALES_TEAM_DIMENSION_IDS[number];

export const SALES_TEAM_DIMENSIONS: Readonly<Record<SalesTeamDimension, string>> = {
  salesman: '业务员',
  team: '销售团队',
  org: '机构',
  insurance_class: '险种大类',
} as const;

export interface SalesTeamPerformanceQueryParams {
  /** 聚合维度（白名单 id） */
  dimension: SalesTeamDimension;
  /** 承保确认时间范围起（YYYY-MM-DD，可选） */
  start?: string;
  /** 承保确认时间范围止（YYYY-MM-DD，可选） */
  end?: string;
  /** 返回行数上限（默认 200） */
  limit?: number;
}

function buildDateWhere(start?: string, end?: string): string {
  const conds: string[] = [];
  if (start !== undefined) {
    if (!isValidDateFormat(start)) throw new Error(`Invalid start date: ${start}`);
    conds.push(`"承保确认时间" >= DATE '${start}'`);
  }
  if (end !== undefined) {
    if (!isValidDateFormat(end)) throw new Error(`Invalid end date: ${end}`);
    conds.push(`"承保确认时间" <= DATE '${end}'`);
  }
  return conds.length > 0 ? conds.join(' AND ') : '1=1';
}

/**
 * 按维度聚合：保单行数 / 实收保费 / 标保（修复后口径），按标保降序。
 */
export function generateSalesTeamPerformanceQuery(params: SalesTeamPerformanceQueryParams): string {
  if (!Object.prototype.hasOwnProperty.call(SALES_TEAM_DIMENSIONS, params.dimension)) {
    throw new Error(`Unknown dimension: ${params.dimension}`);
  }
  const column = SALES_TEAM_DIMENSIONS[params.dimension];
  const limit = params.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error(`Invalid limit: ${params.limit}`);
  }
  const where = buildDateWhere(params.start, params.end);
  return `
    SELECT
      coalesce("${column}", '(未指定)') AS dim_value,
      COUNT(*) AS sales_team_row_count,
      ROUND(SUM("实收保费"), 2) AS received_premium,
      ROUND(SUM("标保"), 2) AS standard_premium
    FROM SalesTeamPerformanceFact
    WHERE ${where}
    GROUP BY 1
    ORDER BY standard_premium DESC
    LIMIT ${limit}
  `;
}

/**
 * 全局合计（同一 WHERE，无分组）——前端汇总行与占比分母。
 */
export function generateSalesTeamPerformanceTotalQuery(
  params: Pick<SalesTeamPerformanceQueryParams, 'start' | 'end'>
): string {
  const where = buildDateWhere(params.start, params.end);
  return `
    SELECT
      COUNT(*) AS sales_team_row_count,
      ROUND(SUM("实收保费"), 2) AS received_premium,
      ROUND(SUM("标保"), 2) AS standard_premium,
      CAST(MAX("承保确认时间") AS VARCHAR) AS latest_confirm_date
    FROM SalesTeamPerformanceFact
    WHERE ${where}
  `;
}
