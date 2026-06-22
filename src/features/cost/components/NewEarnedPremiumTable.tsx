/**
 * 新口径已赚保费分析表格（V4版本 - 精算三角视图）
 * New Earned Premium Analysis Table V4 - Actuarial Triangle View
 *
 * 核心改进：
 * - 2025年保单：合并为单个精算三角表（起保月 × 统计月）
 * - 2026年保单：合并为单个精算三角表（起保月 × 统计月）
 * - 汇总统计：滚动12个月统计
 *
 * 拆分记录（主题C 超大文件拆分，2026-06-22）：
 * - 精算三角数据类型 + 数据合并函数 + 导出函数
 *   → src/features/cost/utils/earnedPremiumTransformers.ts
 * - PolicyTriangleTable 精算三角表格组件
 *   → src/features/cost/components/PolicyTriangleTable.tsx
 */

import React, { useMemo, useState, useCallback } from 'react';
import { VirtualTable, Column } from '../../../widgets/table/VirtualTable';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../../shared/utils/export';
import {
  tableStyles,
  textStyles,
  buttonStyles,
  cardStyles,
  badgeStyles,
  colorClasses,
  cn,
} from '../../../shared/styles';
import type {
  Policy2025In2025Data,
  Policy2025In2026Data,
  Policy2026In2026Data,
  Policy2026In2027Data,
  NewEarnedPremiumSummaryData,
} from '../types/costTypes';
import {
  merge2025PolicyData,
  merge2026PolicyData,
  transformSummaryData,
  transformToRolling12MonthCompare,
  getAvailableYears,
  transform2025TriangleForExport,
  transform2026TriangleForExport,
  type DisplaySummaryData,
  type Rolling12MonthCompareData,
} from '../utils/earnedPremiumTransformers';
import { PolicyTriangleTable } from './PolicyTriangleTable';

interface NewEarnedPremiumTableProps {
  /** 2025年保单在2025年的已赚数据 */
  policy2025In2025Data: Policy2025In2025Data[];
  /** 2025年保单在2026年的已赚数据 */
  policy2025In2026Data: Policy2025In2026Data[];
  /** 2026年保单在2026年的已赚数据 */
  policy2026In2026Data: Policy2026In2026Data[];
  /** 2026年保单在2027年的已赚数据 */
  policy2026In2027Data: Policy2026In2027Data[];
  /** 汇总数据 */
  summaryData: NewEarnedPremiumSummaryData[];
  loading?: boolean;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
}

/** 主标签页类型 */
type MainTab = '2025' | '2026' | 'summary' | 'rolling12';

/**
 * 新口径已赚保费分析表格组件（V4版本 - 精算三角视图）
 */
