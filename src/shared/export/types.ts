/**
 * 数据导出模块类型定义
 *
 * 仅支持 PDF 报告导出
 */

/**
 * 导出格式类型
 */
export type ExportFormat = 'pdf';

/**
 * 页面方向
 */
export type PageOrientation = 'portrait' | 'landscape';

/**
 * 纸张大小
 */
export type PageSize = 'a4' | 'letter' | 'a3';

/**
 * 图表数据
 */
export interface ChartData {
  /** 图表ID（用于定位DOM元素） */
  id: string;
  /** 图表标题 */
  title: string;
  /** 图表类型 */
  type: 'line' | 'bar' | 'pie' | 'rose' | 'scatter' | 'custom';
  /** 图表DOM元素（用于截图） */
  element?: HTMLElement;
  /** 图表截图数据URL */
  imageDataURL?: string;
  /** 图表描述 */
  description?: string;
}

/**
 * 表格数据
 */
export interface TableData {
  /** 表格标题 */
  title: string;
  /** 列名 */
  headers: string[];
  /** 行数据 */
  rows: (string | number)[][];
  /** 列宽（可选） */
  columnWidths?: number[];
}

/**
 * KPI数据
 */
export interface KpiData {
  /** KPI名称 */
  name: string;
  /** KPI值 */
  value: string | number;
  /** 单位 */
  unit?: string;
  /** 同比变化（可选） */
  yoyChange?: string;
  /** 环比变化（可选） */
  momChange?: string;
}

/**
 * 导出内容
 */
export interface ExportContent {
  /** 报告标题 */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 生成日期 */
  generatedDate?: string;
  /** KPI数据 */
  kpis?: KpiData[];
  /** 图表数据 */
  charts?: ChartData[];
  /** 表格数据 */
  tables?: TableData[];
  /** 自定义页面 */
  customPages?: CustomPage[];
}

/**
 * 自定义页面
 */
export interface CustomPage {
  /** 页面标题 */
  title: string;
  /** 页面内容（HTML或纯文本） */
  content: string | HTMLElement;
  /** 内容类型 */
  type: 'text' | 'html' | 'chart' | 'table';
}

/**
 * 导出配置
 */
export interface ExportConfig {
  /** 导出格式 */
  format: ExportFormat;
  /** 文件名（不含扩展名） */
  filename: string;
  /** 页面方向 */
  orientation?: PageOrientation;
  /** 纸张大小 */
  pageSize?: PageSize;
  /** 模板名称 */
  template?: 'default' | 'executive' | 'detailed';
  /** 品牌配置 */
  branding?: BrandingConfig;
  /** 高级选项 */
  options?: ExportOptions;
}

/**
 * 品牌配置
 */
export interface BrandingConfig {
  /** 公司名称 */
  companyName?: string;
  /** Logo URL或Base64 */
  logoURL?: string;
  /** 主题色 */
  primaryColor?: string;
  /** 副色 */
  secondaryColor?: string;
  /** 页脚文字 */
  footer?: string;
}

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 是否包含封面页 */
  includeCoverPage?: boolean;
  /** 是否包含目录 */
  includeTOC?: boolean;
  /** 是否包含页码 */
  includePageNumber?: boolean;
  /** 是否包含水印 */
  includeWatermark?: boolean;
  /** 水印文字 */
  watermarkText?: string;
  /** 图表质量（0.1-1.0） */
  chartQuality?: number;
  /** 是否压缩图片 */
  compressImages?: boolean;
  /** 最大页面数量（用于PPT） */
  maxPages?: number;
}

/**
 * 导出进度
 */
export interface ExportProgress {
  /** 当前步骤 */
  step: 'preparing' | 'capturing' | 'generating' | 'downloading' | 'completed' | 'error';
  /** 进度百分比（0-100） */
  percentage: number;
  /** 当前处理项 */
  currentItem?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 导出结果
 */
export interface ExportResult {
  /** 是否成功 */
  success: boolean;
  /** 文件名 */
  filename: string;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 导出耗时（毫秒） */
  duration?: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 图表截图选项
 */
export interface ChartCaptureOptions {
  /** 图片格式 */
  format?: 'png' | 'jpeg';
  /** 图片质量（0.1-1.0） */
  quality?: number;
  /** 背景色 */
  backgroundColor?: string;
  /** 缩放比例 */
  scale?: number;
  /** 是否忽略元素 */
  ignoreElements?: (element: Element) => boolean;
}

/**
 * PDF样式配置
 */
export interface PDFStyleConfig {
  /** 标题字体大小 */
  titleFontSize?: number;
  /** 副标题字体大小 */
  subtitleFontSize?: number;
  /** 正文字体大小 */
  bodyFontSize?: number;
  /** 行高 */
  lineHeight?: number;
  /** 页边距 */
  margin?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

