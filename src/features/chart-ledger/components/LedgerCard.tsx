/**
 * 图表账本 · 单张图卡片外壳（2026-07 Claude Design 重设计稿落地，方向 A）
 *
 * 左栏：ghost 大编号 + 分类眉标 / 标题 / 「结论先行」强调色块 / 怎么看 /
 *       真实数据要点 / 经营动作标签（语义边框 + 形状图标，色盲安全）；
 * 右栏：图表插槽 + 数据口径脚注。结论句与要点来自真实数据（ChartResult），随筛选联动。
 */
import React from 'react';
import { cardStyles, colorClasses, cn, fontStyles } from '@/shared/styles';
import type { AsyncState, LedgerAction, LedgerCardMeta } from '../types';

/** 动作标签形状（颜色必叠形状，不只靠色相区分） */
type ActionIcon = 'up' | 'diamond' | 'tri';

const ACTION_STYLE: Record<LedgerAction, { cls: string; icon: ActionIcon }> = {
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

interface Props {
  meta: LedgerCardMeta;
  result: AsyncState & { conclusion: string; points: string[] };
  children: React.ReactNode;
}

export const LedgerCard: React.FC<Props> = ({ meta, result, children }) => {
  const action = ACTION_STYLE[meta.action];
  return (
    <div
      id={meta.id}
      className="grid grid-cols-1 lg:grid-cols-[0.82fr_1.18fr] gap-6 lg:gap-10 py-8 border-t border-neutral-200 dark:border-subtle scroll-mt-16"
    >
      {/* 左栏：叙述（min-w-0：防止右栏宽表把 grid 轨道撑爆挤扁本栏） */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-3 mb-2">
          <span className={cn('text-3xl font-extrabold leading-[0.9] text-neutral-200 dark:text-neutral-800', fontStyles.numeric)}>
            {meta.no}
          </span>
          <span className={cn('text-xs uppercase tracking-[0.1em]', colorClasses.text.neutralMuted, fontStyles.numeric)}>
            {meta.eyebrow}
          </span>
        </div>
        <h3 className={cn('text-xl font-bold mb-3', colorClasses.text.neutralBlack)}>{meta.name}</h3>

        {result.conclusion && (
          <div className="border-l-[3px] border-warning bg-warning-bg rounded-r-md px-3.5 py-2.5 mb-4">
            <div className={cn('text-[10px] uppercase tracking-[0.14em] font-bold opacity-75 mb-0.5', colorClasses.text.warningDark)}>
              结论先行
            </div>
            <p className={cn('text-base font-semibold leading-normal', colorClasses.text.warningDark)}>{result.conclusion}</p>
          </div>
        )}

        <div className={cn('text-[11px] tracking-[0.04em] mb-1', colorClasses.text.neutralMuted, fontStyles.numeric)}>怎么看</div>
        <p className={cn('text-sm leading-relaxed mb-4', colorClasses.text.neutralDark)}>{meta.usage}</p>

        {result.points.length > 0 && (
          <>
            <div className={cn('text-[11px] tracking-[0.04em] mb-1.5', colorClasses.text.neutralMuted, fontStyles.numeric)}>
              真实数据结论
            </div>
            <ul className="mb-4 space-y-1.5">
              {result.points.map((pt, i) => (
                <li key={i} className={cn('text-sm pl-4 relative leading-normal', colorClasses.text.neutralDark)}>
                  <span className="absolute left-0 text-primary">—</span>
                  {pt}
                </li>
              ))}
            </ul>
          </>
        )}

        <span
          className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-md border-[1.5px] text-[13px] font-bold',
            fontStyles.numeric,
            action.cls
          )}
        >
          <ActionShapeIcon icon={action.icon} />
          {meta.action}
          <span className="font-normal opacity-85">· {meta.actionText}</span>
        </span>
      </div>

      {/* 右栏：图表（min-w-0：让内层 overflow-x-auto 接管宽表滚动而非撑破轨道） */}
      <div className="min-w-0">
        <div className={cn(cardStyles.base, 'p-4')}>
          {children}
          <div className={cn('text-[11px] mt-2.5 pt-2.5 border-t', fontStyles.numeric, colorClasses.border.neutral, colorClasses.text.neutralMuted)}>
            {meta.note}
          </div>
        </div>
      </div>
    </div>
  );
};
