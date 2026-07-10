/**
 * @vitest-environment jsdom
 *
 * useCostAnalysis 单元测试 — evidence-loop oracle 第一层
 *
 * 守护 880 行 hook 的 8 个 fetch 方法 + summary 计算 + fetchDataBySubTab 路由 + reset
 * 行为不变，作为后续重构的回归基线。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../src/shared/api/client', () => ({
  apiClient: { getCostAnalysis: vi.fn() },
}));

vi.mock('@/shared/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { useCostAnalysis } from '../../../src/features/cost/hooks/useCostAnalysis';
import { apiClient } from '../../../src/shared/api/client';

const mockApi = apiClient.getCostAnalysis as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApi.mockReset();
});

const makeClaimRow = (
  overrides: Partial<{
    total_premium: number;
    total_reported_claims: number;
    earned_premium: number;
    policy_count: number;
  }> = {}
) => ({
  total_premium: 100,
  total_reported_claims: 50,
  earned_premium: 200,
  policy_count: 5,
  ...overrides,
});

const makeExpenseRow = (
  overrides: Partial<{
    total_premium: number;
    total_fee: number;
    policy_count: number;
  }> = {}
) => ({
  total_premium: 1000,
  total_fee: 150,
  policy_count: 10,
  ...overrides,
});

describe('useCostAnalysis', () => {
  describe('init', () => {
    it('初始 8 个 state 全 empty + loading=false + error=null', () => {
      const { result } = renderHook(() => useCostAnalysis());
      const ratioStates = [
        result.current.claimRatioState,
        result.current.expenseRatioState,
        result.current.comprehensiveCostState,
        result.current.variableCostState,
        result.current.variableCostKpiState,
      ];
      ratioStates.forEach((s) => {
        expect(s.data).toEqual([]);
        expect(s.loading).toBe(false);
        expect(s.error).toBeNull();
      });
      expect(result.current.earnedPremiumState.data).toEqual([]);
      expect(result.current.earnedPremiumState.summaryData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyPrevInPrevData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyPrevInCurrData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyCurrInCurrData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyCurrInNextData).toEqual([]);
      expect(result.current.expenseRatioForecastState.forecastData).toEqual([]);
      expect(result.current.expenseRatioForecastState.monthlyExpenseData).toEqual([]);
    });
  });

  describe('fetchClaimRatioData', () => {
    it('成功：data + summary（avgClaimRatio = totalClaims/totalEarnedPremium*100）', async () => {
      mockApi.mockResolvedValueOnce([
        makeClaimRow({ total_premium: 100, total_reported_claims: 50, earned_premium: 200 }),
        makeClaimRow({ total_premium: 200, total_reported_claims: 100, earned_premium: 400 }),
      ]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('insurance_type', '2026-04-29');
      });
      expect(result.current.claimRatioState.data).toHaveLength(2);
      expect(result.current.claimRatioState.summary.totalPremium).toBe(300);
      expect(result.current.claimRatioState.summary.totalClaims).toBe(150);
      expect(result.current.claimRatioState.summary.avgClaimRatio).toBe(25);
      expect(result.current.claimRatioState.summary.policyCount).toBe(10);
      expect(result.current.claimRatioState.loading).toBe(false);
      expect(result.current.claimRatioState.error).toBeNull();
    });

    it('earned_premium=0 → avgClaimRatio=null（防除零）', async () => {
      mockApi.mockResolvedValueOnce([makeClaimRow({ earned_premium: 0 })]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('x', 'y');
      });
      expect(result.current.claimRatioState.summary.avgClaimRatio).toBeNull();
    });

    it('Error 异常 → error=Error.message + data 不变', async () => {
      mockApi.mockRejectedValueOnce(new Error('Network failed'));
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('x', 'y');
      });
      expect(result.current.claimRatioState.error).toBe('Network failed');
      expect(result.current.claimRatioState.loading).toBe(false);
      expect(result.current.claimRatioState.data).toEqual([]);
    });

    it('非 Error 抛出 → 默认"查询失败"', async () => {
      mockApi.mockRejectedValueOnce('string error');
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('x', 'y');
      });
      expect(result.current.claimRatioState.error).toBe('查询失败');
    });

    it('非数组响应 → data=[]（防御性收敛）', async () => {
      mockApi.mockResolvedValueOnce({ not: 'an array' });
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('x', 'y');
      });
      expect(result.current.claimRatioState.data).toEqual([]);
    });

    it('filterParams 透传 + 不覆盖 analysisType/dimension/cutoffDate', async () => {
      mockApi.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('insurance_type', '2026-04-29', {
          insurance_type: 'true',
          is_nev: '否',
        });
      });
      expect(mockApi).toHaveBeenCalledWith({
        analysisType: 'claimRatio',
        dimension: 'insurance_type',
        cutoffDate: '2026-04-29',
        insurance_type: 'true',
        is_nev: '否',
      });
    });
  });

  describe('fetchExpenseRatioData', () => {
    it('成功：avgExpenseRatio = totalFee/totalPremium*100', async () => {
      mockApi.mockResolvedValueOnce([
        makeExpenseRow({ total_premium: 1000, total_fee: 150 }),
        makeExpenseRow({ total_premium: 2000, total_fee: 300 }),
      ]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioData('org_level_3', '2026-04-29');
      });
      expect(result.current.expenseRatioState.summary.avgExpenseRatio).toBe(15);
      expect(result.current.expenseRatioState.summary.totalFee).toBe(450);
      expect(result.current.expenseRatioState.summary.totalPremium).toBe(3000);
    });

    it('totalPremium=0 → avgExpenseRatio=null', async () => {
      mockApi.mockResolvedValueOnce([makeExpenseRow({ total_premium: 0, total_fee: 100 })]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioData('x', 'y');
      });
      expect(result.current.expenseRatioState.summary.avgExpenseRatio).toBeNull();
    });

    it('错误 → error 设置', async () => {
      mockApi.mockRejectedValueOnce(new Error('fail'));
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioData('x', 'y');
      });
      expect(result.current.expenseRatioState.error).toBe('fail');
    });
  });

  describe('fetchComprehensiveCostData', () => {
    it('成功：summary 同时含 avgClaimRatio + avgExpenseRatio', async () => {
      mockApi.mockResolvedValueOnce([
        {
          total_premium: 1000,
          total_reported_claims: 500,
          total_fee: 150,
          earned_premium: 1000,
          policy_count: 10,
        },
      ]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchComprehensiveCostData('insurance_type', '2026-04-29');
      });
      expect(result.current.comprehensiveCostState.summary.avgClaimRatio).toBe(50);
      expect(result.current.comprehensiveCostState.summary.avgExpenseRatio).toBe(15);
      expect(result.current.comprehensiveCostState.summary.totalClaims).toBe(500);
      expect(result.current.comprehensiveCostState.summary.totalFee).toBe(150);
    });

    it('错误 → error 设置', async () => {
      mockApi.mockRejectedValueOnce(new Error('comp fail'));
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchComprehensiveCostData('x', 'y');
      });
      expect(result.current.comprehensiveCostState.error).toBe('comp fail');
    });
  });

  describe('fetchVariableCostData', () => {
    it('成功：summary 与 comprehensive 同口径', async () => {
      mockApi.mockResolvedValueOnce([
        {
          total_premium: 2000,
          total_reported_claims: 800,
          total_fee: 200,
          earned_premium: 2000,
          policy_count: 20,
        },
      ]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchVariableCostData('insurance_type', '2026-04-29');
      });
      expect(result.current.variableCostState.summary.totalPremium).toBe(2000);
      expect(result.current.variableCostState.summary.avgClaimRatio).toBe(40);
      expect(result.current.variableCostState.summary.avgExpenseRatio).toBe(10);
    });

    it('错误 → error 设置', async () => {
      mockApi.mockRejectedValueOnce(new Error('var fail'));
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchVariableCostData('x', 'y');
      });
      expect(result.current.variableCostState.error).toBe('var fail');
    });
  });

  describe('fetchVariableCostKpiData', () => {
    it('固定 dimension=org_level_3（不接受 dimension 参数）', async () => {
      mockApi.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchVariableCostKpiData('2026-04-29');
      });
      expect(mockApi).toHaveBeenCalledWith({
        analysisType: 'variableCost',
        dimension: 'org_level_3',
        cutoffDate: '2026-04-29',
      });
    });

    it('错误 → variableCostKpiState.error', async () => {
      mockApi.mockRejectedValueOnce(new Error('kpi fail'));
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchVariableCostKpiData('x');
      });
      expect(result.current.variableCostKpiState.error).toBe('kpi fail');
    });
  });

  describe('fetchEarnedPremiumData', () => {
    it('成功：data 是数组 + summaryData=[]（前端不算汇总）', async () => {
      mockApi.mockResolvedValueOnce([
        { policy_month: '2026-01', earned_premium: 100 },
        { policy_month: '2026-02', earned_premium: 200 },
      ]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchEarnedPremiumData('2026-04-29');
      });
      expect(result.current.earnedPremiumState.data).toHaveLength(2);
      expect(result.current.earnedPremiumState.summaryData).toEqual([]);
    });

    it('请求体含 type:"earned" + 透传 filterParams', async () => {
      mockApi.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchEarnedPremiumData('2026-04-29', { x: 'y' });
      });
      expect(mockApi).toHaveBeenCalledWith({
        type: 'earned',
        cutoffDate: '2026-04-29',
        x: 'y',
      });
    });

    it('错误 → error 设置 + 返回兜底 {detailData:[], summaryData:[]}', async () => {
      mockApi.mockRejectedValueOnce(new Error('earned fail'));
      const { result } = renderHook(() => useCostAnalysis());
      let ret: unknown;
      await act(async () => {
        ret = await result.current.fetchEarnedPremiumData('2026-04-29');
      });
      expect(result.current.earnedPremiumState.error).toBe('earned fail');
      expect(ret).toEqual({ detailData: [], summaryData: [] });
    });
  });

  describe('fetchNewEarnedPremiumData', () => {
    it('成功：anchorYear + 四象限 dataset 落位 + 前端 summaryData 不为 null', async () => {
      mockApi.mockResolvedValueOnce({
        anchorYear: 2026,
        policyPrevInPrev: [{ policy_month: 1, premium: 100, earned_01: 10 }],
        policyPrevInCurr: [{ policy_month: 1, earned_01: 5 }],
        policyCurrInCurr: [{ policy_month: 1, premium: 30, earned_01: 3 }],
        policyCurrInNext: [{ policy_month: 1, earned_01: 2 }],
      });
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchNewEarnedPremiumData();
      });
      expect(result.current.newEarnedPremiumState.anchorYear).toBe(2026);
      expect(result.current.newEarnedPremiumState.policyPrevInPrevData).toHaveLength(1);
      expect(result.current.newEarnedPremiumState.policyPrevInCurrData).toHaveLength(1);
      expect(result.current.newEarnedPremiumState.policyCurrInCurrData).toHaveLength(1);
      expect(result.current.newEarnedPremiumState.policyCurrInNextData).toHaveLength(1);
      expect(result.current.newEarnedPremiumState.summaryData).toBeDefined();
      expect(Array.isArray(result.current.newEarnedPremiumState.summaryData)).toBe(true);
      // summaryData 的统计月锚定 anchorYear
      expect(result.current.newEarnedPremiumState.summaryData[0].stat_month).toBe('2026-01');
    });

    it('请求体含 type:"earned-new" + filterParams', async () => {
      mockApi.mockResolvedValueOnce({});
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchNewEarnedPremiumData({ is_nev: '是' });
      });
      expect(mockApi).toHaveBeenCalledWith({
        type: 'earned-new',
        is_nev: '是',
      });
    });

    it('响应 null → 4 个 dataset 都是 []', async () => {
      mockApi.mockResolvedValueOnce(null);
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchNewEarnedPremiumData();
      });
      expect(result.current.newEarnedPremiumState.policyPrevInPrevData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyPrevInCurrData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyCurrInCurrData).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyCurrInNextData).toEqual([]);
    });

    it('错误 → error 设置 + 返回兜底', async () => {
      mockApi.mockRejectedValueOnce(new Error('new earned fail'));
      const { result } = renderHook(() => useCostAnalysis());
      let ret: { policyPrevInPrevData: unknown[] } | undefined;
      await act(async () => {
        ret = (await result.current.fetchNewEarnedPremiumData()) as typeof ret;
      });
      expect(result.current.newEarnedPremiumState.error).toBe('new earned fail');
      expect(ret?.policyPrevInPrevData).toEqual([]);
    });
  });

  describe('fetchExpenseRatioForecastData', () => {
    it('成功：前端计算 operating_cost + window filter + comprehensive_expense_ratio', async () => {
      mockApi.mockResolvedValueOnce({
        anchorYear: 2026,
        summaryData: [
          {
            stat_month: '2026-04',
            earned_from_prev: 1000,
            earned_from_curr: 2000,
            total_earned_premium: 3000,
          },
        ],
        monthlyExpenseData: [
          { policy_month: '2026-01', total_fee: 100, tax: 10 },
          { policy_month: '2026-02', total_fee: 100, tax: 10 },
          { policy_month: '2026-05', total_fee: 9999, tax: 9999 },
        ],
      });
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioForecastData(undefined, 9);
      });
      const forecast = result.current.expenseRatioForecastState.forecastData[0];
      expect(forecast.stat_month).toBe('2026-04');
      expect(forecast.operating_cost).toBe(270);
      expect(forecast.total_fee).toBe(200);
      expect(forecast.total_tax).toBe(20);
      expect(forecast.total_expense).toBe(220);
      expect(forecast.comprehensive_expense_ratio).toBeCloseTo(16.333, 2);
      expect(forecast.operating_cost_rate).toBe(9);
      expect(forecast.expense_window_start).toBe('2025-05');
      expect(forecast.expense_window_end).toBe('2026-03');
    });

    it('total_earned_premium=0 → comprehensive_expense_ratio=0', async () => {
      mockApi.mockResolvedValueOnce({
        anchorYear: 2026,
        summaryData: [
          {
            stat_month: '2026-04',
            earned_from_prev: 0,
            earned_from_curr: 0,
            total_earned_premium: 0,
          },
        ],
        monthlyExpenseData: [],
      });
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioForecastData();
      });
      expect(
        result.current.expenseRatioForecastState.forecastData[0].comprehensive_expense_ratio
      ).toBe(0);
    });

    it('默认 operatingCostRate=9（无显式传入）', async () => {
      mockApi.mockResolvedValueOnce({ summaryData: [], monthlyExpenseData: [] });
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioForecastData();
      });
      expect(mockApi).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'expense-forecast',
          operatingCostRate: '9',
        })
      );
    });

    it('自定义 operatingCostRate 透传', async () => {
      mockApi.mockResolvedValueOnce({ summaryData: [], monthlyExpenseData: [] });
      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchExpenseRatioForecastData(undefined, 12);
      });
      expect(mockApi).toHaveBeenCalledWith(
        expect.objectContaining({
          operatingCostRate: '12',
        })
      );
    });

    it('错误 → error 设置 + 返回兜底', async () => {
      mockApi.mockRejectedValueOnce(new Error('forecast fail'));
      const { result } = renderHook(() => useCostAnalysis());
      let ret: { forecastData: unknown[] } | undefined;
      await act(async () => {
        ret = (await result.current.fetchExpenseRatioForecastData()) as typeof ret;
      });
      expect(result.current.expenseRatioForecastState.error).toBe('forecast fail');
      expect(ret?.forecastData).toEqual([]);
    });
  });

  describe('fetchDataBySubTab', () => {
    const cases: Array<{
      subTab: string;
      expectedAnalysisType?: string;
      expectedType?: string;
    }> = [
      { subTab: 'claim', expectedAnalysisType: 'claimRatio' },
      { subTab: 'expense', expectedAnalysisType: 'expenseRatio' },
      { subTab: 'comprehensive', expectedAnalysisType: 'comprehensiveCost' },
      { subTab: 'variable', expectedAnalysisType: 'variableCost' },
      { subTab: 'earned', expectedType: 'earned' },
      { subTab: 'earned-new', expectedType: 'earned-new' },
    ];

    cases.forEach(({ subTab, expectedAnalysisType, expectedType }) => {
      it(`case "${subTab}" → 调对应 fetch（请求体匹配）`, async () => {
        mockApi.mockResolvedValueOnce(expectedType === 'earned-new' ? {} : []);
        const { result } = renderHook(() => useCostAnalysis());
        await act(async () => {
          await result.current.fetchDataBySubTab(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            subTab as any,
            'insurance_type',
            '2026-04-29'
          );
        });
        if (expectedAnalysisType) {
          expect(mockApi).toHaveBeenCalledWith(
            expect.objectContaining({
              analysisType: expectedAnalysisType,
            })
          );
        } else if (expectedType) {
          expect(mockApi).toHaveBeenCalledWith(
            expect.objectContaining({
              type: expectedType,
            })
          );
        }
      });
    });

    it('未知 subTab → 返回 [] 不调 apiClient', async () => {
      const { result } = renderHook(() => useCostAnalysis());
      let ret: unknown;
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ret = await result.current.fetchDataBySubTab('UNKNOWN' as any, 'd', 'c');
      });
      expect(mockApi).not.toHaveBeenCalled();
      expect(ret).toEqual([]);
    });
  });

  describe('reset', () => {
    it('污染 3 个 state 后 reset → 8 个 state 全回到初始 empty', async () => {
      mockApi.mockResolvedValueOnce([makeClaimRow()]);
      mockApi.mockResolvedValueOnce([makeExpenseRow()]);
      mockApi.mockResolvedValueOnce({
        anchorYear: 2026,
        policyPrevInPrev: [{ policy_month: 1 }],
        policyPrevInCurr: [],
        policyCurrInCurr: [],
        policyCurrInNext: [],
      });

      const { result } = renderHook(() => useCostAnalysis());
      await act(async () => {
        await result.current.fetchClaimRatioData('x', 'y');
      });
      await act(async () => {
        await result.current.fetchExpenseRatioData('x', 'y');
      });
      await act(async () => {
        await result.current.fetchNewEarnedPremiumData();
      });

      expect(result.current.claimRatioState.data).toHaveLength(1);
      expect(result.current.expenseRatioState.data).toHaveLength(1);
      expect(result.current.newEarnedPremiumState.policyPrevInPrevData).toHaveLength(1);

      act(() => {
        result.current.reset();
      });

      expect(result.current.claimRatioState.data).toEqual([]);
      expect(result.current.expenseRatioState.data).toEqual([]);
      expect(result.current.comprehensiveCostState.data).toEqual([]);
      expect(result.current.variableCostState.data).toEqual([]);
      expect(result.current.variableCostKpiState.data).toEqual([]);
      expect(result.current.earnedPremiumState.data).toEqual([]);
      expect(result.current.newEarnedPremiumState.policyPrevInPrevData).toEqual([]);
      expect(result.current.expenseRatioForecastState.forecastData).toEqual([]);
    });
  });
});
