import { describe, it, expect } from 'vitest';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import { orderClaimsSourceFiles } from '../数据管理/lib/claims-source-order.mjs';

describe('orderClaimsSourceFiles（BACKLOG 2026-06-11-claude-9ba379）', () => {
  it('legacy 恒排在 new 之前（new 在数组尾部，keep=last 时新全量胜出）', () => {
    const newFiles = [
      { name: '20260601-20260701_05_理赔明细.xlsx', path: '/src/20260601-20260701_05_理赔明细.xlsx' },
    ];
    const legacyFiles = [
      { name: '车险报立结案清单_老快照.xlsx', path: '/src/车险报立结案清单_老快照.xlsx' },
    ];
    const result = orderClaimsSourceFiles(newFiles, legacyFiles);
    expect(result.map((f: any) => f.name)).toEqual([
      '车险报立结案清单_老快照.xlsx',
      '20260601-20260701_05_理赔明细.xlsx',
    ]);
  });

  it('多个 legacy + 多个 new：全部 legacy 在前，全部 new 在后，各组内部相对顺序不变', () => {
    const newFiles = [
      { name: 'a_02_理赔明细_*.xlsx', path: '/a' },
      { name: 'b_05_理赔明细_*.xlsx', path: '/b' },
    ];
    const legacyFiles = [
      { name: '车险报立结案清单_1.xlsx', path: '/l1' },
      { name: '车险报立结案清单_2.xlsx', path: '/l2' },
    ];
    const result = orderClaimsSourceFiles(newFiles, legacyFiles);
    expect(result.map((f: any) => f.path)).toEqual(['/l1', '/l2', '/a', '/b']);
  });

  it('legacyFiles 为空数组 → 仅返回 newFiles（不引入 undefined）', () => {
    const newFiles = [{ name: 'x.xlsx', path: '/x' }];
    expect(orderClaimsSourceFiles(newFiles, [])).toEqual(newFiles);
  });

  it('newFiles 为空数组 → 仅返回 legacyFiles', () => {
    const legacyFiles = [{ name: 'y.xlsx', path: '/y' }];
    expect(orderClaimsSourceFiles([], legacyFiles)).toEqual(legacyFiles);
  });

  it('两者皆空 → 空数组', () => {
    expect(orderClaimsSourceFiles([], [])).toEqual([]);
  });

  it('缺省参数（undefined）→ 视为空数组，不抛错', () => {
    expect(orderClaimsSourceFiles(undefined, undefined)).toEqual([]);
  });

  it('不产生新对象内容变化，仅重排引用（浅拷贝语义）', () => {
    const item = { name: 'z.xlsx', path: '/z' };
    const result = orderClaimsSourceFiles([item], []);
    expect(result[0]).toBe(item);
  });
});
