/**
 * 竞争格局 Tab — 流失去向 + 转入来源
 */

import { cardStyles, colorClasses, tableStyles, textStyles } from '../../../shared/styles';
import { formatCount, formatCurrency } from '../../../shared/utils/formatters';
import { useRenewalV2Competition, type RenewalV2Filters } from '../hooks/useRenewalV2';

interface Props {
  filters: RenewalV2Filters;
}

function shortenInsurer(name: string): string {
  return (name ?? '')
    .replace(/股份有限公司$/, '')
    .replace(/财产保险/, '财险')
    .replace(/中国人民/, '人保')
    .replace(/中国平安/, '平安')
    .replace(/中国太平洋/, '太保');
}

export function RenewalCompetitionTab({ filters }: Props) {
  const { data, isLoading } = useRenewalV2Competition(filters);

  const loss = data?.loss ?? [];
  const gain = data?.gain ?? [];

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-400">加载中...</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 流失去向 */}
      <div className={cardStyles.standard}>
        <h3 className={textStyles.titleSmall}>
          <span className={colorClasses.text.danger}>流失去向</span>
          <span className={`${textStyles.caption} ml-2`}>（未续保且有竞争数据）</span>
        </h3>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableStyles.header}>
                <th className={`${tableStyles.headerCell} text-left`}>保险公司</th>
                <th className={`${tableStyles.headerCell} text-right`}>流失件数</th>
                <th className={`${tableStyles.headerCell} text-right`}>保费(万)</th>
              </tr>
            </thead>
            <tbody>
              {loss.map((row: any, i: number) => (
                <tr key={row.lost_to_insurer ?? i} className="border-b border-neutral-100">
                  <td className={tableStyles.cell} title={row.lost_to_insurer}>
                    {shortenInsurer(row.lost_to_insurer ?? '')}
                  </td>
                  <td className={`${tableStyles.cellNumeric} ${colorClasses.text.danger}`}>
                    {formatCount(row.loss_count)}
                  </td>
                  <td className={tableStyles.cellNumeric}>{formatCurrency(row.loss_premium_wan)}</td>
                </tr>
              ))}
              {loss.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-neutral-400">无竞争流失数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 转入来源 */}
      <div className={cardStyles.standard}>
        <h3 className={textStyles.titleSmall}>
          <span className={colorClasses.text.success}>转入来源</span>
          <span className={`${textStyles.caption} ml-2`}>（已续保且有竞争数据）</span>
        </h3>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableStyles.header}>
                <th className={`${tableStyles.headerCell} text-left`}>保险公司</th>
                <th className={`${tableStyles.headerCell} text-right`}>转入件数</th>
                <th className={`${tableStyles.headerCell} text-right`}>保费(万)</th>
              </tr>
            </thead>
            <tbody>
              {gain.map((row: any, i: number) => (
                <tr key={row.source_insurer ?? i} className="border-b border-neutral-100">
                  <td className={tableStyles.cell} title={row.source_insurer}>
                    {shortenInsurer(row.source_insurer ?? '')}
                  </td>
                  <td className={`${tableStyles.cellNumeric} ${colorClasses.text.success}`}>
                    {formatCount(row.gain_count)}
                  </td>
                  <td className={tableStyles.cellNumeric}>{formatCurrency(row.gain_premium_wan)}</td>
                </tr>
              ))}
              {gain.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-neutral-400">无竞争转入数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
