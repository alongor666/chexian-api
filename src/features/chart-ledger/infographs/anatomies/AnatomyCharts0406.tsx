/** 图表账本 · 解剖图 04-06（箱线五数 / 频度先行 / 发展三角） */
import React from 'react';
import { AnatomySvg, Axes, Note, C, INK, AXIS, lossRatioColor } from './shared';

// ── 04 案均赔款箱线图：五数解剖 ──
export const AnatomyBoxplot: React.FC = () => {
  const cx = 190, boxW = 96;
  const yMax = 38, yQ3 = 88, yMed = 120, yQ1 = 152, yMin = 194;
  const leader = (y: number, label: string, desc: string, fill = INK, bold = false) => (
    <g key={label}>
      <line x1={cx + boxW / 2 + 4} y1={y} x2={300} y2={y} stroke={AXIS} strokeWidth={1} strokeDasharray="2 2" />
      <Note x={306} y={y + 3.5} fill={fill} bold={bold}>{label}</Note>
      <Note x={382} y={y + 3.5}>{desc}</Note>
    </g>
  );
  return (
    <AnatomySvg>
      {/* 须线 + 端帽 */}
      <line x1={cx} y1={yMin} x2={cx} y2={yQ1} stroke={C.teal} strokeWidth={1.5} />
      <line x1={cx} y1={yQ3} x2={cx} y2={yMax} stroke={C.teal} strokeWidth={1.5} />
      <line x1={cx - 22} y1={yMax} x2={cx + 22} y2={yMax} stroke={C.teal} strokeWidth={1.5} />
      <line x1={cx - 22} y1={yMin} x2={cx + 22} y2={yMin} stroke={C.teal} strokeWidth={1.5} />
      {/* 箱体 + 中位金线 */}
      <rect x={cx - boxW / 2} y={yQ3} width={boxW} height={yQ1 - yQ3} fill="rgba(19,194,194,.18)" stroke={C.teal} strokeWidth={1.5} />
      <line x1={cx - boxW / 2} y1={yMed} x2={cx + boxW / 2} y2={yMed} stroke={C.gold} strokeWidth={2.5} />
      {/* 五数引线 */}
      {leader(yMax, '最大值', '最坏机构（上须端）', C.coral, true)}
      {leader(yQ3, 'Q3', '75 分位')}
      {leader(yMed, '中位数', '金线 = 典型水平', C.gold, true)}
      {leader(yQ1, 'Q1', '25 分位')}
      {leader(yMin, '最小值', '最好机构（下须端）')}
      {/* 箱高与上须括注 */}
      <path d={`M ${cx - boxW / 2 - 14} ${yQ3} h -8 v ${yQ1 - yQ3} h 8`} fill="none" stroke={INK} strokeWidth={1} />
      <Note x={cx - boxW / 2 - 28} y={(yQ3 + yQ1) / 2 - 4} anchor="end">箱高 =</Note>
      <Note x={cx - boxW / 2 - 28} y={(yQ3 + yQ1) / 2 + 9} anchor="end">中间 50% 离散度</Note>
      <path d={`M ${cx + boxW / 2 + 4} ${yMax} h 8 M ${cx + boxW / 2 + 8} ${yMax} v ${yQ3 - yMax} M ${cx + boxW / 2 + 4} ${yQ3} h 8`} fill="none" stroke={C.coral} strokeWidth={1} opacity={0.7} />
      <Note x={306} y={(yMax + yQ3) / 2 + 3} fill={C.coral}>上须越长 = 长尾大案风险越高</Note>
      <Note x={cx} y={224} anchor="middle">一个箱 = 一个客群（箱内样本 = 该客群各机构的案均赔款）</Note>
    </AnatomySvg>
  );
};

