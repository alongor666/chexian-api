/**
 * 理赔热力图面板
 *
 * 维度（行）× 时间（列）交叉矩阵。
 * - 行维度：三级机构/团队/业务员/客户类别/险别组合/能源类型/新转续/风险评分
 * - 列维度：月度（早期折叠）+ 周度（近 2 月）
 * - 指标：满期赔付率/案均赔款/已报告赔款/已报告件数/满期出险率
 * - 模式：原始值/环比值/环比幅度/同比值/同比幅度
 */
import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { cardStyles, colorClasses, cn, fontStyles, getTrendColorClass } from '@/shared/styles';
import type { useClaimsDetail } from '../hooks/useClaimsDetail';

// ── 类型定义 ──

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

type DimensionKey =
  | 'org_level_3' | 'team' | 'salesman' | 'customer_category'
  | 'coverage_combination' | 'energy_type' | 'business_nature' | 'insurance_grade';

const DIMENSION_OPTIONS: { key: DimensionKey; label: string }[] = [
  { key: 'org_level_3', label: '三级机构' },
  { key: 'team', label: '团队' },
  { key: 'salesman', label: '业务员' },
  { key: 'customer_category', label: '客户类别' },
  { key: 'coverage_combination', label: '险别组合' },
  { key: 'energy_type', label: '能源类型' },
  { key: 'business_nature', label: '新转续' },
  { key: 'insurance_grade', label: '风险评分' },
];

type MetricKey = 'loss_ratio_pct' | 'avg_claim' | 'total_claims_wan' | 'claim_count' | 'incident_rate_pct';

const METRIC_OPTIONS: { key: MetricKey; label: string; yoyKey: string; unit: string; formatter: (v: number) => string }[] = [
  { key: 'loss_ratio_pct', label: '满期赔付率', yoyKey: 'yoy_loss_ratio_pct', unit: '%', formatter: (v) => v.toFixed(1) + '%' },
  { key: 'avg_claim', label: '案均赔款', yoyKey: 'yoy_avg_claim', unit: '元', formatter: (v) => Math.round(v).toLocaleString() },
  { key: 'total_claims_wan', label: '已报告赔款', yoyKey: 'yoy_total_claims_wan', unit: '万', formatter: (v) => v.toFixed(1) },
  { key: 'claim_count', label: '已报告件数', yoyKey: 'yoy_claim_count', unit: '件', formatter: (v) => Math.round(v).toLocaleString() },
  { key: 'incident_rate_pct', label: '满期出险率', yoyKey: 'yoy_incident_rate_pct', unit: '%', formatter: (v) => v.toFixed(2) + '%' },
];

type CompareMode = 'raw' | 'wow_delta' | 'wow_rate' | 'yoy_delta' | 'yoy_rate';

const COMPARE_OPTIONS: { key: CompareMode; label: string }[] = [
  { key: 'raw', label: '原始值' },
  { key: 'wow_delta', label: '环比值' },
  { key: 'wow_rate', label: '环比幅度' },
  { key: 'yoy_delta', label: '同比值' },
  { key: 'yoy_rate', label: '同比幅度' },
];

// ── 数据行类型 ──

interface HeatmapRow {
  dimension_value: string;
  period_idx: number;
  period_label: string;
  period_type: string;
  // 当年
  loss_ratio_pct: number | null;
  avg_claim: number | null;
  total_claims_wan: number;
  claim_count: number;
  incident_rate_pct: number | null;
  // 去年同期
  yoy_loss_ratio_pct: number | null;
  yoy_avg_claim: number | null;
  yoy_total_claims_wan: number;
  yoy_claim_count: number;
  yoy_incident_rate_pct: number | null;
  // 引用
  ref_max_date: string;
}

// ── 工具函数 ──

/** 从原始数据构建 matrix: dimension → period_idx → row */
function buildMatrix(data: HeatmapRow[]): {
  dimensions: string[];
  periods: { idx: number; label: string; type: string }[];
  matrix: Map<string, Map<number, HeatmapRow>>;
  refMaxDate: string;
} {
  const dimSet = new Set<string>();
  const periodMap = new Map<number, { label: string; type: string }>();
  const matrix = new Map<string, Map<number, HeatmapRow>>();
  let refMaxDate = '';

  for (const row of data) {
    const dim = row.dimension_value ?? '';
    const idx = row.period_idx ?? 0;
    dimSet.add(dim);
    if (!periodMap.has(idx)) {
      periodMap.set(idx, { label: row.period_label ?? '', type: row.period_type ?? '' });
    }
    if (!matrix.has(dim)) matrix.set(dim, new Map());
    matrix.get(dim)!.set(idx, row);
    if (row.ref_max_date) refMaxDate = row.ref_max_date;
  }

  const periods = Array.from(periodMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, info]) => ({ idx, ...info }));

  const dimensions = Array.from(dimSet).sort();

  return { dimensions, periods, matrix, refMaxDate };
}

