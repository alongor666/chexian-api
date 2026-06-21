/**
 * GrowthKpiCards 空态保护测试 — 多省接入（ADR G8 / Day-1 SOP §5 推广至增长分析子页）
 *
 * 该组件无 loading prop（由父级 GrowthDetailSection 控制是否挂载），原已有空态守卫
 * （!todayData，即 data 为空数组）。本测试锁定「谐化到共享 EmptyState 范式」后的行为：
 *  1. 数据空（data=[]）→ EmptyState「暂无数据」（非真实零保费），不静默渲染零值卡
 *  2. 有数据 → 正常渲染战况 / MTD / YTD 卡（不误触发空态）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GrowthKpiCards } from '../GrowthKpiCards';
import type { GrowthData } from '../../hooks/useGrowthAnalysis';

const valueFormatter = (v: number | null | undefined) => String(v ?? 0);

const dataWithRow = [
  {
    time_period: '2026-06-21',
    current_value: 1000,
    previous_value: 800,
    growth_rate: 25,
    period_total_current: 5000,
    period_total_previous: 4000,
    period_growth_rate: 25,
    ytd_total_current: 50000,
    ytd_total_previous: 40000,
    ytd_growth_rate: 25,
  },
] as unknown as GrowthData[];

afterEach(cleanup);

describe('GrowthKpiCards 空态保护（多省接入 ADR G8）', () => {
  it('数据为空（data=[]）时显示 EmptyState，说明非真实零保费，不静默渲染零值卡', () => {
    render(
      <GrowthKpiCards data={[]} cutoffDate="2026-06-21" valueFormatter={valueFormatter} unitLabel="万元" />
    );
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText(/这不代表真实零保费/)).toBeTruthy();
    expect(screen.queryByText(/本月进度/)).toBeNull();
  });

  it('有数据时正常渲染战况 / MTD / YTD 卡（不误触发空态）', () => {
    render(
      <GrowthKpiCards
        data={dataWithRow}
        cutoffDate="2026-06-21"
        valueFormatter={valueFormatter}
        unitLabel="万元"
      />
    );
    expect(screen.getByText(/本月进度/)).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });
});
