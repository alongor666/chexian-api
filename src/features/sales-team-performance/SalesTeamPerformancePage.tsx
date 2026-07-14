/**
 * 销售队伍业绩（标保）页面 — admin-only
 *
 * 按业务员/销售团队/机构/险种大类聚合展示实收保费与修复后标保。
 * 口径 SSOT：数据管理/pipelines/sales_team_rules.sql（sales_portrait ADR-006）。
 */

import { useState } from 'react';
import { colorClasses } from '../../shared/styles';
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
          <span className={`inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-medium ${colorClasses.text.warning}`}>
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
        <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
          {DIMENSIONS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDimension(d)}
              className={`px-3 py-1.5 text-sm ${
                dimension === d
                  ? 'bg-primary text-white'
                  : `bg-white ${colorClasses.text.neutralMuted} hover:bg-neutral-50`
              }`}
            >
              {DIMENSION_LABELS[d]}
            </button>
          ))}
        </div>
        <label className={`text-xs ${colorClasses.text.neutralMuted}`}>
          起
          <input
            type="date"
            value={start}
            onChange={e => setStart(e.target.value)}
            className="ml-1 rounded border border-neutral-200 px-2 py-1 text-sm"
          />
        </label>
        <label className={`text-xs ${colorClasses.text.neutralMuted}`}>
          止
          <input
            type="date"
            value={end}
            onChange={e => setEnd(e.target.value)}
            className="ml-1 rounded border border-neutral-200 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {/* 汇总卡 */}
      {total && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>标保合计（万元）</div>
            <div className={`text-xl font-bold ${colorClasses.text.neutralBlack}`}>{toWan(total.standard_premium)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>实收保费合计（万元）</div>
            <div className={`text-xl font-bold ${colorClasses.text.neutralBlack}`}>{toWan(total.received_premium)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>保单行数</div>
            <div className={`text-xl font-bold ${colorClasses.text.neutralBlack}`}>{total.policy_count.toLocaleString('zh-CN')}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className={`text-xs ${colorClasses.text.neutralMuted}`}>最新承保确认日</div>
            <div className={`text-xl font-bold ${colorClasses.text.neutralBlack}`}>{total.latest_confirm_date ?? '—'}</div>
          </div>
        </div>
      )}

      {/* 明细表 */}
      {isLoading && <p className={`text-sm ${colorClasses.text.neutralMuted}`}>加载中…</p>}
      {error && (
        <p className={`text-sm ${colorClasses.text.warning}`}>
          加载失败：{error instanceof Error ? error.message : '未知错误'}（本页仅对分公司管理员开放）
        </p>
      )}
      {!isLoading && !error && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b border-neutral-200 text-left ${colorClasses.text.neutralMuted}`}>
                <th className="px-3 py-2 font-medium">{DIMENSION_LABELS[dimension]}</th>
                <th className="px-3 py-2 font-medium text-right">保单行数</th>
                <th className="px-3 py-2 font-medium text-right">实收保费（万元）</th>
                <th className="px-3 py-2 font-medium text-right">标保（万元）</th>
                <th className="px-3 py-2 font-medium text-right">标保占比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.dim_value} className="border-b border-neutral-100 last:border-0">
                  <td className={`px-3 py-2 ${colorClasses.text.neutralBlack}`}>{row.dim_value}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.policy_count.toLocaleString('zh-CN')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{toWan(row.received_premium)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{toWan(row.standard_premium)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {total && total.standard_premium !== 0
                      ? `${((row.standard_premium / total.standard_premium) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className={`px-3 py-6 text-center ${colorClasses.text.neutralMuted}`}>
                    无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
