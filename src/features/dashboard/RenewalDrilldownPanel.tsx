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
import { RENEWAL_LEVEL_LABELS } from '../../shared/config/drilldown-dimensions';
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

/**
 * 续保层级中文标签。
 * RENEWAL_LEVEL_LABELS.company = '四川分公司'（维度选择器用），
 * 此处覆盖为 '全公司' 仅影响 dimensionLabels tooltip，
 * 面包屑顶部显示由 topLabel prop 独立控制。
 */
const LEVEL_LABELS: Record<string, string> = {
  ...RENEWAL_LEVEL_LABELS,
  company: '全公司',
};

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
    currentLevel,
    nextLevel,
    canDrillDown,
    drillDown,
    navigateTo,
    reset,
    canGoToTop,
  } = useRenewalDrilldown({
    targetYear,
    cutoffDate,
    bundleOnly,
    selfRenewalOnly,
    selectedDueMonth,
  });

  return (
    <div className="space-y-4">
      {/* 面包屑导航 */}
      <div className="bg-white p-3 rounded-xl shadow-sm mb-4">
        <DrilldownBreadcrumb
          path={breadcrumb.slice(1).map((b): DrilldownBreadcrumbStep => ({
            label: String(b.label),
            dimension: b.level,
            value: b.value,
          }))}
          onNavigate={(toIndex) => {
            // toIndex=-1 → 回到顶层(index 0)；toIndex=0 → 第1个下钻层(index 1)
            navigateTo(toIndex + 1);
          }}
          canGoToTop={canGoToTop}
          topLabel={breadcrumb[0]?.label || '全公司'}
          dimensionLabels={LEVEL_LABELS}
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
          currentDimensionLabel={LEVEL_LABELS[nextLevel || currentLevel] || '维度'}
        />
      )}

      {/* 数据表格 */}
      <DrilldownLoadingOverlay loading={loading}>
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableStyles.header}>
                <th className={tableStyles.headerCell}>名称</th>
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
                      availableDimensions={nextLevel ? [nextLevel] : []}
                      dimensionLabels={LEVEL_LABELS}
                      onSelect={() => drillDown(row.group_name)}
                      autoOnSingle
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
