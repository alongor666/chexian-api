/**
 * 行动看板 Tab — 待办清单 + 分页
 */

import { useState } from 'react';
import { cardStyles, colorClasses, tableStyles, textStyles } from '../../../shared/styles';
import { formatCurrency } from '../../../shared/utils/formatters';
import { useRenewalV2Action, type RenewalV2Filters } from '../hooks/useRenewalV2';

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  P1: { bg: colorClasses.bg.danger, text: colorClasses.text.danger, label: 'P1 已过期+有报价' },
  P2: { bg: colorClasses.bg.warning, text: colorClasses.text.warning, label: 'P2 已过期+无报价' },
  P3: { bg: colorClasses.bg.primary, text: colorClasses.text.primary, label: 'P3 30天内到期' },
  P4: { bg: colorClasses.bg.neutral, text: colorClasses.text.neutral, label: 'P4 远期' },
};

const STAGE_LABELS: Record<string, string> = {
  renewed: '已续保',
  quoted_not_renewed: '报价未续',
  not_quoted: '未报价',
};

interface Props {
  filters: RenewalV2Filters;
}

export function RenewalActionTab({ filters }: Props) {
  const [page, setPage] = useState(1);
  const [priority, setPriority] = useState<string>('P1');
  const pageSize = 20;

  const queryFilters = { ...filters, actionPriority: priority, page, pageSize };
  const { data: rows, isLoading } = useRenewalV2Action(queryFilters);

  const totalCount: number = rows?.meta?.total ?? 0;
  const dataRows: any[] = rows?.data ?? [];
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-4">
      {/* 优先级切换 */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(PRIORITY_STYLES).map(([key, style]) => (
          <button
            key={key}
            onClick={() => { setPriority(key); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              priority === key
                ? `${style.bg} ${style.text} ring-1 ring-current`
                : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
            }`}
          >
            {style.label}
            {priority === key && totalCount > 0 ? ` (${formatCurrency(totalCount)})` : ''}
          </button>
        ))}
      </div>

      {/* 待办列表 */}
      <div className={cardStyles.standard}>
        {isLoading ? (
          <div className="p-8 text-center text-neutral-400">加载中...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={tableStyles.header}>
                    <th className={`${tableStyles.headerCell} text-left`}>机构</th>
                    <th className={`${tableStyles.headerCell} text-left`}>业务员</th>
                    <th className={`${tableStyles.headerCell} text-left`}>客户类别</th>
                    <th className={`${tableStyles.headerCell} text-right`}>到期日</th>
                    <th className={`${tableStyles.headerCell} text-right`}>过期天数</th>
                    <th className={`${tableStyles.headerCell} text-left`}>状态</th>
                    <th className={`${tableStyles.headerCell} text-right`}>保费</th>
                    <th className={`${tableStyles.headerCell} text-left`}>流失去向</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(dataRows) && dataRows.map((row: any, i: number) => (
                    <tr key={row.policy_no ?? i} className="border-b border-neutral-100">
                      <td className={tableStyles.cell}>{row.org_level_3 ?? '-'}</td>
                      <td className={tableStyles.cell}>{row.salesman_name ?? '-'}</td>
                      <td className={tableStyles.cell}>{row.customer_category ?? '-'}</td>
                      <td className={tableStyles.cellNumeric}>{row.expiry_date ?? '-'}</td>
                      <td className={`${tableStyles.cellNumeric} ${colorClasses.text.danger}`}>
                        {row.days_since_expiry ?? '-'}
                      </td>
                      <td className={tableStyles.cell}>
                        {STAGE_LABELS[row.funnel_stage] ?? row.funnel_stage ?? '-'}
                      </td>
                      <td className={tableStyles.cellNumeric}>{formatCurrency(row.total_premium)}</td>
                      <td className={tableStyles.cell}>{row.lost_to_insurer ?? '-'}</td>
                    </tr>
                  ))}
                  {(!dataRows || dataRows.length === 0) && (
                    <tr><td colSpan={8} className="text-center py-8 text-neutral-400">无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-neutral-100">
                <span className={textStyles.caption}>
                  共 {formatCurrency(totalCount)} 条，第 {page}/{totalPages} 页
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 text-xs rounded border border-neutral-200 disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-xs rounded border border-neutral-200 disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
