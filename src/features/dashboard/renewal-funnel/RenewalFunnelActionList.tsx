/**
 * 待跟进清单（按行动优先级）
 *
 * P1: 已进入报价窗口但未报价 → 立即行动
 * P2: 已报价、已到期 0-14 天 → 挽回窗口
 * P3: 已报价、已到期 15-30 天 → 紧急挽回
 * P4: 其他未续保 → 大概率流失
 */

import React, { useState, useMemo } from 'react';
import { useRenewalFunnelActionList } from './hooks/useRenewalFunnel';
import { cardStyles, tableStyles, textStyles, fontStyles, buttonStyles, badgeStyles, cn, colorClasses } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import type { FunnelFilters } from './types';

interface Props {
  filters: FunnelFilters;
}

type PriorityTab = 'P1' | 'P2' | 'P3' | 'all';

const PRIORITY_TABS: { value: PriorityTab; label: string; desc: string; style: string }[] = [
  { value: 'P1', label: 'P1 窗口内未报价', desc: '立即行动', style: badgeStyles.danger },
  { value: 'P2', label: 'P2 可挽回(0-14天)', desc: '挽回窗口', style: badgeStyles.warning },
  { value: 'P3', label: 'P3 紧急(15-30天)', desc: '紧急挽回', style: badgeStyles.primary },
  { value: 'all', label: '全部', desc: '', style: badgeStyles.default },
];

const PAGE_SIZE = 100;

export const RenewalFunnelActionList: React.FC<Props> = ({ filters }) => {
  const [priorityTab, setPriorityTab] = useState<PriorityTab>('P1');
  const [page, setPage] = useState(1);

  // 切换筛选时重置页码
  const prevFiltersRef = React.useRef(filters);
  const prevTabRef = React.useRef(priorityTab);
  if (prevFiltersRef.current !== filters || prevTabRef.current !== priorityTab) {
    prevFiltersRef.current = filters;
    prevTabRef.current = priorityTab;
    if (page !== 1) setPage(1);
  }

  const { data, isLoading } = useRenewalFunnelActionList(filters, { page, pageSize: PAGE_SIZE });

  const filteredData = useMemo(() => {
    if (!data?.length) return [];
    if (priorityTab === 'all') return data;
    return data.filter(r => (r.action_priority ?? '') === priorityTab);
  }, [data, priorityTab]);

  // 各优先级计数
  const counts = useMemo(() => {
    if (!data?.length) return { P1: 0, P2: 0, P3: 0, P4: 0, all: 0 };
    const c = { P1: 0, P2: 0, P3: 0, P4: 0, all: data.length };
    for (const r of data) {
      const p = r.action_priority ?? 'P4';
      if (p in c) (c as any)[p]++;
    }
    return c;
  }, [data]);

  const totalItems = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const pagedData = filteredData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    if (!filteredData.length) return;
    const headers = ['优先级', '保单号', '机构', '团队', '业务员', '车架号', '风险等级', '到期日', '到期天数', '是否报价', '报价人数', '竞争强度'];
    const rows = filteredData.map(r => [
      r.action_priority ?? '', r.policy_no ?? '', r.org_level_3 ?? '', r.team_name ?? '',
      r.salesman_name ?? '', r.vehicle_frame_no ?? '', r.insurance_grade ?? '',
      r.insurance_end_date ?? '', r.days_since_expiry ?? '',
      r.is_quoted ? '是' : '否', r.quote_salesman_count ?? 0, r.competition_level ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `待跟进_${priorityTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cardStyles.standard}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className={textStyles.titleSmall}>待跟进清单</h3>
        <button
          onClick={handleExport}
          disabled={!filteredData.length}
          className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.ghost)}
        >
          导出 CSV
        </button>
      </div>

      {/* 优先级 Tab */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {PRIORITY_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setPriorityTab(tab.value)}
            className={cn(
              buttonStyles.base, buttonStyles.sizeSmall,
              priorityTab === tab.value ? buttonStyles.primary : buttonStyles.secondary
            )}
          >
            {tab.label}
            <span className={cn('ml-1', fontStyles.tabular)}>
              ({formatCount(counts[tab.value as keyof typeof counts] ?? 0)})
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 bg-neutral-100 rounded" />
          ))}
        </div>
      ) : filteredData.length === 0 ? (
        <div className="text-center py-8">
          <span className={textStyles.caption}>
            {priorityTab === 'P1' ? '没有窗口内未报价的保单' : '暂无数据'}
          </span>
        </div>
      ) : (
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>级别</th>
                <th className={tableStyles.headerCell}>到期日</th>
                <th className={tableStyles.headerCell}>状态</th>
                <th className={tableStyles.headerCell}>机构</th>
                <th className={tableStyles.headerCell}>团队</th>
                <th className={tableStyles.headerCell}>业务员</th>
                <th className={tableStyles.headerCell}>等级</th>
                <th className={tableStyles.headerCell}>报价</th>
                <th className={tableStyles.headerCell}>竞争</th>
              </tr>
            </thead>
            <tbody>
              {pagedData.map((row) => (
                <tr key={row.policy_no} className={tableStyles.row}>
                  <td className={tableStyles.cell}>
                    <PriorityBadge priority={row.action_priority ?? 'P4'} />
                  </td>
                  <td className={cn(tableStyles.cell, fontStyles.tabular)}>
                    {row.insurance_end_date ?? ''}
                  </td>
                  <td className={tableStyles.cell}>
                    <DaysLabel days={row.days_since_expiry ?? 0} />
                  </td>
                  <td className={tableStyles.cell}>{row.org_level_3 ?? ''}</td>
                  <td className={tableStyles.cell}>{row.team_name ?? ''}</td>
                  <td className={tableStyles.cell}>{row.salesman_name ?? ''}</td>
                  <td className={tableStyles.cell}>{row.insurance_grade ?? ''}</td>
                  <td className={tableStyles.cell}>
                    {row.is_quoted ? '是' : <span className={colorClasses.text.danger}>未报价</span>}
                  </td>
                  <td className={tableStyles.cell}>
                    {(row.quote_salesman_count ?? 0) > 1 && (
                      <span className={cn(badgeStyles.base, badgeStyles.danger)}>
                        {row.quote_salesman_count}方
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 分页控制 */}
          <div className="flex items-center justify-between py-2 px-1">
            <span className={cn(textStyles.caption, fontStyles.tabular)}>
              第 {page} 页 / 共 {totalPages} 页（{formatCount(totalItems)} 条）
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.secondary)}
              >
                上一页
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.secondary)}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => {
  const style =
    priority === 'P1' ? badgeStyles.danger
    : priority === 'P2' ? badgeStyles.warning
    : priority === 'P3' ? badgeStyles.primary
    : badgeStyles.default;
  return <span className={cn(badgeStyles.base, style)}>{priority}</span>;
};

const DaysLabel: React.FC<{ days: number }> = ({ days }) => {
  if (days < 0) return <span className={colorClasses.text.primary}>还剩{Math.abs(days)}天</span>;
  if (days <= 14) return <span className={colorClasses.text.danger}>已过{days}天</span>;
  return <span className={colorClasses.text.warning}>已过{days}天</span>;
};
