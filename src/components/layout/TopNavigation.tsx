/**
 * 顶部导航栏组件
 *
 * 功能：
 * - 项目名称展示（左侧）
 * - 设置下拉菜单（右侧）
 * - 文件下拉菜单（右侧）
 * - 集成设置面板和文件菜单弹窗
 */

import React, { useState, useRef, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  FolderOpen,
  Settings,
  Download,
  Upload,
  ClipboardList,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  Check,
  Car,
  Menu,
} from 'lucide-react';
import { useSidebar } from './SidebarLayout';
import { useTheme, type ThemeMode } from '../../shared/theme';
import { SettingsPanel } from '../../features/settings';
import { DataImportModal, ExportModal, ReportTemplatesModal } from '../../features/file';

interface DropdownItem {
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

const DropdownMenu: React.FC<DropdownMenuProps> = ({ icon: Icon, label, items }) => {
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
        className="flex items-center px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
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
          className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50"
          role="menu"
        >
          {items.map((item, index) => {
            const ItemIcon = item.icon;
            return (
              <React.Fragment key={index}>
                {item.divider && <div className="my-1 border-t border-gray-100 dark:border-gray-700" role="separator" />}
                <button
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center px-4 py-2 text-sm font-medium transition-colors ${item.active
                      ? 'text-primary bg-primary-bg dark:text-primary-light dark:bg-blue-900/20'
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

/**
 * 顶部导航栏组件
 */
export const TopNavigation: React.FC = () => {
  const { mode, setMode } = useTheme();
  const { setMobileOpen, isMobile } = useSidebar();

  // 弹窗状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);

  const handleThemeChange = (theme: ThemeMode) => {
    setMode(theme);
  };

  const fileMenuItems: DropdownItem[] = [
    { icon: Download, label: '导入数据', onClick: () => setIsImportOpen(true) },
    { icon: Upload, label: '导出数据', onClick: () => setIsExportOpen(true) },
    { icon: ClipboardList, label: '报表模板', onClick: () => setIsTemplatesOpen(true), divider: true },
  ];

  const settingsMenuItems: DropdownItem[] = [
    {
      icon: Sun,
      label: '浅色模式',
      onClick: () => handleThemeChange('light'),
      active: mode === 'light',
    },
    {
      icon: Moon,
      label: '深色模式',
      onClick: () => handleThemeChange('dark'),
      active: mode === 'dark',
    },
    {
      icon: Monitor,
      label: '随系统',
      onClick: () => handleThemeChange('system'),
      active: mode === 'system',
    },
    {
      icon: Settings,
      label: '更多设置',
      onClick: () => setIsSettingsOpen(true),
      divider: true,
    },
  ];

  return (
    <>
      <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-50">
        {/* 左侧：移动端菜单按钮 + 项目名称 */}
        <div className="flex items-center">
          {/* 移动端汉堡菜单按钮 */}
          {isMobile && (
            <button
              onClick={() => setMobileOpen(true)}
              className="mr-2 p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="打开导航菜单"
            >
              <Menu size={24} aria-hidden="true" />
            </button>
          )}
          <Car size={24} className="text-primary mr-2" aria-hidden="true" />
          <h1 className="text-lg font-semibold tracking-tight text-neutral-800 dark:text-white hidden sm:block">车险经营管理系统</h1>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-800 dark:text-white sm:hidden">车险系统</h1>
          <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-primary bg-primary-bg dark:text-primary-light dark:bg-blue-900/30 rounded-full">
            v2.0
          </span>
        </div>

        {/* 右侧：菜单 */}
        <nav className="flex items-center space-x-1" aria-label="主菜单">
          <DropdownMenu icon={FolderOpen} label="文件" items={fileMenuItems} />
          <DropdownMenu icon={Settings} label="设置" items={settingsMenuItems} />
        </nav>
      </header>

      {/* 设置面板 */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* 导入弹窗 */}
      <DataImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />

      {/* 导出弹窗 */}
      <ExportModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} />

      {/* 报表模板弹窗 */}
      <ReportTemplatesModal isOpen={isTemplatesOpen} onClose={() => setIsTemplatesOpen(false)} />
    </>
  );
};
