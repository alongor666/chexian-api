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
import { startEtlVersionPolling, composeVersionBaseline, ETL_DATE_STORAGE_KEY } from '../src/app/etlVersionPoller';

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

describe('composeVersionBaseline（数据版本基线组合，2026-07-07 山西页面停更治理）', () => {
  it('etlDate + 内容指纹 + 服务启动时间 组合为基线串', () => {
    expect(composeVersionBaseline({
      etlDate: '2026-07-05', contentVersion: 'abcd1234', serverStartTime: '2026-07-07T02:00:00.000Z',
    })).toBe('2026-07-05|abcd1234|2026-07-07T02:00:00.000Z');
  });

  it('🔴 仅山西保单刷新（etlDate 不变、指纹变）→ 基线变化，能触发缓存失效', () => {
    const before = composeVersionBaseline({ etlDate: '2026-07-05', contentVersion: 'aaaa0000', serverStartTime: 't1' });
    const after = composeVersionBaseline({ etlDate: '2026-07-05', contentVersion: 'bbbb1111', serverStartTime: 't1' });
    expect(before).not.toBe(after);
  });

  it('🔴 仅派生域更新（etlDate/指纹不变、服务重载）→ 基线变化', () => {
    const before = composeVersionBaseline({ etlDate: '2026-07-05', contentVersion: 'aaaa0000', serverStartTime: 't1' });
    const after = composeVersionBaseline({ etlDate: '2026-07-05', contentVersion: 'aaaa0000', serverStartTime: 't2' });
    expect(before).not.toBe(after);
  });

  it('旧版服务端无 contentVersion/serverStartTime → 基线退化为 etlDate（向后兼容）', () => {
    expect(composeVersionBaseline({ etlDate: '2026-07-05' })).toBe('2026-07-05');
  });

  it('etlDate 缺失 → undefined（静默跳过本轮）', () => {
    expect(composeVersionBaseline({ contentVersion: 'abcd1234' })).toBeUndefined();
  });
});
