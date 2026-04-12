import { useCallback, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';

interface UseSidebarResizeOptions {
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  setIsDragging: (dragging: boolean) => void;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * 侧边栏拖拽调整宽度 hook
 *
 * 处理 mousedown → mousemove → mouseup 生命周期，
 * 拖拽期间禁用文本选择并切换 cursor。
 * 使用 ref 存储 sidebarWidth 确保 handleMouseDown 引用稳定，
 * 避免拖拽期间高频 state 更新导致 callback 重建。
 */
export function useSidebarResize({
  sidebarWidth,
  setSidebarWidth,
  setIsDragging,
  minWidth = 200,
  maxWidth = 400,
}: UseSidebarResizeOptions) {
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      (document.body.style as any).webkitUserSelect = '';
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
  }, [setSidebarWidth, setIsDragging, minWidth, maxWidth]);

  return { handleMouseDown };
}
