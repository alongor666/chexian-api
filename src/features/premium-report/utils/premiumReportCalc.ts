/**
 * 保费报表纯逻辑工具
 *
 * 从 usePremiumReport Hook 提取的与 React 无关的纯函数，便于直接单测：
 * - calculateSummary：机构 / 业务员报表 → 汇总统计（求和 + 去重计数 + 均值）
 * - sortData：泛型表格排序（null 处理 + 数字 / 中文 localeCompare）
 * - normalizeOrgReportRow / normalizeSalesmanReportRow：API 原始行 → 强类型行
 *
 * 行为与原 Hook 内联实现逐字段一致（golden 不变）。
 */

import { formatSalesmanName, formatTeamName } from '../../../shared/utils/formatters';
import type {
  OrgPremiumReportRow,
  SalesmanPremiumReportRow,
  PremiumReportSummary,
  SortState,
} from '../types/premiumReport';

/**
 * 计算汇总数据
 *
 * - totalPremium / avgPremium 保留两位小数（四舍五入）
 * - salesmanCount 按 `raw_salesman_name ?? salesman_name` 去重
 * - avgPremium 在无机构（orgCount=0）时回退 0，避免除零
 */
export function calculateSummary(
  orgReport: OrgPremiumReportRow[],
  salesmanReport: SalesmanPremiumReportRow[]
): PremiumReportSummary {
  const totalPremium = orgReport.reduce((sum, row) => sum + row.车险保费, 0);
  const totalPolicies = orgReport.reduce((sum, row) => sum + row.车险件数, 0);
  const orgCount = orgReport.length;
  const salesmanCount = new Set(
    salesmanReport.map((row) => String(row.raw_salesman_name ?? row.salesman_name))
  ).size;
  const avgPremium = orgCount > 0 ? totalPremium / orgCount : 0;

  return {
    totalPremium: Math.round(totalPremium * 100) / 100,
    totalPolicies,
    orgCount,
    salesmanCount,
    avgPremium: Math.round(avgPremium * 100) / 100,
  };
}

/**
 * 泛型表格排序
 *
 * - sort.column 为空 → 原样返回（不复制）
 * - 排序时返回新数组（不可变，不修改入参）
 * - null / undefined 统一排到一端（asc 在前、desc 在后）
 * - 数字按数值比较，其余按中文 localeCompare
 */
export function sortData<T extends Record<string, unknown>>(
  data: T[],
  sort: SortState
): T[] {
  if (!sort.column) return data;

  return [...data].sort((a, b) => {
    const aValue = a[sort.column];
    const bValue = b[sort.column];

    // 处理 null/undefined
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return sort.direction === 'asc' ? -1 : 1;
    if (bValue == null) return sort.direction === 'asc' ? 1 : -1;

    // 数字比较
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sort.direction === 'asc' ? aValue - bValue : bValue - aValue;
    }

    // 字符串比较
    const aStr = String(aValue);
    const bStr = String(bValue);
    return sort.direction === 'asc'
      ? aStr.localeCompare(bStr, 'zh-CN')
      : bStr.localeCompare(aStr, 'zh-CN');
  });
}

/**
 * 机构保费报表行：API 原始行 → 强类型行
 *
 * 数值字段经 `Number(x || 0)` 兜底，同比增长率保留 null（仅 `!= null` 时取数）。
 */
export function normalizeOrgReportRow(row: Record<string, unknown>): OrgPremiumReportRow {
  return {
    org_level_3: String(row.org_level_3 || ''),
    车险保费: Number(row['车险保费'] || 0),
    商业险保费: Number(row['商业险保费'] || 0),
    交强险保费: Number(row['交强险保费'] || 0),
    车险件数: Number(row['车险件数'] || 0),
    商业险件数: Number(row['商业险件数'] || 0),
    交强险件数: Number(row['交强险件数'] || 0),
    人均保费: Number(row['人均保费'] || 0),
    业务员数: Number(row['业务员数'] || 0),
    同比增长率: row['同比增长率'] != null ? Number(row['同比增长率']) : null,
  };
}

/**
 * 业务员保费报表行：API 原始行 → 强类型行
 *
 * salesman_name 经 formatSalesmanName 美化，raw_salesman_name 保留原值；
 * team_name 经 formatTeamName 美化。
 */
export function normalizeSalesmanReportRow(
  row: Record<string, unknown>
): SalesmanPremiumReportRow {
  return {
    salesman_name: formatSalesmanName(String(row.salesman_name || '')),
    raw_salesman_name: String(row.salesman_name || ''),
    org_level_3: String(row.org_level_3 || ''),
    team_name: formatTeamName(row.team_name as string),
    车险保费: Number(row['车险保费'] || 0),
    商业险保费: Number(row['商业险保费'] || 0),
    交强险保费: Number(row['交强险保费'] || 0),
    车险件数: Number(row['车险件数'] || 0),
    商业险件数: Number(row['商业险件数'] || 0),
    交强险件数: Number(row['交强险件数'] || 0),
    续保率: Number(row['续保率'] || 0),
    非过户率: Number(row['非过户率'] || 0),
  };
}
