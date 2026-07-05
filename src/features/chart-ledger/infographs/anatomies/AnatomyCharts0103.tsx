/** 图表账本 · 解剖图 01-03（气泡矩阵 / 异常散点 / 热力图） */
import React from 'react';
import { AnatomySvg, Axes, Note, C, INK, AXIS, lossRatioColor } from './shared';

// ── 01 客群产能-质量矩阵：65% 线切上下带 + 四区语义 + 气泡大小=件数 ──
export const AnatomyChannelMatrix: React.FC = () => (
  <AnatomySvg>
    <Axes />
    {/* 四区着色（阈值线 y=115 · 规模分界 x=290） */}
    <rect x={290} y={20} width={250} height={95} fill={C.coralDim} opacity={0.28} />
    <rect x={290} y={115} width={250} height={95} fill={C.tealDim} opacity={0.28} />
    <Note x={415} y={55} anchor="middle" fill={C.coral} bold size={11}>规模大 · 质量差</Note>
    <Note x={415} y={70} anchor="middle" fill={C.coral}>→ 优化 / 整改</Note>
    <Note x={415} y={158} anchor="middle" fill={C.teal} bold size={11}>压舱石</Note>
    <Note x={415} y={173} anchor="middle" fill={C.teal}>→ 守住基本盘</Note>
    <Note x={165} y={55} anchor="middle" fill={INK} bold size={11}>规模小 · 质量差</Note>
    <Note x={165} y={70} anchor="middle" fill={INK}>→ 观察 / 退出</Note>
    <Note x={165} y={158} anchor="middle" fill={C.good} bold size={11}>小而优</Note>
    <Note x={165} y={173} anchor="middle" fill={C.good}>→ 复制经验</Note>
    {/* 65% 阈值金线 */}
    <line x1={40} y1={115} x2={540} y2={115} stroke={C.gold} strokeWidth={1.5} strokeDasharray="5 3" />
    <Note x={536} y={110} anchor="end" fill={C.gold} bold>满期赔付率阈值 65%</Note>
    {/* 示意气泡（大小=件数） */}
    <circle cx={455} cy={78} r={22} fill={C.coralDim} stroke={C.coral} strokeWidth={1.5} />
    <circle cx={470} cy={168} r={17} fill={C.tealDim} stroke={C.teal} strokeWidth={1.5} />
    <circle cx={120} cy={182} r={8} fill={C.tealDim} stroke={C.teal} strokeWidth={1.5} />
    <circle cx={112} cy={86} r={7} fill="none" stroke={INK} strokeWidth={1.2} />
    <Note x={540} y={228} anchor="end">→ 保费规模（产能）</Note>
    <Note x={44} y={16}>↑ 满期赔付率（质量，越低越好）</Note>
  </AnatomySvg>
);

// ── 02 费用率异常散点：主群 vs 离群 + 均值+2σ 竖线 ──
export const AnatomyFeeOutlier: React.FC = () => (
  <AnatomySvg>
    <Axes />
    {/* 主群 */}
    {[[150, 128], [176, 150], [200, 118], [190, 168], [222, 140], [165, 145]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r={7} fill={C.teal} />
    ))}
    <ellipse cx={186} cy={142} rx={62} ry={44} fill="none" stroke={C.teal} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
    <Note x={186} y={210 - 4} anchor="middle" fill={C.teal} bold>主群：费用率聚成一团</Note>
    {/* 均值+2σ 竖线 */}
    <line x1={380} y1={20} x2={380} y2={210} stroke={C.coral} strokeWidth={1.5} strokeDasharray="5 3" />
    <Note x={374} y={34} anchor="end" fill={C.coral} bold>均值 + 2σ（离群参考线）</Note>
    {/* 离群菱形 */}
    <rect x={462} y={82} width={16} height={16} fill={C.coral} transform="rotate(45 470 90)" />
    <Note x={470} y={62} anchor="middle" fill={C.coral} bold>离群点</Note>
    <Note x={470} y={116} anchor="middle" fill={INK}>≠ 违规，先人工核实</Note>
    <Note x={540} y={228} anchor="end">→ 费用率(%)</Note>
    <Note x={44} y={16}>↑ 保费规模（万元）</Note>
  </AnatomySvg>
);

// ── 03 机构×险种热力图：最热格 / 整行红 / 整列红 三种形态 ──
const HEAT_VALUES: number[][] = [
  [62, 58, 93, 55, 52],
  [82, 84, 88, 80, 78],
  [58, 55, 74, 52, 50],
  [55, 52, 70, 50, 48],
];
export const AnatomyHeatmap: React.FC = () => {
  const ox = 118, oy = 46, cw = 58, ch = 32, gap = 6;
  return (
    <AnatomySvg>
      {/* 行列标签 */}
      {['机构 A', '机构 B', '机构 C', '机构 D'].map((r, i) => (
        <Note key={r} x={ox - 8} y={oy + i * (ch + gap) + ch / 2 + 3} anchor="end" fill={i === 1 ? C.coral : INK} bold={i === 1}>
          {r}
        </Note>
      ))}
      {['险种 1', '险种 2', '险种 3', '险种 4', '险种 5'].map((c, j) => (
        <Note key={c} x={ox + j * (cw + gap) + cw / 2} y={oy - 10} anchor="middle" fill={j === 2 ? C.coral : INK} bold={j === 2}>
          {c}
        </Note>
      ))}
      {/* 单元格 */}
      {HEAT_VALUES.map((row, i) =>
        row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={ox + j * (cw + gap)} y={oy + i * (ch + gap)} width={cw} height={ch} rx={4} fill={lossRatioColor(v)} />
            <text x={ox + j * (cw + gap) + cw / 2} y={oy + i * (ch + gap) + ch / 2 + 3.5} fontSize={10} fill="#10161f" textAnchor="middle">
              {v}%
            </text>
          </g>
        ))
      )}
      {/* 最热格标注（行1×列3） */}
      <rect x={ox + 2 * (cw + gap) - 2} y={oy - 2} width={cw + 4} height={ch + 4} rx={5} fill="none" stroke="#10161f" strokeWidth={1.5} strokeDasharray="4 2" />
      <line x1={ox + 2 * (cw + gap) + cw + 4} y1={oy + ch / 2} x2={452} y2={40} stroke={AXIS} strokeWidth={1} />
      <Note x={456} y={38} fill={C.coral} bold>最热格 = 组合问题</Note>
      <Note x={456} y={52}>→ 限额承保该组合</Note>
      {/* 整行 / 整列 */}
      <Note x={456} y={96} fill={C.coral} bold>整行偏红 = 机构性问题</Note>
      <Note x={456} y={110}>→ 该机构核保收紧</Note>
      <Note x={456} y={140} fill={C.coral} bold>整列偏红 = 险种性问题</Note>
      <Note x={456} y={154}>→ 险种定价问题上报</Note>
      {/* 色标 */}
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={i} x={118 + i * 10} y={218} width={10} height={8} fill={lossRatioColor(50 + (i / 23) * 45)} />
      ))}
      <Note x={110} y={225} anchor="end">50%</Note>
      <Note x={366} y={225}>95%（teal → 珊瑚 = 越红越差）</Note>
    </AnatomySvg>
  );
};
