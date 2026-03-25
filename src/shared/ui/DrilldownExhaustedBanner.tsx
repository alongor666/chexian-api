import React from 'react';
import { Info } from 'lucide-react';
import { cn, colorClasses } from '@/shared/styles';

export interface DrilldownExhaustedBannerProps {
  /** 是否显示穷尽提示 */
  visible: boolean;
  /** 重置回调 */
  onReset: () => void;
  /** 额外 className */
  className?: string;
}

/**
 * 下钻穷尽提示 — 浅蓝底色 Info Banner。
 * 正常流程提示，非错误/警告。
 */
export const DrilldownExhaustedBanner: React.FC<DrilldownExhaustedBannerProps> = ({
  visible,
  onReset,
  className,
}) => {
  if (!visible) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm',
        colorClasses.bg.primary,
        colorClasses.text.primary,
        className,
      )}
    >
      <Info className="h-4 w-4 flex-shrink-0" />
      <span>已到最细粒度，可通过面包屑回退或点击</span>
      <button
        type="button"
        onClick={onReset}
        className="font-medium underline decoration-primary-border hover:text-primary-dark transition-colors"
      >
        重置分析
      </button>
      <span>重新选择。</span>
    </div>
  );
};
