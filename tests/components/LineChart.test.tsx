/**
 * @vitest-environment jsdom
 * LineChart 组件单元测试 (B123)
 *
 * 2026-07-07 ECharts 容器归一（backlog 2026-07-07-claude-821d85）后，
 * LineChart 不再手写 echarts.init 生命周期，改为构建 option 交给
 * EChartContainer（内部为 echarts-for-react）。测试相应改为 mock
 * ReactEChartsCore 捕获 props，断言同一批行为契约（空态文案 / Y 轴
 * 标签 / 机构分组系列 / loading / 高度）。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../src/shared/theme';

const capturedProps: Array<Record<string, any>> = [];

vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div data-testid="echarts-mock" style={props.style as React.CSSProperties} />;
  },
}));

vi.mock('../../src/shared/styles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/styles')>();
  return {
    ...actual,
    getYearChartColor: (_year: string) => '#FF6B6B',
  };
});

import { LineChart } from '../../src/widgets/charts/LineChart';

const sampleData = [
  { time_period: '2025-01', org_level_3: '乐山', premium: 100, next_month_ratio: 0.3 },
  { time_period: '2025-02', org_level_3: '乐山', premium: 120, next_month_ratio: 0.4 },
  { time_period: '2025-01', org_level_3: '天府', premium: 80, next_month_ratio: 0.2 },
];

const lastProps = () => capturedProps[capturedProps.length - 1];

describe('LineChart', () => {
  beforeEach(() => {
    capturedProps.length = 0;
    vi.clearAllMocks();
  });

  it('renders a div container', () => {
    const { container } = render(
      <ThemeProvider><LineChart title="保费趋势" data={sampleData} timeView="monthly" /></ThemeProvider>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders through the shared EChartContainer', () => {
    const { getByTestId } = render(
      <ThemeProvider><LineChart title="保费趋势" data={sampleData} timeView="monthly" /></ThemeProvider>
    );
    expect(getByTestId('echarts-mock')).toBeTruthy();
    expect(lastProps()?.option).toBeTruthy();
  });

  it('enables built-in loading when loading=true', () => {
    render(<ThemeProvider><LineChart title="保费趋势" data={sampleData} loading={true} timeView="monthly" /></ThemeProvider>);
    expect(lastProps()?.showLoading).toBe(true);
  });

  it('passes option with data when loading=false', () => {
    render(<ThemeProvider><LineChart title="保费趋势" data={sampleData} timeView="monthly" /></ThemeProvider>);
    expect(lastProps()?.showLoading).toBe(false);
    expect(lastProps()?.option?.series?.length).toBeGreaterThan(0);
  });

  it('renders empty state when data is empty', () => {
    render(<ThemeProvider><LineChart title="暂无数据测试" data={[]} timeView="monthly" /></ThemeProvider>);
    const option = lastProps()?.option;
    expect(option?.graphic?.style?.text).toBe('暂无数据');
    expect(option?.title?.text).toBe('暂无数据测试');
  });

  it('applies custom height', () => {
    render(
      <ThemeProvider><LineChart title="趋势" data={sampleData} height={600} timeView="weekly" /></ThemeProvider>
    );
    expect(lastProps()?.style?.height).toBe(600);
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
    const option = lastProps()?.option;
    const yAxis = Array.isArray(option?.yAxis) ? option.yAxis : [];
    // The first y-axis name should match the label
    expect(yAxis[0]?.name).toBe('商业险件数');
  });

  it('groups data by org_level_3 into series', () => {
    render(<ThemeProvider><LineChart title="趋势" data={sampleData} timeView="monthly" /></ThemeProvider>);
    const option = lastProps()?.option;
    // Should have series for both 乐山 and 天府
    const seriesNames = (option?.series ?? []).map((s: any) => s.name as string);
    const hasLeshan = seriesNames.some((n: string) => n.includes('乐山'));
    const hasTianfu = seriesNames.some((n: string) => n.includes('天府'));
    expect(hasLeshan).toBe(true);
    expect(hasTianfu).toBe(true);
  });
});
