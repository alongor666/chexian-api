/**
 * 筛选器字段可见性配置
 *
 * 用于解决 UI展示 ≠ 实际可用 ≠ 代码行为 的不一致问题
 * 核心原则：UI显示 = 代码支持，不显示不支持的筛选项
 *
 * @see B079 - 筛选器UI/代码一致性重构
 */

/**
 * 日期口径类型（与 data.ts 中的 DateCriteria 一致）
 */
export type DateCriteriaType = 'policy_date' | 'insurance_start_date';

/**
 * 允许的分析年度范围
 */
export type AllowedYearsRange = 'currentOnly' | 'currentAndPrevious' | 'allAvailable';

/**
 * 筛选器字段配置接口
 * 控制哪些筛选字段在特定页面/场景下可见
 */
export interface FilterFieldsConfig {
  // 日期相关
  /** 日期口径选择器（签单日期/起保日期） */
  dateCriteria?: boolean;
  /** 锁定日期口径到指定值（设置后选择器变为只读显示） */
  lockedDateCriteria?: DateCriteriaType;
  /** 分析年度选择器 */
  analysisYear?: boolean;
  /** 允许的分析年度范围（默认 currentAndPrevious） */
  allowedYears?: AllowedYearsRange;
  /** 日期范围选择器 */
  dateRange?: boolean;

  // 维度筛选
  /** 三级机构 */
  organization?: boolean;
  /** 业务员 */
  salesman?: boolean;
  /** 客户类别 */
  customerCategory?: boolean;
  /** 险别组合 */
  coverageCombination?: boolean;
  /** 续保模式 */
  renewalMode?: boolean;

  // 高级选项
  /** 基本选项（is_nev、is_new_car 等布尔切换） */
  basicOptions?: boolean;
  /** 快捷组合（转保、可续等预设场景） */
  quickCombos?: boolean;
}

/**
 * 筛选器选择模式配置
 * 用于控制多选/单选行为
 */
export interface FilterSelectionModeConfig {
  /** 机构选择模式（默认multi） */
  organizationMode?: 'single' | 'multi';
  /** 业务员选择模式（默认multi） */
  salesmanMode?: 'single' | 'multi';
}

/**
 * 完整的筛选器配置
 */
export interface FilterConfig extends FilterFieldsConfig, FilterSelectionModeConfig { }

/**
 * 预设配置名称
 */
export type FilterPresetName =
  | 'full'
  | 'performance'
  | 'growth'
  | 'renewal'
  | 'renewalDetail'
  | 'coefficient'
  | 'report'
  | 'cost'
  | 'claimsDetail'
  | 'costEarned';

/**
 * 预设配置对象
 *
 * 各页面根据实际代码支持情况选择合适的预设
 * 避免 UI 显示但代码不支持的字段
 */
