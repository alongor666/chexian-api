/**
 * useRevealedCharts 单测（chart-ledger 视口懒触发门控）
 *
 * 锁两条路径：
 *  1) 无 IntersectionObserver（老环境 / SSR）→ 降级为「全部 revealed」，保持原全量并发。
 *  2) 有 observer → 初始空集，元素进入视口后「增量」reveal，只点亮命中项、不误开其它图。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRevealedCharts } from '../useRevealedCharts';

const IDS = ['chart-01', 'chart-02'];

describe('useRevealedCharts', () => {
  let saved: typeof window.IntersectionObserver;

  beforeEach(() => {
    saved = window.IntersectionObserver;
    IDS.forEach((id) => {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    });
  });
  afterEach(() => {
    window.IntersectionObserver = saved;
    IDS.forEach((id) => document.getElementById(id)?.remove());
  });

  it('无 IntersectionObserver → 降级为全部 revealed', () => {
    // @ts-expect-error 显式删除以模拟不支持 observer 的环境
    delete window.IntersectionObserver;
    const { result } = renderHook(() => useRevealedCharts(IDS));
    expect(result.current.has('chart-01')).toBe(true);
    expect(result.current.has('chart-02')).toBe(true);
  });

  it('初始未进视口 → 空集；元素进入视口 → 只增量 reveal 命中项', () => {
    const instances: Array<{ cb: IntersectionObserverCallback }> = [];
    class MockIO {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        instances.push({ cb });
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
    }
    // @ts-expect-error 注入 mock observer
    window.IntersectionObserver = MockIO;

    const { result } = renderHook(() => useRevealedCharts(IDS));
    expect(result.current.size).toBe(0);

    const el = document.getElementById('chart-01')!;
    act(() => {
      instances[0].cb(
        [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(result.current.has('chart-01')).toBe(true);
    expect(result.current.has('chart-02')).toBe(false);
  });
});
