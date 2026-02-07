/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EarnedPremiumTable } from '../src/features/cost/components/EarnedPremiumTable';
import type { EarnedPremiumData, EarnedPremiumSummaryData } from '../src/features/cost/types/costTypes';

vi.mock('../src/widgets/table/VirtualTable', () => {
  return {
    VirtualTable: () => null,
  };
});

vi.mock('../src/features/cost/components/EarnedPremiumCharts', () => {
  return {
    EarnedPremiumCharts: () => null,
  };
});

vi.mock('../src/features/cost/components/EarnedPremiumGuide', () => {
  return {
    EarnedPremiumGuide: () => null,
  };
});

/**
 * 获取“起保年月”筛选下拉框的所有 option 文本
 */
function getPolicyMonthOptionTexts(): string[] {
  const label = screen.getByText('起保年月：');
  const container = label.closest('div');
  if (!container) throw new Error('未找到起保年月筛选器容器');

  const select = within(container).getByRole('combobox') as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.text);
}

describe('已赚保费明细 - 筛选项生成', () => {
  it('应基于明细数据动态生成起保年月选项（含 2025 年月份）', () => {
    const detailData: EarnedPremiumData[] = [
      {
        org_level_3: '四川',
        insurance_type: '交强险',
        policy_month: '2025-01',
        policy_count: 1,
        total_premium: 100,
        total_fee: 10,
        fee_rate: 10,
        line_factor: 0.82,
        avg_elapsed_days: 30,
        first_day_part: 1,
        time_part: 2,
        earned_premium_cum: 3,
      },
      {
        org_level_3: '四川',
        insurance_type: '商业保险',
        policy_month: '2025-02',
        policy_count: 2,
        total_premium: 200,
        total_fee: 20,
        fee_rate: 10,
        line_factor: 0.94,
        avg_elapsed_days: 40,
        first_day_part: 2,
        time_part: 3,
        earned_premium_cum: 5,
      },
      {
        org_level_3: '四川',
        insurance_type: '商业保险',
        policy_month: '未知',
        policy_count: 3,
        total_premium: 300,
        total_fee: 30,
        fee_rate: 10,
        line_factor: 0.94,
        avg_elapsed_days: 50,
        first_day_part: 3,
        time_part: 4,
        earned_premium_cum: 7,
      },
    ];

    const summaryData: EarnedPremiumSummaryData[] = [
      {
        org_level_3: '合计',
        policy_count: 6,
        total_premium: 600,
        total_fee: 60,
        avg_fee_rate: 10,
        total_first_day_part: 6,
        total_time_part: 9,
        total_earned_premium: 15,
        earned_ratio: 2.5,
      },
    ];

    render(
      <EarnedPremiumTable
        data={detailData}
        summaryData={summaryData}
        cutoffDate="2025-12-31"
        loading={false}
      />
    );

    const optionTexts = getPolicyMonthOptionTexts();
    expect(optionTexts).toContain('全部月份');
    expect(optionTexts).toContain('2025年1月');
    expect(optionTexts).toContain('2025年2月');
    expect(optionTexts).toContain('未知');
  });
});
