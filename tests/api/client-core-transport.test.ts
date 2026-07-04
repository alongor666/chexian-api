/**
 * 传输内核特征化测试（ApiClientCore / client-core）
 *
 * 闭合 Phase 2 神类拆分审计暴露的两个盲区：
 *  1. 横切传输核心（鉴权头注入 / 401 静默刷新重试 / GET 同 key 合并 / 超时→取消映射）
 *     被全部 12 个出口共享，回归即全面崩——却全仓零测试、且不在契约门禁内。
 *  2. 既有 client-contracts.test.ts 只断 URL + 写动词，从不断 Authorization 头。
 *
 * 设计：用最小子类把 protected request 透出，直接对 core 做特征化（不依赖任何子客户端实现），
 * 全程 spy 掉 fetch，断言"实际发出的请求/重试/合并行为"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientCore, RequestAbortError } from '../../src/shared/api/client-core';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(data: unknown = {}) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}
function failJson(status: number) {
  return { ok: false, status, json: async () => ({ success: false, error: { message: 'x', statusCode: status } }) };
}

/** 把 protected request 透出，仅供测试直驱内核 */
class TestCore extends ApiClientCore {
  callGet<T>(path: string) {
    return this.request<T>(path);
  }
  callPost<T>(path: string) {
    return this.request<T>(path, { method: 'POST' });
  }
}

function headersOf(callIndex: number): Record<string, string> {
  return (mockFetch.mock.calls[callIndex][1] as RequestInit).headers as Record<string, string>;
}

