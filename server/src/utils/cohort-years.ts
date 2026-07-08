/**
 * 发展口径 cohortYears 参数解析（起保年份 cohort 列表）
 *
 * 背景：expense-development / claims-detail loss-ratio-development 两处路由
 * 各自内联同一段解析逻辑，且默认值硬编码 [2023, 2024, 2025, 2026] —— 跨年后
 * 默认窗口停在旧年（时间炸弹）。收拢为唯一实现，默认值按当前自然年动态派生
 * （2026 年运行时输出与原硬编码逐字节一致）。
 */

/** cohort 年份下界：项目数据起点之前的年份无意义，直接过滤 */
export const COHORT_YEAR_MIN = 2020;
/** cohort 年份上界相对当前年的余量：允许查询次年 cohort（跨年初计划/期初件） */
const COHORT_YEAR_MAX_AHEAD = 1;
/** 默认窗口长度：最近 4 个起保年份 */
const DEFAULT_COHORT_SPAN = 4;

/**
 * 默认 cohort 年份列表 = [当前年 - 3, 当前年]（升序）。
 * @param now 注入时钟（测试用），缺省取系统当前时间
 */
export function defaultCohortYears(now: Date = new Date()): number[] {
  const currentYear = now.getFullYear();
  return Array.from(
    { length: DEFAULT_COHORT_SPAN },
    (_, i) => currentYear - DEFAULT_COHORT_SPAN + 1 + i
  );
}

/**
 * 解析请求中的 cohortYears 参数（逗号分隔年份），非法/越界项过滤；
 * 未传或全部非法时回落默认窗口（最近 4 个起保年份）。
 */
export function parseCohortYears(raw: unknown, now: Date = new Date()): number[] {
  const maxYear = now.getFullYear() + COHORT_YEAR_MAX_AHEAD;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const years = raw
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= COHORT_YEAR_MIN && n <= maxYear);
    if (years.length > 0) {
      return years;
    }
  }
  return defaultCohortYears(now);
}
