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
 * 从逐期序列中查找指定 period 的去年同期值。
 * period 格式：'YYYY-MM' 或 'YYYY-MM-DD'。年份 -1 + 月日不变。找不到或非有限数值返回 null。
 *
 * 用途：YoY 必须用「latestMature 期」对齐，而非 series 尾月（codex P2 评审）。
 * series 尾月在 lossTrend 经 null filter 后仍可能是 cutoff 当月（如 2026-06，
 * 4 天满期分母极小放大值），用它作 yoy.current 会把 6 月未成熟值当佐证 3 月告警。
 */
export function findSamePeriodLastYear(series, period) {
  if (!Array.isArray(series) || typeof period !== 'string') return null;
  const m = period.match(/^(\d{4})(-.+)$/);
  if (!m) return null;
  const targetPeriod = `${Number(m[1]) - 1}${m[2]}`;
  const row = series.find((r) => r && r.time_period === targetPeriod);
  if (!row || !Number.isFinite(Number(row.value))) return null;
  return { time_period: row.time_period, value: Number(row.value) };
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
 *   7) YoY 对齐：opts.yoy 缺省 → 自动从 series 查 latestMature 同月前一年值，
 *      避免把 series 尾月（cutoff 当月未成熟）当 yoy.current 错误佐证（codex P2）。
 *
 * @returns {object} verdict（含 triggered / 触发原因 / 数值上下文，供 LLM 归因与 issue 展示）
 */
export function evaluateMetricSeries(metric, series, opts = {}) {
  const {
    zThreshold = 2,
    momThreshold = null, // null = 不启用环比门
    direction = 'both',
    excludeRecent = 1,
    yoy = null, // 缺省 → 自动按 latestMature 期 -1 年从 series 内查（修复 codex P2）
    yoyThreshold = null,
    // 基线 trim（issue #550 治本）：null=不 trim，保留旧行为；
    //   {iqrK?, dropHead?} 启用 trimBaseline 剔除离群与早期未稳定期。
    //   prepublish-gate 维持默认 null 不受影响；仅 sentinel.config 的 earned_claim_ratio 显式启用。
    baselineTrim = null,
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
    yoy: null,
    excludedPeriods: excluded.map((e) => e.time_period),
    insufficientData: false,
    baselineSize: 0,
    baselineTrimmedCount: 0,
  };

  if (mature.length < 3) {
    // 样本不足以稳健估计均值/标准差
    return { ...base, insufficientData: true };
  }

  const latest = mature[mature.length - 1];
  const prior = mature[mature.length - 2];
  const baselineRows = mature.slice(0, mature.length - 1); // 不含被检值
  const rawBaselineValues = baselineRows.map((r) => r.value);

  // 基线 trim（可选）：根治 lossTrend 长序列被早期未稳定期+IBNR 极端值污染（issue #550）
  let baselineValues = rawBaselineValues;
  let trimmedCount = 0;
  if (baselineTrim) {
    const r = trimBaseline(rawBaselineValues, baselineTrim);
    baselineValues = r.trimmed;
    trimmedCount = r.dropped.length;
  }

  const m = mean(baselineValues);
  const s = stdDev(baselineValues);
  const z = zScore(latest.value, baselineValues);
  const mom = pctChange(latest.value, prior.value);

  // YoY 同期对齐（修复 codex P2）：缺省时用 latestMature 期从 series 查去年同月，
  // 而非 series 尾月（cutoff 当月未成熟值），避免错误佐证。
  let effectiveYoy = yoy;
  if (effectiveYoy == null) {
    const ly = findSamePeriodLastYear(series, latest.time_period);
    if (ly != null) {
      effectiveYoy = { current: latest.value, previous: ly.value, previousPeriod: ly.time_period };
    }
  }

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
  if (effectiveYoy && Number.isFinite(effectiveYoy.current) && Number.isFinite(effectiveYoy.previous)) {
    yoyDeviation = pctChange(effectiveYoy.current, effectiveYoy.previous);
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
    yoy: effectiveYoy,
    yoyDeviation: Number.isFinite(yoyDeviation) ? Number(yoyDeviation.toFixed(4)) : NaN,
    baselineSize: baselineValues.length,
    baselineTrimmedCount: trimmedCount,
  };
}

