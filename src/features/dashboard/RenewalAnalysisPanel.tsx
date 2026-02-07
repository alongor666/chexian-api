import React from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { formatCount, formatPremiumWan } from '../../shared/utils/formatters';
import { RenewalStatusBadge } from '../../shared/ui';
import type { ViewPerspective } from '../../shared/types';
import { getPerspectiveConfig } from '../../shared/types';
import { PerspectiveSwitcher } from '../../widgets/filters/PerspectiveSwitcher';
import { useRenewalAnalysis } from './hooks/useRenewalAnalysis';
import { useDataStatus } from '../../shared/contexts/DataContext';

interface RenewalAnalysisPanelProps {
  filters: AdvancedFilterState;
  perspective: ViewPerspective;
  setPerspective: (perspective: ViewPerspective) => void;
}

export const RenewalAnalysisPanel: React.FC<RenewalAnalysisPanelProps> = ({
  filters,
  perspective,
  setPerspective,
}) => {
  const targetYear = filters.analysis_year ?? new Date().getFullYear();
  const perspectiveConfig = getPerspectiveConfig(perspective);
  const valueFormatter =
    perspectiveConfig.valueFormatter === 'premium' ? formatPremiumWan : formatCount;
  const valueLabel = perspectiveConfig.valueFormatter === 'premium' ? '保费' : '件数';

  const currentMonth = new Date().getMonth() + 1;
  const [selectedMonth, setSelectedMonth] = React.useState(currentMonth);

  const { isDataLoaded } = useDataStatus();

  const {
    detailData,
    availableMonths,
    latestPolicyDate,
    loading,
    error,
    hasCheckedAvailability,
  } = useRenewalAnalysis({
    filters,
    perspective,
    selectedMonth,
    targetYear,
    enabled: isDataLoaded,
  });

  React.useEffect(() => {
    if (hasCheckedAvailability && availableMonths.length > 0 && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [hasCheckedAvailability, availableMonths, selectedMonth]);

  return (
    <div className="space-y-6">
      {/* 口径提示 */}
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
        <div className="flex items-start">
          <span className="text-blue-600 text-xl mr-3">ℹ️</span>
          <div>
            <p className="text-blue-800 font-semibold text-sm">续保率分析固定使用起保日期口径</p>
            <p className="text-blue-700 text-xs mt-1">
              不受页面顶部"数据口径"选择器（签单日期/起保日期切换）的影响。续保率统计必须基于起保日期才能准确反映业务续保情况。
            </p>
          </div>
        </div>
      </div>

      {/* 续保率计算说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
        <h4 className="text-blue-800 font-semibold text-sm mb-2">📖 续保率计算说明</h4>
        <ul className="text-blue-700 text-xs space-y-1">
          <li>• <strong>当前视角</strong>：{perspectiveConfig.label}</li>
          <li>• <strong>到期日定义</strong>：起保日期 + 1年 - 1天（例：2025-01-02起保 → 2026-01-01到期）</li>
          <li>• <strong>应续保单</strong>：{targetYear - 1}年起保的保单（分母）</li>
          <li>• <strong>已续保单</strong>：{targetYear - 1}年起保且续保单号不为空的保单（表示已续保到{targetYear}年）（分子）</li>
          <li>• <strong>续保率</strong> = 已续保{valueLabel} / 应续保{valueLabel} × 100%</li>
          <li>• <strong>当日续保率</strong>：当日到期且已续保的{valueLabel} / 当日到期的{valueLabel}</li>
          <li>• <strong>当月续保率</strong>：截至当日该月到期且已续保的{valueLabel} / 截至当日该月到期的{valueLabel}</li>
          <li>• <strong>当年续保率</strong>：截至当日该年到期且已续保的{valueLabel} / 截至当日该年到期的{valueLabel}</li>
        </ul>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <div className="flex flex-wrap items-center gap-4">
          <PerspectiveSwitcher
            value={perspective}
            onChange={setPerspective}
            label="分析视角"
            showDescription={false}
          />
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <label className="font-medium" htmlFor="renewal-month">
              月份
            </label>
            <select
              id="renewal-month"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(Number(event.target.value))}
            >
              {Array.from({ length: 12 }, (_, index) => {
                const month = index + 1;
                const hasData = availableMonths.includes(month);
                return (
                  <option key={month} value={month}>
                    {month} 月{hasData ? ' ✓' : ' (无数据)'}
                  </option>
                );
              })}
            </select>
            {availableMonths.length > 0 && (
              <span className="text-xs text-gray-500">
                有数据的月份：{availableMonths.join(', ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
          <p className="text-red-800 font-semibold">❌ 续保明细表格查询失败</p>
          <p className="text-red-700 text-sm mt-1">{error}</p>
          <p className="text-red-600 text-xs mt-2">
            💡 请打开浏览器开发者工具（F12）查看详细日志
          </p>
        </div>
      )}

      {/* 续保明细表格 */}
      <div className="bg-white rounded shadow p-4">
        <h3 className="text-lg font-semibold mb-4">
          续保明细表格（{targetYear}年{selectedMonth}月，{perspectiveConfig.label}视角）
        </h3>
        {loading ? (
          <div className="text-center text-gray-400 py-12">数据加载中...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left border-r border-gray-200">到期日</th>
                  <th className="px-3 py-2 text-right border-r border-gray-200">当日应续{valueLabel}</th>
                  <th className="px-3 py-2 text-right border-r border-gray-200">当日已续{valueLabel}</th>
                  <th className="px-3 py-2 text-right border-r-2 border-gray-300">当日续保率</th>
                  <th className="px-3 py-2 text-right border-r border-gray-200">截至当日当月应续{valueLabel}</th>
                  <th className="px-3 py-2 text-right border-r border-gray-200">截至当日当月已续{valueLabel}</th>
                  <th className="px-3 py-2 text-right border-r-2 border-gray-300">当月续保率</th>
                  <th className="px-3 py-2 text-right border-r border-gray-200">截至当日当年应续{valueLabel}</th>
                  <th className="px-3 py-2 text-right border-r border-gray-200">截至当日当年已续{valueLabel}</th>
                  <th className="px-3 py-2 text-right">当年续保率</th>
                </tr>
              </thead>
              <tbody>
                {detailData.map((row, idx) => {
                  const isLatestDate = latestPolicyDate && row.month_day === latestPolicyDate;
                  return (
                    <tr
                      key={idx}
                      className={`border-t hover:bg-gray-50 ${
                        isLatestDate ? 'bg-yellow-100 font-semibold' : ''
                      }`}
                      title={isLatestDate ? '最新签单日期对应的到期日' : ''}
                    >
                      <td className="px-3 py-2 border-r border-gray-200">
                        {row.month_day}
                        {isLatestDate && <span className="ml-2 text-yellow-600">★</span>}
                      </td>
                    <td className="px-3 py-2 text-right border-r border-gray-200">{valueFormatter(row.daily_due_count)}</td>
                    <td className="px-3 py-2 text-right border-r border-gray-200">{valueFormatter(row.daily_renewed_count)}</td>
                    <td className="px-3 py-2 border-r-2 border-gray-300 text-center">
                      <RenewalStatusBadge rate={row.daily_renewal_rate} mode="dot" size="small" />
                    </td>
                    <td className="px-3 py-2 text-right border-r border-gray-200 font-mono tabular-nums">{valueFormatter(row.month_to_date_due_count)}</td>
                    <td className="px-3 py-2 text-right border-r border-gray-200 font-mono tabular-nums">{valueFormatter(row.month_to_date_renewed_count)}</td>
                    <td className="px-3 py-2 border-r-2 border-gray-300 text-center">
                      <RenewalStatusBadge rate={row.monthly_renewal_rate} mode="dot" size="small" />
                    </td>
                    <td className="px-3 py-2 text-right border-r border-gray-200 font-mono tabular-nums">{valueFormatter(row.year_to_date_due_count)}</td>
                    <td className="px-3 py-2 text-right border-r border-gray-200 font-mono tabular-nums">{valueFormatter(row.year_to_date_renewed_count)}</td>
                    <td className="px-3 py-2 text-center">
                      <RenewalStatusBadge rate={row.yearly_renewal_rate} mode="dot" size="small" />
                    </td>
                  </tr>
                  );
                })}
                {!loading && detailData.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center" colSpan={10}>
                      <div className="text-gray-400">
                        <p className="mb-2">📭 {selectedMonth} 月暂无续保数据</p>
                        {availableMonths.length > 0 && !availableMonths.includes(selectedMonth) && (
                          <p className="text-sm text-blue-600">
                            💡 提示：{targetYear - 1}年{selectedMonth}月没有起保的保单，
                            请尝试切换到其他月份（有数据的月份：{availableMonths.join(', ')}）
                          </p>
                        )}
                        {availableMonths.length === 0 && (
                          <p className="text-sm text-orange-600">
                            ⚠️ {targetYear - 1}年全年都没有符合筛选条件的起保数据，
                            请检查筛选条件（机构、业务员等）或更换数据文件
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
