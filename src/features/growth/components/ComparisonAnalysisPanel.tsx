import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useGrowthAnalysis, type DualMetricComparisonData } from '../hooks/useGrowthAnalysis';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import { GroupedBarChart } from '../../../widgets/charts/GroupedBarChart';
import { BarChart } from '../../../widgets/charts/BarChart';
import { DualYAxisComparisonChart } from '../../../widgets/charts/DualYAxisComparisonChart';
import { formatPremiumWan, formatRate, formatCount } from '../../../shared/utils/formatters';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { StickyTableFrame } from '../../../shared/ui';
import { cn, getTrendColorClass, stickyTableStyles, fontStyles } from '../../../shared/styles';
import { usePerspective } from '../../dashboard/hooks/usePerspective';
import { PerspectiveSwitcher } from '../../../widgets/filters/PerspectiveSwitcher';
import { ComparisonQuickPresets } from './ComparisonQuickPresets';
import type { ComparisonPreset, ComparisonPeriods } from '../utils/comparisonPresets';

interface ComparisonAnalysisPanelProps {
  filters: AdvancedFilterState;
  /** 数据最大日期（DC-002规范：必须从外部传入） */
  maxDataDate?: string;
}

export const ComparisonAnalysisPanel: React.FC<ComparisonAnalysisPanelProps> = ({
  filters,
  maxDataDate
}) => {
  const [period1Start, setPeriod1Start] = useState<string>('');
  const [period1End, setPeriod1End] = useState<string>('');
  const [period2Start, setPeriod2Start] = useState<string>('');
  const [period2End, setPeriod2End] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'org' | 'salesman'>('org');
  const [chartMode, setChartMode] = useState<'comparison' | 'growth'>('comparison');

  // 指标模式：single=单指标（需要视角切换）, dual=双指标（同时显示保费+件数）
  const [metricMode, setMetricMode] = useState<'single' | 'dual'>('single');
  const [dualMetricData, setDualMetricData] = useState<DualMetricComparisonData[]>([]);

  // 快捷预设状态：默认为环比(月)
  const [activePreset, setActivePreset] = useState<ComparisonPreset>('mom');

  const { perspective, setPerspective, config: perspectiveConfig } = usePerspective();
  const isPremiumPerspective = perspectiveConfig.valueFormatter === 'premium';
  const { isOrgUser, userOrg } = useRBAC();

  // 获取基准日期：优先使用外部传入的maxDataDate，否则使用当前日期
  const baseDate = maxDataDate || new Date().toISOString().split('T')[0];

  /**
   * 构建附加筛选参数（透传 QuickFilterBar + 高级筛选抽屉所选的全部维度）
   *
   * 对比页的日期由 period1/period2 本地 state 控制，因此剥离全局日期字段：
   * - policy_date_start/policy_date_end 若进入 query 参数会与 period 日期撞键（URLSearchParams.append 产生重复 startDate/endDate）
   * - date_criteria（日期口径）当前后端 custom 路径未消费，剥离避免传无效参数
   * org_user 的机构隔离由 buildFilterParams 内的 RBAC 注入强制处理。
   */
  const additionalFilterParams = useMemo(() => {
    const filtersForParams: AdvancedFilterState = {
      ...filters,
      date_criteria: undefined,
      policy_date_start: undefined,
      policy_date_end: undefined,
    };
    return buildFilterParams(filtersForParams, { isOrgUser, userOrg });
  }, [filters, isOrgUser, userOrg]);

  // 处理预设变更
  const handlePresetChange = useCallback((preset: ComparisonPreset, periods: ComparisonPeriods | null) => {
    setActivePreset(preset);

    if (periods) {
      // 自动填充日期
      setPeriod1Start(periods.current.startDate);
      setPeriod1End(periods.current.endDate);
      setPeriod2Start(periods.previous.startDate);
      setPeriod2End(periods.previous.endDate);
    }
    // custom模式不自动填充，保留用户当前选择
  }, []);

  // Initialize dates based on default preset (MoM)
  useEffect(() => {
    if (period1Start) return; // 已初始化则跳过

    // 使用baseDate初始化为环比(月)
    const now = new Date(baseDate);
    const year = now.getFullYear();
    const month = now.getMonth();

    // Default: Period 1 = Current Month (1st to baseDate), Period 2 = Last Month (same range)
    const p1Start = new Date(year, month, 1);
    const p1End = now;
    const p2Start = new Date(year, month - 1, 1);
    // 上月对应日
    const dayOfMonth = now.getDate();
    const lastDayOfPrevMonth = new Date(year, month, 0).getDate();
    const p2EndDay = Math.min(dayOfMonth, lastDayOfPrevMonth);
    const p2End = new Date(year, month - 1, p2EndDay);

    const fmt = (d: Date) => d.toISOString().split('T')[0];

    setPeriod1Start(fmt(p1Start));
    setPeriod1End(fmt(p1End));
    setPeriod2Start(fmt(p2Start));
    setPeriod2End(fmt(p2End));
  }, [baseDate, period1Start]);

  const {
    data,
    loading,
    error,
    analyzeCustomPeriod,
    analyzeDualMetricComparison
  } = useGrowthAnalysis();

  const handleAnalyze = async () => {
    if (!period1Start || !period1End || !period2Start || !period2End) return;

    // Group by
    const groups = groupBy === 'org' ? ['org_level_3'] : ['salesman_name'];

    if (metricMode === 'dual') {
      // 双指标模式：同时查询保费和件数
      const result = await analyzeDualMetricComparison(
        { startDate: period1Start, endDate: period1End },
        { startDate: period2Start, endDate: period2End },
        groups,
        additionalFilterParams
      );
      if (result.success) {
        setDualMetricData(result.data);
      }
    } else {
      // 单指标模式：使用视角切换
      const metric = perspectiveConfig.aggregation;
      analyzeCustomPeriod(
        { startDate: period1Start, endDate: period1End },
        { startDate: period2Start, endDate: period2End },
        metric,
        groups,
        additionalFilterParams
      );
    }
  };

  const chartData = data.slice(0, 15).map(item => ({
    dim_key: String(item.org_level_3 || item.salesman_name || '-'),
    current_value: item.current_value,
    previous_value: item.previous_value,
    growth_rate: item.growth_rate ? item.growth_rate * 100 : 0
  }));

  const formatValue = isPremiumPerspective ? formatPremiumWan : formatCount;

  return (
    <div className="space-y-6">
      <div className="bg-neutral-50 dark:bg-neutral-800 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700">
        {/* 快捷预设按钮 */}
        <div className="mb-4 pb-3 border-b border-neutral-200 dark:border-neutral-700">
          <ComparisonQuickPresets
            activePreset={activePreset}
            onPresetChange={handlePresetChange}
            baseDate={baseDate}
          />
        </div>

        {/* 日期选择器（自定义模式显示，预设模式折叠） */}
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4 ${activePreset !== 'custom' ? 'opacity-60' : ''}`}>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              当前期间 (Period 1)
              {activePreset !== 'custom' && <span className="text-xs text-neutral-400 ml-2">自动计算</span>}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={period1Start}
                onChange={e => { setPeriod1Start(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
              <span className="text-neutral-500">to</span>
              <input
                type="date"
                value={period1End}
                onChange={e => { setPeriod1End(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              对比期间 (Period 2)
              {activePreset !== 'custom' && <span className="text-xs text-neutral-400 ml-2">自动计算</span>}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={period2Start}
                onChange={e => { setPeriod2Start(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
              <span className="text-neutral-500">to</span>
              <input
                type="date"
                value={period2End}
                onChange={e => { setPeriod2End(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
            </div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">分析维度</label>
                <select
                    value={groupBy}
                    onChange={e => setGroupBy(e.target.value as 'org' | 'salesman')}
                    className="border rounded px-3 py-1.5 text-sm bg-white dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-300 shadow-sm"
                >
                    <option value="org">按机构</option>
                    <option value="salesman">按业务员</option>
                </select>
            </div>

            {/* 指标模式切换 */}
            <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">指标模式</label>
                <div className="flex bg-neutral-100 dark:bg-neutral-700 rounded p-0.5">
                  <button
                    className={`px-3 py-1 text-xs rounded transition-all ${metricMode === 'single' ? 'bg-white dark:bg-neutral-600 shadow text-primary font-medium' : 'text-neutral-500 dark:text-neutral-400'}`}
                    onClick={() => setMetricMode('single')}
                  >
                    单指标
                  </button>
                  <button
                    className={`px-3 py-1 text-xs rounded transition-all ${metricMode === 'dual' ? 'bg-white dark:bg-neutral-600 shadow text-primary font-medium' : 'text-neutral-500 dark:text-neutral-400'}`}
                    onClick={() => setMetricMode('dual')}
                    title="同时显示保费和件数"
                  >
                    双指标
                  </button>
                </div>
            </div>

            {/* 单指标模式时显示视角切换器 */}
            {metricMode === 'single' && (
              <PerspectiveSwitcher value={perspective} onChange={setPerspective} compact />
            )}

            <button
                onClick={handleAnalyze}
                disabled={loading}
                className="bg-primary-dark text-white px-4 py-1.5 rounded hover:bg-primary-dark disabled:bg-neutral-400 text-sm font-medium shadow-sm transition-colors"
            >
                {loading ? '分析中...' : '开始对比'}
            </button>
          </div>
        </div>
        <div className="text-xs text-neutral-500 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-primary-light"></span>
          <span>使用全局筛选条件 (不含日期)</span>
          <span className="inline-block w-2 h-2 rounded-full bg-success-light ml-2"></span>
          <span>日期口径: {filters.date_criteria === 'insurance_start_date' ? '起保日期' : '签单日期'}</span>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg border border-danger-border text-danger-dark px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 双指标模式结果 */}
      {metricMode === 'dual' && dualMetricData.length > 0 && (
        <div className="space-y-6">
          {/* 双Y轴图表 */}
          <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow border border-neutral-100 dark:border-neutral-700">
            <DualYAxisComparisonChart
              data={dualMetricData}
              loading={loading}
              title="保费与件数对比分析 (Top 15)"
              height={450}
              currentLabel="当期"
              previousLabel="基期"
            />
          </div>

          {/* 双指标详细表格 */}
          <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow border border-neutral-100 dark:border-neutral-700">
            <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">详细数据对比（双指标）</h3>
            <StickyTableFrame maxHeight={400}>
              <table className="min-w-full divide-y divide-neutral-200">
                <thead className="bg-neutral-50 dark:bg-surface-2">
                  <tr>
                    <th className={cn('px-3 py-2 text-left text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.firstColumnHeader)}>维度</th>
                    <th className={cn('px-3 py-2 text-right text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>当期保费</th>
                    <th className={cn('px-3 py-2 text-right text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>基期保费</th>
                    <th className={cn('px-3 py-2 text-right text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>保费增长率</th>
                    <th className={cn('px-3 py-2 text-right text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>当期件数</th>
                    <th className={cn('px-3 py-2 text-right text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>基期件数</th>
                    <th className={cn('px-3 py-2 text-right text-xs font-medium text-neutral-500 uppercase bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>件数增长率</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-700">
                  {dualMetricData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-primary-bg transition-colors">
                      <td className={cn('px-3 py-2 text-sm font-medium text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-800', stickyTableStyles.firstColumn)}>{row.dim_key}</td>
                      <td className={cn('px-3 py-2 text-sm text-neutral-900 text-right', fontStyles.numeric)}>{formatPremiumWan(row.current_premium)}</td>
                      <td className={cn('px-3 py-2 text-sm text-neutral-500 text-right', fontStyles.numeric)}>{formatPremiumWan(row.previous_premium)}</td>
                      <td className={cn('px-3 py-2 text-sm text-right font-medium', fontStyles.numeric, getTrendColorClass(row.premium_growth_rate || 0, 'positive'))}>
                        {row.premium_growth_rate !== null ? formatRate(row.premium_growth_rate) : '-'}
                      </td>
                      <td className={cn('px-3 py-2 text-sm text-neutral-900 text-right', fontStyles.numeric)}>{formatCount(row.current_count)}</td>
                      <td className={cn('px-3 py-2 text-sm text-neutral-500 text-right', fontStyles.numeric)}>{formatCount(row.previous_count)}</td>
                      <td className={cn('px-3 py-2 text-sm text-right font-medium', fontStyles.numeric, getTrendColorClass(row.count_growth_rate || 0, 'positive'))}>
                        {row.count_growth_rate !== null ? formatRate(row.count_growth_rate) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StickyTableFrame>
          </div>
        </div>
      )}

      {/* 单指标模式结果 */}
      {metricMode === 'single' && data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow border border-neutral-100 dark:border-neutral-700 flex flex-col h-[500px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">对比分析图表 (Top 15)</h3>
                  <div className="flex bg-neutral-100 dark:bg-neutral-700 rounded p-1">
                    <button
                      className={`px-3 py-1 text-xs rounded transition-all ${chartMode === 'comparison' ? 'bg-white dark:bg-neutral-600 shadow text-primary font-medium' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'}`}
                      onClick={() => setChartMode('comparison')}
                    >
                      数值对比
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded transition-all ${chartMode === 'growth' ? 'bg-white dark:bg-neutral-600 shadow text-primary font-medium' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'}`}
                      onClick={() => setChartMode('growth')}
                    >
                      增长率
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {chartMode === 'comparison' ? (
                    <GroupedBarChart
                      data={chartData}
                      seriesConfigs={[
                        { key: 'current_value', name: '当前期间', color: '#5470C6' },
                        { key: 'previous_value', name: '对比期间', color: '#91CC75' }
                      ]}
                      valueFormatter={formatValue}
                      loading={loading}
                      height="100%"
                    />
                  ) : (
                    <BarChart
                      data={chartData.map(d => ({ dim_key: d.dim_key, value: d.growth_rate }))}
                      title="增长率 (%)"
                      valueFormatter={formatRate}
                      loading={loading}
                    />
                  )}
                </div>
            </div>

            <div className="bg-white dark:bg-neutral-800 p-4 rounded shadow border border-neutral-100 flex flex-col h-[500px]">
                <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">详细数据对比</h3>
                <StickyTableFrame className="flex-1" maxHeight={420}>
                  <table className="min-w-full divide-y divide-neutral-200">
                      <thead className="bg-neutral-50 dark:bg-surface-2">
                          <tr>
                              <th className={cn('px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50 dark:bg-surface-2', stickyTableStyles.firstColumnHeader)}>维度</th>
                              <th className={cn('px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>当前期间</th>
                              <th className={cn('px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>对比期间</th>
                              <th className={cn('px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>变化量</th>
                              <th className={cn('px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider bg-neutral-50 dark:bg-surface-2', stickyTableStyles.header)}>增长率</th>
                          </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-700">
                          {data.map((row, idx) => (
                              <tr key={idx} className="hover:bg-primary-bg transition-colors">
                                  <td className={cn('px-4 py-3 text-sm font-medium text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-800', stickyTableStyles.firstColumn)}>{row.org_level_3 || row.salesman_name || '-'}</td>
                                  <td className={cn('px-4 py-3 text-sm text-neutral-900 text-right', fontStyles.numeric)}>{formatValue(row.current_value)}</td>
                                  <td className={cn('px-4 py-3 text-sm text-neutral-500 text-right', fontStyles.numeric)}>{formatValue(row.previous_value)}</td>
                                  <td className={cn('px-4 py-3 text-sm text-right font-medium', fontStyles.numeric, getTrendColorClass(row.current_value - row.previous_value, 'positive'))}>
                                      {formatValue(row.current_value - row.previous_value)}
                                  </td>
                                  <td className={cn('px-4 py-3 text-sm text-right font-medium', fontStyles.numeric, getTrendColorClass(row.growth_rate || 0, 'positive'))}>
                                      {formatRate(row.growth_rate || 0)}
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
                </StickyTableFrame>
            </div>
        </div>
      )}
    </div>
  );
};
