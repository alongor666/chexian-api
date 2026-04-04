/**
 * 费率分档明细表
 */

import React from 'react';
import { tableStyles, textStyles, colorClasses } from '@/shared/styles';
import { formatCount, formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
import type { FeeRuleTierData, FeeInsuranceTypeTab } from '../types/feeAnalysisTypes';

interface Props {
  data: FeeRuleTierData[];
  activeTab: FeeInsuranceTypeTab;
}

function getInsuranceBadge(label: string) {
  if (label === '交强险') {
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-primary-bg ${colorClasses.text.primary}`}>
        交强
      </span>
    );
  }
  if (label === '商业险') {
    return (
      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-warning-bg ${colorClasses.text.warning}`}>
        商业
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400">
      其他
    </span>
  );
}

function getFeeRateColor(rate: number | null): string {
  if (rate === null) return colorClasses.text.neutralMuted;
  if (rate === 0) return colorClasses.text.neutralMuted;
  if (rate >= 0.27) return colorClasses.text.success;
  if (rate >= 0.19) return colorClasses.text.warning;
  return colorClasses.text.neutralMuted;
}

export const FeeRuleTierTable: React.FC<Props> = ({ data, activeTab }) => {
  const filtered = data
    .filter((r) => {
      if (activeTab === 'cti') return r.insurance_type_label === '交强险';
      if (activeTab === 'com') return r.insurance_type_label === '商业险';
      return true;
    })
    .slice()
    .sort((a, b) => {
      // OUT_OF_SCOPE（规则外）置底
      if (a.fee_rule_id === 'OUT_OF_SCOPE') return 1;
      if (b.fee_rule_id === 'OUT_OF_SCOPE') return -1;
      // 按保费规模从大到小
      return (b.total_premium ?? 0) - (a.total_premium ?? 0);
    });

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-neutral-400">
        暂无数据
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white dark:bg-neutral-800 rounded-xl shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className={tableStyles.header}>
            <th className={tableStyles.headerCell}>险类</th>
            <th className={tableStyles.headerCell}>规则名称</th>
            <th className={tableStyles.headerCell}>费率</th>
            <th className={tableStyles.headerCell}>生效日期</th>
            <th className={tableStyles.headerCell}>截止日期</th>
            <th className={`${tableStyles.headerCell} text-right`}>件数</th>
            <th className={`${tableStyles.headerCell} text-right`}>保费(万)</th>
            <th className={`${tableStyles.headerCell} text-right`}>预计费用(万)</th>
            <th className={`${tableStyles.headerCell} text-right`}>绩效(万)</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => {
            const isOos = row.fee_rule_id === 'OUT_OF_SCOPE';
            return (
              <tr key={row.fee_rule_id} className={`${tableStyles.row} ${isOos ? 'opacity-60' : ''}`}>
                <td className={tableStyles.cell}>
                  {getInsuranceBadge(row.insurance_type_label)}
                </td>
                <td className={`${tableStyles.cell} text-sm`}>
                  {row.fee_rule_name}
                </td>
                <td className={tableStyles.cell}>
                  {row.fee_rate !== null ? (
                    <span className={`font-semibold ${getFeeRateColor(row.fee_rate)}`}>
                      {formatPercent(row.fee_rate)}
                    </span>
                  ) : (
                    <span className={colorClasses.text.neutralMuted}>—</span>
                  )}
                </td>
                <td className={`${tableStyles.cell} text-sm ${colorClasses.text.neutralMuted}`}>
                  {row.effective_start ?? '—'}
                </td>
                <td className={`${tableStyles.cell} text-sm ${colorClasses.text.neutralMuted}`}>
                  {row.effective_end ?? '当前生效'}
                </td>
                <td className={`${tableStyles.cell} text-right`}>
                  <span className={textStyles.numeric}>{formatCount(row.policy_count)}</span>
                </td>
                <td className={`${tableStyles.cell} text-right`}>
                  <span className={textStyles.numeric}>{formatPremiumWan(row.total_premium)}</span>
                </td>
                <td className={`${tableStyles.cell} text-right`}>
                  {row.expected_fee !== null ? (
                    <span className={textStyles.numeric}>{formatPremiumWan(row.expected_fee)}</span>
                  ) : (
                    <span className={colorClasses.text.neutralMuted}>—</span>
                  )}
                </td>
                <td className={`${tableStyles.cell} text-right`}>
                  <span className={textStyles.numeric}>{formatPremiumWan(row.performance_fee)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
