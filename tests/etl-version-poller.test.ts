/**
 * ETL 版本轮询器防回归测试（BACKLOG 2026-06-11-claude-ed63ec 页面驱动修复）
 *
 * 锁死行为：
 * 1. 首轮建立基线不误触发失效；
 * 2. 版本变化 → 通知 SW + 失效 React Query + 更新基线；
 * 3. localStorage 预置旧基线（模拟"ETL 更新后整页刷新"）→ 首轮立即失效；
 * 4. 拉取失败（401/网络异常返回 undefined）→ 静默跳过；
 * 5. cleanup 停止轮询。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { startEtlVersionPolling, ETL_DATE_STORAGE_KEY } from '../src/app/etlVersionPoller';

function makeMemoryStorage(seed?: Record<string, string>) {
  const store = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    dump: () => Object.fromEntries(store),
  };
}

describe('startEtlVersionPolling', () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  let notifySw: ReturnType<typeof vi.fn>;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    notifySw = vi.fn();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
  });

  it('首轮建立基线，不误触发失效', async () => {
    const storage = makeMemoryStorage();
    cleanup = startEtlVersionPolling({
      queryClient,
      notifySw,
      storage,
      fetchEtlDate: async () => '2026-07-01',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(notifySw).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(storage.getItem(ETL_DATE_STORAGE_KEY)).toBe('2026-07-01');
  });

  it('版本变化 → 通知 SW + 失效 React Query + 更新基线', async () => {
    const storage = makeMemoryStorage();
    const dates = ['2026-07-01', '2026-07-02'];
    let call = 0;
    cleanup = startEtlVersionPolling({
      queryClient,
      notifySw,
      storage,
      intervalMs: 1000,
      fetchEtlDate: async () => dates[Math.min(call++, dates.length - 1)],
    });
    await vi.advanceTimersByTimeAsync(0); // 首轮：基线 07-01
    await vi.advanceTimersByTimeAsync(1000); // 第二轮：07-02，触发失效
    expect(notifySw).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(storage.getItem(ETL_DATE_STORAGE_KEY)).toBe('2026-07-02');
  });

  it('localStorage 预置旧基线（整页刷新场景）→ 首轮立即失效', async () => {
    const storage = makeMemoryStorage({ [ETL_DATE_STORAGE_KEY]: '2026-06-30' });
    cleanup = startEtlVersionPolling({
      queryClient,
      notifySw,
      storage,
      fetchEtlDate: async () => '2026-07-01',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(notifySw).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(storage.getItem(ETL_DATE_STORAGE_KEY)).toBe('2026-07-01');
  });

  it('拉取失败返回 undefined → 静默跳过，不改基线', async () => {
    const storage = makeMemoryStorage({ [ETL_DATE_STORAGE_KEY]: '2026-06-30' });
    cleanup = startEtlVersionPolling({
      queryClient,
      notifySw,
      storage,
      fetchEtlDate: async () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(notifySw).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(storage.getItem(ETL_DATE_STORAGE_KEY)).toBe('2026-06-30');
  });

  it('cleanup 后定时器停止', async () => {
    const storage = makeMemoryStorage();
    const fetchEtlDate = vi.fn(async () => '2026-07-01');
    cleanup = startEtlVersionPolling({
      queryClient,
      notifySw,
      storage,
      intervalMs: 1000,
      fetchEtlDate,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchEtlDate).toHaveBeenCalledTimes(1);
    cleanup();
    cleanup = null;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchEtlDate).toHaveBeenCalledTimes(1);
  });
});
