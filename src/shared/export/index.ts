/**
 * 数据导出模块
 *
 * 统一导出接口（仅支持 PDF）
 */

// 类型定义
export type {
  ExportFormat,
  PageOrientation,
  PageSize,
  ChartData,
  TableData,
  KpiData,
  ExportContent,
  ExportConfig,
  BrandingConfig,
  ExportOptions,
  ExportProgress,
  ExportResult,
  ChartCaptureOptions,
  PDFStyleConfig,
  CustomPage,
} from './types';

// 图表截图
export {
  captureChart,
  captureCharts,
  captureEChartsInstance,
  waitForChartRender,
  compressImageDataURL,
  getImageDimensions,
} from './chartCapture';

// PDF导出
export {
  PDFExporter,
  exportToPDF,
} from './pdfExporter';

/**
 * 统一导出方法（仅支持 PDF 格式）
 */
import type { ExportConfig, ExportContent, ExportProgress, ExportResult } from './types';
import { exportToPDF } from './pdfExporter';

export async function exportData(
  config: ExportConfig,
  content: ExportContent,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportResult> {
  if (config.format !== 'pdf') {
    throw new Error(`Unsupported export format: ${config.format}. Only 'pdf' is supported.`);
  }
  return exportToPDF(config, content, onProgress);
}
