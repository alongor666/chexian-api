import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopoverPosition } from '@/shared/hooks/usePopoverPosition';
import { cn, colorClasses } from '@/shared/styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DrilldownCellProps {
  /** 显示文本（如"天府"） */
  label: string;
  /** 可选的下钻维度 key 列表（空 = 穷尽，渲染普通文本） */
  availableDimensions: string[];
  /** key → 中文名映射 */
  dimensionLabels: Record<string, string>;
  /** 选择维度后回调 */
  onSelect: (dimension: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 仅1个维度时自动钻取（默认 true） */
  autoOnSingle?: boolean;
  /** 条件维度列表（用琥珀色胶囊标记） */
  conditionalDimensions?: string[];
  /** 额外 className */
  className?: string;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// 下钻超链接样式：使用设计系统 primary 色 + underline 装饰
// underline/decoration 无对应 colorClasses token，以常量集中管理

const DRILLABLE_CLASS = [
  colorClasses.text.primary,
  'underline decoration-primary-border cursor-pointer',
  'hover:text-primary-dark hover:decoration-primary-dark transition-colors',
].join(' ');

const EXHAUSTED_CLASS = colorClasses.text.neutralDark;

const PILL_BASE =
  'inline-flex items-center rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors select-none';

const PILL_NORMAL = [
  colorClasses.border.neutral,
  colorClasses.text.neutralDark,
  'hover:bg-primary-bg hover:border-primary-border',
].join(' ');

const PILL_CONDITIONAL = [
  colorClasses.border.warning,
  'bg-warning-bg text-warning-dark',
  'hover:bg-yellow-100 hover:border-warning',
].join(' ');

// ─── Popover (internal) ─────────────────────────────────────────────────────

interface InlinePopoverProps {
  label: string;
  dimensions: string[];
  dimensionLabels: Record<string, string>;
  conditionalDimensions: string[];
  onSelect: (dim: string) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

function InlinePopover({
  label,
  dimensions,
  dimensionLabels,
  conditionalDimensions,
  onSelect,
  onClose,
  triggerRef,
}: InlinePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const { style, arrowStyle } = usePopoverPosition(triggerRef, true);

  const conditionalSet = useMemo(
    () => new Set(conditionalDimensions),
    [conditionalDimensions],
  );

  // Click outside → close
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose, triggerRef]);

  // Esc → close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className={cn(
        'overflow-auto rounded-xl bg-white shadow-lg ring-1 ring-black/5',
        'animate-in fade-in-0 zoom-in-95 duration-150',
      )}
    >
      {/* Arrow */}
      <div style={arrowStyle} />

      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <p className={cn('text-xs', colorClasses.text.neutralMuted)}>
          以{' '}
          <span className={cn('font-medium', colorClasses.text.primary)}>[{label}]</span>{' '}
          为基准，继续下钻至：
        </p>
      </div>

      {/* Dimension pills */}
      <div className="flex flex-wrap gap-2 px-3 pb-3">
        {dimensions.map((dim) => {
          const isConditional = conditionalSet.has(dim);
          return (
            <button
              key={dim}
              type="button"
              className={cn(PILL_BASE, isConditional ? PILL_CONDITIONAL : PILL_NORMAL)}
              onClick={() => onSelect(dim)}
            >
              {dimensionLabels[dim] ?? dim}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export const DrilldownCell: React.FC<DrilldownCellProps> = ({
  label,
  availableDimensions,
  dimensionLabels,
  onSelect,
  onCancel,
  autoOnSingle = true,
  conditionalDimensions = [],
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const canDrill = availableDimensions.length > 0;
  const isSingleDim = availableDimensions.length === 1;

  const handleClick = useCallback(() => {
    if (!canDrill) return;

    // Single dimension + auto mode → drill directly
    if (isSingleDim && autoOnSingle) {
      onSelect(availableDimensions[0]);
      return;
    }

    setIsOpen((prev) => !prev);
  }, [canDrill, isSingleDim, autoOnSingle, availableDimensions, onSelect]);

  const handleSelect = useCallback(
    (dim: string) => {
      setIsOpen(false);
      onSelect(dim);
    },
    [onSelect],
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
    onCancel?.();
  }, [onCancel]);

  // Exhausted → plain text
  if (!canDrill) {
    return <span className={cn(EXHAUSTED_CLASS, className)}>{label}</span>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(DRILLABLE_CLASS, isOpen && 'text-primary-dark', className)}
        onClick={handleClick}
      >
        {label}
      </button>

      {isOpen && (
        <InlinePopover
          label={label}
          dimensions={availableDimensions}
          dimensionLabels={dimensionLabels}
          conditionalDimensions={conditionalDimensions}
          onSelect={handleSelect}
          onClose={handleClose}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
};
