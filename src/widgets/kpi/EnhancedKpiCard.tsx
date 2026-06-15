/**
 * EnhancedKpiCard 组件 — 重设计版
 *
 * 设计简报 §1 七条法则落地：
 * - §4 巨数字主角 (BAN)：hero 变体 38px，标准 25px
 * - §2 每个数字有参照系：progress / ring / segments + threshold / delta chip / sparkline
 * - §3 状态预注意编码：左侧 status rail + ✓!/▲▼ 文案与图标，不单靠颜色
 * - §5 最大化数据墨水：精确值进 tooltip，去多余装饰
 *
 * 三种卡型同时存在（type='value' | 'donut' | 'bar'）；
 * 通过 variant='hero' 启用大号视觉权重 + 完整参照系
 *
 * 使用统一设计系统（cardStyles / colorClasses / textStyles / numericStyles）
 * 深色模式通过 CSS 变量自动适配
 */
import React, { memo, useState } from 'react';
import {
  colors,
  fontStyles,
  numericStyles,
  cn,
  cardStyles,
  colorClasses,
  textStyles,
} from '../../shared/styles';
import { formatCount, formatPercent, formatRate } from '../../shared/utils/formatters';
import { TONE_VAR, type KpiStatus, type StatusTone } from '@/shared/utils/kpiStatus';

/** 环形图数据项 */
export interface DonutDataItem {
  /** 标签（如"过户"、"非过户"） */
  label: string;
  /** 数值 */
  value: number | bigint;
  /** 颜色（可选） */
  color?: string;
}

/** Hero progress：达成进度（数值型 KPI，例如保费/件数） */
export interface KpiProgress {
  /** 当前达成百分数 0~100+ */
  value: number;
  /** 阈值百分数（如 99） */
  threshold: number;
  /** 右下角说明（如「目标 13,256 万元」） */
  note?: string;
}

/** Hero ring：达成率类（比率型 KPI） */
export interface KpiRing {
  /** 比率百分数 0~100+ */
  value: number;
  /** 阈值百分数（如 99） */
  threshold?: number;
  /** 反向指标（false=越大越好；通常达成率为 false） */
  reverse?: boolean;
}

/** Hero segments：多段占比拆解条（如 变动成本率 = 满期赔付率 + 费用率） */
export interface KpiSegment {
  label: string;
  /** 段值（百分数） */
  value: number;
  /** tone 决定颜色（沿用语义色） */
  tone: StatusTone;
}

/** Delta 涨跌指标 */
export interface KpiDelta {
  value: number;
  /** 单位：% / pt / null */
  unit?: '%' | 'pt' | '';
  /** 反向指标涨红跌绿 */
  reverse?: boolean;
  /** 文案（"同比" / "环比"） */
  label?: string;
}

/** EnhancedKpiCard 组件属性 */
export interface EnhancedKpiCardProps {
  /** KPI 标题 */
  title: string;
  /** KPI 数值（hero/standard 通用） */
  value?: number | string | bigint | null;
  /** 单位（如 "万元" "件" "%"），若 value 已自带单位可省略 */
  unit?: string;
  /** 格式化函数 */
  formatter?: (val: number) => string;
  /** 加载状态 */
  loading?: boolean;
  /** 卡片类型：value=纯数值, donut=环形图, bar=占比条 */
  type?: 'value' | 'donut' | 'bar';
  /** 变体：hero=巨数字+参照系（38px）；standard=普通卡（25px）；默认 standard */
  variant?: 'hero' | 'standard';
  /** 占比数据（type='donut'或'bar'时必填） */
  ratioData?: DonutDataItem[];
  /** 图表尺寸（默认60px） */
  chartSize?: number;
  /** Hero progress（数值型 hero 卡画进度条） */
  progress?: KpiProgress;
  /** Hero ring（比率型 hero 卡画环形） */
  ring?: KpiRing;
  /** Hero segments（拆解 hero 卡画多段条 + 阈值线） */
  segments?: KpiSegment[];
  /** segments 的阈值百分数（叠加阈值线） */
  segmentsThreshold?: number;
  /** Delta chip — 同比 */
  deltaYoY?: KpiDelta;
  /** Delta chip — 环比 */
  deltaMoM?: KpiDelta;
  /** Sparkline 微趋势（标准卡） */
  sparkline?: number[];
  /** 状态判定（驱动 status rail + ✓!） */
  status?: KpiStatus;
  /** 卡尾说明（如「阈值 91% · 健康」） */
  note?: string;
  /** 自定义类名 */
  className?: string;
  /** 点击回调 — 提供时卡片变可交互 */
  onClick?: () => void;
  /** 点击提示文案 */
  clickHint?: string;
}

