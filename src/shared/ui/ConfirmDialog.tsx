/**
 * ConfirmDialog - 确认对话框组件
 *
 * 用于需要用户二次确认的操作，如删除、清空等。
 * 遵循设计系统规范，支持键盘操作和可访问性。
 *
 * @module ConfirmDialog
 */

import React, { useEffect, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../styles';

export interface ConfirmDialogProps {
  /** 是否显示对话框 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 确认回调 */
  onConfirm: () => void;
  /** 标题 */
  title: string;
  /** 描述内容 */
  description?: string;
  /** 确认按钮文字 */
  confirmText?: string;
  /** 取消按钮文字 */
  cancelText?: string;
  /** 危险操作（红色确认按钮） */
  danger?: boolean;
  /** 加载状态 */
  loading?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 额外内容（如表单输入） */
  children?: React.ReactNode;
}

/**
 * 确认对话框组件
 *
 * 特性：
 * - ESC 键关闭
 * - 点击遮罩关闭
 * - 焦点陷阱（自动聚焦确认按钮）
 * - 支持 loading 状态
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading = false,
  className,
  children,
}) => {
  // ESC 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    },
    [onClose, loading]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      // 防止背景滚动
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? 'confirm-dialog-description' : undefined}
    >
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
        aria-hidden="true"
      />

      {/* 对话框内容 */}
      <div
        className={cn(
          'relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6',
          'animate-in fade-in zoom-in-95 duration-200',
          className
        )}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-1 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors disabled:opacity-50"
          aria-label="关闭"
        >
          <X size={18} />
        </button>

        {/* 内容 */}
        <div className="flex items-start gap-4">
          {/* 图标 */}
          {danger && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* 标题 */}
            <h3
              id="confirm-dialog-title"
              className="text-lg font-semibold text-neutral-900"
            >
              {title}
            </h3>

            {/* 描述 */}
            {description && (
              <p
                id="confirm-dialog-description"
                className="mt-2 text-sm text-neutral-600"
              >
                {description}
              </p>
            )}

            {/* 额外内容 */}
            {children}
          </div>
        </div>

        {/* 按钮组 */}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            autoFocus
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * useConfirmDialog - 确认对话框 Hook
 *
 * 简化确认对话框的使用，返回状态和控制方法。
 */
export function useConfirmDialog() {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const show = React.useCallback(() => setOpen(true), []);
  const hide = React.useCallback(() => {
    setOpen(false);
    setLoading(false);
  }, []);

  const confirm = React.useCallback(async (action: () => Promise<void> | void) => {
    setLoading(true);
    try {
      await action();
      hide();
    } catch (error) {
      setLoading(false);
      throw error;
    }
  }, [hide]);

  return {
    open,
    loading,
    show,
    hide,
    confirm,
    setLoading,
  };
}

export default ConfirmDialog;
