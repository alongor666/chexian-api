/**
 * 数据导入弹窗组件
 *
 * 提供快速数据导入功能（从菜单触发）
 * 通过后端 API 上传文件
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { Download, X, FolderOpen, Loader2, AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '../../shared/hooks';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('DataImportModal');

interface DataImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 数据导入弹窗
 */
export const DataImportModal: React.FC<DataImportModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useFocusTrap<HTMLDivElement>({ enabled: isOpen });
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onClose]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.parquet')) {
        setError('请选择 .parquet 格式的文件');
        return;
      }

      const MAX_SIZE = 100 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        setError('文件大小超过限制（最大100MB）');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        await apiClient.uploadFile(file);
        onClose();
        navigate('/dashboard');
      } catch (err) {
        logger.error('Import failed:', err);
        const errorMessage = err instanceof Error ? err.message : '导入失败，请重试';

        if (errorMessage.includes('Snappy decompression failure')) {
          setError('文件格式错误：Snappy 解压失败，请检查文件是否损坏或使用了不支持的压缩格式');
        } else if (errorMessage.includes('Failed to read file')) {
          setError('文件读取失败，请检查文件是否损坏');
        } else {
          setError(errorMessage);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [navigate, onClose]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
          className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 id="import-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <Download size={20} className="mr-2 text-primary" aria-hidden="true" />
              导入数据
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              aria-label="关闭导入弹窗"
            >
              <X size={20} className="text-gray-500" aria-hidden="true" />
            </button>
          </header>

          <div className="p-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={handleClick}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              } ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".parquet"
                onChange={handleInputChange}
                className="hidden"
              />

              {isLoading ? (
                <div className="flex flex-col items-center">
                  <Loader2 size={40} className="animate-spin text-blue-500 mb-3" aria-hidden="true" />
                  <p className="text-gray-600 dark:text-gray-400">正在上传数据...</p>
                </div>
              ) : (
                <>
                  <FolderOpen size={40} className="mx-auto mb-3 text-gray-400" aria-hidden="true" />
                  <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">
                    拖拽文件到此处
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    或点击选择文件
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                    支持 .parquet 格式
                  </p>
                </>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg" role="alert">
                <div className="flex items-start">
                  <AlertTriangle size={16} className="text-red-500 mr-2 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            )}

            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                <span className="font-semibold">提示：</span>
                导入成功后将自动跳转到仪表盘页面进行数据分析。
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                <span className="font-semibold">文件要求：</span>
                支持标准 Parquet 格式，建议使用 Snappy 或未压缩格式。
                如果遇到 Snappy 解压失败，请检查文件是否损坏或尝试使用其他压缩格式。
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