describe('client-core 传输内核特征化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okJson());
    try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch { /* node env 无 localStorage */ }
  });

  describe('鉴权头注入（补 client-contracts 不断鉴权头的洞）', () => {
    it('设置 token 后请求带 Authorization: Bearer', async () => {
      const core = new TestCore();
      core.setToken('header.payload.sig');
      await core.callGet('/query/kpi');
      expect(headersOf(0).Authorization).toBe('Bearer header.payload.sig');
    });

    it('无 token 时不带 Authorization', async () => {
      const core = new TestCore();
      await core.callGet('/query/kpi');
      expect(headersOf(0).Authorization).toBeUndefined();
    });

    it('clearToken 后不再带 Authorization', async () => {
      const core = new TestCore();
      core.setToken('a.b.c');
      core.clearToken();
      await core.callGet('/query/kpi');
      expect(headersOf(0).Authorization).toBeUndefined();
    });
  });

  describe('401 静默刷新重试', () => {
    it('非 GET 请求 401 → 调 /auth/refresh → 用新 token 重试原请求', async () => {
      const core = new TestCore();
      core.setToken('a.b.c');
      mockFetch
        .mockResolvedValueOnce(failJson(401))                                   // 原请求 401
        .mockResolvedValueOnce(okJson({ token: 'n.e.w' }))                      // /auth/refresh 成功返回新 token
        .mockResolvedValueOnce(okJson({ done: true }));                         // 重试成功
      const res = await core.callPost('/workflows/runs/r1/approve');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[1][0]).toContain('/auth/refresh');
      // 重试请求必须携带刷新后的新 Bearer（鉴权连续性）
      expect(headersOf(2).Authorization).toBe('Bearer n.e.w');
      expect(res).toEqual({ done: true });
    });

    it('刷新失败 → 清 token 并抛原错误，不无限重试', async () => {
      const core = new TestCore();
      core.setToken('a.b.c');
      mockFetch
        .mockResolvedValueOnce(failJson(401))   // 原请求 401
        .mockResolvedValueOnce(failJson(401));  // refresh 也失败
      await expect(core.callPost('/workflows/runs/r1/approve')).rejects.toThrow();
      expect(core.getToken()).toBeNull();        // 刷新失败应清 token（fail-closed）
    });

    it('/auth/* 自身 401 不触发刷新（避免环）', async () => {
      const core = new TestCore();
      core.setToken('a.b.c');
      mockFetch.mockResolvedValueOnce(failJson(401));
      await expect(core.callPost('/auth/login')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1); // 不应再打 /auth/refresh
    });

    it('GET 请求 401 → 刷新 → 重试不与自身 in-flight 条目合并（防 chaining-cycle 自指）', async () => {
      // 评审「留作单独核实」项：GET 设 dedupeKey 并把原 promise 存入 inflightRequests，
      // 401 后递归重试仍带同一 dedupeKey → 若命中 existing 会返回原 promise 自身 →
      // execute() resolve 成自己 → TypeError: Chaining cycle detected，该 GET 直接失败。
      const core = new TestCore();
      core.setToken('a.b.c');
      mockFetch
        .mockResolvedValueOnce(failJson(401))                 // 原 GET 401
        .mockResolvedValueOnce(okJson({ token: 'n.e.w' }))    // /auth/refresh 成功
        .mockResolvedValueOnce(okJson({ ok: 1 }));            // 重试成功
      const res = await core.callGet('/query/kpi');
      expect(res).toEqual({ ok: 1 });                          // 应透明拿到数据，而非 chaining-cycle 报错
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[1][0]).toContain('/auth/refresh');
      expect(headersOf(2).Authorization).toBe('Bearer n.e.w'); // 重试带刷新后新 Bearer
    });
  });

  describe('GET 同 key 合并（in-flight coalescing）', () => {
    it('并发的相同 GET（含乱序参数）只发一次 fetch', async () => {
      const core = new TestCore();
      let release!: () => void;
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => { release = () => resolve(okJson({ n: 1 })); }),
      );
      const p1 = core.callGet('/query/kpi?a=1&b=2');
      const p2 = core.callGet('/query/kpi?b=2&a=1'); // normalize 后同 key
      release();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(r1).toEqual({ n: 1 });
      expect(r2).toEqual({ n: 1 });
    });

    it('GET 完成后同 key 再请求会重新发起（合并仅限 in-flight）', async () => {
      const core = new TestCore();
      await core.callGet('/query/kpi?a=1');
      await core.callGet('/query/kpi?a=1');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('超时 / 取消', () => {
    it('fetch AbortError 映射为 RequestAbortError', async () => {
      const core = new TestCore();
      mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
      await expect(core.callGet('/query/kpi')).rejects.toBeInstanceOf(RequestAbortError);
    });
  });

  describe('cancelRequest 键归一化（存键为 GET:${normalizeGetEndpoint}，避免原始 endpoint 查表恒 miss）', () => {
    /** 模拟真实 fetch 对 AbortSignal 的响应：abort 触发时以 AbortError 拒绝该次 fetch。 */
    function fetchImplRespectingAbort(capture: (signal: AbortSignal) => void) {
      return (_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        capture(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      };
    }

    it('传原始 endpoint（乱序 query）能命中并 abort 进行中的 GET', async () => {
      const core = new TestCore();
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementationOnce(
        fetchImplRespectingAbort((signal) => { capturedSignal = signal; }),
      );
      const pending = core.callGet('/query/kpi?b=2&a=1');
      // 用与发起时相同的原始 endpoint（未排序）调用 cancelRequest，验证不再是 no-op
      core.cancelRequest('/query/kpi?b=2&a=1');
      expect(capturedSignal?.aborted).toBe(true);
      await expect(pending).rejects.toBeInstanceOf(RequestAbortError);
    });

    it('传参数顺序不同但语义相同的 endpoint 也能命中（归一化对齐排序后的存键）', async () => {
      const core = new TestCore();
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementationOnce(
        fetchImplRespectingAbort((signal) => { capturedSignal = signal; }),
      );
      const pending = core.callGet('/query/kpi?a=1&b=2');
      // 用乱序参数的等价 endpoint 调用（模拟调用方拼参数顺序不同的场景）
      core.cancelRequest('/query/kpi?b=2&a=1');
      expect(capturedSignal?.aborted).toBe(true);
      await expect(pending).rejects.toBeInstanceOf(RequestAbortError);
    });

    it('未进行中的端点调用 cancelRequest 是安全的 no-op', () => {
      const core = new TestCore();
      expect(() => core.cancelRequest('/query/kpi?x=1')).not.toThrow();
    });

    it('cancel 后 controller 从 inflightControllers 中移除（不会重复 abort 残留 key）', async () => {
      const core = new TestCore();
      mockFetch.mockImplementationOnce(fetchImplRespectingAbort(() => {}));
      const pending = core.callGet('/query/kpi?a=1');
      core.cancelRequest('/query/kpi?a=1');
      // 二次调用不应抛错（controller 已被移除，属于安全 no-op）
      expect(() => core.cancelRequest('/query/kpi?a=1')).not.toThrow();
      await expect(pending).rejects.toBeInstanceOf(RequestAbortError);
    });
  });
});
