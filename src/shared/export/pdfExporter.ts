/**
 * PDF 报告生成器
 *
 * 使用 jsPDF 和 jspdf-autotable 生成专业的 PDF 报告
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ExportConfig,
  ExportContent,
  ExportProgress,
  ExportResult,
  ChartData,
  TableData,
  KpiData,
  PDFStyleConfig,
} from './types';
import { captureCharts, waitForChartRender } from './chartCapture';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('PdfExporter');

/**
 * 默认PDF样式
 */
const DEFAULT_PDF_STYLE: Required<PDFStyleConfig> = {
  titleFontSize: 24,
  subtitleFontSize: 16,
  bodyFontSize: 12,
  lineHeight: 1.5,
  margin: {
    top: 20,
    right: 20,
    bottom: 20,
    left: 20,
  },
};

/**
 * PDF导出器类
 */
export class PDFExporter {
  private doc: jsPDF;
  private config: Required<ExportConfig>;
  private style: Required<PDFStyleConfig>;
  private currentY: number = 0;
  private pageHeight: number;
  private pageWidth: number;

  constructor(config: ExportConfig) {
    // 填充默认配置
    this.config = {
      ...config,
      orientation: config.orientation || 'portrait',
      pageSize: config.pageSize || 'a4',
      template: config.template || 'default',
      branding: config.branding || {},
      options: {
        includeCoverPage: true,
        includeTOC: false,
        includePageNumber: true,
        includeWatermark: false,
        chartQuality: 0.95,
        compressImages: true,
        ...config.options,
      },
    };

    // 创建PDF文档
    this.doc = new jsPDF({
      orientation: this.config.orientation,
      unit: 'mm',
      format: this.config.pageSize,
    });

    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
    this.style = DEFAULT_PDF_STYLE;
  }

