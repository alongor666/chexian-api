/**
 * 图表账本 · 单张图卡片外壳
 *
 * 左栏：眉标 / 标题 / 结论先行 / 怎么看 / 模拟→真实数据要点 / 经营动作标签；
 * 右栏：图表插槽。结论句与要点来自真实数据（ChartResult），随筛选联动。
 */
import React from 'react';
import { cardStyles, colorClasses, cn } from '@/shared/styles';
import type { AsyncState, LedgerAction, LedgerCardMeta } from '../types';

const ACTION_DOT: Record<LedgerAction, string> = {
  加码: 'bg-success',
  复制: 'bg-success',
  优化: 'bg-warning',
  整改: 'bg-danger',
  预警: 'bg-danger',
  暂停: 'bg-neutral-400 dark:bg-neutral-500',
};

interface Props {
  meta: LedgerCardMeta;
  result: AsyncState & { conclusion: string; points: string[] };
  children: React.ReactNode;
}

export const LedgerCard: React.FC<Props> = ({ meta, result, children }) => {
  return (
    <div id={meta.id} className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] gap-6 lg:gap-10 py-8 border-t border-neutral-200 dark:border-subtle scroll-mt-16">
      {/* 左栏：叙述 */}
      <div>
        <div className={cn('text-[11px] uppercase tracking-wider mb-2 font-numeric', colorClasses.text.neutralMuted)}>
          {meta.eyebrow}
        </div>
        <h3 className={cn('text-lg font-bold mb-3', colorClasses.text.neutralBlack)}>{meta.name}</h3>

        {result.conclusion && (
          <p className={cn('border-l-2 border-warning pl-3 mb-4 text-[15px] font-medium', colorClasses.text.warningDark)}>
            {result.conclusion}
          </p>
        )}

        <div className={cn('text-[11px] font-numeric mb-1', colorClasses.text.neutralMuted)}>怎么看</div>
        <p className={cn('text-sm mb-4', colorClasses.text.neutralDark)}>{meta.usage}</p>

        {result.points.length > 0 && (
          <>
            <div className={cn('text-[11px] font-numeric mb-1', colorClasses.text.neutralMuted)}>真实数据结论</div>
            <ul className="mb-4 space-y-1.5">
              {result.points.map((pt, i) => (
                <li key={i} className={cn('text-sm pl-4 relative', colorClasses.text.neutral)}>
                  <span className="absolute left-0 text-primary">—</span>
                  {pt}
                </li>
              ))}
            </ul>
          </>
        )}

        <span className={cn('inline-flex items-center gap-2 text-xs font-numeric px-3 py-1.5 rounded border', colorClasses.border.neutral, colorClasses.text.neutral)}>
          <span className={cn('w-1.5 h-1.5 rounded-full', ACTION_DOT[meta.action])} />
          {meta.action}：{meta.actionText}
        </span>
      </div>

      {/* 右栏：图表 */}
      <div className={cn(cardStyles.base, 'p-4')}>
        {children}
        <div className={cn('text-[11px] font-numeric mt-2.5 pt-2.5 border-t', colorClasses.border.neutral, colorClasses.text.neutralMuted)}>
          {meta.note}
        </div>
      </div>
    </div>
  );
};
