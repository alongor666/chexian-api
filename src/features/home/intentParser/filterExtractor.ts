/**
 * 筛选参数提取器
 *
 * 从用户输入中提取机构、业务员、时间等筛选参数。
 * 纯函数，可注入 today 用于测试。
 */

import type { FilterOptions } from '@/shared/types/data';
import type { ExtractedFilters } from './types';

/** 最短模糊匹配子串长度（防止"中"等单字误匹配） */
const MIN_MATCH_LEN = 2;

/** 歧义排除阈值：同一子串命中超过此数量的选项则丢弃 */
const AMBIGUITY_THRESHOLD = 3;

// ────────────────────────────────────────────────────
// 时间模式表
// ────────────────────────────────────────────────────

interface TimeRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

interface TimePattern {
  pattern: RegExp;
  resolve: (today: Date, match: RegExpMatchArray) => TimeRange;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthRange(today: Date): TimeRange {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { start: formatDate(start), end: formatDate(today) };
}

function lastMonthRange(today: Date): TimeRange {
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0); // 上月最后一天
  return { start: formatDate(start), end: formatDate(end) };
}

function weekRange(today: Date): TimeRange {
  const dayOfWeek = today.getDay() || 7; // 周日=7
  const start = new Date(today);
  start.setDate(today.getDate() - dayOfWeek + 1); // 本周一
  return { start: formatDate(start), end: formatDate(today) };
}

function lastWeekRange(today: Date): TimeRange {
  const dayOfWeek = today.getDay() || 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - dayOfWeek + 1);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  return { start: formatDate(lastMonday), end: formatDate(lastSunday) };
}

function recentDaysRange(today: Date, days: number): TimeRange {
  const start = new Date(today);
  start.setDate(today.getDate() - days);
  return { start: formatDate(start), end: formatDate(today) };
}

function yearRange(_today: Date, year: number): TimeRange {
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function todayRange(today: Date): TimeRange {
  const d = formatDate(today);
  return { start: d, end: d };
}

const TIME_PATTERNS: TimePattern[] = [
  { pattern: /本月|这个月/, resolve: (t) => monthRange(t) },
  { pattern: /上个?月/, resolve: (t) => lastMonthRange(t) },
  { pattern: /本周|这周/, resolve: (t) => weekRange(t) },
  { pattern: /上周/, resolve: (t) => lastWeekRange(t) },
  { pattern: /今天/, resolve: (t) => todayRange(t) },
  { pattern: /最近(\d+)天/, resolve: (t, m) => recentDaysRange(t, parseInt(m[1], 10)) },
  { pattern: /最近[一1]个?月/, resolve: (t) => recentDaysRange(t, 30) },
  { pattern: /最近[三3]个?月/, resolve: (t) => recentDaysRange(t, 90) },
  { pattern: /今年|本年/, resolve: (t) => yearRange(t, t.getFullYear()) },
  { pattern: /去年|上年/, resolve: (t) => yearRange(t, t.getFullYear() - 1) },
  { pattern: /(\d{4})年/, resolve: (t, m) => yearRange(t, parseInt(m[1], 10)) },
];

// ────────────────────────────────────────────────────
// 选项模糊匹配
// ────────────────────────────────────────────────────

/**
 * 从选项列表中提取用户输入匹配的值
 *
 * 策略：
 * 1. 完整值匹配：input.includes(option.value)
 * 2. 2字滑窗匹配：option.value.includes(inputSegment)
 * 3. 歧义排除：同一子串命中 >AMBIGUITY_THRESHOLD 则丢弃
 */
function matchOptions(
  input: string,
  options: ReadonlyArray<{ value: string }> | undefined,
): string[] {
  if (!options || options.length === 0) return [];

  const matched = new Set<string>();

  // Step 1: 完整值匹配
  for (const opt of options) {
    if (opt.value.length >= MIN_MATCH_LEN && input.includes(opt.value)) {
      matched.add(opt.value);
    }
  }

  // 如果精确匹配已有结果，直接返回（避免模糊匹配干扰）
  if (matched.size > 0) {
    return [...matched];
  }

  // Step 2: 2字滑窗匹配
  const segments = extractSegments(input, MIN_MATCH_LEN);

  for (const segment of segments) {
    const candidates: string[] = [];
    for (const opt of options) {
      if (opt.value.includes(segment)) {
        candidates.push(opt.value);
      }
    }
    // Step 3: 歧义排除
    if (candidates.length > 0 && candidates.length <= AMBIGUITY_THRESHOLD) {
      for (const c of candidates) {
        matched.add(c);
      }
    }
  }

  return [...matched];
}

/**
 * 从输入字符串中提取所有连续 N 字的滑动窗口
 */
function extractSegments(input: string, segLen: number): string[] {
  const results: string[] = [];
  for (let i = 0; i <= input.length - segLen; i++) {
    results.push(input.slice(i, i + segLen));
  }
  return results;
}

// ────────────────────────────────────────────────────
// 时间意图提取
// ────────────────────────────────────────────────────

function extractTimeRange(input: string, today: Date): TimeRange | null {
  for (const { pattern, resolve } of TIME_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      return resolve(today, match);
    }
  }
  return null;
}

// ────────────────────────────────────────────────────
// 主函数
// ────────────────────────────────────────────────────

/**
 * 从用户输入中提取筛选参数
 *
 * @param input         - 用户输入文本
 * @param filterOptions - 来自 FilterContext 的选项列表
 * @param today         - 可注入，方便测试
 */
export function extractFilters(
  input: string,
  filterOptions: FilterOptions,
  today?: Date,
): ExtractedFilters {
  const normalizedInput = input.trim();
  if (!normalizedInput) return {};

  const result: ExtractedFilters = {};
  const resolvedToday = today ?? new Date();

  // 提取机构
  const orgs = matchOptions(normalizedInput, filterOptions.org_level_3);
  if (orgs.length > 0) {
    result.org_level_3 = orgs;
  }

  // 提取业务员
  const salesmen = matchOptions(normalizedInput, filterOptions.salesman_name);
  if (salesmen.length > 0) {
    result.salesman_name = salesmen;
  }

  // 提取客户类别
  const categories = matchOptions(normalizedInput, filterOptions.customer_category);
  if (categories.length > 0) {
    result.customer_category = categories;
  }

  // 提取时间范围
  const timeRange = extractTimeRange(normalizedInput, resolvedToday);
  if (timeRange) {
    result.policy_date_start = timeRange.start;
    result.policy_date_end = timeRange.end;
  }

  return result;
}
