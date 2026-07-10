import { useMemo } from 'react';
import { cn, getHeatmapColor } from '../../../shared/styles';
import { RateCell } from '../../../shared/ui';
import { formatCount } from '../../../shared/utils/formatters';
import type { HeatmapRow } from '../types';

interface Props {
  data: HeatmapRow[] | undefined;
}

/**
 * 机构 × 维度值 · 报价承保转化率热力矩阵表
 *
 * DimensionHeatmap 与 DimensionMatrix 的共用渲染层（热力图收拢第一批，
 * backlog 2026-06-11-claude-3093a3 ⑤）：矩阵构建 + 表格渲染此前在两组件各持一份。
 * 横向滚动容器由调用方提供（两处布局不同）。
 */
export function QuoteHeatmapMatrixTable({ data }: Props) {
  const { orgs, dimValues, matrix } = useMemo(() => {
    if (!data) return { orgs: [], dimValues: [], matrix: new Map<string, { rate: number; count: number }>() };
    const orgSet = new Set<string>();
    const dimSet = new Set<string>();
    const m = new Map<string, { rate: number; count: number }>();
    for (const row of data) {
      const org = row.org ?? '';
      const dim = String(row.dim_value ?? '');
      orgSet.add(org);
      dimSet.add(dim);
      m.set(`${org}|${dim}`, { rate: row.underwriting_rate ?? 0, count: row.total_quotes ?? 0 });
    }
    return { orgs: Array.from(orgSet).sort(), dimValues: Array.from(dimSet).sort(), matrix: m };
  }, [data]);

  return (
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
                  <div className={cn('rounded-md p-2 text-center', getHeatmapColor(cell.rate))}>
                    <div className="font-semibold">
                      <RateCell value={cell.rate} />
                    </div>
                    <div className="text-[10px] opacity-75">{formatCount(cell.count)}</div>
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
