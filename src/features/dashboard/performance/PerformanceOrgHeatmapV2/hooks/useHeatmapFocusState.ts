/**
 * useHeatmapFocusState — 十字聚焦状态管理
 *
 * 点击后同时高亮：当前单元格 + 同行 + 同列 + day视图下同星期几
 */

import { useCallback, useMemo, useState } from 'react';
import type { PerformanceTimePeriod } from '../../../hooks/usePerformanceSummary';
import type { HeatmapCellCoord } from '../types';
import { getWeekdayKey, getMonthKey } from '../config';

interface UseHeatmapFocusStateReturn {
  readonly activeCell: HeatmapCellCoord | null;
  readonly hoverCell: HeatmapCellCoord | null;
  readonly setActiveCell: (cell: HeatmapCellCoord | null) => void;
  readonly setHoverCell: (cell: HeatmapCellCoord | null) => void;
  readonly clearFocus: () => void;
  /** 当前单元格是否在聚焦十字上（含同行、同列、同星期几） */
  readonly isCellFocused: (org: string, date: string) => boolean;
  /** 当前单元格是否应降低对比度 */
  readonly isCellDimmed: (org: string, date: string) => boolean;
  /** 当前单元格是否为激活选中态 */
  readonly isCellSelected: (org: string, date: string) => boolean;
}

export function useHeatmapFocusState(timePeriod: PerformanceTimePeriod): UseHeatmapFocusStateReturn {
  const [activeCell, setActiveCell] = useState<HeatmapCellCoord | null>(null);
  const [hoverCell, setHoverCell] = useState<HeatmapCellCoord | null>(null);

  const clearFocus = useCallback(() => {
    setActiveCell(null);
    setHoverCell(null);
  }, []);

  const focusCell = activeCell ?? hoverCell;

  const focusMeta = useMemo(() => {
    if (!focusCell) return null;
    return {
      org: focusCell.org,
      date: focusCell.date,
      weekday: timePeriod === 'day' ? getWeekdayKey(focusCell.date) : null,
      month: timePeriod === 'month' ? getMonthKey(focusCell.date) : null,
    };
  }, [focusCell, timePeriod]);

  const isCellFocused = useCallback(
    (org: string, date: string): boolean => {
      if (!focusMeta) return false;
      // 选中当前单元格
      if (org === focusMeta.org && date === focusMeta.date) return true;
      // 同行（同机构）
      if (org === focusMeta.org) return true;
      // 同列（同日期）
      if (date === focusMeta.date) return true;
      // day视图：同星期几
      if (focusMeta.weekday !== null && focusMeta.weekday >= 0) {
        if (getWeekdayKey(date) === focusMeta.weekday) return true;
      }
      // month视图：同月
      if (focusMeta.month !== null) {
        if (getMonthKey(date) === focusMeta.month) return true;
      }
      return false;
    },
    [focusMeta],
  );

  const isCellDimmed = useCallback(
    (org: string, date: string): boolean => {
      if (!focusMeta) return false;
      return !isCellFocused(org, date);
    },
    [focusMeta, isCellFocused],
  );

  const isCellSelected = useCallback(
    (org: string, date: string): boolean => {
      if (!activeCell) return false;
      return activeCell.org === org && activeCell.date === date;
    },
    [activeCell],
  );

  return {
    activeCell,
    hoverCell,
    setActiveCell,
    setHoverCell,
    clearFocus,
    isCellFocused,
    isCellDimmed,
    isCellSelected,
  };
}
