/**
 * @vitest-environment jsdom
 * LineChart 组件单元测试 (B123)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../src/shared/theme';

// LineChart uses echarts.init via useRef, so mock the echarts module
const mockShowLoading = vi.fn();
const mockHideLoading = vi.fn();
const mockSetOption = vi.fn();
const mockResize = vi.fn();
const mockDispose = vi.fn();

const mockChartInstance = {
  showLoading: mockShowLoading,
  hideLoading: mockHideLoading,
  setOption: mockSetOption,
  resize: mockResize,
  dispose: mockDispose,
};

vi.mock('../../src/shared/utils/echarts', () => ({
  echarts: {
    init: vi.fn(() => mockChartInstance),
  },
}));

vi.mock('../../src/shared/styles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/styles')>();
  return {
    ...actual,
    getYearChartColor: (year: string) => '#FF6B6B',
  };
});

import { LineChart } from '../../src/widgets/charts/LineChart';

const sampleData = [
  { time_period: '2025-01', org_level_3: '乐山', premium: 100, next_month_ratio: 0.3 },
  { time_period: '2025-02', org_level_3: '乐山', premium: 120, next_month_ratio: 0.4 },
  { time_period: '2025-01', org_level_3: '天府', premium: 80, next_month_ratio: 0.2 },
];

describe('LineChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a div container', () => {
    const { container } = render(
      <ThemeProvider><LineChart title="保费趋势" data={sampleData} timeView="monthly" /></ThemeProvider>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('calls echarts.init on mount', async () => {
    const { echarts } = await import('../../src/shared/utils/echarts');
    render(<ThemeProvider><LineChart title="保费趋势" data={sampleData} timeView="monthly" /></ThemeProvider>);
    expect(echarts.init).toHaveBeenCalled();
  });

  it('calls showLoading when loading=true', async () => {
    render(<ThemeProvider><LineChart title="保费趋势" data={sampleData} loading={true} timeView="monthly" /></ThemeProvider>);
    expect(mockShowLoading).toHaveBeenCalled();
  });

  it('calls setOption with data when loading=false', () => {
    render(<ThemeProvider><LineChart title="保费趋势" data={sampleData} timeView="monthly" /></ThemeProvider>);
    expect(mockSetOption).toHaveBeenCalled();
  });

  it('renders empty state when data is empty', () => {
    render(<ThemeProvider><LineChart title="暂无数据测试" data={[]} timeView="monthly" /></ThemeProvider>);
    // setOption called with empty state
    expect(mockSetOption).toHaveBeenCalled();
    const callArg = mockSetOption.mock.calls[0]?.[0];
    expect(callArg?.graphic?.style?.text).toBe('暂无数据');
  });

  it('applies custom height', () => {
    const { container } = render(
      <ThemeProvider><LineChart title="趋势" data={sampleData} height={600} timeView="weekly" /></ThemeProvider>
    );
    const chartDiv = container.querySelector('[style*="height"]');
    expect(chartDiv).toBeTruthy();
  });

  it('passes yAxisLabel to chart options', () => {
    render(
      <ThemeProvider>
        <LineChart
          title="商业险件数"
          data={sampleData}
          timeView="monthly"
          yAxisLabel="商业险件数"
        />
      </ThemeProvider>
    );
    expect(mockSetOption).toHaveBeenCalled();
    const callArg = mockSetOption.mock.calls[0]?.[0];
    const yAxis = Array.isArray(callArg?.yAxis) ? callArg.yAxis : [];
    // The first y-axis name should match the label
    expect(yAxis[0]?.name).toBe('商业险件数');
  });

  it('groups data by org_level_3 into series', () => {
    render(<ThemeProvider><LineChart title="趋势" data={sampleData} timeView="monthly" /></ThemeProvider>);
    const callArg = mockSetOption.mock.calls[0]?.[0];
    // Should have series for both 乐山 and 天府
    const seriesNames = (callArg?.series ?? []).map((s: any) => s.name as string);
    const hasLeshan = seriesNames.some((n: string) => n.includes('乐山'));
    const hasTianfu = seriesNames.some((n: string) => n.includes('天府'));
    expect(hasLeshan).toBe(true);
    expect(hasTianfu).toBe(true);
  });
});
