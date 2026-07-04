/**
 * useGrowthAnalysis 请求竞态守卫单测（BACKLOG 2026-06-11-claude-3ab3e3）
 *
 * 背景：fetchGrowthFromApi / analyzeDualMetricComparison 原无请求序号防护，
 * 快速连续调用（如用户快速切换分析类型/对比预设）时，先发出但慢返回的旧请求
 * 可能晚于新请求覆盖 state。本测试用可控延迟的 mock 响应模拟"旧请求慢、
 * 新请求快"的场景，断言最终 state 落定为最新请求的结果（旧响应被丢弃）。
 *
 * 不引入 AbortController（传输层 cancelRequest 语义已在 main 上定过调），
 * 纯靠 Hook 内部的 useRef 请求序号守卫。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockGetGrowthAnalysis = vi.fn();

vi.mock('../../../../shared/api/client', () => ({
  apiClient: {
    getGrowthAnalysis: (...args: unknown[]) => mockGetGrowthAnalysis(...args),
  },
}));

import { useGrowthAnalysis } from '../useGrowthAnalysis';

/** 生成一个可手动 resolve 的延迟 Promise，模拟慢/快请求交错到达 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useGrowthAnalysis 请求竞态守卫', () => {
  beforeEach(() => {
    mockGetGrowthAnalysis.mockReset();
  });

  it('fetchGrowthFromApi: 旧请求慢、新请求快 → 最终 state 是新请求结果，旧响应被丢弃', async () => {
    const oldResponse = deferred<unknown[]>();
    const newResponse = deferred<unknown[]>();

    mockGetGrowthAnalysis
      .mockImplementationOnce(() => oldResponse.promise) // 第一次调用（旧请求，慢）
      .mockImplementationOnce(() => newResponse.promise); // 第二次调用（新请求，快）

    const { result } = renderHook(() => useGrowthAnalysis());

    // 发起旧请求（不 await，模拟仍在途中）
    let oldCallResult: any;
    act(() => {
      result.current.analyzeOrgPremiumGrowth('机构A', 'yoy', 'monthly', 'premium', undefined, 2026)
        .then((r) => { oldCallResult = r; });
    });

    // 发起新请求（旧请求仍未 resolve）
    act(() => {
      result.current.analyzeOrgPremiumGrowth('机构B', 'yoy', 'monthly', 'premium', undefined, 2026);
    });

    // 新请求先返回
    await act(async () => {
      newResponse.resolve([
        { time_period: '2026-06', current_value: 200, previous_value: 100, growth_rate: 1 },
      ]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data[0]?.current_value).toBe(200);
    });

    // 旧请求随后才返回（更晚到达）
    await act(async () => {
      oldResponse.resolve([
        { time_period: '2026-05', current_value: 999, previous_value: 1, growth_rate: 998 },
      ]);
      await Promise.resolve();
    });

    // state 不应被旧响应覆盖，仍是新请求写入的数据
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]?.current_value).toBe(200);

    // 旧请求的 Promise 本身仍会 resolve（不阻塞调用方），但标记为 stale
    await waitFor(() => expect(oldCallResult).toBeDefined());
    expect(oldCallResult.stale).toBe(true);
  });

  it('analyzeDualMetricComparison: 旧请求慢、新请求快 → 调用方按 result.stale 丢弃旧响应', async () => {
    const oldResponse = deferred<unknown[]>();
    const newResponse = deferred<unknown[]>();

    mockGetGrowthAnalysis
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => newResponse.promise);

    const { result } = renderHook(() => useGrowthAnalysis());

    let oldResult: any;
    let newResult: any;

    act(() => {
      result.current
        .analyzeDualMetricComparison(
          { startDate: '2026-01-01', endDate: '2026-06-01' },
          { startDate: '2025-01-01', endDate: '2025-06-01' },
          ['org_level_3']
        )
        .then((r) => { oldResult = r; });
    });

    act(() => {
      result.current
        .analyzeDualMetricComparison(
          { startDate: '2026-01-01', endDate: '2026-07-01' },
          { startDate: '2025-01-01', endDate: '2025-07-01' },
          ['org_level_3']
        )
        .then((r) => { newResult = r; });
    });

    await act(async () => {
      newResponse.resolve([{ dim_key: '新机构', current_premium: 500, previous_premium: 400, current_count: 5, previous_count: 4 }]);
      await Promise.resolve();
    });

    await waitFor(() => expect(newResult).toBeDefined());
    expect(newResult.success).toBe(true);
    expect(newResult.data[0]?.dim_key).toBe('新机构');

    await act(async () => {
      oldResponse.resolve([{ dim_key: '旧机构-不应生效', current_premium: 1, previous_premium: 1, current_count: 1, previous_count: 1 }]);
      await Promise.resolve();
    });

    await waitFor(() => expect(oldResult).toBeDefined());
    // 旧请求应被判定为过期：success=false + stale=true，调用方据此不写入 comparisonData
    expect(oldResult.stale).toBe(true);
    expect(oldResult.success).toBe(false);
  });
});
