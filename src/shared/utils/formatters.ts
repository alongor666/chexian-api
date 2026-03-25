/**
 * 统一格式化工具
 * Common Formatting Utilities
 *
 * 提供统一的数字、金额、百分比格式化方法
 *
 * 全局格式化规范（2026-01-19）：
 * - 件数：整数，千分位 → formatCount
 * - 均值：1位小数，千分位 → formatAverage
 * - 比率/百分比：1位小数，带% → formatPercent
 * - 保费：万元为单位，整数 → formatPremiumWan
 * - 自主系数：4位小数 → formatCoefficient
 * - 图表Y轴：纯数字，无单位 → formatChartValue
 */

/**
 * 将 bigint 转换为 number
 */
const toNumber = (value: number | bigint): number =>
  typeof value === 'bigint' ? Number(value) : value;

// ==================== 全局统一格式化函数（推荐使用） ====================

/**
 * 格式化件数（整数，千分位）
 * @example formatCount(1234) => "1,234"
 */
export const formatCount = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  return Math.round(numValue).toLocaleString('zh-CN');
};

/**
 * 格式化均值（1位小数，千分位）
 * @example formatAverage(1234.56) => "1,234.6"
 */
export const formatAverage = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  return numValue.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
};

/**
 * 格式化保费（万元为单位，整数，千分位，不显示单位）
 * @example formatPremiumWan(12345678) => "1,235"
 */
export const formatPremiumWan = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  const inWan = Math.round(numValue / 10000);
  return inWan.toLocaleString('zh-CN');
};

/**
 * 格式化驾意险保费（万元为单位，>=1万保留1位小数，<1万保留2位小数，不显示单位）
 * @example formatDriverPremiumWan(15000) => "1.5"
 * @example formatDriverPremiumWan(5000) => "0.50"
 */
export const formatDriverPremiumWan = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  const inWan = numValue / 10000;
  if (Math.abs(inWan) < 1) {
    return inWan.toFixed(2);
  }
  return inWan.toFixed(1);
};

/**
 * 格式化“已是万元单位”的保费（整数，千分位）
 * @example formatWanDirect(1234.56) => "1,235"
 */
export const formatWanDirect = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  return Math.round(numValue).toLocaleString('zh-CN');
};

/**
 * 格式化“已是万元单位”的保费（>=1 保留1位，<1 保留2位，不显示单位）
 * @example formatWanAdaptive(1.28) => "1.3"
 * @example formatWanAdaptive(0.58) => "0.58"
 */
export const formatWanAdaptive = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  if (Math.abs(numValue) < 1) {
    return numValue.toFixed(2);
  }
  return numValue.toFixed(1);
};

/**
 * 格式化图表Y轴数值（纯数字，无单位，用于图表标签）
 * @example formatChartValue(12345678) => "1235" (万元)
 */
export const formatChartValue = (value: number | bigint | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  // 转为万元，整数，不带千分位（图表标签更紧凑）
  return String(Math.round(numValue / 10000));
};

/**
 * 格式化自主系数（4位小数）
 * @example formatCoefficient(0.85234) => "0.8523"
 */
export const formatCoefficient = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  if (!Number.isFinite(value)) return '-';
  return value.toFixed(4);
};

// ==================== 兼容旧代码的格式化函数 ====================

/**
 * 格式化保费（折算为万元，保留1位小数，不显示单位）
 * @deprecated 请使用 formatPremiumWan（整数）
 * @example formatPremium(123456) => "12.3"
 */
export const formatPremium = (value: number | bigint): string => {
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  const inWan = numValue / 10000;
  return inWan.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
};

/**
 * 格式化率值/占比（百分比，保留1位小数）
 * @example formatRate(0.156) => "15.6%"
 * @example formatRate(15.6) => "15.6%" (自动检测已是百分比形式)
 */
export const formatRate = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  // 如果值大于1，认为已经是百分比形式（如15.6表示15.6%）
  const ratio = Math.abs(value) > 1 ? value / 100 : value;
  return `${(ratio * 100).toFixed(1)}%`;
};

/**
 * 格式化数字（整数，千分位）
 * @deprecated 请使用 formatCount
 */
