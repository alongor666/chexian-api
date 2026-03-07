/**
 * 机构推介率走势图
 *
 * 叠加柱（灰色=车险件数底层，绿色=驾意件数上叠）+ 双右轴折线（推介率/驾乘件均）
 * X 轴：最近连续 90 天（默认显示最后 14 天）
 * 险种：交三 / 主全 / 单交 标签切换
 * 区域：同城 / 异地 / 全省（全部机构）切换
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatCount, formatPercent, formatTrendDailyXAxis, TREND_DAILY_XAXIS_RICH } from '../../shared/utils/formatters';
import { buttonStyles, cardStyles, colors, cn, tableStyles, textStyles } from '../../shared/styles';
import { ORG_GROUPS } from '../../shared/config/coefficient-thresholds';
import { useCrossSellOrgTrend, type CoverageCombinationFilter, type OrgTrendPoint } from './hooks/useCrossSellOrgTrend';
import type { TrendGranularity } from './hooks/useCrossSellTrend';
import { apiClient } from '../../shared/api/client';
import type { AdvancedFilterState } from '../../shared/types/data';
import type { VehicleCategory, SeatCoverageLevel } from './hooks/useCrossSellTimePeriod';

interface CrossSellOrgTrendChartProps {
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  granularity?: TrendGranularity;
  filters: AdvancedFilterState;
}

/** 险种标签 */
const COVERAGE_TABS: CoverageCombinationFilter[] = ['交三', '主全', '单交'];

/** 机构区域定义 */
type RegionType = 'local' | 'remote' | 'province';

const ALL_ORGS = Array.from(new Set([...ORG_GROUPS.SAME_CITY, ...ORG_GROUPS.REMOTE]));
const REGION_LABELS: Record<RegionType, string> = { local: '同城', remote: '异地', province: '全省' };
const REGION_ORGS: Record<RegionType, readonly string[]> = {
  local: ORG_GROUPS.SAME_CITY,
  remote: ORG_GROUPS.REMOTE,
  province: ALL_ORGS,
};

// ── 颜色 ──────────────────────────────────────────────────────────────────────
const BAR_AUTO_COLOR = colors.neutral[300];
const BAR_DRIVER_COLOR = colors.success.DEFAULT;
const LINE_RATE_COLOR = colors.warning.DEFAULT;
const LINE_AVG_PREMIUM_COLOR = colors.primary.DEFAULT;

