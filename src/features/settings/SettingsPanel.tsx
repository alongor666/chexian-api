/**
 * 设置面板组件
 *
 * 从右侧滑入的设置面板，包含：
 * - 主题设置
 * - 系统设置
 */

import React, { useEffect } from 'react';
import { Settings, X } from 'lucide-react';
import { SystemSettings } from './SystemSettings';
import { useFocusTrap } from '../../shared/hooks';
import { colorClasses } from '../../shared/styles';

interface SettingsPanelProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 设置面板
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
}) => {
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

        {/* 内容区 */}
        <div
          className="flex-1 overflow-y-auto p-4"
          style={{ height: 'calc(100vh - 72px)' }}
        >
          <SystemSettings />
        </div>
      </div>
    </>
  );
};
