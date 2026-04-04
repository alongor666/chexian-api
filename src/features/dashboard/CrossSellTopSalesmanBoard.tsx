/**
 * TOP20 业务员推介率看板 (主全 / 交三)
 * Cross-Sell Top Salesman Board
 *
 * 布局原则：
 * - 主全/交三标签切换
 * - 结论先行（图表/列表上方）
 * - 图表与列表二选一展示
 */

import { memo, useState, useCallback, useMemo } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { useCrossSellTopSalesman, type TopSalesmanRow } from './hooks/useCrossSellTopSalesman';
import type { SeatCoverageLevel, VehicleCategory } from './hooks/useCrossSellTimePeriod';
import { formatCount, formatPercent, formatDriverPremiumWan } from '@/shared/utils/formatters';
import { cardStyles, textStyles, buttonStyles, colorClasses, cn } from '@/shared/styles';
import { TopSalesmanQuadrantChart } from './TopSalesmanQuadrantChart';
import type { TrendGranularity } from './hooks/useCrossSellTrend';
import { getRateClassByField, getAvgPremiumClassByCoverage } from './crossSellRateStatus';
import { prepareExportData, exportToCSV, downloadCSV, generateExportFilename } from './utils/crossSellExport';

interface TopSalesmanBoardProps {
  filters: AdvancedFilterState;
  vehicleCategory: VehicleCategory;
  seatCoverageLevel?: SeatCoverageLevel;
  timePeriod: TrendGranularity;
  prefetchedTopSalesman?: {
    zhuquanRows: TopSalesmanRow[];
    jiaosanRows: TopSalesmanRow[];
  };
}

type CoverageType = '主全' | '交三';
type SortField = 'org_level_3' | 'driver_premium' | 'auto_count' | 'avg_premium' | 'rate';
type SortOrder = 'asc' | 'desc';
type ViewMode = 'table' | 'chart';

type QuadrantGroupKey =
  | 'dual_weak'
  | 'rate_weak_avg_excellent'
  | 'rate_excellent_avg_weak'
  | 'dual_excellent';

interface QuadrantSection {
  key: QuadrantGroupKey;
  title: string;
  count: number;
  names: string[];
}

interface CoverageInsight {
  rateThreshold: number;
  avgPremiumThreshold: number;
  sections: QuadrantSection[];
}

const TIME_PERIOD_LABELS: Record<TrendGranularity, string> = {
  daily: '当日',
  weekly: '当周',
  monthly: '当月',
  quarterly: '当季',
  yearly: '当年',
};

const COVERAGE_THRESHOLDS: Record<CoverageType, { rate: number; avgPremium: number }> = {
  主全: { rate: 75, avgPremium: 333 },
  交三: { rate: 60, avgPremium: 222 },
};

function classifyQuadrantByThreshold(
  row: TopSalesmanRow,
  threshold: { rate: number; avgPremium: number }
): QuadrantGroupKey {
  const rateGood = row.rate >= threshold.rate;
  const avgGood = row.avg_premium >= threshold.avgPremium;

  if (rateGood && avgGood) return 'dual_excellent';
  if (!rateGood && avgGood) return 'rate_weak_avg_excellent';
  if (rateGood && !avgGood) return 'rate_excellent_avg_weak';
  return 'dual_weak';
}

function buildCoverageInsight(data: TopSalesmanRow[], coverage: CoverageType): CoverageInsight {
  const threshold = COVERAGE_THRESHOLDS[coverage];
  const groups: Record<QuadrantGroupKey, TopSalesmanRow[]> = {
    dual_weak: [],
    rate_weak_avg_excellent: [],
    rate_excellent_avg_weak: [],
    dual_excellent: [],
  };

  data.forEach((row) => {
    const quadrant = classifyQuadrantByThreshold(row, threshold);
    groups[quadrant].push(row);
  });

  const sections: QuadrantSection[] = [
    {
      key: 'dual_weak',
      title: '推介与件均双差',
      count: groups.dual_weak.length,
      names: groups.dual_weak
        .sort((a, b) => a.rate - b.rate)
        .map((row) => row.salesman_name),
    },
    {
      key: 'rate_weak_avg_excellent',
      title: '推介差、件均优',
      count: groups.rate_weak_avg_excellent.length,
      names: groups.rate_weak_avg_excellent
        .sort((a, b) => a.rate - b.rate)
        .map((row) => row.salesman_name),
    },
    {
      key: 'rate_excellent_avg_weak',
      title: '推介优、件均差',
      count: groups.rate_excellent_avg_weak.length,
      names: groups.rate_excellent_avg_weak
        .sort((a, b) => a.rate - b.rate)
        .map((row) => row.salesman_name),
    },
    {
      key: 'dual_excellent',
      title: '推介与件均双优',
      count: groups.dual_excellent.length,
      names: groups.dual_excellent
        .sort((a, b) => b.rate - a.rate)
        .map((row) => row.salesman_name),
    },
  ];

  return {
    rateThreshold: threshold.rate,
    avgPremiumThreshold: threshold.avgPremium,
    sections,
  };
}

