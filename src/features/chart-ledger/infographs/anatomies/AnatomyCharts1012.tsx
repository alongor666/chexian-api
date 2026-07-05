/** 图表账本 · 解剖图 10-12（树图结构 / 控制图三线 / 四象限动作矩阵） */
import React from 'react';
import { AnatomySvg, Axes, Note, C, INK } from './shared';

// ── 10 险种结构树图：压舱石 / 高风险敞口 / 机会小块 ──
export const AnatomyTreemap: React.FC = () => (
  <AnatomySvg>
    <rect x={44} y={30} width={236} height={172} rx={4} fill={C.teal} />
    <text x={162} y={110} fontSize={13} fill="#10161f" fontWeight={700} textAnchor="middle">压舱石</text>
    <text x={162} y={128} fontSize={10} fill="#10161f" textAnchor="middle" opacity={0.8}>最大占比 · 盯集中度</text>
    <rect x={286} y={30} width={124} height={104} rx={4} fill={C.coral} />
    <text x={348} y={78} fontSize={12} fill="#10161f" fontWeight={700} textAnchor="middle">高风险敞口</text>
    <text x={348} y={94} fontSize={10} fill="#10161f" textAnchor="middle" opacity={0.8}>高赔付险种占大块</text>
    <rect x={286} y={140} width={124} height={62} rx={4} fill={C.gold} />
    <text x={348} y={168} fontSize={11} fill="#10161f" fontWeight={700} textAnchor="middle">机会业务</text>
    <text x={348} y={183} fontSize={10} fill="#10161f" textAnchor="middle" opacity={0.8}>值得提前布局</text>
    <rect x={416} y={30} width={58} height={80} rx={4} fill="#E8CE7B" />
    <rect x={416} y={116} width={58} height={86} rx={4} fill={C.muted} />
    <text x={445} y={162} fontSize={10} fill="#10161f" textAnchor="middle">长尾</text>
    <Note x={490} y={70}>面积 =</Note>
    <Note x={490} y={84}>保费占比</Note>
    <Note x={490} y={130}>一眼判断</Note>
    <Note x={490} y={144}>是否过度集中</Note>
    <Note x={280} y={224} anchor="middle">最大块占比过高 = 结构集中风险；高赔付险种面积大 = 敞口风险</Note>
  </AnatomySvg>
);

// ── 11 变动成本率控制图：三线 + 正常波动带 + 破限点 ──
export const AnatomyControl: React.FC = () => (
  <AnatomySvg>
    <Axes />
    {/* 正常波动带 */}
    <rect x={40} y={80} width={500} height={80} fill={C.tealDim} opacity={0.18} />
    <Note x={56} y={124} fill={C.teal}>正常波动带（限内不动作，防过度反应）</Note>
    {/* 三线 */}
    <line x1={40} y1={80} x2={540} y2={80} stroke={C.coral} strokeWidth={1.5} strokeDasharray="5 3" />
    <Note x={536} y={74} anchor="end" fill={C.coral} bold>上控制限 = 中心线 + 2σ</Note>
    <line x1={40} y1={120} x2={540} y2={120} stroke={INK} strokeWidth={1} strokeDasharray="3 4" />
    <Note x={536} y={136} anchor="end">中心线 = 历史均值</Note>
    <line x1={40} y1={160} x2={540} y2={160} stroke={C.coral} strokeWidth={1.5} strokeDasharray="5 3" />
    <Note x={536} y={176} anchor="end" fill={C.coral}>下控制限 = 中心线 − 2σ</Note>
    {/* 走势线 + 破限点 */}
    <polyline points="60,112 110,126 160,118 210,132 260,110 310,52 360,116 410,104 460,128 510,114" fill="none" stroke={C.teal} strokeWidth={2} />
    {[[60, 112], [110, 126], [160, 118], [210, 132], [260, 110], [360, 116], [410, 104], [460, 128], [510, 114]].map(([x, y], i) => (
      <circle key={i} cx={x} cy={y} r={3.5} fill={C.teal} />
    ))}
    <circle cx={310} cy={52} r={7} fill={C.coral} />
    <Note x={310} y={36} anchor="middle" fill={C.coral} bold>破限点 = 异常波动，定点介入</Note>
    <Note x={540} y={228} anchor="end">→ 周次</Note>
    <Note x={44} y={16}>↑ 变动成本率(%) · 连续单侧漂移（即使未破限）也值得预警</Note>
  </AnatomySvg>
);

// ── 12 赔付率-保费增速四象限：四区四动作 ──
export const AnatomyQuadrant: React.FC = () => (
  <AnatomySvg>
    <Axes />
    {/* 四区着色（十字：x=290, y=115） */}
    <rect x={290} y={20} width={250} height={95} fill={C.coralDim} opacity={0.3} />
    <rect x={290} y={115} width={250} height={95} fill="rgba(82,196,26,.14)" />
    <rect x={40} y={115} width={250} height={95} fill="rgba(232,179,57,.14)" />
    <rect x={40} y={20} width={250} height={95} fill="rgba(140,140,140,.12)" />
    {/* 象限标签 */}
    <Note x={415} y={58} anchor="middle" fill={C.coral} bold size={12}>风险扩张</Note>
    <Note x={415} y={74} anchor="middle" fill={C.coral}>增长在放大风险 → 整改</Note>
    <Note x={415} y={155} anchor="middle" fill={C.good} bold size={12}>优质增长</Note>
    <Note x={415} y={171} anchor="middle" fill={C.good}>又快又好 → 加码资源</Note>
    <Note x={165} y={155} anchor="middle" fill={C.gold} bold size={12}>潜力不足</Note>
    <Note x={165} y={171} anchor="middle" fill={C.gold}>质量好但没长大 → 复制经验</Note>
    <Note x={165} y={58} anchor="middle" fill={INK} bold size={12}>低效业务</Note>
    <Note x={165} y={74} anchor="middle" fill={INK}>又慢又差 → 暂停 / 退出</Note>
    {/* 十字阈值线 */}
    <line x1={40} y1={115} x2={540} y2={115} stroke={INK} strokeWidth={1.2} strokeDasharray="5 3" />
    <line x1={290} y1={20} x2={290} y2={210} stroke={INK} strokeWidth={1.2} strokeDasharray="5 3" />
    <Note x={46} y={110}>赔付率 65%</Note>
    <Note x={296} y={206}>增速均值（随筛选动态）</Note>
    {/* 示例点 */}
    <circle cx={452} cy={92} r={6} fill={C.coral} />
    <circle cx={468} cy={150} r={6} fill={C.good} />
    <circle cx={130} cy={140} r={6} fill={C.gold} />
    <circle cx={110} cy={62} r={6} fill={C.muted} />
    <Note x={540} y={228} anchor="end">→ 保费同比增速(%)</Note>
    <Note x={44} y={16}>↑ 满期赔付率(%)（越低越好）</Note>
  </AnatomySvg>
);
