/**
 * 机构推介率走势图
 *
 * 叠加柱（灰色=车险件数底层，绿色=驾意件数上叠）+ 右Y轴推介率折线
 * X 轴：最近连续 14 天
 * 险种：交三 / 主全 / 单交 标签切换
 * 机构：同城 / 异地 快捷点选
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../shared/utils/echarts';
import { formatTrendDailyXAxis, TREND_DAILY_XAXIS_RICH } from '../../shared/utils/formatters';
import { cardStyles, colors, cn } from '../../shared/styles';
import { ORG_GROUPS } from '../../shared/config/coefficient-thresholds';
import { useCrossSellOrgTrend, type CoverageCombinationFilter } from './hooks/useCrossSellOrgTrend';
import { calcTrendStats, type TrendStats } from './utils/orgTrendStats';
import { apiClient } from '../../shared/api/client';
import type { AdvancedFilterState } from '../../shared/types/data';
import type { VehicleCategory } from './hooks/useCrossSellTimePeriod';

interface CrossSellOrgTrendChartProps {
  vehicleCategory: VehicleCategory;
  filters: AdvancedFilterState;
}

/** 险种标签 */
const COVERAGE_TABS: CoverageCombinationFilter[] = ['交三', '主全', '单交'];

/** 机构区域定义 */
type RegionType = 'local' | 'remote';

const REGION_LABELS: Record<RegionType, string> = { local: '同城', remote: '异地' };
const REGION_ORGS: Record<RegionType, readonly string[]> = {
  local: ORG_GROUPS.SAME_CITY,
  remote: ORG_GROUPS.REMOTE,
};

// ── 颜色 ──────────────────────────────────────────────────────────────────────
const BAR_AUTO_COLOR = colors.neutral[300];   // 灰色：车险件数（底层）
const BAR_DRIVER_COLOR = colors.success.DEFAULT; // 绿色：驾意件数（上叠）
const LINE_RATE_COLOR = colors.warning.DEFAULT;  // 橙色：推介率折线

export const CrossSellOrgTrendChart = memo(function CrossSellOrgTrendChart({
  vehicleCategory,
  filters,
}: CrossSellOrgTrendChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  // ── 图表内部状态 ──────────────────────────────────────────────────────────
  const [coverage, setCoverage] = useState<CoverageCombinationFilter>('交三');
  const [region, setRegion] = useState<RegionType>('local');
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);

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
    coverageCombination: coverage,
    selectedOrg,
  });

  // ── 程序统计摘要（零延迟，仅取最新 14 天显示窗口数据计算） ──────────────────
  const stats: TrendStats | null = useMemo(() => calcTrendStats(rows.slice(-14)), [rows]);

  // ── AI 解读状态 ────────────────────────────────────────────────────────────
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // 切换险种/机构时清除旧 AI 结论
  useEffect(() => { setAiText(null); setAiError(null); }, [coverage, selectedOrg, region]);

  const handleAiAnalyze = useCallback(async () => {
    if (rows.length === 0) return;
    setAiLoading(true);
    setAiText(null);
    setAiError(null);
    try {
      const result = await apiClient.analyzeTrend({
        rows: rows.slice(-14),
        org: selectedOrg ?? (region === 'local' ? '同城汇总' : '异地汇总'),
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

  // ── ECharts option ────────────────────────────────────────────────────────
  const option = useMemo((): EChartsOption => {
    const dates = rows.map((r) => r.date);
    const autoCounts = rows.map((r) => r.auto_count);
    // 灰色底层：纯车险部分（总件数 - 驾意件数），叠加后总高度 = auto_count
    const nonDriverCounts = rows.map((r) => Math.max(0, r.auto_count - r.driver_count));
    const driverCounts = rows.map((r) => r.driver_count);
    const rates = rows.map((r) => r.rate);

    const maxCount = Math.max(...autoCounts, 1);
    const leftMax = Math.ceil(maxCount * 1.45); // 为折线留出上方空间

    return {
      animation: true,
      grid: { top: 50, right: 64, bottom: 60, left: 56, containLabel: false },
      legend: {
        top: 8,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { fontSize: 12, color: colors.neutral[600] },
        data: [
          { name: '驾意件数', icon: 'rect' },
          { name: '非驾意件数', icon: 'rect' },
          { name: '推介率', icon: 'circle' },
        ],
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params : [params];
          const date = p[0]?.axisValue ?? '';
          const lines = p.map((item: any) => {
            const val = item.seriesName === '推介率'
              ? `${Number(item.value ?? 0).toFixed(1)}%`
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
          nameTextStyle: { fontSize: 11, color: colors.neutral[500] },
          min: 0,
          max: 100,
          splitLine: { show: false },
          axisLabel: {
            fontSize: 11,
            color: colors.neutral[500],
            formatter: (v: number) => `${v}%`,
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
        },
      ],
      dataZoom: [
        {
          type: 'slider',
          bottom: 4,
          height: 18,
          // 默认展示最后 14 天，可向左滚动查看最多 90 天
          start: Math.round((90 - 14) / 90 * 100),
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
    const handler = () => chart.resize();
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
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
    ? `机构推介率走势图 — ${selectedOrg}`
    : `机构推介率走势图 — ${REGION_LABELS[region]}汇总`;

  return (
    <div className={cn(cardStyles.spacious, 'mt-4')}>
      {/* 标题 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-700">{displayTitle}</span>
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
                region === key && !selectedOrg
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

      {/* 图表区 */}
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

      {/* ── 程序摘要 + AI 解读 ───────────────────────────────────────────── */}
      {stats && !loading && (
        <div className="mt-3 rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
          {/* 摘要指标行 */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
            {/* 均值 */}
            <span className="text-neutral-500">
              近14天均值&nbsp;
              <span className="font-semibold text-neutral-800">{stats.avgRate}%</span>
            </span>

            {/* 近3天变化 */}
            <span className="text-neutral-500">
              近3天&nbsp;
              <span className="font-semibold text-neutral-800">{stats.recent3Avg}%</span>
              &nbsp;
              <span className={cn(
                'font-medium',
                stats.changeVsPrev > 0 ? 'text-success-dark' : stats.changeVsPrev < 0 ? 'text-danger' : 'text-neutral-500'
              )}>
                {stats.changeVsPrev > 0 ? '↑' : stats.changeVsPrev < 0 ? '↓' : '→'}
                &nbsp;{Math.abs(stats.changeVsPrev)}pp
              </span>
            </span>

            {/* 连续天数 */}
            {stats.consecutiveDays !== 0 && (
              <span className={cn(
                'font-medium',
                stats.consecutiveDays > 0 ? 'text-success-dark' : 'text-danger'
              )}>
                连续{stats.consecutiveDays > 0 ? '上升' : '下降'}{Math.abs(stats.consecutiveDays)}天
              </span>
            )}

            {/* 最高/最低 */}
            <span className="text-neutral-400">
              最高&nbsp;
              <span className="text-neutral-700">{stats.maxDay.date.slice(5)}&nbsp;·&nbsp;{stats.maxDay.rate}%</span>
            </span>
            <span className="text-neutral-400">
              最低&nbsp;
              <span className="text-neutral-700">{stats.minDay.date.slice(5)}&nbsp;·&nbsp;{stats.minDay.rate}%</span>
            </span>

            {/* AI 按钮（右对齐） */}
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

          {/* AI 分析结果 */}
          {aiError && (
            <p className="mt-2 text-xs text-danger">{aiError}</p>
          )}
          {aiText && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600 border-t border-neutral-200 pt-2">
              {aiText}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
