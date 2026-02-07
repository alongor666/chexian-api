/**
 * 商车自主定价系数监管阈值配置
 *
 * 业务规则来源：用户提供的监管要求
 *
 * 阈值规则说明：
 * - 'gte' (≥)：实际系数应不低于阈值，低于阈值为不合规
 * - 'lte' (≤)：实际系数应不高于阈值，高于阈值为不合规
 */

// 地域类型
export type RegionType = 'chengdu' | 'province' | 'remote';

// 客户类别类型
export type CustomerCategoryType = 'non_commercial_personal' | 'all';

// 阈值方向类型
export type ThresholdDirection = 'gte' | 'lte';

// 阈值规则接口
export interface ThresholdRule {
  /** 地域：成都/全省/异地 */
  region: RegionType;
  /** 是否新能源，null表示不限 */
  nev: boolean | null;
  /** 客户类别 */
  customerCategory: CustomerCategoryType;
  /** 是否新车，null表示不限 */
  newCar: boolean | null;
  /** 阈值数值 */
  threshold: number;
  /** 阈值方向：≥ 或 ≤ */
  direction: ThresholdDirection;
  /** 规则描述（用于展示） */
  description: string;
  /** 优先级（数字越小优先级越高） */
  priority: number;
}

// 阈值匹配参数
export interface ThresholdMatchParams {
  region: RegionType;
  nev: boolean;
  customerCategory: CustomerCategoryType;
  newCar: boolean | null;
}

/**
 * 监管阈值规则表
 *
 * 成都地区规则：
 * - 燃油非营业个人客车旧车：≥ 0.785
 * - 新能源非营业个人旧车：≥ 0.91
 *
 * 全省规则：
 * - 燃油非营业个人客车整体：≥ 0.835
 * - 燃油非营业个人客车新车：≤ 0.91
 * - 燃油商业险整体：≥ 0.86
 * - 新能源非营业个人客车新车：≤ 1.1
 * - 新能源商业险整体：≥ 1.02
 *
 * 异地规则：待补充
 */
export const THRESHOLD_RULES: ThresholdRule[] = [
  // ========== 成都地区规则 ==========
  {
    region: 'chengdu',
    nev: false,
    customerCategory: 'non_commercial_personal',
    newCar: false,
    threshold: 0.785,
    direction: 'gte',
    description: '成都燃油非营业个人客车旧车',
    priority: 1,
  },
  {
    region: 'chengdu',
    nev: true,
    customerCategory: 'non_commercial_personal',
    newCar: false,
    threshold: 0.91,
    direction: 'gte',
    description: '成都新能源非营业个人旧车',
    priority: 2,
  },

  // ========== 全省规则 ==========
  // 燃油车规则
  {
    region: 'province',
    nev: false,
    customerCategory: 'non_commercial_personal',
    newCar: true,
    threshold: 0.91,
    direction: 'lte',
    description: '全省燃油非营业个人客车新车',
    priority: 10,
  },
  {
    region: 'province',
    nev: false,
    customerCategory: 'non_commercial_personal',
    newCar: null,  // 不限新旧
    threshold: 0.835,
    direction: 'gte',
    description: '全省燃油非营业个人客车整体',
    priority: 11,
  },
  {
    region: 'province',
    nev: false,
    customerCategory: 'all',
    newCar: null,
    threshold: 0.86,
    direction: 'gte',
    description: '全省燃油商业险整体',
    priority: 12,
  },

  // 新能源规则
  {
    region: 'province',
    nev: true,
    customerCategory: 'non_commercial_personal',
    newCar: true,
    threshold: 1.1,
    direction: 'lte',
    description: '全省新能源非营业个人客车新车',
    priority: 20,
  },
  {
    region: 'province',
    nev: true,
    customerCategory: 'all',
    newCar: null,
    threshold: 1.02,
    direction: 'gte',
    description: '全省新能源商业险整体',
    priority: 21,
  },

  // ========== 异地规则（待补充） ==========
  // 暂时使用全省规则作为默认
];

/**
 * 机构分组配置
 */
export const ORG_GROUPS = {
  /** 同城机构（成都） */
  SAME_CITY: ['天府', '高新', '新都', '青羊', '武侯', '重客', '本部'],
  /** 异地机构（中支） */
  REMOTE: ['宜宾', '德阳', '资阳', '泸州', '自贡', '乐山', '达州'],
} as const;

