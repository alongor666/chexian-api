import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, X } from 'lucide-react';
import { cardStyles, colorClasses, textStyles, cn } from '../../shared/styles';

export interface DashboardAnchorSection {
  id: string;
  label: string;
  shortLabel?: string;
  offsetTop?: number;
}

interface DashboardAnchorNavProps {
  sections: DashboardAnchorSection[];
  containerId?: string;
  title?: string;
  scrollOffset?: number;
}

const POSITION_STORAGE_KEY = 'anchor-nav-position';

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.x === 'number' && typeof pos.y === 'number') return pos;
  } catch { /* ignore */ }
  return null;
}

function savePosition(x: number, y: number) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ x, y }));
  } catch { /* ignore */ }
}

function clampToViewport(x: number, y: number, elWidth = 80, elHeight = 36) {
  return {
    x: Math.min(Math.max(0, x), window.innerWidth - elWidth),
    y: Math.min(Math.max(0, y), window.innerHeight - elHeight),
  };
}

/**
 * 页面锚点导航（浮动球形态，可拖拽）
 *
 * 右上角浮动球，点击展开导航面板。
 * 长按/拖拽可移动到任意位置，位置持久化到 localStorage。
 */
export const DashboardAnchorNav: React.FC<DashboardAnchorNavProps> = ({
  sections,
  containerId,
  title = '页面导航',
  scrollOffset = 96,
}) => {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef({ active: false, moved: false, mouseX: 0, mouseY: 0, elX: 0, elY: 0 });

  // 初始化：读取 localStorage
  useEffect(() => {
    const saved = loadSavedPosition();
    if (saved) {
      setPosition(clampToViewport(saved.x, saved.y));
    }
  }, []);

  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  // IntersectionObserver
  useEffect(() => {
    if (sectionIds.length === 0) return;
    const root = containerId ? document.getElementById(containerId) : null;
    const targets = sectionIds
      .map((id) => document.getElementById(id))
      .filter((t): t is HTMLElement => Boolean(t));
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveId(visible[0].target.id);
      },
      { root, threshold: [0.2, 0.45, 0.7], rootMargin: '-18% 0px -55% 0px' }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [containerId, sectionIds]);

  // 点击外部关闭面板
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ─── 拖拽：全部通过 document 级事件处理 ───
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isOpen) return;
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = {
      active: true,
      moved: false,
      mouseX: e.clientX,
      mouseY: e.clientY,
      elX: rect.left,
      elY: rect.top,
    };
    // 在 document 上监听后续事件，确保拖出元素也能跟踪
    document.addEventListener('pointermove', onDocPointerMove);
    document.addEventListener('pointerup', onDocPointerUp);
    e.preventDefault();
  }, [isOpen]);

  const onDocPointerMove = useCallback((e: PointerEvent) => {
    const ds = dragState.current;
    if (!ds.active) return;
    const dx = e.clientX - ds.mouseX;
    const dy = e.clientY - ds.mouseY;
    if (!ds.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    ds.moved = true;
    setDragging(true);
    setPosition(clampToViewport(ds.elX + dx, ds.elY + dy));
  }, []);

  const onDocPointerUp = useCallback(() => {
    const ds = dragState.current;
    ds.active = false;
    document.removeEventListener('pointermove', onDocPointerMove);
    document.removeEventListener('pointerup', onDocPointerUp);
    if (ds.moved) {
      // 保存最终位置
      const el = wrapperRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        savePosition(rect.left, rect.top);
      }
      // 延迟重置，防止 pointerup 触发 click → 展开面板
      requestAnimationFrame(() => setDragging(false));
    }
  }, [onDocPointerMove]);

  const handleBallClick = useCallback(() => {
    if (dragState.current.moved) return;
    setIsOpen(true);
  }, []);

  if (sections.length === 0) return null;

  const activeIndex = sectionIds.indexOf(activeId);

  const handleScrollToSection = (section: DashboardAnchorSection) => {
    const target = document.getElementById(section.id);
    if (!target) return;
    const root = containerId ? document.getElementById(containerId) : null;
    const offset = section.offsetTop ?? scrollOffset;

    if (root instanceof HTMLElement) {
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const resolvedTop = Math.max(0, root.scrollTop + targetRect.top - rootRect.top - offset);
      root.scrollTo({ top: resolvedTop, behavior: 'smooth' });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.scrollBy({ top: -offset, behavior: 'smooth' });
    }
    setActiveId(section.id);
    setIsOpen(false);
  };

  const isFixed = position !== null;
  const wrapperStyle: React.CSSProperties = isFixed
    ? { left: position.x, top: position.y }
    : {};

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'z-20 print:hidden select-none',
        isFixed ? 'fixed' : 'absolute top-4 right-4'
      )}
      style={wrapperStyle}
      onPointerDown={handlePointerDown}
    >
      {/* 展开面板 */}
      {isOpen && (
        <div ref={panelRef} className={cn(cardStyles.standard, 'w-56 space-y-3 shadow-lg')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', colorClasses.bg.primarySolid)} />
              <h3 className={textStyles.titleSmall}>{title}</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              aria-label="关闭导航"
            >
              <X size={14} />
            </button>
          </div>
          <nav aria-label={title}>
            <ol className="space-y-1.5">
              {sections.map((section, index) => {
                const isActive = activeId === section.id;
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => handleScrollToSection(section)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-primary-bg text-primary-dark border border-primary-border'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100'
                      )}
                      aria-current={isActive ? 'location' : undefined}
                    >
                      <span
                        className={cn(
                          'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                          isActive
                            ? 'bg-white dark:bg-neutral-700 text-primary'
                            : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="leading-tight">{section.shortLabel ?? section.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      )}

      {/* 浮动球 — 收起时显示 */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleBallClick}
          className={cn(
            'flex items-center gap-2 rounded-full px-3 py-2',
            'bg-white dark:bg-neutral-800 shadow-md',
            'border border-neutral-200 dark:border-neutral-700',
            'text-neutral-600 dark:text-neutral-300',
            'hover:shadow-lg',
            'transition-shadow duration-200',
            dragging ? 'cursor-grabbing scale-105 shadow-lg' : 'cursor-grab'
          )}
          aria-label="打开页面导航（可拖拽移动）"
          title="拖拽移动 · 点击展开导航"
        >
          <List size={16} className="text-primary" />
          <span className="text-xs font-medium">
            {activeIndex >= 0 ? `${activeIndex + 1}/${sections.length}` : title}
          </span>
        </button>
      )}
    </div>
  );
};

export default DashboardAnchorNav;
