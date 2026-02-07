/**
 * 综合费用率预测面板
 * Expense Ratio Forecast Panel
 *
 * 功能:
 * - 预测未来月份的综合费用率
 * - 综合费用率 = (运营成本 + 费用金额) / 已赚保费
 * - 已赚保费: 滚动12个月(从新口径已赚保费获取)
 * - 费用金额: 滚动12个月,延迟1个月(考虑次月核算)
 * - 运营成本: 已赚保费 × 运营成本率(默认9%,用户可调)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { VirtualTable, Column } from '../../../widgets/table/VirtualTable';
import { formatPremiumWan, formatPercent } from '../../../shared/utils/formatters';
import {
  tableStyles,
  textStyles,
  buttonStyles,
  cardStyles,
  badgeStyles,
  cn,
} from '../../../shared/styles';
import type { ExpenseRatioForecastData } from '../types/costTypes';

interface ExpenseRatioForecastPanelProps {
  /** 预测数据 */
  forecastData: ExpenseRatioForecastData[];
  /** 加载状态 */
  loading?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 运营成本率变更回调 */
  onOperatingCostRateChange?: (rate: number) => void;
  /** 当前运营成本率 */
  currentOperatingCostRate: number;
}

// ==================== 显示格式类型 ====================

interface DisplayForecastData {
  stat_month: string;
  total_earned_premium: string;
  expense_window: string;
  total_fee: string;
  total_tax: string;
  total_expense: string;
  operating_cost_rate: string;
  operating_cost: string;
  comprehensive_expense_ratio: string;
}

// ==================== 数据转换函数 ====================

function transformForecastData(data: ExpenseRatioForecastData[]): DisplayForecastData[] {
  return data.map((row) => {
    const [, month] = row.stat_month.split('-');
    return {
      stat_month: `2026年${month}月`,
      total_earned_premium: formatPremiumWan(row.total_earned_premium),
      expense_window: `${row.expense_window_start}至${row.expense_window_end}`,
      total_fee: formatPremiumWan(row.total_fee),
      total_tax: formatPremiumWan(row.total_tax),
      total_expense: formatPremiumWan(row.total_expense),
      operating_cost_rate: formatPercent(row.operating_cost_rate, 1),
      operating_cost: formatPremiumWan(row.operating_cost),
      comprehensive_expense_ratio: formatPercent(row.comprehensive_expense_ratio, 1),
    };
  });
}

/**
 * 综合费用率预测面板组件
 */
