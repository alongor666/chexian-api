/**
 * 商车自主定价系数监控面板
 *
 * 功能：
 * - 展示各维度的系数数据（成都、全省、各机构）
 * - 按时间周期展示（当天、当周、当月、当年）
 * - 阈值合规状态高亮显示
 */

import { useMemo, useState, useCallback } from 'react';
import { useCoefficientMonitor } from '../hooks/useCoefficientMonitor';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { getPeriodLabel, getWeekPeriod } from '../../../shared/utils/coefficient-period';
import { CoefficientPeriodTable } from './CoefficientPeriodTable';
import { CoefficientTopTable } from './CoefficientTopTable';
import { CoefficientLegend } from './CoefficientLegend';
import { CoefficientDetailTable } from './CoefficientDetailTable';

interface CoefficientMonitorPanelProps {
  filters: AdvancedFilterState;
}

/**
 * 商车自主定价系数监控面板
 */
export const CoefficientMonitorPanel: React.FC<CoefficientMonitorPanelProps> = ({
  filters,
}) => {
  // 从 filters 中提取必要参数
  const dateField = filters.date_criteria || 'policy_date';
  const analysisYear = filters.analysis_year ?? new Date().getFullYear();
  const cutoffDateStr =
    filters.policy_date_end ?? new Date().toISOString().split('T')[0];
  const cutoffDate = useMemo(() => new Date(cutoffDateStr), [cutoffDateStr]);

  // 获取系数数据
  const { data, periodGroups, provinceTop, chengduTop, loading, error, refresh } =
    useCoefficientMonitor({
      dateField,
      cutoffDate,
      analysisYear,
      enabled: true,
    });

  // 显示模式
  const [viewMode, setViewMode] = useState<'periods' | 'detail'>('periods');

  const handleViewModeChange = useCallback((mode: 'periods' | 'detail') => {
    setViewMode(mode);
  }, []);

  // 计算周期标签
  const periodLabels = useMemo(() => {
    const generalWeek = getWeekPeriod(cutoffDate, 'general');
    const specialWeek = getWeekPeriod(cutoffDate, 'special');
    const monthlyWeek = getWeekPeriod(cutoffDate, 'monthly');

    return {
      general: getPeriodLabel('general', generalWeek),
      special: getPeriodLabel('special', specialWeek),
      monthly: getPeriodLabel('monthly', monthlyWeek),
    };
  }, [cutoffDate]);

  // 统计数据
  const dataStats = useMemo(
    () => ({
      total: data.length,
      compliant: data.filter((r) => r.isCompliant === true).length,
      exceeded: data.filter((r) => r.isCompliant === false).length,
      pending: data.filter((r) => r.isCompliant === null).length,
    }),
    [data]
  );

  const periodStats = useMemo(
    () => ({
      total: periodGroups.length,
      withData: periodGroups.filter((g) => g.hasData).length,
      withoutData: periodGroups.filter((g) => !g.hasData).length,
      dataPeriodsStr:
        periodGroups
          .filter((g) => g.hasData)
          .map((g) => g.periodName)
          .join(', ') || '无',
    }),
    [periodGroups]
  );

  // 渲染加载状态
  if (loading) {
    return (
      <div className="p-4 bg-white rounded-lg shadow">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <span className="ml-2 text-gray-600">加载系数数据中...</span>
        </div>
      </div>
    );
  }

  // 渲染错误状态
  if (error) {
    return (
      <div className="p-4 bg-white rounded-lg shadow">
        <div className="flex flex-col items-center justify-center h-64">
          <div className="text-red-500 mb-2">数据加载失败</div>
          <div className="text-sm text-gray-500 mb-4">{error.message}</div>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // 渲染空数据状态
  if (data.length === 0) {
    return (
      <div className="p-4 bg-white rounded-lg shadow">
        <div className="flex flex-col items-center justify-center h-64">
          <div className="text-gray-500 mb-2">暂无系数数据</div>
          <div className="text-sm text-gray-400">
            请上传包含商业险数据的Parquet文件
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      {/* 标题和操作区 */}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">商车自主定价系数监控</h2>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <span className="text-sm text-gray-500">
            截止日期: {cutoffDateStr} | 分析年度: {analysisYear}
          </span>
          {/* 视图切换按钮 */}
          <div className="flex rounded overflow-hidden border border-gray-300">
            <button
              onClick={() => handleViewModeChange('periods')}
              className={`px-3 py-1 text-sm ${
                viewMode === 'periods'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              周期分表
            </button>
            <button
              onClick={() => handleViewModeChange('detail')}
              className={`px-3 py-1 text-sm ${
                viewMode === 'detail'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              明细表
            </button>
          </div>
          <button
            onClick={refresh}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            刷新
          </button>
        </div>
      </div>

      {/* 置顶表格 */}
      <CoefficientTopTable
        title="全省商车自主定价系数监控表"
        rows={provinceTop}
        backgroundColor="#e0f2fe"
        regionName="全省"
      />

      <CoefficientTopTable
        title="成都商车自主定价系数监控表"
        rows={chengduTop}
        backgroundColor="#fff3cd"
        regionName="成都"
      />

      {/* 图例说明 */}
      <CoefficientLegend />

      {/* 周期分表视图 */}
      {viewMode === 'periods' && (
        <div>
          <h3 className="text-base font-semibold mb-4">当月各周期系数监控</h3>
          {periodGroups.map((group) => (
            <CoefficientPeriodTable
              key={group.periodName}
              periodName={group.periodName}
              rows={group.rows}
              startDate={group.startDate}
              endDate={group.endDate}
            />
          ))}

          <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm text-gray-500">
            <div>
              共 {periodStats.total} 个周期 | 有数据 {periodStats.withData} 个 |
              无数据 {periodStats.withoutData} 个
            </div>
            <div>数据周期：{periodStats.dataPeriodsStr}</div>
          </div>
        </div>
      )}

      {/* 明细表视图 */}
      {viewMode === 'detail' && (
        <CoefficientDetailTable
          data={data}
          stats={dataStats}
          periodLabels={periodLabels}
        />
      )}
    </div>
  );
};
