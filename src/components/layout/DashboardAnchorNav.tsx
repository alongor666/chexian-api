import React, { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * 页面锚点导航（浮动球形态）
 *
 * 右上角浮动球，点击展开导航面板。
 * 不占据页面布局宽度。
 */
export const DashboardAnchorNav: React.FC<DashboardAnchorNavProps> = ({
  sections,
  containerId,
  title = '页面导航',
  scrollOffset = 96,
}) => {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);

  // IntersectionObserver 跟踪当前可见 section
  useEffect(() => {
    if (sectionIds.length === 0) return;

    const root = containerId ? document.getElementById(containerId) : null;
    const targets = sectionIds
      .map((id) => document.getElementById(id))
      .filter((target): target is HTMLElement => Boolean(target));

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root,
        threshold: [0.2, 0.45, 0.7],
        rootMargin: '-18% 0px -55% 0px',
      }
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [containerId, sectionIds]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

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
      const nextTop = root.scrollTop + targetRect.top - rootRect.top - offset;
      const resolvedTop = Math.max(0, nextTop);

      root.scrollTop = resolvedTop;
      root.scrollTo({
        top: resolvedTop,
        behavior: 'smooth',
      });
    } else {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      window.scrollBy({ top: -offset, behavior: 'smooth' });
    }

    setActiveId(section.id);
    setIsOpen(false);
  };

  return (
    <div ref={panelRef} className="absolute top-4 right-4 z-20 print:hidden">
      {/* 展开面板 */}
      {isOpen && (
        <div className={cn(cardStyles.standard, 'w-56 space-y-3 shadow-lg')}>
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
          onClick={() => setIsOpen(true)}
          className={cn(
            'flex items-center gap-2 rounded-full px-3 py-2',
            'bg-white dark:bg-neutral-800 shadow-md',
            'border border-neutral-200 dark:border-neutral-700',
            'text-neutral-600 dark:text-neutral-300',
            'hover:shadow-lg hover:scale-105 active:scale-95',
            'transition-all duration-200'
          )}
          aria-label="打开页面导航"
          title="页面导航"
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
