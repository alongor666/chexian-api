/**
 * useStableParams 单测（治理计划 Task 1-B，评审 🟡3）
 *
 * 保证「参数值不变 ⇒ 引用不变」：黑名单式全量透传后，
 * 被剥离字段（如全局日期）变化会让 useMemo 产出新对象，
 * 但值相同时必须返回旧引用，否则依赖它的 useEffect 会多发请求。
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStableParams } from '../useStableParams';

describe('useStableParams', () => {
  it('值相同的新对象 → 返回旧引用', () => {
    const first = { a: '1', b: '2' };
    const { result, rerender } = renderHook(({ value }) => useStableParams(value), {
      initialProps: { value: first },
    });
    expect(result.current).toBe(first);

    rerender({ value: { a: '1', b: '2' } }); // 新对象、同值
    expect(result.current).toBe(first); // 引用稳定
  });

  it('值变化 → 返回新引用', () => {
    const first: Record<string, string> = { a: '1' };
    const { result, rerender } = renderHook(({ value }) => useStableParams(value), {
      initialProps: { value: first },
    });

    const second = { a: '1', insuranceType: 'true' };
    rerender({ value: second });
    expect(result.current).toBe(second);
  });

  it('键序不同但值相同 → 视为相同（引用稳定）', () => {
    const first: Record<string, string> = { a: '1', b: '2' };
    const { result, rerender } = renderHook(({ value }) => useStableParams(value), {
      initialProps: { value: first },
    });

    rerender({ value: { b: '2', a: '1' } });
    expect(result.current).toBe(first);
  });
});
