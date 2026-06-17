/**
 * EnhancedKpiCard 组件 — 重设计版（主入口）
 *
 * 原 870 行单文件已按 PR #665 useCostAnalysis 抽分模式拆为 5 子文件 + 280 行薄壳：
 *   - types.ts                : 6 个公共 interface（DonutDataItem / KpiProgress /
 *                                KpiRing / KpiSegment / KpiDelta / EnhancedKpiCardProps）
 *   - utils.ts                : DEFAULT_COLORS / SEGMENT_COLORS / toneColor / normalizeNumeric
 *   - LegacyRatioParts.tsx    : MiniDonutChart / ChartLegend / RatioBar
 *   - HeroReferenceParts.tsx  : ProgressBar / RingChart / SegmentBarReference
 *   - StatusAtoms.tsx         : DeltaChip / StatusTag / StatusRail / Sparkline
 *
 * 设计简报 §1 七条法则落地：
 * - §4 巨数字主角 (BAN)：hero 变体 38px，标准 25px
 * - §2 每个数字有参照系：progress / ring / segments + threshold / delta chip / sparkline
 * - §3 状态预注意编码：左侧 status rail + ✓!/▲▼ 文案与图标，不单靠颜色
 * - §5 最大化数据墨水：精确值进 tooltip，去多余装饰
 *
 * 6 个公共 export 100% 保留，4 个调用方零修改。
 */
import React, { memo } from 'react';
import {
  cn,
  cardStyles,
  colorClasses,
  textStyles,
  numericStyles,
} from '../../../shared/styles';
import { formatCount, formatPercent } from '../../../shared/utils/formatters';
import type { EnhancedKpiCardProps } from './types';
import { normalizeNumeric } from './utils';
import {
  MiniDonutChart,
  ChartLegend,
  RatioBar,
} from './LegacyRatioParts';
import {
  ProgressBar,
  RingChart,
  SegmentBarReference,
} from './HeroReferenceParts';
import {
  DeltaChip,
  StatusTag,
  StatusRail,
  Sparkline,
} from './StatusAtoms';

// re-export 全部 6 个 public type，调用方既可 import { EnhancedKpiCard } 也可 import type { ... }
export type {
  DonutDataItem,
  KpiProgress,
  KpiRing,
  KpiSegment,
  KpiDelta,
  EnhancedKpiCardProps,
} from './types';

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
