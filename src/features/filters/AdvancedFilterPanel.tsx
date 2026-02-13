import React from 'react';
import { MultiSelectDropdown, type MultiSelectOption } from './MultiSelectDropdown';
import { createLogger } from '../../shared/utils/logger';
import { DateCriteria, type AdvancedFilterState } from '../../shared/types/data';
import type { FilterFieldsConfig, FilterSelectionModeConfig, FilterPresetName } from '../../shared/types/filters';
import { FILTER_PRESETS } from '../../shared/types/filters';
import { FilterLayoutV2 } from './FilterLayoutV2';
import { CollapsibleFilterSection } from './CollapsibleFilterSection';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../shared/styles';

const logger = createLogger('AdvancedFilterPanel');

interface AdvancedFilterPanelProps {
  filters: AdvancedFilterState;
  onChange: (filters: AdvancedFilterState) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 是否支持完全折叠（折叠时隐藏整个内容区域，默认false） */
  fullCollapsible?: boolean;
  /** 紧凑模式（用于右侧边栏布局，移除外边框和阴影） */
  compact?: boolean;
  // DC-001: 双口径元数据（基于当前date_criteria动态提供）
  availableYears?: number[];  // 当前口径的可用年份列表
  maxDataDate?: string;       // 当前口径的最大日期
  // Options for filters (fetched from data)
  options?: {
    org_level_3?: Array<{ value: string; count: number }>;
    salesman_name?: Array<{ value: string; count: number }>;
    customer_category?: Array<{ value: string; count: number }>;
    coverage_combination?: Array<{ value: string; count: number }>;
    renewal_mode?: Array<{ value: string; count: number }>;
    availableSalesmen?: string[];
  };
  /** 预设配置名称（优先级低于 visibleFields） */
  preset?: FilterPresetName;
  /** 可见字段配置（覆盖 preset 配置） */
  visibleFields?: FilterFieldsConfig;
  /** 选择模式配置（覆盖 preset 配置） */
  selectionModes?: FilterSelectionModeConfig;
}

type DimensionOption = {
  value: string;
  count: number;
};

/**
 * 计算默认日期范围：今年1月1日至今天
 */
const getDefaultDateRange = (): { start: string; end: string } => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const start = `${currentYear}-01-01`;
  const end = today.toISOString().split('T')[0];

  return { start, end };
};

