import React from 'react';
import { DateCriteriaSelector } from './DateCriteriaSelector';
import { DateRangePicker } from './DateRangePicker';
import { MultiSelectDropdown, type MultiSelectOption } from './MultiSelectDropdown';
import { AnalysisYearSelector } from './AnalysisYearSelector';
import type { AdvancedFilterState, DateCriteria } from '../../shared/types/data';
import type { FilterFieldsConfig, FilterSelectionModeConfig, DateCriteriaType, AllowedYearsRange } from '../../shared/types/filters';
import { useVisibleOrganizations } from '../../shared/contexts/PermissionContext';
import { Lock } from 'lucide-react';

type DimensionOption = {
  value: string;
  count: number;
};

const getMultiSelectSummary = (selectedValues?: string[]) => {
  if (!selectedValues || selectedValues.length === 0) return '全部';
  if (selectedValues.length === 1) return selectedValues[0];
  return `已选${selectedValues.length}项`;
};

const getRenewalModeSummary = (selectedValues?: string[]) => {
  if (!selectedValues || selectedValues.length === 0) return '全部';
  if (selectedValues.length === 1) {
    return selectedValues[0] === '__NULL__' ? '新保/非续保' : selectedValues[0];
  }
  return `已选${selectedValues.length}项`;
};

interface FilterLayoutV2Props {
  filters: AdvancedFilterState;
  onChange: (filters: AdvancedFilterState) => void;
  availableYears: number[];
  currentYear: number;
  defaultDateCriteria: DateCriteria;
  defaultDateRange: { start: string; end: string };
  defaultYear: number;
  maxDataDate?: string;
  options: {
    org_level_3?: DimensionOption[];
    customer_category?: DimensionOption[];
    coverage_combination?: DimensionOption[];
    renewal_mode?: DimensionOption[];
  };
  onMultiSelectChange: (key: keyof AdvancedFilterState, values: string[]) => void;
  orgActions?: React.ReactNode;
  /** 可见字段配置（不传则显示全部） */
  visibleFields?: FilterFieldsConfig;
  /** 选择模式配置 */
  selectionModes?: FilterSelectionModeConfig;
  /** 紧凑模式（垂直布局） */
  compact?: boolean;
}

const toMultiSelectOptions = (optionsList: DimensionOption[]): MultiSelectOption[] =>
  optionsList.map(option => ({
    value: option.value,
    label: option.value,
    count: option.count,
  }));

/**
 * 根据 allowedYears 配置过滤可用年份
 */
const filterAvailableYears = (
  years: number[],
  allowedYears: AllowedYearsRange | undefined,
  currentYear: number
): number[] => {
  if (!allowedYears || years.length === 0) {
    return years;
  }

  if (allowedYears === 'currentOnly') {
    // 仅当年
    return years.filter(y => y === currentYear);
  }

  if (allowedYears === 'currentAndPrevious') {
    // 当年和上一年
    return years.filter(y => y === currentYear || y === currentYear - 1);
  }

  return years;
};

/**
 * 获取日期口径的显示名称
 */
const getDateCriteriaLabel = (criteria: DateCriteriaType): string => {
  return criteria === 'policy_date' ? '签单日期' : '起保日期';
};

