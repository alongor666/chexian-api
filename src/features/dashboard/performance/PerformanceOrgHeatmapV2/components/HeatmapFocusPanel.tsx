/**
 * HeatmapFocusPanel — 焦点诊断抽屉（slide-in drawer）
 *
 * 选中单元格后从右侧滑入：诊断摘要 + 指标 chip + 下钻入口按钮 + 清除按钮。
 * 关闭：点击 × / 按 ESC / 点击外部。
 * 替代 PerformanceAnalysisPanel 中的"已选择"区块。
 */

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/shared/theme';
import { formatCount, formatPercent, formatWanAdaptive } from '@/shared/utils/formatters';
import { cn, colorClasses, textStyles } from '@/shared/styles';
import type { HeatmapFocusPanelProps } from '../types';
import { getWeekdayLabel, TIER_LABELS, TIER_BUSINESS_NOTES, THRESHOLD_MAP, HEATMAP_COLOR_SCALE } from '../config';
import type { HeatmapTier } from '../types';

function resolveTier(value: number | null, metric: keyof typeof THRESHOLD_MAP): HeatmapTier {
  if (value === null || Number.isNaN(value)) return 'unknown';
  const config = THRESHOLD_MAP[metric];
  if (!config) return 'unknown';
  for (const { tier, min } of config.tiers) {
    if (min === undefined || value >= min) return tier;
  }
  return 'critical';
}

export function HeatmapFocusPanel({
  activeCell,
  row,
  metric,
  growthMode,
  onDrillClick,
  onClear,
}: HeatmapFocusPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const asideRef = useRef<HTMLDivElement>(null);
  const [enterFrame, setEnterFrame] = useState(false);

  const isOpen = activeCell !== null;

  // 入场动画：mount 后下一帧切换 translate-x-0，触发 transition
  useEffect(() => {
    if (!isOpen) {
      setEnterFrame(false);
      return;
    }
    const id = window.requestAnimationFrame(() => setEnterFrame(true));
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClear();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClear]);

  // 外部点击关闭（避开热力图单元格自身：点击单元格视为切换，不视为关闭）
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (asideRef.current?.contains(target)) return;
      // 单元格点击交给 onCellClick 处理切换／清除
      const interactiveCell = (target as HTMLElement).closest?.('[data-heatmap-cell]');
      if (interactiveCell) return;
      onClear();
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClear]);

  if (!isOpen || !activeCell) return null;

  const growthRate = row ? (growthMode === 'mom' ? row.momGrowthRate : row.yoyGrowthRate) : null;
  const primaryValue = (() => {
    switch (metric) {
      case 'premium': return row?.premium ?? null;
      case 'achievement': return row?.achievementRate ?? null;
      case 'coefficient': return row?.avgPricingCoefficient ?? null;
      case 'share': return row?.premiumShare ?? null;
      case 'per_policy': return row?.perPolicyPremium ?? null;
      default: return growthRate;
    }
  })();

  const tier: HeatmapTier = metric === 'premium'
    ? 'normal'
    : resolveTier(primaryValue, metric as keyof typeof THRESHOLD_MAP);

  const tierColor = isDark ? HEATMAP_COLOR_SCALE.dark[tier] : HEATMAP_COLOR_SCALE.light[tier];

  return (
    <aside
      ref={asideRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${activeCell.org} ${activeCell.date} 诊断详情`}
      className={cn(
        'fixed top-0 right-0 h-screen w-80 max-w-[85vw] z-30 flex flex-col overflow-hidden',
        'bg-white dark:bg-surface-1 border-l border-neutral-200 dark:border-subtle shadow-lg dark:shadow-none',
        'transition-[transform,opacity] duration-200 ease-out',
        enterFrame ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none',
      )}
    >
      {/* 抽屉标题栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-subtle shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: tierColor.bg, border: `1px solid ${tierColor.text}40` }}
          />
          <div className="min-w-0">
            <h3 className={cn(textStyles.body, 'font-semibold truncate', colorClasses.text.neutralDark)}>
              {activeCell.org}
            </h3>
            <p className={cn(textStyles.caption, colorClasses.text.neutralMuted)}>
              {activeCell.date} ({getWeekdayLabel(activeCell.date)})
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="关闭"
          className={cn(
            'text-lg leading-none w-7 h-7 rounded hover:bg-neutral-100 dark:hover:bg-white/5 shrink-0',
            colorClasses.text.neutralMuted,
          )}
        >
          ×
        </button>
      </header>

      {/* 抽屉内容 */}
      <div className="px-4 py-3 overflow-auto flex-1 space-y-3">
        {/* 指标卡片 */}
        {row && (
          <div className="grid grid-cols-2 gap-2">
            <MetricChip
              label={growthMode === 'mom' ? '环比' : '同比'}
              value={growthRate !== null ? formatPercent(growthRate) : '-'}
              isActive={metric === 'growth'}
            />
            <MetricChip
              label="进度"
              value={row.achievementRate !== null ? formatPercent(row.achievementRate) : '-'}
              isActive={metric === 'achievement'}
            />
            <MetricChip
              label="保费(万)"
              value={formatWanAdaptive(row.premium)}
              isActive={metric === 'premium'}
            />
            <MetricChip
              label="系数均值"
              value={row.avgPricingCoefficient !== null ? row.avgPricingCoefficient.toFixed(4) : '-'}
              isActive={metric === 'coefficient'}
            />
            <MetricChip
              label="占比"
              value={row.premiumShare !== null ? formatPercent(row.premiumShare) : '-'}
              isActive={metric === 'share'}
            />
            <MetricChip
              label="件均(元)"
              value={row.perPolicyPremium !== null ? formatCount(Math.round(row.perPolicyPremium * 10000)) : '-'}
              isActive={metric === 'per_policy'}
            />
          </div>
        )}

        {/* 诊断摘要 */}
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb',
            color: isDark ? '#9ca3af' : '#6b7280',
          }}
        >
          <span className="font-medium" style={{ color: tierColor.text }}>
            {TIER_LABELS[tier]}
          </span>
          <span className="mx-1.5">·</span>
          <span>{TIER_BUSINESS_NOTES[tier]}</span>
        </div>
      </div>

      {/* 抽屉底部 CTA */}
      <footer className="px-4 py-3 border-t border-neutral-200 dark:border-subtle shrink-0">
        <button
          type="button"
          onClick={onDrillClick}
          className={cn(
            'w-full px-3 py-2 text-sm rounded-md font-medium transition-colors',
            'bg-primary text-white hover:bg-primary-light',
          )}
        >
          选择下钻维度 →
        </button>
      </footer>
    </aside>
  );
}

function MetricChip({
  label,
  value,
  isActive,
}: {
  label: string;
  value: string;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-1.5 text-xs',
        isActive
          ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
          : 'bg-neutral-50 dark:bg-[rgba(255,255,255,0.04)]',
      )}
    >
      <div className={colorClasses.text.neutralMuted}>{label}</div>
      <div className={cn('font-semibold mt-0.5', textStyles.numeric, colorClasses.text.neutralDark)}>
        {value}
      </div>
    </div>
  );
}
