/**
 * 单周期数据表组件
 *
 * 显示单个周期（1-7日、8-14日等）的系数监控数据
 * 作为4个周期子表的基础组件
 * 样式：基于增长分析表格最佳实践（统一样式配置）
 *
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 提取 TableRow 组件并 memo 化
 * - 使用 useMemo 缓存统计计算
 */

import React, { useMemo, memo, useState, useCallback } from 'react';
import { type CoefficientRow } from '../hooks/useCoefficientMonitor';
import { CUSTOMER_CATEGORY_LABELS } from '../../../shared/config/coefficient-thresholds';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';
import { formatCoefficient, formatCurrency, formatPremiumWan } from '../../../shared/utils/formatters';
import { colorClasses } from '../../../shared/styles';

/**
 * 格式化系数值（4位小数）
 * 使用全局 formatCoefficient
 */
const formatFactor = (val: number | null | undefined): string => {
  return formatCoefficient(val);
};

/**
 * 格式化比例（阈值差值，4位小数，带符号）
 */
const formatThresholdRatio = (val: number | null | undefined): string => {
  if (val === null || val === undefined) return '-';
  if (!Number.isFinite(val)) return '-';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCoefficient(Math.abs(val))}`;
};

/**
 * 格式化缺口保费（万元，2位小数，带符号）
 */
const formatGapPremium = (val: number | null | undefined): string => {
  if (val === null || val === undefined) return '-';
  if (!Number.isFinite(val)) return '-';
  const wanYuan = val / 10000;
  const sign = wanYuan >= 0 ? '+' : '';
  return `${sign}${formatCurrency(Math.abs(wanYuan))}万`;
};

/**
 * 格式化保费（万元，整数，千分位）
 * 使用全局 formatPremiumWan
 */
const formatPremium = (val: number | null | undefined): string => {
  if (val === null || val === undefined) return '-';
  return formatPremiumWan(val) + '万';
};

// 获取行背景色
const getRowBackground = (row: CoefficientRow): string => {
  if (row.orgLevel3 === '成都') {
    return '#fff3cd';
  }
  if (row.orgLevel3 === '全省') {
    return '#e0f2fe';
  }
  return '#ffffff';
};

// 获取合规状态样式
const getComplianceStyle = (isCompliant: boolean | null): React.CSSProperties => {
  if (isCompliant === null) {
    return { color: '#9ca3af', fontStyle: 'italic' };
  }
  if (isCompliant) {
    return { color: '#16a34a', fontWeight: 'bold' };
  }
  return { color: '#dc2626', fontWeight: 'bold' };
};

// 获取缺口保费样式
const getGapPremiumStyle = (val: number | null | undefined): React.CSSProperties => {
  if (val === null || val === undefined) return { color: '#9ca3af' };
  return val > 0
    ? { color: '#dc2626', fontWeight: 'bold' }
    : { color: '#16a34a', fontWeight: 'bold' };
};

// 获取车龄显示文本
const getCarAgeLabel = (row: CoefficientRow): string => {
  if (row.scenario === 'transfer') {
    return '旧车转保';
  }
  if (row.isNewCar === null) {
    return '全部';
  }
  return row.isNewCar ? '新车' : '旧车';
};

// ========== 优化：提取行组件并 memo 化 ==========
interface TableRowProps {
  row: CoefficientRow;
  index: number;
}

const TableRow = memo<TableRowProps>(({ row, index }) => (
  <tr
    key={`${row.orgLevel3}-${row.isNev}-${row.customerCategoryGroup}-${row.isNewCar}-${row.scenario}-${index}`}
    className={TABLE_CSS_CLASSES.row}
    style={{ backgroundColor: getRowBackground(row) }}
  >
    <td className={`${TABLE_CSS_CLASSES.cell} font-medium`}>{row.orgLevel3}</td>
    <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>
      {row.isNev ? '新能源' : '燃油'}
    </td>
    <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>
      {CUSTOMER_CATEGORY_LABELS[row.customerCategoryGroup] || row.customerCategoryGroup}
    </td>
    <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>
      {getCarAgeLabel(row)}
    </td>
    <td className={TABLE_CSS_CLASSES.cellRight}>
      {formatFactor(row.weekFactor)}
    </td>
    <td className={TABLE_CSS_CLASSES.cellRight}>
      {formatPremium(row.weekPremium)}
    </td>
    <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>
      {row.thresholdDisplay}
    </td>
    <td className={TABLE_CSS_CLASSES.cellRight}>
      {formatThresholdRatio(row.weekThresholdRatio)}
    </td>
    <td className={TABLE_CSS_CLASSES.cellRight} style={getGapPremiumStyle(row.gapPremium)}>
      {formatGapPremium(row.gapPremium)}
    </td>
    <td className={`${TABLE_CSS_CLASSES.cell} text-center`} style={getComplianceStyle(row.isCompliant)}>
      {row.isCompliant === null ? '待定' : row.isCompliant ? '合规' : '超限'}
    </td>
  </tr>
));

TableRow.displayName = 'TableRow';

// 聚合行判断：成都、异地、全省
const isAggregateRow = (row: CoefficientRow): boolean => {
  return row.orgLevel3 === '成都' || row.orgLevel3 === '异地' || row.orgLevel3 === '全省';
};

interface CoefficientPeriodTableProps {
  periodName: string;
  rows: CoefficientRow[];
  startDate: Date;
  endDate: Date;
}

/**
 * 单周期数据表组件（性能优化版）
 *
 * 交互逻辑：
 * - 首次载入只显示聚合行（成都、异地）
 * - 点击"查看明细"展开三级机构明细
 */
const CoefficientPeriodTableInner: React.FC<CoefficientPeriodTableProps> = ({
  periodName,
  rows,
  startDate,
  endDate,
}) => {
  const formatDateStr = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;

  // 展开状态：false=只显示聚合，true=显示全部明细
  const [expanded, setExpanded] = useState(false);

  // 分离聚合行和明细行
  const { aggregateRows, detailRows } = useMemo(() => {
    const aggregate: CoefficientRow[] = [];
    const detail: CoefficientRow[] = [];

    for (const row of rows) {
      if (isAggregateRow(row)) {
        aggregate.push(row);
      } else {
        detail.push(row);
      }
    }

    // 明细行按当周系数从小到大排序（系数低=差，排前面）
    const sortedDetail = detail.slice().sort((a, b) => (a.weekFactor ?? 0) - (b.weekFactor ?? 0));
    return { aggregateRows: aggregate, detailRows: sortedDetail };
  }, [rows]);

  // 当前显示的行（展开时：聚合行在前 + 明细行已排序；折叠时：仅聚合行）
  const displayRows = useMemo(() => {
    return expanded ? [...aggregateRows, ...detailRows] : aggregateRows;
  }, [expanded, aggregateRows, detailRows]);

  // 使用 useMemo 缓存统计计算
  const stats = useMemo(() => ({
    compliant: rows.filter(r => r.isCompliant === true).length,
    exceeded: rows.filter(r => r.isCompliant === false).length,
    pending: rows.filter(r => r.isCompliant === null).length,
  }), [rows]);

  // 切换展开状态
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  // 无数据提示
  if (rows.length === 0) {
    return (
      <div className={`mb-6 p-4 rounded border ${colorClasses.bg.neutral} ${colorClasses.border.neutral}`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className={`font-semibold ${colorClasses.text.neutral}`}>
            {periodName}（{formatDateStr(startDate)} - {formatDateStr(endDate)}）
          </h3>
        </div>
        <div className={`text-center ${colorClasses.text.neutralMuted} py-4`}>
          该周期暂无数据
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-6 bg-white dark:bg-neutral-800 rounded border ${colorClasses.border.neutral}`}>
      {/* 周期标题 */}
      <div className={`${colorClasses.bg.primary} px-4 py-2 border-b ${colorClasses.border.neutral} flex justify-between items-center`}>
        <h3 className={`font-semibold ${colorClasses.text.neutral}`}>
          {periodName}（{formatDateStr(startDate)} - {formatDateStr(endDate)}）
          <span className={`ml-2 text-sm font-normal ${colorClasses.text.neutralMuted}`}>
            {expanded ? `共 ${rows.length} 条` : `聚合 ${aggregateRows.length} 条`}
            {!expanded && detailRows.length > 0 && (
              <span className={colorClasses.text.neutralMuted}>（明细 {detailRows.length} 条）</span>
            )}
          </span>
        </h3>
        {/* 展开/收起按钮 */}
        {detailRows.length > 0 && (
          <button
            onClick={toggleExpanded}
            className={`px-3 py-1 text-sm bg-white dark:bg-neutral-700 border ${colorClasses.border.neutral} rounded hover:bg-neutral-50 dark:hover:bg-neutral-600 dark:text-neutral-300 transition-colors`}
          >
            {expanded ? '收起明细 ▲' : '查看明细 ▼'}
          </button>
        )}
      </div>

      {/* 数据表格 */}
      <div className={TABLE_CSS_CLASSES.container}>
        <table className={TABLE_CSS_CLASSES.table}>
          <thead className={TABLE_CSS_CLASSES.thead}>
            <tr>
              <th className={TABLE_CSS_CLASSES.headerCell}>地域/机构</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>能源类型</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>客户类别</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>车龄</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当周系数</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当周保费</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>监管阈值</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当周与阈值差</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>缺口保费</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>合规状态</th>
            </tr>
          </thead>
          <tbody className={TABLE_CSS_CLASSES.tbody}>
            {displayRows.map((row, index) => (
              <TableRow key={`${row.orgLevel3}-${row.isNev}-${row.customerCategoryGroup}-${row.isNewCar}-${row.scenario}-${index}`} row={row} index={index} />
            ))}
          </tbody>
        </table>
      </div>

      {/* 周期统计 */}
      <div className={`px-4 py-2 ${colorClasses.bg.neutral} border-t ${colorClasses.border.neutral} text-xs ${colorClasses.text.neutralMuted} flex justify-between`}>
        <div>
          {expanded ? (
            <>
              合规 {stats.compliant} 条 |
              超限 {stats.exceeded} 条 |
              待定 {stats.pending} 条
            </>
          ) : (
            <>显示聚合数据（成都、异地）</>
          )}
        </div>
        {!expanded && detailRows.length > 0 && (
          <button
            onClick={toggleExpanded}
            className={`${colorClasses.text.primary} hover:underline`}
          >
            点击查看 {detailRows.length} 条机构明细 →
          </button>
        )}
      </div>
    </div>
  );
};

// 导出 memo 化的组件
export const CoefficientPeriodTable = memo(CoefficientPeriodTableInner);
