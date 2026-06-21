/**
 * cube-shadow 单元测试：影子对账核心比对 + 切流后采样影子（bf2c4e）。
 *
 * 覆盖：
 *   ① diffRows —— 一致 / 行数不一致 / 字段背离定位 / 浮点容差
 *   ② runPostCutoverShadowSample —— legacy 与已返回 cube 对账的 match/mismatch/error 计数
 *   ③ redactMismatchDetail —— 业务数值打码、日期与字段名保留
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  diffRows,
  redactMismatchDetail,
  runPostCutoverShadowSample,
  getShadowStats,
  resetShadowStatsForTest,
} from '../cube-shadow.js';

/** flush fire-and-forget 的 .then/.catch（macrotask 后 microtask 已结算） */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('cube-shadow', () => {
  beforeEach(() => resetShadowStatsForTest());

  describe('diffRows', () => {
    it('完全一致返回 null', () => {
      expect(diffRows([{ a: 1, b: 'x' }], [{ a: 1, b: 'x' }])).toBeNull();
    });

    it('行数不一致直接报告', () => {
      expect(diffRows([{ a: 1 }], [])).toMatch(/行数不一致/);
    });

    it('字段值背离定位到首个差异字段', () => {
      expect(diffRows([{ a: 1, b: 2 }], [{ a: 1, b: 3 }])).toMatch(/字段 b/);
    });

    it('数值容差内视为一致（浮点求和顺序差异）', () => {
      expect(diffRows([{ a: 100 }], [{ a: 100 + 1e-10 }])).toBeNull();
    });

    it('null 与非 null 视为不一致', () => {
      expect(diffRows([{ a: null }], [{ a: 0 }])).toMatch(/字段 a/);
    });
  });

  describe('runPostCutoverShadowSample（切流后采样影子）', () => {
    it('legacy 与已返回 cube 一致 → match++', async () => {
      runPostCutoverShadowSample('trend', [{ premium: 100 }], async () => [{ premium: 100 }]);
      await flush();
      expect(getShadowStats().trend.match).toBe(1);
      expect(getShadowStats().trend.mismatch).toBe(0);
    });

    it('legacy 与 cube 背离 → mismatch++ 且记录明细', async () => {
      runPostCutoverShadowSample('trend', [{ premium: 100 }], async () => [{ premium: 999 }]);
      await flush();
      expect(getShadowStats().trend.mismatch).toBe(1);
      expect(getShadowStats().trend.lastMismatchDetail).toMatch(/premium/);
    });

    it('legacy 查询异常 → error++（不影响主流程）', async () => {
      runPostCutoverShadowSample('trend', [{ premium: 1 }], async () => {
        throw new Error('boom');
      });
      await flush();
      expect(getShadowStats().trend.error).toBe(1);
    });

    it('计数并入与影子期共用的同一 statsByRoute（按路由分组）', async () => {
      runPostCutoverShadowSample('growth', [{ x: 1 }], async () => [{ x: 1 }]);
      runPostCutoverShadowSample('salesman-ranking', [{ y: 2 }], async () => [{ y: 3 }]);
      await flush();
      expect(getShadowStats().growth.match).toBe(1);
      expect(getShadowStats()['salesman-ranking'].mismatch).toBe(1);
    });
  });

  describe('redactMismatchDetail', () => {
    it('打码业务数值，保留字段名', () => {
      const r = redactMismatchDetail('行 5 字段 premium: legacy=1234567.89 cube=1234500');
      expect(r).toContain('字段 premium');
      expect(r).not.toContain('1234567');
    });

    it('null 透传 null', () => {
      expect(redactMismatchDetail(null)).toBeNull();
    });
  });
});
