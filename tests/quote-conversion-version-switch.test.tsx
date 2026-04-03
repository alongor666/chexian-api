import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QuoteConversionPage } from '../src/features/quote-conversion/QuoteConversionPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../src/shared/api/client';
import { filtersToParams, useQuoteFunnel, useQuoteKpi } from '../src/features/quote-conversion/hooks/useQuoteConversion';

const mockUseQuoteKpi = vi.fn();
const mockUseQuoteFunnel = vi.fn();
const mockUseQuoteTrend = vi.fn();
let useActualQuoteDataHooks = false;

vi.mock('../src/features/quote-conversion/hooks/useQuoteConversion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/quote-conversion/hooks/useQuoteConversion')>();
  return {
    ...actual,
    useQuoteKpi: (...args: unknown[]) => useActualQuoteDataHooks ? actual.useQuoteKpi(...args as [Parameters<typeof actual.useQuoteKpi>[0]]) : mockUseQuoteKpi(...args),
    useQuoteFunnel: (...args: unknown[]) => useActualQuoteDataHooks ? actual.useQuoteFunnel(...args as [Parameters<typeof actual.useQuoteFunnel>[0]]) : mockUseQuoteFunnel(...args),
    useQuoteTrend: (...args: unknown[]) => mockUseQuoteTrend(...args),
  };
});

vi.mock('../src/features/quote-conversion/components/ConversionFunnel', () => ({
  ConversionFunnel: () => <div data-testid="conversion-funnel">ConversionFunnel</div>,
}));

vi.mock('../src/features/quote-conversion/components/DrilldownTable', () => ({
  DrilldownTable: () => <div data-testid="drilldown-table">DrilldownTable</div>,
}));

vi.mock('../src/features/quote-conversion/components/DimensionMatrix', () => ({
  DimensionMatrix: () => <div data-testid="dimension-matrix">DimensionMatrix</div>,
}));

vi.mock('../src/features/quote-conversion/components/PriceSensitivity', () => ({
  PriceSensitivity: () => <div data-testid="price-sensitivity">PriceSensitivity</div>,
}));

const LocationEcho = () => {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
};

function HookProbe({ filters }: { filters: Parameters<typeof useQuoteKpi>[0] }) {
  useQuoteKpi(filters);
  useQuoteFunnel(filters);
  return null;
}