  /**
   * 生成PDF报告
   */
  async generate(
    content: ExportContent,
    onProgress?: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    const startTime = Date.now();

    try {
      // 步骤1: 准备数据
      if (onProgress) {
        onProgress({
          step: 'preparing',
          percentage: 10,
          currentItem: '准备导出数据...',
        });
      }

      // 步骤2: 捕获图表截图
      let chartsWithImages: ChartData[] = [];
      if (content.charts && content.charts.length > 0) {
        if (onProgress) {
          onProgress({
            step: 'capturing',
            percentage: 30,
            currentItem: '捕获图表截图...',
          });
        }

        await waitForChartRender();
        chartsWithImages = await captureCharts(
          content.charts,
          {
            quality: this.config.options.chartQuality,
          },
          (current, total, title) => {
            if (onProgress) {
              onProgress({
                step: 'capturing',
                percentage: 30 + (current / total) * 30,
                currentItem: `捕获图表: ${title}`,
              });
            }
          }
        );
      }

      // 步骤3: 生成PDF内容
      if (onProgress) {
        onProgress({
          step: 'generating',
          percentage: 60,
          currentItem: '生成PDF内容...',
        });
      }

      // 生成封面页
      if (this.config.options.includeCoverPage) {
        this.addCoverPage(content);
        this.addPage();
      }

      // 生成KPI页
      if (content.kpis && content.kpis.length > 0) {
        this.addKPIPage(content.kpis);
        if (chartsWithImages.length > 0 || (content.tables && content.tables.length > 0)) {
          this.addPage();
        }
      }

      // 生成图表页
      for (let i = 0; i < chartsWithImages.length; i++) {
        const chart = chartsWithImages[i];
        if (onProgress) {
          onProgress({
            step: 'generating',
            percentage: 60 + ((i + 1) / chartsWithImages.length) * 20,
            currentItem: `添加图表: ${chart.title}`,
          });
        }

        this.addChartPage(chart);
        if (i < chartsWithImages.length - 1 || (content.tables && content.tables.length > 0)) {
          this.addPage();
        }
      }

      // 生成表格页
      if (content.tables) {
        for (let i = 0; i < content.tables.length; i++) {
          const table = content.tables[i];
          if (onProgress) {
            onProgress({
              step: 'generating',
              percentage: 80 + ((i + 1) / content.tables.length) * 10,
              currentItem: `添加表格: ${table.title}`,
            });
          }

          this.addTablePage(table);
          if (i < content.tables.length - 1) {
            this.addPage();
          }
        }
      }

      // 步骤4: 下载文件
      if (onProgress) {
        onProgress({
          step: 'downloading',
          percentage: 95,
          currentItem: '准备下载...',
        });
      }

      const filename = `${this.config.filename}.pdf`;
      this.doc.save(filename);

      // 完成
      const duration = Date.now() - startTime;
      if (onProgress) {
        onProgress({
          step: 'completed',
          percentage: 100,
          currentItem: '导出完成',
        });
      }

      return {
        success: true,
        filename,
        duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (onProgress) {
        onProgress({
          step: 'error',
          percentage: 0,
          error: errorMessage,
        });
      }

      return {
        success: false,
        filename: '',
        error: errorMessage,
      };
    }
  }

  /**
   * 添加封面页
   */
  private addCoverPage(content: ExportContent): void {
    const centerX = this.pageWidth / 2;
    const centerY = this.pageHeight / 2;

    // Logo（如果有）
    if (this.config.branding?.logoURL) {
      try {
        this.doc.addImage(
          this.config.branding.logoURL,
          'PNG',
          centerX - 30,
          centerY - 80,
          60,
          30
        );
      } catch (error) {
        logger.warn('Failed to add logo:', error);
      }
    }

    // 标题
    this.doc.setFontSize(this.style.titleFontSize);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text(content.title, centerX, centerY - 30, { align: 'center' });

    // 副标题
    if (content.subtitle) {
      this.doc.setFontSize(this.style.subtitleFontSize);
      this.doc.setFont('helvetica', 'normal');
      this.doc.text(content.subtitle, centerX, centerY - 10, { align: 'center' });
    }

    // 生成日期
    const date = content.generatedDate || new Date().toLocaleDateString('zh-CN');
    this.doc.setFontSize(this.style.bodyFontSize);
    this.doc.text(`生成日期: ${date}`, centerX, centerY + 20, { align: 'center' });

    // 公司名称
    if (this.config.branding?.companyName) {
      this.doc.text(this.config.branding.companyName, centerX, centerY + 40, {
        align: 'center',
      });
    }

    // 页脚
    this.addFooter();
  }

  /**
   * 添加KPI页
   */
  private addKPIPage(kpis: KpiData[]): void {
    this.currentY = this.style.margin.top;

    // 页面标题
    this.doc.setFontSize(this.style.titleFontSize - 4);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text('关键指标概览', this.style.margin.left, this.currentY);
    this.currentY += 15;

    // KPI网格布局（2列）
    const cols = 2;
    const cardWidth = (this.pageWidth - this.style.margin.left - this.style.margin.right - 10) / cols;
    const cardHeight = 40;

    kpis.forEach((kpi, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = this.style.margin.left + col * (cardWidth + 5);
      const y = this.currentY + row * (cardHeight + 5);

      // 绘制卡片边框
      this.doc.setDrawColor(200, 200, 200);
      this.doc.rect(x, y, cardWidth, cardHeight);

      // KPI名称
      this.doc.setFontSize(this.style.bodyFontSize);
      this.doc.setFont('helvetica', 'normal');
      this.doc.text(kpi.name, x + 5, y + 10);

      // KPI值
      this.doc.setFontSize(this.style.titleFontSize - 6);
      this.doc.setFont('helvetica', 'bold');
      const value = `${kpi.value}${kpi.unit || ''}`;
      this.doc.text(value, x + 5, y + 25);

      // 变化趋势
      if (kpi.yoyChange) {
        this.doc.setFontSize(this.style.bodyFontSize - 2);
        this.doc.setFont('helvetica', 'normal');
        this.doc.text(`同比: ${kpi.yoyChange}`, x + 5, y + 35);
      }
    });

    this.currentY += Math.ceil(kpis.length / cols) * (cardHeight + 5) + 10;
    this.addFooter();
  }

  /**
   * 添加图表页
   */
  private addChartPage(chart: ChartData): void {
    this.currentY = this.style.margin.top;

    // 图表标题
    this.doc.setFontSize(this.style.subtitleFontSize);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text(chart.title, this.style.margin.left, this.currentY);
    this.currentY += 10;

    // 图表描述
    if (chart.description) {
      this.doc.setFontSize(this.style.bodyFontSize);
      this.doc.setFont('helvetica', 'normal');
      this.doc.text(chart.description, this.style.margin.left, this.currentY);
      this.currentY += 8;
    }

    // 图表图片
    if (chart.imageDataURL) {
      try {
        const maxWidth = this.pageWidth - this.style.margin.left - this.style.margin.right;
        const maxHeight = this.pageHeight - this.currentY - this.style.margin.bottom - 20;

        // 添加图片（自动调整尺寸）
        this.doc.addImage(
          chart.imageDataURL,
          'PNG',
          this.style.margin.left,
          this.currentY,
          maxWidth,
          maxHeight
        );
      } catch (error) {
        logger.error('Failed to add chart image:', error);
        this.doc.text('图表加载失败', this.style.margin.left, this.currentY);
      }
    }

    this.addFooter();
  }

  /**
   * 添加表格页
   */
  private addTablePage(table: TableData): void {
    this.currentY = this.style.margin.top;

    // 表格标题
    this.doc.setFontSize(this.style.subtitleFontSize);
    this.doc.setFont('helvetica', 'bold');
    this.doc.text(table.title, this.style.margin.left, this.currentY);
    this.currentY += 10;

    // 使用 autoTable 生成表格
    autoTable(this.doc, {
      startY: this.currentY,
      head: [table.headers],
      body: table.rows,
      margin: { left: this.style.margin.left, right: this.style.margin.right },
      styles: {
        fontSize: this.style.bodyFontSize - 2,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [41, 128, 185],
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
    });

    this.addFooter();
  }

  /**
   * 添加新页面
   */
  private addPage(): void {
    this.doc.addPage();
    this.currentY = this.style.margin.top;
  }

  /**
   * 添加页脚
   */
  private addFooter(): void {
    const footerY = this.pageHeight - this.style.margin.bottom + 5;

    // 页码
    if (this.config.options.includePageNumber) {
      const pageNumber = `${this.doc.getCurrentPageInfo().pageNumber}`;
      this.doc.setFontSize(10);
      this.doc.setFont('helvetica', 'normal');
      this.doc.text(pageNumber, this.pageWidth / 2, footerY, { align: 'center' });
    }

    // 自定义页脚文字
    if (this.config.branding?.footer) {
      this.doc.setFontSize(8);
      this.doc.text(
        this.config.branding.footer,
        this.style.margin.left,
        footerY
      );
    }

    // 水印
    if (this.config.options.includeWatermark && this.config.options.watermarkText) {
      this.addWatermark(this.config.options.watermarkText);
    }
  }

  /**
   * 添加水印
   */
  private addWatermark(text: string): void {
    this.doc.saveGraphicsState();
    const GStateCtor = (this.doc as any).GState as any;
    this.doc.setGState(new GStateCtor({ opacity: 0.1 }));
    this.doc.setFontSize(60);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setTextColor(200, 200, 200);
    this.doc.text(
      text,
      this.pageWidth / 2,
      this.pageHeight / 2,
      {
        align: 'center',
        angle: 45,
      }
    );
    this.doc.restoreGraphicsState();
  }
}

/**
 * 快速导出PDF（便捷方法）
 */
export async function exportToPDF(
  config: ExportConfig,
  content: ExportContent,
  onProgress?: (progress: ExportProgress) => void
): Promise<ExportResult> {
  const exporter = new PDFExporter(config);
  return exporter.generate(content, onProgress);
}
