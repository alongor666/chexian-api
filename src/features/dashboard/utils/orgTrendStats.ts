/**
 * 机构推介率走势统计工具（纯程序计算，零延迟）
 */

import type { OrgTrendPoint } from '../hooks/useCrossSellOrgTrend';

export type TrendDir = 'up' | 'down' | 'flat';

export interface TrendStats {
  /** 14天推介率均值 */
  avgRate: number;
  /** 近3天推介率均值 */
  recent3Avg: number;
  /** 前期（第1-11天）推介率均值 */
  prev11Avg: number;
  /** 近3天 vs 前期变化（pp，正=上升） */
  changeVsPrev: number;
  /** 线性回归斜率（正=整体上升） */
  slope: number;
  /** 趋势方向（斜率绝对值 < 0.3 算平稳） */
  trendDir: TrendDir;
  /** 推介率最高日 */
  maxDay: { date: string; rate: number };
  /** 推介率最低日 */
  minDay: { date: string; rate: number };
  /** 连续上升/下降天数（正=连续上升，负=连续下降，从最后一天往前算） */
  consecutiveDays: number;
  /** 最新一天推介率 */
  latestRate: number;
  /** 最新一天日期 */
  latestDate: string;
}

/** 计算线性回归斜率 */
function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/** 计算数组均值（忽略 NaN）
 * TODO: 对率值指标应使用 SUM(分子)/SUM(分母)，但当前 API 不返回件数字段，
 * 此处仅用于趋势描述性统计，待后端补充绝对值字段后修正 */
function mean(arr: number[]): number {
  const valid = arr.filter(v => !isNaN(v));
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/**
 * 从14天数据计算统计摘要
 * @param rows 按日期升序排列的数据
 */
export function calcTrendStats(rows: OrgTrendPoint[]): TrendStats | null {
  if (rows.length === 0) return null;

  const rates = rows.map(r => r.rate);
  const n = rates.length;

  // 均值
  const avgRate = mean(rates);

  // 近3天 vs 前期
  const recent3 = rates.slice(-3);
  const prev = rates.slice(0, Math.max(n - 3, 1));
  const recent3Avg = mean(recent3);
  const prev11Avg = mean(prev);
  const changeVsPrev = recent3Avg - prev11Avg;

  // 线性回归
  const slope = linearSlope(rates);
  const trendDir: TrendDir =
    Math.abs(slope) < 0.3 ? 'flat' : slope > 0 ? 'up' : 'down';

  // 最高/最低
  let maxIdx = 0, minIdx = 0;
  for (let i = 1; i < n; i++) {
    if (rates[i] > rates[maxIdx]) maxIdx = i;
    if (rates[i] < rates[minIdx]) minIdx = i;
  }

  // 连续天数（从最后一天往前）
  let consecutiveDays = 0;
  if (n >= 2) {
    const dir = rates[n - 1] >= rates[n - 2] ? 1 : -1;
    consecutiveDays = dir;
    for (let i = n - 2; i > 0; i--) {
      const curDir = rates[i] >= rates[i - 1] ? 1 : -1;
      if (curDir === dir) consecutiveDays += dir;
      else break;
    }
  }

  return {
    avgRate: Math.round(avgRate * 10) / 10,
    recent3Avg: Math.round(recent3Avg * 10) / 10,
    prev11Avg: Math.round(prev11Avg * 10) / 10,
    changeVsPrev: Math.round(changeVsPrev * 10) / 10,
    slope: Math.round(slope * 100) / 100,
    trendDir,
    maxDay: { date: rows[maxIdx].date, rate: rates[maxIdx] },
    minDay: { date: rows[minIdx].date, rate: rates[minIdx] },
    consecutiveDays,
    latestRate: rates[n - 1],
    latestDate: rows[n - 1].date,
  };
}