/** 默认颜色（保留兼容 — 旧 donut/bar 类型沿用） */
const DEFAULT_COLORS = [colors.primary.DEFAULT, colors.neutral[400]];

/** 多段条形图默认配色 */
const SEGMENT_COLORS = [
  colors.primary.DEFAULT,
  '#10B981',
  '#F59E0B',
  colors.neutral[400],
];

/** tone → ECharts 色值（用于 SVG fill/stroke） */
function toneColor(tone: StatusTone): string {
  return TONE_VAR.solid[tone] ?? colors.primary.DEFAULT;
}

const normalizeNumeric = (value: number | bigint): number =>
  typeof value === 'bigint' ? Number(value) : value;

/* ==========================================================================
   原 MiniDonutChart / ChartLegend / RatioBar — 保持向后兼容
   ========================================================================== */

const MiniDonutChart: React.FC<{ data: DonutDataItem[]; size: number }> = ({
  data,
  size,
}) => {
  const normalizedData = React.useMemo(
    () => data.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [data]
  );
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 4}
          fill="none"
          stroke={colors.neutral[200]}
          strokeWidth="8"
          className="dark:[stroke:var(--border-default)]"
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fill={colors.neutral[400]}
          className="dark:[fill:#bfbfbf]"
        >
          0%
        </text>
      </svg>
    );
  }

  const mainRate = (normalizedData[0]?.value || 0) / total;
  const mainPercentage = formatRate(mainRate);
  const radius = size / 2 - 6;
  const strokeWidth = 8;
  const centerX = size / 2;
  const centerY = size / 2;
  const circumference = 2 * Math.PI * radius;
  const mainArcLength = circumference * mainRate;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={normalizedData[1]?.color || DEFAULT_COLORS[1]}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={normalizedData[0]?.color || DEFAULT_COLORS[0]}
        strokeWidth={strokeWidth}
        strokeDasharray={`${mainArcLength} ${circumference}`}
        strokeDashoffset={circumference / 4}
        transform={`rotate(-90 ${centerX} ${centerY})`}
      />
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="14"
        fontWeight="600"
        fill={colors.neutral[900]}
        className={cn(fontStyles.numeric, 'dark:[fill:#f5f5f5]')}
      >
        {mainPercentage}
      </text>
    </svg>
  );
};

const ChartLegend: React.FC<{ data: DonutDataItem[] }> = ({ data }) => (
  <div className="flex items-center justify-center gap-4 mt-2">
    {data.map((item, index) => (
      <div key={index} className="flex items-center gap-1.5">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: item.color || DEFAULT_COLORS[index] }}
        />
        <span className={textStyles.caption}>{item.label}</span>
      </div>
    ))}
  </div>
);

