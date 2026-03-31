import { useState, useMemo } from 'react';
import { cardStyles, colorClasses, fontStyles, getHeatmapColor, toggleButtonStyles } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import { useQuoteHeatmap } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

interface Props {
  filters: QuoteFilters;
}

const DIMENSIONS = [
  { key: '续保情况', label: '续保/转保' },
  { key: '车险分等级', label: '风险等级' },
  { key: 'NCD系数', label: 'NCD系数' },
  { key: '险别组合', label: '险别组合' },
  { key: '客户类别', label: '客户类别' },
  { key: '是否新能源车', label: '新能源' },
  { key: '交通风险评分等级', label: '交通评分' },
] as const;

// 热力色映射已迁移到 src/shared/styles/index.ts → getHeatmapColor()

export function DimensionHeatmap({ filters }: Props) {
  const [selectedDim, setSelectedDim] = useState<string>('续保情况');
  const { data, isLoading } = useQuoteHeatmap(filters, selectedDim);

  const { orgs, dimValues, matrix } = useMemo(() => {
    if (!data) return { orgs: [], dimValues: [], matrix: new Map() };

    const orgSet = new Set<string>();
    const dimSet = new Set<string>();
    const m = new Map<string, { rate: number; count: number }>();

    for (const row of data) {
      const org = row.org ?? '';
      const dim = String(row.dim_value ?? '');
      orgSet.add(org);
      dimSet.add(dim);
      m.set(`${org}|${dim}`, { rate: row.conversion_rate ?? 0, count: row.total_quotes ?? 0 });
    }

    return {
      orgs: Array.from(orgSet).sort(),
      dimValues: Array.from(dimSet).sort(),
      matrix: m,
    };
  }, [data]);

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">维度热力图</h3>
        <div className="flex gap-1 flex-wrap">
          {DIMENSIONS.map(d => (
            <button
              key={d.key}
              onClick={() => setSelectedDim(d.key)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                selectedDim === d.key ? toggleButtonStyles.active : toggleButtonStyles.inactive
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-48 bg-neutral-100 dark:bg-neutral-800 rounded" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left p-2 font-medium text-neutral-500">机构</th>
                {dimValues.map(v => (
                  <th key={v} className="text-center p-2 font-medium text-neutral-500 whitespace-nowrap">{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org}>
                  <td className="p-2 font-medium text-neutral-700 dark:text-neutral-300 whitespace-nowrap">{org}</td>
                  {dimValues.map(dim => {
                    const cell = matrix.get(`${org}|${dim}`);
                    if (!cell) return <td key={dim} className="p-2 text-center text-neutral-300">-</td>;
                    return (
                      <td key={dim} className="p-1">
                        <div className={`rounded-md p-2 text-center ${getHeatmapColor(cell.rate)}`}>
                          <div className={`font-semibold ${fontStyles.tabular}`}>{cell.rate}%</div>
                          <div className="text-[10px] opacity-75">{formatCount(cell.count)}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
