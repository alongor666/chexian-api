/**
 * 理赔热力图面板（累计发展口径，2026-04-19 重构）
 *
 * 维度（行）× 累计截止日（列）交叉矩阵。
 * - 行维度：三级机构/团队/业务员/客户类别/险别组合/能源类型/新转续/风险评分
 * - 列维度：所选保单年度内的累计截止日（早段按月末，近 2 月按周六 + 最新日）
 * - 每格：所选年度起保的保单截至该列 cutoff 的累计数据（单调递增）
 * - 指标：满期赔付率/案均赔款/已报告赔款/已报告件数/满期出险率
 * - 模式：原始值/环比值/环比幅度/同比值/同比幅度（环比 = 本期累计 − 上期累计 = 新增）
 * - 赔案纳入：报案时间（默认）/ 出险时间 — 决定"已报案/已出险" 截至该 cutoff 的纳入
 */
import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { cardStyles, colorClasses, cn, fontStyles, getTrendColorClass } from '@/shared/styles';
import { EmptyState } from '@/shared/ui';
import { isClaimsHeatmapEmpty } from './claimsEmptyState';
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
type YoyMetricKey = 'yoy_loss_ratio_pct' | 'yoy_avg_claim' | 'yoy_total_claims_wan' | 'yoy_claim_count' | 'yoy_incident_rate_pct';

interface MetricOption {
  key: MetricKey;
  label: string;
  yoyKey: YoyMetricKey;
  unit: string;
  formatter: (v: number) => string;
}

const METRIC_OPTIONS: MetricOption[] = [
  { key: 'loss_ratio_pct', label: '满期赔付率 (%)', yoyKey: 'yoy_loss_ratio_pct', unit: '%', formatter: (v) => v.toFixed(1) },
  { key: 'avg_claim', label: '案均赔款', yoyKey: 'yoy_avg_claim', unit: '元', formatter: (v) => Math.round(v).toLocaleString() },
  { key: 'total_claims_wan', label: '已报告赔款', yoyKey: 'yoy_total_claims_wan', unit: '万', formatter: (v) => v.toFixed(1) },
  { key: 'claim_count', label: '已报告件数', yoyKey: 'yoy_claim_count', unit: '件', formatter: (v) => Math.round(v).toLocaleString() },
  { key: 'incident_rate_pct', label: '满期出险率 (%)', yoyKey: 'yoy_incident_rate_pct', unit: '%', formatter: (v) => v.toFixed(1) },
];

type CompareMode = 'raw' | 'wow_delta' | 'wow_rate' | 'yoy_delta' | 'yoy_rate';

const COMPARE_OPTIONS: { key: CompareMode; label: string }[] = [
  { key: 'raw', label: '原始值' },
  { key: 'wow_delta', label: '环比值' },
  { key: 'wow_rate', label: '环比幅度' },
  { key: 'yoy_delta', label: '同比值' },
  { key: 'yoy_rate', label: '同比幅度' },
];

type ClaimsDateFieldOption = 'report_time' | 'accident_time';

const CLAIMS_DATE_OPTIONS: { key: ClaimsDateFieldOption; label: string }[] = [
  { key: 'report_time', label: '报案时间' },
  { key: 'accident_time', label: '出险时间' },
];