export const ExpenseRatioForecastPanel: React.FC<ExpenseRatioForecastPanelProps> = ({
  forecastData,
  loading = false,
  error = null,
  onOperatingCostRateChange,
  currentOperatingCostRate,
}) => {
  // 目标月份选择
  const [selectedMonth, setSelectedMonth] = useState<string>('2026-03');
  // 运营成本率输入
  const [inputOperatingCostRate, setInputOperatingCostRate] = useState<string>(
    currentOperatingCostRate.toString()
  );

  // 月份选项
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const month = (i + 1).toString().padStart(2, '0');
    return {
      value: `2026-${month}`,
      label: `2026年${month}月`,
    };
  });

  // 获取选中月份的预测数据
  const selectedForecastData = useMemo(() => {
    return forecastData.find((item) => item.stat_month === selectedMonth);
  }, [forecastData, selectedMonth]);

  // 列配置
  const columns: Column<DisplayForecastData>[] = useMemo(
    () => [
      { key: 'stat_month', header: '统计月份', width: 100 },
      {
        key: 'total_earned_premium',
        header: '已赚保费(万)',
        width: 120,
        align: 'right',
      },
      { key: 'expense_window', header: '费用窗口', width: 150 },
      { key: 'total_fee', header: '费用金额(万)', width: 120, align: 'right' },
      { key: 'total_tax', header: '税金(万)', width: 100, align: 'right' },
      { key: 'total_expense', header: '总费用(万)', width: 110, align: 'right' },
      { key: 'operating_cost_rate', header: '运营成本率', width: 100, align: 'right' },
      { key: 'operating_cost', header: '运营成本(万)', width: 120, align: 'right' },
      {
        key: 'comprehensive_expense_ratio',
        header: '综合费用率',
        width: 110,
        align: 'right',
      },
    ],
    []
  );

  // 转换数据
  const displayData = useMemo(() => transformForecastData(forecastData), [forecastData]);

  // 处理运营成本率变更
  const handleOperatingCostRateSubmit = useCallback(() => {
    const rate = parseFloat(inputOperatingCostRate);
    if (!isNaN(rate) && rate >= 0 && rate <= 100) {
      onOperatingCostRateChange?.(rate);
    } else {
      alert('请输入0-100之间的数字');
      setInputOperatingCostRate(currentOperatingCostRate.toString());
    }
  }, [inputOperatingCostRate, currentOperatingCostRate, onOperatingCostRateChange]);

  // 空状态
  if (!loading && forecastData.length === 0) {
    return (
      <div className={cn(cardStyles.spacious, 'text-center', textStyles.caption)}>
        暂无数据
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 参数输入面板 */}
      <div className={cardStyles.standard}>
        <div className="space-y-4">
          <h3 className={textStyles.titleSmall}>预测参数</h3>

          <div className="grid grid-cols-2 gap-4">
            {/* 目标月份选择 */}
            <div>
              <label className={cn(textStyles.label, 'block mb-2')}>目标月份</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 运营成本率输入 */}
            <div>
              <label className={cn(textStyles.label, 'block mb-2')}>运营成本率 (%)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={inputOperatingCostRate}
                  onChange={(e) => setInputOperatingCostRate(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleOperatingCostRateSubmit}
                  className={cn(buttonStyles.base, buttonStyles.sizeSmall, buttonStyles.primary)}
                >
                  应用
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 选中月份的KPI指标卡片 */}
      {selectedForecastData && (
        <div className={cardStyles.standard}>
          <h3 className={cn(textStyles.titleSmall, 'mb-4')}>
            {selectedMonth} 预测结果
          </h3>
          <div className="grid grid-cols-4 gap-4">
            {/* 已赚保费 */}
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className={cn(textStyles.caption, 'text-blue-600')}>已赚保费(万)</div>
              <div className={cn(textStyles.numeric, 'text-2xl font-semibold text-blue-700 mt-1')}>
                {formatPremiumWan(selectedForecastData.total_earned_premium)}
              </div>
            </div>

            {/* 总费用 */}
            <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
              <div className={cn(textStyles.caption, 'text-orange-600')}>总费用(万)</div>
              <div className={cn(textStyles.numeric, 'text-2xl font-semibold text-orange-700 mt-1')}>
                {formatPremiumWan(selectedForecastData.total_expense)}
              </div>
              <div className={cn(textStyles.caption, 'text-orange-500 mt-1')}>
                费用{formatPremiumWan(selectedForecastData.total_fee)} + 税金
                {formatPremiumWan(selectedForecastData.total_tax)}
              </div>
            </div>

            {/* 运营成本 */}
            <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
              <div className={cn(textStyles.caption, 'text-purple-600')}>运营成本(万)</div>
              <div className={cn(textStyles.numeric, 'text-2xl font-semibold text-purple-700 mt-1')}>
                {formatPremiumWan(selectedForecastData.operating_cost)}
              </div>
              <div className={cn(textStyles.caption, 'text-purple-500 mt-1')}>
                已赚保费 × {formatPercent(selectedForecastData.operating_cost_rate, 1)}
              </div>
            </div>

            {/* 综合费用率 */}
            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <div className={cn(textStyles.caption, 'text-red-600')}>综合费用率</div>
              <div className={cn(textStyles.numeric, 'text-2xl font-semibold text-red-700 mt-1')}>
                {formatPercent(selectedForecastData.comprehensive_expense_ratio, 1)}
              </div>
              <div className={cn(textStyles.caption, 'text-red-500 mt-1')}>
                (运营成本 + 总费用) / 已赚保费
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 说明提示 */}
      <div className={cn(badgeStyles.primary, 'block rounded-lg p-4 border border-primary-border')}>
        <h4 className={cn(textStyles.label, 'text-primary-dark mb-2')}>
          综合费用率预测说明
        </h4>
        <ul className={cn(textStyles.body, 'text-primary-700 space-y-1 list-disc list-inside')}>
          <li>
            <strong className={textStyles.emphasis}>已赚保费</strong>：滚动12个月已赚保费（基于新口径计算）
          </li>
          <li>
            <strong className={textStyles.emphasis}>费用金额</strong>：滚动12个月费用金额，延迟1个月（考虑次月核算）
          </li>
          <li>
            <strong className={textStyles.emphasis}>税金</strong>：各月保费 × 1.6%
          </li>
          <li>
            <strong className={textStyles.emphasis}>运营成本</strong>：已赚保费 × 运营成本率（默认9%，可调整）
          </li>
          <li>
            <strong className={textStyles.emphasis}>综合费用率</strong>：(运营成本 + 费用金额 + 税金) / 已赚保费 × 100%
          </li>
        </ul>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700"
          role="alert"
        >
          <strong>错误：</strong> {error}
        </div>
      )}

      {/* 明细表格 */}
      <div className={tableStyles.container}>
        <div className={cn(tableStyles.header, 'px-4 py-3 flex justify-between items-center')}>
          <div>
            <h3 className={textStyles.titleSmall}>2026年各月综合费用率预测</h3>
            <p className={cn(textStyles.caption, 'mt-1')}>
              费用窗口延迟1个月（预测N月时，费用统计到N-1月）
            </p>
          </div>
          <span className={textStyles.caption}>共 {forecastData.length} 条记录</span>
        </div>
        <VirtualTable<DisplayForecastData>
          columns={columns}
          data={displayData}
          loading={loading}
          height={Math.max(200, displayData.length * 40 + 60)}
          rowHeight={40}
        />
      </div>
    </div>
  );
};

export default ExpenseRatioForecastPanel;
