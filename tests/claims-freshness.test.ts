import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import {
  CLAIMS_REPORT_LAG_WARN_DAYS,
  localTodayISO,
  claimsReportLagDays,
  shouldWarnClaimsFreshness,
} from '../数据管理/lib/claims-freshness.mjs';

describe('claimsReportLagDays', () => {
  it('同日 = 0 天', () => {
    expect(claimsReportLagDays('2026-06-08', '2026-06-08')).toBe(0);
  });
  it('落后 2 天（对账事故场景：停 06-06、当日 06-08）', () => {
    expect(claimsReportLagDays('2026-06-06', '2026-06-08')).toBe(2);
  });
  it('跨月正确计算（05-31 → 06-03 = 3 天）', () => {
    expect(claimsReportLagDays('2026-05-31', '2026-06-03')).toBe(3);
  });
  it('跨年正确计算（2025-12-31 → 2026-01-02 = 2 天）', () => {
    expect(claimsReportLagDays('2025-12-31', '2026-01-02')).toBe(2);
  });
  it('数据日期晚于当日 → 负数（原样返回供观察）', () => {
    expect(claimsReportLagDays('2026-06-09', '2026-06-08')).toBe(-1);
  });
  it('非法 / 缺失 / 非 ISO / 溢出日期 → null', () => {
    expect(claimsReportLagDays('', '2026-06-08')).toBeNull();
    expect(claimsReportLagDays(null, '2026-06-08')).toBeNull();
    expect(claimsReportLagDays('2026-06-08', 'bad')).toBeNull();
    expect(claimsReportLagDays('2026-02-31', '2026-06-08')).toBeNull(); // 溢出（2 月无 31 日）
    expect(claimsReportLagDays('20260608', '2026-06-08')).toBeNull(); // 非 ISO（YYYYMMDD）
  });
});

describe('shouldWarnClaimsFreshness（阈值边界三件套）', () => {
  it('恰好等于阈值（3 天）→ 告警', () => {
    expect(shouldWarnClaimsFreshness(3)).toBe(true);
  });
  it('阈值之下（2 天）→ 不告警', () => {
    expect(shouldWarnClaimsFreshness(2)).toBe(false);
  });
  it('阈值之上（10 天）→ 告警', () => {
    expect(shouldWarnClaimsFreshness(10)).toBe(true);
  });
  it('0 / 负数（数据新鲜或超前）→ 不告警', () => {
    expect(shouldWarnClaimsFreshness(0)).toBe(false);
    expect(shouldWarnClaimsFreshness(-1)).toBe(false);
  });
  it('lag = null（读不到日期）→ 不告警（由调用方另行提示）', () => {
    expect(shouldWarnClaimsFreshness(null)).toBe(false);
  });
  it('自定义阈值（注入 2 天）边界', () => {
    expect(shouldWarnClaimsFreshness(2, 2)).toBe(true);
    expect(shouldWarnClaimsFreshness(1, 2)).toBe(false);
  });
  it('默认阈值常量 = 3', () => {
    expect(CLAIMS_REPORT_LAG_WARN_DAYS).toBe(3);
  });
});

describe('localTodayISO', () => {
  it('注入 Date 返回本地 YYYY-MM-DD（补零）', () => {
    expect(localTodayISO(new Date(2026, 0, 5))).toBe('2026-01-05'); // 月份 0-based → 01
    expect(localTodayISO(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
