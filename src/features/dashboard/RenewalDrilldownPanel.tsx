import React from 'react';
import type { AdvancedFilterState } from '../../shared/types/data';
import { useRenewalDrilldown } from './hooks/useRenewalDrilldown';
import { tableStyles, textStyles } from '../../shared/styles';
import { formatCount, formatPercent } from '../../shared/utils/formatters';
import { RenewalQuadrantView } from './RenewalQuadrantView';

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

const LEVEL_LABELS: Record<string, string> = {
  company: '全公司',
  org: '机构',
  team: '团队',
  salesman: '业务员',
  coverage: '险别组合',
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
      <nav className="flex items-center gap-1 text-sm">
        {breadcrumb.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-gray-400 mx-1">&gt;</span>}
            {index < breadcrumb.length - 1 ? (
              <button
                onClick={() => navigateTo(index)}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                {item.label}
              </button>
            ) : (
              <span className="font-semibold text-gray-900">{item.label}</span>
            )}
          </React.Fragment>
        ))}
      </nav>

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

      {/* 四象限图 */}
      {!loading && rows.length > 0 && (
        <RenewalQuadrantView
          rows={rows}
          currentDimensionLabel={LEVEL_LABELS[nextLevel || currentLevel] || '维度'}
        />
      )}

      {/* 数据表格 */}
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
            {loading && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">
                  加载中...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">
                  暂无数据
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row, idx) => (
                <tr key={idx} className={tableStyles.row}>
                  <td className={tableStyles.cell}>
                    {canDrillDown ? (
                      <button
                        onClick={() => drillDown(row.group_name)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        {row.group_name}
                      </button>
                    ) : (
                      <span>{row.group_name}</span>
                    )}
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
    </div>
  );
};
