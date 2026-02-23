import React, { useState, useEffect, useCallback } from 'react';
import { useGrowthAnalysis, type DualMetricComparisonData } from '../hooks/useGrowthAnalysis';
import { GroupedBarChart } from '../../../widgets/charts/GroupedBarChart';
import { BarChart } from '../../../widgets/charts/BarChart';
import { DualYAxisComparisonChart } from '../../../widgets/charts/DualYAxisComparisonChart';
import { formatPremiumWan, formatRate, formatCount } from '../../../shared/utils/formatters';
import type { AdvancedFilterState } from '../../../shared/types/data';
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

  // 获取基准日期：优先使用外部传入的maxDataDate，否则使用当前日期
  const baseDate = maxDataDate || new Date().toISOString().split('T')[0];

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
        groups
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
        groups
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
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
        {/* 快捷预设按钮 */}
        <div className="mb-4 pb-3 border-b border-gray-200">
          <ComparisonQuickPresets
            activePreset={activePreset}
            onPresetChange={handlePresetChange}
            baseDate={baseDate}
          />
        </div>

        {/* 日期选择器（自定义模式显示，预设模式折叠） */}
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4 ${activePreset !== 'custom' ? 'opacity-60' : ''}`}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              当前期间 (Period 1)
              {activePreset !== 'custom' && <span className="text-xs text-gray-400 ml-2">自动计算</span>}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={period1Start}
                onChange={e => { setPeriod1Start(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
              <span className="text-gray-500">to</span>
              <input
                type="date"
                value={period1End}
                onChange={e => { setPeriod1End(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              对比期间 (Period 2)
              {activePreset !== 'custom' && <span className="text-xs text-gray-400 ml-2">自动计算</span>}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={period2Start}
                onChange={e => { setPeriod2Start(e.target.value); setActivePreset('custom'); }}
                className="border rounded px-2 py-1 text-sm shadow-sm"
              />
              <span className="text-gray-500">to</span>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">分析维度</label>
                <select
                    value={groupBy}
                    onChange={e => setGroupBy(e.target.value as 'org' | 'salesman')}
                    className="border rounded px-3 py-1.5 text-sm bg-white shadow-sm"
                >
                    <option value="org">按机构</option>
                    <option value="salesman">按业务员</option>
                </select>
            </div>

            {/* 指标模式切换 */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">指标模式</label>
                <div className="flex bg-gray-100 rounded p-0.5">
                  <button
                    className={`px-3 py-1 text-xs rounded transition-all ${metricMode === 'single' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500'}`}
                    onClick={() => setMetricMode('single')}
                  >
                    单指标
                  </button>
                  <button
                    className={`px-3 py-1 text-xs rounded transition-all ${metricMode === 'dual' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500'}`}
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
                className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium shadow-sm transition-colors"
            >
                {loading ? '分析中...' : '开始对比'}
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400"></span>
          <span>使用全局筛选条件 (不含日期)</span>
          <span className="inline-block w-2 h-2 rounded-full bg-green-400 ml-2"></span>
          <span>日期口径: {filters.date_criteria === 'insurance_start_date' ? '起保日期' : '签单日期'}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 双指标模式结果 */}
      {metricMode === 'dual' && dualMetricData.length > 0 && (
        <div className="space-y-6">
          {/* 双Y轴图表 */}
          <div className="bg-white p-4 rounded shadow border border-gray-100">
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
          <div className="bg-white p-4 rounded shadow border border-gray-100">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">详细数据对比（双指标）</h3>
            <div className="overflow-auto border rounded border-gray-200 max-h-[400px]">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-gray-50">维度</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-gray-50">当期保费</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-gray-50">基期保费</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-gray-50">保费增长率</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-gray-50">当期件数</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-gray-50">基期件数</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-gray-50">件数增长率</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dualMetricData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-blue-50 transition-colors">
                      <td className="px-3 py-2 text-sm font-medium text-gray-900">{row.dim_key}</td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-right font-tabular">{formatPremiumWan(row.current_premium)}</td>
                      <td className="px-3 py-2 text-sm text-gray-500 text-right font-tabular">{formatPremiumWan(row.previous_premium)}</td>
                      <td className="px-3 py-2 text-sm text-right font-tabular font-medium" style={{ color: (row.premium_growth_rate || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                        {row.premium_growth_rate !== null ? formatRate(row.premium_growth_rate) : '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-right font-tabular">{formatCount(row.current_count)}</td>
                      <td className="px-3 py-2 text-sm text-gray-500 text-right font-tabular">{formatCount(row.previous_count)}</td>
                      <td className="px-3 py-2 text-sm text-right font-tabular font-medium" style={{ color: (row.count_growth_rate || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                        {row.count_growth_rate !== null ? formatRate(row.count_growth_rate) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 单指标模式结果 */}
      {metricMode === 'single' && data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-4 rounded shadow border border-gray-100 flex flex-col h-[500px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">对比分析图表 (Top 15)</h3>
                  <div className="flex bg-gray-100 rounded p-1">
                    <button
                      className={`px-3 py-1 text-xs rounded transition-all ${chartMode === 'comparison' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                      onClick={() => setChartMode('comparison')}
                    >
                      数值对比
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded transition-all ${chartMode === 'growth' ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
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

            <div className="bg-white p-4 rounded shadow border border-gray-100 flex flex-col h-[500px]">
                <h3 className="text-lg font-semibold mb-4 text-gray-800">详细数据对比</h3>
                <div className="flex-1 overflow-auto border rounded border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                          <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">维度</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">当前期间</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">对比期间</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">变化量</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">增长率</th>
                          </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                          {data.map((row, idx) => (
                              <tr key={idx} className="hover:bg-blue-50 transition-colors">
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.org_level_3 || row.salesman_name || '-'}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900 text-right font-tabular">{formatValue(row.current_value)}</td>
                                  <td className="px-4 py-3 text-sm text-gray-500 text-right font-tabular">{formatValue(row.previous_value)}</td>
                                  <td className="px-4 py-3 text-sm text-right font-tabular font-medium" style={{ color: (row.current_value - row.previous_value) >= 0 ? '#10B981' : '#EF4444' }}>
                                      {formatValue(row.current_value - row.previous_value)}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right font-tabular font-medium" style={{ color: (row.growth_rate || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                                      {formatRate(row.growth_rate || 0)}
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
