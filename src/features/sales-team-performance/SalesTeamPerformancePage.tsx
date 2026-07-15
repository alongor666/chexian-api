/**
 * 销售队伍业绩（标保）页面 — admin-only
 *
 * 按业务员/销售团队/机构/险种大类聚合展示实收保费与修复后标保。
 * 口径 SSOT：数据管理/pipelines/sales_team_rules.sql（sales_portrait ADR-006）。
 */

import { useState } from 'react';
import {
  badgeStyles,
  buttonStyles,
  cardStyles,
  cn,
  colorClasses,
  fontStyles,
  inputStyles,
  tableStyles,
  textStyles,
} from '../../shared/styles';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorState } from '../../shared/ui/ErrorState';
import { TableSkeleton } from '../../shared/ui/Skeleton';
import { useSalesTeamPerformance } from './hooks/useSalesTeamPerformance';
import { DIMENSION_LABELS, type SalesTeamDimension } from './types';

const DIMENSIONS = Object.keys(DIMENSION_LABELS) as SalesTeamDimension[];

/** 金额（元）→ 万元字符串，千分位 + 2 位小数 */
function toWan(value: number): string {
  return (value / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SalesTeamPerformancePage() {
  const [dimension, setDimension] = useState<SalesTeamDimension>('salesman');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const { data, isLoading, error } = useSalesTeamPerformance({
    dimension,
    start: start || undefined,
    end: end || undefined,
  });

  const total = data?.total ?? null;
  const rows = data?.rows ?? [];

  return (
    <div className="relative p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className={`text-lg font-bold ${colorClasses.text.neutralBlack}`}>销售队伍业绩（标保）</h1>
          <span className={cn(badgeStyles.base, badgeStyles.warning)}>
            仅管理员
          </span>
        </div>
        <p className={`mt-1 text-xs ${colorClasses.text.neutralMuted}`}>
          山西直营保单级明细的<strong>修复后标保</strong>口径（标保 = 实收保费 × 险种系数 × 一司一策系数，
          大同车险封顶 1.05）。时间为承保确认时间窗口。
        </p>
      </div>

      {/* 筛选：维度 + 时间窗 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={cn(cardStyles.base, 'inline-flex overflow-hidden')}>
          {DIMENSIONS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDimension(d)}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeSmall,
                dimension === d ? buttonStyles.primary : buttonStyles.ghost,
              )}
            >
              {DIMENSION_LABELS[d]}
            </button>
          ))}
        </div>
        <label className={textStyles.caption}>
          起
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={e => setStart(e.target.value)}
            className={cn(inputStyles.base, inputStyles.default, 'ml-1 w-auto px-2 py-1')}
          />
        </label>
        <label className={textStyles.caption}>
          止
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={e => setEnd(e.target.value)}
            className={cn(inputStyles.base, inputStyles.default, 'ml-1 w-auto px-2 py-1')}
          />
        </label>
      </div>

      {/* 汇总卡 */}
      {total && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={cardStyles.compact}>
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>标保合计（万元）</div>
            <div className={cn('text-xl font-bold', fontStyles.kpi, colorClasses.text.neutralBlack)}>{toWan(total.standard_premium)}</div>
          </div>
          <div className={cardStyles.compact}>
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>实收保费合计（万元）</div>
            <div className={cn('text-xl font-bold', fontStyles.kpi, colorClasses.text.neutralBlack)}>{toWan(total.received_premium)}</div>
          </div>
          <div className={cardStyles.compact}>
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>明细行数</div>
            <div className={cn('text-xl font-bold', fontStyles.kpi, colorClasses.text.neutralBlack)}>{total.sales_team_row_count.toLocaleString('zh-CN')}</div>
          </div>
          <div className={cardStyles.compact}>
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>最新承保确认日</div>
            <div className={cn('text-xl font-bold', fontStyles.kpi, colorClasses.text.neutralBlack)}>{total.latest_confirm_date ?? '—'}</div>
          </div>
        </div>
      )}

      {/* 明细表 */}
      {isLoading && <TableSkeleton rows={5} columns={5} />}
      {error && (
        <ErrorState
          title="销售队伍业绩暂不可用"
          message="请稍后重试或联系系统管理员；本页面仅向分公司管理员开放。"
        />
      )}
      {!isLoading && !error && rows.length === 0 && (
        <div className={cardStyles.standard}>
          <EmptyState
            title="当前筛选条件下暂无销售队伍业绩数据"
            description="请调整聚合维度或承保确认时间窗口后重试。"
          />
        </div>
      )}
      {!isLoading && !error && rows.length > 0 && (
        <div className={cn(tableStyles.container, 'overflow-x-auto')}>
          <table className="w-full text-sm">
            <thead>
              <tr className={tableStyles.header}>
                <th className={tableStyles.headerCell}>{DIMENSION_LABELS[dimension]}</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>明细行数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>实收保费（万元）</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>标保（万元）</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>标保占比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.dim_value} className={tableStyles.row}>
                  <td className={tableStyles.cell}>{row.dim_value}</td>
                  <td className={tableStyles.cellNumeric}>{row.sales_team_row_count.toLocaleString('zh-CN')}</td>
                  <td className={tableStyles.cellNumeric}>{toWan(row.received_premium)}</td>
                  <td className={cn(tableStyles.cellNumeric, 'font-medium')}>{toWan(row.standard_premium)}</td>
                  <td className={tableStyles.cellNumeric}>
                    {total && total.standard_premium !== 0
                      ? `${((row.standard_premium / total.standard_premium) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
