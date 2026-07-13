import { describe, it, expect } from 'vitest';
import { splitIpList, joinList, toggleSelection, isRouteSelected, toggleRouteSelection } from './accessControl';

describe('splitIpList · IP 白名单解析', () => {
  it('空串 → []', () => {
    expect(splitIpList('')).toEqual([]);
  });

  it('单个 IP', () => {
    expect(splitIpList('1.1.1.1')).toEqual(['1.1.1.1']);
  });

  it('英文逗号 / 中文逗号 / 换行均为分隔符', () => {
    expect(splitIpList('1.1.1.1,2.2.2.2')).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(splitIpList('1.1.1.1，2.2.2.2')).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(splitIpList('1.1.1.1\n2.2.2.2')).toEqual(['1.1.1.1', '2.2.2.2']);
  });

  it('去首尾空格 + 滤空项（多余分隔符不产生空字符串）', () => {
    expect(splitIpList(' 1.1.1.1 ,  2.2.2.2 ')).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(splitIpList(',1.1.1.1,,')).toEqual(['1.1.1.1']);
    expect(splitIpList('  ,  ')).toEqual([]);
  });
});

describe('joinList · 数组 → 展示串', () => {
  it('undefined / 空数组 → 空串', () => {
    expect(joinList(undefined)).toBe('');
    expect(joinList([])).toBe('');
  });

  it('逗号空格连接', () => {
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b, c');
  });
});

describe('toggleSelection · 复选不可变更新', () => {
  it('勾选 → 追加（保持原顺序）', () => {
    expect(toggleSelection(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleSelection([], 'a', true)).toEqual(['a']);
  });

  it('勾选已存在项 → 重复追加（不去重，锁原 `[...selected, x]` 语义）', () => {
    expect(toggleSelection(['a'], 'a', true)).toEqual(['a', 'a']);
  });

  it('取消 → 移除', () => {
    expect(toggleSelection(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c']);
  });

  it('取消不存在的项 → 内容不变（但返回新数组）', () => {
    const input = ['a', 'b'];
    const out = toggleSelection(input, 'x', false);
    expect(out).toEqual(['a', 'b']);
    expect(out).not.toBe(input);
  });

  it('取消时移除全部等于 item 的项（去重副作用）', () => {
    expect(toggleSelection(['a', 'b', 'a'], 'a', false)).toEqual(['b']);
  });

  it('不可变：入参数组不被修改', () => {
    const input = ['a', 'b'];
    toggleSelection(input, 'c', true);
    toggleSelection(input, 'a', false);
    expect(input).toEqual(['a', 'b']);
  });

  it('切换 canonical 路由时保留已有 legacy alias', () => {
    const existingRoutes = ['/truck', '/comparison', '/dashboard'];

    expect(toggleSelection(existingRoutes, '/growth', true)).toEqual([
      '/truck',
      '/comparison',
      '/dashboard',
      '/growth',
    ]);
    expect(toggleSelection(existingRoutes, '/dashboard', false)).toEqual([
      '/truck',
      '/comparison',
    ]);
    expect(existingRoutes).toEqual(['/truck', '/comparison', '/dashboard']);
  });

  it('取消 canonical 路由时移除其等价 legacy alias', () => {
    expect(toggleRouteSelection(['/truck', '/cross-sell', '/growth'], '/specialty', false)).toEqual(['/growth']);
  });

  it('legacy alias 会让对应 canonical 复选框显示已选', () => {
    expect(isRouteSelected(['/truck'], '/specialty')).toBe(true);
    expect(isRouteSelected(['/comparison'], '/growth')).toBe(true);
    expect(isRouteSelected(['/renewal'], '/renewal-tracker')).toBe(true);
    expect(isRouteSelected(['/'], '/data-import')).toBe(true);
    expect(isRouteSelected(['/'], '/home')).toBe(false);
  });

  it('可独立授予和撤销 home 与 data-import', () => {
    const withHome = toggleRouteSelection([], '/home', true);
    expect(withHome).toEqual(['/home']);
    expect(isRouteSelected(withHome, '/home')).toBe(true);
    expect(isRouteSelected(withHome, '/data-import')).toBe(false);

    const withBoth = toggleRouteSelection(withHome, '/data-import', true);
    expect(withBoth).toEqual(['/home', '/data-import']);
    expect(toggleRouteSelection(withBoth, '/home', false)).toEqual(['/data-import']);
    expect(toggleRouteSelection(withBoth, '/data-import', false)).toEqual(['/home']);
  });

  it('取消 data-import 清除 legacy / 但不影响 home', () => {
    expect(toggleRouteSelection(['/', '/home'], '/data-import', false)).toEqual(['/home']);
  });
});
