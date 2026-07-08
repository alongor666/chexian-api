/**
 * cohortYears 解析单测 —— 锁定「默认窗口按当前年动态派生」与越界过滤行为，
 * 防再回归到硬编码 [2023, 2024, 2025, 2026]（跨年时间炸弹）。
 */
import { describe, it, expect } from 'vitest';
import { defaultCohortYears, parseCohortYears, COHORT_YEAR_MIN } from '../cohort-years.js';

const AT_2026 = new Date('2026-07-08T00:00:00Z');
const AT_2027 = new Date('2027-01-02T00:00:00Z');

describe('defaultCohortYears', () => {
  it('2026 年运行时输出与原硬编码逐字节一致', () => {
    expect(defaultCohortYears(AT_2026)).toEqual([2023, 2024, 2025, 2026]);
  });

  it('跨年自愈：2027 年默认窗口滚动到 [2024..2027]', () => {
    expect(defaultCohortYears(AT_2027)).toEqual([2024, 2025, 2026, 2027]);
  });
});

describe('parseCohortYears', () => {
  it('未传参数回落默认窗口', () => {
    expect(parseCohortYears(undefined, AT_2026)).toEqual([2023, 2024, 2025, 2026]);
  });

  it('显式传参按原样解析', () => {
    expect(parseCohortYears('2024,2025', AT_2026)).toEqual([2024, 2025]);
  });

  it('越界与非法项被过滤（下界 + 次年上界）', () => {
    expect(parseCohortYears(`2019,${COHORT_YEAR_MIN},2027,2028,abc`, AT_2026)).toEqual([
      COHORT_YEAR_MIN,
      2027,
    ]);
  });

  it('全部非法时回落默认窗口而非空列表（修复原实现空数组入 SQL 的边界）', () => {
    expect(parseCohortYears('abc,,1999', AT_2026)).toEqual([2023, 2024, 2025, 2026]);
    expect(parseCohortYears('', AT_2026)).toEqual([2023, 2024, 2025, 2026]);
  });

  it('非字符串输入回落默认窗口', () => {
    expect(parseCohortYears(['2024'], AT_2026)).toEqual([2023, 2024, 2025, 2026]);
  });
});