export const CrossSellTopSalesmanBoard = memo(function CrossSellTopSalesmanBoard({
  filters,
  vehicleCategory,
  seatCoverageLevel,
  timePeriod,
  prefetchedTopSalesman,
}: TopSalesmanBoardProps) {
  const [activeCoverage, setActiveCoverage] = useState<CoverageType>('主全');

  const zhuquanResult = useCrossSellTopSalesman({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    coverage: '主全',
    timePeriod,
    enabled: !prefetchedTopSalesman,
  });

  const jiaosanResult = useCrossSellTopSalesman({
    filters,
    vehicleCategory,
    seatCoverageLevel,
    coverage: '交三',
    timePeriod,
    enabled: !prefetchedTopSalesman,
  });
  const zhuquanData = prefetchedTopSalesman?.zhuquanRows ?? zhuquanResult.data;
  const jiaosanData = prefetchedTopSalesman?.jiaosanRows ?? jiaosanResult.data;
  const hasData = zhuquanData.length > 0 || jiaosanData.length > 0;
  const loading = prefetchedTopSalesman ? false : (zhuquanResult.loading || jiaosanResult.loading);

  const activeResult = activeCoverage === '主全'
    ? { data: zhuquanData, loading, error: zhuquanResult.error }
    : { data: jiaosanData, loading, error: jiaosanResult.error };

  const handleExport = useCallback(() => {
    if (!hasData) return;

    const exportData = prepareExportData(zhuquanData, jiaosanData);
    const csvContent = exportToCSV(exportData);
    const filename = generateExportFilename(TIME_PERIOD_LABELS[timePeriod]);
    downloadCSV(csvContent, filename);
  }, [zhuquanData, jiaosanData, timePeriod, hasData]);

  return (
    <div className="space-y-4">
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h3 className={cn(textStyles.titleMedium, 'text-neutral-900')}>TOP20 业务员分析</h3>
            <p className={cn(textStyles.caption, 'text-neutral-500')}>
              结论先行，支持主全/交三标签切换（统计时间：{TIME_PERIOD_LABELS[timePeriod]}）
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-1">
              {(['主全', '交三'] as CoverageType[]).map((coverage) => (
                <button
                  key={coverage}
                  onClick={() => setActiveCoverage(coverage)}
                  className={cn(
                    buttonStyles.base,
                    'h-8 px-3 text-sm',
                    activeCoverage === coverage
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                      : 'border-transparent bg-transparent text-neutral-500 hover:text-neutral-700'
                  )}
                >
                  {coverage}
                </button>
              ))}
            </div>

            <button
              onClick={handleExport}
              disabled={!hasData || loading}
              className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall)}
            >
              导出CSV
            </button>
          </div>
        </div>
      </div>

      <SalesmanPanel
        title={`${activeCoverage} TOP 20`}
        coverage={activeCoverage}
        data={activeResult.data}
        loading={activeResult.loading}
        error={activeResult.error}
        timePeriodLabel={TIME_PERIOD_LABELS[timePeriod]}
        rateThreshold={COVERAGE_THRESHOLDS[activeCoverage].rate}
        avgPremiumThreshold={COVERAGE_THRESHOLDS[activeCoverage].avgPremium}
      />
    </div>
  );
});

