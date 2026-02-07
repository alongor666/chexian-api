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
          className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 id="export-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <Upload size={20} className="mr-2 text-primary" aria-hidden="true" />
              导出数据
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              aria-label="关闭导出弹窗"
            >
              <X size={20} className="text-gray-500" aria-hidden="true" />
            </button>
          </header>

          {/* 内容 */}
          <div className="p-6">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
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
                        ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700'
                        : selectedOption === option.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    role="radio"
                    aria-checked={selectedOption === option.id}
                  >
                    <OptionIcon size={24} className="mr-3 text-gray-500" aria-hidden="true" />
                    <div className="flex-1 text-left">
                      <div className="flex items-center">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {option.label}
                        </span>
                        {!option.available && (
                          <span className="ml-2 text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-full">
                            开发中
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {option.description}
                      </p>
                    </div>
                    {option.available && selectedOption === option.id && (
                      <Check size={20} className="text-blue-500" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center ${
                isExporting
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
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
