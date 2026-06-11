/**
 * QuickFilterBar — hideGasOil / hideVehicleModelChips（Phase 0 止血）
 * （筛选器联动治理计划 2026-06-10，BACKLOG 0f01e6）
 *
 * 交叉销售页数据域 CrossSellDailyAgg 无 fuel_type / vehicle_model 列：
 * - 气/油筛选不可表达（电可表达：is_nev 列各域都有）→ hideGasOil
 * - 自卸/牵引/普货 chip 依赖 vehicle_model LIKE → hideVehicleModelChips
 * 锁两件事：① 隐藏后用户点不出会被后端剥离的筛选；② 默认行为不变。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QuickFilterBar } from '../QuickFilterBar';

afterEach(cleanup);

describe('QuickFilterBar — Phase 0 chip 隐藏', () => {
  it('默认渲染自卸/牵引/普货 chip 与完整 油/气/电 toggle（行为不变）', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} />);
    expect(screen.getByText('X自卸')).toBeTruthy();
    expect(screen.getByText('X牵引')).toBeTruthy();
    expect(screen.getByText('X普货')).toBeTruthy();
    expect(screen.getByText('油/气/电')).toBeTruthy();
  });

  it('hideVehicleModelChips：隐藏自卸/牵引/普货，保留吨位货车与其他 chip', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} hideVehicleModelChips />);
    expect(screen.queryByText('X自卸')).toBeNull();
    expect(screen.queryByText('X牵引')).toBeNull();
    expect(screen.queryByText('X普货')).toBeNull();
    expect(screen.getByText('1T货')).toBeTruthy();
    expect(screen.getByText('家自车')).toBeTruthy();
  });

  it('hideGasOil：未选时点击进入 电（不经过气/油）', () => {
    const onChange = vi.fn();
    render(<QuickFilterBar filters={{}} onChange={onChange} hideGasOil />);
    expect(screen.queryByText('油/气/电')).toBeNull();
    fireEvent.click(screen.getByText('电/全部'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fuelCategory: 'electric' }));
  });

  it('hideGasOil：已选 电 时点击回到 全部（循环不出现气/油）', () => {
    const onChange = vi.fn();
    render(<QuickFilterBar filters={{ fuelCategory: 'electric' }} onChange={onChange} hideGasOil />);
    fireEvent.click(screen.getByText('电'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fuelCategory: undefined }));
  });

  it('hideGasOil：残留 gas 值（其他页设置）显示为未激活态，与后端防御性剥离一致', () => {
    render(<QuickFilterBar filters={{ fuelCategory: 'gas' }} onChange={() => {}} hideGasOil />);
    const btn = screen.getByText('电/全部');
    expect(btn.className).not.toContain('bg-primary');
  });
});

describe('QuickFilterBar — Phase 1 续保页 hide props（Task 1-C）', () => {
  it('hideInsuranceType：隐藏交/商 toggle，其余 toggle 保留', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} hideInsuranceType />);
    expect(screen.queryByText('交/商')).toBeNull();
    expect(screen.getByText('主全/交三/单交')).toBeTruthy();
  });

  it('hideTruckChips：隐藏整个货车组（吨位+车型），保留家自车/企客/摩托/租网', () => {
    render(<QuickFilterBar filters={{}} onChange={() => {}} hideTruckChips />);
    for (const label of ['1T货', '2-9T货', '1-2T货', 'X自卸', 'X牵引', 'X普货']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByText('家自车')).toBeTruthy();
    expect(screen.getByText('企客')).toBeTruthy();
    expect(screen.getByText('摩托车')).toBeTruthy();
    expect(screen.getByText('租/网')).toBeTruthy();
  });

  it('hideGas：燃料 toggle 退化为 全部→电→油（保留油，仅去掉气）', () => {
    const onChange = vi.fn();
    render(<QuickFilterBar filters={{ fuelCategory: 'electric' }} onChange={onChange} hideGas />);
    expect(screen.queryByText('油/气/电')).toBeNull();
    fireEvent.click(screen.getByText('电'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fuelCategory: 'oil' }));
  });

  it('hideGas：残留 gas 值显示为未激活态', () => {
    render(<QuickFilterBar filters={{ fuelCategory: 'gas' }} onChange={() => {}} hideGas />);
    const btn = screen.getByText('油/电');
    expect(btn.className).not.toContain('bg-primary');
  });
});
