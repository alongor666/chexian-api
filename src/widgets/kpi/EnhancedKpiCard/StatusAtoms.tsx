/**
 * EnhancedKpiCard — 状态/微视图原子组件
 *
 * DeltaChip：▲▼ 涨跌 chip（同比/环比）
 * StatusTag：✓! 状态标签
 * StatusRail：左侧状态色边条
 * Sparkline：微趋势 SVG（标准卡）
 */
import React from 'react';
import { cn, fontStyles, textStyles } from '../../../shared/styles';
import { TONE_VAR, type KpiStatus, type StatusTone } from '@/shared/utils/kpiStatus';
import type { KpiDelta } from './types';
import { toneColor } from './utils';

/** ▲ / ▼ / • Delta chip */
export const DeltaChip: React.FC<{ delta?: KpiDelta }> = ({ delta }) => {
  if (!delta || delta.value == null || Number.isNaN(delta.value)) return null;
  const { value, unit = 'pt', reverse = false, label } = delta;
  const positive = value > 0;
  const isGood = reverse ? !positive : positive;
  const tone: StatusTone = value === 0 ? 'neutral' : isGood ? 'success' : 'danger';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '•';
  const sign = value > 0 ? '+' : '';
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-[11.5px] font-semibold', fontStyles.numeric)}
      style={{ color: TONE_VAR.text[tone] }}
    >
      <span aria-hidden="true">{arrow}</span>
      {sign}
      {value.toFixed(1)}
      {unit}
      {label && (
        <span className={cn('ml-1 font-normal', textStyles.caption)} style={{ color: TONE_VAR.text.neutral }}>
          {label}
        </span>
      )}
    </span>
  );
};

/** ✓ / ! 状态 Tag */
export const StatusTag: React.FC<{ status?: KpiStatus }> = ({ status }) => {
  if (!status || status.key === 'neutral' || !status.label) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
      style={{ color: TONE_VAR.text[status.tone], background: TONE_VAR.bg[status.tone] }}
    >
      <span aria-hidden="true">{status.mark}</span>
      {status.label}
    </span>
  );
};

/** 左侧状态色边条（rail） */
export const StatusRail: React.FC<{ tone: StatusTone; show?: boolean }> = ({ tone, show = true }) => (
  <span
    aria-hidden="true"
    className="absolute left-0 top-0 h-full w-1"
    style={{ background: show ? TONE_VAR.solid[tone] : 'transparent' }}
  />
);

/** 微趋势 Sparkline（标准卡） */
export const Sparkline: React.FC<{
  values: number[];
  tone?: StatusTone;
  width?: number;
  height?: number;
}> = ({ values, tone = 'primary', width = 72, height = 22 }) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rng = max - min || 1;
  const n = values.length;
  const points = values.map((v, i) => {
    const x = (i / (n - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / rng) * (height - 4);
    return [x, y] as const;
  });
  const d = points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = points[points.length - 1];
  const stroke = toneColor(tone);
  return (
    <svg width={width} height={height} className="block overflow-visible">
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle cx={last[0]} cy={last[1]} r={1.8} fill={stroke} />
    </svg>
  );
};
