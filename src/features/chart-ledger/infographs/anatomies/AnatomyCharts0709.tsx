/** 图表账本 · 解剖图 07-09（漏斗收窄 / 瀑布拆解 / 帕累托关键少数） */
import React from 'react';
import { AnatomySvg, Note, C, INK, AXIS } from './shared';

// ── 07 报价转化漏斗：找收窄最陡的一层 ──
export const AnatomyFunnel: React.FC = () => {
  const cx = 230;
  const layers = [
    { w: 380, label: '全部报价', fill: '#13C2C2' },
    { w: 300, label: '有效报价', fill: 'rgba(19,194,194,.72)' },
    { w: 140, label: '优质报价', fill: 'rgba(19,194,194,.48)' },
    { w: 104, label: '已承保', fill: 'rgba(19,194,194,.28)' },
  ];
  const h = 34, gap = 16, top = 28;
  return (
    <AnatomySvg>
      {layers.map((l, i) => (
        <g key={l.label}>
          <rect x={cx - l.w / 2} y={top + i * (h + gap)} width={l.w} height={h} rx={4} fill={l.fill} />
          <text x={cx} y={top + i * (h + gap) + h / 2 + 4} fontSize={12} fill="#10161f" fontWeight={600} textAnchor="middle">
            {l.label}
          </text>
          {i > 0 && (
            <Note x={cx - layers[i - 1].w / 2 - 12} y={top + i * (h + gap) - gap / 2 + 3} anchor="end">
              步进转化率 = 本层 ÷ 上层
            </Note>
          )}
        </g>
      ))}
      {/* 最陡收窄标注（第 2→3 层） */}
      <path
        d={`M ${cx + layers[1].w / 2 + 8} ${top + h + gap + h} L ${cx + layers[2].w / 2 + 8} ${top + 2 * (h + gap)}`}
        fill="none" stroke={C.coral} strokeWidth={2}
      />
      <path d={`M ${cx + layers[1].w / 2 + 8} ${top + h + gap + h} h 14 M ${cx + layers[2].w / 2 + 8} ${top + 2 * (h + gap)} h 14`} stroke={C.coral} strokeWidth={2} fill="none" />
      <Note x={cx + layers[1].w / 2 + 30} y={top + 2 * (h + gap) - 10} fill={C.coral} bold size={11}>收窄最陡的一层</Note>
      <Note x={cx + layers[1].w / 2 + 30} y={top + 2 * (h + gap) + 5} fill={C.coral}>= 干预动作精准卡位处</Note>
      <Note x={cx + layers[1].w / 2 + 30} y={top + 2 * (h + gap) + 22}>其余层不平均撒资源</Note>
    </AnatomySvg>
  );
};

// ── 08 承保利润瀑布：柱顶=累计，最长红柱=利润流失主因 ──
export const AnatomyWaterfall: React.FC = () => {
  const base = 200;
  return (
    <AnatomySvg>
      <line x1={40} y1={base} x2={540} y2={base} stroke={AXIS} strokeWidth={1} />
      {/* 满期保费（起点，teal 满柱） */}
      <rect x={70} y={44} width={72} height={base - 44} fill={C.teal} />
      <Note x={106} y={base + 16} anchor="middle" bold>满期保费</Note>
      {/* 赔款（浮动红柱） */}
      <rect x={186} y={44} width={72} height={86} fill={C.coral} />
      <Note x={222} y={base + 16} anchor="middle" bold>− 赔款</Note>
      {/* 费用（浮动红柱） */}
      <rect x={302} y={130} width={72} height={46} fill={C.coral} />
      <Note x={338} y={base + 16} anchor="middle" bold>− 费用及其他</Note>
      {/* 承保边际（gold 落地柱） */}
      <rect x={418} y={176} width={72} height={base - 176} fill={C.gold} />
      <Note x={454} y={base + 16} anchor="middle" bold>= 承保边际</Note>
      {/* 累计连线 */}
      <line x1={142} y1={44} x2={186} y2={44} stroke={INK} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={258} y1={130} x2={302} y2={130} stroke={INK} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={374} y1={176} x2={418} y2={176} stroke={INK} strokeWidth={1} strokeDasharray="3 3" />
      <Note x={166} y={36} anchor="middle">柱顶位置 = 累计结果</Note>
      {/* 最长红柱标注 */}
      <path d="M 264 44 h 10 M 269 44 v 86 M 264 130 h 10" fill="none" stroke={C.coral} strokeWidth={1.2} />
      <Note x={280} y={82} fill={C.coral} bold>最长的红柱</Note>
      <Note x={280} y={96} fill={C.coral}>= 利润流失主因</Note>
      {/* 尾柱正负 */}
      <Note x={454} y={166} anchor="middle" fill={C.gold} bold>为正 = 承保盈利</Note>
      <Note x={500} y={228} anchor="end">尾柱为负 → 止损组合拳</Note>
    </AnatomySvg>
  );
};

// ── 09 亏损帕累托：80% 累计线切出「关键少数 / 长尾」 ──
export const AnatomyPareto: React.FC = () => {
  const base = 200;
  const bars = [150, 96, 62, 36, 22];
  const cum = [[96, 106], [176, 66], [256, 44], [336, 32], [416, 26]] as const;
  return (
    <AnatomySvg>
      <line x1={40} y1={base} x2={540} y2={base} stroke={AXIS} strokeWidth={1} />
      {bars.map((h, i) => (
        <rect key={i} x={72 + i * 80} y={base - h} width={48} height={h} fill={C.coralDim} stroke={C.coral} strokeWidth={1} />
      ))}
      {/* 累计占比金线 */}
      <polyline points={cum.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={C.gold} strokeWidth={2} />
      {cum.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill={C.gold} />)}
      <Note x={424} y={22} fill={C.gold} bold>累计占比</Note>
      {/* 80% 参考线 */}
      <line x1={40} y1={52} x2={540} y2={52} stroke={INK} strokeWidth={1} strokeDasharray="5 3" />
      <Note x={536} y={48} anchor="end">80%</Note>
      {/* 关键少数分界（累计线越过 80% 处） */}
      <line x1={300} y1={26} x2={300} y2={base} stroke={C.coral} strokeWidth={1.2} strokeDasharray="6 4" />
      <Note x={186} y={228} anchor="middle" fill={C.coral} bold>关键少数：优先专项治理</Note>
      <Note x={420} y={228} anchor="middle">长尾：不平均用力</Note>
      <Note x={306} y={22} fill={C.coral}>累计线越过 80% 的位置</Note>
    </AnatomySvg>
  );
};
