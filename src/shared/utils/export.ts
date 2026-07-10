/**
 * Data Export Utilities
 * Supports CSV and Excel export for dashboard data
 */

import { createLogger } from './logger';
import type { ExportDataRow } from '../types/data';

const logger = createLogger('export');

/**
 * Export array of objects to CSV
 * @param data - Array of objects
 * @param filename - Filename for download
 */
export function exportArrayToCSV(data: ExportDataRow[], filename: string = 'data.csv'): void {
  if (data.length === 0) {
    logger.warn('No data to export');
    return;
  }

  // Get all unique keys from all objects
  const allKeys = new Set<string>();
  data.forEach(obj => {
    Object.keys(obj).forEach(key => allKeys.add(key));
  });
  const columns = Array.from(allKeys);

  // Build CSV content
  const csvRows: string[] = [];

  // Header row
  csvRows.push(columns.map(escapeCSVField).join(','));

  // Data rows
  data.forEach(obj => {
    const values = columns.map(col => escapeCSVField(obj[col] ?? ''));
    csvRows.push(values.join(','));
  });

  const csvContent = csvRows.join('\n');

  // Trigger download
  downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
}

/**
 * Escape CSV field (handle commas, quotes, newlines)
 */
export function escapeCSVField(value: ExportDataRow[string]): string {
  if (value === null || value === undefined) {
    return '';
  }

  let stringValue = String(value);

  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    stringValue = '"' + stringValue.replace(/"/g, '""') + '"';
  }

  return stringValue;
}

/**
 * Trigger browser download of file (prepends UTF-8 BOM for Excel compatibility)
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  // Add BOM for UTF-8 to ensure proper encoding in Excel
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Export data to Excel (requires exceljs library)
 *
 * @param data - Array of objects
 * @param filename - Filename (without extension)
 * @param sheetName - Excel sheet name
 */
export async function exportToExcel(
  data: ExportDataRow[],
  filename: string = 'data',
  sheetName: string = 'Sheet1'
): Promise<void> {
  try {
    const ExcelJS = await import('exceljs');

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    const rows = data;

    if (rows.length === 0) {
      logger.warn('No data to export');
      return;
    }

    const columns = Object.keys(rows[0]);

    worksheet.columns = columns.map(col => ({
      header: col,
      key: col,
      width: 15,
    }));

    rows.forEach(row => worksheet.addRow(row));

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.xlsx`;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    logger.info(`Excel file exported: ${filename}.xlsx`);
  } catch (error) {
    logger.warn('ExcelJS not available, falling back to CSV export');
    logger.error('Excel export failed', error);

    exportArrayToCSV(data, `${filename}.csv`);
  }
}

/**
 * Format current date for filenames
 * @returns String like "20250107_143022"
 */
export function getTimestampForFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}
