/**
 * 导出弹窗组件
 *
 * 提供多种导出格式选择：
 * - PDF 报告
 * - Excel 数据
 * - CSV 数据
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Upload, X, FileText, BarChart3, ClipboardList, Check, Loader2 } from 'lucide-react';
import { useFocusTrap } from '../../shared/hooks';
import { Logger } from '@/shared/utils/logger';
import { colorClasses } from '../../shared/styles';

const logger = new Logger('ExportModal');

interface ExportModalProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  format: string;
  available: boolean;
}

const exportOptions: ExportOption[] = [
  {
    id: 'pdf',
    label: 'PDF 报告',
    description: '导出当前视图为 PDF 格式报告',
    icon: FileText,
    format: 'pdf',
    available: false, // 待实现
  },
  {
    id: 'excel',
    label: 'Excel 表格',
    description: '导出数据为 Excel 格式（.xlsx）',
    icon: BarChart3,
    format: 'xlsx',
    available: true,
  },
  {
    id: 'csv',
    label: 'CSV 数据',
    description: '导出数据为 CSV 格式',
    icon: ClipboardList,
    format: 'csv',
    available: true,
  },
];

/**
 * 导出弹窗
 */
export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const [selectedOption, setSelectedOption] = useState<string>('excel');
  const [isExporting, setIsExporting] = useState(false);
  const modalRef = useFocusTrap<HTMLDivElement>({ enabled: isOpen });

  // 处理 Escape 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isExporting, onClose]);

  const handleExport = useCallback(async () => {
    const option = exportOptions.find((o) => o.id === selectedOption);
    if (!option || !option.available) {
      alert(`${option?.label || '该格式'} 导出功能开发中`);
      return;
    }

    setIsExporting(true);

    try {
      // 触发全局导出事件
      window.dispatchEvent(
        new CustomEvent('export-data', {
          detail: { format: option.format },
        })
      );

      // 模拟导出延迟
      await new Promise((resolve) => setTimeout(resolve, 1000));

      onClose();
    } catch (error) {
      logger.error('Export failed:', error);
      alert('导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  }, [selectedOption, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        {/* 弹窗内容 */}
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-modal-title"
          className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <header className={`flex items-center justify-between p-4 border-b ${colorClasses.border.neutral}`}>
            <h2 id="export-modal-title" className={`text-lg font-semibold ${colorClasses.text.neutralBlack} dark:text-white flex items-center`}>
              <Upload size={20} className="mr-2 text-primary" aria-hidden="true" />
              导出数据
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors"
              aria-label="关闭导出弹窗"
            >
              <X size={20} className={colorClasses.text.neutralMuted} aria-hidden="true" />
            </button>
          </header>

          {/* 内容 */}
          <div className="p-6">
            <p className={`text-sm ${colorClasses.text.neutral} mb-4`}>
              选择导出格式：
            </p>

            {/* 导出选项 */}
            <div className="space-y-3" role="radiogroup" aria-label="选择导出格式">
              {exportOptions.map((option) => {
                const OptionIcon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => option.available && setSelectedOption(option.id)}
                    disabled={!option.available}
                    className={`w-full flex items-center p-4 rounded-lg border-2 transition-all ${
                      !option.available
                        ? `opacity-50 cursor-not-allowed ${colorClasses.border.neutral}`
                        : selectedOption === option.id
                        ? `border-primary ${colorClasses.bg.primary}`
                        : `${colorClasses.border.neutral} hover:border-neutral-300 dark:hover:border-neutral-600`
                    }`}
                    role="radio"
                    aria-checked={selectedOption === option.id}
                  >
                    <OptionIcon size={24} className={`mr-3 ${colorClasses.text.neutralMuted}`} aria-hidden="true" />
                    <div className="flex-1 text-left">
                      <div className="flex items-center">
                        <span className={`font-medium ${colorClasses.text.neutralBlack} dark:text-white`}>
                          {option.label}
                        </span>
                        {!option.available && (
                          <span className={`ml-2 text-xs px-2 py-0.5 ${colorClasses.bg.neutral} dark:bg-neutral-800 ${colorClasses.text.neutralMuted} rounded-full`}>
                            开发中
                          </span>
                        )}
                      </div>
                      <p className={`text-sm ${colorClasses.text.neutralMuted} mt-0.5`}>
                        {option.description}
                      </p>
                    </div>
                    {option.available && selectedOption === option.id && (
                      <Check size={20} className={colorClasses.text.primary} aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className={`flex items-center justify-end gap-3 p-4 border-t ${colorClasses.border.neutral} ${colorClasses.bg.neutral} dark:bg-neutral-800`}>
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-medium ${colorClasses.text.neutral} hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors`}
            >
              取消
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center ${
                isExporting
                  ? `${colorClasses.bg.neutral} ${colorClasses.text.neutralMuted} cursor-not-allowed`
                  : 'bg-primary-solid text-white hover:bg-primary-dark'
              }`}
              aria-busy={isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" aria-hidden="true" />
                  导出中...
                </>
              ) : (
                '导出'
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
