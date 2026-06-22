import { describe, it, expect } from 'vitest';
import {
  calculateSummary,
  sortData,
  normalizeOrgReportRow,
  normalizeSalesmanReportRow,
} from './premiumReportCalc';
import { formatSalesmanName, formatTeamName } from '../../../shared/utils/formatters';
import type {
  OrgPremiumReportRow,
  SalesmanPremiumReportRow,
} from '../types/premiumReport';

// ---- 测试工厂 ----
function orgRow(车险保费: number, 车险件数 = 0): OrgPremiumReportRow {
  return {
    org_level_3: 'X',
    车险保费,
    商业险保费: 0,
    交强险保费: 0,
    车险件数,
    商业险件数: 0,
    交强险件数: 0,
    人均保费: 0,
    业务员数: 0,
    同比增长率: null,
  };
}

/**
 * raw 省略（undefined）时不写 raw_salesman_name 键，触发 `?? salesman_name` 回退；
 * 显式传 null / 空串可分别覆盖 nullish 回退与「空串非 nullish 保留」（锁 `??` ≠ `||`）。
 */
function salesRow(salesman_name: string, raw?: string | null): SalesmanPremiumReportRow {
  const base = {
    salesman_name,
    org_level_3: 'X',
    team_name: 'T',
    车险保费: 0,
    商业险保费: 0,
    交强险保费: 0,
    车险件数: 0,
    商业险件数: 0,
    交强险件数: 0,
    续保率: 0,
    非过户率: 0,
  };
  const row = raw === undefined ? base : { ...base, raw_salesman_name: raw };
  return row as unknown as SalesmanPremiumReportRow;
}

describe('calculateSummary · 聚合', () => {
  it('空报表 → 全 0，avgPremium 除零回退 0', () => {
    expect(calculateSummary([], [])).toEqual({
      totalPremium: 0,
      totalPolicies: 0,
      orgCount: 0,
      salesmanCount: 0,
      avgPremium: 0,
    });
  });

  it('totalPremium / totalPolicies / orgCount 求和与计数', () => {
    const r = calculateSummary([orgRow(10, 3), orgRow(20, 5), orgRow(30, 2)], []);
    expect(r.totalPremium).toBe(60);
    expect(r.totalPolicies).toBe(10); // 件数不取整
    expect(r.orgCount).toBe(3);
  });

  it('totalPremium 两位小数四舍五入：去浮点尾差(1.1+2.2=3.3) 与三位截断(1.111+2.222→3.33)', () => {
    expect(calculateSummary([orgRow(1.1), orgRow(2.2)], []).totalPremium).toBe(3.3);
    expect(calculateSummary([orgRow(1.111), orgRow(2.222)], []).totalPremium).toBe(3.33);
  });

  it('avgPremium = totalPremium / orgCount，两位小数', () => {
    // (1.1 + 2.2)/2 = 1.65；浮点尾差经四舍五入清除
    expect(calculateSummary([orgRow(1.1), orgRow(2.2)], []).avgPremium).toBe(1.65);
    expect(calculateSummary([orgRow(10), orgRow(20), orgRow(30)], []).avgPremium).toBe(20);
  });

  it('salesmanCount 按 raw_salesman_name 去重；同 raw 折叠为 1', () => {
    expect(calculateSummary([], [salesRow('张三', 'A'), salesRow('李四', 'A')]).salesmanCount).toBe(1);
    expect(calculateSummary([], [salesRow('张三', 'A'), salesRow('李四', 'B')]).salesmanCount).toBe(2);
  });

  it('salesmanCount 在 raw_salesman_name 缺失时回退 salesman_name', () => {
    // 一行有 raw='甲'，一行无 raw 但 salesman_name='甲' → 都归一为 '甲' → 1
    expect(
      calculateSummary([], [salesRow('甲', '甲'), salesRow('甲')]).salesmanCount
    ).toBe(1);
    // 两行均无 raw，salesman_name 不同 → 2
    expect(calculateSummary([], [salesRow('甲'), salesRow('乙')]).salesmanCount).toBe(2);
  });

  it('salesmanCount 用 `??`：null 回退 salesman_name，但空串保留为 ""（区分 `??` 与 `||`）', () => {
    // raw=null → nullish → 回退 salesman_name；两行 salesman_name 不同 → 2
    expect(calculateSummary([], [salesRow('甲', null), salesRow('乙', null)]).salesmanCount).toBe(2);
    // raw='' 非 nullish，`??` 保留 ''；两行都归一为 '' → 1（若误用 `||` 会回退 salesman_name 得 2）
    expect(calculateSummary([], [salesRow('甲', ''), salesRow('乙', '')]).salesmanCount).toBe(1);
  });
});

