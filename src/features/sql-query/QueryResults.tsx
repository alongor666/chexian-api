/**
 * QueryResults 组件
 *
 * 查询结果展示、分页、导出
 */

import { useMemo, useState } from 'react';
import { VirtualTable, type Column } from '../../widgets/table/VirtualTable';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../shared/utils/export';
import { formatCount, formatCurrency, formatPercent } from '../../shared/utils/formatters';
import type { QueryResult } from '../../shared/types/sql-query';

export interface QueryResultsProps {
  /** 查询结果 */
  result: QueryResult;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

/** 判断列是否为数值列（用于右对齐） */
const isNumericColumn = (key: string): boolean => {
  const numericKeywords = ['保费', '金额', '率', '%', '数', '量', '额', '成本', '价', '达成', '计划', '实际', '总', '均', '比例'];
  return numericKeywords.some(kw => key.includes(kw));
};

/** 判断列是否为保费类（万元格式化） */
const isPremiumColumn = (key: string): boolean => {
  const premiumKeywords = ['保费', '金额', '成本', '价'];
  return premiumKeywords.some(kw => key.includes(kw)) && !key.includes('率');
};

/** 判断列是否为百分比类 */
const isPercentColumn = (key: string): boolean => {
  const percentKeywords = ['率', '%', '达成', '比例'];
  return percentKeywords.some(kw => key.includes(kw));
};

/** 格式化单元格值 */
const formatCellValue = (value: unknown, columnKey: string): string => {
  if (value === null || value === undefined) return '-';

  // 数值处理
  const numValue = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isNaN(numValue) && Number.isFinite(numValue)) {
    // 百分比列（保留1位小数）
    if (isPercentColumn(columnKey)) {
      return formatPercent(numValue, 1);
    }
    // 保费类（保留2位小数）
    if (isPremiumColumn(columnKey)) {
      return formatCurrency(numValue);
    }
    // 普通数值（千分位，整数）
    return formatCount(numValue);
  }

  return String(value);
};

/**
 * 查询结果组件
 */
export function QueryResults({ result }: QueryResultsProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  /**
   * 将结果数据转换为显示格式
   */
  const { columns, allData } = useMemo(() => {
    if (!result.data || result.data.length === 0) {
      return { columns: [], allData: [] };
    }

    const firstRow = result.data[0];
    const colKeys = Object.keys(firstRow);

    // 构建列配置（带格式化和对齐）
    const cols: Column<Record<string, unknown>>[] = colKeys.map((key) => {
      const isNumeric = isNumericColumn(key);
      return {
        key,
        header: key,
        width: isNumeric ? 130 : 180,
        align: isNumeric ? 'right' : 'left',
        render: (value: unknown) => formatCellValue(value, key),
      };
    });

    // 保持原始数据类型，格式化在 render 中处理
    const data: Record<string, unknown>[] = result.data.map((row) => ({ ...row }));

    return { columns: cols, allData: data };
  }, [result.data]);

  /**
   * 分页数据
   */
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return allData.slice(startIndex, endIndex);
  }, [allData, currentPage, pageSize]);

  /**
   * 总页数
   */
  const totalPages = Math.ceil(allData.length / pageSize);

  /**
   * 导出 CSV
   */
  const handleExportCSV = () => {
    if (result.data) {
      const filename = `query_result_${getTimestampForFilename()}.csv`;
      exportArrayToCSV(allData, filename);
    }
  };

  /**
   * 导出 Excel
   */
  const handleExportExcel = async () => {
    if (result.data) {
      const filename = `query_result_${getTimestampForFilename()}`;
      await exportToExcel(allData, filename, 'Query Result');
    }
  };

  /**
   * 切换页码
   */
  const handlePageChange = (newPage: number) => {
    setCurrentPage(Math.max(1, Math.min(newPage, totalPages)));
  };

  /**
   * 切换每页大小
   */
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      {/* 元数据 & 操作栏 */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600 space-x-4">
          <span>
            行数: <strong className="text-gray-900">{formatCount(result.rowCount)}</strong>
          </span>
          <span>
            列数: <strong className="text-gray-900">{result.columnCount}</strong>
          </span>
          <span>
            执行时间:{' '}
            <strong className="text-gray-900">{formatCount(result.executionTime)} ms</strong>
          </span>
        </div>

        {/* 导出按钮 */}
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            导出 CSV
          </button>
          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            导出 Excel
          </button>
        </div>
      </div>

      {/* 数据表格 */}
      <VirtualTable columns={columns} data={paginatedData} height={500} rowHeight={35} />

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center bg-white border border-gray-200 rounded-md px-4 py-3">
          {/* 页码信息 */}
          <div className="text-sm text-gray-600">
            第 <strong>{currentPage}</strong> 页，共 <strong>{totalPages}</strong> 页 (
            {formatCount(allData.length)} 行)
          </div>

          {/* 分页按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              首页
            </button>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              上一页
            </button>
            <span className="px-2 text-sm text-gray-600">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              下一页
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              末页
            </button>
          </div>

          {/* 每页大小选择 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">每页:</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
