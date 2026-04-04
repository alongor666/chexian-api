/**
 * HeatmapTooltip — Portal悬浮诊断卡
 *
 * 纯CSS定位，无第三方依赖。
 * 显示：机构+日期(星期几)+三项指标+档位+业务解释
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatPercent, formatWanAdaptive } from '@/shared/utils/formatters';
import type { HeatmapTooltipContent } from '../types';
import { HEATMAP_COLOR_SCALE } from '../config';
import { useTheme } from '@/shared/theme';

interface HeatmapTooltipProps {
  readonly content: HeatmapTooltipContent | null;
  readonly anchorRect: DOMRect | null;
}

export function HeatmapTooltip({ content, anchorRect }: HeatmapTooltipProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchorRect || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchorRect.bottom + 6;
    let left = anchorRect.left + anchorRect.width / 2 - rect.width / 2;

    // 防止超出右侧
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;
    // 防止超出左侧
    if (left < 8) left = 8;
    // 防止超出下方，改为上方显示
    if (top + rect.height > vh - 8) top = anchorRect.top - rect.height - 6;

    setPos({ top, left });
  }, [anchorRect]);

  if (!content || !anchorRect) return null;

  const tierColor = isDark
    ? HEATMAP_COLOR_SCALE.dark[content.tier]
    : HEATMAP_COLOR_SCALE.light[content.tier];

  const tooltipEl = (
    <div
      ref={tooltipRef}
      className="fixed z-[9999] pointer-events-none"
      style={{ top: pos.top, left: pos.left }}
    >
      <div
        className="rounded-lg border shadow-lg backdrop-blur-sm"
        style={{
          backgroundColor: isDark ? 'rgba(22,22,24,0.95)' : 'rgba(255,255,255,0.97)',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          minWidth: 220,
          maxWidth: 300,
        }}
      >
        {/* 标题行 */}
        <div
          className="px-3 py-2 border-b text-sm font-medium"
          style={{
            color: isDark ? '#e5e7eb' : '#1f2937',
            borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          }}
        >
          {content.org}
          <span
            className="ml-2 text-xs font-normal"
            style={{ color: isDark ? '#9ca3af' : '#6b7280' }}
          >
            {content.date} ({content.weekdayLabel})
          </span>
        </div>

        {/* 指标区 */}
        <div className="px-3 py-2 space-y-1">
          <TooltipRow
            label="增长率"
            value={content.growthRate !== null ? formatPercent(content.growthRate) : '-'}
            isDark={isDark}
            isActive={content.metric === 'growth'}
          />
          <TooltipRow
            label="达成率"
            value={content.achievementRate !== null ? formatPercent(content.achievementRate) : '-'}
            isDark={isDark}
            isActive={content.metric === 'achievement'}
          />
          <TooltipRow
            label="保费(万)"
            value={content.premium !== null ? formatWanAdaptive(content.premium) : '-'}
            isDark={isDark}
            isActive={content.metric === 'premium'}
          />
        </div>

        {/* 档位 + 业务解释 */}
        <div
          className="px-3 py-2 border-t text-xs"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: tierColor.bg }}
            />
            <span style={{ color: tierColor.text }} className="font-medium">
              {content.tierLabel}
            </span>
          </span>
          <p className="mt-1" style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>
            {content.businessNote}
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(tooltipEl, document.body);
}

function TooltipRow({
  label,
  value,
  isDark,
  isActive,
}: {
  label: string;
  value: string;
  isDark: boolean;
  isActive: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>{label}</span>
      <span
        className="font-medium"
        style={{
          color: isActive
            ? isDark ? '#f3f4f6' : '#111827'
            : isDark ? '#d1d5db' : '#374151',
        }}
      >
        {value}
      </span>
    </div>
  );
}
