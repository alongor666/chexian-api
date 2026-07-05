/**
 * 共享指标单元格组 — 左右两表共用，保证列结构一致
 *
 * 顺序：[漏斗?] 应续A · 报价B · 已续C · 报价率(D) · 续保率(E)
 * 续保率为「主角」，以 RateCell 迷你进度条强化可读性。
 */
import { cn, colorClasses, fontStyles } from '@/shared/styles';
import { formatCount } from '@/shared/utils/formatters';
import RateCell from './RateCell';
import FunnelBar from './FunnelBar';
import type { RenewalRow } from '../types';

interface Props {
  row: RenewalRow;
  /** 是否在最前插入漏斗列（左栏宽表用，右栏窄表不用） */
  showFunnel?: boolean;
}

const numCell = cn('px-3 py-2 text-sm text-right whitespace-nowrap', fontStyles.numeric, colorClasses.text.neutralBlack);

export default function MetricCells({ row, showFunnel = false }: Props) {
  return (
    <>
      {showFunnel && (
        <td className="px-3 py-2 text-left whitespace-nowrap">
          <FunnelBar row={row} />
        </td>
      )}
      <td className={numCell}>{formatCount(row.A)}</td>
      <td className={numCell}>{formatCount(row.B)}</td>
      <td className={numCell}>{formatCount(row.C)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <RateCell metric="quote" numerator={row.B} denominator={row.A} />
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <RateCell metric="renew" numerator={row.C} denominator={row.A} />
      </td>
    </>
  );
}
