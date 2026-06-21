/**
 * VariableCostKpiBoard 空态保护测试 — 多省接入（ADR G8 / Day-1 SOP §5 推广至变动成本率子页）
 *
 * 该看板原已有空态守卫（orgRows.length === 0），本测试锁定「谐化到共享范式」后的行为：
 *  1. loading + 空 → 骨架屏 +「数据加载中」，不渲染看板标题
 *  2. 非 loading + 空 → EmptyState「暂无数据」（非真实零保费），不静默渲染零值卡
 *  3. 有数据 → 正常渲染看板（不误触发空态）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { VariableCostKpiBoard } from '../VariableCostKpiBoard';
import type { VariableCostData } from '../../types/costTypes';

const dataWithRows = [{ dim_key: '天府' }] as unknown as VariableCostData[];

afterEach(cleanup);

describe('VariableCostKpiBoard 空态保护（多省接入 ADR G8）', () => {
  it('loading + 空数据时显示骨架屏 +「数据加载中」，不渲染看板标题', () => {
    const { container } = render(<VariableCostKpiBoard data={[]} loading={true} />);
    expect(screen.getByText(/数据加载中/)).toBeTruthy();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('变动成本率KPI看板')).toBeNull();
  });

  it('非 loading + 空数据时显示 EmptyState，说明非真实零保费', () => {
    render(<VariableCostKpiBoard data={[]} loading={false} />);
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText(/这不代表真实零保费/)).toBeTruthy();
    expect(screen.queryByText('变动成本率KPI看板')).toBeNull();
  });

  it('有数据时正常渲染看板（不误触发空态）', () => {
    render(<VariableCostKpiBoard data={dataWithRows} loading={false} />);
    expect(screen.getByText('变动成本率KPI看板')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });
});