export const NewEarnedPremiumTable: React.FC<NewEarnedPremiumTableProps> = ({
  policy2025In2025Data,
  policy2025In2026Data,
  policy2026In2026Data,
  policy2026In2027Data,
  summaryData,
  loading = false,
  onExportCSV,
  onExportExcel,
}) => {
  // 主标签页状态
  const [mainTab, setMainTab] = useState<MainTab>('2025');

  // 滚动12月对比表格的年度筛选状态
  const availableYears = useMemo(() => getAvailableYears(summaryData), [summaryData]);
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const years = getAvailableYears(summaryData);
    return years.length > 0 ? years[years.length - 1] : 2026; // 默认选择最新年度
  });

  // ==================== 数据合并 ====================

  const policy2025TriangleData = useMemo(
    () => merge2025PolicyData(policy2025In2025Data, policy2025In2026Data),
    [policy2025In2025Data, policy2025In2026Data]
  );

  const policy2026TriangleData = useMemo(
    () => merge2026PolicyData(policy2026In2026Data, policy2026In2027Data),
    [policy2026In2026Data, policy2026In2027Data]
  );

  const displaySummaryData = useMemo(
    () => transformSummaryData(summaryData),
    [summaryData]
  );

  // 滚动12月对比表格数据
  const rolling12MonthCompareData = useMemo(
    () => transformToRolling12MonthCompare(summaryData, selectedYear),
    [summaryData, selectedYear]
  );

  // 汇总表列配置
  const columnsSummary: Column<DisplaySummaryData>[] = useMemo(
    () => [
      { key: 'stat_month', header: '统计年月', width: 110 },
      { key: 'rolling_12m_premium', header: '滚动12月保费(万)', width: 140, align: 'right' },
      { key: 'earned_from_2025', header: '25保单已赚(万)', width: 130, align: 'right' },
      { key: 'earned_from_2026', header: '26保单已赚(万)', width: 130, align: 'right' },
      { key: 'total_earned_premium', header: '合计已赚(万)', width: 120, align: 'right' },
      { key: 'earned_ratio', header: '已赚率', width: 90, align: 'right' },
    ],
    []
  );

  // 滚动12月对比表格列配置
  const columnsRolling12: Column<Rolling12MonthCompareData>[] = useMemo(
    () => [
      { key: 'stat_month', header: '统计月', width: 100 },
      { key: 'window_range', header: '窗口范围', width: 120 },
      { key: 'policy_2025_months', header: `${selectedYear - 1}年保单`, width: 100, align: 'center' },
      { key: 'policy_2026_months', header: `${selectedYear}年保单`, width: 100, align: 'center' },
      { key: 'rolling_12m_premium', header: 'R12M保费(万)', width: 130, align: 'right' },
      { key: 'total_earned', header: 'R12M已赚(万)', width: 130, align: 'right' },
      { key: 'earned_ratio', header: '已赚率', width: 90, align: 'right' },
    ],
    [selectedYear]
  );

  // ==================== 精算三角导出处理 ====================

  const handleExport2025CSV = useCallback(() => {
    if (policy2025TriangleData.length === 0) return;
    const exportData = transform2025TriangleForExport(policy2025TriangleData);
    const filename = `2025年保单精算三角_${getTimestampForFilename()}.csv`;
    exportArrayToCSV(exportData, filename);
  }, [policy2025TriangleData]);

  const handleExport2025Excel = useCallback(async () => {
    if (policy2025TriangleData.length === 0) return;
    const exportData = transform2025TriangleForExport(policy2025TriangleData);
    const filename = `2025年保单精算三角_${getTimestampForFilename()}`;
    await exportToExcel(exportData, filename, '2025精算三角');
  }, [policy2025TriangleData]);

  const handleExport2026CSV = useCallback(() => {
    if (policy2026TriangleData.length === 0) return;
    const exportData = transform2026TriangleForExport(policy2026TriangleData);
    const filename = `2026年保单精算三角_${getTimestampForFilename()}.csv`;
    exportArrayToCSV(exportData, filename);
  }, [policy2026TriangleData]);

  const handleExport2026Excel = useCallback(async () => {
    if (policy2026TriangleData.length === 0) return;
    const exportData = transform2026TriangleForExport(policy2026TriangleData);
    const filename = `2026年保单精算三角_${getTimestampForFilename()}`;
    await exportToExcel(exportData, filename, '2026精算三角');
  }, [policy2026TriangleData]);

  // ==================== 空状态检查 ====================

  if (
    !loading &&
    policy2025In2025Data.length === 0 &&
    policy2025In2026Data.length === 0 &&
    policy2026In2026Data.length === 0 &&
    policy2026In2027Data.length === 0 &&
    summaryData.length === 0
  ) {
    return (
      <div className={cn(cardStyles.spacious, 'text-center', textStyles.caption)}>
        暂无数据
      </div>
    );
  }

  // ==================== 渲染表格内容 ====================

  const renderTableContent = () => {
    // 2025年保单精算三角
    if (mainTab === '2025') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                2025年保单精算三角（起保月 × 统计月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                <span className={cn('inline-block w-3 h-3 mr-1 align-middle', colorClasses.bg.success, colorClasses.border.success, 'border')}></span>
                <span className={cn('font-medium', colorClasses.text.success)}>起保月</span> 含首日费用 |
                <span className={cn(colorClasses.text.neutralMuted, 'ml-2')}>灰色0</span> = 三角区域外
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleExport2025CSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                  disabled={policy2025TriangleData.length === 0}
                >
                  导出CSV
                </button>
                <button
                  onClick={handleExport2025Excel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                  disabled={policy2025TriangleData.length === 0}
                >
                  导出Excel
                </button>
              </div>
              <span className={textStyles.caption}>共 {policy2025TriangleData.length} 条记录</span>
            </div>
          </div>
          <PolicyTriangleTable baseYear={2025} data={policy2025TriangleData} loading={loading} />
        </div>
      );
    }

    // 2026年保单精算三角
    if (mainTab === '2026') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                2026年保单精算三角（起保月 × 统计月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                <span className={cn('inline-block w-3 h-3 mr-1 align-middle', colorClasses.bg.success, colorClasses.border.success, 'border')}></span>
                <span className={cn('font-medium', colorClasses.text.success)}>起保月</span> 含首日费用 |
                <span className={cn(colorClasses.text.neutralMuted, 'ml-2')}>灰色0</span> = 三角区域外
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <button
                  onClick={handleExport2026CSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                  disabled={policy2026TriangleData.length === 0}
                >
                  导出CSV
                </button>
                <button
                  onClick={handleExport2026Excel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                  disabled={policy2026TriangleData.length === 0}
                >
                  导出Excel
                </button>
              </div>
              <span className={textStyles.caption}>共 {policy2026TriangleData.length} 条记录</span>
            </div>
          </div>
          <PolicyTriangleTable baseYear={2026} data={policy2026TriangleData} loading={loading} />
        </div>
      );
    }

    // 汇总统计
    if (mainTab === 'summary') {
      return (
        <div className={tableStyles.container}>
          <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
            <div>
              <h3 className={textStyles.titleSmall}>
                2026年各月末已赚保费汇总（滚动12个月）
              </h3>
              <p className={cn(textStyles.caption, 'mt-1')}>
                已赚率 = 合计已赚保费 / 滚动12个月保费（起保日期口径）
              </p>
            </div>
            <span className={textStyles.caption}>共 {summaryData.length} 条记录</span>
          </div>
          <VirtualTable<DisplaySummaryData>
            columns={columnsSummary}
            data={displaySummaryData}
            loading={loading}
            height={Math.max(200, displaySummaryData.length * 40 + 60)}
            rowHeight={40}
          />
        </div>
      );
    }

    // 滚动12个月已赚保费对比表
    return (
      <div className={tableStyles.container}>
        <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
          <div>
            <h3 className={textStyles.titleSmall}>
              滚动12个月已赚保费（{selectedYear}年各月末统计）
            </h3>
            <p className={cn(textStyles.caption, 'mt-1')}>
              窗口范围：统计月往前推12个月 | 保单参与月数：窗口内起保的月份数
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* 年度筛选器 */}
            <div className="flex items-center gap-2">
              <span className={textStyles.caption}>统计年度:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md border',
                  colorClasses.border.neutral,
                  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'
                )}
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}年
                  </option>
                ))}
              </select>
            </div>
            <span className={textStyles.caption}>共 {rolling12MonthCompareData.length} 条记录</span>
          </div>
        </div>
        <VirtualTable<Rolling12MonthCompareData>
          columns={columnsRolling12}
          data={rolling12MonthCompareData}
          loading={loading}
          height={Math.max(200, rolling12MonthCompareData.length * 40 + 60)}
          rowHeight={40}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 主标签页切换 + 导出按钮 */}
      <div className={cardStyles.standard}>
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <button
              onClick={() => setMainTab('2025')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === '2025' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              2025年保单
            </button>
            <button
              onClick={() => setMainTab('2026')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === '2026' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              2026年保单
            </button>
            <button
              onClick={() => setMainTab('summary')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === 'summary' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              汇总统计
            </button>
            <button
              onClick={() => setMainTab('rolling12')}
              className={cn(
                buttonStyles.base,
                buttonStyles.sizeMedium,
                mainTab === 'rolling12' ? buttonStyles.success : buttonStyles.secondary
              )}
            >
              滚动12月
            </button>
          </div>

          {/* 导出按钮 */}
          {(onExportCSV || onExportExcel) && (
            <div className="flex gap-2">
              {onExportCSV && (
                <button
                  onClick={onExportCSV}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.success)}
                >
                  导出CSV
                </button>
              )}
              {onExportExcel && (
                <button
                  onClick={onExportExcel}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                >
                  导出Excel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 说明提示 */}
      <div className={cn(badgeStyles.primary, 'block rounded-lg p-4 border border-primary-border')}>
        <h4 className={cn(textStyles.label, 'text-primary-dark mb-2')}>新口径已赚保费说明</h4>
        <ul className={cn(textStyles.body, 'text-primary-700 space-y-1 list-disc list-inside')}>
          <li>
            <strong className={textStyles.emphasis}>首日费用</strong>已并入<strong className={textStyles.emphasis}>起保月</strong>的已赚字段（绿色高亮）
          </li>
          <li>
            滚动12个月统计时，窗口内的首日费用<strong className={textStyles.emphasis}>自动计入</strong>已赚保费，窗口外则自动排除
          </li>
          <li>
            精算三角：行=起保月(1-12月)，列=统计月(25-1到26-12)，<span className={colorClasses.text.neutralMuted}>灰色0</span>=起保前（三角外）
          </li>
          <li>
            <strong className={textStyles.emphasis}>最终已赚</strong> = 首日费用 + 全部时间分摊 ≈ 保费 × (1 - F×(1-α))
          </li>
          <li>险类系数 α：交强险 = 0.82，商业险 = 0.94；F = 费用率</li>
        </ul>
      </div>

      {/* 表格内容 */}
      {renderTableContent()}
    </div>
  );
};

export default NewEarnedPremiumTable;
