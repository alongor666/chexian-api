import { useState } from 'react';
import { cardStyles, fontStyles, tableStyles, toggleButtonStyles } from '../../../shared/styles';
import { RateCell } from '../../../shared/ui';
import { formatCount } from '../../../shared/utils/formatters';
import { useQuoteRanking } from '../hooks/useQuoteConversion';
import type { QuoteFilters } from '../types';

interface Props {
  filters: QuoteFilters;
  title?: string;
  defaultDimension?: string;
  dimensions?: readonly { key: string; label: string }[];
}

const TABS = [
  { key: 'customer_category', label: '客户类别' },
  { key: 'commercial_ncd', label: '商业险NCD' },
  { key: 'insurance_grade', label: '风险等级' },
  { key: 'is_nev', label: '新能源' },
  { key: 'traffic_risk_grade', label: '交通评分' },
  { key: 'tonnage_segment', label: '货车吨位' },
  { key: 'is_telemarketing', label: '电销' },
  { key: 'is_transfer', label: '过户车' },
] as const;

export function RankingTable({
  filters,
  title = '多维度转化排行',
  defaultDimension = 'customer_category',
  dimensions = TABS,
}: Props) {
  const [dimension, setDimension] = useState<string>(defaultDimension);
  const { data, isLoading } = useQuoteRanking(filters, dimension);

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</h3>
        <div className="flex gap-1 flex-wrap">
          {dimensions.map(t => (
            <button
              key={t.key}
              onClick={() => setDimension(t.key)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                dimension === t.key ? toggleButtonStyles.active : toggleButtonStyles.inactive
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-neutral-100 dark:bg-neutral-800 rounded" />)}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableStyles.container}>
            <thead>
              <tr>
                <th className={tableStyles.headerCell}>{dimension}</th>
                <th className={`${tableStyles.headerCell} text-right`}>报价量</th>
                <th className={`${tableStyles.headerCell} text-right`}>承保量</th>
                <th className={`${tableStyles.headerCell} text-right`}>转化率 (%)</th>
                <th className={`${tableStyles.headerCell} text-right`}>折扣率 (%)</th>
                <th className={tableStyles.headerCell}>转化条</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).slice().sort((a, b) => (a.underwriting_rate ?? 0) - (b.underwriting_rate ?? 0)).map(row => {
                const maxQuotes = Math.max(...(data ?? []).map(r => r.total_quotes), 1);
                const barWidth = (row.total_quotes / maxQuotes) * 100;
                const insuredWidth = row.total_quotes > 0 ? (row.total_insured / row.total_quotes) * barWidth : 0;

                return (
                  <tr key={row.dim_value} className={tableStyles.row}>
                    <td className={`${tableStyles.cell} font-medium`}>{row.dim_value ?? '-'}</td>
                    <td className={`${tableStyles.cell} text-right ${fontStyles.numeric}`}>{formatCount(row.total_quotes)}</td>
                    <td className={`${tableStyles.cell} text-right ${fontStyles.numeric}`}>{formatCount(row.total_insured)}</td>
                    <td className={`${tableStyles.cell} text-right font-semibold`}>
                      <RateCell value={row.underwriting_rate} />
                    </td>
                    <td className={`${tableStyles.cell} text-right`}>
                      <RateCell value={row.avg_discount != null ? row.avg_discount * 100 : null} />
                    </td>
                    <td className={tableStyles.cell}>
                      <div className="h-4 bg-neutral-100 dark:bg-neutral-800 rounded overflow-hidden relative" style={{ width: '120px' }}>
                        <div className="h-full bg-neutral-300 rounded" style={{ width: `${barWidth}%` }} />
                        <div className="h-full bg-primary rounded absolute top-0 left-0" style={{ width: `${insuredWidth}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
