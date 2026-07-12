/**
 * 顶部导航栏组件
 *
 * 功能：
 * - 项目名称展示（左侧）
 * - 省份切换（全国超管）+ 主题切换（右侧）
 * - 文件菜单以 slot（`fileMenu`）形式由上层注入，顶栏本身不 import features
 *   （B330 依赖倒置修复：components/layout ↛ features）
 */

import React from 'react';
import { Sun, Moon, Car, Menu, MapPin } from 'lucide-react';
import { DropdownMenu, type DropdownItem } from './DropdownMenu';
import { useSidebar } from './SidebarLayout';
import { useTheme } from '../../shared/theme';
import { useBranch, branchLabel } from '../../shared/contexts/BranchContext';
import { PRODUCT_METADATA } from '../../shared/config/productMetadata';

interface TopNavigationProps {
  /** 文件菜单 slot：由 App.tsx 注入 `<FileMenu />`，避免顶栏反向依赖 features/file */
  fileMenu?: React.ReactNode;
}

/**
 * 顶部导航栏组件
 */
export const TopNavigation: React.FC<TopNavigationProps> = ({ fileMenu }) => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { setMobileOpen, isMobile } = useSidebar();

  // 全国超管「切省 + 全国合并」下拉（仅 visibleBranches.length > 1 时显示）。
  // 选项 = [全国, ...各可见省]；省份枚举数据驱动来自 visibleBranches（禁硬编码省份）。
  const { branches, isMultiBranch, currentBranch, setBranch } = useBranch();
  const branchMenuItems: DropdownItem[] = isMultiBranch
    ? [
        { icon: MapPin, label: '全国', onClick: () => setBranch('ALL'), active: currentBranch === 'ALL', divider: true },
        ...branches.map((code) => ({
          icon: MapPin,
          label: branchLabel(code),
          onClick: () => setBranch(code),
          active: currentBranch === code,
        })),
      ]
    : [];

  return (
    <header className="h-14 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-50 opacity-30 hover:opacity-100 transition-opacity duration-300">
      {/* 左侧：移动端菜单按钮 + 项目名称 */}
      <div className="flex items-center">
        {/* 移动端汉堡菜单按钮 */}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(true)}
            className="mr-2 p-2 rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="打开导航菜单"
          >
            <Menu size={24} aria-hidden="true" />
          </button>
        )}
        <Car size={24} className="text-primary mr-2" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight text-neutral-800 dark:text-white hidden sm:block">{PRODUCT_METADATA.productName}</h1>
        <h1 className="text-lg font-semibold tracking-tight text-neutral-800 dark:text-white sm:hidden">{PRODUCT_METADATA.mobileName}</h1>
        <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-primary bg-primary-bg rounded-full">
          v2.0
        </span>
      </div>

      {/* 右侧：省份切换（仅全国超管）+ 主题切换 + 文件菜单（slot 注入） */}
      <nav className="flex items-center space-x-1" aria-label="主菜单">
        {isMultiBranch && (
          <DropdownMenu
            icon={MapPin}
            label={branchLabel(currentBranch ?? branches[0])}
            items={branchMenuItems}
          />
        )}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-colors"
          aria-label={resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {fileMenu}
      </nav>
    </header>
  );
};
