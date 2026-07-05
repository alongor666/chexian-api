/**
 * 图表账本 · 读图指南弹层 + 卡片右上角 ⓘ 触发器
 *
 * 关闭三路：× 按钮 / ESC / 点击背板（背板是 button 元素自身 onClick，
 * 不挂 document 全局监听——PR #481 mousedown 时序教训）。
 * 打开期间锁 body 滚动；打开自动聚焦关闭按钮。纯静态内容，零查询。
 */
import React, { useEffect, useRef, useState } from 'react';
import { cardStyles, cn, colorClasses, fontStyles } from '@/shared/styles';
import { ActionBadge } from '../components/actionStyle';
import { INFOGRAPHS } from './infographMeta';
import type { InfographDef } from './types';
import type { LedgerCardMeta } from '../types';

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={cn('text-[11px] uppercase tracking-[0.08em] mt-5 mb-2', fontStyles.numeric, colorClasses.text.neutralMuted)}>
    {children}
  </div>
);

const InfographModal: React.FC<{ meta: LedgerCardMeta; def: InfographDef; onClose: () => void }> = ({
  meta,
  def,
  onClose,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = `${def.id}-infograph-title`;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const Anatomy = def.anatomy;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* 背板（自身即关闭按钮，无 document 全局监听） */}
      <button
        type="button"
        aria-label="关闭读图指南"
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-neutral-900/50 dark:bg-neutral-900/70 backdrop-blur-md cursor-default"
      />
      <div className={cn(cardStyles.base, 'relative w-full max-w-4xl max-h-[88vh] overflow-y-auto overscroll-contain p-6 sm:p-8')}>
        {/* 头部 */}
        <div className="flex items-start justify-between gap-4 mb-1">
          <div>
            <div className={cn('text-[11px] uppercase tracking-[0.14em] mb-1', fontStyles.numeric, colorClasses.text.neutralMuted)}>
              读图指南 · {meta.no}
            </div>
            <h3 id={titleId} className={cn('text-xl font-bold', colorClasses.text.neutralBlack)}>
              {meta.name}
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className={cn(
              'shrink-0 w-8 h-8 rounded-md border flex items-center justify-center transition-colors',
              colorClasses.border.neutral,
              colorClasses.text.neutralLight,
              'hover:text-primary hover:border-primary-border'
            )}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ① 这张图回答什么 */}
        <div className="border-l-[3px] border-primary bg-primary-bg rounded-r-md px-3.5 py-2.5 mt-3">
          <div className={cn('text-[10px] uppercase tracking-[0.14em] font-bold opacity-75 mb-0.5', colorClasses.text.primaryDark)}>
            这张图回答什么
          </div>
          <p className={cn('text-[15px] font-semibold leading-normal', colorClasses.text.primaryDark)}>{def.question}</p>
        </div>

        {/* ② 图形解剖（弹层加宽后 SVG 随容器等比放大，展示更全面） */}
        <SectionLabel>图形解剖</SectionLabel>
        <div className={cn('rounded-md border px-4 py-5 sm:px-6 sm:py-7', colorClasses.border.neutral, 'bg-neutral-50 dark:bg-surface-2')}>
          <div className="mx-auto max-w-3xl">
            <Anatomy />
          </div>
        </div>
        <ul className="mt-2 space-y-1">
          {def.anatomyNotes.map((n, i) => (
            <li key={i} className={cn('text-xs pl-4 relative leading-relaxed', colorClasses.text.neutralLight)}>
              <span className="absolute left-0 text-primary">—</span>
              {n}
            </li>
          ))}
        </ul>

        {/* ③ 读图三步 */}
        <SectionLabel>读图三步</SectionLabel>
        <ol className="space-y-2">
          {def.steps.map((s, i) => (
            <li key={i} className={cn('relative pl-[30px] text-sm leading-relaxed', colorClasses.text.neutralDark)}>
              <span
                className={cn(
                  'absolute left-0 top-0 w-[20px] h-[20px] rounded-full border border-primary-border bg-primary-bg flex items-center justify-center text-xs font-bold',
                  fontStyles.numeric,
                  colorClasses.text.primaryDark
                )}
              >
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>

        {/* ④ 判定规则 */}
        <SectionLabel>判定规则</SectionLabel>
        <ul className="space-y-1.5">
          {def.rules.map((r) => (
            <li key={r.label} className={cn('text-sm leading-relaxed pl-4 relative', colorClasses.text.neutralDark)}>
              <span className="absolute left-0 text-primary">—</span>
              <b className={cn('font-semibold', colorClasses.text.neutralBlack)}>{r.label}</b>
              <span className={colorClasses.text.neutralLight}>：{r.desc}</span>
            </li>
          ))}
        </ul>

        {/* ⑤ 决策映射 */}
        <SectionLabel>决策映射</SectionLabel>
        <div className={cn('rounded-md border overflow-hidden', colorClasses.border.neutral)}>
          {def.decisions.map((d, i) => (
            <div
              key={i}
              className={cn(
                'grid grid-cols-1 sm:grid-cols-[1.2fr_auto_1.2fr] gap-2 sm:gap-3 items-center px-3 py-2.5',
                i > 0 && cn('border-t', colorClasses.border.neutral)
              )}
            >
              <span className={cn('text-sm', colorClasses.text.neutralDark)}>{d.signal}</span>
              <ActionBadge action={d.action} />
              <span className={cn('text-sm', colorClasses.text.neutralLight)}>{d.move}</span>
            </div>
          ))}
        </div>

        <p className={cn('text-[11px] mt-4 pt-3 border-t text-center', fontStyles.numeric, colorClasses.border.neutral, colorClasses.text.neutralMuted)}>
          方法论指南 · 不含实时数据（数据在卡片本体，随全局筛选联动）
        </p>
      </div>
    </div>
  );
};

/** 图表卡右上角 ⓘ 触发器（含弹层状态；卡片容器需 relative） */
export const InfoTrigger: React.FC<{ meta: LedgerCardMeta }> = ({ meta }) => {
  const [open, setOpen] = useState(false);
  const def = INFOGRAPHS[meta.id];
  if (!def) return null;
  return (
    <>
      <button
        type="button"
        aria-label={`查看读图指南：${meta.name}`}
        aria-haspopup="dialog"
        title="读图指南"
        onClick={() => setOpen(true)}
        className={cn(
          'absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full border flex items-center justify-center transition-colors',
          'bg-white/80 dark:bg-surface-2',
          colorClasses.border.neutral,
          colorClasses.text.neutralLight,
          'hover:text-primary hover:border-primary-border hover:bg-primary-bg'
        )}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="7" cy="4.2" r="0.9" fill="currentColor" />
          <path d="M7 6.4 L7 10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && <InfographModal meta={meta} def={def} onClose={() => setOpen(false)} />}
    </>
  );
};
