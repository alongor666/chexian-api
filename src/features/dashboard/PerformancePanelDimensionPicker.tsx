// 从 PerformanceAnalysisPanel.tsx 抽出（b331 拆分·行为零变更）。
import { cardStyles, cn, colorClasses, textStyles } from '@/shared/styles';
import { PERFORMANCE_DIMENSION_LABELS, type PerformanceDimension } from './hooks/usePerformanceDrilldown';

export function DimensionPicker({
  available,
  onSelect,
  onCancel,
  title,
}: {
  available: PerformanceDimension[];
  onSelect: (dim: PerformanceDimension) => void;
  onCancel: () => void;
  title: string;
}) {
  if (available.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={onCancel}>
      <div
        className={cn(cardStyles.spacious, 'min-w-[320px] max-w-[90vw]')}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className={cn(textStyles.titleSmall, 'mb-4')}>{title}</h3>
        <div className="grid grid-cols-2 gap-2">
          {available.map((dim) => (
            <button
              key={dim}
              onClick={() => onSelect(dim)}
              className={cn(
                'px-3 py-2 rounded-lg border text-left transition-colors',
                colorClasses.border.neutral,
                colorClasses.text.neutralDark,
                'hover:bg-neutral-50'
              )}
            >
              {PERFORMANCE_DIMENSION_LABELS[dim]}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className={cn('mt-4 w-full px-3 py-2 rounded-lg border transition-colors', colorClasses.border.neutral)}
        >
          取消
        </button>
      </div>
    </div>
  );
}
