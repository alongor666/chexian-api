/**
 * isKpiDataEmpty 单测 — 多省接入空态保护判据（ADR G8 / Day-1 SOP §5）
 *
 * 锁定：空对象 / 全零 / 缺失视为空；任一规模指标 > 0 视为有数据。
 */
import { describe, it, expect } from 'vitest';
import { isKpiDataEmpty } from '../kpiDataState';
import type { KpiData } from '../../hooks/useKpiData';

describe('isKpiDataEmpty', () => {
  it('空对象（接口未返回 / 装载中）视为空', () => {
    expect(isKpiDataEmpty({})).toBe(true);
  });

  it('三项规模指标全零（该范围真实无业务量）视为空', () => {
    expect(
      isKpiDataEmpty({ total_premium: 0, vehicle_premium: 0, policy_count: 0 })
    ).toBe(true);
  });

  it('显式 null 视为空', () => {
    expect(
      isKpiDataEmpty({ total_premium: null as unknown as number, vehicle_premium: 0, policy_count: 0 })
    ).toBe(true);
  });

  it('总保费 > 0 视为有数据', () => {
    expect(isKpiDataEmpty({ total_premium: 13000 })).toBe(false);
  });

  it('车险保费 > 0 视为有数据', () => {
    expect(isKpiDataEmpty({ vehicle_premium: 12000 })).toBe(false);
  });

  it('保单件数 > 0 视为有数据（即便保费缺失）', () => {
    expect(isKpiDataEmpty({ policy_count: 4500 })).toBe(false);
  });

  it('bigint 规模值 > 0 视为有数据', () => {
    expect(isKpiDataEmpty({ total_premium: 13000n })).toBe(false);
  });

  it('仅占比指标有值但规模全空，仍视为空（避免静默展示零保费）', () => {
    const kpis: KpiData = { renewal_rate: 0.6, nev_rate: 0.15 };
    expect(isKpiDataEmpty(kpis)).toBe(true);
  });
});
