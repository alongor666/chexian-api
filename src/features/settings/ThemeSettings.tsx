/**
 * 主题设置组件
 *
 * 提供主题切换功能：
 * - 浅色模式
 * - 深色模式
 * - 随系统
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../shared/theme';
import { colorClasses } from '../../shared/styles';

interface ThemeOption {
  mode: ThemeMode;
  label: string;
  icon: LucideIcon;
  description: string;
}

const themeOptions: ThemeOption[] = [
  {
    mode: 'light',
    label: '浅色模式',
    icon: Sun,
    description: '明亮的界面，适合白天使用',
  },
  {
    mode: 'dark',
    label: '深色模式',
    icon: Moon,
    description: '暗色界面，减少眼睛疲劳',
  },
  {
    mode: 'system',
    label: '随系统',
    icon: Monitor,
    description: '跟随操作系统的主题设置',
  },
];

/**
 * 主题设置组件
 */
export const ThemeSettings: React.FC = () => {
  const { mode, resolvedTheme, setMode } = useTheme();

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h3 className={`text-base font-semibold ${colorClasses.text.neutralBlack} dark:text-white`}>外观设置</h3>
        <p className={`mt-1 text-sm ${colorClasses.text.neutralMuted}`}>
          选择您喜欢的界面主题
        </p>
      </div>

      {/* 主题选项 */}
      <div className="space-y-3" role="radiogroup" aria-label="选择主题">
        {themeOptions.map((option) => {
          const OptionIcon = option.icon;
          return (
            <button
              key={option.mode}
              onClick={() => setMode(option.mode)}
              className={`w-full flex items-center p-4 rounded-lg border-2 transition-all ${
                mode === option.mode
                  ? `border-blue-500 ${colorClasses.bg.primary} dark:bg-blue-900/20`
                  : `${colorClasses.border.neutral} hover:border-neutral-300 dark:hover:border-neutral-600`
              }`}
              role="radio"
              aria-checked={mode === option.mode}
            >
              <OptionIcon size={24} className={`mr-4 ${colorClasses.text.neutral}`} aria-hidden="true" />
              <div className="flex-1 text-left">
                <div className="flex items-center">
                  <span className={`font-medium ${colorClasses.text.neutralBlack} dark:text-white`}>
                    {option.label}
                  </span>
                  {mode === option.mode && (
                    <span className={`ml-2 text-xs px-2 py-0.5 ${colorClasses.bg.primary} dark:bg-blue-800 ${colorClasses.text.primary} dark:text-blue-200 rounded-full`}>
                      当前
                    </span>
                  )}
                </div>
                <p className={`text-sm ${colorClasses.text.neutralMuted} mt-0.5`}>
                  {option.description}
                </p>
              </div>
              {mode === option.mode && (
                <Check size={20} className={colorClasses.text.primary} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {/* 当前状态提示 */}
      <div className={`p-4 ${colorClasses.bg.neutral} dark:bg-neutral-800 rounded-lg`}>
        <div className="flex items-center">
          {resolvedTheme === 'dark' ? (
            <Moon size={18} className={`mr-2 ${colorClasses.text.neutral}`} aria-hidden="true" />
          ) : (
            <Sun size={18} className={`mr-2 ${colorClasses.text.warning}`} aria-hidden="true" />
          )}
          <span className={`text-sm ${colorClasses.text.neutral} dark:text-neutral-300`}>
            当前应用主题：<strong>{resolvedTheme === 'dark' ? '深色' : '浅色'}</strong>
            {mode === 'system' && ' (跟随系统)'}
          </span>
        </div>
      </div>

      {/* 提示信息 */}
      <div className={`p-3 ${colorClasses.bg.primary} dark:bg-blue-900/20 border ${colorClasses.border.primary} dark:border-blue-800 rounded-lg`}>
        <p className={`text-xs ${colorClasses.text.primary} dark:text-blue-300`}>
          <span className="font-semibold">提示：</span>
          深色模式可以在低光环境下减少眼睛疲劳，并节省OLED屏幕的电量。
        </p>
      </div>
    </div>
  );
};
