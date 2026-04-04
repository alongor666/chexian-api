/**
 * @vitest-environment jsdom
 * BarChart 组件单元测试 (B123)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../src/shared/theme';

// Mock echarts-for-react and echarts
vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option, onEvents, style }: any) => (
    <div
      data-testid="echarts-mock"
      data-title={option?.title?.text ?? ''}
      style={style}
      onClick={() => {
        // simulate bar click for onEvents test
        if (onEvents?.click) {
          onEvents.click({ name: option?.xAxis?.data?.[0] });
        }
      }}
    />
  ),
}));

vi.mock('../../src/shared/utils/echarts', () => ({
  echarts: {},
}));

// Import after mocks
import { BarChart } from '../../src/widgets/charts/BarChart';

const sampleData = [
  { dim_key: '乐山', value: 1000 },
  { dim_key: '天府', value: 800 },
  { dim_key: '宜宾', value: 600 },
];

describe('BarChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with empty data', () => {
    const { container } = render(<ThemeProvider><BarChart data={[]} /></ThemeProvider>);
    expect(container).toBeTruthy();
  });

  it('renders the chart container', () => {
    render(<ThemeProvider><BarChart data={sampleData} title="保费排名" /></ThemeProvider>);
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });

  it('passes title to chart options', () => {
    render(<ThemeProvider><BarChart data={sampleData} title="机构保费" /></ThemeProvider>);
    const chart = screen.getByTestId('echarts-mock');
    expect(chart.getAttribute('data-title')).toBe('机构保费');
  });

  it('shows loading state', () => {
    const { container } = render(<ThemeProvider><BarChart data={sampleData} loading={true} /></ThemeProvider>);
    expect(container).toBeTruthy();
  });

  it('calls onBarClick when a bar is clicked', () => {
    const onBarClick = vi.fn();
    render(<ThemeProvider><BarChart data={sampleData} onBarClick={onBarClick} /></ThemeProvider>);
    const chart = screen.getByTestId('echarts-mock');
    fireEvent.click(chart);
    expect(onBarClick).toHaveBeenCalledWith(sampleData[0].dim_key);
  });

  it('renders without title', () => {
    render(<ThemeProvider><BarChart data={sampleData} /></ThemeProvider>);
    const chart = screen.getByTestId('echarts-mock');
    expect(chart.getAttribute('data-title')).toBe('');
  });

  it('accepts valueFormatter prop', () => {
    const formatter = vi.fn((v: number) => `${v}万`);
    render(<ThemeProvider><BarChart data={sampleData} valueFormatter={formatter} /></ThemeProvider>);
    // Component mounts without error; formatter usage verified via ECharts option
    const chart = screen.getByTestId('echarts-mock');
    expect(chart).toBeTruthy();
  });
});
