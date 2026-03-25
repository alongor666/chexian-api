import React from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { useRenewalDrilldown } from './hooks/useRenewalDrilldown';
import { tableStyles, textStyles } from '../../shared/styles';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { RenewalQuadrantView } from './RenewalQuadrantView';
import {
  DrilldownBreadcrumb,
  DrilldownCell,
  DrilldownLoadingOverlay,
  DrilldownExhaustedBanner,
} from '../../shared/ui';
import { DIMENSION_LABELS, isConditionalDimension } from '../../shared/config/drilldown-dimensions';
import type { DrilldownBreadcrumbStep } from '../../shared/ui';

interface RenewalDrilldownPanelProps {
  filters: AdvancedFilterState;
  targetYear: number;
  cutoffDate?: string;
  bundleOnly: boolean;
  setBundleOnly: (v: boolean) => void;
  selfRenewalOnly: boolean;
  setSelfRenewalOnly: (v: boolean) => void;
  selectedDueMonth: number | null;
  setSelectedDueMonth: (v: number | null) => void;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const RenewalDrilldownPanel: React.FC<RenewalDrilldownPanelProps> = ({
  targetYear,
  cutoffDate,
  bundleOnly,
  setBundleOnly,
  selfRenewalOnly,
  setSelfRenewalOnly,
  selectedDueMonth,
  setSelectedDueMonth,
}) => {
  const {
    rows,
    loading,
    error,
    breadcrumb,
    currentGroupBy,
    availableDimensions,
    canDrillDown,
    drillDown,
    navigateTo,
    reset,
    canGoToTop,
    dimensionLabels,
  } = useRenewalDrilldown({
    targetYear,
    cutoffDate,
    bundleOnly,
    selfRenewalOnly,
    selectedDueMonth,
  });

  // 条件维度列表（琥珀色标记）
  const conditionalDims = availableDimensions.filter(isConditionalDimension);

  // 当前分组维度的中文标签
  const currentDimLabel = dimensionLabels[currentGroupBy] || currentGroupBy;

  return (
    <div className="space-y-4">
      {/* 面包屑导航 */}
      <div className="bg-white p-3 rounded-xl shadow-sm mb-4">
        <DrilldownBreadcrumb
          path={breadcrumb.map((b): DrilldownBreadcrumbStep => ({
            label: String(b.label),
            dimension: b.dimension,
            value: b.value,
          }))}
          onNavigate={navigateTo}
          canGoToTop={canGoToTop}
          topLabel="四川分公司"
          dimensionLabels={dimensionLabels}
        />
      </div>

      {/* 筛选开关行 */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={bundleOnly}
            onChange={(e) => setBundleOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span>仅套单</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={selfRenewalOnly}
            onChange={(e) => setSelfRenewalOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span>仅自留续保</span>
        </label>

        {/* 到期月份选择 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">到期月份:</span>
          <div className="flex gap-1">
            <button
              onClick={() => setSelectedDueMonth(null)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${selectedDueMonth === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              全部
            </button>
            {MONTHS.map((m) => (
              <button
                key={m}
                onClick={() => setSelectedDueMonth(m)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${selectedDueMonth === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                {m}月
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* 下钻穷尽提示 */}
      <DrilldownExhaustedBanner
        visible={!canDrillDown && rows.length > 0 && !loading}
        onReset={reset}
      />

      {/* 四象限图 */}
      {!loading && rows.length > 0 && (
        <RenewalQuadrantView
          rows={rows}
          currentDimensionLabel={currentDimLabel}
        />
      )}

      {/* 数据表格 */}
      <DrilldownLoadingOverlay loading={loading}>
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableStyles.header}>
                <th className={tableStyles.headerCell}>{currentDimLabel}</th>
                <th className={`${tableStyles.headerCell} text-right`}>应续件数</th>
                <th className={`${tableStyles.headerCell} text-right`}>已续件数</th>
                <th className={`${tableStyles.headerCell} text-right`}>续保率</th>
                <th className={`${tableStyles.headerCell} text-right`}>有报价件数</th>
                <th className={`${tableStyles.headerCell} text-right`}>报价率</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    暂无数据
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.group_name} className={tableStyles.row}>
                  <td className={tableStyles.cell}>
                    <DrilldownCell
                      label={row.group_name}
                      availableDimensions={availableDimensions}
                      dimensionLabels={dimensionLabels}
                      onSelect={(nextDim) => drillDown(row.group_name, nextDim as any)}
                      conditionalDimensions={conditionalDims}
                    />
                  </td>
                  <td className={`${tableStyles.cell} text-right ${textStyles.numeric}`}>
                    {formatCount(row.due_count)}
                  </td>
                  <td className={`${tableStyles.cell} text-right ${textStyles.numeric}`}>
                    {formatCount(row.renewed_count)}
                  </td>
                  <td className={`${tableStyles.cell} text-right ${textStyles.numeric}`}>
                    {formatPercent(row.renewal_rate * 100)}
                  </td>
                  <td className={`${tableStyles.cell} text-right ${textStyles.numeric}`}>
                    {formatCount(row.quoted_count)}
                  </td>
                  <td className={`${tableStyles.cell} text-right ${textStyles.numeric}`}>
                    {formatPercent(row.quote_rate * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DrilldownLoadingOverlay>
    </div>
  );
};