/**
 * 基线 trim：剔除离群值，得到更稳健的基线序列（issue #550 治本）。
 *
 * 背景：lossTrend 长序列会把早期未稳定期（保单刚起保、IBNR 未爬完）的极端值喂进基线，
 * 实测 mean=151%、std=568%，Z-score 永远失效；环比兜底成唯一触发路径 → 一旦刚出排除窗口
 * 的月仍在自然爬坡就误报。trim 后基线均值/方差回归业务正常范围（赔付率 50~80%）。
 *
 * 算法：① 可选剔除头部 N 期（早期单期样本极小）② IQR×k 法剔除离群（默认 k=1.5）
 *      ③ 任一步剔过狠（剩余 <3）则回退该步，保证最少 3 个基线点。
 *
 * @param {number[]} values 基线原始值数组（不含被检值）
 * @param {object} [options]
 * @param {number} [options.iqrK=1.5] IQR 倍数；越大越宽松
 * @param {number} [options.dropHead=0] 额外剔除头部 N 期
 * @returns {{ trimmed:number[], dropped:number[] }}
 */
export function trimBaseline(values, options = {}) {
  const { iqrK = 1.5, dropHead = 0 } = options;
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 4) return { trimmed: nums, dropped: [] };

  // 头部排除（早期期数赔款未爬完，单期样本极小）；剔过狠回退
  const headDropped = dropHead > 0 ? nums.slice(0, Math.min(dropHead, nums.length)) : [];
  let working = nums.length - headDropped.length >= 3 ? nums.slice(headDropped.length) : nums;
  const effectiveHeadDropped = working === nums ? [] : headDropped;

  // IQR 离群剔除
  const sorted = [...working].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr === 0) return { trimmed: working, dropped: effectiveHeadDropped };

  const lo = q1 - iqrK * iqr;
  const hi = q3 + iqrK * iqr;
  const trimmed = [];
  const droppedIqr = [];
  for (const v of working) {
    if (v >= lo && v <= hi) trimmed.push(v);
    else droppedIqr.push(v);
  }
  // trim 过狠回退
  if (trimmed.length < 3) return { trimmed: working, dropped: effectiveHeadDropped };
  return { trimmed, dropped: effectiveHeadDropped.concat(droppedIqr) };
}

/**
 * 计算 verdict 的告警指纹（silence 用，issue #550 治本）。
 *
 * 设计：把"同质告警"（指标 × 最新成熟期 × 方向 × 环比规模）归为同一 fp。
 * z 不进 fp（其值常 NaN 或巨变不稳定）；mom 四舍五入到整数避免微抖动产生新 fp。
 * 同 fp 已记入 silence state 后不再追加 issue comment，直到任一元素变化（期数推进 / 方向反转 / 量级跳跃）。
 *
 * @param {object} verdict evaluateMetricSeries 返回的 verdict（无论是否触发都可算）
 * @returns {string} 形如 'earned_claim_ratio|2026-03|up|18'
 */
export function computeFingerprint(verdict) {
  if (!verdict || !verdict.metric) return '';
  const period = verdict.latestMaturePeriod ?? '?';
  const dir = verdict.direction ?? 'both';
  const momRounded = Number.isFinite(verdict.mom) ? Math.round(verdict.mom) : 'na';
  return `${verdict.metric}|${period}|${dir}|${momRounded}`;
}

/** 计算去年同期 cutoff（YYYY-MM-DD → 年份 -1）。非法输入返回 null */
export function lastYearCutoff(cutoffDate) {
  if (typeof cutoffDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) return null;
  const year = Number(cutoffDate.slice(0, 4));
  return `${year - 1}${cutoffDate.slice(4)}`;
}
