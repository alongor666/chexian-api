/**
 * buildKpiCardProps 单测 — 逐项锁定 (KpiCardId → EnhancedKpiCardProps) 映射
 *
 * 这是 KpiSection God-组件抽取后新增的安全网：把原本藏在组件闭包里、无法单测的
 * 22 路 switch 映射固化下来。任何对 kpiCardProps 的后续重组（分组/去重）都必须保持本测全绿。
 */
import { describe, it, expect } from 'vitest';
import { buildKpiCardProps, type KpiCardBuildContext } from '../kpiCardProps';
import { KPI_CARD_META, type KpiCardId } from '../../dashboardLayoutConfig';
import type { KpiData } from '../../hooks/useKpiData';
import type { KpiDetailResult } from '../../../../shared/types/kpi';

const kpis: KpiData = {
  vehicle_premium: 12000,
  vehicle_plan_wan: 13000,
  vehicle_achievement_rate: 92.3,
  vehicle_growth_rate: 5.2,
  variable_cost_ratio: 88.5,
  earned_claim_ratio: 64.4, // 满期赔付率分项（64.4 + 24.1 = 88.5 变动成本率）
  expense_ratio: 24.1, // 费用率分项
  bundle_renewal_rate: 0.45,
  driver_premium: 800,
  driver_achievement_rate: 90,
  driver_growth_rate: 3.1,
  total_premium: 13000,
  policy_count: 4500,
  per_capita_premium: 2600,
  per_vehicle_premium: 2800,
  renewal_rate: 0.6,
  commercial_rate: 0.7,
  telesales_rate: 0.2,
  nev_rate: 0.15,
  new_car_rate: 0.3,
};

const kpiDetails: KpiDetailResult = {
  transfer_count: 100,
  non_transfer_count: 900,
  telesales_count: 200,
  non_telesales_count: 800,
  renewal_count: 600,
  non_renewal_count: 400,
  commercial_premium: 700,
  non_commercial_premium: 300,
  nev_count: 150,
  non_nev_count: 850,
  new_car_count: 300,
  non_new_car_count: 700,
  quality_business_count: 400,
  non_quality_business_count: 600,
  coverage_danjiao_count: 100,
  coverage_jiaosan_count: 200,
  coverage_zhuquan_count: 700,
  vehicle_truck_count: 300,
  vehicle_bus_count: 200,
  vehicle_motorcycle_count: 100,
  same_city_premium: 8000,
  remote_premium: 5000,
};

const ctx: KpiCardBuildContext = { kpis, kpiDetails, loading: false };

/** 每个 id 的预期形状（只锁结构性字段，不锁格式化后的字符串） */
type Expect = {
  type: 'value' | 'bar';
  variant: 'hero' | 'standard';
  unit?: string;
  ratioLen?: number;
  hasStatus?: boolean;
  hasProgress?: boolean;
  hasRing?: boolean;
  hasSegments?: boolean;
  hasDeltaMoM?: boolean;
};

const EXPECTATIONS: Record<KpiCardId, Expect> = {
  vehicle_premium: { type: 'value', variant: 'hero', unit: '万元', hasProgress: true, hasStatus: true },
  vehicle_achievement_rate: { type: 'value', variant: 'hero', unit: '%', hasRing: true, hasStatus: true },
  variable_cost_ratio: { type: 'bar', variant: 'hero', unit: '%', hasSegments: true, hasStatus: true },
  vehicle_growth_rate: { type: 'value', variant: 'standard', hasDeltaMoM: true },
  bundle_renewal_rate: { type: 'value', variant: 'standard' },
  driver_premium: { type: 'value', variant: 'standard', unit: '万元' },
  driver_achievement_rate: { type: 'value', variant: 'standard', hasStatus: true },
  driver_growth_rate: { type: 'value', variant: 'standard' },
  quality_business_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  total_premium: { type: 'value', variant: 'standard', unit: '万元' },
  policy_count: { type: 'value', variant: 'standard', unit: '件' },
  per_capita_premium: { type: 'value', variant: 'standard', unit: '元' },
  per_vehicle_premium: { type: 'value', variant: 'standard', unit: '元' },
  non_transfer_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  renewal_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  commercial_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  telesales_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  nev_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  new_car_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
  coverage_mix_rate: { type: 'bar', variant: 'standard', ratioLen: 3 },
  vehicle_type_rate: { type: 'bar', variant: 'standard', ratioLen: 3 },
  region_rate: { type: 'bar', variant: 'standard', ratioLen: 2 },
};

