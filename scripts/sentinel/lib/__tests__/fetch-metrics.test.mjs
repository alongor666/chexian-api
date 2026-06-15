/**
 * sentinel/lib/fetch-metrics.mjs 单元测试
 *
 * 覆盖：
 *   - fetchDataVersion：happy path / 非 OK 响应
 *   - fetchComprehensive：304 幂等 / 正常响应字段解析 / 非 OK 响应
 *   - fetchTrend：列名优先级 / 多机构行汇总 / 空响应
 *   - lossTrendToSeries：null 过滤 / 类型转换
 *
 * 全部通过 vi.stubGlobal('fetch', ...) mock HTTP。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDataVersion,
  fetchComprehensive,
  fetchTrend,
  lossTrendToSeries,
} from '../fetch-metrics.mjs';

const API_BASE = 'https://chexian-test.example.com';
const PAT = 'cx_pat_test.abc123';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── fetchDataVersion ─────────────────────────────────────────────────────────

describe('fetchDataVersion — 数据版本信息', () => {
  it('正常响应 → 返回 { etlDate, buildTime, serverStartTime }', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: { etlDate: '2026-06-14', buildTime: '2026-06-14T00:00:00Z', serverStartTime: '2026-06-14T01:00:00Z' },
      }),
    });
    const result = await fetchDataVersion(API_BASE, PAT);
    expect(result.etlDate).toBe('2026-06-14');
    expect(result.buildTime).toBeTruthy();
  });

  it('API 返回 500 → 抛出包含 HTTP 状态码的错误', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => 'Internal Server Error',
    });
    await expect(fetchDataVersion(API_BASE, PAT)).rejects.toThrow('500');
  });

  it('响应缺少 success/data 字段 → 抛出"非预期响应体"错误', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ result: 'ok' }), // 缺少 success/data
    });
    await expect(fetchDataVersion(API_BASE, PAT)).rejects.toThrow(/非预期响应体/);
  });
});

// ─── fetchComprehensive ───────────────────────────────────────────────────────

describe('fetchComprehensive — 综合分析 bundle', () => {
  it('304 Not Modified → 返回 { notModified: true, etag }', async () => {
    fetch.mockResolvedValueOnce({
      status: 304,
      headers: { get: () => '"etag-abc123"' },
    });
    const result = await fetchComprehensive(API_BASE, PAT, { ifNoneMatch: '"etag-abc123"' });
    expect(result.notModified).toBe(true);
    expect(result.etag).toBe('"etag-abc123"');
  });

  it('正常 200 响应 → 解析 cutoffDate / timeProgress / summary / lossTrendRows', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k) => (k === 'etag' ? '"etag-xyz"' : null) },
      json: async () => ({
        success: true,
        data: {
          meta: { cutoffDate: '2026-06-14', timeProgress: 0.45 },
          overview: { summary: { earned_claim_ratio: 0.68 } },
          loss: { trendRows: [{ time_period: '2026-03', earned_claim_ratio: 0.65 }] },
        },
      }),
    });
    const result = await fetchComprehensive(API_BASE, PAT);
    expect(result.notModified).toBe(false);
    expect(result.cutoffDate).toBe('2026-06-14');
    expect(result.timeProgress).toBe(0.45);
    expect(result.summary.earned_claim_ratio).toBe(0.68);
    expect(result.lossTrendRows).toHaveLength(1);
  });

  it('data.loss.trendRows 缺失 → lossTrendRows 返回空数组', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: { meta: { cutoffDate: '2026-06-14', timeProgress: 0 }, overview: { summary: {} } },
      }),
    });
    const result = await fetchComprehensive(API_BASE, PAT);
    expect(result.lossTrendRows).toEqual([]);
  });
});

// ─── fetchTrend ───────────────────────────────────────────────────────────────

describe('fetchTrend — 流量趋势（断崖检测）', () => {
  it('perspective=premium → 优先读 total_premium 列', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: [
          { time_period: '2026-01', total_premium: 100000 },
          { time_period: '2026-02', total_premium: 110000 },
          { time_period: '2026-03', total_premium: 90000 },
        ],
      }),
    });
    const result = await fetchTrend(API_BASE, PAT, { perspective: 'premium' });
    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(100000);
  });

  it('perspective=policy_count → 优先读 policy_count 列', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: [
          { time_period: '2026-01', policy_count: 500 },
          { time_period: '2026-02', policy_count: 600 },
        ],
      }),
    });
    const result = await fetchTrend(API_BASE, PAT, { perspective: 'policy_count' });
    expect(result[0].value).toBe(500);
    expect(result[1].value).toBe(600);
  });

  it('多机构行（同一 time_period 多行）→ 按 time_period 汇总', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: [
          { time_period: '2026-01', total_premium: 40000, org: '天府' },
          { time_period: '2026-01', total_premium: 60000, org: '成华' },
          { time_period: '2026-02', total_premium: 110000, org: '天府' },
        ],
      }),
    });
    const result = await fetchTrend(API_BASE, PAT, { perspective: 'premium' });
    expect(result).toHaveLength(2);
    const jan = result.find((r) => r.time_period === '2026-01');
    expect(jan?.value).toBe(100000); // 40000+60000 汇总
  });

  it('兜底列名：无已知列时使用首个非时间/非 next_month* 有限数值列', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: [{ time_period: '2026-01', custom_metric: 12345 }],
      }),
    });
    const result = await fetchTrend(API_BASE, PAT, { perspective: 'premium' });
    expect(result[0].value).toBe(12345);
  });

  it('data 为空数组 → 返回空数组', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ success: true, data: [] }),
    });
    const result = await fetchTrend(API_BASE, PAT);
    expect(result).toEqual([]);
  });

  it('结果按 time_period 升序排列', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        data: [
          { time_period: '2026-03', total_premium: 90000 },
          { time_period: '2026-01', total_premium: 100000 },
          { time_period: '2026-02', total_premium: 110000 },
        ],
      }),
    });
    const result = await fetchTrend(API_BASE, PAT, { perspective: 'premium' });
    expect(result[0].time_period).toBe('2026-01');
    expect(result[1].time_period).toBe('2026-02');
    expect(result[2].time_period).toBe('2026-03');
  });
});

// ─── lossTrendToSeries ────────────────────────────────────────────────────────

describe('lossTrendToSeries — 赔付率序列规整', () => {
  it('正常行 → 保留并转换 value 为 Number', () => {
    const rows = [
      { time_period: '2026-01', earned_claim_ratio: '0.65' },
      { time_period: '2026-02', earned_claim_ratio: 0.70 },
    ];
    const result = lossTrendToSeries(rows);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(0.65);
    expect(result[1].value).toBe(0.70);
  });

  it('earned_claim_ratio=null 的行 → 被过滤掉（不当成 0 进入序列）', () => {
    const rows = [
      { time_period: '2026-01', earned_claim_ratio: 0.65 },
      { time_period: '2026-02', earned_claim_ratio: null },
      { time_period: '2026-03', earned_claim_ratio: 0.70 },
    ];
    const result = lossTrendToSeries(rows);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.time_period === '2026-02')).toBeUndefined();
  });

  it('earned_claim_ratio=undefined 的行 → 被过滤掉', () => {
    const rows = [
      { time_period: '2026-01', earned_claim_ratio: undefined },
      { time_period: '2026-02', earned_claim_ratio: 0.70 },
    ];
    const result = lossTrendToSeries(rows);
    expect(result).toHaveLength(1);
  });

  it('earned_claim_ratio=NaN（非有限）→ 被过滤掉', () => {
    const rows = [
      { time_period: '2026-01', earned_claim_ratio: NaN },
      { time_period: '2026-02', earned_claim_ratio: 0.70 },
    ];
    const result = lossTrendToSeries(rows);
    expect(result).toHaveLength(1);
  });

  it('time_period=null 的行 → 被过滤掉', () => {
    const rows = [
      { time_period: null, earned_claim_ratio: 0.65 },
      { time_period: '2026-02', earned_claim_ratio: 0.70 },
    ];
    const result = lossTrendToSeries(rows);
    expect(result).toHaveLength(1);
    expect(result[0].time_period).toBe('2026-02');
  });

  it('空数组 → 返回空数组', () => {
    expect(lossTrendToSeries([])).toEqual([]);
  });
});
