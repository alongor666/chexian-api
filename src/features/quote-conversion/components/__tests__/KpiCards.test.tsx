/**
 * KpiCards 空态保护测试 — 多省接入（ADR G8 / Day-1 SOP §5 推广至报价转化子页）
 *
 * 锁定三态：
 *  1. loading → 骨架屏，不渲染 KPI 数值
 *  2. 数据空（undefined / 空对象 / 全零规模）+ 非 loading → EmptyState「暂无数据」（非真实零报价）
 *  3. 有规模数据 → 正常渲染 KPI 卡（不误触发空态）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { KpiCards } from '../KpiCards';
import type { QuoteKpi } from '../../types';

const fullData: QuoteKpi = {
  total_quotes: 1200,
  total_insured: 800,
  underwriting_rate: 66.7,
  avg_discount_rate: 0.85,
  insured_premium: 3500000,
  salesman_count: 42,
  renewal_quotes: 700,
  renewal_insured: 500,
  renewal_insured_premium: 2200000,
  switch_quotes: 500,
  switch_insured: 300,
  switch_insured_premium: 1300000,
};

afterEach(cleanup);

describe('KpiCards 空态保护（多省接入 ADR G8）', () => {
  it('loading 时显示骨架屏，不渲染 KPI 数值', () => {
    const { container } = render(<KpiCards data={undefined} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('整体转化率')).toBeNull();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });

  it('数据为空对象（后端 data[0] ?? {} 兜底）+ 非 loading 时显示 EmptyState，说明非真实零报价', () => {
    render(<KpiCards data={{} as QuoteKpi} isLoading={false} />);
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText(/这不代表真实零报价/)).toBeTruthy();
    expect(screen.queryByText('整体转化率')).toBeNull();
  });

  it('全零规模（聚合无行 / 装载中假象）+ 非 loading 同样触发空态，禁止静默展示零转化率', () => {
    render(
      <KpiCards
        data={{ total_quotes: 0, total_insured: 0, insured_premium: 0 } as QuoteKpi}
        isLoading={false}
      />
    );
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.queryByText('整体转化率')).toBeNull();
  });

  it('有规模数据时正常渲染 KPI（不误触发空态）', () => {
    render(<KpiCards data={fullData} isLoading={false} />);
    expect(screen.getByText('整体转化率')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });
});
