/**
 * 下钻维度规则中枢 — 集中管理所有板块的维度配置。
 *
 * 各板块只需引用此处配置，不硬编码维度列表。
 */

// ─── 维度类型定义 ────────────────────────────────────────────────────────────

/** 业绩分析支持的维度（含条件维度 insurance_grade） */
export type PerformanceDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'customer_category'
  | 'tonnage_segment'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal'
  | 'insurance_grade';

/** 驾意险支持的维度（insurance_grade 待后端 SQL 支持后添加） */
export type CrossSellDrillDimension =
  | 'org_level_3'
  | 'team'
  | 'salesman'
  | 'is_new_car'
  | 'is_transfer'
  | 'is_nev'
  | 'is_telemarketing'
  | 'is_renewal';

/** 续保分析层级（线性，顺序固定） */
export type RenewalDrillLevel = 'company' | 'org' | 'team' | 'salesman' | 'coverage';

// ─── 维度中文标签 ────────────────────────────────────────────────────────────

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

/** 全局条件维度规则 */
export const CONDITIONAL_DIMENSION_RULES: ConditionalDimensionRule[] = [
  {
    when: { dimension: 'customer_category', value: '非营业客车' },
    addDimensions: ['insurance_grade'],
  },
  // 吨位分段由 computeAvailableDimensions 内部逻辑控制（仅货车可用）
];

// ─── 板块维度配置 ────────────────────────────────────────────────────────────

/** 业绩分析 — 自由维度下钻 */
export const PERFORMANCE_DIMENSIONS: PerformanceDrillDimension[] = [
  'org_level_3',
  'team',
  'salesman',
  'customer_category',
  'tonnage_segment',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
  'is_renewal',
  // insurance_grade 为条件维度，由规则动态注入
];

/** 驾意险 — 自由维度下钻（口径为非营业客车） */
export const CROSS_SELL_DIMENSIONS: CrossSellDrillDimension[] = [
  'org_level_3',
  'team',
  'salesman',
  'is_new_car',
  'is_transfer',
  'is_nev',
  'is_telemarketing',
  'is_renewal',
];

/** 续保分析 — 线性5层下钻，每层只有1个下一维度 */
export const RENEWAL_LEVEL_ORDER: RenewalDrillLevel[] = [
  'company',
  'org',
  'team',
  'salesman',
  'coverage',
];

export const RENEWAL_LEVEL_LABELS: Record<RenewalDrillLevel, string> = {
  company: '四川分公司',
  org: '三级机构',
  team: '销售团队',
  salesman: '业务员',
  coverage: '险别组合',
};

/** 假日营销 — 2层线性 */
export const HOLIDAY_LEVEL_ORDER = ['org', 'salesman'] as const;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 根据下钻路径，计算当前激活的条件维度。
 * 返回满足条件的额外维度 key 列表。
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
 * 判断某个维度是否属于条件维度（如 insurance_grade）。
 * Phase 2+ 板块改造时使用：传入 DrilldownCell.conditionalDimensions 以琥珀色胶囊标记。
 */
export function isConditionalDimension(dimension: string): boolean {
  return CONDITIONAL_DIMENSION_RULES.some((rule) =>
    rule.addDimensions.includes(dimension),
  );
}
