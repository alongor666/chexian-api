import { describe, it, expect } from 'vitest';
import { compareClaimRatioRows } from '../ClaimRatioTable';
import type { ClaimRatioData } from '../../types/costTypes';

function row(dim_key: string, earned_claim_ratio: number): ClaimRatioData {
  return { dim_key, earned_claim_ratio } as ClaimRatioData;
}

describe('compareClaimRatioRows — 反对称性（codex P2：双汇总行场景）', () => {
  it('比较器对任意一对行满足反对称：sign(compare(a,b)) === -sign(compare(b,a))', () => {
    const rows: ClaimRatioData[] = [
      row('乐山', 60),
      row('天府', 80),
      row('四川分公司', 70),
      row('山西分公司', 65),
      row('全国汇总', 68),
    ];
    for (const a of rows) {
      for (const b of rows) {
        if (a === b) continue; // 自比较 compare(x,x)=0，Object.is(0,-0) 恒 false 与反对称性无关，跳过
        const ab = Math.sign(compareClaimRatioRows(a, b));
        const ba = Math.sign(compareClaimRatioRows(b, a));
        expect(ab).toBe(-ba);
      }
    }
  });

  it('普通行按赔付率从高到低排序', () => {
    const sorted = [row('乐山', 60), row('天府', 80), row('宜宾', 70)].sort(compareClaimRatioRows);
    expect(sorted.map((r) => r.dim_key)).toEqual(['天府', '宜宾', '乐山']);
  });

  it('单个汇总行置底（普通行在前）', () => {
    const sorted = [row('四川分公司', 999), row('乐山', 60), row('天府', 80)].sort(compareClaimRatioRows);
    expect(sorted.map((r) => r.dim_key)).toEqual(['天府', '乐山', '四川分公司']);
  });

  it('多个汇总行同时存在时（超管全国合并视图）不再产生未定义排序——本身互相之间按数值排序', () => {
    const sorted = [row('四川分公司', 70), row('山西分公司', 65), row('乐山', 60)].sort(compareClaimRatioRows);
    // 两个汇总行都应排在普通行「乐山」之后，二者之间顺序按数值稳定（70 > 65）
    expect(sorted[0].dim_key).toBe('乐山');
    expect(sorted.slice(1).map((r) => r.dim_key)).toEqual(['四川分公司', '山西分公司']);
  });
});