// ── 05 出险频度趋势：先行指标（频度先动，赔付率滞后跟涨） ──
export const AnatomyFrequency: React.FC = () => (
  <AnatomySvg>
    <Axes />
    {/* 频度线（先行，teal） */}
    <polyline points="60,168 140,150 220,142 300,108 380,90 500,72" fill="none" stroke={C.teal} strokeWidth={2.5} />
    {[[60, 168], [140, 150], [220, 142], [300, 108], [380, 90], [500, 72]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r={3.5} fill={C.teal} />
    ))}
    <Note x={504} y={70} fill={C.teal} bold>出险频度（先行）</Note>
    {/* 赔付率线（滞后，muted 虚线） */}
    <polyline points="60,182 140,176 220,170 300,158 380,132 500,112" fill="none" stroke={INK} strokeWidth={2} strokeDasharray="6 4" />
    <Note x={504} y={116} fill={INK} bold>满期赔付率（滞后跟涨）</Note>
    {/* 领先量标注：频度拐点 vs 赔付率拐点 */}
    <line x1={300} y1={108} x2={300} y2={38} stroke={C.teal} strokeWidth={1} strokeDasharray="2 3" />
    <line x1={380} y1={132} x2={380} y2={38} stroke={INK} strokeWidth={1} strokeDasharray="2 3" />
    <path d="M 304 44 H 372 M 366 40 L 374 44 L 366 48" fill="none" stroke={C.coral} strokeWidth={1.5} />
    <Note x={338} y={34} anchor="middle" fill={C.coral} bold>领先 2–3 周</Note>
    <Note x={338} y={60} anchor="middle">频度拐点先出现 → 提前介入窗口</Note>
    <Note x={540} y={228} anchor="end">→ 周次</Note>
    <Note x={44} y={16}>↑ 比率(%)</Note>
  </AnatomySvg>
);

// ── 06 赔款发展三角：对角线数据边界 + 同列纵比 ──
export const AnatomyTriangle: React.FC = () => {
  const ox = 130, oy = 52, cw = 74, ch = 34, gap = 5;
  const years = ['2023', '2024', '2025', '2026'];
  const devs = ['满3月', '满6月', '满9月', '满12月'];
  const filled = (row: number, col: number) => col <= 3 - row; // 阶梯边界
  return (
    <AnatomySvg>
      {years.map((y, i) => (
        <Note key={y} x={ox - 8} y={oy + i * (ch + gap) + ch / 2 + 3.5} anchor="end">{y}</Note>
      ))}
      {devs.map((d, j) => (
        <Note key={d} x={ox + j * (cw + gap) + cw / 2} y={oy - 10} anchor="middle" fill={j === 1 ? C.gold : INK} bold={j === 1}>{d}</Note>
      ))}
      {years.map((_, i) =>
        devs.map((_, j) => {
          const x = ox + j * (cw + gap), y = oy + i * (ch + gap);
          if (!filled(i, j)) {
            return <rect key={`${i}${j}`} x={x} y={y} width={cw} height={ch} rx={4} fill="none" stroke={AXIS} strokeDasharray="3 3" />;
          }
          const v = 22 + j * 16 + i * 2; // 越成熟越高，新年度略高（示意）
          return (
            <g key={`${i}${j}`}>
              <rect x={x} y={y} width={cw} height={ch} rx={4} fill={lossRatioColor(v + 20)} />
              <text x={x + cw / 2} y={y + ch / 2 + 3.5} fontSize={10} fill="#10161f" textAnchor="middle">{v}%</text>
            </g>
          );
        })
      )}
      {/* 同列纵比高亮（满6月列） */}
      <rect x={ox + (cw + gap) - 3} y={oy - 3} width={cw + 6} height={3 * (ch + gap) - gap + 6} rx={6} fill="none" stroke={C.gold} strokeWidth={2} />
      <line x1={ox + (cw + gap) + cw / 2} y1={oy + 3 * (ch + gap) + 8} x2={ox + (cw + gap) + cw / 2} y2={oy + 3 * (ch + gap) + 20} stroke={C.gold} strokeWidth={1} />
      <Note x={ox + (cw + gap) + cw / 2} y={oy + 3 * (ch + gap) + 32} anchor="middle" fill={C.gold} bold>竖着比同一列 = 同成熟度可比</Note>
      {/* 对角线数据边界 */}
      <line x1={ox + 4 * (cw + gap) + 6} y1={oy - 6} x2={ox + (cw + gap) + 10} y2={oy + 4 * (ch + gap) + 2} stroke={C.coral} strokeWidth={1.2} strokeDasharray="6 4" />
      <Note x={ox + 4 * (cw + gap) + 14} y={oy + 40} fill={C.coral} bold>对角线 =</Note>
      <Note x={ox + 4 * (cw + gap) + 14} y={oy + 54} fill={C.coral}>数据边界</Note>
      <Note x={ox + 4 * (cw + gap) + 14} y={oy + 68}>（未来未发生）</Note>
      <Note x={ox + 4 * (cw + gap) + 14} y={oy + 96}>新年度同列明显</Note>
      <Note x={ox + 4 * (cw + gap) + 14} y={oy + 110}>更高 = 发展提速</Note>
    </AnatomySvg>
  );
};