export const FilterLayoutV2: React.FC<FilterLayoutV2Props> = ({
  filters,
  onChange,
  availableYears,
  currentYear,
  defaultDateCriteria,
  defaultDateRange,
  defaultYear,
  maxDataDate,
  options,
  onMultiSelectChange,
  orgActions,
  visibleFields,
  selectionModes,
  compact = false,
}) => {
  // 默认显示所有字段
  const showDateCriteria = visibleFields?.dateCriteria ?? true;
  const showAnalysisYear = visibleFields?.analysisYear ?? true;
  const showDateRange = visibleFields?.dateRange ?? true;
  const showOrganization = visibleFields?.organization ?? true;
  const showCustomerCategory = visibleFields?.customerCategory ?? true;
  const showCoverageCombination = visibleFields?.coverageCombination ?? true;
  const showRenewalMode = visibleFields?.renewalMode ?? true;

  // 锁定配置
  const lockedDateCriteria = visibleFields?.lockedDateCriteria;
  const allowedYears = visibleFields?.allowedYears;

  // 如果日期口径被锁定，使用锁定值；否则使用用户选择或默认值
  const effectiveDateCriteria: DateCriteria = lockedDateCriteria || defaultDateCriteria;

  // 根据 allowedYears 过滤可用年份
  const filteredAvailableYears = React.useMemo(
    () => filterAvailableYears(availableYears, allowedYears, currentYear),
    [availableYears, allowedYears, currentYear]
  );

  // 确保当前选择的年份在允许范围内
  const effectiveYear = React.useMemo(() => {
    if (filteredAvailableYears.length === 0) return defaultYear;
    if (filteredAvailableYears.includes(defaultYear)) return defaultYear;
    return filteredAvailableYears[0];
  }, [filteredAvailableYears, defaultYear]);

  // 选择模式
  const orgMode = selectionModes?.organizationMode ?? 'multi';

  // 获取用户可见的机构列表（权限控制）
  const visibleOrganizations = useVisibleOrganizations();

  const startDate = filters.policy_date_start ?? `${defaultYear}-01-01`;
  const endDate = filters.policy_date_end ?? maxDataDate ?? defaultDateRange.end;
  const renewalModeOptions: MultiSelectOption[] = [
    { value: '__NULL__', label: '新保/非续保' },
    ...toMultiSelectOptions(options.renewal_mode || []),
  ];

  // 根据权限过滤三级机构选项
  const filteredOrgOptions: MultiSelectOption[] = React.useMemo(() => {
    const allOrgs = toMultiSelectOptions(options.org_level_3 || []);

    // 如果可见所有机构（管理员或未登录），返回全部
    if (visibleOrganizations.length > 1) {
      return allOrgs;
    }

    // 只能查看"全部"和特定机构的情况（三级机构用户）
    const userOrg = visibleOrganizations.find(o => o !== '全部');
    if (userOrg) {
      return allOrgs.filter(opt => opt.value === userOrg);
    }

    return [];
  }, [options.org_level_3, visibleOrganizations]);

  // 处理单选模式的 onChange
  const handleOrgSingleSelect = (values: string[]) => {
    // 单选模式下只保留最后一个选中的值
    if (orgMode === 'single' && values.length > 1) {
      onMultiSelectChange('org_level_3', [values[values.length - 1]]);
    } else {
      onMultiSelectChange('org_level_3', values);
    }
  };

  // 计算第一行显示的元素数量，用于动态调整布局
  const firstRowVisibleCount = [showDateCriteria, showAnalysisYear, showDateRange].filter(Boolean).length;
  const firstRowGridClass = firstRowVisibleCount === 3
    ? 'grid-cols-1 xl:grid-cols-[minmax(220px,_1fr)_minmax(220px,_1fr)_minmax(320px,_2fr)]'
    : firstRowVisibleCount === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1';

  // 计算第二行显示的元素数量
  const secondRowVisibleCount = [showOrganization, showCustomerCategory, showCoverageCombination, showRenewalMode].filter(Boolean).length;
  const secondRowGridClass = secondRowVisibleCount === 4
    ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
    : secondRowVisibleCount === 3
      ? 'grid-cols-1 sm:grid-cols-3'
      : secondRowVisibleCount === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1';

  // 如果第一行没有任何可见元素，则不渲染
  const showFirstRow = firstRowVisibleCount > 0;
  // 如果第二行没有任何可见元素，则不渲染
  const showSecondRow = secondRowVisibleCount > 0;

  // 紧凑模式：垂直堆叠布局，适用于右侧边栏
  if (compact) {
    return (
      <div className="space-y-3">
        {/* 日期口径 */}
        {showDateCriteria && (
          lockedDateCriteria ? (
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-600">统计口径</label>
              <div className="flex items-center gap-1 px-2 py-1 bg-neutral-100 border border-neutral-200 rounded text-xs text-neutral-500">
                <Lock className="w-3 h-3 text-neutral-400" />
                <span>{getDateCriteriaLabel(lockedDateCriteria)}</span>
              </div>
            </div>
          ) : (
            <DateCriteriaSelector
              value={effectiveDateCriteria}
              onChange={(value) => {
                onChange({
                  ...filters,
                  date_criteria: value,
                  analysis_year: filters.analysis_year ?? currentYear,
                });
              }}
              compact
            />
          )
        )}

        {/* 分析年度 */}
        {showAnalysisYear && (
          <AnalysisYearSelector
            value={effectiveYear}
            onChange={(year) =>
              onChange({
                ...filters,
                analysis_year: year,
                policy_date_start: `${year}-01-01`,
                policy_date_end: maxDataDate || defaultDateRange.end,
              })
            }
            availableYears={filteredAvailableYears}
            currentYear={currentYear}
            disabled={filteredAvailableYears.length <= 1}
            compact
          />
        )}

        {/* 日期范围 */}
        {showDateRange && (
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(start, end) =>
              onChange({
                ...filters,
                policy_date_start: start,
                policy_date_end: end,
              })
            }
            compact
          />
        )}

        {/* 分隔线 */}
        {showFirstRow && showSecondRow && (
          <div className="border-t border-neutral-200 my-2" />
        )}

        {/* 三级机构 */}
        {showOrganization && (
          <details className="group" open>
            <summary className="list-none cursor-pointer flex items-center justify-between py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-800">
              <div className="flex items-center gap-2">
                <span>三级机构{orgMode === 'single' ? '（单选）' : ''}</span>
                {orgMode === 'multi' && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMultiSelectChange('org_level_3', []); }}
                      className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const allValues = filteredOrgOptions.map(o => o.value);
                        const selected = filters.org_level_3 || [];
                        onMultiSelectChange('org_level_3', allValues.filter(v => !selected.includes(v)));
                      }}
                      className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                    >
                      反选
                    </button>
                    {orgActions && (
                      <div className="flex gap-1 border-l border-neutral-200 ml-1 pl-1" onClick={(e) => e.stopPropagation()}>
                        {orgActions}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <span className="text-neutral-400 text-[10px] group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="pt-2">
              <MultiSelectDropdown
                variant="compact"
                title="三级机构"
                options={filteredOrgOptions}
                selectedValues={filters.org_level_3 || []}
                onChange={handleOrgSingleSelect}
                showButtons={false}
                disabled={visibleOrganizations.length <= 1 && filteredOrgOptions.length > 0}
                singleSelect={orgMode === 'single'}
              />
            </div>
          </details>
        )}

        {/* 客户类别 */}
        {showCustomerCategory && (
          <details className="group">
            <summary className="list-none cursor-pointer flex items-center justify-between py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-800">
              <div className="flex items-center gap-2">
                <span>客户类别</span>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onMultiSelectChange('customer_category', []); }}
                    className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const allOptions = toMultiSelectOptions(options.customer_category || []);
                      const allValues = allOptions.map(o => o.value);
                      const selected = filters.customer_category || [];
                      onMultiSelectChange('customer_category', allValues.filter(v => !selected.includes(v)));
                    }}
                    className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                  >
                    反选
                  </button>
                </div>
              </div>
              <span className="text-neutral-400 text-[10px] group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="pt-2">
              <MultiSelectDropdown
                variant="compact"
                title="客户类别"
                options={toMultiSelectOptions(options.customer_category || [])}
                selectedValues={filters.customer_category || []}
                onChange={(values) => onMultiSelectChange('customer_category', values)}
                showButtons={false}
              />
            </div>
          </details>
        )}

        {/* 险别组合 */}
        {showCoverageCombination && (
          <details className="group">
            <summary className="list-none cursor-pointer flex items-center justify-between py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-800">
              <div className="flex items-center gap-2">
                <span>险别组合</span>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onMultiSelectChange('coverage_combination', []); }}
                    className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const allOptions = toMultiSelectOptions(options.coverage_combination || []);
                      const allValues = allOptions.map(o => o.value);
                      const selected = filters.coverage_combination || [];
                      onMultiSelectChange('coverage_combination', allValues.filter(v => !selected.includes(v)));
                    }}
                    className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                  >
                    反选
                  </button>
                </div>
              </div>
              <span className="text-neutral-400 text-[10px] group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="pt-2">
              <MultiSelectDropdown
                variant="compact"
                title="险别组合"
                options={toMultiSelectOptions(options.coverage_combination || [])}
                selectedValues={filters.coverage_combination || []}
                onChange={(values) => onMultiSelectChange('coverage_combination', values)}
                showButtons={false}
              />
            </div>
          </details>
        )}

        {/* 续保模式 */}
        {showRenewalMode && (
          <details className="group">
            <summary className="list-none cursor-pointer flex items-center justify-between py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-800">
              <div className="flex items-center gap-2">
                <span>续保模式</span>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onMultiSelectChange('renewal_mode', []); }}
                    className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const allValues = renewalModeOptions.map(o => o.value);
                      const selected = filters.renewal_mode || [];
                      onMultiSelectChange('renewal_mode', allValues.filter(v => !selected.includes(v)));
                    }}
                    className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                  >
                    反选
                  </button>
                </div>
              </div>
              <span className="text-neutral-400 text-[10px] group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="pt-2">
              <MultiSelectDropdown
                variant="compact"
                title="续保模式"
                options={renewalModeOptions}
                selectedValues={filters.renewal_mode || []}
                onChange={(values) => onMultiSelectChange('renewal_mode', values)}
                showButtons={false}
                placeholder="全部"
              />
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 space-y-4">
      {showFirstRow && (
        <div className={`grid ${firstRowGridClass} gap-4 items-start`}>
          {showDateCriteria && (
            lockedDateCriteria ? (
              // 锁定状态：显示只读标签
              <div className="flex items-center space-x-3">
                <label className="text-sm font-medium text-neutral-700 flex-shrink-0 whitespace-nowrap">
                  统计口径：
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-neutral-100 border border-neutral-300 rounded-md text-sm text-neutral-600">
                  <Lock className="w-3.5 h-3.5 text-neutral-400" />
                  <span>{getDateCriteriaLabel(lockedDateCriteria)}</span>
                </div>
              </div>
            ) : (
              <DateCriteriaSelector
                value={effectiveDateCriteria}
                onChange={(value) => {
                  onChange({
                    ...filters,
                    date_criteria: value,
                    // DC-002: 切换口径时保持年度，使用 ?? 确保用户选择优先
                    analysis_year: filters.analysis_year ?? currentYear,
                  });
                }}
              />
            )
          )}

          {showAnalysisYear && (
            <AnalysisYearSelector
              value={effectiveYear}
              onChange={(year) =>
                onChange({
                  ...filters,
                  analysis_year: year,
                  // 切换年度时重置日期范围
                  policy_date_start: `${year}-01-01`,
                  policy_date_end: maxDataDate || defaultDateRange.end,
                })
              }
              availableYears={filteredAvailableYears}
              currentYear={currentYear}
              disabled={filteredAvailableYears.length <= 1}
            />
          )}

          {showDateRange && (
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={(start, end) =>
                onChange({
                  ...filters,
                  policy_date_start: start,
                  policy_date_end: end,
                })
              }
            />
          )}
        </div>
      )}

      {showSecondRow && (
        <div className={`grid ${secondRowGridClass} gap-3`}>
          {showOrganization && (
            <details className="group rounded-lg border border-neutral-200 bg-white">
              <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">
                  三级机构{orgMode === 'single' ? '（单选）' : ''}
                </span>
                <span className="text-sm text-neutral-500 truncate">
                  {getMultiSelectSummary(filters.org_level_3)}
                </span>
              </summary>
              <div className="px-3 pb-3">
                <MultiSelectDropdown
                  variant="compact"
                  title="三级机构"
                  options={filteredOrgOptions}
                  selectedValues={filters.org_level_3 || []}
                  onChange={handleOrgSingleSelect}
                  actions={orgMode === 'multi' ? orgActions : undefined}
                  disabled={visibleOrganizations.length <= 1 && filteredOrgOptions.length > 0}
                  singleSelect={orgMode === 'single'}
                />
                {visibleOrganizations.length <= 1 && filteredOrgOptions.length > 0 && (
                  <p className="text-xs text-neutral-400 mt-1">
                    权限限制：仅可查看本机构数据
                  </p>
                )}
              </div>
            </details>
          )}

          {showCustomerCategory && (
            <details className="group rounded-lg border border-neutral-200 bg-white">
              <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">客户类别</span>
                <span className="text-sm text-neutral-500 truncate">
                  {getMultiSelectSummary(filters.customer_category)}
                </span>
              </summary>
              <div className="px-3 pb-3">
                <MultiSelectDropdown
                  variant="compact"
                  title="客户类别"
                  options={toMultiSelectOptions(options.customer_category || [])}
                  selectedValues={filters.customer_category || []}
                  onChange={(values) => onMultiSelectChange('customer_category', values)}
                />
              </div>
            </details>
          )}

          {showCoverageCombination && (
            <details className="group rounded-lg border border-neutral-200 bg-white">
              <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">险别组合</span>
                <span className="text-sm text-neutral-500 truncate">
                  {getMultiSelectSummary(filters.coverage_combination)}
                </span>
              </summary>
              <div className="px-3 pb-3">
                <MultiSelectDropdown
                  variant="compact"
                  title="险别组合"
                  options={toMultiSelectOptions(options.coverage_combination || [])}
                  selectedValues={filters.coverage_combination || []}
                  onChange={(values) => onMultiSelectChange('coverage_combination', values)}
                />
              </div>
            </details>
          )}

          {showRenewalMode && (
            <details className="group rounded-lg border border-neutral-200 bg-white">
              <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-neutral-700 whitespace-nowrap">续保模式</span>
                <span className="text-sm text-neutral-500 truncate">
                  {getRenewalModeSummary(filters.renewal_mode)}
                </span>
              </summary>
              <div className="px-3 pb-3">
                <MultiSelectDropdown
                  variant="compact"
                  title="续保模式"
                  options={renewalModeOptions}
                  selectedValues={filters.renewal_mode || []}
                  onChange={(values) => onMultiSelectChange('renewal_mode', values)}
                  placeholder="全部"
                />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
};