function renderPage(initialEntry = '/quote-conversion') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/quote-conversion"
          element={
            <>
              <QuoteConversionPage />
              <LocationEcho />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('quote conversion version switch', () => {
  beforeEach(() => {
    useActualQuoteDataHooks = false;
    mockUseQuoteKpi.mockReset();
    mockUseQuoteFunnel.mockReset();
    mockUseQuoteTrend.mockReset();

    mockUseQuoteKpi.mockReturnValue({ data: undefined, isLoading: false });
    mockUseQuoteFunnel.mockReturnValue({ data: [], isLoading: false });
    mockUseQuoteTrend.mockReturnValue({ data: [], isLoading: false });
  });

  it('默认无查询参数时激活版本 A', () => {
    renderPage();

    expect(screen.getByRole('tab', { name: '版本 A' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '版本 B' }).getAttribute('aria-selected')).toBe('false');
    // URL 为单一真实源：默认版本 A 时无需显式写入 URL，空参数即为 A
    expect(screen.getByTestId('location-search').textContent).toBe('');
  });

  it('?version=B 时激活版本 B', () => {
    renderPage('/quote-conversion?version=B');

    expect(screen.getByRole('tab', { name: '版本 B' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('版本 B 专题分析开发中')).toBeNull();
    expect(screen.getByRole('tab', { name: '总览' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '续/转保' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '三级机构' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '险别/客户/等级' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '月度趋势' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '折扣/NCD' })).not.toBeNull();
    expect(screen.queryByText('整体转化漏斗')).not.toBeNull();
    expect(screen.getByTestId('location-search').textContent).toBe('?version=B');
  });

  it('版本 B 的专属筛选切回版本 A 后仍保留共享状态', () => {
    renderPage('/quote-conversion?version=B');

    fireEvent.change(screen.getByLabelText('电销'), { target: { value: '电销' } });

    fireEvent.click(screen.getByRole('tab', { name: '版本 A' }));

    expect(screen.queryByLabelText('电销')).toBeNull();
    expect(screen.queryByText('专题筛选已生效')).not.toBeNull();
    expect(screen.queryByText('电销: 电销')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '版本 B' }));

    expect((screen.getByLabelText('电销') as HTMLSelectElement).value).toBe('电销');
  });

  it('GlobalFilters 在版本 A 不显示 B 专属筛选，在版本 B 显示', () => {
    renderPage();

    expect(screen.queryByLabelText('电销')).toBeNull();
    expect(screen.queryByLabelText('新能源')).toBeNull();
    expect(screen.queryByLabelText('过户车')).toBeNull();
    expect(screen.queryByLabelText('车险分等级')).toBeNull();
    expect(screen.queryByLabelText('NCD 最小值')).toBeNull();
    expect(screen.queryByLabelText('NCD 最大值')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '版本 B' }));

    expect(screen.queryByLabelText('电销')).not.toBeNull();
    expect(screen.queryByLabelText('新能源')).not.toBeNull();
    expect(screen.queryByLabelText('过户车')).not.toBeNull();
    expect(screen.queryByLabelText('车险分等级')).not.toBeNull();
    expect(screen.queryByLabelText('NCD 最小值')).not.toBeNull();
    expect(screen.queryByLabelText('NCD 最大值')).not.toBeNull();
  });

  it('版本 B 专属筛选会透传到 A 版 hooks 参数', () => {
    renderPage('/quote-conversion?version=B');

    fireEvent.change(screen.getByLabelText('电销'), { target: { value: '电销' } });
    fireEvent.change(screen.getByLabelText('新能源'), { target: { value: '是' } });
    fireEvent.change(screen.getByLabelText('过户车'), { target: { value: '否' } });
    fireEvent.change(screen.getByLabelText('车险分等级'), { target: { value: 'C' } });
    fireEvent.change(screen.getByLabelText('NCD 最小值'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('NCD 最大值'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('tab', { name: '版本 A' }));

    const latestKpiCall = mockUseQuoteKpi.mock.calls.at(-1);
    const latestFunnelCall = mockUseQuoteFunnel.mock.calls.at(-1);
    expect(latestKpiCall).not.toBeUndefined();
    expect(latestFunnelCall).not.toBeUndefined();
    expect(latestKpiCall?.[0]).toMatchObject({
      isTelemarketing: '电销',
      isNewEnergy: '是',
      isTransferred: '否',
      riskGrade: 'C',
      ncdMin: '10',
      ncdMax: '20',
    });
    expect(latestFunnelCall?.[0]).toMatchObject({
      isTelemarketing: '电销',
      isNewEnergy: '是',
      isTransferred: '否',
      riskGrade: 'C',
      ncdMin: '10',
      ncdMax: '20',
    });
  });

  it('真实 useQuoteKpi/useQuoteFunnel 会通过 filtersToParams 将 6 个专题字段传给 apiClient', async () => {
    useActualQuoteDataHooks = true;
    const filters = {
      isTelemarketing: '电销' as const,
      isNewEnergy: '是' as const,
      isTransferred: '否' as const,
      riskGrade: 'C',
      ncdMin: '10',
      ncdMax: '20',
    };
    const kpiSpy = vi.spyOn(apiClient, 'getQuoteConversionKpi').mockResolvedValue({} as never);
    const funnelSpy = vi.spyOn(apiClient, 'getQuoteConversionFunnel').mockResolvedValue([] as never);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <HookProbe filters={filters} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(kpiSpy).toHaveBeenCalledTimes(1);
      expect(funnelSpy).toHaveBeenCalledTimes(1);
    });

    expect(kpiSpy.mock.calls[0]?.[0]).toMatchObject(filters);
    expect(funnelSpy.mock.calls[0]?.[0]).toMatchObject(filters);

    kpiSpy.mockRestore();
    funnelSpy.mockRestore();
    queryClient.clear();
    useActualQuoteDataHooks = false;
  });

  it('filtersToParams 会映射 6 个新增筛选字段', () => {
    expect(
      filtersToParams({
        isTelemarketing: '电销',
        isNewEnergy: '是',
        isTransferred: '否',
        riskGrade: 'C',
        ncdMin: '10',
        ncdMax: '20',
      })
    ).toMatchObject({
      isTelemarketing: '电销',
      isNewEnergy: '是',
      isTransferred: '否',
      riskGrade: 'C',
      ncdMin: '10',
      ncdMax: '20',
    });
  });

  it('A 版 TimeTrend 默认调用 useQuoteTrend(filters, month)', () => {
    renderPage();

    const latestTrendCall = mockUseQuoteTrend.mock.calls.at(-1);
    expect(latestTrendCall).not.toBeUndefined();
    expect(latestTrendCall?.[0]).toMatchObject({});
    expect(latestTrendCall?.[1]).toBe('month');
  });
});