const SalesmanPanel = memo(function SalesmanPanel({
  title,
  coverage,
  data,
  loading,
  error,
  timePeriodLabel,
  rateThreshold,
  avgPremiumThreshold,
}: {
  title: string;
  coverage: CoverageType;
  data: TopSalesmanRow[];
  loading: boolean;
  error: string | null;
  timePeriodLabel: string;
  rateThreshold: number;
  avgPremiumThreshold: number;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [sortField, setSortField] = useState<SortField>('rate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortOrder(field === 'rate' ? 'asc' : 'desc');
  };

  const insight = useMemo(() => buildCoverageInsight(data, coverage), [data, coverage]);

  const sortedData = useMemo(() => {
    const cloned = [...data];
    cloned.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }

      const aNumeric = Number(aValue) || 0;
      const bNumeric = Number(bValue) || 0;
      return sortOrder === 'asc' ? aNumeric - bNumeric : bNumeric - aNumeric;
    });
    return cloned;
  }, [data, sortField, sortOrder]);

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden border border-neutral-200')}>
      <div className="flex flex-col gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <h4 className={cn(textStyles.body, 'font-semibold text-neutral-800')}>{title}</h4>
        <div className="inline-flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-0.5">
          <button
            onClick={() => setViewMode('chart')}
            className={cn(
              buttonStyles.base,
              'h-8 px-3 text-xs',
              viewMode === 'chart'
                ? 'bg-primary text-white shadow-sm'
                : 'border-transparent bg-transparent text-neutral-500 hover:text-neutral-700'
            )}
          >
            分布图
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              buttonStyles.base,
              'h-8 px-3 text-xs',
              viewMode === 'table'
                ? 'bg-primary text-white shadow-sm'
                : 'border-transparent bg-transparent text-neutral-500 hover:text-neutral-700'
            )}
          >
            列表
          </button>
        </div>
      </div>

      <div className={cn(cardStyles.compact, 'm-4 border border-neutral-200 bg-neutral-50')}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className={cn(textStyles.label, 'text-neutral-800')}>分析结论（{timePeriodLabel}）</p>
          <p className={cn(textStyles.caption, 'text-neutral-500')}>
            阈值：推介率 {formatPercent(insight.rateThreshold)} / 件均 {formatCount(insight.avgPremiumThreshold)}元
          </p>
        </div>
        <div className="mt-2 space-y-1.5">
          {insight.sections.map((section, index) => (
            <p key={section.key} className={cn(textStyles.caption, 'text-neutral-700')}>
              {index + 1}、{section.title}（{section.count}人）：
              <span className={cn('ml-1', section.names.length > 0 ? 'text-neutral-800' : colorClasses.text.neutralMuted)}>
                {section.names.length > 0 ? section.names.join('、') : '暂无'}
              </span>
            </p>
          ))}
        </div>
      </div>

      <div className="relative h-[440px] overflow-hidden p-4 pt-0">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        )}

        {error && <div className="flex h-full items-center justify-center text-sm text-danger">加载失败: {error}</div>}

        {!loading && !error && data.length === 0 && (
          <div className="flex h-full items-center justify-center text-neutral-400">暂无业务员数据</div>
        )}

        {!error && data.length > 0 && viewMode === 'table' && (
          <div className="h-full overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-neutral-500">业务员</th>
                  <th
                    className="cursor-pointer whitespace-nowrap px-3 py-2.5 font-medium text-neutral-500 hover:bg-neutral-50"
                    onClick={() => handleSort('org_level_3')}
                  >
                    三级机构 {sortField === 'org_level_3' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-right font-medium text-neutral-500 hover:bg-neutral-50"
                    onClick={() => handleSort('driver_premium')}
                  >
                    驾意保费-万 {sortField === 'driver_premium' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-right font-medium text-neutral-500 hover:bg-neutral-50"
                    onClick={() => handleSort('auto_count')}
                  >
                    车险件数 {sortField === 'auto_count' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-right font-medium text-neutral-500 hover:bg-neutral-50"
                    onClick={() => handleSort('rate')}
                  >
                    推介率 {sortField === 'rate' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-right font-medium text-neutral-500 hover:bg-neutral-50"
                    onClick={() => handleSort('avg_premium')}
                  >
                    驾意件均-元 {sortField === 'avg_premium' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sortedData.map((row, idx) => (
                  <tr key={`${row.salesman_name}-${idx}`} className="transition-colors hover:bg-neutral-50/50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-neutral-900">{row.salesman_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{row.org_level_3}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-neutral-900">
                      {formatDriverPremiumWan(row.driver_premium)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-neutral-900">
                      {formatCount(row.auto_count)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap px-3 py-2 text-right font-medium',
                        getRateClassByField(coverage === '主全' ? 'zhuquan_rate' : 'jiaosan_rate', row.rate)
                      )}
                    >
                      {formatPercent(row.rate)}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap px-3 py-2 text-right font-medium',
                        getAvgPremiumClassByCoverage(coverage, row.avg_premium)
                      )}
                    >
                      {formatCount(row.avg_premium)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && data.length > 0 && viewMode === 'chart' && (
          <div className="h-full w-full">
            <TopSalesmanQuadrantChart
              data={data}
              coverage={coverage}
              rateThreshold={rateThreshold}
              avgPremiumThreshold={avgPremiumThreshold}
            />
          </div>
        )}
      </div>
    </div>
  );
});