/** 获取单元格显示值 */
function getCellValue(
  row: HeatmapRow | undefined,
  prevRow: HeatmapRow | undefined,
  metricKey: MetricKey,
  yoyKey: string,
  mode: CompareMode,
): number | null {
  if (!row) return null;

  const curVal = (row as any)[metricKey] as number | null;
  if (curVal == null && mode === 'raw') return null;

  switch (mode) {
    case 'raw':
      return curVal;

    case 'wow_delta': {
      const prevVal = prevRow ? (prevRow as any)[metricKey] as number | null : null;
      if (curVal == null || prevVal == null) return null;
      return curVal - prevVal;
    }

    case 'wow_rate': {
      const prevVal = prevRow ? (prevRow as any)[metricKey] as number | null : null;
      if (curVal == null || prevVal == null || prevVal === 0) return null;
      return ((curVal - prevVal) / Math.abs(prevVal)) * 100;
    }

    case 'yoy_delta': {
      const yoyVal = (row as any)[yoyKey] as number | null;
      if (curVal == null || yoyVal == null) return null;
      return curVal - yoyVal;
    }

    case 'yoy_rate': {
      const yoyVal = (row as any)[yoyKey] as number | null;
      if (curVal == null || yoyVal == null || yoyVal === 0) return null;
      return ((curVal - yoyVal) / Math.abs(yoyVal)) * 100;
    }

    default:
      return curVal;
  }
}

