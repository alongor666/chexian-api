import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn, colorClasses } from '@/shared/styles';

export interface DrilldownLoadingOverlayProps {
  /** 是否显示加载遮罩 */
  loading: boolean;
  /** 包裹的表格/内容区域 */
  children: React.ReactNode;
  /** 额外 className */
  className?: string;
}

/**
 * 下钻加载遮罩 — 包裹表格区域，加载时叠加半透明白色 + 居中 spinner。
 * 原表格保持不动，避免 Visual Jump。
 */
export const DrilldownLoadingOverlay: React.FC<DrilldownLoadingOverlayProps> = ({
  loading,
  children,
  className,
}) => {
  return (
    <div className={cn('relative', className)}>
      {children}

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-neutral-800/60 rounded-lg transition-opacity duration-200">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className={cn('h-6 w-6 animate-spin', colorClasses.text.primary)} />
            <span className={cn('text-xs', colorClasses.text.neutralMuted)}>数据加载中...</span>
          </div>
        </div>
      )}
    </div>
  );
};