/**
 * 判断机构所属地域
 */
export function getOrgRegion(orgName: string): RegionType {
  // 检查是否属于同城
  if (ORG_GROUPS.SAME_CITY.some(city => orgName.includes(city))) {
    return 'chengdu';
  }
  // 检查是否属于异地
  if (ORG_GROUPS.REMOTE.some(city => orgName.includes(city))) {
    return 'remote';
  }
  // 默认归为成都
  return 'chengdu';
}

/**
 * 获取适用的阈值规则
 *
 * 匹配逻辑：
 * 1. 按优先级排序
 * 2. 精确匹配所有非null条件
 * 3. null条件表示"不限"，自动匹配
 * 4. 返回第一个匹配的规则
 *
 * @param params 匹配参数
 * @returns 匹配的阈值规则，如果没有匹配返回null
 */
export function getThresholdRule(params: ThresholdMatchParams): ThresholdRule | null {
  // 按优先级排序
  const sortedRules = [...THRESHOLD_RULES].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    // 检查地域匹配
    // 成都规则只适用于成都
    if (rule.region === 'chengdu' && params.region !== 'chengdu') {
      continue;
    }

    // 异地规则只适用于异地（如果有专门规则的话）
    if (rule.region === 'remote' && params.region !== 'remote') {
      continue;
    }

    // 全省规则适用于所有地域（除非有更具体的规则）
    if (rule.region === 'province' && params.region === 'chengdu') {
      // 检查是否有成都专用规则匹配
      const chengduRule = sortedRules.find(r =>
        r.region === 'chengdu' &&
        (r.nev === null || r.nev === params.nev) &&
        (r.customerCategory === params.customerCategory) &&
        (params.newCar === null ? r.newCar === null : r.newCar === null || r.newCar === params.newCar)
      );
      if (chengduRule) {
        continue; // 跳过全省规则，使用成都规则
      }
    }

    // 检查是否新能源
    if (rule.nev !== null && rule.nev !== params.nev) {
      continue;
    }

    // 检查客户类别
    if (rule.customerCategory !== params.customerCategory) {
      continue;
    }

    // 检查是否新车
    if (params.newCar === null) {
      if (rule.newCar !== null) {
        continue;
      }
    } else if (rule.newCar !== null && rule.newCar !== params.newCar) {
      continue;
    }

    // 所有条件匹配
    return rule;
  }

  return null;
}

/**
 * 检查系数是否合规
 *
 * @param actualFactor 实际系数
 * @param rule 阈值规则
 * @returns 是否合规
 */
export function isCompliant(actualFactor: number, rule: ThresholdRule): boolean {
  if (rule.direction === 'gte') {
    return actualFactor >= rule.threshold;
  } else {
    return actualFactor <= rule.threshold;
  }
}

/**
 * 格式化阈值显示
 *
 * @param rule 阈值规则
 * @returns 格式化的字符串，如 "≥0.785"
 */
export function formatThreshold(rule: ThresholdRule): string {
  const symbol = rule.direction === 'gte' ? '≥' : '≤';
  return `${symbol}${rule.threshold}`;
}

/**
 * 计算当周与阈值差值
 *
 * @param weeklyFactor 当周系数
 * @param rule 阈值规则
 * @returns 差值（当周系数 - 监管阈值）
 *   - 正值：系数高于阈值
 *   - 负值：系数低于阈值
 */
export function calculateThresholdRatio(weeklyFactor: number, rule: ThresholdRule): number {
  return weeklyFactor - rule.threshold;
}

/**
 * 计算缺口保费
 *
 * 公式：(监管阈值 - 当周系数) × 当周保费
 *
 * @param weeklyFactor 当周系数
 * @param weeklyPremium 当周保费
 * @param rule 阈值规则
 * @returns 缺口保费
 *   - 正值：系数低于阈值，存在缺口
 *   - 负值：系数高于阈值，无缺口（盈余）
 */
export function calculateGapPremium(
  weeklyFactor: number,
  weeklyPremium: number,
  rule: ThresholdRule
): number {
  return (rule.threshold - weeklyFactor) * weeklyPremium;
}

/**
 * 客户类别显示名称映射
 */
export const CUSTOMER_CATEGORY_LABELS: Record<string, string> = {
  non_commercial_personal: '非营业个人客车',
  all: '全部',
};
