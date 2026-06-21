/**
 * CrossSellSummaryKpiBoard 空态保护测试 — 多省接入（ADR G8 / Day-1 SOP §5 推广至驾意险推介子页）
 *
 * 锁定三态（数据形态为 rows 数组，以 rawData.length === 0 判空）：
 *  1. loading + 空 → 骨架屏 +「数据加载中」，不渲染对比矩阵
 *  2. 非 loading + 空（rawData=[]）→ EmptyState「暂无数据」（非真实零保费），不静默渲染零值单元格
 *  3. 有数据 → 正常渲染对比矩阵（不误触发空态）
 *
 * useCrossSellTimePeriod 被 mock，以受控注入三态。
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AdvancedFilterState } from '@/shared/types/data';

const { useCrossSellTimePeriodMock } = vi.hoisted(() => ({
  useCrossSellTimePeriodMock: vi.fn(),
}));

vi.mock('../hooks/useCrossSellTimePeriod', () => ({
  useCrossSellTimePeriod: useCrossSellTimePeriodMock,
}));

import { CrossSellSummaryKpiBoard } from '../CrossSellSummaryKpiBoard';

const filters = {} as unknown as AdvancedFilterState;

function renderBoard() {
  return render(
    <CrossSellSummaryKpiBoard vehicleCategory="passenger" filters={filters} timePeriod="month" />
  );
}

afterEach(() => {
  cleanup();
  useCrossSellTimePeriodMock.mockReset();
});

describe('CrossSellSummaryKpiBoard 空态保护（多省接入 ADR G8）', () => {
  it('loading + 空数据时显示骨架屏 +「数据加载中」，不渲染对比矩阵', () => {
    useCrossSellTimePeriodMock.mockReturnValue({
      maxDate: null,
      rawData: [],
      loading: true,
      error: null,
    });
    renderBoard();
    expect(screen.getByText(/数据加载中/)).toBeTruthy();
    expect(screen.queryByText('险别组合对比')).toBeNull();
  });

  it('非 loading + 空数据（rawData=[]）时显示 EmptyState，说明非真实零保费，不静默渲染零值', () => {
    useCrossSellTimePeriodMock.mockReturnValue({
      maxDate: '2026-06-21',
      rawData: [],
      loading: false,
      error: null,
    });
    renderBoard();
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText(/这不代表真实零保费/)).toBeTruthy();
    expect(screen.queryByText('险别组合对比')).toBeNull();
  });

  it('有数据时正常渲染对比矩阵（不误触发空态）', () => {
    useCrossSellTimePeriodMock.mockReturnValue({
      maxDate: '2026-06-21',
      rawData: [
        {
          coverage_combination: '整体',
          month_premium: 5000000,
          month_auto_count: 500,
          month_driver_count: 100,
          month_rate: 20,
          month_avg_premium: 300,
          month_auto_avg_premium: 10000,
        },
      ],
      loading: false,
      error: null,
    });
    renderBoard();
    expect(screen.getByText('险别组合对比')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });

  it('error 时显示加载失败（既有行为不回退）', () => {
    useCrossSellTimePeriodMock.mockReturnValue({
      maxDate: null,
      rawData: [],
      loading: false,
      error: '网络错误',
    });
    renderBoard();
    expect(screen.getByText(/加载失败/)).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });
});
