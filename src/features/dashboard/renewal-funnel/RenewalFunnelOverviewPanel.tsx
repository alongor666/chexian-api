/**
 * 续保漏斗总览面板
 *
 * 四级漏斗：应续 → 进入报价窗口 → 已报价 → 已续保
 * 业务规则：最早可报价日 = 到期日前30天
 *
 * 面向用户：机构总/分管总，关注机构对比和洼地定位
 */

import React, { useMemo } from 'react';
import { useRenewalFunnelOverview, useRenewalFunnelMatrix } from './hooks/useRenewalFunnel';
import { cardStyles, tableStyles, textStyles, fontStyles, cn, colorClasses, badgeStyles } from '../../../shared/styles';
import { formatCount } from '../../../shared/utils/formatters';
import type { FunnelFilters } from './types';

interface Props {
  filters: FunnelFilters;
  onOrgClick: (orgName: string) => void;
  onCategoryClick?: (category: string) => void;
  onRenewalModeClick?: (mode: string) => void;
}

export const RenewalFunnelOverviewPanel: React.FC<Props> = ({ filters, onOrgClick, onCategoryClick, onRenewalModeClick }) => {
  const isCategoryView = filters.groupBy === 'category';
  const isRenewalModeView = filters.groupBy === 'renewalMode';
  const { data: overviewData, isLoading: overviewLoading } = useRenewalFunnelOverview(filters);
  const { data: matrixData, isLoading: matrixLoading } = useRenewalFunnelMatrix(filters);

  // 汇总 KPI（四级漏斗）
  const totals = useMemo(() => {
    if (!overviewData?.length) return { due: 0, inWindow: 0, quoted: 0, renewed: 0, p1: 0, p2: 0 };
    return overviewData.reduce(
      (acc, row) => ({
        due: acc.due + (row.total_due ?? 0),
        inWindow: acc.inWindow + (row.in_window_count ?? 0),
        quoted: acc.quoted + (row.total_quoted ?? 0),
        renewed: acc.renewed + (row.total_renewed ?? 0),
        p1: acc.p1 + (row.p1_count ?? 0),
        p2: acc.p2 + (row.p2_count ?? 0),
      }),
      { due: 0, inWindow: 0, quoted: 0, renewed: 0, p1: 0, p2: 0 }
    );
  }, [overviewData]);

  // 矩阵数据转 pivot
  const { grades, orgs, matrix } = useMemo(() => {
    if (!matrixData?.length) return { grades: [] as string[], orgs: [] as string[], matrix: new Map() };
    const gradeSet = new Set<string>();
    const orgSet = new Set<string>();
    const m = new Map<string, number>();
    for (const row of matrixData) {
      const g = row.insurance_grade ?? '';
      const o = row.org_level_3 ?? '';
      if (g) gradeSet.add(g);
      if (o) orgSet.add(o);
      m.set(`${o}|${g}`, row.renewal_rate ?? 0);
    }
    const gradeOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'X', ''];
    const grades = [...gradeSet].sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));
    const orgs = [...orgSet].sort();
    return { grades, orgs, matrix: m };
  }, [matrixData]);

  return (
    <div className="space-y-4">
      {/* 四级漏斗 KPI */}
      <div className={cardStyles.standard}>
        {overviewLoading ? (
          <div className="animate-pulse h-20 bg-neutral-100 rounded" />
        ) : (
          <div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <FunnelStage label="应续" count={totals.due} />
              <FunnelArrow rate={totals.inWindow / Math.max(totals.due, 1)} label="进窗率" />
              <FunnelStage label="报价窗口" count={totals.inWindow} />
              <FunnelArrow rate={totals.quoted / Math.max(totals.inWindow, 1)} label="报价率" />
              <FunnelStage label="已报价" count={totals.quoted} />
              <FunnelArrow rate={totals.renewed / Math.max(totals.quoted, 1)} label="转化率" />
              <FunnelStage label="已续保" count={totals.renewed} highlight />
            </div>
            {/* 行动摘要 */}
            {(totals.p1 > 0 || totals.p2 > 0) && (
              <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-neutral-100">
                {totals.p1 > 0 && (
                  <span className={cn(badgeStyles.base, badgeStyles.danger)}>
                    P1 窗口内未报价: {formatCount(totals.p1)}
                  </span>
                )}
                {totals.p2 > 0 && (
                  <span className={cn(badgeStyles.base, badgeStyles.warning)}>
                    P2 已报价可挽回: {formatCount(totals.p2)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cn('grid gap-4', (isCategoryView || isRenewalModeView) ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-5')}>
        {/* 排名表 */}
        <div className={cn(cardStyles.standard, (isCategoryView || isRenewalModeView) ? '' : 'xl:col-span-3')}>
          <h3 className={cn(textStyles.titleSmall, 'mb-3')}>
            {isCategoryView ? '客户类别续保率排名' : isRenewalModeView ? '续保模式续保率排名' : '机构续保率排名'}
          </h3>
          {overviewLoading ? (
            <div className="animate-pulse space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-neutral-100 rounded" />
              ))}
            </div>
          ) : (
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full">
                <thead className={tableStyles.header}>
                  <tr>
                    <th className={tableStyles.headerCell}>
                      {isCategoryView ? '客户类别' : isRenewalModeView ? '续保模式' : '机构'}
                    </th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>应续</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>已报价</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>已续保</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>续保率</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>报价转化</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>自留率</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>P1</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>P2</th>
                  </tr>
                </thead>
                <tbody>
                  {(overviewData ?? [])
                    .sort((a, b) => (b.renewal_rate ?? 0) - (a.renewal_rate ?? 0))
                    .map((row) => {
                      const label = isCategoryView
                        ? row.customer_category ?? ''
                        : isRenewalModeView
                          ? row.renewal_mode ?? ''
                          : row.org_level_3 ?? '';
                      return (
                        <tr key={label} className={tableStyles.row}>
                          <td className={tableStyles.cell}>
                            <button
                              onClick={() => isCategoryView
                                ? onCategoryClick?.(label)
                                : isRenewalModeView
                                  ? onRenewalModeClick?.(label)
                                  : onOrgClick(label)
                              }
                              className={textStyles.link}
                            >
                              {label || '—'}
                            </button>
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {formatCount(row.total_due ?? 0)}
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {formatCount(row.total_quoted ?? 0)}
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {formatCount(row.total_renewed ?? 0)}
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            <RateCell value={row.renewal_rate ?? 0} />
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {(row.quote_to_renewal_rate ?? 0).toFixed(1)}%
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {(row.self_retention_rate ?? 0).toFixed(1)}%
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {(row.p1_count ?? 0) > 0 && (
                              <span className={colorClasses.text.danger}>{row.p1_count}</span>
                            )}
                          </td>
                          <td className={cn(tableStyles.cellNumeric, fontStyles.tabular)}>
                            {(row.p2_count ?? 0) > 0 && (
                              <span className={colorClasses.text.warning}>{row.p2_count}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 机构×等级 续保率矩阵（客户类别/续保模式视图下不显示） */}
        {!isCategoryView && !isRenewalModeView && (
          <div className={cn(cardStyles.standard, 'xl:col-span-2')}>
            <h3 className={cn(textStyles.titleSmall, 'mb-3')}>机构×等级 续保率矩阵</h3>
            {matrixLoading ? (
              <div className="animate-pulse h-48 bg-neutral-100 rounded" />
            ) : grades.length > 0 ? (
              <div className="overflow-auto max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className={tableStyles.header}>
                    <tr>
                      <th className={cn(tableStyles.headerCell, 'text-xs')}>机构</th>
                      {grades.map(g => (
                        <th key={g} className={cn(tableStyles.headerCell, 'text-xs text-center')}>{g || '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map(org => (
                      <tr key={org} className={tableStyles.row}>
                        <td className={cn(tableStyles.cell, 'text-xs font-medium')}>{org}</td>
                        {grades.map(g => {
                          const rate = matrix.get(`${org}|${g}`);
                          return (
                            <td key={g} className="px-1 py-1.5 text-center">
                              {rate !== undefined ? (
                                <HeatCell value={rate} />
                              ) : (
                                <span className="text-neutral-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={cn(textStyles.caption, 'mt-2')}>
                  颜色越深续保率越高，红色区域为需重点关注的洼地
                </p>
              </div>
            ) : (
              <p className={textStyles.caption}>暂无数据</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** 漏斗节点 */
const FunnelStage: React.FC<{ label: string; count: number; highlight?: boolean }> = ({ label, count, highlight }) => (
  <div className="flex flex-col items-center">
    <span className="text-xs text-neutral-500 mb-0.5">{label}</span>
    <span className={cn(
      'text-xl font-bold font-mono tabular-nums',
      highlight ? colorClasses.text.success : 'text-neutral-800'
    )}>
      {formatCount(count)}
    </span>
  </div>
);

/** 漏斗箭头 */
const FunnelArrow: React.FC<{ rate: number; label: string }> = ({ rate, label }) => (
  <div className="flex flex-col items-center px-1">
    <span className="text-[10px] text-neutral-400">{label}</span>
    <div className="flex items-center gap-0.5">
      <span className="text-neutral-300">─</span>
      <span className="text-xs font-semibold font-mono tabular-nums text-neutral-500">
        {(rate * 100).toFixed(1)}%
      </span>
      <span className="text-neutral-300">→</span>
    </div>
  </div>
);

/** 续保率着色 */
const RateCell: React.FC<{ value: number }> = ({ value }) => {
  const colorClass =
    value >= 60 ? colorClasses.text.success
    : value >= 45 ? colorClasses.text.warning
    : colorClasses.text.danger;
  return <span className={cn(colorClass, 'font-semibold')}>{value.toFixed(1)}%</span>;
};

/** 热力格 */
const HeatCell: React.FC<{ value: number }> = ({ value }) => {
  // 续保率 → 背景色深度
  const bg =
    value >= 65 ? 'bg-green-100 text-green-800'
    : value >= 55 ? 'bg-green-50 text-green-700'
    : value >= 45 ? 'bg-yellow-50 text-yellow-700'
    : value >= 35 ? 'bg-orange-50 text-orange-700'
    : 'bg-red-50 text-red-700';

  return (
    <span className={cn('inline-block rounded px-1 py-0.5 text-[11px] font-mono tabular-nums font-medium', bg)}>
      {value.toFixed(0)}
    </span>
  );
};
