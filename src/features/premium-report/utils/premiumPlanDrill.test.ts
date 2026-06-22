import { describe, it, expect } from 'vitest';
import {
  LEVEL_ORDER,
  LEVEL_LABELS,
  buildFiltersFromPath,
  computeDrillDownTarget,
  computeDrillUpDisplayLevel,
  makeDrillStepLabel,
} from './premiumPlanDrill';
import { formatSalesmanName } from '../../../shared/utils/formatters';
import type { DrillPathStep, PlanDrilldownLevel } from '../types/premiumReport';

const step = (
  level: PlanDrilldownLevel,
  value?: string,
  label = ''
): DrillPathStep => ({ level, label, ...(value === undefined ? {} : { value }) });

describe('LEVEL_ORDER / LEVEL_LABELS · 常量', () => {
  it('层级顺序固定为 公司→机构→团队→业务员→客户类别→险别', () => {
    expect(LEVEL_ORDER).toEqual([
      'company', 'org', 'team', 'salesman', 'customer_category', 'coverage',
    ]);
  });

  it('每个层级都有中文标签', () => {
    for (const lvl of LEVEL_ORDER) {
      expect(LEVEL_LABELS[lvl]).toBeTruthy();
    }
    expect(LEVEL_LABELS.salesman).toBe('业务员');
  });
});

describe('buildFiltersFromPath · 路径 → API 筛选参数', () => {
  it('空路径 → {}', () => {
    expect(buildFiltersFromPath([])).toEqual({});
  });

  it('仅顶层 company（无 value）→ {}', () => {
    expect(buildFiltersFromPath([step('company', undefined, '分公司整体')])).toEqual({});
  });

  it('company 即使带 value 也忽略（不在 switch 内）', () => {
    expect(buildFiltersFromPath([step('company', '某分公司')])).toEqual({});
  });

  it('coverage 带 value 也忽略（不在 switch 内）', () => {
    expect(buildFiltersFromPath([step('coverage', '主全')])).toEqual({});
  });

  it('完整路径映射 org/team/salesman/customer_category', () => {
    expect(
      buildFiltersFromPath([
        step('company', undefined, '分公司整体'),
        step('org', '机构A'),
        step('team', '团队B'),
        step('salesman', '张三'),
        step('customer_category', '非营客车'),
      ])
    ).toEqual({
      orgFilter: '机构A',
      teamFilter: '团队B',
      salesmanFilter: '张三',
      customerCategoryFilter: '非营客车',
    });
  });

  it('value 为空串仍写入（仅 undefined 跳过）', () => {
    expect(buildFiltersFromPath([step('org', '')])).toEqual({ orgFilter: '' });
  });
});

describe('computeDrillDownTarget · 下钻目标层级（currentIdx+2 数据层、currentIdx+1 筛选层）', () => {
  it('company → 数据层 team / 筛选层 org', () => {
    expect(computeDrillDownTarget('company')).toEqual({ nextLevel: 'team', filterLevel: 'org' });
  });
  it('org → 数据层 salesman / 筛选层 team', () => {
    expect(computeDrillDownTarget('org')).toEqual({ nextLevel: 'salesman', filterLevel: 'team' });
  });
  it('team → 数据层 customer_category / 筛选层 salesman', () => {
    expect(computeDrillDownTarget('team')).toEqual({
      nextLevel: 'customer_category',
      filterLevel: 'salesman',
    });
  });
  it('salesman → 数据层 coverage / 筛选层 customer_category（最后一档可下钻）', () => {
    expect(computeDrillDownTarget('salesman')).toEqual({
      nextLevel: 'coverage',
      filterLevel: 'customer_category',
    });
  });
  it('customer_category → null（currentIdx+2 越界）', () => {
    expect(computeDrillDownTarget('customer_category')).toBeNull();
  });
  it('coverage → null（已最底层）', () => {
    expect(computeDrillDownTarget('coverage')).toBeNull();
  });
});

describe('computeDrillUpDisplayLevel · 上钻展示层级（parentIdx+1，末尾钳位）', () => {
  it('company → org', () => {
    expect(computeDrillUpDisplayLevel('company')).toBe('org');
  });
  it('org → team', () => {
    expect(computeDrillUpDisplayLevel('org')).toBe('team');
  });
  it('team → salesman', () => {
    expect(computeDrillUpDisplayLevel('team')).toBe('salesman');
  });
  it('salesman → customer_category', () => {
    expect(computeDrillUpDisplayLevel('salesman')).toBe('customer_category');
  });
  it('customer_category → coverage', () => {
    expect(computeDrillUpDisplayLevel('customer_category')).toBe('coverage');
  });
  it('coverage → coverage（钳位，不越界）', () => {
    expect(computeDrillUpDisplayLevel('coverage')).toBe('coverage');
  });
});

describe('makeDrillStepLabel · 面包屑标签', () => {
  it('非业务员层级直接用原值', () => {
    expect(makeDrillStepLabel('org', '机构A')).toBe('三级机构: 机构A');
    expect(makeDrillStepLabel('team', '团队B')).toBe('团队: 团队B');
    expect(makeDrillStepLabel('customer_category', '非营客车')).toBe('客户类别: 非营客车');
  });

  it('业务员层级对名称做 formatSalesmanName 美化', () => {
    expect(makeDrillStepLabel('salesman', '张三')).toBe(`业务员: ${formatSalesmanName('张三')}`);
  });
});
