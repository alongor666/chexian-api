/**
 * 附加税费率漂移守卫（B274）
 *
 * 强制 TS 常量 SURCHARGE_RATE 与 SSOT `数据管理/config/fixed-cost-params.json`
 * 的 surcharge_rate 零漂移。生产运行时不读该 json（详见 fixed-cost-params.ts 注释），
 * 由本测试在全仓 checkout（CI/本地）下兜底：json 一旦改动而常量未跟改即红灯。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  SURCHARGE_RATE,
  pickLatestSurchargeRate,
  type SurchargeRateEntry,
} from '../fixed-cost-params.js';
import { getFixedCostParamsPath } from '../paths.js';

function loadSurchargeEntries(): SurchargeRateEntry[] {
  const raw = readFileSync(getFixedCostParamsPath(), 'utf-8');
  const parsed = JSON.parse(raw) as { surcharge_rate?: SurchargeRateEntry[] };
  return parsed.surcharge_rate ?? [];
}

describe('SURCHARGE_RATE 与 fixed-cost-params.json 对齐', () => {
  it('常量等于 json surcharge_rate 的最新有效费率（无漂移）', () => {
    const entries = loadSurchargeEntries();
    expect(entries.length).toBeGreaterThan(0);
    // '9999-12-31' 取无条件最新（最大 effective_date）条目 —— 确定性、不依赖挂钟。
    const ssotRate = pickLatestSurchargeRate(entries, '9999-12-31');
    expect(ssotRate).not.toBeNull();
    expect(SURCHARGE_RATE).toBe(ssotRate);
  });

  it('B274 owner 拍板暂定 1.5%', () => {
    expect(SURCHARGE_RATE).toBe(0.015);
  });
});

describe('pickLatestSurchargeRate 选取语义（镜像 Python _pick_latest）', () => {
  const entries: SurchargeRateEntry[] = [
    { effective_date: '2025-01-01', rate: 0.016 },
    { effective_date: '2026-01-01', rate: 0.015 },
    { effective_date: '2027-01-01', rate: 0.02 },
  ];

  it('取 effective_date <= asOf 的最新条目', () => {
    expect(pickLatestSurchargeRate(entries, '2026-06-30')).toBe(0.015);
  });

  it('asOf 早于所有条目 → null', () => {
    expect(pickLatestSurchargeRate(entries, '2024-12-31')).toBeNull();
  });

  it('asOf 覆盖未来条目 → 取最大 effective_date', () => {
    expect(pickLatestSurchargeRate(entries, '9999-12-31')).toBe(0.02);
  });

  it('空数组 → null', () => {
    expect(pickLatestSurchargeRate([], '2026-06-30')).toBeNull();
  });
});
