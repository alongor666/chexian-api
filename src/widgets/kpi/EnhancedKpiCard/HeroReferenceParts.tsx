/**
 * EnhancedKpiCard — Hero 参照系三件套
 *
 * ProgressBar：达成进度 + 阈值线（数值型 hero）
 * RingChart：环形 + 中心数字（比率型 hero）
 * SegmentBarReference：多段占比 + 阈值线 + 图例（拆解 hero）
 *
 * 三者均含基于 threshold 的 tone 派生逻辑；R3 抽分原则要求
 * 各自保留内联 tone 函数，不做过早抽象（ProgressBar 单向 / RingChart 含 reverse 分支）。
 */
import React from 'react';
import { cn, colorClasses, fontStyles } from '../../../shared/styles';
import { TONE_VAR, type StatusTone } from '@/shared/utils/kpiStatus';
import type { KpiProgress, KpiRing, KpiSegment } from './types';
import { toneColor } from './utils';

/** Hero 进度条 + 阈值线 */
export const ProgressBar: React.FC<{ progress: KpiProgress }> = ({ progress }) => {
  const { value, threshold, note } = progress;
  const tone: StatusTone =
    value >= threshold ? 'success' : value >= threshold - 3 ? 'warning' : 'danger';
  return (
    <div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--c-bg-subtle, rgba(0,0,0,0.06))' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, value)}%`, background: TONE_VAR.solid[tone] }}
        />
        <div
          className="absolute top-0 h-full w-px"
          style={{ left: `${Math.min(100, threshold)}%`, background: 'currentColor', opacity: 0.6 }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span
          className={cn('font-semibold', fontStyles.numeric)}
          style={{ color: TONE_VAR.text[tone] }}
        >
          达成 {value.toFixed(1)}%
        </span>
        {note && <span className={cn(colorClasses.text.neutralMuted)}>{note}</span>}
      </div>
    </div>
  );
};

/** Hero 环形（中心数字） */
export const RingChart: React.FC<{ ring: KpiRing }> = ({ ring }) => {
  const { value, threshold, reverse = false } = ring;
  const tone: StatusTone =
    threshold == null
      ? 'primary'
      : reverse
      ? value <= threshold - 3
        ? 'success'
        : value <= threshold
        ? 'warning'
        : 'danger'
      : value >= threshold
      ? 'success'
      : value >= threshold - 3
      ? 'warning'
      : 'danger';

  const size = 58;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const len = (Math.min(100, value) / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={toneColor(tone)}
        strokeWidth={stroke}
        strokeDasharray={`${len} ${c - len}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        strokeLinecap="butt"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.24}
        fontWeight="600"
        style={{ fill: 'currentColor' }}
        className={fontStyles.numeric}
      >
        {value.toFixed(0)}
      </text>
    </svg>
  );
};

/** Hero 多段占比条 + 阈值线 */
export const SegmentBarReference: React.FC<{
  segments: KpiSegment[];
  threshold?: number;
  height?: number;
}> = ({ segments, threshold, height = 30 }) => {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="relative flex w-full overflow-hidden rounded-md" style={{ height }}>
        {segments.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-center"
            style={{ width: `${(s.value / total) * 100}%`, background: toneColor(s.tone) }}
          >
            <span
              className={cn('px-1 text-[11px] font-bold text-white', fontStyles.numeric)}
            >
              {s.value.toFixed(0)}
            </span>
          </div>
        ))}
        {threshold != null && (
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${Math.min(100, (threshold / total) * 100)}%` }}
          >
            <div className="h-full w-px" style={{ background: 'currentColor', opacity: 0.7 }} />
            <span
              className={cn('absolute top-0 left-1 whitespace-nowrap text-[9px] font-semibold')}
              style={{ color: 'currentColor' }}
            >
              阈值 {threshold}%
            </span>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <span
            key={i}
            className={cn('flex items-center gap-1.5 text-[11px]', colorClasses.text.neutralDark)}
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: toneColor(s.tone) }}
            />
            {s.label}{' '}
            <span className={cn(fontStyles.numeric, colorClasses.text.neutralBlack)}>
              {s.value.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
};
