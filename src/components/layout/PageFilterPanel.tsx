import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Filter, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { AdvancedFilterPanel } from '../../features/filters/AdvancedFilterPanel';
import { PageHeaderBar } from '../../features/filters/PageHeaderBar';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import type {
  FilterFieldsConfig,
  FilterPresetName,
} from '../../shared/types/filters';
import { FILTER_PRESETS } from '../../shared/types/filters';
import type { AdvancedFilterState } from '../../shared/types/data';
import { buttonStyles, textStyles, cn } from '../../shared/styles';
import { DashboardAnchorNav, type DashboardAnchorSection } from './DashboardAnchorNav';
import { Footer } from './Footer';

interface PageFilterPanelProps {
  preset: FilterPresetName;
  children: React.ReactNode;
  title?: string;
  headerRightContent?: ReactNode | ((actions: {
    onOpenAdvanced: () => void;
    onReset: () => void;
    activeFilterCount: number;
  }) => ReactNode);
  headerBottomLeftContent?: ReactNode;
  headerChipsAlign?: 'left' | 'right';
  anchorSections?: DashboardAnchorSection[];
  contentScrollId?: string;
  basicFilterVisibleFields?: FilterFieldsConfig;
  showBasicFilterBar?: boolean;
}

const DEFAULT_SCROLL_ID = 'dashboard-page-scroll';

function getDefaultDateEnd(maxDataDate?: string) {
  return maxDataDate ?? new Date().toISOString().split('T')[0];
}

function resolveResetYear(availableYears?: number[]) {
  const currentYear = new Date().getFullYear();
  if (!availableYears || availableYears.length === 0) return currentYear;
  if (availableYears.includes(currentYear)) return currentYear;
  return availableYears[availableYears.length - 1] ?? currentYear;
}

export function countActiveFilters(
  filters: AdvancedFilterState,
  maxDataDate?: string,
  availableYears?: number[]
): number {
  const resetYear = resolveResetYear(availableYears);
  const expectedStart = `${resetYear}-01-01`;
  const expectedEnd = getDefaultDateEnd(maxDataDate);
  let count = 0;

  const arrayKeys: Array<keyof AdvancedFilterState> = [
    'org_level_3',
    'salesman_name',
    'customer_category',
    'coverage_combination',
    'renewal_mode',
    'insurance_grade',
  ];

  arrayKeys.forEach((key) => {
    const value = filters[key];
    if (Array.isArray(value) && value.length > 0) count += 1;
  });

  const booleanKeys: Array<keyof AdvancedFilterState> = [
    'is_telemarketing',
    'is_nev',
    'is_new_car',
    'is_transfer',
    'is_cross_sell',
    'is_commercial_insure',
    'is_renewal',
    'is_renewable',
    'insurance_type',
  ];

  booleanKeys.forEach((key) => {
    if (typeof filters[key] === 'boolean') count += 1;
  });

  if ((filters.date_criteria ?? 'policy_date') !== 'policy_date') count += 1;
  if ((filters.analysis_year ?? resetYear) !== resetYear) count += 1;
  if (filters.policy_date_start && filters.policy_date_start !== expectedStart) count += 1;
  if (filters.policy_date_end && filters.policy_date_end !== expectedEnd) count += 1;
  if (filters.vehicle_quick_filter) count += 1;
  if (filters.business_nature) count += 1;

  return count;
}