export const AdvancedFilterPanel: React.FC<AdvancedFilterPanelProps> = ({
  filters,
  onChange,
  collapsed = false,
  onToggleCollapse,
  fullCollapsible = false,
  compact = false,
  availableYears = [],
  maxDataDate,
  options = {},
  preset,
  visibleFields: visibleFieldsOverride,
  selectionModes: selectionModesOverride,
}) => {
  const defaultDateRange = React.useMemo(() => getDefaultDateRange(), []);

  // 计算最终的可见字段配置：visibleFieldsOverride > preset > 默认全部显示
  const finalVisibleFields = React.useMemo<FilterFieldsConfig>(() => {
    const presetConfig = preset ? FILTER_PRESETS[preset] : undefined;
    return {
      ...presetConfig,
      ...visibleFieldsOverride,
    };
  }, [preset, visibleFieldsOverride]);

  // 计算最终的选择模式配置
  const finalSelectionModes = React.useMemo<FilterSelectionModeConfig>(() => {
    const presetConfig = preset ? FILTER_PRESETS[preset] : undefined;
    return {
      organizationMode: selectionModesOverride?.organizationMode ?? presetConfig?.organizationMode ?? 'multi',
      salesmanMode: selectionModesOverride?.salesmanMode ?? presetConfig?.salesmanMode ?? 'multi',
    };
  }, [preset, selectionModesOverride]);

  // 判断是否显示业务员和高级选项
  const showSalesman = finalVisibleFields.salesman ?? true;
  const showBasicOptions = finalVisibleFields.basicOptions ?? true;
  const showQuickCombos = finalVisibleFields.quickCombos ?? true;

  // DC-001: 获取当前日期口径和分析年度的默认值
  // DC-002: 使用 ?? 确保用户选择优先于默认值
  const currentYear = new Date().getFullYear();

  // 如果日期口径被锁定，强制使用锁定值
  const lockedDateCriteria = finalVisibleFields.lockedDateCriteria;
  const defaultDateCriteria: DateCriteria = lockedDateCriteria || filters.date_criteria || 'policy_date';

  // 根据 allowedYears 限制年度选择
  const allowedYears = finalVisibleFields.allowedYears;
  const defaultYear = React.useMemo(() => {
    const year = filters.analysis_year ?? currentYear;
    // 如果只允许当年，强制使用当年
    if (allowedYears === 'currentOnly') {
      return currentYear;
    }
    // 如果允许当年和上一年，确保在范围内
    if (allowedYears === 'currentAndPrevious') {
      if (year !== currentYear && year !== currentYear - 1) {
        return currentYear;
      }
    }
    return year;
  }, [filters.analysis_year, currentYear, allowedYears]);

  // 当锁定配置变化时，同步更新 filters
  React.useEffect(() => {
    const updates: Partial<typeof filters> = {};
    let needUpdate = false;

    // 如果日期口径被锁定且当前值不匹配，更新
    if (lockedDateCriteria && filters.date_criteria !== lockedDateCriteria) {
      updates.date_criteria = lockedDateCriteria;
      needUpdate = true;
    }

    // 如果年度被限制且当前值不在范围内，更新
    if (allowedYears === 'currentOnly' && filters.analysis_year !== currentYear) {
      updates.analysis_year = currentYear;
      needUpdate = true;
    } else if (allowedYears === 'currentAndPrevious') {
      const year = filters.analysis_year;
      if (year && year !== currentYear && year !== currentYear - 1) {
        updates.analysis_year = currentYear;
        needUpdate = true;
      }
    }

    if (needUpdate) {
      onChange({ ...filters, ...updates });
    }
  }, [lockedDateCriteria, allowedYears, currentYear]);

  // Debug: Log received options
  React.useEffect(() => {
    logger.debug('Received options', {
      org_level_3: options.org_level_3?.length || 0,
      salesman_name: options.salesman_name?.length || 0,
      customer_category: options.customer_category?.length || 0,
      coverage_combination: options.coverage_combination?.length || 0,
        renewal_mode: options.renewal_mode?.length || 0,
    });
    logger.debug('Sample org', options.org_level_3?.slice(0, 2));
    logger.debug('Sample salesman', options.salesman_name?.slice(0, 2));
  }, [options]);

  const handleMultiSelectChange = (key: keyof AdvancedFilterState, values: string[]) => {
    onChange({ ...filters, [key]: values.length > 0 ? values : undefined });
  };

  const handleBooleanChange = (key: keyof AdvancedFilterState, value: boolean | null) => {
    onChange({ ...filters, [key]: value });
  };

  const handleReset = () => {
    const currentYear = new Date().getFullYear();
    onChange({
      policy_date_start: defaultDateRange.start,
      policy_date_end: defaultDateRange.end,
      // 使用锁定值或默认值
      date_criteria: lockedDateCriteria || filters.date_criteria || 'policy_date',
      analysis_year: currentYear,
    });
  };

  const toMultiSelectOptions = (optionsList: DimensionOption[]): MultiSelectOption[] =>
    optionsList.map(option => ({
      value: option.value,
      label: option.value,
      count: option.count,
    }));

  const getFilteredSalesmanOptions = (): DimensionOption[] => {
    const allOptions = options.salesman_name || [];
    const selectedValues = new Set(filters.salesman_name || []);
    const availableList = options.availableSalesmen || [];
    if (availableList.length === 0) {
      return allOptions;
    }

    const availableSet = new Set(availableList);
    return allOptions.filter(
      (option) => availableSet.has(option.value) || selectedValues.has(option.value)
    );
  };

  const REMOTE_CITIES = ['宜宾', '德阳', '资阳', '泸州', '自贡', '乐山', '达州'];
  const getOrgSelectionByType = (orgs: string[], type: 'remote' | 'local'): string[] => {
    return orgs.filter((org) => {
      const isRemote = REMOTE_CITIES.some((city) => org.includes(city));
      return type === 'remote' ? isRemote : !isRemote;
    });
  };

  // 基本选项切换配置
  const basicToggleConfigs: Array<{
    key: keyof AdvancedFilterState;
    label: string;
    onState: string;
    offState: string;
  }> = [
    { key: 'is_nev', label: '能源类型', onState: '新能源', offState: '燃油' },
    { key: 'is_new_car', label: '车辆新旧', onState: '新车', offState: '旧车' },
    { key: 'is_transfer', label: '过户状态', onState: '过户', offState: '非过户' },
    { key: 'is_renewal', label: '续保状态', onState: '续保', offState: '非续保' },
    { key: 'is_telemarketing', label: '销售渠道', onState: '电销', offState: '非电销' },
    { key: 'insurance_type', label: '险类', onState: '交强险', offState: '商业保险' },
    { key: 'is_cross_sell', label: '交叉销售', onState: '交叉销售', offState: '非交叉销售' },
  ];

  // 衍生维度（快捷组合）
  const derivedScenarios = [
    {
      label: '转保',
      description: '旧车+非续保',
      isActive: filters.is_new_car === false && filters.is_renewal === false,
      apply: () => {
        onChange({
          ...filters,
          is_new_car: false,  // 旧车
          is_renewal: false,  // 非续保
        });
      },
    },
    {
      label: '可续',
      description: '可续+套单+商业险',
      isActive:
        filters.is_renewable === true &&
        filters.is_commercial_insure === true &&
        filters.insurance_type === false,
      apply: () => {
        onChange({
          ...filters,
          is_renewable: true,
          is_commercial_insure: true,
          insurance_type: false,
        });
      },
    },
    // 预留：未来可以增加更多快捷组合
    // {
    //   label: '新能源新车',
    //   description: '新能源+新车',
    //   isActive: filters.is_nev === true && filters.is_new_car === true,
    //   apply: () => { ... }
    // },
  ];

  const cycleTriState = (value: boolean | null | undefined): boolean | null => {
    if (value === null || value === undefined) return true;
    if (value === true) return false;
    return null;
  };

  const formatToggleButton = (
    config: (typeof basicToggleConfigs)[number],
    value: boolean | null | undefined
  ) => {
    const isActive = value !== null && value !== undefined;
    let displayText = '';
    let buttonClass = '';

    if (value === null || value === undefined) {
      displayText = `${config.label}：全部`;
      buttonClass = 'bg-neutral-100 text-neutral-700 border-neutral-300';
    } else if (value === true) {
      displayText = config.onState;
      buttonClass = 'bg-primary text-white border-primary';
    } else {
      displayText = config.offState;
      buttonClass = 'bg-success text-white border-success';
    }

    return { displayText, buttonClass, isActive };
  };

  // 完全折叠状态：fullCollapsible 为 true 且当前已折叠
  const isFullyCollapsed = fullCollapsible && collapsed;

  // 紧凑模式下使用简化的布局
  if (compact) {
    return (
      <section
        className="space-y-4"
        aria-labelledby="filter-panel-title"
        role="region"
      >
        <div className="flex items-center justify-between mb-2">
          <h2 id="filter-panel-title" className="text-sm font-semibold text-neutral-700">
            筛选条件
          </h2>
          <button
            type="button"
            onClick={handleReset}
            className="px-2 py-1 text-xs bg-neutral-200 rounded hover:bg-neutral-300"
            aria-label="重置筛选条件"
          >
            重置
          </button>
        </div>
        <FilterLayoutV2
          filters={filters}
          onChange={onChange}
          availableYears={availableYears}
          currentYear={currentYear}
          defaultDateCriteria={defaultDateCriteria}
          defaultDateRange={defaultDateRange}
          defaultYear={defaultYear}
          maxDataDate={maxDataDate}
          options={{
            org_level_3: options.org_level_3,
            customer_category: options.customer_category,
            coverage_combination: options.coverage_combination,
            renewal_mode: options.renewal_mode,
          }}
          onMultiSelectChange={handleMultiSelectChange}
          visibleFields={finalVisibleFields}
          selectionModes={finalSelectionModes}
          compact={true}
        />
      </section>
    );
  }

  return (
    <section
      className="bg-white rounded shadow overflow-hidden"
      aria-labelledby="filter-panel-title"
      role="region"
    >
      <header
        className={`flex items-center p-4 border-b gap-[5px] ${
          fullCollapsible ? 'cursor-pointer hover:bg-neutral-50 transition-colors' : ''
        }`}
        onClick={fullCollapsible ? onToggleCollapse : undefined}
      >
        <h2 id="filter-panel-title" className="text-lg font-semibold whitespace-nowrap flex items-center gap-2">
          筛选条件
          {fullCollapsible && (
            <ChevronRight className={cn('h-4 w-4 text-neutral-400 transition-transform', !collapsed && 'rotate-90')} aria-hidden="true" />
          )}
        </h2>
        <div
          className="flex items-center space-x-2"
          role="group"
          aria-label="筛选器控制"
          onClick={(e) => fullCollapsible && e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1 text-sm bg-neutral-200 rounded hover:bg-neutral-300 whitespace-nowrap"
            aria-label="重置筛选条件并刷新数据"
          >
            刷新数据
          </button>
          {!fullCollapsible && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="px-3 py-1 text-sm bg-primary text-white rounded hover:bg-primary-dark whitespace-nowrap"
              aria-expanded={!collapsed}
              aria-controls="advanced-filters-content"
              aria-label={collapsed ? '展开高级筛选' : '折叠高级筛选'}
            >
              {collapsed ? '展开' : '折叠'}
            </button>
          )}
        </div>
      </header>

      {/* 完全折叠时隐藏整个内容区域 */}
      {!isFullyCollapsed && (
      <div className="p-4 space-y-4">
        <FilterLayoutV2
          filters={filters}
          onChange={onChange}
          availableYears={availableYears}
          currentYear={currentYear}
          defaultDateCriteria={defaultDateCriteria}
          defaultDateRange={defaultDateRange}
          defaultYear={defaultYear}
          maxDataDate={maxDataDate}
          options={{
            org_level_3: options.org_level_3,
            customer_category: options.customer_category,
            coverage_combination: options.coverage_combination,
            renewal_mode: options.renewal_mode,
          }}
          onMultiSelectChange={handleMultiSelectChange}
          visibleFields={finalVisibleFields}
          selectionModes={finalSelectionModes}
          orgActions={
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  handleMultiSelectChange(
                    'org_level_3',
                    getOrgSelectionByType(
                      (options.org_level_3 || []).map((option) => option.value),
                      'remote'
                    )
                  )
                }
                className="text-xs px-2 py-1 bg-warning-100 text-warning-700 rounded hover:bg-warning-200"
                aria-label="筛选异地机构"
              >
                异地
              </button>
              <button
                type="button"
                onClick={() =>
                  handleMultiSelectChange(
                    'org_level_3',
                    getOrgSelectionByType(
                      (options.org_level_3 || []).map((option) => option.value),
                      'local'
                    )
                  )
                }
                className="text-xs px-2 py-1 bg-success-100 text-success-700 rounded hover:bg-success-200"
                aria-label="筛选同城机构"
              >
                同城
              </button>
            </div>
          }
        />

        {!collapsed && (showSalesman || showQuickCombos || showBasicOptions) && (
          <div id="advanced-filters-content" className="space-y-4">
            <div className="space-y-4">
              {showSalesman && (
                <CollapsibleFilterSection id="salesman-filter" title="业务员筛选">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <MultiSelectDropdown
                      title="业务员"
                      options={toMultiSelectOptions(getFilteredSalesmanOptions())}
                      selectedValues={filters.salesman_name || []}
                      onChange={(values) => handleMultiSelectChange('salesman_name', values)}
                      singleSelect={finalSelectionModes.salesmanMode === 'single'}
                    />
                  </div>
                </CollapsibleFilterSection>
              )}

              {showQuickCombos && (
                <CollapsibleFilterSection
                  id="quick-combo"
                  title="快捷组合"
                  defaultExpanded
                >
                  <div className="flex flex-wrap gap-2" role="group" aria-label="快捷筛选组合">
                    {derivedScenarios.map((scenario) => (
                      <button
                        key={scenario.label}
                        type="button"
                        onClick={scenario.apply}
                        className={`px-3 py-1 text-sm rounded border transition ${
                          scenario.isActive
                            ? 'bg-warning text-white border-warning'
                            : 'bg-neutral-100 text-neutral-700 border-neutral-300 hover:bg-neutral-200'
                        }`}
                        title={scenario.description}
                        aria-pressed={scenario.isActive}
                        aria-label={`${scenario.label}: ${scenario.description}`}
                      >
                        {scenario.label}
                        {scenario.isActive && ' ✓'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-400 mt-2">
                    提示：点击快捷组合按钮将自动设置对应的筛选条件组合
                  </p>
                </CollapsibleFilterSection>
              )}

              {showBasicOptions && (
                <CollapsibleFilterSection id="basic-options" title="基本选项">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="基本筛选选项">
                    {basicToggleConfigs.map((config) => {
                      const value = filters[config.key] as boolean | null | undefined;
                      const { displayText, buttonClass } = formatToggleButton(config, value);
                      const stateDescription = value === null || value === undefined
                        ? '当前为全部，点击切换到' + config.onState
                        : value === true
                        ? `当前为${config.onState}，点击切换到${config.offState}`
                        : `当前为${config.offState}，点击切换到全部`;

                      return (
                        <button
                          key={String(config.key)}
                          type="button"
                          onClick={() => handleBooleanChange(config.key, cycleTriState(value))}
                          className={`px-3 py-1 text-sm rounded border transition ${buttonClass}`}
                          aria-label={`${config.label}: ${displayText}`}
                          aria-pressed={value !== null && value !== undefined}
                          title={stateDescription}
                        >
                          {displayText}
                        </button>
                      );
                    })}
                  </div>
                </CollapsibleFilterSection>
              )}
            </div>
          </div>
        )}
      </div>
      )}
    </section>
  );
};
