/**
 * 图表账本 · 单张图卡片外壳（2026-07 Claude Design 重设计稿落地，方向 A）
 *
 * 左栏：ghost 大编号 + 分类眉标 / 标题 / 「结论先行」强调色块 / 怎么看 /
 *       真实数据要点 / 经营动作标签（语义边框 + 形状图标，色盲安全）；
 * 右栏：图表插槽 + 数据口径脚注。结论句与要点来自真实数据（ChartResult），随筛选联动。
 */
import React from 'react';
import { cardStyles, colorClasses, cn, fontStyles } from '@/shared/styles';
import { ACTION_STYLE, ActionShapeIcon } from './actionStyle';
import { InfoTrigger } from '../infographs';
import type { AsyncState, LedgerCardMeta } from '../types';

// 双编码定义已下沉 components/actionStyle.tsx（与 infographs 决策映射表共用）；
// 这里保留再导出，维持 ChartLedgerPage 既有 import 路径。
export { ActionShapeIcon } from './actionStyle';

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
      className="grid grid-cols-1 lg:grid-cols-[0.68fr_1.32fr] gap-6 lg:gap-10 py-8 border-t border-neutral-200 dark:border-subtle scroll-mt-16"
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
        <div className={cn(cardStyles.base, 'relative p-4')}>
          <InfoTrigger meta={meta} />
          {children}
          <div className={cn('text-[11px] mt-2.5 pt-2.5 border-t', fontStyles.numeric, colorClasses.border.neutral, colorClasses.text.neutralMuted)}>
            {meta.note}
          </div>
        </div>
      </div>
    </div>
  );
};
