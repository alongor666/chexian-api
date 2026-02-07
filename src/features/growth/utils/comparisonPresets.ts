/**
 * 对比分析预设日期计算工具
 *
 * 提供快捷对比场景的日期范围计算：
 * - YoY（同比）：本期 vs 去年同期
 * - MoM（环比-月）：本月 vs 上月
 * - WoW（环比-周）：本周 vs 上周
 * - Custom（自定义）：用户手动选择日期范围
 *
 * @module comparisonPresets
 * @author @claude
 * @since 2026-01-14
 */

/** 对比预设类型 */
export type ComparisonPreset = 'yoy' | 'mom' | 'wow' | 'custom';

/** 日期期间 */
export interface DatePeriod {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

/** 对比期间配置 */
export interface ComparisonPeriods {
  current: DatePeriod;   // 当期
  previous: DatePeriod;  // 基期
}

/** 预设配置 */
export interface PresetConfig {
  type: ComparisonPreset;
  label: string;
  shortLabel: string;
  description: string;
}

/** 预设配置列表 */
export const PRESET_CONFIGS: Record<ComparisonPreset, PresetConfig> = {
  yoy: {
    type: 'yoy',
    label: '同比',
    shortLabel: 'YoY',
    description: '本年至今 vs 去年同期'
  },
  mom: {
    type: 'mom',
    label: '环比(月)',
    shortLabel: 'MoM',
    description: '本月 vs 上月'
  },
  wow: {
    type: 'wow',
    label: '环比(周)',
    shortLabel: 'WoW',
    description: '本周 vs 上周'
  },
  custom: {
    type: 'custom',
    label: '自定义',
    shortLabel: '自定义',
    description: '手动选择对比期间'
  }
};

/**
 * 格式化日期为 YYYY-MM-DD 格式
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取某月的第一天
 */
function getFirstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * 获取某月的最后一天
 */
function getLastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * 获取某周的周一（周一为一周开始）
 */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 周日调整为-6
  return new Date(d.setDate(diff));
}

/**
 * 计算同比（YoY）期间
 *
 * 当期：今年1月1日 ~ 基准日期
 * 基期：去年1月1日 ~ 去年同日
 *
 * @param baseDate 基准日期，默认为数据最大日期（DC-002：从外部传入）
 */
export function calculateYoYPeriods(baseDate: string): ComparisonPeriods {
  const base = new Date(baseDate);
  const currentYear = base.getFullYear();
  const previousYear = currentYear - 1;

  // 当期：今年1月1日 ~ 基准日期
  const currentStart = `${currentYear}-01-01`;
  const currentEnd = formatDate(base);

  // 基期：去年1月1日 ~ 去年同日
  const previousStart = `${previousYear}-01-01`;
  // 处理闰年2月29日的情况
  const previousBase = new Date(previousYear, base.getMonth(), base.getDate());
  // 如果日期不存在（如2月29日在非闰年），取月末
  if (previousBase.getMonth() !== base.getMonth()) {
    previousBase.setDate(0); // 回到上月最后一天
  }
  const previousEnd = formatDate(previousBase);

  return {
    current: { startDate: currentStart, endDate: currentEnd },
    previous: { startDate: previousStart, endDate: previousEnd }
  };
}

/**
 * 计算环比-月（MoM）期间
 *
 * 当期：本月1日 ~ 基准日期
 * 基期：上月1日 ~ 上月对应日
 *
 * @param baseDate 基准日期，默认为数据最大日期（DC-002：从外部传入）
 */
export function calculateMoMPeriods(baseDate: string): ComparisonPeriods {
  const base = new Date(baseDate);

  // 当期：本月1日 ~ 基准日期
  const currentStart = formatDate(getFirstDayOfMonth(base));
  const currentEnd = formatDate(base);

  // 基期：上月1日 ~ 上月对应日
  const previousMonth = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const previousStart = formatDate(previousMonth);

  // 上月对应日（处理月末情况）
  const dayOfMonth = base.getDate();
  const lastDayOfPreviousMonth = getLastDayOfMonth(previousMonth).getDate();
  const previousDay = Math.min(dayOfMonth, lastDayOfPreviousMonth);
  const previousEndDate = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), previousDay);
  const previousEnd = formatDate(previousEndDate);

  return {
    current: { startDate: currentStart, endDate: currentEnd },
    previous: { startDate: previousStart, endDate: previousEnd }
  };
}

/**
 * 计算环比-周（WoW）期间
 *
 * 当期：本周一 ~ 基准日期
 * 基期：上周一 ~ 上周对应日
 *
 * @param baseDate 基准日期，默认为数据最大日期（DC-002：从外部传入）
 */
export function calculateWoWPeriods(baseDate: string): ComparisonPeriods {
  const base = new Date(baseDate);

  // 当期：本周一 ~ 基准日期
  const currentMonday = getMondayOfWeek(base);
  const currentStart = formatDate(currentMonday);
  const currentEnd = formatDate(base);

  // 基期：上周一 ~ 上周对应日
  const previousMonday = new Date(currentMonday);
  previousMonday.setDate(currentMonday.getDate() - 7);
  const previousStart = formatDate(previousMonday);

  // 上周对应日（与当期相同的星期几）
  const dayOffset = Math.floor((base.getTime() - currentMonday.getTime()) / (24 * 60 * 60 * 1000));
  const previousEndDate = new Date(previousMonday);
  previousEndDate.setDate(previousMonday.getDate() + dayOffset);
  const previousEnd = formatDate(previousEndDate);

  return {
    current: { startDate: currentStart, endDate: currentEnd },
    previous: { startDate: previousStart, endDate: previousEnd }
  };
}

/**
 * 根据预设类型计算对比期间
 *
 * @param preset 预设类型
 * @param baseDate 基准日期（DC-002：必须从外部传入，不可使用CURRENT_DATE）
 * @returns 对比期间配置，custom类型返回null
 */
export function calculatePresetPeriods(
  preset: ComparisonPreset,
  baseDate: string
): ComparisonPeriods | null {
  switch (preset) {
    case 'yoy':
      return calculateYoYPeriods(baseDate);
    case 'mom':
      return calculateMoMPeriods(baseDate);
    case 'wow':
      return calculateWoWPeriods(baseDate);
    case 'custom':
      return null; // 自定义模式由用户手动选择
    default:
      return null;
  }
}

/**
 * 获取预设的显示标签
 */
export function getPresetLabel(preset: ComparisonPreset): string {
  return PRESET_CONFIGS[preset]?.label ?? '未知';
}

/**
 * 获取预设的描述
 */
export function getPresetDescription(preset: ComparisonPreset): string {
  return PRESET_CONFIGS[preset]?.description ?? '';
}

/**
 * 格式化期间显示文本
 */
export function formatPeriodDisplay(period: DatePeriod): string {
  return `${period.startDate} ~ ${period.endDate}`;
}

/**
 * 计算期间天数
 */
export function calculatePeriodDays(period: DatePeriod): number {
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // 包含起止两天
}

/**
 * 验证两个期间是否天数相等（对比有效性检查）
 */
export function validatePeriodAlignment(periods: ComparisonPeriods): boolean {
  const currentDays = calculatePeriodDays(periods.current);
  const previousDays = calculatePeriodDays(periods.previous);
  return currentDays === previousDays;
}
