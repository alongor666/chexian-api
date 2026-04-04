/**
 * HeatmapMatrix — 主热力图矩阵
 *
 * StickyTableFrame + 表头(含周末标识) + tbody循环渲染HeatmapCell
 * 所有背景色强制透明，避免灰底干扰热力色带。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StickyTableFrame } from '@/shared/ui';
import { cn, colorClasses, stickyTableStyles, textStyles } from '@/shared/styles';
import type { HeatmapDimension } from '../../../hooks/usePerformanceOrgHeatmap';
import type { PerformanceGrowthMode, PerformanceTimePeriod } from '../../../hooks/usePerformanceSummary';
import type { HeatmapCellCoord, HeatmapDerivedData, HeatmapMetric, HeatmapTooltipContent } from '../types';
import type { ResolvedColor } from '../hooks/useHeatmapColorScale';
import { BRANCH_SUMMARY_ROW_LABEL } from '../config';
import { formatDimensionLabel } from '../hooks/useHeatmapDerivedData';
import { HeatmapCell } from './HeatmapCell';
import { HeatmapTooltip } from './HeatmapTooltip';
import { useTheme } from '@/shared/theme';

interface HeatmapMatrixProps {
  readonly derivedData: HeatmapDerivedData;
  readonly metric: HeatmapMetric;
  readonly growthMode: PerformanceGrowthMode;
  readonly timePeriod: PerformanceTimePeriod;
  readonly dimensionLabel: string;
  readonly groupByDimension: HeatmapDimension;
  readonly loading: boolean;
  readonly error: string | null;
  readonly resolveColor: (value: number | null, metric: HeatmapMetric) => ResolvedColor;
  readonly isCellDimmed: (org: string, date: string) => boolean;
  readonly isCellSelected: (org: string, date: string) => boolean;
  readonly onCellClick: (coord: HeatmapCellCoord) => void;
  readonly onHoverStart: (coord: HeatmapCellCoord) => void;
  readonly onHoverEnd: () => void;
  readonly onRowClick?: (org: string) => void;
}

/**
 * 强制透明背景 — 覆盖 stickyTableStyles 中的 bg-white / dark:bg-surface-1。
 * sticky 元素仍需不透明背景（否则滚动穿透），所以用 CSS 变量 surface 层级色代替白色。
 */

export function HeatmapMatrix({
  derivedData,
  metric,
  growthMode,
  timePeriod,
  dimensionLabel,
  groupByDimension,
  loading,
  error,
  resolveColor,
  isCellDimmed,
  isCellSelected,
  onCellClick,
  onHoverStart,
  onHoverEnd,
  onRowClick,
}: HeatmapMatrixProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { dates, organizations, matrix, weekendDates } = derivedData;

  // Tooltip 状态
  const [tooltipContent, setTooltipContent] = useState<HeatmapTooltipContent | null>(null);
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

  // 数据变化时自动滚动到最右（最新日期）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [dates.length, timePeriod]);

  const handleCellHoverStart = useCallback(
    (coord: HeatmapCellCoord, rect: DOMRect, content: HeatmapTooltipContent) => {
      setTooltipContent(content);
      setTooltipRect(rect);
      onHoverStart(coord);
    },
    [onHoverStart],
  );

  const handleCellHoverEnd = useCallback(() => {
    setTooltipContent(null);
    setTooltipRect(null);
    onHoverEnd();
  }, [onHoverEnd]);

  if (error) {
    return (
      <p className={cn(textStyles.body, colorClasses.text.danger)}>加载失败: {error}</p>
    );
  }

  // sticky 元素的背景色：深色用 surface-1，浅色用白色
  const stickyBg = isDark ? '#161618' : '#ffffff';

  return (
    <>
      <StickyTableFrame
        ref={scrollRef}
        maxHeight={560}
        style={{ background: 'transparent', border: 'none' }}
      >
        <table
          className="w-full text-xs border-separate border-spacing-1 table-fixed"
        >
          <thead>
            <tr>
              <th
                className={cn(
                  'px-2 py-2 text-left',
                  stickyTableStyles.firstColumnHeader,
                  colorClasses.text.neutralDark,
                )}
                style={{ background: stickyBg, width: '100px' }}
              >
                {dimensionLabel}
              </th>
              {dates.map((date) => {
                const isWkend = weekendDates.has(date);
                return (
                  <th
                    key={date}
                    className={cn(
                      'px-2 py-2 text-center',
                      stickyTableStyles.header,
                      isWkend ? 'opacity-60' : '',
                      colorClasses.text.neutralMuted,
                    )}
                    style={{ background: stickyBg }}
                  >
                    {formatHeaderLabel(date, timePeriod)}
                    {isWkend && timePeriod === 'day' && (
                      <span className="block text-[9px] opacity-50">
                        {new Date(`${date}T00:00:00`).getDay() === 0 ? '日' : '六'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={dates.length + 1}
                  className={cn('px-3 py-6 text-center', colorClasses.text.neutralMuted)}
                >
                  数据加载中...
                </td>
              </tr>
            )}
            {!loading && organizations.length === 0 && (
              <tr>
                <td
                  colSpan={dates.length + 1}
                  className={cn('px-3 py-6 text-center', colorClasses.text.neutralMuted)}
                >
                  暂无热力图数据
                </td>
              </tr>
            )}
            {!loading &&
              organizations.map((org) => {
                const orgLine = matrix.get(org);
                const isBranchSummary = org === BRANCH_SUMMARY_ROW_LABEL;
                const canRowClick = Boolean(onRowClick) && !isBranchSummary;
                return (
                  <tr key={org}>
                    <td
                      className={cn(
                        stickyTableStyles.firstColumn,
                        'px-2 py-1 z-10 whitespace-nowrap',
                        colorClasses.text.neutralDark,
                        isBranchSummary ? 'font-semibold' : '',
                        canRowClick
                          ? 'cursor-pointer hover:text-primary hover:underline'
                          : '',
                      )}
                      style={{ background: stickyBg }}
                      onClick={canRowClick ? () => onRowClick?.(org) : undefined}
                      title={canRowClick ? `点击下钻 ${org}` : org}
                    >
                      {formatDimensionLabel(org, groupByDimension)}
                    </td>
                    {dates.map((date) => (
                      <td key={`${org}-${date}`} className="p-0.5">
                        <HeatmapCell
                          org={org}
                          date={date}
                          row={orgLine?.get(date)}
                          metric={metric}
                          growthMode={growthMode}
                          isBranchSummary={isBranchSummary}
                          isDimmed={isCellDimmed(org, date)}
                          isSelected={isCellSelected(org, date)}
                          resolveColor={resolveColor}
                          onCellClick={onCellClick}
                          onHoverStart={handleCellHoverStart}
                          onHoverEnd={handleCellHoverEnd}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </StickyTableFrame>
      <HeatmapTooltip content={tooltipContent} anchorRect={tooltipRect} />
    </>
  );
}

// ==================== Header Label Formatter ====================

function formatHeaderLabel(date: string, timePeriod: PerformanceTimePeriod): string {
  switch (timePeriod) {
    case 'year':
      return date.slice(0, 4);
    case 'month':
      return date.slice(0, 7);
    case 'quarter': {
      const month = parseInt(date.slice(5, 7), 10);
      const q = Math.ceil(month / 3);
      return `${date.slice(0, 4)}-Q${q}`;
    }
    case 'week':
      return `${date.slice(5)}周`;
    default:
      return date.slice(5);
  }
}
