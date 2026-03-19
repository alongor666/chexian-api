import React from 'react';
import { Inbox } from 'lucide-react';
import { cn, colorClasses, textStyles } from '../styles';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: { container: 'py-6', icon: 32, title: textStyles.body, desc: textStyles.caption },
  md: { container: 'py-12', icon: 40, title: textStyles.label, desc: textStyles.body },
  lg: { container: 'py-20', icon: 48, title: textStyles.titleSmall, desc: textStyles.body },
} as const;

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = '暂无数据',
  description,
  action,
  size = 'md',
  className,
}) => {
  const s = sizeMap[size];

  return (
    <div className={cn('flex flex-col items-center justify-center text-center', s.container, className)}>
      <div className={cn('mb-3', colorClasses.text.neutralMuted)}>
        {icon ?? <Inbox size={s.icon} strokeWidth={1.5} />}
      </div>
      <div className={cn(s.title, colorClasses.text.neutralLight)}>{title}</div>
      {description && (
        <div className={cn(s.desc, colorClasses.text.neutralMuted, 'mt-1 max-w-sm')}>{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
