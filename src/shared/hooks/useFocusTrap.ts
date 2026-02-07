/**
 * 焦点陷阱 Hook
 *
 * 用于模态框等组件，将键盘焦点限制在组件内部
 */

import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface UseFocusTrapOptions {
  /** 是否启用焦点陷阱 */
  enabled?: boolean;
  /** 初始焦点元素选择器 */
  initialFocusSelector?: string;
  /** 是否在关闭时恢复焦点 */
  restoreFocus?: boolean;
}

/**
 * 焦点陷阱 Hook
 *
 * @param options - 配置选项
 * @returns ref - 需要绑定到容器元素的 ref
 *
 * @example
 * ```tsx
 * const Modal = ({ isOpen, onClose }) => {
 *   const containerRef = useFocusTrap({ enabled: isOpen });
 *
 *   return (
 *     <div ref={containerRef} role="dialog" aria-modal="true">
 *       <button onClick={onClose}>关闭</button>
 *       <input type="text" />
 *     </div>
 *   );
 * };
 * ```
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  options: UseFocusTrapOptions = {}
) {
  const { enabled = true, initialFocusSelector, restoreFocus = true } = options;

  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // 获取所有可聚焦元素
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );
  }, []);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Shift + Tab：向后移动
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
      // Tab：向前移动
      else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [enabled, getFocusableElements]
  );

  // 设置初始焦点
  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    // 保存当前焦点
    previousFocusRef.current = document.activeElement;

    // 设置初始焦点
    const focusTarget = initialFocusSelector
      ? containerRef.current.querySelector<HTMLElement>(initialFocusSelector)
      : getFocusableElements()[0];

    if (focusTarget) {
      // 延迟以确保DOM已更新
      requestAnimationFrame(() => {
        focusTarget.focus();
      });
    }

    // 添加键盘事件监听
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      // 恢复焦点
      if (restoreFocus && previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [enabled, initialFocusSelector, restoreFocus, getFocusableElements, handleKeyDown]);

  return containerRef;
}

/**
 * 键盘导航 Hook
 *
 * 用于列表、菜单等组件的方向键导航
 */
interface UseKeyboardNavigationOptions {
  /** 选项数量 */
  itemCount: number;
  /** 当前选中索引 */
  selectedIndex: number;
  /** 选中回调 */
  onSelect: (index: number) => void;
  /** 是否循环 */
  loop?: boolean;
  /** 是否支持水平导航 */
  horizontal?: boolean;
}

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
  const { itemCount, selectedIndex, onSelect, loop = true, horizontal = false } = options;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      let newIndex = selectedIndex;
      const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
      const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';

      switch (event.key) {
        case prevKey:
          event.preventDefault();
          if (selectedIndex > 0) {
            newIndex = selectedIndex - 1;
          } else if (loop) {
            newIndex = itemCount - 1;
          }
          break;
        case nextKey:
          event.preventDefault();
          if (selectedIndex < itemCount - 1) {
            newIndex = selectedIndex + 1;
          } else if (loop) {
            newIndex = 0;
          }
          break;
        case 'Home':
          event.preventDefault();
          newIndex = 0;
          break;
        case 'End':
          event.preventDefault();
          newIndex = itemCount - 1;
          break;
        default:
          return;
      }

      if (newIndex !== selectedIndex) {
        onSelect(newIndex);
      }
    },
    [selectedIndex, itemCount, onSelect, loop, horizontal]
  );

  return { onKeyDown: handleKeyDown };
}
