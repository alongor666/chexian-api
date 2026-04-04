import React, { useEffect, useMemo, useState } from 'react';
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

export const DashboardAnchorNav: React.FC<DashboardAnchorNavProps> = ({
  sections,
  containerId,
  title = '页面导航',
  scrollOffset = 96,
}) => {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');

  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);

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

  if (sections.length === 0) return null;

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

      // Write scrollTop first to guarantee anchor jumps in nested overflow containers.
      // Then re-issue smooth scroll so supported browsers still get a softer transition.
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
  };

  return (
    <aside className="sticky top-4">
      <div className={cn(cardStyles.standard, 'space-y-3')}>
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', colorClasses.bg.primarySolid)} />
          <h3 className={textStyles.titleSmall}>{title}</h3>
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
    </aside>
  );
};

export default DashboardAnchorNav;
