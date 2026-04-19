/**
 * 商业险续保追踪页面（主站版）
 *
 * 数据源：/api/query/renewal-tracker（后端 DuckDB 查询 RenewalTrackerFact 派生域）
 * 筛选器：机构/业务员/客户类别 共享主站 FilterProvider（见 useRenewalTracker hook）
 *         时间维度（按到期日）独立本地 state（语义不同于主站 policy_date）
 *
 * 迁移自 数据管理/renewal-tracker（独立 Vite + DuckDB-WASM 项目），
 * 方案 A + Z：吸收合并到主站，成为续保功能并回主站的第一步（2026-04-19）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { cn, colorClasses } from '@/shared/styles';
import { useRenewalTracker } from './hooks/useRenewalTracker';
import TimeFilter from './components/TimeFilter';
import OrgTable from './components/OrgTable';
import CategoryTable from './components/CategoryTable';
import type { TimeView, SortField, SortDir, TimeRange } from './types';

export default function RenewalTrackerPage() {
  const { maxDataDate } = useGlobalFilters();
  const latestDataDate = maxDataDate || new Date().toISOString().slice(0, 10);

  const [timeView, setTimeView] = useState<TimeView>('ytd');
  const [timeRange, setTimeRange] = useState<TimeRange | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('A');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
    setSelectedOrg(null);
    setTimeRange(range);
  }, []);

  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

  const orgOverall = useMemo(() => {
    if (!selectedOrg || !data) return null;
    return data.orgRows.find(r => r.row_level === 'org' && r.org_level_3 === selectedOrg) || null;
  }, [selectedOrg, data]);

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className={cn('text-2xl font-bold', colorClasses.text.neutralBlack)}>商业险续保追踪</h1>
        <p className={cn('text-sm mt-1', colorClasses.text.neutralMuted)}>
          筛选范围：上年度起保的商业险保单，按到期日统计 · 指标以车架号去重
        </p>
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
        <div className={`grid grid-cols-1 xl:grid-cols-5 gap-4 ${isFetching ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="xl:col-span-3">
            <OrgTable
              rows={data.orgRows}
              overall={data.overall}
              selectedOrg={selectedOrg}
              onOrgSelect={setSelectedOrg}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </div>
          <div className="xl:col-span-2">
            <CategoryTable
              rows={data.categoryRows}
              overall={data.overall}
              orgOverall={orgOverall}
              selectedOrg={selectedOrg}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </div>
        </div>
      )}
    </div>
  );
}
