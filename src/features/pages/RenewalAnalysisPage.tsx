/**
 * 续保分析页面（V2）— 5 Tab 宿主
 *
 * Tab 1: 续保总览 (KPI + 月度走势 + 排名)
 * Tab 2: 转化漏斗 (三级漏斗 + 流失归因)
 * Tab 3: 竞争格局 (流失去向 + 转入来源)
 * Tab 4: 行动看板 (待办清单 + 分页)
 * Tab 5: 巡检报告 (四级亮灯 + 维度分析 + 盲点发现)
 *
 * 使用 renewalAnalysis preset，由 QuickFilterBar 提供快捷组合。
 * 动态标题基于 metadata API 返回的数据截止日。
 * 默认统计区间：应续到期日 [due_year-12-31, latest_data_date-1]。
 */

import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { cn, colorClasses } from '@/shared/styles';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import { useRenewalV2Metadata, type RenewalV2Filters, type DrillStep } from '../renewal-v2/hooks/useRenewalV2';

/** 续保分析可用维度（key 对应后端 groupBy 参数） */
const DRILL_DIMENSIONS = [
  { key: 'org', label: '三级机构' },
  { key: 'salesman', label: '业务员' },
  { key: 'category', label: '客户类别' },
  { key: 'grade', label: '风险等级' },
  { key: 'coverage', label: '险别组合' },
  { key: 'is_new_car', label: '是否新车' },
  { key: 'is_transfer', label: '是否过户' },
  { key: 'is_nev', label: '是否新能源' },
  { key: 'is_telemarketing', label: '是否电销' },
] as const;

const DIMENSION_LABEL_MAP: Record<string, string> = Object.fromEntries(
  DRILL_DIMENSIONS.map(d => [d.key, d.label]),
);

const RenewalOverviewTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalOverviewTab').then(m => ({ default: m.RenewalOverviewTab }))
);
const RenewalFunnelTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalFunnelTab').then(m => ({ default: m.RenewalFunnelTab }))
);
const RenewalCompetitionTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalCompetitionTab').then(m => ({ default: m.RenewalCompetitionTab }))
);
const RenewalActionTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalActionTab').then(m => ({ default: m.RenewalActionTab }))
);
const RenewalPatrolTab = lazy(() =>
  import('../renewal-v2/tabs/RenewalPatrolTab').then(m => ({ default: m.RenewalPatrolTab }))
);