/** 格式化单元格显示 */
function formatCellDisplay(
  value: number | null,
  metricKey: MetricKey,
  mode: CompareMode,
  metricFormatter: (v: number) => string,
): string {
  if (value == null) return '-';

  if (mode === 'raw') {
    return metricFormatter(value);
  }

  // 差值/幅度模式
  if (mode === 'wow_rate' || mode === 'yoy_rate') {
    // 显示为百分比
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  // 差值模式：用指标自身格式
  const sign = value > 0 ? '+' : '';
  return `${sign}${metricFormatter(value)}`;
}

/** 赔付率反转极性：赔付率/出险率/赔款上升是负面信号 */
function isInverseMetric(metricKey: MetricKey): boolean {
  return metricKey === 'loss_ratio_pct' || metricKey === 'incident_rate_pct'
    || metricKey === 'avg_claim' || metricKey === 'total_claims_wan' || metricKey === 'claim_count';
}

/** 获取单元格颜色 class */
function getCellColorClass(
  value: number | null,
  metricKey: MetricKey,
  mode: CompareMode,
): string {
  if (value == null || mode === 'raw') return '';

  // 赔付类指标：上升（正值）是危险，下降（负值）是好的 → inverse
  const inverse = isInverseMetric(metricKey);
  return getTrendColorClass(value, inverse);
}

/** 获取单元格背景色 */
function getCellBgClass(
  value: number | null,
  metricKey: MetricKey,
  mode: CompareMode,
): string {
  if (value == null || mode === 'raw') return '';

  const inverse = isInverseMetric(metricKey);
  const isGood = inverse ? value < 0 : value > 0;
  const isBad = inverse ? value > 0 : value < 0;
  const absVal = Math.abs(value);

  if (mode === 'wow_rate' || mode === 'yoy_rate') {
    if (absVal > 20) return isBad ? 'bg-red-50 dark:bg-red-500/10' : 'bg-green-50 dark:bg-green-500/10';
    if (absVal > 10) return isBad ? 'bg-red-50/60 dark:bg-red-500/5' : 'bg-green-50/60 dark:bg-green-500/5';
  }
  return '';
}

// ── 主组件 ──

export const ClaimsHeatmapPanel: React.FC<Props> = ({ hook, params }) => {
  const { claimsHeatmap } = hook;
  const [dimension, setDimension] = useState<DimensionKey>('org_level_3');
  const [metric, setMetric] = useState<MetricKey>('loss_ratio_pct');
  const [compareMode, setCompareMode] = useState<CompareMode>('raw');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(() => {
    hook.fetchClaimsHeatmap({
      ...params,
      dimension,
    });
  }, [hook.fetchClaimsHeatmap, params, dimension]);

  useEffect(() => { loadData(); }, [loadData]);

  // 构建矩阵
  const { dimensions, periods, matrix, refMaxDate } = useMemo(
    () => buildMatrix(claimsHeatmap.data as HeatmapRow[]),
    [claimsHeatmap.data],
  );

  const metricConfig = METRIC_OPTIONS.find(m => m.key === metric)!;

  // 整体汇总行
  const summaryByPeriod = useMemo(() => {
    const map = new Map<number, HeatmapRow>();
    if (!claimsHeatmap.data.length) return map;

    for (const period of periods) {
      let totalEarnedPremium = 0;
      let totalClaims = 0;
      let totalClaimCount = 0;
      let totalEarnedExposure = 0;
      let yoyTotalEarnedPremium = 0;
      let yoyTotalClaims = 0;
      let yoyTotalClaimCount = 0;
      let yoyTotalEarnedExposure = 0;

      for (const dim of dimensions) {
        const row = matrix.get(dim)?.get(period.idx);
        if (!row) continue;
        const raw = row as any;
        totalEarnedPremium += raw.earned_premium_wan ?? 0;
        totalClaims += raw.total_claims_wan ?? 0;
        totalClaimCount += raw.claim_count ?? 0;
        totalEarnedExposure += raw.earned_exposure ?? 0;
        yoyTotalEarnedPremium += raw.yoy_earned_premium_wan ?? 0;
        yoyTotalClaims += raw.yoy_total_claims_wan ?? 0;
        yoyTotalClaimCount += raw.yoy_claim_count ?? 0;
        yoyTotalEarnedExposure += raw.yoy_earned_exposure ?? 0;
      }

      map.set(period.idx, {
        dimension_value: '整体',
        period_idx: period.idx,
        period_label: period.label,
        period_type: period.type,
        loss_ratio_pct: totalEarnedPremium > 0 ? (totalClaims / totalEarnedPremium) * 100 : null,
        avg_claim: totalClaimCount > 0 ? (totalClaims * 10000 / totalClaimCount) : null,
        total_claims_wan: totalClaims,
        claim_count: totalClaimCount,
        incident_rate_pct: totalEarnedExposure > 0 ? (totalClaimCount / totalEarnedExposure) * 100 : null,
        yoy_loss_ratio_pct: yoyTotalEarnedPremium > 0 ? (yoyTotalClaims / yoyTotalEarnedPremium) * 100 : null,
        yoy_avg_claim: yoyTotalClaimCount > 0 ? (yoyTotalClaims * 10000 / yoyTotalClaimCount) : null,
        yoy_total_claims_wan: yoyTotalClaims,
        yoy_claim_count: yoyTotalClaimCount,
        yoy_incident_rate_pct: yoyTotalEarnedExposure > 0 ? (yoyTotalClaimCount / yoyTotalEarnedExposure) * 100 : null,
        ref_max_date: refMaxDate,
      });
    }
    return map;
  }, [dimensions, periods, matrix, refMaxDate, claimsHeatmap.data.length]);

  const isLoading = claimsHeatmap.loading;
  const error = claimsHeatmap.error;

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-4">
      <div className={cn(cardStyles.standard, 'space-y-3')}>
        {/* 控制栏 */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 维度选择 */}
          <div className="flex items-center gap-1.5">
            <span className={cn('text-xs whitespace-nowrap', colorClasses.text.neutralMuted)}>维度</span>
            <select
              value={dimension}
              onChange={e => setDimension(e.target.value as DimensionKey)}
              className={cn(
                'text-sm px-2 py-1 rounded border',
                colorClasses.border.neutral,
                'bg-white dark:bg-surface-1',
                colorClasses.text.neutral,
              )}
            >
              {DIMENSION_OPTIONS.map(d => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* 指标切换 */}
          <div className="flex gap-1">
            {METRIC_OPTIONS.map(m => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-md border transition-colors',
                  metric === m.key
                    ? 'bg-primary-solid text-white border-primary'
                    : `bg-transparent ${colorClasses.border.neutral} ${colorClasses.text.neutral} hover:bg-neutral-100 dark:hover:bg-white/8`
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* 对比模式 */}
          <div className="flex gap-1 ml-auto">
            {COMPARE_OPTIONS.map(c => (
              <button
                key={c.key}
                onClick={() => setCompareMode(c.key)}
                className={cn(
                  'px-2 py-1 text-xs rounded-md border transition-colors',
                  compareMode === c.key
                    ? 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500'
                    : `bg-transparent ${colorClasses.border.neutral} ${colorClasses.text.neutralMuted} hover:bg-neutral-100 dark:hover:bg-white/8`
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          {refMaxDate && (
            <span className={cn('text-xs whitespace-nowrap', colorClasses.text.neutralMuted)}>
              数据截止 {refMaxDate}
            </span>
          )}
        </div>

        {/* 热力图矩阵 */}
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <span className={colorClasses.text.neutralMuted}>加载中...</span>
          </div>
        ) : periods.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center">
            <span className={colorClasses.text.neutralMuted}>暂无数据</span>
          </div>
        ) : (
          <div ref={scrollRef} className="overflow-x-auto -mx-4 px-4">
            <table
              className={cn('w-full border-collapse', fontStyles.numeric)}
              style={{ tableLayout: 'auto', fontSize: '12px', minWidth: `${periods.length * 60 + 100}px` }}
            >
              <thead>
                <tr>
                  <th
                    className={cn(
                      'text-left px-2 py-1.5 border-b whitespace-nowrap sticky left-0 z-10',
                      colorClasses.border.neutral,
                      colorClasses.text.neutralMuted,
                      'bg-white dark:bg-surface-1',
                    )}
                    style={{ minWidth: 90 }}
                  >
                    {DIMENSION_OPTIONS.find(d => d.key === dimension)?.label ?? '维度'}
                  </th>
                  {periods.map(p => (
                    <th
                      key={p.idx}
                      className={cn(
                        'text-center px-1 py-1.5 border-b whitespace-nowrap',
                        colorClasses.border.neutral,
                        colorClasses.text.neutralMuted,
                        p.type === 'month' ? 'font-semibold' : 'font-normal',
                      )}
                    >
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 整体汇总行 */}
                <tr className={cn('border-b-2', colorClasses.border.neutral, 'font-semibold')}>
                  <td
                    className={cn(
                      'px-2 py-1.5 whitespace-nowrap sticky left-0 z-10',
                      'bg-neutral-50 dark:bg-surface-2',
                      colorClasses.text.neutral,
                    )}
                  >
                    整体
                  </td>
                  {periods.map((p, colIdx) => {
                    const row = summaryByPeriod.get(p.idx);
                    const prevRow = colIdx > 0 ? summaryByPeriod.get(periods[colIdx - 1].idx) : undefined;
                    const val = getCellValue(row, prevRow, metric, metricConfig.yoyKey, compareMode);
                    const display = formatCellDisplay(val, metric, compareMode, metricConfig.formatter);
                    const textColor = getCellColorClass(val, metric, compareMode);
                    const bgColor = getCellBgClass(val, metric, compareMode);

                    return (
                      <td
                        key={p.idx}
                        className={cn(
                          'text-center px-1 py-1.5',
                          'bg-neutral-50 dark:bg-surface-2',
                          bgColor,
                          textColor || colorClasses.text.neutral,
                        )}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>

                {/* 维度行 */}
                {dimensions.map(dim => (
                  <tr key={dim} className={cn('border-b', colorClasses.border.neutral, 'hover:bg-neutral-50/50 dark:hover:bg-white/3')}>
                    <td
                      className={cn(
                        'px-2 py-1.5 whitespace-nowrap sticky left-0 z-10 truncate max-w-[120px]',
                        'bg-white dark:bg-surface-1',
                        colorClasses.text.neutral,
                      )}
                      title={dim}
                    >
                      {dim}
                    </td>
                    {periods.map((p, colIdx) => {
                      const row = matrix.get(dim)?.get(p.idx);
                      const prevRow = colIdx > 0 ? matrix.get(dim)?.get(periods[colIdx - 1].idx) : undefined;
                      const val = getCellValue(row, prevRow, metric, metricConfig.yoyKey, compareMode);
                      const display = formatCellDisplay(val, metric, compareMode, metricConfig.formatter);
                      const textColor = getCellColorClass(val, metric, compareMode);
                      const bgColor = getCellBgClass(val, metric, compareMode);

                      return (
                        <td
                          key={p.idx}
                          className={cn(
                            'text-center px-1 py-1.5',
                            bgColor,
                            textColor,
                          )}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 说明 */}
        <div className={cn('text-xs leading-relaxed', colorClasses.text.neutralMuted)}>
          <b>口径说明</b>：保费收入口径（起保日期 ≤ 签单最新日期），列按周六截止（当周按最新日期）。
          满期赔付率 = 已报告赔款 / 满期保费，满期出险率 = 赔案件数 / 已赚暴露。
          环比按当周比上周，同比按当年截止日比去年同截止日。
        </div>
      </div>
    </div>
  );
};
