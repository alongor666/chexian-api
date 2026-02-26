import { createLogger } from '../shared/utils/logger';
import { createExportIgnoreElements } from '../shared/export/ignoreElements';

const logger = createLogger('PdfExportService');

export class PdfExportService {
  /**
   * Export a DOM element to PDF
   * @param elementId DOM element ID to capture
   * @param title PDF title and filename
   */
  static async exportDashboardToPdf(elementId: string, title: string): Promise<void> {
    try {
      const element = document.getElementById(elementId);
      if (!element) {
        throw new Error(`Element not found: ${elementId}`);
      }

      logger.info('Starting PDF export...');

      // Lazy-load heavy libs only when the user actually requests a PDF export
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      // Capture the element
      const canvas = await html2canvas(element, {
        scale: 2, // Higher scale for better resolution
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc', // Match dashboard background
        ignoreElements: createExportIgnoreElements(),
      });

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const contentTop = 20;
      const contentHeight = pdfHeight - contentTop;
      const pxPerMm = canvas.width / pdfWidth;
      const pageHeightPx = Math.max(1, Math.floor(contentHeight * pxPerMm));

      // Add title
      pdf.setFontSize(16);
      pdf.text(title, 14, 15);
      
      const dateStr = new Date().toLocaleString();
      pdf.setFontSize(10);
      pdf.text(`生成时间: ${dateStr}`, pdfWidth - 14, 15, { align: 'right' });

      // 按页面内容高度对原始 canvas 切片，避免长页面导出时出现截断/重叠。
      let renderedHeightPx = 0;
      let pageIndex = 0;

      while (renderedHeightPx < canvas.height) {
        const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedHeightPx);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        const context = pageCanvas.getContext('2d');

        if (!context) {
          throw new Error('Failed to get 2D context for PDF page canvas');
        }

        context.drawImage(
          canvas,
          0,
          renderedHeightPx,
          canvas.width,
          sliceHeightPx,
          0,
          0,
          canvas.width,
          sliceHeightPx
        );

        if (pageIndex > 0) {
          // 新页沿用相同顶部留白，确保视觉一致。
          pdf.addPage();
        }

        const pageImageData = pageCanvas.toDataURL('image/png');
        const sliceHeightMm = sliceHeightPx / pxPerMm;
        pdf.addImage(pageImageData, 'PNG', 0, contentTop, pdfWidth, sliceHeightMm);

        renderedHeightPx += sliceHeightPx;
        pageIndex += 1;
      }

      pdf.save(`${title}_${new Date().toISOString().slice(0, 10)}.pdf`);
      logger.info('PDF export completed');

    } catch (error) {
      logger.error('PDF export failed', error);
      throw error;
    }
  }
}