export const FILTER_PRESETS: Record<FilterPresetName, FilterConfig> = {
  /**
   * 完整筛选器（Dashboard、营业货车、数据对比、SQL查询）
   * 所有字段都显示，口径可选，年度：当年和上一年
   */
  full: {
    dateCriteria: true,
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: true,
    organization: true,
    salesman: true,
    customerCategory: true,
    coverageCombination: true,
    renewalMode: true,
    basicOptions: true,
    quickCombos: true,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 业绩分析预设
   * - 客户类别由页面标签控制，筛选器中隐藏
   */
  performance: {
    dateCriteria: true,
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: true,
    organization: true,
    salesman: true,
    customerCategory: false,
    coverageCombination: true,
    renewalMode: true,
    basicOptions: true,
    quickCombos: true,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 增长分析预设
   * - 日期口径：可选（签单日期/起保日期）
   * - 分析年度：当年和上一年
   * - 日期范围：不显示（代码强制全年）
   * - 机构/业务员：单选（代码只取第一个）
   * - 客户类别/险别组合/续保模式：不显示（代码忽略）
   */
  growth: {
    dateCriteria: true,
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: false, // 代码强制全年
    organization: true, // 改为单选
    salesman: true, // 改为单选
    customerCategory: false, // 代码忽略
    coverageCombination: false, // 代码忽略
    renewalMode: false, // 代码忽略
    basicOptions: false, // 代码忽略
    quickCombos: false,
    organizationMode: 'single', // 代码只取第一个
    salesmanMode: 'single', // 代码只取第一个
  },

  /**
   * 续保分析预设（续保下钻页面）
   * - 日期口径：锁定为起保日期（insurance_start_date）
   * - 分析年度：当年和上一年
   * - 日期范围：不显示（强制全年）
   * - 客户类别/险别组合/续保模式：不显示（代码忽略）
   */
  renewal: {
    dateCriteria: true, // 显示但锁定
    lockedDateCriteria: 'insurance_start_date', // 锁定为起保日期
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: false, // 强制全年
    organization: true,
    salesman: true,
    customerCategory: false, // 代码忽略
    coverageCombination: false, // 代码忽略
    renewalMode: false, // 代码忽略
    basicOptions: false,
    quickCombos: false,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 续保明细表预设（续保明细页面）
   * - 日期口径：锁定为起保日期（insurance_start_date）
   * - 分析年度：锁定为2026（在RenewalPage.tsx中通过detailFilters锁定）
   * - 日期范围：不显示（续保明细不支持日期范围）
   * - 支持完整筛选器：机构、业务员、客户类别、险别组合、续保模式
   */
  renewalDetail: {
    dateCriteria: true, // 显示但锁定
    lockedDateCriteria: 'insurance_start_date', // 锁定为起保日期
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: false, // 不支持日期范围
    organization: true,
    salesman: true,
    customerCategory: true, // 支持客户类别筛选
    coverageCombination: true, // 支持险别组合筛选
    renewalMode: true, // 支持续保模式筛选
    basicOptions: true, // 支持基本选项
    quickCombos: true, // 支持快捷组合
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 系数监控预设
   * - 日期口径：锁定为签单日期（policy_date）
   * - 分析年度：仅当年
   * - 日期范围起始：不显示（完全忽略）
   * - 机构/业务员：不显示（完全忽略）
   * 注意：截止日期使用独立选择器
   */
  coefficient: {
    dateCriteria: true, // 显示但锁定
    lockedDateCriteria: 'policy_date', // 锁定为签单日期
    allowedYears: 'currentOnly', // 仅当年
    analysisYear: true,
    dateRange: false, // 使用独立的截止日期选择器
    organization: false, // 代码忽略
    salesman: false, // 代码忽略
    customerCategory: false,
    coverageCombination: false,
    renewalMode: false,
    basicOptions: false,
    quickCombos: false,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 保费报表预设
   * - 日期口径：可选（签单日期/起保日期）
   * - 分析年度：当年和上一年
   * - 业务员：不显示（报表不支持）
   * - 客户类别/险别组合：不显示（报表不支持）
   */
  report: {
    dateCriteria: true,
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: true,
    organization: true,
    salesman: false, // 报表不支持业务员筛选
    customerCategory: true,
    coverageCombination: true,
    renewalMode: false,
    basicOptions: true,
    quickCombos: false,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 成本分析预设
   * - 日期口径：锁定为起保日期（insurance_start_date）
   * - 分析年度：当年和上一年
   * - 业务员：不显示
   * - 客户类别/险别组合：不显示
   */
  cost: {
    dateCriteria: true, // 显示但锁定
    lockedDateCriteria: 'insurance_start_date', // 锁定为起保日期
    allowedYears: 'allAvailable',
    analysisYear: true,
    dateRange: true,
    organization: true,
    salesman: false,
    customerCategory: true,
    coverageCombination: true,
    renewalMode: false,
    basicOptions: true,
    quickCombos: false,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 赔案明细预设
   * - 常驻筛选区全部隐藏（由页面内快捷组合接管）
   * - 保留高级筛选抽屉
   */
  claimsDetail: {
    dateCriteria: false,
    analysisYear: false,
    dateRange: false,
    organization: false,
    salesman: false,
    customerCategory: false,
    coverageCombination: false,
    renewalMode: false,
    basicOptions: false,
    quickCombos: false,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },

  /**
   * 成本分析-已赚保费预设
   * 特殊：使用36个月滚动窗口，全局筛选器隐藏
   */
  costEarned: {
    dateCriteria: false,
    analysisYear: false,
    dateRange: false,
    organization: false,
    salesman: false,
    customerCategory: false,
    coverageCombination: false,
    renewalMode: false,
    basicOptions: false,
    quickCombos: false,
    organizationMode: 'multi',
    salesmanMode: 'multi',
  },
};

/**
 * 获取预设配置
 * @param preset 预设名称
 * @returns 筛选器配置
 */
export const getFilterPreset = (preset: FilterPresetName): FilterConfig => {
  return FILTER_PRESETS[preset];
};

/**
 * 合并自定义配置和预设配置
 * @param preset 预设名称
 * @param overrides 覆盖配置
 * @returns 合并后的配置
 */
export const mergeFilterConfig = (
  preset: FilterPresetName,
  overrides?: Partial<FilterConfig>
): FilterConfig => {
  return {
    ...FILTER_PRESETS[preset],
    ...overrides,
  };
};
