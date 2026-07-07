import { describe, it, expect } from 'vitest';
import { compareDrilldownRows } from '../DrilldownTable';
import type { DrilldownRow } from '../../types';

function row(group_name: string, underwriting_rate: number): DrilldownRow {
  return { group_key: group_name, group_name, underwriting_rate } as DrilldownRow;
}

describe('compareDrilldownRows — 反对称性（codex P2：双汇总行场景）', () => {
  it('比较器对任意一对行满足反对称：sign(compare(a,b)) === -sign(compare(b,a))', () => {
    const rows: DrilldownRow[] = [
      row('乐山', 0.6),
      row('天府', 0.8),
      row('四川分公司', 0.7),
      row('山西分公司', 0.65),
      row('全国汇总', 0.68),
    ];
    for (const a of rows) {
      for (const b of rows) {
        if (a === b) continue; // 自比较 compare(x,x)=0，Object.is(0,-0) 恒 false 与反对称性无关，跳过
        const ab = Math.sign(compareDrilldownRows(a, b));
        const ba = Math.sign(compareDrilldownRows(b, a));
        expect(ab).toBe(-ba);
      }
    }
  });

  it('普通行按转化率从低到高排序', () => {
    const sorted = [row('乐山', 0.6), row('天府', 0.8), row('宜宾', 0.7)].sort(compareDrilldownRows);
    expect(sorted.map((r) => r.group_name)).toEqual(['乐山', '宜宾', '天府']);
  });

  it('单个汇总行置顶（普通行在后）', () => {
    const sorted = [row('乐山', 0.6), row('天府', 0.8), row('四川分公司', 0.01)].sort(compareDrilldownRows);
    expect(sorted[0].group_name).toBe('四川分公司');
  });

  it('多个汇总行同时存在时（超管全国合并视图）不再产生未定义排序——本身互相之间按数值排序', () => {
    const sorted = [row('乐山', 0.6), row('四川分公司', 0.7), row('山西分公司', 0.65)].sort(compareDrilldownRows);
    // 两个汇总行都应排在普通行「乐山」之前，二者之间顺序按数值稳定（0.65 < 0.7）
    expect(sorted.slice(0, 2).map((r) => r.group_name)).toEqual(['山西分公司', '四川分公司']);
    expect(sorted[2].group_name).toBe('乐山');
  });
});
