/**
 * 下钻维度规则中枢 — 集中管理所有板块的维度配置。
 *
 * 各板块只需引用此处配置，不硬编码维度列表。
 *
 * ─── 下钻原则（2026-04-17 收敛）───
 * 下钻维度仅保留"组织层级 + 客户类别"：
 *   - 业绩分析 / 续保分析：org_level_3 / team / salesman / customer_category
 *   - 驾意险：org_level_3 / team / salesman（数据已锁客车，无需客户类别）
 * 业务属性（新车/过户/新能源/电销/续保/风险等级）、险别组合、吨位分段
 * 统一降级为顶部快捷筛选，不再进入 drillPath。
 * 团队与业务员合并为同一下钻层，前端树形折叠/展开展示。
 */

// ─── 维度类型定义 ────────────────────────────────────────────────────────────

/** 业绩分析支持的下钻维度 */
export type PerformanceDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category';

/** 驾意险支持的下钻维度（数据已锁客车，无客户类别层） */
export type CrossSellDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman';

/** 续保分析层级（线性，顺序固定 — V1 兼容） */
export type RenewalDrillLevel = 'company' | 'org' | 'team' | 'salesman';

/** 续保分析自由维度（V2） */
export type RenewalDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category';

// ─── 维度中文标签 ────────────────────────────────────────────────────────────

/**
 * 维度中文标签（full map — 含非下钻维度，便于快捷筛选/导出/BI 复用）。
 * 类型上已将非下钻维度移出 drill 联合类型，但标签映射保留向后兼容。
 */
export const DIMENSION_LABELS: Record<string, string> = {
  org_level_3: '三级机构',
  team: '销售团队',
  salesman: '业务员',
  customer_category: '客户类别',
  tonnage_segment: '吨位分段',
  is_new_car: '是否新车',
  is_transfer: '是否过户',
  is_nev: '是否新能源',
  is_telemarketing: '是否电销',
  is_renewal: '是否续保',
  insurance_grade: '车险风险等级',
  coverage_combination: '险别组合',
};

// ─── 条件维度规则 ────────────────────────────────────────────────────────────

export interface ConditionalDimensionRule {
  /** 前置条件：下钻路径中某个维度的值等于指定值 */
  when: { dimension: string; value: string };
  /** 满足条件时额外可用的维度 */
  addDimensions: string[];
}

/**
 * 全局条件维度规则。
 * 2026-04-17 收敛后置空：风险等级等业务属性已归为筛选，不再作为条件维度。
 */
export const CONDITIONAL_DIMENSION_RULES: ConditionalDimensionRule[] = [];

// ─── 板块维度配置 ────────────────────────────────────────────────────────────

/** 业绩分析 — 自由维度下钻 */
export const PERFORMANCE_DIMENSIONS: PerformanceDrillDimension[] = [
  'org_level_3',
  'team',
  'salesman',
  'customer_category',
];

/** 驾意险 — 自由维度下钻（数据锁客车，无客户类别层） */
export const CROSS_SELL_DIMENSIONS: CrossSellDrillDimension[] = [
  'org_level_3',
  'team',
  'salesman',
];

/** 续保分析 — 线性层级（V1 兼容，去掉 'coverage' 层） */
export const RENEWAL_LEVEL_ORDER: RenewalDrillLevel[] = [
  'company',
  'org',
  'team',
  'salesman',
];

export const RENEWAL_LEVEL_LABELS: Record<RenewalDrillLevel, string> = {
  company: '四川分公司',
  org: '三级机构',
  team: '销售团队',
  salesman: '业务员',
};

/** 续保分析 — 自由维度下钻（V2） */
export const RENEWAL_DIMENSIONS: RenewalDrillDimension[] = [
  'org_level_3',
  'team',
  'salesman',
  'customer_category',
];

/** 假日营销 — 2层线性（机构→业务员；暂未合并 team 层，下次迭代） */
export const HOLIDAY_LEVEL_ORDER = ['org', 'salesman'] as const;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 根据下钻路径，计算当前激活的条件维度。
 * 2026-04-17 收敛后 CONDITIONAL_DIMENSION_RULES 为空，恒返回空数组；
 * 保留函数签名避免消费方破坏。
 */
export function getConditionalDimensions(
  drillPath: { dimension: string; value: string }[],
): string[] {
  const extras: string[] = [];

  for (const rule of CONDITIONAL_DIMENSION_RULES) {
    const match = drillPath.find(
      (step) =>
        step.dimension === rule.when.dimension &&
        step.value === rule.when.value,
    );
    if (match) {
      extras.push(...rule.addDimensions);
    }
  }

  return extras;
}

/**
 * 判断某个维度是否属于条件维度。
 * 2026-04-17 收敛后恒返回 false；保留以避免消费方破坏。
 */
export function isConditionalDimension(dimension: string): boolean {
  return CONDITIONAL_DIMENSION_RULES.some((rule) =>
    rule.addDimensions.includes(dimension),
  );
}
