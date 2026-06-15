import React from 'react';
import { getStorageBoolean, setStorageBoolean } from '../../utils/storage';

interface CollapsibleFilterSectionProps {
  id: string;
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

const getStorageKey = (id: string) => `filter-section:${id}`;

export const CollapsibleFilterSection: React.FC<CollapsibleFilterSectionProps> = ({
  id,
  title,
  defaultExpanded = false,
  children,
}) => {
  const storageKey = React.useMemo(() => getStorageKey(id), [id]);
  const [isOpen, setIsOpen] = React.useState(defaultExpanded);

  // 从安全存储加载折叠状态
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    // getStorageBoolean 返回默认值时表示没有存储值
    const stored = getStorageBoolean(storageKey, defaultExpanded);
    setIsOpen(stored);
  }, [storageKey, defaultExpanded]);

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      setStorageBoolean(storageKey, next);
      return next;
    });
  };

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
        aria-expanded={isOpen}
        aria-controls={`${id}-content`}
      >
        <span>{title}</span>
        <svg
          className={`h-4 w-4 text-neutral-400 dark:text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isOpen && (
        <div id={`${id}-content`} className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  );
};
