/**
 * 商业险续保追踪页面（主站版）
 *
 * 数据源：/api/query/renewal-tracker（后端 DuckDB 查询 RenewalTrackerFact 派生域）
 * 筛选器：
 *   - 基础维度（机构/业务员/客户类别）共享主站 FilterProvider
 *   - 快捷筛选（车型/能源/险别/新转续/过户）通过 QuickFilterBar → FilterProvider 双向同步
 *   - 时间维度（按到期日）独立本地 state（语义不同于主站 policy_date）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { cn, colorClasses } from '@/shared/styles';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal } from '@/shared/utils/quickFilterHelpers';
import { useRenewalTracker } from './hooks/useRenewalTracker';
import TimeFilter from './components/TimeFilter';
import OverviewBand from './components/OverviewBand';
import OrgTable from './components/OrgTable';
import CategoryTable from './components/CategoryTable';
import type { TimeView, SortField, SortDir, TimeRange, Selection } from './types';

export default function RenewalTrackerPage() {
  const { filters, setFilters, maxDataDate } = useGlobalFilters();
  const latestDataDate = maxDataDate || new Date().toISOString().slice(0, 10);

  const [timeView, setTimeView] = useState<TimeView>('ytd');
  const [timeRange, setTimeRange] = useState<TimeRange | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'overall' });
  // 默认按主题指标「续保率」从差到好排（升序）—— 最差的机构置顶，让「差」一眼可见
  const [sortField, setSortField] = useState<SortField>('E');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // 初始化 timeRange（YTD 默认）
  useEffect(() => {
    if (!latestDataDate || timeRange) return;
    const year = latestDataDate.slice(0, 4);
    setTimeRange({
      start: `${year}-01-01`,
      end: latestDataDate,
      cutoff: latestDataDate,
    });
  }, [latestDataDate, timeRange]);

  const { data, isLoading, isFetching, error } = useRenewalTracker(timeRange);

  const handleTimeChange = useCallback((range: TimeRange) => {
    setSelection({ kind: 'overall' });
    setTimeRange(range);
  }, []);

  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      // 率值默认升序（最差置顶）；件数默认降序（最大置顶）
      setSortDir(field === 'D' || field === 'E' ? 'asc' : 'desc');
    }
  }, [sortField]);

  const handleClearSelection = useCallback(() => setSelection({ kind: 'overall' }), []);

  const handleSelectOrg = useCallback((org: string) => {
    setSelection(prev =>
      prev.kind !== 'overall' && prev.org === org ? { kind: 'overall' } : { kind: 'org', org }
    );
  }, []);

  const quickFilters = useMemo(
    () => deriveQuickFilters(filters),
    [
      filters.vehicle_quick_filter,
      filters.enterprise_car,
      filters.is_nev,
      filters.fuel_category,
      filters.is_new_car,
      filters.is_renewal,
      filters.business_nature,
      filters.is_transfer,
      filters.coverage_combination,
      filters.insurance_type,
    ]
  );

  const handleQuickFilterChange = useCallback(
    (newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
      setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
    },
    [setFilters]
  );

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className={cn('text-2xl font-bold', colorClasses.text.neutralBlack)}>商业险续保追踪</h1>
        <p className={cn('text-sm mt-1', colorClasses.text.neutralMuted)}>
          筛选范围：上年度起保的商业险保单，按到期日统计 · 指标以车架号去重
        </p>
      </div>

      <div className="mb-4">
        <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      </div>

      <TimeFilter
        meta={data?.meta ?? null}
        latestDataDate={latestDataDate}
        timeView={timeView}
        onViewChange={setTimeView}
        onTimeChange={handleTimeChange}
      />

      {error && (
        <div className={cn(colorClasses.bg.warning, colorClasses.border.warning, colorClasses.text.warningDark, 'border rounded-lg p-3 mb-4 text-sm')}>
          查询错误: {(error as Error).message}
        </div>
      )}

      {(isLoading || (isFetching && !data)) && (
        <div className={cn('text-center py-8 text-sm', colorClasses.text.neutralMuted)}>查询中...</div>
      )}

      {data && (
        <div className={isFetching ? 'opacity-50 pointer-events-none' : ''}>
          <OverviewBand
            overall={data.overall}
            orgRows={data.orgRows}
            selection={selection}
            onSelectOrg={handleSelectOrg}
          />
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3">
            <OrgTable
              rows={data.orgRows}
              overall={data.overall}
              selection={selection}
              onSelectionChange={setSelection}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </div>
          <div className="xl:col-span-2">
            <CategoryTable
              selection={selection}
              overall={data.overall}
              orgRows={data.orgRows}
              categoryRows={data.categoryRows}
              coverageRows={data.coverageRows}
              fuelRows={data.fuelRows}
              usedTransferRows={data.usedTransferRows}
              renewalTypeRows={data.renewalTypeRows}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              onClearSelection={handleClearSelection}
            />
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