// 保单年度候选：当前年向前 4 年 + 下一年（保留下一年以便跨年跑数）
function getPolicyYearOptions(refDate: string | undefined): number[] {
  const currentYear = refDate && /^\d{4}/.test(refDate)
    ? parseInt(refDate.slice(0, 4), 10)
    : new Date().getFullYear();
  return [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
}

// ── 数据行类型 ──

interface HeatmapRow {
  dimension_value: string;
  period_idx: number;
  period_label: string;
  period_type: string;
  // 保费侧
  earned_premium_wan: number;
  earned_exposure: number;
  // 当年指标
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
  yoy_earned_premium_wan: number;
  yoy_earned_exposure: number;
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

/** 类型安全地从 HeatmapRow 读取指标值 */
function getMetricValue(row: HeatmapRow, key: MetricKey | YoyMetricKey): number | null {
  return row[key] ?? null;
}

/** 获取单元格显示值 */
function getCellValue(
  row: HeatmapRow | undefined,
  prevRow: HeatmapRow | undefined,
  metricKey: MetricKey,
  yoyKey: YoyMetricKey,
  mode: CompareMode,
): number | null {
  if (!row) return null;

  const curVal = getMetricValue(row, metricKey);
  if (curVal == null && mode === 'raw') return null;

  switch (mode) {
    case 'raw':
      return curVal;

    case 'wow_delta': {
      const prevVal = prevRow ? getMetricValue(prevRow, metricKey) : null;
      if (curVal == null || prevVal == null) return null;
      return curVal - prevVal;
    }

    case 'wow_rate': {
      const prevVal = prevRow ? getMetricValue(prevRow, metricKey) : null;
      if (curVal == null || prevVal == null || prevVal === 0) return null;
      return ((curVal - prevVal) / Math.abs(prevVal)) * 100;
    }

    case 'yoy_delta': {
      const yoyVal = getMetricValue(row, yoyKey);
      if (curVal == null || yoyVal == null) return null;
      return curVal - yoyVal;
    }

    case 'yoy_rate': {
      const yoyVal = getMetricValue(row, yoyKey);
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
  mode: CompareMode,
  metricFormatter: (v: number) => string,
): string {
  if (value == null) return '-';

  if (mode === 'raw') {
    return metricFormatter(value);
  }

  if (mode === 'wow_rate' || mode === 'yoy_rate') {
    const sign = value > 0 ? '+' : '';
    // 率值单元格不带 %（单位 (%) 在列头/指标标签）
    return `${sign}${value.toFixed(1)}`;
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${metricFormatter(value)}`;
}

/** 获取单元格文字颜色 — 理赔指标全部为反转极性（上升=负面） */
function getCellColorClass(
  value: number | null,
  mode: CompareMode,
): string {
  if (value == null || mode === 'raw') return '';
  // 理赔热力图所有 5 个指标（赔付率/出险率/赔款/件数/案均）上升均为负面信号
  return getTrendColorClass(value, true);
}

/** 获取单元格背景色 */
function getCellBgClass(
  value: number | null,
  mode: CompareMode,
): string {
  if (value == null || mode === 'raw') return '';

  // 反转极性：正值=恶化=红，负值=改善=绿
  const isBad = value > 0;
  const absVal = Math.abs(value);

  if (mode === 'wow_rate' || mode === 'yoy_rate') {
    if (absVal > 20) return isBad ? colorClasses.bg.danger : colorClasses.bg.success;
    if (absVal > 10) return isBad ? cn(colorClasses.bg.danger, 'opacity-60') : cn(colorClasses.bg.success, 'opacity-60');
  }
  return '';
}

// ── 主组件 ──

export const ClaimsHeatmapPanel: React.FC<Props> = ({ hook, params }) => {
  const { claimsHeatmap } = hook;
  const [dimension, setDimension] = useState<DimensionKey>('org_level_3');
  const [metric, setMetric] = useState<MetricKey>('loss_ratio_pct');
  const [compareMode, setCompareMode] = useState<CompareMode>('raw');
  const [claimsDateField, setClaimsDateField] = useState<ClaimsDateFieldOption>('report_time');
  const [policyYear, setPolicyYear] = useState<number | null>(null); // null → 后端默认 max_date 年份
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(() => {
    const extra: Record<string, string> = { dimension, claimsDateField };
    if (policyYear !== null) extra.policyYear = String(policyYear);
    hook.fetchClaimsHeatmap({ ...params, ...extra });
  }, [hook.fetchClaimsHeatmap, params, dimension, claimsDateField, policyYear]);

  useEffect(() => { loadData(); }, [loadData]);

  // 构建矩阵
  const { dimensions, periods, matrix, refMaxDate } = useMemo(
    () => buildMatrix(claimsHeatmap.data as HeatmapRow[]),
    [claimsHeatmap.data],
  );

  // 空态保护（多省接入 ADR G8 / Day-1 SOP §5）：山西等新分公司装载中 / 缺数据时端点返回空数组或
  // 全零行。原 periods.length===0 挡不住「有时间桶但规模锚全 0」的静默零矩阵 → 用规模锚判据
  // （判据见 ./claimsEmptyState.ts），空则渲染「装载中」EmptyState 而非零，避免误判真实零赔案。
  const isEmpty = useMemo(() => isClaimsHeatmapEmpty(claimsHeatmap.data as HeatmapRow[]), [claimsHeatmap.data]);

  const metricConfig = METRIC_OPTIONS.find(m => m.key === metric)!;

  // 整体汇总行：从绝对值聚合重算率值指标（禁止加权平均）
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
        totalEarnedPremium += row.earned_premium_wan ?? 0;
        totalClaims += row.total_claims_wan ?? 0;
        totalClaimCount += row.claim_count ?? 0;
        totalEarnedExposure += row.earned_exposure ?? 0;
        yoyTotalEarnedPremium += row.yoy_earned_premium_wan ?? 0;
        yoyTotalClaims += row.yoy_total_claims_wan ?? 0;
        yoyTotalClaimCount += row.yoy_claim_count ?? 0;
        yoyTotalEarnedExposure += row.yoy_earned_exposure ?? 0;
      }

      map.set(period.idx, {
        dimension_value: '整体',
        period_idx: period.idx,
        period_label: period.label,
        period_type: period.type,
        earned_premium_wan: totalEarnedPremium,
        earned_exposure: totalEarnedExposure,
        loss_ratio_pct: totalEarnedPremium > 0 ? (totalClaims / totalEarnedPremium) * 100 : null,
        avg_claim: totalClaimCount > 0 ? (totalClaims * 10000 / totalClaimCount) : null,
        total_claims_wan: totalClaims,
        claim_count: totalClaimCount,
        incident_rate_pct: totalEarnedExposure > 0 ? (totalClaimCount / totalEarnedExposure) * 100 : null,
        yoy_earned_premium_wan: yoyTotalEarnedPremium,
        yoy_earned_exposure: yoyTotalEarnedExposure,
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

  const claimsDateLabel = CLAIMS_DATE_OPTIONS.find(o => o.key === claimsDateField)?.label ?? '报案时间';

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

          {/* 保单年度（insurance_start_date 年份） */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn('text-xs whitespace-nowrap', colorClasses.text.neutralMuted)}
              title="按保单起保日期年份筛选。每格 = 该年起保的保单截至列截止日的累计数据"
            >
              保单年度
            </span>
            <select
              value={policyYear ?? ''}
              onChange={e => {
                const v = e.target.value;
                setPolicyYear(v === '' ? null : parseInt(v, 10));
              }}
              className={cn(
                'text-sm px-2 py-1 rounded border',
                colorClasses.border.neutral,
                'bg-white dark:bg-surface-1',
                colorClasses.text.neutral,
              )}
            >
              <option value="">自动（最新年度）</option>
              {getPolicyYearOptions(refMaxDate).map(y => (
                <option key={y} value={y}>{y} 年</option>
              ))}
            </select>
          </div>

          {/* 赔案纳入条件 */}
          <div className="flex items-center gap-1.5">
            <span className={cn('text-xs whitespace-nowrap', colorClasses.text.neutralMuted)} title="决定哪些赔案计入累计（已报案 / 已出险），截止日 = 列 cutoff">赔案纳入</span>
            <select
              value={claimsDateField}
              onChange={e => setClaimsDateField(e.target.value as ClaimsDateFieldOption)}
              className={cn(
                'text-sm px-2 py-1 rounded border',
                colorClasses.border.neutral,
                'bg-white dark:bg-surface-1',
                colorClasses.text.neutral,
              )}
            >
              {CLAIMS_DATE_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
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
                    ? cn(colorClasses.bg.primarySolid, 'text-white', colorClasses.border.primary)
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
        ) : isEmpty ? (
          <EmptyState
            size="md"
            title="暂无赔付数据"
            description="当前筛选范围或机构暂无赔付热力数据，可能正在装载，请稍后刷新。若持续为空，请联系管理员确认数据状态——这不代表真实零赔案。"
          />
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
                    const display = formatCellDisplay(val, compareMode, metricConfig.formatter);
                    const textColor = getCellColorClass(val, compareMode);
                    const bgColor = getCellBgClass(val, compareMode);

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
                      const display = formatCellDisplay(val, compareMode, metricConfig.formatter);
                      const textColor = getCellColorClass(val, compareMode);
                      const bgColor = getCellBgClass(val, compareMode);

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

        {/* 口径说明（累计发展口径） */}
        <div className={cn('text-xs leading-relaxed', colorClasses.text.neutralMuted)}>
          <b>累计发展口径</b>：所选保单年度（insurance_start_date 年份）的保单，
          在每个列截止日 cutoff 的<b>累计</b>快照。
          赔案纳入条件 = <b>{claimsDateLabel}</b> ≤ 列 cutoff。
          <br />
          满期赔付率 = 累计已报告赔款 / 累计已赚保费；
          满期出险率 = 累计赔案件数 / 累计已赚暴露；
          案均赔款 = 累计赔款 / 累计件数。
          <br />
          列 cutoff 规则：早段为月末（1月末、2月末…），最近 2 月按周六截止（当周按最新日期）；
          每格数值单调递增（相邻列差 = 新增量）。
          环比 = 本期累计 − 上期累计 = 该段新增；同比 = 本年截至 cutoff 的累计 vs 去年同月/周累计。
        </div>
      </div>
    </div>
  );
};
