/**
 * 设置面板组件
 *
 * 从右侧滑入的设置面板，包含：
 * - 主题设置
 * - 系统设置
 */

import React, { useState, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Palette, Settings, X } from 'lucide-react';
import { ThemeSettings } from './ThemeSettings';
import { SystemSettings } from './SystemSettings';
import { useFocusTrap } from '../../shared/hooks';
import { colorClasses } from '../../shared/styles';

interface SettingsPanelProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 初始标签 */
  initialTab?: 'theme' | 'system';
}

type SettingsTab = 'theme' | 'system';

/**
 * 设置面板
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  initialTab = 'theme',
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const panelRef = useFocusTrap<HTMLDivElement>({ enabled: isOpen });

  // 处理 Escape 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs: { key: SettingsTab; label: string; icon: LucideIcon }[] = [
    { key: 'theme', label: '外观', icon: Palette },
    { key: 'system', label: '系统', icon: Settings },
  ];

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* 侧边面板 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
        className={`fixed right-0 top-0 h-full w-full sm:w-[400px] bg-white dark:bg-neutral-900 shadow-2xl z-50 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 头部 */}
        <header className={`flex items-center justify-between p-4 border-b ${colorClasses.border.neutral}`}>
          <h2 id="settings-panel-title" className={`text-lg font-semibold ${colorClasses.text.neutralBlack} dark:text-white flex items-center`}>
            <Settings size={20} className={`mr-2 ${colorClasses.text.neutral}`} aria-hidden="true" />
            设置
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors"
            aria-label="关闭设置面板"
          >
            <X size={20} className={colorClasses.text.neutralMuted} aria-hidden="true" />
          </button>
        </header>

        {/* 标签切换 */}
        <nav className={`flex border-b ${colorClasses.border.neutral}`} role="tablist" aria-label="设置选项卡">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                id={`tab-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  activeTab === tab.key
                    ? `${colorClasses.text.primary} border-b-2 border-blue-600 ${colorClasses.bg.primary} dark:bg-blue-900/20`
                    : `${colorClasses.text.neutral} hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800`
                }`}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`tabpanel-${tab.key}`}
                tabIndex={activeTab === tab.key ? 0 : -1}
              >
                <TabIcon size={16} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* 内容区 */}
        <div
          id={`tabpanel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="flex-1 overflow-y-auto p-4"
          style={{ height: 'calc(100vh - 120px)' }}
          tabIndex={0}
        >
          {activeTab === 'theme' && <ThemeSettings />}
          {activeTab === 'system' && <SystemSettings />}
        </div>
      </div>
    </>
  );
};
