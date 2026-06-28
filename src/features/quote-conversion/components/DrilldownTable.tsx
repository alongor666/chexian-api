import { useState, useCallback, useMemo } from 'react';
import { cardStyles, colorClasses, fontStyles, tableStyles } from '../../../shared/styles';
import { RateCell } from '../../../shared/ui';
import { formatCount } from '../../../shared/utils/formatters';
import { useQuoteDrilldown } from '../hooks/useQuoteConversion';
import type { QuoteFilters, DrillLevel } from '../types';
import { isBranchSummaryRow } from '../../../shared/utils/branchDisplay';

interface Props {
  filters: QuoteFilters;
}

interface BreadcrumbItem {
  level: DrillLevel;
  label: string;
  filterKey?: string;
  filterValue?: string;
}

export function DrilldownTable({ filters }: Props) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { level: 'org', label: '全部机构' },
  ]);

  const currentLevel = breadcrumbs[breadcrumbs.length - 1];

  const drillFilters: QuoteFilters = { ...filters };
  for (const bc of breadcrumbs) {
    if (bc.filterKey && bc.filterValue) {
      (drillFilters as Record<string, string>)[bc.filterKey] = bc.filterValue;
    }
  }

  const { data, isLoading } = useQuoteDrilldown(drillFilters, currentLevel.level);

  // 计算整体均值，用于条件着色
  const avgConversionRate = useMemo(() => {
    if (!data || data.length === 0) return 0;
    const totalQuotes = data.reduce((s, r) => s + (r.total_quotes ?? 0), 0);
    const totalInsured = data.reduce((s, r) => s + (r.total_insured ?? 0), 0);
    return totalQuotes > 0 ? (totalInsured / totalQuotes) * 100 : 0;
  }, [data]);

  const handleDrill = useCallback((groupKey: string, groupName: string) => {
    if (currentLevel.level === 'org') {
      setBreadcrumbs(prev => [...prev, {
        level: 'team',
        label: groupName,
        filterKey: 'orgName',
        filterValue: groupKey,
      }]);
    } else if (currentLevel.level === 'team') {
      setBreadcrumbs(prev => [...prev, {
        level: 'salesman',
        label: groupName,
        filterKey: 'teamName',
        filterValue: groupKey,
      }]);
    }
  }, [currentLevel.level]);

  const handleBreadcrumbClick = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }, []);

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          机构 → 团队 → 业务员
        </h3>
        {/* 面包屑 */}
        <div className="flex items-center gap-1 text-xs">
          {breadcrumbs.map((bc, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && <span className={`mx-1 ${colorClasses.text.neutralMuted}`}>/</span>}
              <button
                onClick={() => handleBreadcrumbClick(i)}
                className={i < breadcrumbs.length - 1
                  ? `${colorClasses.text.primary} hover:underline`
                  : 'text-neutral-800 dark:text-neutral-200 font-medium'}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-8 bg-neutral-100 dark:bg-neutral-800 rounded" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableStyles.container}>
            <thead>
              <tr>
                <th className={tableStyles.headerCell}>
                  {currentLevel.level === 'org' ? '机构' : currentLevel.level === 'team' ? '团队' : '业务员'}
                </th>
                <th className={`${tableStyles.headerCell} text-right`}>报价量</th>
                <th className={`${tableStyles.headerCell} text-right`}>承保量</th>
                <th className={`${tableStyles.headerCell} text-right`}>转化率 (%)</th>
                <th className={`${tableStyles.headerCell} text-right`}>续保率 (%)</th>
                <th className={`${tableStyles.headerCell} text-right`}>转保率 (%)</th>
                <th className={`${tableStyles.headerCell} text-right`}>折扣率 (%)</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).slice().sort((a, b) => {
                // 汇总行（"全部"/"合计"等）置顶
                const isAgg = (name: string) => isBranchSummaryRow(name);
                if (isAgg(a.group_name)) return -1;
                if (isAgg(b.group_name)) return 1;
                return (a.underwriting_rate ?? 0) - (b.underwriting_rate ?? 0);
              }).map((row) => (
                <tr
                  key={row.group_key}
                  className={`${tableStyles.row} ${currentLevel.level !== 'salesman' ? 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800' : ''}`}
                  onClick={() => currentLevel.level !== 'salesman' && handleDrill(row.group_key, row.group_name)}
                >
                  <td className={tableStyles.cell}>
                    <span className={currentLevel.level !== 'salesman' ? `${colorClasses.text.primary} font-medium` : ''}>
                      {row.group_name ?? row.group_key}
                    </span>
                  </td>
                  <td className={`${tableStyles.cell} text-right ${fontStyles.numeric}`}>{formatCount(row.total_quotes)}</td>
                  <td className={`${tableStyles.cell} text-right ${fontStyles.numeric}`}>{formatCount(row.total_insured)}</td>
                  <td className={`${tableStyles.cell} text-right font-medium ${
                    row.underwriting_rate < avgConversionRate ? colorClasses.text.danger : ''
                  }`}>
                    <RateCell value={row.underwriting_rate} />
                  </td>
                  <td className={`${tableStyles.cell} text-right`}>
                    <RateCell value={row.renewal_rate} />
                  </td>
                  <td className={`${tableStyles.cell} text-right`}>
                    <RateCell value={row.switch_rate} />
                  </td>
                  <td className={`${tableStyles.cell} text-right`}>
                    <RateCell value={row.avg_discount != null ? row.avg_discount * 100 : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
