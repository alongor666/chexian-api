/**
 * 增长分析年度窗口派生工具（纯函数，可单测）
 *
 * BACKLOG 2026-06-11-claude-2e311d：修复前 analyzeOrgPremiumGrowth /
 * analyzeSalesmanGrowth / analyzeKPIGrowth 一律用 `new Date()` 当前年构造
 * YTD 窗口，忽略用户在筛选器选中的 filters.analysis_year，导致用户切到
 * 往年时这三路增长分析仍查当前年数据（与同面板 daily-detail 分支的
 * filters.analysis_year 口径不一致）。
 *
 * 本模块把"年份 → 当年查询窗口"的派生逻辑抽成纯函数，两处复用：
 * 1. useGrowthAnalysis.ts 的三个 analyze* 函数（当年窗口 + yoy 基期窗口）
 * 2. 单测（无需 mock Date.now，可整体注入 today）
 */

/**
 * 派生"当年查询窗口"。
 *
 * 口径对齐 daily-detail 分支（GrowthAnalysisPanel.tsx 的 org+yoy+monthly 特判）：
 * - analysisYear 缺省 → 取 today 所在年（保持修复前行为不变）
 * - analysisYear === today 所在年（当前年）→ YTD：区间末取 today（与修复前一致，
 *   避免把 endDate 推到未来 12-31 导致后端多算 / 无数据月份）
 * - analysisYear 为往年 → 全年：区间末取 该年-12-31
 *
 * @param analysisYear 筛选器选中的分析年度（filters.analysis_year），undefined 时回退当前年
 * @param today 基准"今天"，默认 new Date()（单测可注入固定日期）
 */
export function deriveGrowthYearWindow(
  analysisYear: number | undefined,
  today: Date = new Date()
): { year: number; startDate: string; endDate: string } {
  const currentYear = today.getFullYear();
  const year = analysisYear ?? currentYear;
  const startDate = `${year}-01-01`;
  const endDate = year === currentYear
    ? today.toISOString().split('T')[0]
    : `${year}-12-31`;

  return { year, startDate, endDate };
}

/**
 * 把 YYYY-MM-DD 日期回退 1 年，闰日 2-29 落到上年 2-28。
 *
 * 与后端 server/src/routes/query/growth.ts 的 shiftDateBackOneYear 同口径
 * （前端独立实现：两侧各自需要纯函数，不跨前后端共享模块）。
 * 修复前的手写字符串拼接（`${currentYear - 1}-${MM}-${DD}`）在 endDate 恰好是
 * 2月29日（闰年）时会拼出 `${currentYear - 1}-02-29`——上一年通常不是闰年，
 * 这是一个不存在的非法日期字符串，传给后端会被 isValidDateFormat 判定失败
 * 或被 DuckDB 解析为异常日期。
 *
 * @param yyyyMmDd 合法的 YYYY-MM-DD 日期字符串
 */
export function shiftDateBackOneYear(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (m === 2 && d === 29) {
    return `${y - 1}-02-28`;
  }
  return `${String(y - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
