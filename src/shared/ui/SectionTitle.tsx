import React, { type ReactNode } from 'react';
import { cn, colorClasses, textStyles } from '../styles';

export interface SectionTitleProps {
  title: string;
  leftContent?: ReactNode;
  rightContent?: ReactNode;
}

/**
 * 板块标题组件 — 居中标题 + 两侧分隔线
 *
 * 从 PerformanceAnalysisPanel / CrossSellAnalysisPanel 提取的共享组件
 */
export const SectionTitle: React.FC<SectionTitleProps> = ({ title, leftContent, rightContent }) => (
  <div className="flex items-center gap-3 mb-3">
    {leftContent && <div className="flex items-center gap-2 flex-shrink-0">{leftContent}</div>}
    <div className={cn('flex-1 h-px', colorClasses.bg.neutralLight)} />
    <h2 className={cn(textStyles.titleSmall, 'font-semibold whitespace-nowrap')}>{title}</h2>
    <div className={cn('flex-1 h-px', colorClasses.bg.neutralLight)} />
    {rightContent && <div className="flex items-center gap-2 flex-shrink-0">{rightContent}</div>}
  </div>
);

export interface SectionBlockProps {
  id: string;
  children: ReactNode;
  title?: string;
  leftContent?: ReactNode;
  rightContent?: ReactNode;
}

/**
 * 板块容器组件 — 可选内置标题
 */
export const SectionBlock: React.FC<SectionBlockProps> = ({ id, children, title, leftContent, rightContent }) => (
  <section id={id} className="scroll-mt-40 space-y-3">
    {title && <SectionTitle title={title} leftContent={leftContent} rightContent={rightContent} />}
    {children}
  </section>
);
