import { describe, it, expect } from 'vitest';
import { deriveCategories, filterTemplatesByCategory } from './reportTemplates';

const items = [
  { id: 'a', category: '综合分析' },
  { id: 'b', category: '业绩分析' },
  { id: 'c', category: '综合分析' },
];

describe('deriveCategories · 分类列表', () => {
  it('首项「全部」+ 按出现顺序去重分类', () => {
    expect(deriveCategories(items)).toEqual(['全部', '综合分析', '业绩分析']);
  });

  it('空模板集 → 仅「全部」', () => {
    expect(deriveCategories([])).toEqual(['全部']);
  });
});

describe('filterTemplatesByCategory · 按分类筛选', () => {
  it('「全部」→ 返回全集（同一引用）', () => {
    expect(filterTemplatesByCategory(items, '全部')).toBe(items);
  });

  it('指定分类 → 精确匹配', () => {
    expect(filterTemplatesByCategory(items, '综合分析')).toEqual([
      { id: 'a', category: '综合分析' },
      { id: 'c', category: '综合分析' },
    ]);
    expect(filterTemplatesByCategory(items, '业绩分析')).toEqual([{ id: 'b', category: '业绩分析' }]);
  });

  it('不存在的分类 → 空数组', () => {
    expect(filterTemplatesByCategory(items, '不存在')).toEqual([]);
  });
});
