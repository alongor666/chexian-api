/**
 * 保费达成下钻纯逻辑工具
 *
 * 从 usePremiumPlan Hook 提取的与 React 无关的纯函数，便于直接单测：
 * - LEVEL_ORDER / LEVEL_LABELS：下钻层级顺序与中文标签
 * - buildFiltersFromPath：面包屑路径 → API 筛选参数
 * - computeDrillDownTarget：当前层级 → 下钻目标层级（含到底层返回 null）
 * - computeDrillUpDisplayLevel：父层级 → 上钻后展示层级（含顶 / 底钳位）
 * - makeDrillStepLabel：构建面包屑步骤标签（业务员名美化）
 *
 * 行为与原 Hook 内联实现逐字段一致（golden 不变）。
 */

import { formatSalesmanName } from '../../../shared/utils/formatters';
import { DIMENSION_LABELS } from '../../../shared/config/drilldown-dimensions';
import type { PlanDrilldownLevel, DrillPathStep } from '../types/premiumReport';

/** 下钻层级顺序 */
export const LEVEL_ORDER: PlanDrilldownLevel[] = [
  'company', 'org', 'team', 'salesman', 'customer_category', 'coverage',
];

/**
 * 层级中文标签。
 * org/team/salesman/customer_category 派生自 SSOT drilldown-dimensions（DIMENSION_LABELS），
 * 杜绝 team 文案漂移；company（分公司整体）与 coverage（险别）为本下钻链专属层级，SSOT 无对应键，保留字面量。
 */
export const LEVEL_LABELS: Record<PlanDrilldownLevel, string> = {
  company: '分公司整体',
  org: DIMENSION_LABELS.org_level_3,
  team: DIMENSION_LABELS.team,
  salesman: DIMENSION_LABELS.salesman,
  customer_category: DIMENSION_LABELS.customer_category,
  coverage: '险别',
};

/**
 * 从面包屑路径构建 API 筛选参数
 *
 * - 跳过无 value 的步骤（如顶层「分公司整体」）
 * - 仅 org / team / salesman / customer_category 映射为筛选键，其余层级忽略
 */
export function buildFiltersFromPath(path: DrillPathStep[]): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const step of path) {
    if (step.value === undefined) continue;
    switch (step.level) {
      case 'org':
        filters.orgFilter = step.value;
        break;
      case 'team':
        filters.teamFilter = step.value;
        break;
      case 'salesman':
        filters.salesmanFilter = step.value;
        break;
      case 'customer_category':
        filters.customerCategoryFilter = step.value;
        break;
    }
  }
  return filters;
}

/**
 * 计算下钻目标层级
 *
 * 当前显示的数据层级 = currentLevel 的下一层（currentIdx+1）；
 * 点击某行后再下钻一层 → 目标数据层级 = currentIdx+2，新面包屑步骤层级 = currentIdx+1。
 * 已到最底层（currentIdx+2 越界）返回 null。
 */
export function computeDrillDownTarget(
  currentLevel: PlanDrilldownLevel
): { nextLevel: PlanDrilldownLevel; filterLevel: PlanDrilldownLevel } | null {
  const currentIdx = LEVEL_ORDER.indexOf(currentLevel);
  const nextIdx = currentIdx + 2;
  if (nextIdx >= LEVEL_ORDER.length) return null; // 已到最底层

  return {
    nextLevel: LEVEL_ORDER[nextIdx],
    filterLevel: LEVEL_ORDER[currentIdx + 1],
  };
}

/**
 * 计算上钻后展示层级
 *
 * 上钻后展示的层级 = 新路径最后一步层级的下一层（parentIdx+1），
 * 钳制在 LEVEL_ORDER 末尾以内。
 */
export function computeDrillUpDisplayLevel(
  parentLevel: PlanDrilldownLevel
): PlanDrilldownLevel {
  const parentIdx = LEVEL_ORDER.indexOf(parentLevel);
  return LEVEL_ORDER[Math.min(parentIdx + 1, LEVEL_ORDER.length - 1)];
}

/**
 * 构建面包屑步骤标签
 *
 * 业务员层级对名称做 formatSalesmanName 美化，其余层级直接用原值。
 */
export function makeDrillStepLabel(
  filterLevel: PlanDrilldownLevel,
  groupName: string
): string {
  return `${LEVEL_LABELS[filterLevel]}: ${filterLevel === 'salesman' ? formatSalesmanName(groupName) : groupName}`;
}