interface MetricDigest {
  avg30: number;
  avg7: number;
  consecutiveDownDays: number;
  maxPoint: { date: string; value: number };
  minPoint: { date: string; value: number };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calcMetricDigest(rows: OrgTrendPoint[], pick: (row: OrgTrendPoint) => number): MetricDigest | null {
  if (rows.length === 0) return null;

  const window30 = rows.slice(-30);
  const values30 = window30.map(pick);
  const values7 = window30.slice(-7).map(pick);

  let maxIdx = 0;
  let minIdx = 0;
  for (let i = 1; i < values30.length; i++) {
    if (values30[i] > values30[maxIdx]) maxIdx = i;
    if (values30[i] < values30[minIdx]) minIdx = i;
  }

  let consecutiveDownDays = 0;
  for (let i = values30.length - 1; i > 0; i--) {
    if (values30[i] < values30[i - 1]) consecutiveDownDays += 1;
    else break;
  }

  return {
    avg30: mean(values30),
    avg7: mean(values7),
    consecutiveDownDays,
    maxPoint: { date: window30[maxIdx].date, value: values30[maxIdx] },
    minPoint: { date: window30[minIdx].date, value: values30[minIdx] },
  };
}

function buildPremiumLabelVisibility(
  rates: number[],
  avgPremiums: number[],
  premiumAxisMin: number,
  premiumAxisMax: number
): boolean[] {
  const axisRange = Math.max(1, premiumAxisMax - premiumAxisMin);
  const diffs = rates.map((rate, index) => {
    const rateNorm = Math.max(0, Math.min(1, rate / 100));
    const premiumNorm = Math.max(0, Math.min(1, (avgPremiums[index] - premiumAxisMin) / axisRange));
    return premiumNorm - rateNorm;
  });

  return diffs.map((diff, index) => {
    const near = Math.abs(diff) < 0.06;
    const crossPrev = index > 0 && diff * diffs[index - 1] < 0;
    const crossNext = index < diffs.length - 1 && diff * diffs[index + 1] < 0;
    return !(near || crossPrev || crossNext);
  });
}

function shortDate(date: string): string {
  return date.length >= 10 ? date.slice(5) : date;
}

function exportRowsToCsv(rows: OrgTrendPoint[], filename: string): void {
  const headers = ['日期', '车险件数', '驾意件数', '非驾意件数', '推介率(%)', '驾乘件均(元)'];
  const dataRows = rows.map((row) => [
    row.date,
    String(row.auto_count),
    String(row.driver_count),
    String(Math.max(0, row.auto_count - row.driver_count)),
    row.rate.toFixed(1),
    String(Math.round(row.avg_premium)),
  ]);

  const escapeCsv = (field: string) => {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  };

  const csvText = '\uFEFF' + [headers, ...dataRows].map((line) => line.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const CrossSellOrgTrendChart = memo(function CrossSellOrgTrendChart({
  vehicleCategory,
  seatCoverageLevel,
  granularity,
  filters,
}: CrossSellOrgTrendChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  // ── 图表内部状态 ──────────────────────────────────────────────────────────
  const [coverage, setCoverage] = useState<CoverageCombinationFilter>('交三');
  const [region, setRegion] = useState<RegionType>('local');
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  const regionOrgNames = useMemo<string[] | null | undefined>(() => {
    if (selectedOrg) return undefined;
    if (region === 'province') return null;
    return [...REGION_ORGS[region]];
  }, [region, selectedOrg]);

  // 切换区域时清除机构选择
  const handleRegionChange = (r: RegionType) => {
    setRegion(r);
    setSelectedOrg(null);
  };

  const handleOrgToggle = (org: string) => {
    setSelectedOrg((prev) => (prev === org ? null : org));
  };

  // ── 数据 ──────────────────────────────────────────────────────────────────
  const { rows, loading, error } = useCrossSellOrgTrend({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    granularity,
    coverageCombination: coverage,
    selectedOrg,
    regionOrgNames,
  });

  // ── 程序解读（近30天口径） ─────────────────────────────────────────────────
  const rateDigest = useMemo(() => calcMetricDigest(rows, (row) => row.rate), [rows]);
  const premiumDigest = useMemo(() => calcMetricDigest(rows, (row) => row.avg_premium), [rows]);

  // ── AI 解读状态 ────────────────────────────────────────────────────────────
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // 切换险种/机构时清除旧 AI 结论
  useEffect(() => {
    setAiText(null);
    setAiError(null);
  }, [coverage, selectedOrg, region]);

  const handleAiAnalyze = useCallback(async () => {
    if (rows.length === 0) return;
    setAiLoading(true);
    setAiText(null);
    setAiError(null);
    try {
      const result = await apiClient.analyzeTrend({
        rows: rows.slice(-30),
        org: selectedOrg ?? `${REGION_LABELS[region]}汇总`,
        coverage,
      });
      if (result.success) setAiText(result.analysis);
      else setAiError(result.error ?? 'AI 分析失败');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI 分析失败');
    } finally {
      setAiLoading(false);
    }
  }, [rows, coverage, selectedOrg, region]);

  const handleDownloadTable = useCallback(() => {
    if (rows.length === 0) return;
    const now = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orgLabel = selectedOrg ?? `${REGION_LABELS[region]}汇总`;
    const filename = `${now}_机构推介率趋势_${coverage}_${orgLabel}.csv`;
    exportRowsToCsv(rows, filename);
  }, [rows, coverage, selectedOrg, region]);

  // ── ECharts option ────────────────────────────────────────────────────────
  const option = useMemo((): EChartsOption => {
    const dates = rows.map((r) => r.date);
    const autoCounts = rows.map((r) => r.auto_count);
    const nonDriverCounts = rows.map((r) => Math.max(0, r.auto_count - r.driver_count));
    const driverCounts = rows.map((r) => r.driver_count);
    const rates = rows.map((r) => r.rate);
    const avgPremiums = rows.map((r) => r.avg_premium);

    const maxCount = Math.max(...autoCounts, 1);
    const leftMax = Math.ceil(maxCount * 1.45);

    const premiumMin = Math.min(...avgPremiums, 0);
    const premiumMax = Math.max(...avgPremiums, 1);
    const premiumRange = Math.max(1, premiumMax - premiumMin);
    // 让驾乘件均线主要分布在图上方，尽量减少与推介率线交叉
    const premiumAxisMin = Math.max(0, premiumMin - premiumRange * 3);
    const premiumAxisMax = premiumMax + premiumRange * 0.2;
    const premiumLabelVisibility = buildPremiumLabelVisibility(
      rates,
      avgPremiums,
      premiumAxisMin,
      premiumAxisMax
    );

    const zoomStart = rows.length > 14
      ? Math.round(((rows.length - 14) / rows.length) * 100)
      : 0;

    return {
      animation: true,
      grid: { top: 50, right: 126, bottom: 60, left: 56, containLabel: false },
      legend: {
        top: 8,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { fontSize: 12, color: colors.neutral[600] },
        data: [
          { name: '驾意件数', icon: 'rect' },
          { name: '非驾意件数', icon: 'rect' },
          { name: '推介率', icon: 'circle' },
          { name: '驾乘件均', icon: 'circle' },
        ],
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const points = Array.isArray(params) ? params : [params];
          const date = points[0]?.axisValue ?? '';
          const lines = points.map((item: any) => {
            const val = item.seriesName === '推介率'
              ? `${Number(item.value ?? 0).toFixed(1)}%`
              : item.seriesName === '驾乘件均'
                ? `${Math.round(Number(item.value ?? 0))}元`
                : item.seriesName === '驾意件数'
                  ? `${Number(item.value ?? 0)}件`
                  : `${Number(item.value ?? 0)}件（非驾意）`;
            return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:4px"></span>${item.seriesName}: <b>${val}</b>`;
          });
          return `<div style="font-size:12px"><b>${date}</b><br/>${lines.join('<br/>')}</div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: {
          fontSize: 11,
          color: colors.neutral[500],
          formatter: (val: string) => formatTrendDailyXAxis(val),
          rich: TREND_DAILY_XAXIS_RICH,
        },
        axisLine: { lineStyle: { color: colors.neutral[200] } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '件数(件)',
          nameTextStyle: { fontSize: 11, color: colors.neutral[500] },
          max: leftMax,
          splitLine: { lineStyle: { color: colors.neutral[100] } },
          axisLabel: { fontSize: 11, color: colors.neutral[500] },
        },
        {
          type: 'value',
          name: '推介率(%)',
          position: 'right',
          min: 0,
          max: 100,
          alignTicks: true,
          nameTextStyle: { fontSize: 11, color: LINE_RATE_COLOR },
          axisLine: { show: true, lineStyle: { color: LINE_RATE_COLOR } },
          splitLine: { show: false },
          axisLabel: {
            fontSize: 11,
            color: LINE_RATE_COLOR,
            formatter: (v: number) => `${v}%`,
          },
        },
        {
          type: 'value',
          name: '驾乘件均(元)',
          position: 'right',
          offset: 62,
          min: premiumAxisMin,
          max: premiumAxisMax,
          alignTicks: true,
          nameTextStyle: { fontSize: 11, color: LINE_AVG_PREMIUM_COLOR },
          axisLine: { show: true, lineStyle: { color: LINE_AVG_PREMIUM_COLOR } },
          splitLine: { show: false },
          axisLabel: {
            fontSize: 11,
            color: LINE_AVG_PREMIUM_COLOR,
            formatter: (v: number) => `${Math.round(v)}`,
          },
        },
      ],
      series: [
        {
          name: '驾意件数',
          type: 'bar',
          stack: 'count',
          data: driverCounts,
          itemStyle: { color: BAR_DRIVER_COLOR },
          barMaxWidth: 28,
        },
        {
          name: '非驾意件数',
          type: 'bar',
          stack: 'count',
          data: nonDriverCounts,
          itemStyle: { color: BAR_AUTO_COLOR },
          barMaxWidth: 28,
        },
        {
          name: '推介率',
          type: 'line',
          yAxisIndex: 1,
          z: 4,
          data: rates,
          smooth: false,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: LINE_RATE_COLOR, width: 2 },
          itemStyle: { color: LINE_RATE_COLOR, borderWidth: 2, borderColor: '#fff' },
          label: {
            show: true,
            position: 'top',
            formatter: (p: any) => `${Number(p.value ?? 0).toFixed(1)}%`,
            fontSize: 10,
            color: colors.warning.dark,
            fontWeight: 600,
          },
          labelLayout: { hideOverlap: true },
        },
        {
          name: '驾乘件均',
          type: 'line',
          yAxisIndex: 2,
          z: 5,
          data: avgPremiums,
          smooth: false,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: LINE_AVG_PREMIUM_COLOR, width: 2 },
          itemStyle: { color: LINE_AVG_PREMIUM_COLOR, borderWidth: 2, borderColor: '#fff' },
          label: {
            show: true,
            position: 'top',
            distance: 2,
            formatter: (p: any) => {
              const index = Number(p.dataIndex ?? -1);
              if (!premiumLabelVisibility[index]) return '';
              return `${Math.round(Number(p.value ?? 0))}元`;
            },
            fontSize: 10,
            color: colors.primary.dark,
            fontWeight: 600,
          },
          labelLayout: { hideOverlap: true },
        },
      ],
      dataZoom: [
        {
          type: 'slider',
          bottom: 4,
          height: 18,
          start: zoomStart,
          end: 100,
          borderColor: 'transparent',
          fillerColor: `${colors.primary.DEFAULT}22`,
          handleStyle: { color: colors.primary.DEFAULT },
          textStyle: { color: colors.neutral[400], fontSize: 10 },
        },
      ],
    };
  }, [rows]);

  // ── ECharts 初始化与更新 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    chartInstanceRef.current.setOption(option, { notMerge: false });
  }, [option]);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  // ── 当前区域的机构列表 ────────────────────────────────────────────────────
  const orgList = REGION_ORGS[region];
  const displayTitle = selectedOrg
    ? `机构驾意险推介率走势图（${coverage}）— ${selectedOrg}`
    : `机构驾意险推介率走势图（${coverage}）— ${REGION_LABELS[region]}汇总`;

  return (
    <div className={cn(cardStyles.spacious, 'mt-4')}>
      {/* 标题 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-700">{displayTitle}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('chart')}
            className={cn(
              buttonStyles.base,
              buttonStyles.sizeSmall,
              viewMode === 'chart' ? buttonStyles.primary : buttonStyles.secondary
            )}
          >
            图表视图
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              buttonStyles.base,
              buttonStyles.sizeSmall,
              viewMode === 'table' ? buttonStyles.primary : buttonStyles.secondary
            )}
          >
            表格视图
          </button>
          <button
            onClick={handleDownloadTable}
            disabled={rows.length === 0}
            className={cn(buttonStyles.base, buttonStyles.secondary, buttonStyles.sizeSmall)}
          >
            下载表格
          </button>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* 险种 */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-neutral-500 mr-1">险种</span>
          {COVERAGE_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setCoverage(tab)}
              className={cn(
                'px-2.5 py-0.5 rounded text-xs font-medium transition-colors',
                coverage === tab
                  ? 'bg-primary text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* 区域 */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-neutral-500 mr-1">区域</span>
          {(Object.entries(REGION_LABELS) as [RegionType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleRegionChange(key)}
              className={cn(
                'px-2.5 py-0.5 rounded text-xs font-medium transition-colors',
                region === key
                  ? 'bg-primary text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 机构快捷点选 */}
        <div className="flex flex-wrap items-center gap-1">
          {orgList.map((org) => (
            <button
              key={org}
              onClick={() => handleOrgToggle(org)}
              className={cn(
                'px-2 py-0.5 rounded text-xs transition-colors',
                selectedOrg === org
                  ? 'bg-success text-white font-medium'
                  : 'bg-neutral-50 border border-neutral-200 text-neutral-500 hover:border-neutral-400'
              )}
            >
              {org}
            </button>
          ))}
        </div>
      </div>

      {/* 图表区 / 表格区 */}
      {viewMode === 'chart' ? (
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10 rounded">
              <span className="text-xs text-neutral-400">加载中…</span>
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center h-48 text-xs text-danger-500">
              {error}
            </div>
          )}
          <div ref={chartRef} style={{ height: 300, width: '100%' }} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          {error && !loading && <div className="p-4 text-xs text-danger">{error}</div>}
          <table className={cn(tableStyles.container, 'w-full border-0 shadow-none')}>
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>日期</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>车险件数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>驾意件数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>非驾意件数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>推介率</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>驾乘件均</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className={tableStyles.row}>
                  <td className={tableStyles.cell}>{row.date}</td>
                  <td className={cn(tableStyles.cellNumeric, textStyles.numeric)}>{formatCount(row.auto_count)}件</td>
                  <td className={cn(tableStyles.cellNumeric, textStyles.numeric)}>{formatCount(row.driver_count)}件</td>
                  <td className={cn(tableStyles.cellNumeric, textStyles.numeric)}>{formatCount(Math.max(0, row.auto_count - row.driver_count))}件</td>
                  <td className={cn(tableStyles.cellNumeric, textStyles.numeric)}>{formatPercent(row.rate)}</td>
                  <td className={cn(tableStyles.cellNumeric, textStyles.numeric)}>{formatCount(Math.round(row.avg_premium))}元</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td className={cn(tableStyles.cell, 'text-center')} colSpan={6}>暂无数据</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td className={cn(tableStyles.cell, 'text-center')} colSpan={6}>加载中…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 程序解读 + AI 解读 ─────────────────────────────────────────────── */}
      {(rateDigest || premiumDigest) && !loading && (
        <div className="mt-3 rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-neutral-600">程序解读（近30天口径）</span>
            <button
              onClick={handleAiAnalyze}
              disabled={aiLoading}
              className={cn(
                'ml-auto flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                aiLoading
                  ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                  : 'bg-primary-bg text-primary-dark border border-primary-border hover:bg-blue-100'
              )}
            >
              {aiLoading ? '分析中…' : '✨ AI 深度解读'}
            </button>
          </div>

          {rateDigest && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              推介率：近30天均值 {rateDigest.avg30.toFixed(1)}%，近7天均值 {rateDigest.avg7.toFixed(1)}%，连续下降
              {rateDigest.consecutiveDownDays}天，最高 {rateDigest.maxPoint.value.toFixed(1)}%（{shortDate(rateDigest.maxPoint.date)}），最低
              {rateDigest.minPoint.value.toFixed(1)}%（{shortDate(rateDigest.minPoint.date)}）。
            </p>
          )}

          {premiumDigest && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              驾乘件均：近30天均值 {Math.round(premiumDigest.avg30)}元，近7天均值 {Math.round(premiumDigest.avg7)}元，连续下降
              {premiumDigest.consecutiveDownDays}天，最高 {Math.round(premiumDigest.maxPoint.value)}元（{shortDate(premiumDigest.maxPoint.date)}），最低
              {Math.round(premiumDigest.minPoint.value)}元（{shortDate(premiumDigest.minPoint.date)}）。
            </p>
          )}

          {aiError && (
            <p className="mt-2 text-xs text-danger border-t border-neutral-200 pt-2">{aiError}</p>
          )}
          {aiText && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600 whitespace-pre-line border-t border-neutral-200 pt-2">
              {aiText}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
