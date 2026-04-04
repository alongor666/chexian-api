import React from 'react';
import { cn, colorClasses } from '../styles';

interface PageWithRightFilterProps {
  /** 主内容区域 */
  children: React.ReactNode;
  /** 筛选器组件 */
  filterPanel: React.ReactNode;
  /** 筛选器是否折叠 */
  isFilterCollapsed: boolean;
  /** 折叠状态切换回调 */
  onToggleCollapse: () => void;
  /** 筛选器宽度（展开时），默认 320px */
  filterWidth?: number;
}

/**
 * 右侧筛选器布局组件
 *
 * 将筛选器放置在页面右侧，主内容在左侧
 * 筛选器可折叠，折叠时只显示一个展开按钮
 */
export const PageWithRightFilter: React.FC<PageWithRightFilterProps> = ({
  children,
  filterPanel,
  isFilterCollapsed,
  onToggleCollapse,
  filterWidth = 320,
}) => {
  return (
    <div className="flex h-full">
      {/* 主内容区域 */}
      <div className="flex-1 overflow-auto p-4">
        {children}
      </div>

      {/* 右侧筛选器面板 */}
      <div
        className={cn(
          'flex-shrink-0 border-l transition-all duration-300',
          colorClasses.border.neutral,
          colorClasses.bg.neutral,
          isFilterCollapsed ? 'w-12' : ''
        )}
        style={{ width: isFilterCollapsed ? undefined : filterWidth }}
      >
        {isFilterCollapsed ? (
          /* 折叠状态：显示展开按钮 */
          <div className="h-full flex flex-col items-center pt-4">
            <button
              onClick={onToggleCollapse}
              className={cn('p-2 rounded-lg bg-white dark:bg-neutral-800 shadow-sm border transition-colors', colorClasses.border.neutral, colorClasses.bg.neutralLight)}
              title="展开筛选器"
            >
              <svg
                className={`w-5 h-5 ${colorClasses.text.neutral}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            </button>
            <span
              className={`mt-2 text-xs writing-mode-vertical ${colorClasses.text.neutralLight}`}
              style={{ writingMode: 'vertical-rl' }}
            >
              筛选条件
            </span>
          </div>
        ) : (
          /* 展开状态：显示筛选器内容 */
          <div className="h-full overflow-auto">
            {/* 折叠按钮 */}
            <div className={cn('sticky top-0 p-2 border-b flex justify-end z-10', colorClasses.bg.neutral, colorClasses.border.neutral)}>
              <button
                onClick={onToggleCollapse}
                className={cn('p-1.5 rounded transition-colors', colorClasses.text.neutralLight, colorClasses.bg.neutralLight)}
                title="折叠筛选器"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            {/* 筛选器内容 */}
            <div className="p-3">
              {filterPanel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
