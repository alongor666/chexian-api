import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn, colorClasses, textStyles, buttonStyles } from '../styles';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = '数据加载失败',
  message,
  onRetry,
  retryLabel = '重试',
  className,
}) => (
  <div className={cn('flex flex-col items-center justify-center text-center py-12', className)}>
    <div className={cn('mb-3', colorClasses.text.danger)}>
      <AlertCircle size={40} strokeWidth={1.5} />
    </div>
    <div className={cn(textStyles.label, colorClasses.text.danger)}>{title}</div>
    {message && (
      <div className={cn(textStyles.body, colorClasses.text.neutralLight, 'mt-1 max-w-md')}>{message}</div>
    )}
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeSmall, 'mt-4')}
      >
        {retryLabel}
      </button>
    )}
  </div>
);
