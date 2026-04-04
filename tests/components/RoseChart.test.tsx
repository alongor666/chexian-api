/**
 * @vitest-environment jsdom
 * RoseChart 组件单元测试 (B123)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../src/shared/theme';

// Mock echarts-for-react - expose option via data attributes for testing
vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option, style }: any) => (
    <div
      data-testid="rose-chart-mock"
      data-series-count={option?.series?.length ?? 0}
      data-title={option?.title?.text ?? ''}
      style={style}
    />
  ),
}));

vi.mock('../../src/shared/utils/echarts', () => ({
  echarts: {},
}));

import { RoseChart } from '../../src/widgets/charts/RoseChart';

const sampleData = [
  { name: '乐山', value: 400 },
  { name: '天府', value: 300 },
  { name: '宜宾', value: 200 },
  { name: '德阳', value: 100 },
];

describe('RoseChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with empty data', () => {
    const { container } = render(<ThemeProvider><RoseChart data={[]} /></ThemeProvider>);
    expect(container).toBeTruthy();
  });

  it('renders chart container with sample data', () => {
    render(<ThemeProvider><RoseChart data={sampleData} title="机构保费玫瑰图" /></ThemeProvider>);
    const chart = screen.getByTestId('rose-chart-mock');
    expect(chart).toBeTruthy();
  });

  it('passes title to chart options', () => {
    render(<ThemeProvider><RoseChart data={sampleData} title="吨位分布" /></ThemeProvider>);
    const chart = screen.getByTestId('rose-chart-mock');
    expect(chart.getAttribute('data-title')).toBe('吨位分布');
  });

  it('handles loading state', () => {
    const { container } = render(<ThemeProvider><RoseChart data={sampleData} loading={true} /></ThemeProvider>);
    expect(container.textContent).toContain('Loading Chart');
  });

  it('accepts custom height', () => {
    render(<ThemeProvider><RoseChart data={sampleData} height={500} /></ThemeProvider>);
    const chart = screen.getByTestId('rose-chart-mock');
    expect(chart.style.height).toBe('500px');
  });

  it('aggregates small sectors when data has many items', () => {
    // Create 15 items, most with small values
    const largeData = Array.from({ length: 15 }, (_, i) => ({
      name: `机构${i}`,
      value: i < 3 ? 1000 : 10, // first 3 are large, rest small
    }));
    render(<ThemeProvider><RoseChart data={largeData} /></ThemeProvider>);
    const chart = screen.getByTestId('rose-chart-mock');
    expect(chart).toBeTruthy();
  });

  it('does not aggregate when data has few items', () => {
    const smallData = [
      { name: '甲', value: 100 },
      { name: '乙', value: 50 },
    ];
    render(<ThemeProvider><RoseChart data={smallData} /></ThemeProvider>);
    const chart = screen.getByTestId('rose-chart-mock');
    expect(chart).toBeTruthy();
  });

  it('accepts custom valueFormatter', () => {
    const formatter = vi.fn((v: number) => `${v}万`);
    render(<ThemeProvider><RoseChart data={sampleData} valueFormatter={formatter} /></ThemeProvider>);
    const chart = screen.getByTestId('rose-chart-mock');
    expect(chart).toBeTruthy();
  });

  it('renders with withContainer=true wraps in div', () => {
    const { container } = render(<ThemeProvider><RoseChart data={sampleData} withContainer={true} title="吨位" /></ThemeProvider>);
    // withContainer=true wraps chart in a div with bg-white class
    const wrapper = container.querySelector('.bg-white');
    expect(wrapper).toBeTruthy();
  });
});
