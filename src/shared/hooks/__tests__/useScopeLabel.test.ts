/**
 * computeScopeLabel 纯函数单测 — 范围标题派生（省份身份阶段1）
 *
 * 核心验证：公司级标签按注入的省分公司名派生（四川字节安全 + 山西修复），
 * 其余层级（业务员/团队/机构）逻辑不变。
 */
import { describe, it, expect } from 'vitest';
import { computeScopeLabel } from '../useScopeLabel';
import type { AdvancedFilterState } from '../../types/data';

const emptyMap = new Map<string, string>();
const base = {} as AdvancedFilterState;

function f(partial: Partial<AdvancedFilterState>): AdvancedFilterState {
  return { ...base, ...partial };
}

describe('computeScopeLabel — 公司级标签按省派生', () => {
  it('多机构 + 四川分公司 → 四川分公司（字节安全：与改动前硬编码一致）', () => {
    const r = computeScopeLabel(f({ org_level_3: ['天府', '高新'] }), emptyMap, '四川分公司');
    expect(r).toEqual({ prefix: '四川分公司', level: 'company' });
  });
  it('全部机构（无 org 筛选）+ 四川分公司 → 四川分公司', () => {
    const r = computeScopeLabel(f({}), emptyMap, '四川分公司');
    expect(r).toEqual({ prefix: '四川分公司', level: 'company' });
  });
  it('多机构 + 山西分公司 → 山西分公司（修复山西用户标题）', () => {
    const r = computeScopeLabel(f({ org_level_3: ['太原一部', '太原二部'] }), emptyMap, '山西分公司');
    expect(r).toEqual({ prefix: '山西分公司', level: 'company' });
  });
  it('全国合并视图 + 全国汇总 → 全国汇总', () => {
    const r = computeScopeLabel(f({}), emptyMap, '全国汇总');
    expect(r).toEqual({ prefix: '全国汇总', level: 'company' });
  });
});

describe('computeScopeLabel — 其余层级不受省份影响（逻辑不变）', () => {
  it('单机构 → 机构名', () => {
    const r = computeScopeLabel(f({ org_level_3: ['天府'] }), emptyMap, '四川分公司');
    expect(r).toEqual({ prefix: '天府', level: 'org' });
  });
  it('单业务员 → 机构+团队+业务员', () => {
    const map = new Map([['罗磊', '蒲江']]);
    const r = computeScopeLabel(f({ org_level_3: ['天府'], salesman_name: ['罗磊'] }), map, '四川分公司');
    expect(r).toEqual({ prefix: '天府蒲江罗磊', level: 'salesman' });
  });
  it('多业务员同团队 → 机构团队团队', () => {
    const map = new Map([['甲', 'A团'], ['乙', 'A团']]);
    const r = computeScopeLabel(f({ org_level_3: ['天府'], salesman_name: ['甲', '乙'] }), map, '四川分公司');
    expect(r).toEqual({ prefix: '天府A团团队', level: 'team' });
  });
  it('多业务员跨团队（同机构）→ 机构', () => {
    const map = new Map([['甲', 'A团'], ['乙', 'B团']]);
    const r = computeScopeLabel(f({ org_level_3: ['天府'], salesman_name: ['甲', '乙'] }), map, '四川分公司');
    expect(r).toEqual({ prefix: '天府', level: 'org' });
  });
});
