/**
 * 系数监控明细表组件
 *
 * 【性能优化】使用虚拟滚动(react-window)处理大量数据行
 * 显示所有机构的系数明细数据
 * 样式：基于增长分析表格最佳实践（统一样式配置）
 */

import { memo, useCallback, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import type { CoefficientRow } from '../hooks/useCoefficientMonitor';
import {
  CUSTOMER_CATEGORY_LABELS,
  formatFactor,
  formatRatio,
  formatGapPremium,
  getGapPremiumStyle,
  getComplianceStyle,
  getRowBackground,
  getCarAgeLabel,
  formatPeriodType,
} from '../utils/formatters';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';
import { fontStyles } from '../../../shared/styles';

interface CoefficientDetailTableProps {
  /** 数据行 */
  data: CoefficientRow[];
  /** 统计信息 */
  stats: {
    total: number;
    compliant: number;
    exceeded: number;
    pending: number;
  };
  /** 周期标签 */
  periodLabels: {
    general: string;
    special: string;
    monthly: string;
  };
  /** 启用虚拟滚动的阈值（默认50行以上启用） */
  virtualScrollThreshold?: number;
  /** 虚拟列表高度（默认400px） */
  virtualListHeight?: number;
}

// ========== 列宽配置 ==========
const COLUMN_WIDTHS = {
  org: 120,
  energy: 70,
  category: 100,
  carAge: 60,
  dayFactor: 80,
  weekFactor: 80,
  monthFactor: 80,
  yearFactor: 80,
  threshold: 80,
  ratio: 90,
  gap: 100,
  compliance: 70,
  periodType: 70,
};

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;

// ========== 虚拟行组件 ==========
interface VirtualRowProps {
  index: number;
  style: React.CSSProperties;
  data: CoefficientRow[];
}

const VirtualRow = memo<VirtualRowProps>(({ index, style, data }) => {
  const row = data[index];
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: getRowBackground(row),
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      <div style={{ width: COLUMN_WIDTHS.org, padding: '0 8px', fontWeight: 500 }}>
        {row.orgLevel3}
      </div>
      <div style={{ width: COLUMN_WIDTHS.energy, padding: '0 8px', textAlign: 'center' }}>
        {row.isNev ? '新能源' : '燃油'}
      </div>
      <div style={{ width: COLUMN_WIDTHS.category, padding: '0 8px', textAlign: 'center' }}>
        {CUSTOMER_CATEGORY_LABELS[row.customerCategoryGroup] || row.customerCategoryGroup}
      </div>
      <div style={{ width: COLUMN_WIDTHS.carAge, padding: '0 8px', textAlign: 'center' }}>
        {getCarAgeLabel(row)}
      </div>
      <div className={fontStyles.numeric} style={{ width: COLUMN_WIDTHS.dayFactor, padding: '0 8px', textAlign: 'right' }}>
        {formatFactor(row.dayFactor)}
      </div>
      <div className={fontStyles.numeric} style={{ width: COLUMN_WIDTHS.weekFactor, padding: '0 8px', textAlign: 'right' }}>
        {formatFactor(row.weekFactor)}
      </div>
      <div className={fontStyles.numeric} style={{ width: COLUMN_WIDTHS.monthFactor, padding: '0 8px', textAlign: 'right' }}>
        {formatFactor(row.monthFactor)}
      </div>
      <div className={fontStyles.numeric} style={{ width: COLUMN_WIDTHS.yearFactor, padding: '0 8px', textAlign: 'right' }}>
        {formatFactor(row.yearFactor)}
      </div>
      <div style={{ width: COLUMN_WIDTHS.threshold, padding: '0 8px', textAlign: 'center' }}>
        {row.thresholdDisplay}
      </div>
      <div className={fontStyles.numeric} style={{ width: COLUMN_WIDTHS.ratio, padding: '0 8px', textAlign: 'right' }}>
        {formatRatio(row.weekThresholdRatio)}
      </div>
      <div
        className={fontStyles.numeric}
        style={{
          width: COLUMN_WIDTHS.gap,
          padding: '0 8px',
          textAlign: 'right',
          ...getGapPremiumStyle(row.gapPremium),
        }}
      >
        {formatGapPremium(row.gapPremium)}
      </div>
      <div
        style={{
          width: COLUMN_WIDTHS.compliance,
          padding: '0 8px',
          textAlign: 'center',
          ...getComplianceStyle(row.isCompliant),
        }}
      >
        {row.isCompliant === null ? '待定' : row.isCompliant ? '合规' : '超限'}
      </div>
      <div style={{ width: COLUMN_WIDTHS.periodType, padding: '0 8px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
        {formatPeriodType(row.periodType)}
      </div>
    </div>
  );
});

VirtualRow.displayName = 'VirtualRow';

// ========== 传统表格行组件 ==========
interface DetailTableRowProps {
  row: CoefficientRow;
  index: number;
}

const DetailTableRow = memo<DetailTableRowProps>(({ row, index }) => (
  <tr
    key={`${row.orgLevel3}-${row.isNev}-${row.customerCategoryGroup}-${row.isNewCar}-${index}`}
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
));

DetailTableRow.displayName = 'DetailTableRow';

// ========== 表头组件（虚拟滚动版） ==========
const VirtualTableHeader = memo(() => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      height: HEADER_HEIGHT,
      backgroundColor: '#f9fafb',
      borderBottom: '1px solid #e5e7eb',
      fontWeight: 500,
      fontSize: '14px',
    }}
  >
    <div style={{ width: COLUMN_WIDTHS.org, padding: '0 8px' }}>地域/机构</div>
    <div style={{ width: COLUMN_WIDTHS.energy, padding: '0 8px', textAlign: 'center' }}>能源类型</div>
    <div style={{ width: COLUMN_WIDTHS.category, padding: '0 8px', textAlign: 'center' }}>客户类别</div>
    <div style={{ width: COLUMN_WIDTHS.carAge, padding: '0 8px', textAlign: 'center' }}>车龄</div>
    <div style={{ width: COLUMN_WIDTHS.dayFactor, padding: '0 8px', textAlign: 'center' }}>当天系数</div>
    <div style={{ width: COLUMN_WIDTHS.weekFactor, padding: '0 8px', textAlign: 'center' }}>当周系数</div>
    <div style={{ width: COLUMN_WIDTHS.monthFactor, padding: '0 8px', textAlign: 'center' }}>当月系数</div>
    <div style={{ width: COLUMN_WIDTHS.yearFactor, padding: '0 8px', textAlign: 'center' }}>当年系数</div>
    <div style={{ width: COLUMN_WIDTHS.threshold, padding: '0 8px', textAlign: 'center' }}>监管阈值</div>
    <div style={{ width: COLUMN_WIDTHS.ratio, padding: '0 8px', textAlign: 'center' }}>当周与阈值差</div>
    <div style={{ width: COLUMN_WIDTHS.gap, padding: '0 8px', textAlign: 'center' }}>缺口保费</div>
    <div style={{ width: COLUMN_WIDTHS.compliance, padding: '0 8px', textAlign: 'center' }}>合规状态</div>
    <div style={{ width: COLUMN_WIDTHS.periodType, padding: '0 8px', textAlign: 'center' }}>周期类型</div>
  </div>
));