export const PageFilterPanel: React.FC<PageFilterPanelProps> = ({
  preset,
  children,
  title,
  headerRightContent,
  headerBottomLeftContent,
  headerChipsAlign,
  anchorSections = [],
  contentScrollId = DEFAULT_SCROLL_ID,
  basicFilterVisibleFields,
  showBasicFilterBar = true,
}) => {
  const {
    filters,
    setFilters,
    filterOptions,
    isFilterCollapsed,
    toggleFilterCollapsed,
    availableSalesmen,
    salesmanTeamMap,
    maxDataDate,
    availableYears,
  } = useGlobalFilters();

  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!advancedOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAdvancedOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advancedOpen]);

  const presetConfig = FILTER_PRESETS[preset];
  const defaultBasicFields = useMemo<FilterFieldsConfig>(
    () => ({
      dateCriteria: presetConfig.dateCriteria ?? true,
      lockedDateCriteria: presetConfig.lockedDateCriteria,
      allowedYears: presetConfig.allowedYears,
      analysisYear: presetConfig.analysisYear ?? true,
      dateRange: presetConfig.dateRange ?? true,
      organization: presetConfig.organization ?? true,
      customerCategory: false,
      coverageCombination: presetConfig.coverageCombination ?? true,
      renewalMode: false,
      basicOptions: false,
      quickCombos: false,
      salesman: false,
    }),
    [presetConfig]
  );

  const mergedBasicVisibleFields = useMemo<FilterFieldsConfig>(
    () => ({
      ...defaultBasicFields,
      ...basicFilterVisibleFields,
    }),
    [basicFilterVisibleFields, defaultBasicFields]
  );

  const activeFilterCount = useMemo(
    () => countActiveFilters(filters, maxDataDate, availableYears),
    [filters, maxDataDate, availableYears]
  );

  const handleResetFilters = () => {
    const analysisYear = resolveResetYear(availableYears);
    setFilters({
      date_criteria: mergedBasicVisibleFields.lockedDateCriteria ?? 'policy_date',
      analysis_year: analysisYear,
      policy_date_start: `${analysisYear}-01-01`,
      policy_date_end: getDefaultDateEnd(maxDataDate),
    });
  };

  const renderAdvancedDrawer = () => (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-neutral-900/30 transition-opacity',
          advancedOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={() => setAdvancedOpen(false)}
      />
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[380px] max-w-[92vw] flex-col bg-white dark:bg-neutral-800 shadow-2xl transition-transform duration-300',
          advancedOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        aria-label="高级筛选"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 px-4 py-3">
          <div>
            <h2 className={textStyles.titleSmall}>高级筛选</h2>
            <p className={cn(textStyles.caption, 'mt-1')}>保留完整筛选能力，不再占用主内容横向空间。</p>
          </div>
          <button
            type="button"
            onClick={() => setAdvancedOpen(false)}
            className={cn(buttonStyles.base, buttonStyles.ghost, 'h-9 w-9 rounded-full p-0')}
            aria-label="关闭高级筛选"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <AdvancedFilterPanel
            filters={filters}
            onChange={setFilters}
            collapsed={isFilterCollapsed}
            onToggleCollapse={toggleFilterCollapsed}
            availableYears={availableYears}
            maxDataDate={maxDataDate}
            preset={preset}
            compact
            options={{
              org_level_3: filterOptions.org_level_3,
              salesman_name: filterOptions.salesman_name,
              customer_category: filterOptions.customer_category,
              coverage_combination: filterOptions.coverage_combination,
              renewal_mode: filterOptions.renewal_mode,
              insurance_grade: filterOptions.insurance_grade,
              availableSalesmen,
            }}
          />
        </div>
        <div className="border-t border-neutral-200 dark:border-neutral-700 px-4 py-4">
          <Footer />
        </div>
      </aside>
    </>
  );

  return (
    <div className="flex h-full w-full flex-col bg-neutral-50/60 dark:bg-transparent">
      {(title || showBasicFilterBar) && (
        <div className="sticky top-0 z-30 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
          {title && (
            <PageHeaderBar
              baseTitle={title}
              filters={filters}
              allOrgCount={filterOptions.org_level_3?.length || 0}
              salesmanTeamMap={salesmanTeamMap}
              rightContent={
                typeof headerRightContent === 'function'
                  ? headerRightContent({
                      onOpenAdvanced: () => setAdvancedOpen(true),
                      onReset: handleResetFilters,
                      activeFilterCount,
                    })
                  : headerRightContent
              }
              bottomLeftContent={showBasicFilterBar ? headerBottomLeftContent : undefined}
              chipsAlign={headerChipsAlign}
              hideChips={!showBasicFilterBar}
            />
          )}

        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div id={contentScrollId} className="h-full flex-1 overflow-y-auto">
          <div className={cn("mx-auto max-w-[1680px] p-4 lg:p-5", anchorSections.length > 0 && "pr-14")}>
            {children}
          </div>
        </div>

        {anchorSections.length > 0 && (
          <DashboardAnchorNav sections={anchorSections} containerId={contentScrollId} />
        )}

        <button
          type="button"
          onClick={() => setAdvancedOpen(true)}
          className="fixed bottom-4 right-4 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all hover:bg-primary-dark lg:hidden opacity-30 hover:opacity-100 duration-300"
          aria-label="打开高级筛选"
        >
          <Filter size={20} />
        </button>
      </div>

      {renderAdvancedDrawer()}
    </div>
  );
};

/** 通用标题栏操作按钮：[children] [重置] [⚙筛选] */
export const FilterQuickActions: React.FC<{
  onReset: () => void;
  onOpenAdvanced: () => void;
  activeFilterCount: number;
  children?: React.ReactNode;
}> = ({ onReset, onOpenAdvanced, activeFilterCount, children }) => (
  <div className="flex items-center gap-2">
    {children}
    <button
      type="button"
      onClick={onReset}
      className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2 py-1.5 text-xs')}
    >
      <RotateCcw size={14} className="mr-1" />重置
    </button>
    <button
      type="button"
      onClick={onOpenAdvanced}
      className={cn(buttonStyles.base, buttonStyles.primary, 'px-2 py-1.5 text-xs')}
    >
      <SlidersHorizontal size={14} className="mr-1" />筛选
      {activeFilterCount > 0 && (
        <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px]">
          {activeFilterCount}
        </span>
      )}
    </button>
  </div>
);
