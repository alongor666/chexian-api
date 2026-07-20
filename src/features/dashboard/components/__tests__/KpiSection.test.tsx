/**
 * KpiSection 特征测试（characterization）
 *
 * 目的：在重构 buildCardProps（抽取为纯函数 kpiCardProps）之前锁住当前可观察行为，
 * 保证重构「行为不变」。锁定三件事：
 *  1. 分组渲染：Hero(3) / Core(6) 直接可见
 *  2. 渐进披露：Watch(13) 默认折叠，点击「展开」后才渲染
 *  3. 空态兜底：可见集合为空时显示提示
 *
 * 不断言具体数值/格式化（那是 kpiCardProps 单测的职责），只锁渲染与交互骨架。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KpiSection } from '../KpiSection';
import type { KpiData } from '../../hooks/useKpiData';
import type { KpiDetailResult } from '../../../../shared/types/kpi';

const kpis: KpiData = {
  vehicle_premium: 12000,
  vehicle_plan_wan: 13000,
  earned_premium: 6000,
  maturity_rate: 50,
  vehicle_achievement_rate: 92.3,
  vehicle_growth_rate: 5.2,
  variable_cost_ratio: 88.5,
  earned_claim_ratio: 64.4, // 满期赔付率分项（64.4 + 24.1 = 88.5）
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

function renderSection(
  override?: Partial<React.ComponentProps<typeof KpiSection>>
) {
  return render(
    <MemoryRouter>
      <KpiSection kpis={kpis} kpiDetails={kpiDetails} loading={false} {...override} />
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('KpiSection 特征测试', () => {
  it('按指定顺序渲染 5 张 Hero 卡（经营体检）', () => {
    renderSection();
    const labels = ['车险保费', '满期保费', '满期率', '车险达成率', '变动成本率'];
    const elements = labels.map((label) => screen.getByText(label));
    for (let i = 0; i < elements.length - 1; i += 1) {
      expect(elements[i].compareDocumentPosition(elements[i + 1]) & 4).toBe(4);
    }
  });

  it('渲染 6 张 Core 卡（核心指标）', () => {
    renderSection();
    ['车险增长率', '套单续保率', '车驾意保费', '车驾意达成率', '车驾意增长率', '优质业务占比'].forEach(
      (label) => expect(screen.getByText(label)).toBeTruthy()
    );
  });

  it('Watch 卡默认折叠，点击「展开」后才渲染（渐进披露）', () => {
    renderSection();
    // 折叠态：关注指标不在文档中
    expect(screen.queryByText('总保费')).toBeNull();
    expect(screen.queryByText('保单件数')).toBeNull();

    // 展开
    fireEvent.click(screen.getByRole('button', { name: /展开/ }));

    expect(screen.getByText('总保费')).toBeTruthy();
    expect(screen.getByText('保单件数')).toBeTruthy();
    expect(screen.getByText('续保占比')).toBeTruthy();
  });

  it('可见集合为空时显示兜底提示', () => {
    renderSection({ visibleKpisByGroup: { core: [], focus: [] } });
    expect(screen.getByText('未选择任何 KPI 指标')).toBeTruthy();
  });

  /* -------- 多省接入空态保护（ADR G8 / Day-1 SOP §5） -------- */

  it('KPI 数据空 + loading 时显示「数据加载中」而非静默零值', () => {
    renderSection({ kpis: {}, kpiDetails: null, loading: true });
    expect(screen.getByText('数据加载中，请稍候…')).toBeTruthy();
    // 不渲染任何 KPI 卡
    expect(screen.queryByText('车险保费')).toBeNull();
  });

  it('KPI 数据空 + 非 loading 时显示「暂无数据」并说明非真实零保费', () => {
    renderSection({ kpis: {}, kpiDetails: null, loading: false });
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText(/这不代表真实零保费/)).toBeTruthy();
    expect(screen.queryByText('车险保费')).toBeNull();
  });

  it('规模全零（装载中假象）同样触发空态，禁止静默展示零 KPI', () => {
    renderSection({
      kpis: { total_premium: 0, vehicle_premium: 0, policy_count: 0 },
      kpiDetails: null,
      loading: false,
    });
    expect(screen.getByText('暂无数据')).toBeTruthy();
  });

  it('有规模数据时正常渲染 KPI 卡（不误触发空态）', () => {
    renderSection();
    expect(screen.getByText('车险保费')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });
});
