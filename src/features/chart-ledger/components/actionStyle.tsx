/**
 * 图表账本 · 经营动作标签的「颜色 + 形状」双编码（色盲安全）
 *
 * 被 LedgerCard（卡片动作标签）与 infographs/InfographModal（决策映射表）共用，
 * 独立成文件以避免二者互相 import 形成模块环。
 */
import React from 'react';
import { cn, colorClasses } from '@/shared/styles';
import type { LedgerAction } from '../types';

export type ActionIcon = 'up' | 'diamond' | 'tri';

export const ACTION_STYLE: Record<LedgerAction, { cls: string; icon: ActionIcon }> = {
  加码: { cls: cn('border-success bg-success-bg', colorClasses.text.successDark), icon: 'up' },
  复制: { cls: cn('border-success bg-success-bg', colorClasses.text.successDark), icon: 'up' },
  优化: { cls: cn('border-warning bg-warning-bg', colorClasses.text.warningDark), icon: 'diamond' },
  整改: { cls: cn('border-danger bg-danger-bg', colorClasses.text.danger), icon: 'tri' },
  预警: { cls: cn('border-danger bg-danger-bg', colorClasses.text.danger), icon: 'tri' },
  暂停: {
    cls: 'border-neutral-300 dark:border-neutral-600 bg-neutral-100 dark:bg-surface-3 text-neutral-600 dark:text-neutral-400',
    icon: 'tri',
  },
};

const ICON_PATH: Record<ActionIcon, string> = {
  up: 'M6 1 L11 10 L1 10 Z',
  diamond: 'M6 1 L11 6 L6 11 L1 6 Z',
  tri: 'M6 1 L11 11 L1 11 Z',
};

export const ActionShapeIcon: React.FC<{ icon: ActionIcon; size?: number }> = ({ icon, size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    <path d={ICON_PATH[icon]} fill="currentColor" />
  </svg>
);

/** 小号动作徽章（决策映射表用；与卡片大标签同一套编码） */
export const ActionBadge: React.FC<{ action: LedgerAction }> = ({ action }) => {
  const s = ACTION_STYLE[action];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-bold whitespace-nowrap', s.cls)}>
      <ActionShapeIcon icon={s.icon} size={9} />
      {action}
    </span>
  );
};
