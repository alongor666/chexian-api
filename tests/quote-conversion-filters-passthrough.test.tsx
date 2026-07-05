import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QuoteConversionPage } from '../src/features/quote-conversion/QuoteConversionPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../src/shared/api/client';
import { filtersToParams, useQuoteFunnel, useQuoteKpi } from '../src/features/quote-conversion/hooks/useQuoteConversion';

// Mock IntersectionObserver for jsdom
globalThis.IntersectionObserver ??= class IntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

vi.mock('@/shared/theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

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

function HookProbe({ filters }: { filters: Parameters<typeof useQuoteKpi>[0] }) {
  useQuoteKpi(filters);
  useQuoteFunnel(filters);
  return null;
}

function renderPage(initialEntry = '/quote-conversion') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/quote-conversion" element={<QuoteConversionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// 版本 A 下线后（BACKLOG 2026-06-11-claude-02aa70），报价转化页直接渲染六专题版（原版本 B），
// 不再有外层版本切换 tab。本文件保留「六专题专属筛选 → 取数 hooks/apiClient 参数透传」的覆盖。
describe('quote conversion 六专题筛选透传', () => {
  beforeEach(() => {
    useActualQuoteDataHooks = false;
    mockUseQuoteKpi.mockReset();
    mockUseQuoteFunnel.mockReset();
    mockUseQuoteTrend.mockReset();

    mockUseQuoteKpi.mockReturnValue({ data: undefined, isLoading: false });
    mockUseQuoteFunnel.mockReturnValue({ data: [], isLoading: false });
    mockUseQuoteTrend.mockReturnValue({ data: [], isLoading: false });
  });

  it('页面直接渲染六专题版，六专题 tab 与专属筛选齐全', () => {
    renderPage();

    expect(screen.getByText('版本 B · 旧车专题版')).not.toBeNull();
    expect(screen.getByRole('tab', { name: '总览' }).getAttribute('aria-selected')).toBe('true');
    for (const name of ['续/转保', '三级机构', '险别/客户/等级', '月度趋势', '折扣/NCD']) {
      expect(screen.getByRole('tab', { name })).not.toBeNull();
    }
    expect(screen.queryByText('整体转化漏斗')).not.toBeNull();

    // 六专题专属筛选（原版本 B 专属）现无条件渲染
    for (const label of ['电销', '新能源', '过户车', '车险分等级', 'NCD 最小值', 'NCD 最大值']) {
      expect(screen.queryByLabelText(label)).not.toBeNull();
    }
  });

  it('六专题专属筛选会透传到取数 hooks 参数', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('电销'), { target: { value: '电销' } });
    fireEvent.change(screen.getByLabelText('新能源'), { target: { value: '是' } });
    fireEvent.change(screen.getByLabelText('过户车'), { target: { value: '否' } });
    fireEvent.change(screen.getByLabelText('车险分等级'), { target: { value: 'C' } });
    fireEvent.change(screen.getByLabelText('NCD 最小值'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('NCD 最大值'), { target: { value: '20' } });

    const expected = {
      isTelemarketing: '电销',
      isNewEnergy: '是',
      isTransferred: '否',
      riskGrade: 'C',
      ncdMin: '10',
      ncdMax: '20',
    };
    expect(mockUseQuoteKpi.mock.calls.at(-1)?.[0]).toMatchObject(expected);
    expect(mockUseQuoteFunnel.mock.calls.at(-1)?.[0]).toMatchObject(expected);
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
    const kpiSpy = vi.spyOn(apiClient.quoteConversion, 'kpi').mockResolvedValue({} as never);
    const funnelSpy = vi.spyOn(apiClient.quoteConversion, 'funnel').mockResolvedValue([] as never);
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
});
