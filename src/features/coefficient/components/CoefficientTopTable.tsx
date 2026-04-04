/**
 * 系数监控置顶表格组件
 *
 * 显示全省/成都等特定地域的系数数据
 * 样式：基于增长分析表格最佳实践（统一样式配置）
 */

import { memo } from 'react';
import type { CoefficientRow } from '../hooks/useCoefficientMonitor';
import {
  CUSTOMER_CATEGORY_LABELS,
  formatFactor,
  formatRatio,
  formatGapPremium,
  getGapPremiumStyle,
  getComplianceStyle,
  getCarAgeLabel,
  formatPeriodType,
} from '../utils/formatters';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';

interface CoefficientTopTableProps {
  /** 表格标题 */
  title: string;
  /** 数据行 */
  rows: CoefficientRow[];
  /** 行背景色 */
  backgroundColor: string;
  /** 地域显示名称 */
  regionName: string;
}

/**
 * 系数监控置顶表格
 */
export const CoefficientTopTable = memo<CoefficientTopTableProps>(({
  title,
  rows,
  backgroundColor,
  regionName,
}) => {
  if (rows.length === 0) {
    return (
      <div className="mb-6">
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <div className="text-sm text-neutral-500 py-4 text-center">暂无数据</div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      <div className={TABLE_CSS_CLASSES.container}>
        <table className={TABLE_CSS_CLASSES.table}>
          <thead className={TABLE_CSS_CLASSES.thead}>
            <tr>
              <th className={TABLE_CSS_CLASSES.headerCell}>地域</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>能源类型</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>客户类别</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>车龄</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当天系数</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当周系数</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当月系数</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当年系数</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>监管阈值</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>当周与阈值差</th>
              <th className={TABLE_CSS_CLASSES.headerCellRight}>缺口保费</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>合规状态</th>
              <th className={`${TABLE_CSS_CLASSES.headerCell} text-center`}>周期类型</th>
            </tr>
          </thead>
          <tbody className={TABLE_CSS_CLASSES.tbody}>
            {rows.slice().sort((a, b) => (a.weekFactor ?? 0) - (b.weekFactor ?? 0)).map((row, index) => (
              <tr
                key={`${regionName}-${row.isNev}-${row.customerCategoryGroup}-${row.isNewCar}-${row.scenario}-${index}`}
                className={TABLE_CSS_CLASSES.row}
                style={{ backgroundColor }}
              >
                <td className={`${TABLE_CSS_CLASSES.cell} font-medium`}>{regionName}</td>
                <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>
                  {row.isNev ? '新能源' : '燃油'}
                </td>
                <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>
                  {CUSTOMER_CATEGORY_LABELS[row.customerCategoryGroup] || row.customerCategoryGroup}
                </td>
                <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>{getCarAgeLabel(row)}</td>
                <td className={TABLE_CSS_CLASSES.cellRight}>
                  {formatFactor(row.dayFactor)}
                </td>
                <td className={TABLE_CSS_CLASSES.cellRight}>
                  {formatFactor(row.weekFactor)}
                </td>
                <td className={TABLE_CSS_CLASSES.cellRight}>
                  {formatFactor(row.monthFactor)}
                </td>
                <td className={TABLE_CSS_CLASSES.cellRight}>
                  {formatFactor(row.yearFactor)}
                </td>
                <td className={`${TABLE_CSS_CLASSES.cell} text-center`}>{row.thresholdDisplay}</td>
                <td className={TABLE_CSS_CLASSES.cellRight}>
                  {formatRatio(row.weekThresholdRatio)}
                </td>
                <td
                  className={TABLE_CSS_CLASSES.cellRight}
                  style={getGapPremiumStyle(row.gapPremium)}
                >
                  {formatGapPremium(row.gapPremium)}
                </td>
                <td
                  className={`${TABLE_CSS_CLASSES.cell} text-center`}
                  style={getComplianceStyle(row.isCompliant)}
                >
                  {row.isCompliant === null ? '待定' : row.isCompliant ? '合规' : '超限'}
                </td>
                <td className={`${TABLE_CSS_CLASSES.cellSecondary} text-center`}>
                  {formatPeriodType(row.periodType)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

CoefficientTopTable.displayName = 'CoefficientTopTable';
