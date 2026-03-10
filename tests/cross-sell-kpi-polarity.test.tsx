import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CrossSellSummaryKpiBoard } from '../src/features/dashboard/CrossSellSummaryKpiBoard';

vi.mock('../src/features/dashboard/hooks/useCrossSellTimePeriod', () => ({
  useCrossSellTimePeriod: () => ({
    maxDate: null,
    rawData: [],
    loading: false,
    error: null,
  }),
}));

function buildSummaryRow(currentPremium: number, prevPremium: number) {
  return {
    coverage_combination: '整体',
    day_auto_count: 100,
    day_driver_count: 20,
    day_premium: currentPremium,
    day_rate: 20,
    day_avg_premium: 1000,
    day_auto_avg_premium: 3000,
    prev_day_auto_count: 100,
    prev_day_driver_count: 20,
    prev_day_premium: prevPremium,
    prev_day_rate: 20,
    prev_day_avg_premium: 1000,
    prev_day_auto_avg_premium: 3000,
  };
}

describe('CrossSellSummaryKpiBoard polarity regression', () => {
  it('renders upward change in green for positive metrics', () => {
    render(
      <CrossSellSummaryKpiBoard
        vehicleCategory="passenger"
        filters={{}}
        timePeriod="day"
        prefetchedSummary={{
          maxDate: '2026-03-08',
          rows: [buildSummaryRow(200000, 100000)],
        }}
      />
    );

    const upChanges = screen.getAllByText('↑ +10.0, +100.0%');
    expect(upChanges.some((node) => node.className.includes('text-success'))).toBe(true);
  });

  it('renders downward change in red for positive metrics', () => {
    render(
      <CrossSellSummaryKpiBoard
        vehicleCategory="passenger"
        filters={{}}
        timePeriod="day"
        prefetchedSummary={{
          maxDate: '2026-03-08',
          rows: [buildSummaryRow(50000, 100000)],
        }}
      />
    );

    const downChanges = screen.getAllByText('↓ -5.0, -50.0%');
    expect(downChanges.some((node) => node.className.includes('text-danger'))).toBe(true);
  });
});
