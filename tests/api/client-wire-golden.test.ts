/**
 * 金 master：ApiClient 全量业务方法线缆签名回归（可重复 harness）
 *
 * 背景：ApiClient 神类拆分 Phase 2 审计的「金 master」评审残留——原先只有一次性
 * 路由集 diff（LOST=∅）记录，不可重复。本测试把它落成**提交进仓的可重复 harness**：
 *
 *   1. 反射枚举当前 apiClient 的全部 99 个业务方法（18 基类 + 81 命名空间，见 REGISTRY）
 *   2. 用规范入参逐个调用，spy fetch 捕获 { verb, path, params, bodyKeys, auth, dedupe }
 *   3. 与冻结 golden（tests/api/__golden__/client-wire-golden.json）逐方法 diff
 *
 * 任一方法的 URL/参数键/动词/鉴权/请求体键/合并键漂移 → 红。
 *
 * golden 的初始值即「拆分后线缆行为」；其与 #536 前单体基线的等价由
 * scripts/api-wire-conservation.mjs（守恒恒等式 + 路由集 LOST=∅）+ 评审一次性
 * diff 共同背书。后续任何重构若改动线缆面，必须 `UPDATE_GOLDEN=1` 重生并人工核对。
 *
 * 重生 golden：UPDATE_GOLDEN=1 bunx vitest run tests/api/client-wire-golden.test.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REGISTRY, serializeCall, FAR_FUTURE_JWT } from './__support__/wire-probe';
import type { WireSnapshot } from './__support__/wire-probe';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(HERE, '__golden__', 'client-wire-golden.json');

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: {} }),
  });
  global.fetch = mockFetch as unknown as typeof fetch;
});

/** 逐方法跑一遍，返回 { 'ns.method' | 'method': WireSnapshot } */
async function probeAll(): Promise<Record<string, WireSnapshot>> {
  const { apiClient } = await import('../../src/shared/api/client');
  const out: Record<string, WireSnapshot> = {};

  for (const entry of REGISTRY) {
    mockFetch.mockClear();
    // 每次注入恒不过期 token，确保 auth 字段确定（logout 会 clearToken，故每轮重置）
    apiClient.setToken(FAR_FUTURE_JWT);

    const target = entry.ns ? (apiClient as any)[entry.ns] : (apiClient as any);
    const key = entry.ns ? `${entry.ns}.${entry.method}` : entry.method;
    const fn = target?.[entry.method];
    if (typeof fn !== 'function') {
      throw new Error(`注册表方法在当前 apiClient 上不存在：${key}`);
    }

    try {
      await fn.apply(target, entry.args());
    } catch {
      // 方法在 fetch 之后的后处理可能因 mock 空数据抛错；fetch 调用已被记录，忽略
    }

    const calls = mockFetch.mock.calls;
    if (calls.length === 0) {
      throw new Error(`方法未发起任何 fetch：${key}`);
    }
    const [url, options] = calls[0] as [string, RequestInit];
    out[key] = serializeCall(url, options);
  }

  return out;
}

describe('ApiClient 线缆金 master', () => {
  it('全量业务方法都产出线缆签名（守恒：99 = 18 基类 + 81 命名空间）', async () => {
    const snap = await probeAll();
    expect(Object.keys(snap).length).toBe(99);
    expect(REGISTRY.length).toBe(99);
  });

  it('每条线缆签名结构完整（verb/path 非空，dedupe 仅 GET 有值）', async () => {
    const snap = await probeAll();
    for (const [key, s] of Object.entries(snap)) {
      expect(s.verb, `${key} verb`).toMatch(/^(GET|POST|PUT|DELETE)$/);
      expect(s.path, `${key} path`).toMatch(/^\//);
      if (s.verb === 'GET') {
        expect(s.dedupe, `${key} GET 应有合并键`).toContain('GET:');
      } else {
        expect(s.dedupe, `${key} 非 GET 不应有合并键`).toBe('');
      }
    }
  });

  it('线缆签名与冻结 golden 完全一致（无 URL/param/verb/auth/body/dedupe 漂移）', async () => {
    const snap = await probeAll();

    if (process.env.UPDATE_GOLDEN === '1') {
      const sorted = Object.fromEntries(
        Object.entries(snap).sort(([a], [b]) => a.localeCompare(b))
      );
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
      return;
    }

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, WireSnapshot>;
    expect(snap).toEqual(golden);
  });
});
