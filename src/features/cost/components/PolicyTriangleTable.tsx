/**
 * 保单精算三角表格（通用组件）
 * 从 NewEarnedPremiumTable.tsx 拆出，保持原有逻辑不变。
 *
 * 2025/2026 两张表结构完全相同，仅「起保年份前缀」（baseYear / baseYear+1）
 * 与 isOutsideTriangle 的 baseYear 参数不同，故合并为单一泛型组件，
 * 由 baseYear prop 派生两个年度列前缀。
 */

import React from 'react';
import { formatPremiumWan } from '../../../shared/utils/formatters';
import { colorClasses, fontStyles, cn } from '../../../shared/styles';
import type { Policy2025TriangleRow, Policy2026TriangleRow } from '../utils/earnedPremiumTransformers';

/** 月份标签 */
const MONTH_LABELS: Record<number, string> = {
  1: '1月', 2: '2月', 3: '3月', 4: '4月',
  5: '5月', 6: '6月', 7: '7月', 8: '8月',
  9: '9月', 10: '10月', 11: '11月', 12: '12月',
};

/** 判断是否在三角区域外（起保月之前的统计月） */
function isOutsideTriangle(policyMonth: number, statYear: number, statMonth: number, baseYear: number): boolean {
  // 对于2025年保单（baseYear=2025）：
  // - 25年统计月：statMonth < policyMonth 时为三角外
  // - 26年统计月：起保月在25年，26年所有月份都在三角内
  if (statYear === baseYear) {
    return statMonth < policyMonth;
  }
  return false;
}

interface PolicyTriangleTableProps {
  data: Array<Policy2025TriangleRow | Policy2026TriangleRow>;
  loading?: boolean;
  /** 起保年份（如 2025 / 2026），决定三角的两个年度列前缀 */
  baseYear: number;
}

/**
 * 保单精算三角表格
 *
 * 行 = 起保月（1-12月），列 = 统计月（baseYear各月 + baseYear+1各月）+ 满期
 */
export const PolicyTriangleTable: React.FC<PolicyTriangleTableProps> = ({ data, loading, baseYear }) => {
  if (loading) {
    return <div className={cn('p-8 text-center', colorClasses.text.neutralMuted)}>加载中...</div>;
  }

  const y1 = baseYear % 100;        // 起保年两位数（25 / 26）
  const y2 = (baseYear + 1) % 100;  // 次年两位数（26 / 27）

  // 表头：起保月、保费、首日费用、起保年各月、次年各月、最终已赚
  const headers = [
    { key: 'policy_month', label: '起保月', width: 56 },
    { key: 'premium', label: '保费', width: 72 },
    { key: 'first_day_fee', label: '首日', width: 56 },
    ...Array.from({ length: 12 }, (_, i) => ({ key: `earned_${y1}_${String(i + 1).padStart(2, '0')}`, label: `${y1}-${i + 1}`, width: 52 })),
    ...Array.from({ length: 12 }, (_, i) => ({ key: `earned_${y2}_${String(i + 1).padStart(2, '0')}`, label: `${y2}-${i + 1}`, width: 52 })),
    { key: 'earned_total', label: '满期', width: 72 },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse" style={{ minWidth: '1400px' }}>
        <thead>
          <tr className={cn(colorClasses.bg.neutral, 'border-b', colorClasses.border.neutral)}>
            {headers.map((h) => (
              <th
                key={h.key}
                style={{ width: h.width, minWidth: h.width }}
                className={cn('px-1 py-2 text-center font-medium whitespace-nowrap', colorClasses.text.neutral)}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const policyMonth = row.policy_month;
            const cells = row as unknown as Record<string, number>;
            return (
              <tr key={policyMonth} className="border-b border-neutral-100 hover:bg-primary-bg/30">
                {/* 起保月 */}
                <td className={cn('px-1 py-1.5 text-center font-medium', colorClasses.text.neutralDark)}>
                  {MONTH_LABELS[policyMonth]}
                </td>
                {/* 保费 */}
                <td className={cn('px-1 py-1.5 text-right', fontStyles.numeric, colorClasses.text.neutralBlack)}>
                  {formatPremiumWan(row.premium)}
                </td>
                {/* 首日费用 */}
                <td className={cn('px-1 py-1.5 text-right', fontStyles.numeric, colorClasses.text.primary)}>
                  {formatPremiumWan(row.first_day_fee)}
                </td>
                {/* 起保年各月（受三角约束） */}
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const key = `earned_${y1}_${String(m).padStart(2, '0')}`;
                  const value = cells[key];
                  const isOutside = isOutsideTriangle(policyMonth, baseYear, m, baseYear);
                  const isZero = value === 0 || isOutside;
                  // 起保月的单元格用特殊背景色（首日费用+时间分摊）
                  const isStartMonth = m === policyMonth;
                  return (
                    <td
                      key={key}
                      className={cn(
                        'px-1 py-1.5 text-right', fontStyles.numeric,
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack,
                        isStartMonth && !isZero && `${colorClasses.bg.success} font-medium ${colorClasses.text.success}`
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 次年各月 */}
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const key = `earned_${y2}_${String(m).padStart(2, '0')}`;
                  const value = cells[key];
                  const isZero = value === 0;
                  return (
                    <td
                      key={key}
                      className={cn(
                        'px-1 py-1.5 text-right', fontStyles.numeric,
                        isZero ? colorClasses.text.neutralMuted : colorClasses.text.neutralBlack
                      )}
                    >
                      {isZero ? '0' : formatPremiumWan(value)}
                    </td>
                  );
                })}
                {/* 最终已赚 */}
                <td className={cn('px-1 py-1.5 text-right font-semibold bg-indigo-bg', fontStyles.numeric, colorClasses.text.indigo)}>
                  {formatPremiumWan(row.earned_total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PolicyTriangleTable;