VirtualTableHeader.displayName = 'VirtualTableHeader';

/**
 * 系数监控明细表（支持虚拟滚动）
 */
export const CoefficientDetailTable = memo<CoefficientDetailTableProps>(({
  data,
  stats,
  periodLabels,
  virtualScrollThreshold = 50,
  virtualListHeight = 400,
}) => {
  // 默认排序：超限行在前（缺口保费大→问题严重），合规行在后，按缺口保费从大到小
  const sortedData = useMemo(() =>
    data.slice().sort((a, b) => {
      const isAgg = (r: CoefficientRow) => /成都|全省|异地/.test(r.orgLevel3 ?? '');
      if (isAgg(a) && !isAgg(b)) return -1;
      if (!isAgg(a) && isAgg(b)) return 1;
      // 超限（false）排在合规（true）前，待定（null）最后
      const complianceOrder = (v: boolean | null) => v === false ? 0 : v === true ? 1 : 2;
      const cmp = complianceOrder(a.isCompliant) - complianceOrder(b.isCompliant);
      if (cmp !== 0) return cmp;
      return (b.gapPremium ?? 0) - (a.gapPremium ?? 0);
    }),
    [data]
  );

  // 判断是否使用虚拟滚动
  const useVirtualScroll = sortedData.length > virtualScrollThreshold;

  // 计算表格总宽度
  const totalWidth = useMemo(() =>
    Object.values(COLUMN_WIDTHS).reduce((sum, w) => sum + w, 0),
    []
  );

  // 虚拟行渲染函数
  const renderVirtualRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => (
      <VirtualRow index={index} style={style} data={sortedData} />
    ),
    [sortedData]
  );

  return (
    <div>
      {useVirtualScroll ? (
        // 虚拟滚动表格
        <div className="border border-neutral-200 rounded-lg overflow-hidden">
          <div style={{ minWidth: totalWidth, overflowX: 'auto' }}>
            <VirtualTableHeader />
            <List
              height={virtualListHeight}
              itemCount={sortedData.length}
              itemSize={ROW_HEIGHT}
              width="100%"
              itemData={sortedData}
            >
              {renderVirtualRow}
            </List>
          </div>
          <div className="px-3 py-2 bg-neutral-50 text-xs text-neutral-500 border-t">
            显示 {Math.min(Math.floor(virtualListHeight / ROW_HEIGHT), data.length)} / {data.length} 行（虚拟滚动）
          </div>
        </div>
      ) : (
        // 传统表格
        <div className={TABLE_CSS_CLASSES.container}>
          <table className={TABLE_CSS_CLASSES.table}>
            <thead className={TABLE_CSS_CLASSES.thead}>
              <tr>
                <th className={TABLE_CSS_CLASSES.headerCell}>地域/机构</th>
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
              {sortedData.map((row, index) => (
                <DetailTableRow
                  key={`${row.orgLevel3}-${row.isNev}-${row.customerCategoryGroup}-${row.isNewCar}-${index}`}
                  row={row}
                  index={index}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm text-neutral-500">
        <div>
          共 {stats.total} 条记录 | 合规 {stats.compliant} 条 | 超限{' '}
          {stats.exceeded} 条 | 待定 {stats.pending} 条
        </div>
        <div>
          一般周期: {periodLabels.general} | 特殊周期: {periodLabels.special}{' '}
          | 月度周期: {periodLabels.monthly}
        </div>
      </div>
    </div>
  );
});

CoefficientDetailTable.displayName = 'CoefficientDetailTable';
