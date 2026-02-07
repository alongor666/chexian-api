/**
 * 数据上下文构建器
 *
 * 从页面组件状态构建 AI 洞察所需的数据上下文
 * 确保只使用页面内已有数据，不发起额外查询
 */

import type { RenewalDataContext } from './types';

/**
 * KPI 数据类型（来自 RenewalDrilldownPanel）
 */
interface KPIData {
  dueCount: number;
  renewedCount: number;
  quotedCount: number;
  duePremium: number;
  renewedPremium: number;
  quotedPremium: number;
  renewalRate: number;
  quoteRate: number;
  conversionRate: number;
}

/**
 * 下钻行数据类型（来自 RenewalDrilldownPanel）
 */
interface DrilldownRow {
  groupName: string;
  parentName: string | null;
  levelType: string;
  dueCount: number;
  renewedCount: number;
  quotedCount: number;
  duePremium: number;
  renewedPremium: number;
  quotedPremium: number;
  renewalRate: number;
  quoteRate: number;
  renewalPremiumRate: number;
  quotePremiumRate: number;
  rankAsc: number;
  rankDesc: number;
}

/**
 * 筛选条件类型
 */
interface RenewalFilters {
  bundleOnly?: boolean;
  selfRenewalOnly?: boolean;
  dueMonth?: number | null;
  customerCategory?: string;
}

/**
 * 构建续保分析数据上下文
 *
 * 直接使用页面组件状态，不发起任何数据库查询
 *
 * @param kpiData - KPI 卡片数据
 * @param top20Data - Top20 业务员表格数据
 * @param filters - 当前筛选条件
 * @returns 续保数据上下文
 */
export function buildRenewalContext(
  kpiData: KPIData,
  top20Data: DrilldownRow[],
  filters?: RenewalFilters
): RenewalDataContext {
  return {
    type: 'renewal',
    kpi: {
      dueCount: kpiData.dueCount,
      renewedCount: kpiData.renewedCount,
      quotedCount: kpiData.quotedCount,
      duePremium: kpiData.duePremium,
      renewedPremium: kpiData.renewedPremium,
      quotedPremium: kpiData.quotedPremium,
      renewalRate: kpiData.renewalRate,
      quoteRate: kpiData.quoteRate,
      conversionRate: kpiData.conversionRate,
    },
    top20Salesmen: top20Data.map((row) => ({
      name: row.groupName,
      org: row.parentName || '',
      dueCount: row.dueCount,
      renewedCount: row.renewedCount,
      quotedCount: row.quotedCount,
      renewalRate: row.renewalRate,
      quoteRate: row.quoteRate,
      duePremium: row.duePremium,
      renewedPremium: row.renewedPremium,
    })),
    filters: filters
      ? {
          bundleOnly: filters.bundleOnly,
          selfRenewalOnly: filters.selfRenewalOnly,
          dueMonth: filters.dueMonth,
          customerCategory: filters.customerCategory,
        }
      : undefined,
  };
}

/**
 * 生成缓存 key
 *
 * 基于数据内容生成唯一标识，用于缓存管理
 *
 * @param context - 数据上下文
 * @returns 缓存 key 字符串
 */
export function generateCacheKey(context: RenewalDataContext): string {
  const keyParts = [
    context.type,
    context.kpi.dueCount,
    context.kpi.renewedCount,
    context.kpi.renewalRate.toFixed(4),
    context.top20Salesmen.length,
    context.top20Salesmen
      .slice(0, 5)
      .map((s) => `${s.name}:${s.dueCount}`)
      .join(','),
    context.filters?.bundleOnly ? 'bundle' : '',
    context.filters?.selfRenewalOnly ? 'self' : '',
    context.filters?.dueMonth?.toString() || '',
    context.filters?.customerCategory || '',
  ];

  return keyParts.filter(Boolean).join('|');
}

/**
 * 将上下文格式化为 AI 输入文本
 *
 * @param context - 数据上下文
 * @returns 格式化的文本
 */
export function formatContextForAI(context: RenewalDataContext): string {
  const lines: string[] = [];

  // 筛选条件说明
  if (context.filters) {
    const filterParts: string[] = [];
    if (context.filters.bundleOnly) filterParts.push('仅套单业务');
    if (context.filters.selfRenewalOnly) filterParts.push('仅自留续保');
    if (context.filters.dueMonth) filterParts.push(`${context.filters.dueMonth}月到期`);
    if (context.filters.customerCategory) filterParts.push(`客户类别: ${context.filters.customerCategory}`);
    if (filterParts.length > 0) {
      lines.push(`【筛选条件】${filterParts.join('、')}`);
      lines.push('');
    }
  }

  // KPI 指标
  lines.push('【整体 KPI】');
  lines.push(`应续件数: ${context.kpi.dueCount.toLocaleString()}`);
  lines.push(`已续件数: ${context.kpi.renewedCount.toLocaleString()}`);
  lines.push(`续保率: ${(context.kpi.renewalRate * 100).toFixed(1)}%`);
  lines.push(`有报价件数: ${context.kpi.quotedCount.toLocaleString()}`);
  lines.push(`报价率: ${(context.kpi.quoteRate * 100).toFixed(1)}%`);
  lines.push(`报价转化率: ${(context.kpi.conversionRate * 100).toFixed(1)}%`);
  lines.push(`应续保费: ${(context.kpi.duePremium / 10000).toFixed(2)}万元`);
  lines.push(`已续保费: ${(context.kpi.renewedPremium / 10000).toFixed(2)}万元`);
  lines.push('');

  // Top20 业务员明细
  lines.push('【应续件数 Top20 业务员】');
  lines.push('排名 | 业务员 | 机构 | 应续件数 | 已续件数 | 续保率 | 报价率');
  lines.push('--- | --- | --- | --- | --- | --- | ---');

  context.top20Salesmen.forEach((salesman, idx) => {
    lines.push(
      `${idx + 1} | ${salesman.name} | ${salesman.org} | ${salesman.dueCount} | ${salesman.renewedCount} | ${(salesman.renewalRate * 100).toFixed(1)}% | ${(salesman.quoteRate * 100).toFixed(1)}%`
    );
  });

  return lines.join('\n');
}
