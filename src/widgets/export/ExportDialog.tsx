/**
 * 数据导出对话框组件
 *
 * 提供 PDF 导出功能的统一 UI 界面
 */

import React, { useState } from 'react';
import {
  exportData,
  type ExportConfig,
  type ExportContent,
  type PageOrientation,
  type ExportProgress,
} from '../../shared/export';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ExportDialog');

interface ExportDialogProps {
  /** 是否显示对话框 */
  isOpen: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
  /** 导出内容 */
  content: ExportContent;
  /** 默认文件名 */
  defaultFilename?: string;
}

/**
 * 导出对话框组件
 */
export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  content,
  defaultFilename = '数据分析报告',
}) => {
  // 导出配置状态
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const [template, setTemplate] = useState<'default' | 'executive' | 'detailed'>('default');
  const [includeKPIs, setIncludeKPIs] = useState(true);
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeTables, setIncludeTables] = useState(true);

  // 导出状态
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  /**
   * 处理导出
   */
  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setProgress({ step: 'preparing', percentage: 0 });

    try {
      // 构建导出配置
      const config: ExportConfig = {
        format: 'pdf',
        filename: defaultFilename,
        orientation,
        template,
        branding: {
          companyName: '车险业绩分析系统',
          primaryColor: '2980b9',
          footer: `© ${new Date().getFullYear()} 车险业绩分析系统`,
        },
        options: {
          includeCoverPage: true,
          includePageNumber: true,
          chartQuality: 0.95,
          compressImages: false,
        },
      };

      // 过滤内容
      const filteredContent: ExportContent = {
        title: content.title,
        subtitle: content.subtitle,
        generatedDate: new Date().toLocaleDateString('zh-CN'),
        kpis: includeKPIs ? content.kpis : undefined,
        charts: includeCharts ? content.charts : undefined,
        tables: includeTables ? content.tables : undefined,
      };

      // 执行导出
      const result = await exportData(config, filteredContent, setProgress);

      if (result.success) {
        // 成功提示
        alert(`导出成功！\n文件: ${result.filename}\n耗时: ${(result.duration! / 1000).toFixed(1)}秒`);
        onClose();
      } else {
        setError(result.error || '导出失败');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      logger.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  /**
   * 获取进度提示文字
   */
  const getProgressText = (): string => {
    if (!progress) return '';

    switch (progress.step) {
      case 'preparing':
        return '准备导出数据...';
      case 'capturing':
        return progress.currentItem || '捕获图表截图...';
      case 'generating':
        return progress.currentItem || '生成文件...';
      case 'downloading':
        return '准备下载...';
      case 'completed':
        return '导出完成！';
      case 'error':
        return progress.error || '导出失败';
      default:
        return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">导出 PDF 报告</h2>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6 space-y-6">
          {/* 页面方向 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">页面方向</label>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as PageOrientation)}
              disabled={isExporting}
              className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="portrait">纵向（Portrait）</option>
              <option value="landscape">横向（Landscape）</option>
            </select>
          </div>

          {/* 模板选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">报告模板</label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as 'default' | 'executive' | 'detailed')}
              disabled={isExporting}
              className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="default">标准模板</option>
              <option value="executive">高管摘要（精简版）</option>
              <option value="detailed">详细分析（完整版）</option>
            </select>
          </div>

          {/* 内容选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">包含内容</label>
            <div className="space-y-2">
              {content.kpis && content.kpis.length > 0 && (
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={includeKPIs}
                    onChange={(e) => setIncludeKPIs(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    关键指标（{content.kpis.length} 项）
                  </span>
                </label>
              )}
              {content.charts && content.charts.length > 0 && (
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={includeCharts}
                    onChange={(e) => setIncludeCharts(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    图表分析（{content.charts.length} 个）
                  </span>
                </label>
              )}
              {content.tables && content.tables.length > 0 && (
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={includeTables}
                    onChange={(e) => setIncludeTables(e.target.checked)}
                    disabled={isExporting}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    数据表格（{content.tables.length} 个）
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* 进度显示 */}
          {isExporting && progress && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-900">{getProgressText()}</span>
                <span className="text-sm text-blue-700">{progress.percentage.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-red-500 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-red-900">{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* 按钮栏 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={
              isExporting ||
              (!includeKPIs && !includeCharts && !includeTables)
            }
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? '导出中...' : '导出 PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};
