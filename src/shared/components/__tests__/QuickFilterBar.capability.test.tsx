/**
 * QuickFilterBar — 能力矩阵 domain prop（治理计划 Phase 3）
 *
 * Phase 0/1 的散装 hide props（hideGasOil/hideVehicleModelChips/hideGas/
 * hideTruckChips/hideInsuranceType）已统一为 domain prop：页面声明数据域，
 * 组件查 FILTER_DIMENSION_CAPABILITY 自动隐藏不可表达的 chip / toggle 档位。
 * 锁三件事：① 缺省（policy_fact）全维度可用、行为不变；② 各域隐藏集合与
 * 能力矩阵一致；③ 残留的不可表达值显示为未激活态（与后端防御性剥离一致）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QuickFilterBar } from '../QuickFilterBar';

afterEach(cleanup);

describe('QuickFilterBar — 缺省 policy_fact（全维度，行为不变）', () => {
  it('渲染完整 chip 集合：交/商、吨位、自卸/牵引/普货、油/气/电', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} />);
    expect(screen.getByText('交/商')).toBeTruthy();
    expect(screen.getByText('1T货')).toBeTruthy();
    expect(screen.getByText('X自卸')).toBeTruthy();
    expect(screen.getByText('X牵引')).toBeTruthy();
    expect(screen.getByText('X普货')).toBeTruthy();
    expect(screen.getByText('油/气/电')).toBeTruthy();
  });
});

describe('QuickFilterBar — domain="cross_sell_agg"（无 fuel_type / vehicle_model 列）', () => {
  it('隐藏自卸/牵引/普货，保留吨位货车与交/商', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} domain="cross_sell_agg" />);
    expect(screen.queryByText('X自卸')).toBeNull();
    expect(screen.queryByText('X牵引')).toBeNull();
    expect(screen.queryByText('X普货')).toBeNull();
    expect(screen.getByText('1T货')).toBeTruthy(); // tonnage_segment 列存在
    expect(screen.getByText('交/商')).toBeTruthy(); // premium 口径等价支持（PR #569）
  });

  it('燃料退化为 全部↔电 两态：未选时点击进入 电（不经过气/油）', () => {
    const onChange = vi.fn();
    render(<QuickFilterBar filters={{}} onChange={onChange} domain="cross_sell_agg" />);
    expect(screen.queryByText('油/气/电')).toBeNull();
    fireEvent.click(screen.getByText('电/全部'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fuelCategory: 'electric' }));
  });

  it('已选 电 时点击回到 全部（循环不出现气/油）', () => {
    const onChange = vi.fn();
    render(<QuickFilterBar filters={{ fuelCategory: 'electric' }} onChange={onChange} domain="cross_sell_agg" />);
    fireEvent.click(screen.getByText('电'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fuelCategory: undefined }));
  });

  it('残留 gas 值（其他页设置）显示为未激活态，与后端防御性剥离一致', () => {
    render(<QuickFilterBar filters={{ fuelCategory: 'gas' }} onChange={() => {}} domain="cross_sell_agg" />);
    const btn = screen.getByText('电/全部');
    expect(btn.className).not.toContain('bg-primary');
  });
});

describe('QuickFilterBar — domain="renewal_tracker"（无险类/吨位/车型列，燃料仅油电）', () => {
  it('隐藏交/商 toggle，其余 toggle 保留', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} domain="renewal_tracker" />);
    expect(screen.queryByText('交/商')).toBeNull();
    expect(screen.getByText('主全/交三/单交')).toBeTruthy();
  });

  it('隐藏整个货车组（吨位+车型），保留家自车/企客/摩托/租网', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} domain="renewal_tracker" />);
    for (const label of ['1T货', '2-9T货', '1-2T货', 'X自卸', 'X牵引', 'X普货']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByText('家自车')).toBeTruthy();
    expect(screen.getByText('企客')).toBeTruthy();
    expect(screen.getByText('摩托车')).toBeTruthy();
    expect(screen.getByText('租/网')).toBeTruthy();
  });

  it('燃料 toggle 退化为 全部→电→油（保留油，仅去掉气）', () => {
    const onChange = vi.fn();
    render(<QuickFilterBar filters={{ fuelCategory: 'electric' }} onChange={onChange} domain="renewal_tracker" />);
    expect(screen.queryByText('油/气/电')).toBeNull();
    fireEvent.click(screen.getByText('电'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fuelCategory: 'oil' }));
  });

  it('残留 gas 值显示为未激活态', () => {
    render(<QuickFilterBar filters={{ fuelCategory: 'gas' }} onChange={() => {}} domain="renewal_tracker" />);
    const btn = screen.getByText('油/电');
    expect(btn.className).not.toContain('bg-primary');
  });
});

describe('QuickFilterBar — domain="claims_detail"（PolicyFact 半连接，全维度）', () => {
  it('与 policy_fact 等价：完整 chip 集合', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} domain="claims_detail" />);
    expect(screen.getByText('交/商')).toBeTruthy();
    expect(screen.getByText('X自卸')).toBeTruthy();
    expect(screen.getByText('油/气/电')).toBeTruthy();
  });
});