const TABS = [
  { key: 'overview', label: '续保总览' },
  { key: 'funnel', label: '转化漏斗' },
  { key: 'competition', label: '竞争格局' },
  { key: 'action', label: '行动看板' },
  { key: 'patrol', label: '巡检报告' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TAB_TITLES: Record<TabKey, string> = {
  overview: '续保总览',
  funnel: '转化漏斗',
  competition: '竞争格局',
  action: '行动看板',
  patrol: '巡检报告',
};

/**
 * 将全局筛选 + QuickFilterBar + 默认日期范围适配为 RenewalV2Filters
 */
function adaptRenewalFilters(
  globalOrgName: string | undefined,
  quickFilters: { isNev?: boolean; isNewCar?: boolean },
  defaultDateRange: { expiryDateStart?: string; expiryDateEnd?: string },
): RenewalV2Filters {
  const params: RenewalV2Filters = {};
  if (globalOrgName) params.orgName = globalOrgName;
  if (quickFilters.isNev !== undefined) params.isNev = quickFilters.isNev;
  if (quickFilters.isNewCar !== undefined) params.isNewCar = quickFilters.isNewCar;
  if (defaultDateRange.expiryDateStart) params.expiryDateStart = defaultDateRange.expiryDateStart;
  if (defaultDateRange.expiryDateEnd) params.expiryDateEnd = defaultDateRange.expiryDateEnd;
  return params;
}

export function RenewalAnalysisPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [groupBy, setGroupBy] = useState('org');
  const [drillPath, setDrillPath] = useState<DrillStep[]>([]);
  const { filters, setFilters } = useGlobalFilters();
  const { data: metaData } = useRenewalV2Metadata();

  // ── 下钻维度计算 ──
  const usedDimensions = useMemo(
    () => new Set(drillPath.map(s => s.dimension)),
    [drillPath],
  );
  const availableDimensions = useMemo(
    () => DRILL_DIMENSIONS.filter(d => !usedDimensions.has(d.key)),
    [usedDimensions],
  );

  /** 行点击下钻：将当前 groupBy 维度锁定为 WHERE 条件，切换到下一个可用维度 */
  const handleDrill = useCallback((groupName: string) => {
    const step: DrillStep = { dimension: groupBy, value: groupName };
    setDrillPath(prev => [...prev, step]);
    // 自动选下一个可用维度
    const nextUsed = new Set([...usedDimensions, groupBy]);
    const next = DRILL_DIMENSIONS.find(d => !nextUsed.has(d.key));
    if (next) setGroupBy(next.key);
  }, [groupBy, usedDimensions]);

  /** 面包屑回退：-1 = 回到最顶层，否则回到第 index 步 */
  const handleDrillBack = useCallback((index: number) => {
    if (index < 0) {
      setDrillPath([]);
      setGroupBy('org');
    } else {
      setDrillPath(prev => prev.slice(0, index + 1));
      // 恢复到被截断路径下一个可用维度
      const kept = new Set(drillPath.slice(0, index + 1).map(s => s.dimension));
      const next = DRILL_DIMENSIONS.find(d => !kept.has(d.key));
      if (next) setGroupBy(next.key);
    }
  }, [drillPath]);

  // ── 快捷筛选 ──
  const quickFilters = useMemo(
    () => deriveQuickFilters(filters),
    [filters.vehicle_quick_filter, filters.is_nev, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination],
  );

  const handleQuickFilterChange = useCallback(
    (newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
      setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
    },
    [setFilters],
  );

  // ── 动态标题 ──
  const dataYear = useMemo(() => {
    if (!metaData?.latest_data_date) return new Date().getFullYear();
    return new Date(metaData.latest_data_date).getFullYear();
  }, [metaData?.latest_data_date]);

  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    const parts = [label, `${dataYear}年`, `续保分析 — ${TAB_TITLES[activeTab]}`].filter(Boolean);
    return parts.join(' ');
  }, [quickFilters, dataYear, activeTab]);

  // ── 默认统计区间 ──
  // 用户要求：起保日期 [年初, 最新签单日期] → 映射到 expiry_date [due_year-12-31, latest_data_date-1天]
  const defaultDateRange = useMemo(() => {
    if (!metaData?.latest_data_date || !metaData?.due_year) return {};
    const dueYear = metaData.due_year;
    const latestDate = new Date(metaData.latest_data_date);
    latestDate.setDate(latestDate.getDate() - 1);
    return {
      expiryDateStart: `${dueYear}-12-31`,
      expiryDateEnd: latestDate.toISOString().split('T')[0],
    };
  }, [metaData?.latest_data_date, metaData?.due_year]);

  // ── 适配为 RenewalV2Filters（含下钻参数） ──
  const orgName = filters.org_level_3?.[0];
  const renewalFilters: RenewalV2Filters = useMemo(
    () => ({
      ...adaptRenewalFilters(orgName, quickFilters, defaultDateRange),
      groupBy,
      drillPath: drillPath.length > 0 ? drillPath : undefined,
    }),
    [orgName, quickFilters.isNev, quickFilters.isNewCar, defaultDateRange, groupBy, drillPath],
  );

  return (
    <PageFilterPanel
      preset="renewalAnalysis"
      title={dynamicTitle}
      showBasicFilterBar={true}
      anchorSections={[
        { id: 'renewal-quick-filter', label: '快捷筛选' },
        { id: 'renewal-tabs', label: 'Tab 内容' },
      ]}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions} />
      )}
    >
      {/* 数据截止日说明 */}
      {metaData?.latest_data_date && (
        <div className={`text-xs ${colorClasses.text.neutralMuted} mb-2`}>
          数据截至 {metaData.latest_data_date}，应续年份 {metaData.due_year ?? '-'}
          {metaData.total_records != null && `，共 ${metaData.total_records.toLocaleString()} 条应续记录`}
        </div>
      )}

      {/* 快捷筛选栏 */}
      <div id="renewal-quick-filter">
        <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      </div>

      {/* 下钻控制栏 */}
      <div className="flex items-center justify-between gap-3 mb-3">
        {/* 面包屑 */}
        <nav className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
          <button
            onClick={() => handleDrillBack(-1)}
            className={cn(
              'shrink-0 px-2 py-0.5 rounded transition-colors',
              drillPath.length === 0
                ? `font-medium ${colorClasses.text.primary}`
                : `${colorClasses.text.neutralMuted} hover:text-neutral-700`,
            )}
          >
            全部
          </button>
          {drillPath.map((step, i) => (
            <span key={`${step.dimension}-${i}`} className="flex items-center gap-1 shrink-0">
              <span className={colorClasses.text.neutralMuted}>/</span>
              <button
                onClick={() => handleDrillBack(i)}
                className={cn(
                  'px-2 py-0.5 rounded transition-colors',
                  i === drillPath.length - 1
                    ? `font-medium ${colorClasses.text.primary}`
                    : `${colorClasses.text.neutralMuted} hover:text-neutral-700`,
                )}
                title={`${DIMENSION_LABEL_MAP[step.dimension] ?? step.dimension}: ${step.value}`}
              >
                {step.value}
              </button>
            </span>
          ))}
        </nav>

        {/* 维度选择器 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>分组</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="text-sm border rounded-md px-2 py-1 bg-white dark:bg-neutral-800"
          >
            {availableDimensions.map(d => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
          {drillPath.length > 0 && (
            <button
              onClick={() => handleDrillBack(-1)}
              className={`text-xs px-2 py-1 rounded ${colorClasses.text.danger} hover:bg-red-50 dark:hover:bg-red-950 transition-colors`}
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b mb-4" id="renewal-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? `border-primary ${colorClasses.text.primary}`
                : `border-transparent ${colorClasses.text.neutralMuted} hover:text-neutral-600`
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <Suspense fallback={<div className="p-8 text-center text-neutral-400">加载中...</div>}>
        {activeTab === 'overview' && <RenewalOverviewTab filters={renewalFilters} onDrill={handleDrill} groupByLabel={DIMENSION_LABEL_MAP[groupBy] ?? '机构'} />}
        {activeTab === 'funnel' && <RenewalFunnelTab filters={renewalFilters} />}
        {activeTab === 'competition' && <RenewalCompetitionTab filters={renewalFilters} />}
        {activeTab === 'action' && <RenewalActionTab filters={renewalFilters} />}
        {activeTab === 'patrol' && <RenewalPatrolTab onNavigateToAction={() => setActiveTab('action')} />}
      </Suspense>
    </PageFilterPanel>
  );
}