const RatioBar: React.FC<{ data: DonutDataItem[] }> = ({ data }) => {
  const normalizedData = React.useMemo(
    () => data.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [data]
  );
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <div className="w-full">
        <div
          className={cn(
            'flex h-12 rounded-lg overflow-hidden items-center justify-center text-sm font-semibold border',
            colorClasses.border.neutral,
            colorClasses.bg.neutral,
            colorClasses.text.neutralMuted
          )}
        >
          暂无数据
        </div>
      </div>
    );
  }

  if (normalizedData.length >= 3) {
    return (
      <div className="w-full">
        <div className={cn('flex h-10 rounded-lg overflow-hidden border', colorClasses.border.neutral)}>
          {normalizedData.map((item, index) => {
            const rate = (item.value / total) * 100;
            const color =
              item.color || SEGMENT_COLORS[index] || SEGMENT_COLORS[SEGMENT_COLORS.length - 1];
            return (
              <div
                key={index}
                className={cn(
                  'flex items-center justify-center text-xs font-bold text-white',
                  fontStyles.numeric
                )}
                style={{
                  width: `${rate}%`,
                  backgroundColor: color,
                  minWidth: rate > 0 ? '24px' : 0,
                }}
              >
                {rate >= 8 ? `${Math.round(rate)}%` : ''}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-around mt-2">
          {normalizedData.map((item, index) => {
            const rate = (item.value / total) * 100;
            const color =
              item.color || SEGMENT_COLORS[index] || SEGMENT_COLORS[SEGMENT_COLORS.length - 1];
            return (
              <div key={index} className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className={cn(textStyles.caption, 'whitespace-nowrap')}>
                  {item.label} {Math.round(rate)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const primaryValue = normalizedData[0]?.value || 0;
  const secondaryValue = normalizedData[1]?.value || 0;
  const primaryRate = (primaryValue / total) * 100;
  const secondaryRate = (secondaryValue / total) * 100;
  return (
    <div className="w-full">
      <div className={cn('flex h-12 rounded-lg overflow-hidden border', colorClasses.border.neutral)}>
        <div
          className={cn(
            'flex items-center justify-center text-sm font-semibold text-white',
            fontStyles.numeric
          )}
          style={{
            width: `${primaryRate}%`,
            backgroundColor: normalizedData[0]?.color || DEFAULT_COLORS[0],
            minWidth: primaryRate > 0 ? '36px' : 0,
          }}
        >
          {primaryRate > 0 ? formatPercent(primaryRate) : ''}
        </div>
        <div
          className={cn(
            'flex items-center justify-center text-sm font-semibold',
            colorClasses.text.neutral,
            colorClasses.bg.neutralLight,
            fontStyles.numeric
          )}
          style={{
            width: `${secondaryRate}%`,
            minWidth: secondaryRate > 0 ? '36px' : 0,
          }}
        >
          {secondaryRate > 0 ? formatPercent(secondaryRate) : ''}
        </div>
      </div>
    </div>
  );
};

/* ==========================================================================
   重设计新增子组件
   ========================================================================== */

/** ▲ / ▼ / • Delta chip */
const DeltaChip: React.FC<{ delta?: KpiDelta }> = ({ delta }) => {
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
const StatusTag: React.FC<{ status?: KpiStatus }> = ({ status }) => {
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
const StatusRail: React.FC<{ tone: StatusTone; show?: boolean }> = ({ tone, show = true }) => (
  <span
    aria-hidden="true"
    className="absolute left-0 top-0 h-full w-1"
    style={{ background: show ? TONE_VAR.solid[tone] : 'transparent' }}
  />
);

/** Hero 进度条 + 阈值线 */
const ProgressBar: React.FC<{ progress: KpiProgress }> = ({ progress }) => {
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
        {note && <span className={textStyles.caption}>{note}</span>}
      </div>
    </div>
  );
};

/** Hero 环形（中心数字） */
const RingChart: React.FC<{ ring: KpiRing }> = ({ ring }) => {
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
const SegmentBarReference: React.FC<{
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

/** 微趋势 Sparkline（标准卡） */
const Sparkline: React.FC<{
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

/* ==========================================================================
   主组件
   ========================================================================== */

export const EnhancedKpiCard = memo<EnhancedKpiCardProps>(function EnhancedKpiCard({
  title,
  value,
  unit,
  formatter,
  loading = false,
  type = 'value',
  variant = 'standard',
  ratioData = [],
  chartSize = 60,
  progress,
  ring,
  segments,
  segmentsThreshold,
  deltaYoY,
  deltaMoM,
  sparkline,
  status,
  note,
  onClick,
  clickHint,
  className,
}) {
  const interactive = Boolean(onClick);

  const interactiveProps = interactive
    ? {
        role: 'button' as const,
        tabIndex: 0,
        title: clickHint,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        },
      }
    : {};

  /** 格式化主数字（带可选符号） */
  const formattedValue = React.useMemo(() => {
    if (loading) return '--';
    if (value === null || value === undefined) return '--';
    if (typeof value === 'string') return value;
    if (typeof value === 'bigint') {
      return formatter ? formatter(Number(value)) : formatCount(value);
    }
    return formatter ? formatter(value) : formatCount(value);
  }, [value, formatter, loading]);

  const normalizedRatioData = React.useMemo(
    () => ratioData.map((item) => ({ ...item, value: normalizeNumeric(item.value) })),
    [ratioData]
  );

  /** 计算 donut 类型的次要类别占比 */
  const secondaryRate = React.useMemo(() => {
    if (type !== 'donut' || normalizedRatioData.length < 2) return null;
    const total = normalizedRatioData.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return '0.0%';
    return formatPercent((normalizedRatioData[1].value / total) * 100);
  }, [type, normalizedRatioData]);

  /** Loading 骨架 */
  if (loading) {
    return (
      <div className={cn(cardStyles.base, variant === 'hero' ? 'p-5' : 'p-4', className)}>
        <div className="animate-pulse">
          <div className={cn('h-4 rounded w-24 mb-3', colorClasses.bg.neutral)} />
          <div className={cn('h-8 rounded w-32', colorClasses.bg.neutral)} />
        </div>
      </div>
    );
  }

  const baseCls = cn(
    'relative overflow-hidden',
    interactive ? cardStyles.interactive : cardStyles.base,
    variant === 'hero' ? 'p-5' : 'p-4',
    interactive &&
      'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-300 transition-shadow',
    className
  );

  /* ---------- Hero 变体（保留四张图三种参照系） ---------- */
  if (variant === 'hero') {
    const showRail = status && status.key !== 'neutral';
    return (
      <div {...interactiveProps} className={baseCls}>
        {status && <StatusRail tone={status.tone} show={Boolean(showRail)} />}
        <div className={cn('mb-3 flex items-center justify-between', showRail && 'pl-2')}>
          <span className={cn('text-[13px] font-medium', colorClasses.text.neutral)}>{title}</span>
          <div className="flex items-center gap-2">
            <StatusTag status={status} />
            {interactive && (
              <span className={cn('text-[11px] opacity-0 transition group-hover:opacity-100', colorClasses.text.neutralMuted)}>
                下钻 →
              </span>
            )}
          </div>
        </div>

        <div className={cn('flex items-end gap-2', showRail && 'pl-2')}>
          <span
            className={cn(numericStyles.kpiPrimary, colorClasses.text.neutralBlack, 'text-[38px] leading-none')}
          >
            {formattedValue}
          </span>
          {unit && (
            <span className={cn('mb-1 text-[15px]', colorClasses.text.neutralMuted)}>{unit}</span>
          )}
        </div>

        <div className={cn('mt-4 space-y-2', showRail && 'pl-2')}>
          {/* type=value + progress → 数值 Hero（保费） */}
          {type === 'value' && progress && (
            <>
              <ProgressBar progress={progress} />
              {(deltaYoY || deltaMoM) && (
                <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]', colorClasses.text.neutralDark)}>
                  {deltaYoY && <DeltaChip delta={{ ...deltaYoY, label: deltaYoY.label ?? '同比' }} />}
                  {deltaMoM && <DeltaChip delta={{ ...deltaMoM, label: deltaMoM.label ?? '环比' }} />}
                </div>
              )}
            </>
          )}

          {/* type=value + ring → 达成率 Hero */}
          {type === 'value' && !progress && ring && (
            <div className="flex items-center gap-4">
              <RingChart ring={ring} />
              <div className={cn('flex-1 space-y-1.5 text-[11px]', colorClasses.text.neutralDark)}>
                {deltaYoY && <DeltaChip delta={{ ...deltaYoY, label: deltaYoY.label ?? '同比' }} />}
                {deltaMoM && <DeltaChip delta={{ ...deltaMoM, label: deltaMoM.label ?? '环比' }} />}
                {note && (
                  <div className={cn('flex items-center gap-1.5', colorClasses.text.neutralMuted)}>
                    <span className="inline-block h-px w-4" style={{ background: 'currentColor' }} />
                    {note}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* type=bar + segments → 拆解 Hero（变动成本率） */}
          {type === 'bar' && segments && segments.length > 0 && (
            <>
              <SegmentBarReference segments={segments} threshold={segmentsThreshold} />
              {(deltaYoY || note) && (
                <div className={cn('mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]', colorClasses.text.neutralDark)}>
                  {deltaYoY && <DeltaChip delta={{ ...deltaYoY, label: deltaYoY.label ?? '同比' }} />}
                  {note && <span className={textStyles.caption}>{note}</span>}
                </div>
              )}
            </>
          )}

          {/* fallback：仅 delta */}
          {type === 'value' && !progress && !ring && (deltaYoY || deltaMoM) && (
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]', colorClasses.text.neutralDark)}>
              {deltaYoY && <DeltaChip delta={{ ...deltaYoY, label: deltaYoY.label ?? '同比' }} />}
              {deltaMoM && <DeltaChip delta={{ ...deltaMoM, label: deltaMoM.label ?? '环比' }} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------- 标准变体 ---------- */
  const showRail = Boolean(status && (status.key === 'bad' || status.key === 'warn'));

  // donut 类型（保留旧实现，附加 delta 行）
  if (type === 'donut') {
    return (
      <div {...interactiveProps} className={baseCls}>
        {showRail && status && <StatusRail tone={status.tone} />}
        <div className={cn('mb-2 flex items-center justify-between', showRail && 'pl-2')}>
          <span className={cn(textStyles.label, 'truncate')}>{title}</span>
          {deltaYoY && <DeltaChip delta={deltaYoY} />}
        </div>
        <div className={cn('flex items-center justify-between mb-3 mt-1', showRail && 'pl-2')}>
          <div className="flex flex-col">
            <div className={cn(textStyles.caption, 'font-medium mb-1.5')}>
              {normalizedRatioData[1]?.label || '其他'}
            </div>
            <div className={cn(numericStyles.kpiSecondary, colorClasses.text.neutralBlack)}>
              {secondaryRate}
            </div>
          </div>
          <div className="flex-shrink-0">
            <MiniDonutChart data={normalizedRatioData} size={chartSize} />
          </div>
        </div>
        <ChartLegend data={normalizedRatioData} />
      </div>
    );
  }

  // bar 类型（保留旧实现）
  if (type === 'bar') {
    return (
      <div {...interactiveProps} className={baseCls}>
        {showRail && status && <StatusRail tone={status.tone} />}
        <div className={cn('mb-4 flex items-center justify-between', showRail && 'pl-2')}>
          <span className={textStyles.label}>{title}</span>
          {deltaYoY && <DeltaChip delta={deltaYoY} />}
        </div>
        <div className={cn(showRail && 'pl-2')}>
          <RatioBar data={normalizedRatioData} />
        </div>
      </div>
    );
  }

  // value 类型 — 标准卡升级：增加 status rail / delta / sparkline
  return (
    <div {...interactiveProps} className={baseCls}>
      {showRail && status && <StatusRail tone={status.tone} />}
      <div className={cn('mb-1.5 flex items-center justify-between gap-1', showRail && 'pl-2')}>
        <span className={cn('truncate', textStyles.label)}>{title}</span>
        {showRail && <StatusTag status={status} />}
      </div>
      <div className={cn('flex items-end gap-1', showRail && 'pl-2')}>
        <span
          className={cn(numericStyles.kpiSecondary, colorClasses.text.neutralBlack)}
          style={{ fontSize: 25 }}
        >
          {formattedValue}
        </span>
        {unit && (
          <span className={cn('mb-0.5 text-[11px]', colorClasses.text.neutralMuted)}>{unit}</span>
        )}
      </div>
      {(deltaYoY || deltaMoM || sparkline) && (
        <div className={cn('mt-2.5 flex items-center justify-between', showRail && 'pl-2')}>
          <span className="flex items-center gap-1 text-[11px]">
            {(deltaYoY || deltaMoM) && (
              <DeltaChip
                delta={{
                  ...(deltaYoY || deltaMoM)!,
                  label: deltaYoY ? deltaYoY.label ?? '同比' : (deltaMoM?.label ?? '环比'),
                }}
              />
            )}
          </span>
          {sparkline && sparkline.length >= 2 && (
            <Sparkline
              values={sparkline}
              tone={(() => {
                const d = deltaYoY?.value ?? deltaMoM?.value ?? 0;
                const reverse = deltaYoY?.reverse ?? deltaMoM?.reverse ?? false;
                if (d === 0) return 'neutral';
                return (d > 0) === !reverse ? 'success' : 'danger';
              })()}
            />
          )}
        </div>
      )}
      {note && <div className={cn('mt-2 text-[11px]', colorClasses.text.neutralMuted)}>{note}</div>}
    </div>
  );
});

// 让 useState 不被 tree-shake 警告（保留 React 命名空间引用）
void useState;