export const formatNumber = (value: number | bigint): string => {
  const numValue = toNumber(value);
  if (!Number.isFinite(numValue)) return '-';
  return Math.round(numValue).toLocaleString();
};

/**
 * Y轴保费格式化器（图表专用，无单位）
 */
export const yAxisPremiumFormatter = (value: number): string => formatChartValue(value);

// ==================== 成本分析专用格式化函数 ====================

/**
 * 格式化金额（保留2位小数，千分位）
 * 用于成本分析表格
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 格式化百分比（默认保留1位小数）
 * 用于成本分析比率显示
 */
export function formatPercent(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(decimals)}%`;
}

/**
 * 格式化天数（保留1位小数）
 * 用于满期天数显示
 */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}天`;
}

/**
 * 格式化达成率（小数形式，保留1位小数）
 * 与 formatRate 的区别：不会错误地把 >1 的值当作已是百分比
 *
 * @example formatAchievementRate(1.115) => "111.5%"
 * @example formatAchievementRate(0.85) => "85.0%"
 * @example formatAchievementRate(0.012) => "1.2%"
 */
export function formatAchievementRate(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(decimals)}%`;
}

// ==================== 业务字段专用格式化函数 ====================

/**
 * 格式化业务员名称（全局规则）
 * - 仅保留中文姓名
 * - 去掉数字、英文 ID、符号
 * - 若为 admin（不区分大小写），统一显示为“直接个代”
 *
 * @example formatSalesmanName("210000461周鑫磊") => "周鑫磊"
 * @example formatSalesmanName("admin") => "直接个代"
 * @example formatSalesmanName("A1001王五") => "王五"
 */
export function formatSalesmanName(name: string | null | undefined): string {
  if (name == null) return '-';

  const raw = String(name).trim();
  if (!raw) return '-';

  if (/admin/i.test(raw)) {
    return '直接个代';
  }

  const hanParts = raw.match(/[\u3400-\u4DBF\u4E00-\u9FFF]+/g);
  if (!hanParts || hanParts.length === 0) {
    return '-';
  }

  return hanParts.join('');
}

// ==================== 团队名简称 ====================

/**
 * 团队名称缩写（通用规则）
 * - "XX业务N部" → "XXN部"（如 "天府业务二部" → "天府二部"）
 * - "XX业务团队" → "XX"（如 "温江业务团队" → "温江"）
 * - "非车险业务部" → "非车险"
 * - 其他原样返回
 */
export function formatTeamName(name: string | null | undefined): string {
  if (name == null) return '-';
  const raw = String(name).trim();
  if (!raw) return '-';

  // "XX业务N部" → "XXN部"
  const deptMatch = raw.match(/^(.+?)业务([一二三四五六七八九十\d]+部)$/);
  if (deptMatch) return `${deptMatch[1]}${deptMatch[2]}`;

  // "XX业务团队" → "XX"
  const teamMatch = raw.match(/^(.+?)业务团队$/);
  if (teamMatch) return teamMatch[1];

  // "XX业务部" → "XX"
  const buMatch = raw.match(/^(.+?)业务部$/);
  if (buMatch) return buMatch[1];

  return raw;
}

// ==================== 走势图 X 轴日期格式化 ====================

/**
 * 格式化走势图日维度X轴（月度第1日显示“M月1日”并加粗18px，其他显示“D”）
 * 配合 ECharts axisLabel.rich 配置使用
 * @example formatTrendDailyXAxis("2026-02-02") => "2"
 * @example formatTrendDailyXAxis("2026-01-01") => "{startOfMonth|1月1日}"
 */
export function formatTrendDailyXAxis(value: string): string {
  if (!value) return value;
  // 匹配 YYYY-MM-DD
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const m = parseInt(match[2], 10);
    const d = parseInt(match[3], 10);
    if (d === 1) {
      return `{startOfMonth|${m}月1日}`;
    }
    return `${d}`;
  }
  return value;
}

/**
 * 走势图日维度X轴 ECharts rich 配置
 */
export const TREND_DAILY_XAXIS_RICH = {
  startOfMonth: {
    fontWeight: 'bold' as const,
    fontSize: 11,
  },
};