describe('sortData · 泛型排序', () => {
  it('column 为空 → 原样返回同一引用（不复制）', () => {
    const input = [{ v: 3 }, { v: 1 }];
    const out = sortData(input, { column: '', direction: 'asc' });
    expect(out).toBe(input);
  });

  it('排序返回新数组，入参不被修改（不可变）', () => {
    const input = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const out = sortData(input, { column: 'v', direction: 'asc' });
    expect(out).not.toBe(input);
    expect(input).toEqual([{ v: 3 }, { v: 1 }, { v: 2 }]); // 原数组顺序不变
    expect(out.map((r) => r.v)).toEqual([1, 2, 3]);
  });

  it('数字 asc / desc', () => {
    const data = [{ v: 2 }, { v: 1 }, { v: 3 }];
    expect(sortData(data, { column: 'v', direction: 'asc' }).map((r) => r.v)).toEqual([1, 2, 3]);
    expect(sortData(data, { column: 'v', direction: 'desc' }).map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it('null：asc 排前、desc 排后', () => {
    const data = [{ v: 2 }, { v: null }, { v: 1 }];
    expect(sortData(data, { column: 'v', direction: 'asc' }).map((r) => r.v)).toEqual([null, 1, 2]);
    expect(sortData(data, { column: 'v', direction: 'desc' }).map((r) => r.v)).toEqual([2, 1, null]);
  });

  it('undefined 同 null 一并被 `== null` 捕获：asc 排前、desc 排后', () => {
    const data = [{ v: 2 }, { v: undefined }, { v: 1 }];
    expect(sortData(data, { column: 'v', direction: 'asc' }).map((r) => r.v)).toEqual([undefined, 1, 2]);
    expect(sortData(data, { column: 'v', direction: 'desc' }).map((r) => r.v)).toEqual([2, 1, undefined]);
  });

  it('两值皆 null → 返回 0、相对顺序保持', () => {
    const data = [{ v: null, id: 1 }, { v: null, id: 2 }];
    expect(sortData(data, { column: 'v', direction: 'asc' }).map((r) => r.id)).toEqual([1, 2]);
  });

  it('字符串走 localeCompare(zh-CN)：ASCII 稳定排序', () => {
    const data = [{ name: 'banana' }, { name: 'apple' }, { name: 'cherry' }];
    expect(sortData(data, { column: 'name', direction: 'asc' }).map((r) => r.name)).toEqual([
      'apple', 'banana', 'cherry',
    ]);
    expect(sortData(data, { column: 'name', direction: 'desc' }).map((r) => r.name)).toEqual([
      'cherry', 'banana', 'apple',
    ]);
  });

  it('中文按拼音 localeCompare(zh-CN)：甲(jiǎ) < 乙(yǐ)', () => {
    const data = [{ name: '乙' }, { name: '甲' }];
    expect(sortData(data, { column: 'name', direction: 'asc' }).map((r) => r.name)).toEqual(['甲', '乙']);
  });

  it('非数字配对走字符串比较（数字与字符串混排 → String 比较）', () => {
    // 一个为 string('9') 一个为 number(10)：非「皆 number」→ String 比较 → '10' < '9'
    const data = [{ v: '9' as unknown }, { v: 10 as unknown }];
    expect(sortData(data, { column: 'v', direction: 'asc' }).map((r) => r.v)).toEqual([10, '9']);
  });
});

describe('normalizeOrgReportRow · 逐字段边界', () => {
  it('完整行：字符串/数字字段强制转型', () => {
    expect(
      normalizeOrgReportRow({
        org_level_3: '天府',
        车险保费: '12.5',
        商业险保费: 8,
        交强险保费: 4.5,
        车险件数: '30',
        商业险件数: 20,
        交强险件数: 10,
        人均保费: 1.2,
        业务员数: '5',
        同比增长率: '15',
      })
    ).toEqual({
      org_level_3: '天府',
      车险保费: 12.5,
      商业险保费: 8,
      交强险保费: 4.5,
      车险件数: 30,
      商业险件数: 20,
      交强险件数: 10,
      人均保费: 1.2,
      业务员数: 5,
      同比增长率: 15,
    });
  });

  it('空对象 → 数字字段 0、org_level_3 空串、同比增长率 null', () => {
    expect(normalizeOrgReportRow({})).toEqual({
      org_level_3: '',
      车险保费: 0,
      商业险保费: 0,
      交强险保费: 0,
      车险件数: 0,
      商业险件数: 0,
      交强险件数: 0,
      人均保费: 0,
      业务员数: 0,
      同比增长率: null,
    });
  });

  it('同比增长率：0 保留为 0（!= null）、null/undefined → null、数字串 → Number', () => {
    expect(normalizeOrgReportRow({ 同比增长率: 0 }).同比增长率).toBe(0);
    expect(normalizeOrgReportRow({ 同比增长率: null }).同比增长率).toBeNull();
    expect(normalizeOrgReportRow({ 同比增长率: undefined }).同比增长率).toBeNull();
    expect(normalizeOrgReportRow({}).同比增长率).toBeNull();
    expect(normalizeOrgReportRow({ 同比增长率: -3.2 }).同比增长率).toBe(-3.2);
  });
});

describe('normalizeSalesmanReportRow · 逐字段边界', () => {
  it('salesman_name 走 formatSalesmanName，raw_salesman_name 保留原值；team_name 走 formatTeamName', () => {
    const r = normalizeSalesmanReportRow({ salesman_name: '张三', team_name: '某业务一部' });
    expect(r.salesman_name).toBe(formatSalesmanName('张三'));
    expect(r.raw_salesman_name).toBe('张三');
    expect(r.team_name).toBe(formatTeamName('某业务一部'));
  });

  it('空 salesman_name：格式化为 "-"，但 raw_salesman_name 仍为空串（区分两源）', () => {
    const r = normalizeSalesmanReportRow({});
    expect(r.salesman_name).toBe('-'); // formatSalesmanName('') → '-'
    expect(r.raw_salesman_name).toBe('');
    expect(r.team_name).toBe('-'); // formatTeamName(undefined) → '-'
    expect(r.org_level_3).toBe('');
  });

  it('数字字段强制转型，续保率/非过户率兜底 0', () => {
    const r = normalizeSalesmanReportRow({
      salesman_name: 'A',
      车险保费: '100',
      续保率: 88,
    });
    expect(r.车险保费).toBe(100);
    expect(r.续保率).toBe(88);
    expect(r.非过户率).toBe(0);
    expect(r.交强险件数).toBe(0);
  });
});
