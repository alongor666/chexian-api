/**
 * ETL 异常哨兵 — 统计判定纯函数库
 *
 * 设计原则（来自 codex 评审 E2/E3）：
 *   - 统计层是「是否告警」的唯一决策者，LLM 只做归因、不裁决。
 *   - 比率序列必须用 per-period（逐期）值做 Z-score；禁止用累计(YTD-cumulative)
 *     序列，否则相邻点强自相关 → 标准差被压低 → 频繁误触。
 *   - 满期赔付率近期受赔款报告滞后/IBNR 影响系统性偏低、随时间向上发展，
 *     必须排除未成熟近期（maturity filter），只对已成熟完整期判异常。
 *
 * 纯函数，无 IO、无依赖，便于单测（tests/sentinel/stats.test.ts）。
 */

/** 算术平均 */
export function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** 样本标准差（n-1）；样本数 < 2 返回 NaN */
export function stdDev(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return NaN;
  const m = mean(nums);
  const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Z-score：(x - 均值) / 标准差。标准差为 0 或 NaN 时返回 NaN（无法判定） */
export function zScore(x, baseline) {
  if (!Number.isFinite(x)) return NaN;
  const m = mean(baseline);
  const s = stdDev(baseline);
  if (!Number.isFinite(s) || s === 0) return NaN;
  return (x - m) / s;
}

/** 环比变化率（%）：(当前 - 上期) / |上期| * 100。上期为 0/NaN 返回 NaN */
export function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return NaN;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * 成熟度过滤：从逐期序列中排除未成熟的近 N 期。
 *
 * @param {Array<{time_period:string, value:number}>} series 按 time_period 升序的逐期序列
 * @param {number} excludeRecent 排除最近多少个完整期（IBNR 防线，默认 1）
 * @returns {{ mature: Array, excluded: Array }}
 *   mature   = 用于统计判定的已成熟期（去掉最近 excludeRecent 期）
 *   excluded = 被排除的未成熟近期（仅作展示，不进 Z 计算）
 */
export function splitByMaturity(series, excludeRecent = 1) {
  const sorted = [...series].sort((a, b) => String(a.time_period).localeCompare(String(b.time_period)));
  if (excludeRecent <= 0 || sorted.length <= excludeRecent) {
    return { mature: sorted, excluded: [] };
  }
  return {
    mature: sorted.slice(0, sorted.length - excludeRecent),
    excluded: sorted.slice(sorted.length - excludeRecent),
  };
}

/**
 * 对单个指标的逐期序列做异常判定。
 *
 * 判定逻辑（统计层，确定性）：
 *   1) 成熟度过滤：排除未成熟近期。
 *   2) 取「最新已成熟期」作为被检值，其余更早的已成熟期作为基线。
 *   3) Z-score 门：|Z| > zThreshold。
 *   4) 环比门：|最新已成熟期 vs 其上一期| > momThreshold(%)。
 *   5) 触发条件：Z 门 OR 环比门（任一命中即候选）。
 *   6) 方向敏感：direction='up' 只在升高时告警（如赔付率），'down' 只在降低时，
 *      'both' 双向。
 *
 * @returns {object} verdict（含 triggered / 触发原因 / 数值上下文，供 LLM 归因与 issue 展示）
 */
export function evaluateMetricSeries(metric, series, opts = {}) {
  const {
    zThreshold = 2,
    momThreshold = null, // null = 不启用环比门
    direction = 'both',
    excludeRecent = 1,
    yoy = null, // { current, previous } 同期对照，用于交叉确认
    yoyThreshold = null,
  } = opts;

  const { mature, excluded } = splitByMaturity(series, excludeRecent);

  const base = {
    metric,
    triggered: false,
    reasons: [],
    direction,
    latestMaturePeriod: null,
    latestMatureValue: null,
    baselineMean: NaN,
    baselineStd: NaN,
    z: NaN,
    mom: NaN,
    yoy: yoy ?? null,
    excludedPeriods: excluded.map((e) => e.time_period),
    insufficientData: false,
  };

  if (mature.length < 3) {
    // 样本不足以稳健估计均值/标准差
    return { ...base, insufficientData: true };
  }

  const latest = mature[mature.length - 1];
  const prior = mature[mature.length - 2];
  const baselineRows = mature.slice(0, mature.length - 1); // 不含被检值
  const baselineValues = baselineRows.map((r) => r.value);

  const m = mean(baselineValues);
  const s = stdDev(baselineValues);
  const z = zScore(latest.value, baselineValues);
  const mom = pctChange(latest.value, prior.value);

  const reasons = [];

  // Z 门
  if (Number.isFinite(z) && Math.abs(z) > zThreshold) {
    const dirOk =
      direction === 'both' ||
      (direction === 'up' && z > 0) ||
      (direction === 'down' && z < 0);
    if (dirOk) reasons.push(`Z=${z.toFixed(2)} 超阈值 ${zThreshold}`);
  }

  // 环比门
  if (momThreshold !== null && Number.isFinite(mom) && Math.abs(mom) > momThreshold) {
    const dirOk =
      direction === 'both' ||
      (direction === 'up' && mom > 0) ||
      (direction === 'down' && mom < 0);
    if (dirOk) reasons.push(`环比 ${mom.toFixed(1)}% 超阈值 ${momThreshold}%`);
  }

  // YoY 交叉确认（不单独触发，但作为强化证据记录）
  let yoyDeviation = NaN;
  if (yoy && Number.isFinite(yoy.current) && Number.isFinite(yoy.previous)) {
    yoyDeviation = pctChange(yoy.current, yoy.previous);
    if (
      yoyThreshold !== null &&
      Number.isFinite(yoyDeviation) &&
      Math.abs(yoyDeviation) > yoyThreshold &&
      reasons.length > 0 // 仅在已有统计触发时作为交叉确认
    ) {
      reasons.push(`同比 ${yoyDeviation.toFixed(1)}% 同向佐证`);
    }
  }

  return {
    ...base,
    triggered: reasons.length > 0,
    reasons,
    latestMaturePeriod: latest.time_period,
    latestMatureValue: latest.value,
    baselineMean: Number.isFinite(m) ? Number(m.toFixed(4)) : NaN,
    baselineStd: Number.isFinite(s) ? Number(s.toFixed(4)) : NaN,
    z: Number.isFinite(z) ? Number(z.toFixed(4)) : NaN,
    mom: Number.isFinite(mom) ? Number(mom.toFixed(4)) : NaN,
    yoyDeviation: Number.isFinite(yoyDeviation) ? Number(yoyDeviation.toFixed(4)) : NaN,
  };
}

/** 计算去年同期 cutoff（YYYY-MM-DD → 年份 -1）。非法输入返回 null */
export function lastYearCutoff(cutoffDate) {
  if (typeof cutoffDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) return null;
  const year = Number(cutoffDate.slice(0, 4));
  return `${year - 1}${cutoffDate.slice(4)}`;
}
