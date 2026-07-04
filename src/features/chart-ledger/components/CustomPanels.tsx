/**
 * 图表账本 · 自定义 HTML/SVG 图表面板
 *
 * 热力图/发展三角（着色表格）、案均赔款箱线图（内联 SVG）、报价漏斗、险种树图——
 * 这些形态未进入项目共享 echarts 单例（避免膨胀 bundle），以轻量 DOM/SVG 渲染，
 * 数据同样来自真实查询。着色统一走 lossRatioColor（teal→coral 赔付率梯度）。
 */
import React from 'react';
import { colorClasses, fontStyles } from '@/shared/styles';
import { formatChartValue } from '@/shared/utils/formatters';
import { lossRatioColor, LEDGER_COLORS, ChartFrame } from './EchartsPanels';
import type { BoxDatum, ChartResult, FunnelStep, TreemapCell } from '../types';

const numCls = fontStyles.numeric;

// ── Chart 03 机构×险种赔付率热力图 ──
export const RiskHeatmapTable: React.FC<{
  r: ChartResult<{ orgs: string[]; lines: string[]; cell: Map<string, number> }>;
}> = ({ r }) => {
  const { orgs, lines, cell } = r.data;
  return (
    <ChartFrame s={r} height={260}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={`p-1.5 text-left ${colorClasses.text.neutralMuted}`}></th>
              {lines.map((l) => (
                <th key={l} className={`p-1.5 text-center font-medium ${colorClasses.text.neutralMuted}`}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o}>
                <td className={`py-1.5 pr-2 whitespace-nowrap ${colorClasses.text.neutral}`}>{o}</td>
                {lines.map((l) => {
                  const v = cell.get(`${o}|${l}`);
                  return (
                    <td key={l} className={`p-1.5 text-center ${numCls}`} style={{ background: v === undefined ? 'transparent' : lossRatioColor(v), color: v === undefined ? undefined : '#10161f' }}>
                      {v === undefined ? '—' : `${formatChartValue(v)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
};

// ── Chart 06 赔款发展三角 ──
export const LossTriangleTable: React.FC<{
  r: ChartResult<{ years: string[]; devs: number[]; cell: Map<string, number> }>;
}> = ({ r }) => {
  const { years, devs, cell } = r.data;
  return (
    <ChartFrame s={r} height={220}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={`p-1.5 text-left font-medium ${colorClasses.text.neutralMuted}`}>起保年度</th>
              {devs.map((d) => (
                <th key={d} className={`p-1.5 text-center font-medium ${colorClasses.text.neutralMuted}`}>
                  M{d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className={`py-1.5 pr-2 ${colorClasses.text.neutral}`}>{y}</td>
                {devs.map((d) => {
                  const v = cell.get(`${y}|${d}`);
                  return (
                    <td key={d} className={`p-1.5 text-center ${numCls}`} style={{ background: v === undefined ? 'transparent' : lossRatioColor(v), color: v === undefined ? undefined : '#10161f' }}>
                      {v === undefined ? '—' : `${formatChartValue(v)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
};

// ── Chart 04 案均赔款箱线图（内联 SVG） ──
export const ClaimBoxplot: React.FC<{ r: ChartResult<BoxDatum[]> }> = ({ r }) => {
  const cats = r.data;
  const W = 560, Hh = 230, padL = 36, padR = 14, padT = 12, padB = 30;
  const maxVal = Math.max(0.1, ...cats.map((c) => c.max)) * 1.08;
  const chartW = W - padL - padR, chartH = Hh - padT - padB;
  const bw = cats.length ? chartW / cats.length : chartW;
  const yv = (v: number) => padT + chartH - (v / maxVal) * chartH;
  const teal = LEDGER_COLORS.teal, gold = LEDGER_COLORS.gold;
  return (
    <ChartFrame s={r} height={230}>
      <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" height="230" style={{ fontFamily: 'inherit' }}>
        {[0, 1, 2, 3, 4].map((g) => {
          const val = (maxVal * g) / 4;
          const yy = yv(val);
          return (
            <g key={g}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="rgba(140,140,140,.25)" strokeWidth={1} />
              <text x={4} y={yy + 3} fontSize={9} fill="#8C8C8C">{val.toFixed(1)}</text>
            </g>
          );
        })}
        {cats.map((c, i) => {
          const cx = padL + bw * i + bw / 2;
          const boxW = bw * 0.34;
          return (
            <g key={c.name}>
              <line x1={cx} y1={yv(c.min)} x2={cx} y2={yv(c.q1)} stroke={teal} strokeWidth={1.5} />
              <line x1={cx} y1={yv(c.q3)} x2={cx} y2={yv(c.max)} stroke={teal} strokeWidth={1.5} />
              <line x1={cx - boxW / 4} y1={yv(c.min)} x2={cx + boxW / 4} y2={yv(c.min)} stroke={teal} strokeWidth={1.5} />
              <line x1={cx - boxW / 4} y1={yv(c.max)} x2={cx + boxW / 4} y2={yv(c.max)} stroke={teal} strokeWidth={1.5} />
              <rect x={cx - boxW / 2} y={yv(c.q3)} width={boxW} height={Math.max(1, yv(c.q1) - yv(c.q3))} fill="rgba(19,194,194,.18)" stroke={teal} strokeWidth={1.5} />
              <line x1={cx - boxW / 2} y1={yv(c.med)} x2={cx + boxW / 2} y2={yv(c.med)} stroke={gold} strokeWidth={2} />
              <text x={cx} y={Hh - 8} fontSize={10} fill="currentColor" textAnchor="middle" className={colorClasses.text.neutral}>
                {c.name.length > 6 ? c.name.slice(0, 5) + '…' : c.name}
              </text>
              <text x={cx} y={yv(c.med) - 6} fontSize={9} fill={gold} textAnchor="middle">{c.med.toFixed(1)}万</text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
};

// ── Chart 07 报价转化漏斗 ──
export const RenewalFunnel: React.FC<{ r: ChartResult<FunnelStep[]> }> = ({ r }) => {
  const steps = r.data;
  const maxV = steps[0]?.value || 1;
  return (
    <ChartFrame s={r} height={230}>
      <div className="flex flex-col items-center gap-1 py-1.5">
        {steps.map((st, i) => {
          const pct = st.value / maxV;
          const w = 34 + (100 - 34) * pct;
          const conv = i === 0 ? '' : `（较上一步 ${((st.value / (steps[i - 1].value || 1)) * 100).toFixed(0)}%）`;
          return (
            <div key={st.name} className="w-full flex flex-col items-center">
              <div
                className={`h-8 flex items-center justify-center rounded-sm ${numCls}`}
                style={{ width: `${w}%`, background: `linear-gradient(90deg, ${LEDGER_COLORS.tealDim}, ${LEDGER_COLORS.teal})`, color: '#10161f', fontWeight: 600 }}
              >
                {st.value.toLocaleString()}
              </div>
              <div className={`text-[11px] mt-1 mb-1.5 ${colorClasses.text.neutralMuted}`}>
                {st.name} {conv}
              </div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
};

// ── Chart 10 险种结构树图 ──
const TREEMAP_PALETTE = [LEDGER_COLORS.teal, '#3A6E6B', LEDGER_COLORS.coral, LEDGER_COLORS.gold, '#E8CE7B', LEDGER_COLORS.muted, '#5B8DEF', '#9A60B4'];
export const InsuranceTreemap: React.FC<{ r: ChartResult<TreemapCell[]> }> = ({ r }) => {
  const cells = r.data;
  return (
    <ChartFrame s={r} height={220}>
      <div className="flex flex-wrap gap-1" style={{ height: 220 }}>
        {cells.map((c, i) => (
          <div
            key={c.name}
            className={`flex flex-col items-center justify-center rounded-sm p-1 text-center ${numCls}`}
            style={{ flex: `${Math.max(3, c.share)} 1 ${c.share > 15 ? '150px' : '72px'}`, background: TREEMAP_PALETTE[i % TREEMAP_PALETTE.length], color: '#10161f', fontWeight: 700 }}
          >
            <span className="text-[12px] leading-tight">{c.name}</span>
            <span className="text-[10.5px] font-normal opacity-80">{c.share.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
};
