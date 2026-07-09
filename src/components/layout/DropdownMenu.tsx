/**
 * 顶栏通用下拉菜单原语（layout 层复用组件）
 *
 * 从 TopNavigation 抽出，供顶栏内多处复用（省份切换菜单 / 文件菜单）。
 * 纯 UI，无业务依赖——业务侧（如 features/file 的文件菜单）按 features → layout
 * 的正确依赖方向引用本组件。
 */

import React, { useState, useRef, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownItem {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  divider?: boolean;
  active?: boolean;
}

interface DropdownMenuProps {
  icon: LucideIcon;
  label: string;
  items: DropdownItem[];
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({ icon: Icon, label, items }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center px-3 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <Icon size={18} aria-hidden="true" />
        <span className="ml-1.5 text-sm font-medium tracking-tight">{label}</span>
        <ChevronDown
          size={16}
          className={`ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-1 z-50"
          role="menu"
        >
          {items.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <React.Fragment key={index}>
                {item.divider && <div className="my-1 border-t border-neutral-100 dark:border-neutral-700" role="separator" />}
                <button
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center px-4 py-2 text-sm font-medium transition-colors ${item.active
                      ? 'text-primary bg-primary-bg'
                      : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                    }`}
                  role="menuitem"
                >
                  <ItemIcon size={16} className="mr-3" aria-hidden="true" />
                  {item.label}
                  {item.active && <Check size={14} className="ml-auto text-primary" aria-hidden="true" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};
