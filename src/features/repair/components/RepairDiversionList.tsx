import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import {
  cardStyles,
  textStyles,
  tableStyles,
  badgeStyles,
  buttonStyles,
  cn,
} from '@/shared/styles';
import { formatPremiumWan } from '@/shared/utils/formatters';

interface DiversionRow {
  policy_no: string | null;
  claim_no: string;
  subject_shop_code: string | null;
  subject_repair_shop: string | null;
  accident_district: string | null;
  accident_time: string | null;
  shop_tier: 'active' | 'past' | 'none' | 'none_shadow';
  org_level_3: string | null;
  salesman_name: string | null;
  customer_category: string | null;
  premium: number | null;
}

interface Props {
  orgName?: string;
  timeWindow: string;
}

const TIER_LABEL: Record<string, { label: string; cls: string }> = {
  past: { label: '曾合作', cls: cn(badgeStyles.base, badgeStyles.warning) },
  none: { label: '未合作', cls: cn(badgeStyles.base, badgeStyles.default) },
  none_shadow: { label: '影子', cls: cn(badgeStyles.base, badgeStyles.danger) },
  active: { label: '已合作', cls: cn(badgeStyles.base, badgeStyles.success) },
};

export const RepairDiversionList: React.FC<Props> = ({ orgName, timeWindow }) => {
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const params: Record<string, string> = {
    timeWindow,
    page: String(page),
    pageSize: String(pageSize),
  };
  if (orgName) params.orgName = orgName;

  const { data, isLoading } = useQuery({
    queryKey: ['repair-diversion-list', params],
    queryFn: () => apiClient.repair.diversionList(params) as Promise<DiversionRow[]>,
  });

  const rows = data ?? [];

  return (
    <div className={cardStyles.standard}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={textStyles.titleSmall}>导流目标保单清单</h3>
        <span className={textStyles.caption}>
          第 {page} 页 · 每页 {pageSize} 条
        </span>
      </div>
      {isLoading ? (
        <div className={cn(textStyles.caption, 'py-6 text-center')}>加载中...</div>
      ) : rows.length === 0 ? (
        <div className={cn(textStyles.caption, 'py-6 text-center')}>
          当前筛选下无待导流保单
        </div>
      ) : (
        <div className={tableStyles.container}>
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>保单号</th>
                <th className={tableStyles.headerCell}>客户类别</th>
                <th className={tableStyles.headerCell}>业务员</th>
                <th className={tableStyles.headerCell}>维修网点</th>
                <th className={tableStyles.headerCell}>出险区县</th>
                <th className={tableStyles.headerCell}>合作状态</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>保费(万)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const tier = TIER_LABEL[r.shop_tier] ?? TIER_LABEL.none;
                return (
                  <tr
                    key={r.claim_no}
                    className="border-b border-neutral-100 hover:bg-neutral-50"
                  >
                    <td className={tableStyles.cell}>{r.policy_no ?? '—'}</td>
                    <td className={tableStyles.cell}>{r.customer_category ?? '—'}</td>
                    <td className={tableStyles.cell}>{r.salesman_name ?? '—'}</td>
                    <td className={tableStyles.cell}>
                      {r.subject_repair_shop ?? r.subject_shop_code ?? '—'}
                    </td>
                    <td className={tableStyles.cell}>{r.accident_district ?? '—'}</td>
                    <td className={tableStyles.cell}>
                      <span className={tier.cls}>{tier.label}</span>
                    </td>
                    <td className={tableStyles.cellNumeric}>
                      {r.premium != null ? formatPremiumWan(r.premium) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          className={cn(
            buttonStyles.base,
            buttonStyles.secondary,
            buttonStyles.sizeSmall,
          )}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          上一页
        </button>
        <button
          className={cn(
            buttonStyles.base,
            buttonStyles.secondary,
            buttonStyles.sizeSmall,
          )}
          onClick={() => setPage(p => p + 1)}
          disabled={rows.length < pageSize}
        >
          下一页
        </button>
      </div>
    </div>
  );
};
