// 从 PerformanceAnalysisPanel.tsx 抽出（b331 拆分·行为零变更）。供 PerformanceAnalysisPage 使用。
import React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { buttonStyles, cn } from '@/shared/styles';
import type { PerformanceSegmentTag } from './hooks/usePerformanceSummary';
import { SEGMENT_OPTIONS } from './performancePanel.shared';

export const PerformanceHeaderActions: React.FC<{
  segmentTag: PerformanceSegmentTag;
  onSegmentTagChange: (v: PerformanceSegmentTag) => void;
  onReset: () => void;
  onOpenAdvanced: () => void;
  activeFilterCount: number;
}> = ({ segmentTag, onSegmentTagChange, onReset, onOpenAdvanced, activeFilterCount }) => (
  <div className="flex items-center gap-2">
    <select
      value={segmentTag}
      onChange={(e) => onSegmentTagChange(e.target.value as PerformanceSegmentTag)}
      className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2 py-1.5 text-xs cursor-pointer')}
    >
      {SEGMENT_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
    <button type="button" onClick={onReset} className={cn(buttonStyles.base, buttonStyles.secondary, 'px-2 py-1.5 text-xs')}>
      <RotateCcw size={14} className="mr-1" />重置
    </button>
    <button type="button" onClick={onOpenAdvanced} className={cn(buttonStyles.base, buttonStyles.primary, 'px-2 py-1.5 text-xs')}>
      <SlidersHorizontal size={14} className="mr-1" />筛选
      {activeFilterCount > 0 && (
        <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px]">
          {activeFilterCount}
        </span>
      )}
    </button>
  </div>
);
