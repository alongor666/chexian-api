/**
 * 成本分析数据导出处理器 Hook
 *
 * 提供各类成本分析数据的 CSV/Excel 导出功能
 */

import { useCallback } from 'react';
import { exportArrayToCSV, exportToExcel, getTimestampForFilename } from '../../../shared/utils/export';
import type {
  ClaimRatioData,
  ExpenseRatioData,
  ComprehensiveCostData,
  VariableCostData,
  EarnedPremiumData,
  EarnedPremiumSummaryData,
  CostSubTab,
} from '../types/costTypes';

interface ExportHandlersParams {
  claimRatioData: ClaimRatioData[];
  expenseRatioData: ExpenseRatioData[];
  comprehensiveCostData: ComprehensiveCostData[];
  variableCostData: VariableCostData[];
  earnedPremiumData?: EarnedPremiumData[];
  earnedPremiumSummaryData?: EarnedPremiumSummaryData[];
  dimensionLabel: string;
  activeSubTab: CostSubTab;
}

/**
 * 成本分析导出处理器 Hook
 */
export function useExportHandlers({
  claimRatioData,
  expenseRatioData,
  comprehensiveCostData,
  variableCostData,
  earnedPremiumData = [],
  earnedPremiumSummaryData = [],
  dimensionLabel,
  activeSubTab,
}: ExportHandlersParams) {
  // 导出赔付率数据
  const handleExportClaim = useCallback(
    (format: 'csv' | 'excel') => {
      if (claimRatioData.length === 0) {
        alert('暂无赔付率数据可导出');
        return;
      }

      const exportData = claimRatioData.map((row) => ({
        [dimensionLabel]: row.dim_key || '未知',
        保单件数: row.policy_count || 0,
        保费合计: row.total_premium || 0,
        赔案件数: row.total_claim_cases || 0,
        已报告赔款: row.total_reported_claims || 0,
        案均赔款: row.avg_claim_amount || 0,
        满期保费: row.earned_premium || 0,
        平均满期天数: row.avg_exposure_days || 0,
        '满期赔付率(%)': row.earned_claim_ratio || 0,
        '满期出险率(%)': row.earned_loss_frequency || 0,
      }));

      const filename = `赔付率分析_${dimensionLabel}_${getTimestampForFilename()}`;

      if (format === 'excel') {
        void exportToExcel(exportData, filename, '赔付率分析');
      } else {
        exportArrayToCSV(exportData, `${filename}.csv`);
      }
    },
    [claimRatioData, dimensionLabel]
  );

  // 导出费用率数据
  const handleExportExpense = useCallback(
    (format: 'csv' | 'excel') => {
      if (expenseRatioData.length === 0) {
        alert('暂无费用率数据可导出');
        return;
      }

      const exportData = expenseRatioData.map((row) => ({
        [dimensionLabel]: row.dim_key || '未知',
        保单件数: row.policy_count || 0,
        保费合计: row.total_premium || 0,
        费用金额: row.total_fee || 0,
        '费用率(%)': row.expense_ratio || 0,
      }));

      const filename = `费用率分析_${dimensionLabel}_${getTimestampForFilename()}`;

      if (format === 'excel') {
        void exportToExcel(exportData, filename, '费用率分析');
      } else {
        exportArrayToCSV(exportData, `${filename}.csv`);
      }
    },
    [expenseRatioData, dimensionLabel]
  );

  // 导出综合成本数据
  const handleExportComprehensive = useCallback(
    (format: 'csv' | 'excel') => {
      if (comprehensiveCostData.length === 0) {
        alert('暂无综合成本数据可导出');
        return;
      }

      const exportData = comprehensiveCostData.map((row) => ({
        [dimensionLabel]: row.dim_key || '未知',
        保单件数: row.policy_count || 0,
        保费合计: row.total_premium || 0,
        满期保费: row.earned_premium || 0,
        已报告赔款: row.total_reported_claims || 0,
        费用金额: row.total_fee || 0,
        '满期赔付率(%)': row.earned_claim_ratio || 0,
        '费用率(%)': row.expense_ratio || 0,
        '综合费用率(%)': row.comprehensive_cost_ratio || 0,
      }));

      const filename = `综合费用率分析_${dimensionLabel}_${getTimestampForFilename()}`;

      if (format === 'excel') {
        void exportToExcel(exportData, filename, '综合费用率分析');
      } else {
        exportArrayToCSV(exportData, `${filename}.csv`);
      }
    },
    [comprehensiveCostData, dimensionLabel]
  );

  // 导出变动成本数据
  const handleExportVariable = useCallback(
    (format: 'csv' | 'excel') => {
      if (variableCostData.length === 0) {
        alert('暂无变动成本数据可导出');
        return;
      }

      const exportData = variableCostData.map((row) => ({
        [dimensionLabel]: row.dim_key || '未知',
        保单件数: row.policy_count || 0,
        保费合计: row.total_premium || 0,
        满期保费: row.earned_premium || 0,
        已报告赔款: row.total_reported_claims || 0,
        费用金额: row.total_fee || 0,
        '满期赔付率(%)': row.earned_claim_ratio || 0,
        '费用率(%)': row.expense_ratio || 0,
        '变动成本率(%)': row.variable_cost_ratio || 0,
      }));

      const filename = `变动成本率分析_${dimensionLabel}_${getTimestampForFilename()}`;

      if (format === 'excel') {
        void exportToExcel(exportData, filename, '变动成本率分析');
      } else {
        exportArrayToCSV(exportData, `${filename}.csv`);
      }
    },
    [variableCostData, dimensionLabel]
  );

  // 导出已赚保费数据（明细+汇总合并导出）
  const handleExportEarned = useCallback(
    (format: 'csv' | 'excel') => {
      if (earnedPremiumData.length === 0 && earnedPremiumSummaryData.length === 0) {
        alert('暂无已赚保费数据可导出');
        return;
      }

      const timestamp = getTimestampForFilename();

      // 汇总数据
      const summaryExportData = earnedPremiumSummaryData.map((row) => ({
        三级机构: row.org_level_3 || '未知',
        保单件数: row.policy_count || 0,
        保费合计: row.total_premium || 0,
        费用金额: row.total_fee || 0,
        '平均费用率(%)': row.avg_fee_rate || 0,
        首日费用部分: row.total_first_day_part || 0,
        时间分摊部分: row.total_time_part || 0,
        累计已赚保费: row.total_earned_premium || 0,
        '已赚保费率(%)': row.earned_ratio || 0,
      }));

      // 明细数据
      const detailExportData = earnedPremiumData.map((row) => ({
        三级机构: row.org_level_3 || '未知',
        险类: row.insurance_type || '未知',
        保单年月: row.policy_month || '未知',
        保单件数: row.policy_count || 0,
        保费合计: row.total_premium || 0,
        费用金额: row.total_fee || 0,
        '费用率(%)': row.fee_rate || 0,
        险类系数: row.line_factor || 0,
        平均有效天数: row.avg_elapsed_days || 0,
        首日费用部分: row.first_day_part || 0,
        时间分摊部分: row.time_part || 0,
        累计已赚保费: row.earned_premium_cum || 0,
      }));

      if (format === 'excel') {
        // Excel支持多Sheet导出
        void exportToExcel(
          [...summaryExportData, {}, ...detailExportData],
          `已赚保费分析_${timestamp}`,
          '已赚保费'
        );
      } else {
        // CSV分别导出汇总和明细
        if (summaryExportData.length > 0) {
          exportArrayToCSV(summaryExportData, `已赚保费汇总_${timestamp}.csv`);
        }
        if (detailExportData.length > 0) {
          exportArrayToCSV(detailExportData, `已赚保费明细_${timestamp}.csv`);
        }
      }
    },
    [earnedPremiumData, earnedPremiumSummaryData]
  );

  // 根据当前子Tab获取对应的导出处理器
  const getCurrentExportHandler = useCallback(
    (format: 'csv' | 'excel') => {
      switch (activeSubTab) {
        case 'claim':
          return () => handleExportClaim(format);
        case 'expense':
          return () => handleExportExpense(format);
        case 'comprehensive':
          return () => handleExportComprehensive(format);
        case 'variable':
          return () => handleExportVariable(format);
        case 'earned':
          return () => handleExportEarned(format);
        default:
          return () => alert('未知分析类型');
      }
    },
    [activeSubTab, handleExportClaim, handleExportExpense, handleExportComprehensive, handleExportVariable, handleExportEarned]
  );

  return {
    handleExportClaim,
    handleExportExpense,
    handleExportComprehensive,
    handleExportVariable,
    handleExportEarned,
    getCurrentExportHandler,
  };
}