describe('buildKpiCardProps', () => {
  it('为 KPI_CARD_META 中全部 22 个 id 返回非空 props 且标题对齐注册表', () => {
    for (const meta of KPI_CARD_META) {
      const props = buildKpiCardProps(meta.id, ctx);
      expect(props, `id=${meta.id} 应返回非空`).not.toBeNull();
      expect(props!.title, `id=${meta.id} 标题`).toBe(meta.label);
    }
  });

  it('每个 id 的结构性形状（type/variant/unit/参照系/占比段数）符合预期', () => {
    for (const id of Object.keys(EXPECTATIONS) as KpiCardId[]) {
      const e = EXPECTATIONS[id];
      const p = buildKpiCardProps(id, ctx)!;
      expect(p.type, `${id}.type`).toBe(e.type);
      expect(p.variant, `${id}.variant`).toBe(e.variant);
      expect(p.unit, `${id}.unit`).toBe(e.unit);
      expect(Boolean(p.progress), `${id}.progress`).toBe(Boolean(e.hasProgress));
      expect(Boolean(p.ring), `${id}.ring`).toBe(Boolean(e.hasRing));
      expect(Boolean(p.segments), `${id}.segments`).toBe(Boolean(e.hasSegments));
      expect(Boolean(p.status), `${id}.status`).toBe(Boolean(e.hasStatus));
      expect(Boolean(p.deltaMoM), `${id}.deltaMoM`).toBe(Boolean(e.hasDeltaMoM));
      if (e.ratioLen !== undefined) {
        expect(p.ratioData?.length, `${id}.ratioData.length`).toBe(e.ratioLen);
      }
    }
  });

  it('锁定关键取值来源', () => {
    expect(buildKpiCardProps('driver_premium', ctx)!.value).toBe(kpis.driver_premium);
    expect(buildKpiCardProps('total_premium', ctx)!.value).toBe(kpis.total_premium);
    expect(buildKpiCardProps('policy_count', ctx)!.value).toBe(kpis.policy_count);
    // 占比型按定义 value 为 undefined（只画占比条）
    expect(buildKpiCardProps('coverage_mix_rate', ctx)!.value).toBeUndefined();
    expect(buildKpiCardProps('vehicle_type_rate', ctx)!.value).toBeUndefined();
    // region_rate value = same_city / (same_city + remote) = 8000/13000
    expect(buildKpiCardProps('region_rate', ctx)!.value).toBeCloseTo(8000 / 13000, 10);
    // variable_cost_ratio 拆 2 段：真实分项（满期赔付率 + 费用率），非 ×0.69 假估算
    const vcSegments = buildKpiCardProps('variable_cost_ratio', ctx)!.segments!;
    expect(vcSegments).toHaveLength(2);
    expect(vcSegments[0].label).toBe('满期赔付率');
    expect(vcSegments[0].value).toBeCloseTo(64.4, 6);
    expect(vcSegments[1].label).toBe('费用率');
    expect(vcSegments[1].value).toBeCloseTo(24.1, 6);
  });

  it('kpiDetails 为 null 时占比型卡降级为空占比、值 undefined（守卫不崩）', () => {
    const nullCtx: KpiCardBuildContext = { kpis, kpiDetails: null, loading: false };
    const quality = buildKpiCardProps('quality_business_rate', nullCtx)!;
    expect(quality.ratioData).toEqual([]);
    expect(quality.value).toBeUndefined();
    const renewal = buildKpiCardProps('renewal_rate', nullCtx)!;
    expect(renewal.ratioData).toEqual([]);
  });

  it('变动成本率分项缺失时回退为合计单段（不再 ×0.69 假估算）', () => {
    const noSegCtx: KpiCardBuildContext = {
      kpis: { ...kpis, earned_claim_ratio: null, expense_ratio: null },
      kpiDetails,
      loading: false,
    };
    const seg = buildKpiCardProps('variable_cost_ratio', noSegCtx)!.segments!;
    expect(seg).toHaveLength(1);
    expect(seg[0].label).toBe('变动成本率');
    expect(seg[0].value).toBeCloseTo(88.5, 6);
  });

  it('未知 id 返回 null', () => {
    expect(buildKpiCardProps('not_a_real_kpi' as KpiCardId, ctx)).toBeNull();
  });
});
