import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react';

export type PopoverPlacement = 'right' | 'left' | 'right-top' | 'left-top';

interface PopoverPositionResult {
  style: CSSProperties;
  placement: PopoverPlacement;
  arrowStyle: CSSProperties;
}

const POPOVER_GAP = 8;
const POPOVER_WIDTH = 224; // w-56
const POPOVER_MAX_HEIGHT = 320;

const HIDDEN_STYLE: PopoverPositionResult = {
  style: { position: 'fixed', opacity: 0, visibility: 'hidden', pointerEvents: 'none' },
  placement: 'right',
  arrowStyle: {},
};

/**
 * 计算 Popover 悬浮气泡的绝对定位。
 * 优先右下展开，溢出时四向翻转。
 * 自动监听 resize/scroll 重新定位。
 */
export function usePopoverPosition(
  triggerRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
): PopoverPositionResult {
  const [result, setResult] = useState<PopoverPositionResult>(HIDDEN_STYLE);

  const recalculate = useCallback(() => {
    if (!triggerRef.current) {
      setResult(HIDDEN_STYLE);
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Determine horizontal placement
    const fitsRight = rect.right + POPOVER_GAP + POPOVER_WIDTH < vw;
    const fitsLeft = rect.left - POPOVER_GAP - POPOVER_WIDTH > 0;
    const horizontal: 'right' | 'left' = fitsRight ? 'right' : fitsLeft ? 'left' : 'right';

    // Determine vertical placement
    const fitsBelow = rect.top + POPOVER_MAX_HEIGHT < vh;
    const vertical: '' | '-top' = fitsBelow ? '' : '-top';

    const placement: PopoverPlacement = `${horizontal}${vertical}` as PopoverPlacement;

    const left =
      horizontal === 'right'
        ? rect.right + POPOVER_GAP
        : rect.left - POPOVER_GAP - POPOVER_WIDTH;

    const top = vertical === '-top'
      ? Math.max(8, rect.bottom - POPOVER_MAX_HEIGHT)
      : rect.top;

    const arrowTop = rect.top + rect.height / 2 - top;

    setResult({
      style: {
        position: 'fixed',
        top,
        left,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT,
        zIndex: 50,
        opacity: 1,
        pointerEvents: 'auto',
      },
      placement,
      arrowStyle: {
        position: 'absolute',
        top: arrowTop,
        [horizontal === 'right' ? 'left' : 'right']: -6,
        width: 0,
        height: 0,
        borderTop: '6px solid transparent',
        borderBottom: '6px solid transparent',
        [horizontal === 'right' ? 'borderRight' : 'borderLeft']: '6px solid white',
      },
    });
  }, [triggerRef]);

  // Initial calculation + resize/scroll reposition
  useEffect(() => {
    if (!isOpen) {
      setResult(HIDDEN_STYLE);
      return;
    }

    recalculate();

    window.addEventListener('resize', recalculate);
    window.addEventListener('scroll', recalculate, true);
    return () => {
      window.removeEventListener('resize', recalculate);
      window.removeEventListener('scroll', recalculate, true);
    };
  }, [isOpen, recalculate]);

  return result;
}
