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

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

      // Add title
      pdf.setFontSize(16);
      pdf.text(title, 14, 15);
      
      const dateStr = new Date().toLocaleString();
      pdf.setFontSize(10);
      pdf.text(`生成时间: ${dateStr}`, pdfWidth - 14, 15, { align: 'right' });

      // If content is taller than page, we might need multiple pages or scaling
      // For dashboard, we usually fit width and let height expand (single page PDF usually has fixed size)
      // We will split into pages if too long
      
      let heightLeft = imgHeight;
      let position = 20; // Start below title

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= (pdfHeight - position);

      // Add pages if needed (simple implementation)
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`${title}_${new Date().toISOString().slice(0, 10)}.pdf`);
      logger.info('PDF export completed');

    } catch (error) {
      logger.error('PDF export failed', error);
      throw error;
    }
  }
}
