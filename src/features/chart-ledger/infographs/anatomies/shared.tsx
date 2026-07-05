/**
 * 图表账本 · 解剖图 SVG 小工具
 *
 * 统一 560×240 画布；数据示意色沿用 LEDGER 五色（ECharts 内联 hex 层，
 * 与 CustomPanels 同一豁免口径）；注解文字用 #8C8C8C（明暗双模式均可读）。
 */
import React from 'react';
import { LEDGER_COLORS, lossRatioColor } from '../../components/EchartsPanels';

export const C = LEDGER_COLORS;
export { lossRatioColor };

/** 注解墨色（neutral-500，明暗双模式均可读） */
export const INK = '#8C8C8C';
/** 轴/辅助线（半透明中性，明暗通用） */
export const AXIS = 'rgba(140,140,140,.45)';

export const AnatomySvg: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg viewBox="0 0 560 240" width="100%" role="img" aria-hidden="true" style={{ fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
    {children}
  </svg>
);

/** 注解文字 */
export const Note: React.FC<{
  x: number;
  y: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  size?: number;
  bold?: boolean;
  children: React.ReactNode;
}> = ({ x, y, fill = INK, anchor = 'start', size = 10, bold = false, children }) => (
  <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={bold ? 600 : 400}>
    {children}
  </text>
);

/** 底部 x/y 轴（左下直角） */
export const Axes: React.FC<{ x?: number; y?: number; right?: number; top?: number }> = ({
  x = 40,
  y = 210,
  right = 540,
  top = 20,
}) => (
  <g>
    <line x1={x} y1={y} x2={right} y2={y} stroke={AXIS} strokeWidth={1} />
    <line x1={x} y1={top} x2={x} y2={y} stroke={AXIS} strokeWidth={1} />
  </g>
);
